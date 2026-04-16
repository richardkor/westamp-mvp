/**
 * GET /api/operator/verify-supabase-migration
 *
 * Operator-only read-only post-migration verification.
 *
 * Compares local source state against Supabase destination state:
 *   - job ID coverage (missing in Supabase, extra in Supabase)
 *   - referenced blob key existence in Supabase
 *
 * Returns a compact structured report with an overall verdict:
 *   - match: zero missing jobs, zero extra jobs, zero missing blobs
 *   - mismatch: any missing jobs OR extra jobs OR missing blobs
 *   - supabase_unavailable: Supabase configured but read fails
 *   - not_configured: Supabase env not set
 *
 * Performs NO writes or repair actions. Read/compare/report only.
 * Works regardless of current STORAGE_BACKEND setting — imports
 * local and Supabase stores directly.
 *
 * Protected by operator middleware.
 */

import { localJobStore } from "../../../../lib/storage/job-store";
import { supabaseJobStore } from "../../../../lib/storage/supabase-job-store";
import { supabaseBlobStore } from "../../../../lib/storage/supabase-blob-store";
import { getStorageInfo } from "../../../../lib/storage/storage-info";
import type { StampingJob } from "../../../../lib/stamping-types";

/** Maximum entries in sample lists to avoid giant payloads. */
const SAMPLE_CAP = 20;

/**
 * Collect all blob keys referenced by a job.
 * Returns the uploaded document path and certificate path (if present).
 */
function collectBlobKeys(job: StampingJob): string[] {
  const keys: string[] = [];
  if (job.storagePath) {
    keys.push(job.storagePath);
  }
  if (job.fulfilmentState?.certificateStoragePath) {
    keys.push(job.fulfilmentState.certificateStoragePath);
  }
  return keys;
}

/**
 * Cap an array at SAMPLE_CAP entries and return the sample + truncation flag.
 */
function capSample(items: string[]): {
  sample: string[];
  truncated: boolean;
} {
  if (items.length <= SAMPLE_CAP) {
    return { sample: items, truncated: false };
  }
  return { sample: items.slice(0, SAMPLE_CAP), truncated: true };
}

export async function GET() {
  // ── Guard: Supabase must be configured ─────────────────────────
  const info = getStorageInfo();
  if (!info.supabaseConfigured) {
    return Response.json(
      {
        verdict: "not_configured",
        error:
          "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  // ── Read local jobs ────────────────────────────────────────────
  let localJobs: StampingJob[];
  try {
    localJobs = await localJobStore.listJobs();
  } catch (err) {
    return Response.json(
      {
        error: `Failed to read local job store: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }

  const localIds = new Set(localJobs.map((j) => j.id));

  // ── Read Supabase jobs ─────────────────────────────────────────
  let supabaseJobs: StampingJob[];
  try {
    supabaseJobs = await supabaseJobStore.listJobs();
  } catch (err) {
    return Response.json(
      {
        verdict: "supabase_unavailable",
        error: `Failed to read Supabase job store: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabaseIds = new Set(supabaseJobs.map((j) => j.id));

  // ── Compare job IDs ────────────────────────────────────────────
  const missingJobIds: string[] = [];
  for (const id of localIds) {
    if (!supabaseIds.has(id)) {
      missingJobIds.push(id);
    }
  }

  const extraJobIds: string[] = [];
  for (const id of supabaseIds) {
    if (!localIds.has(id)) {
      extraJobIds.push(id);
    }
  }

  const missingJobsSample = capSample(missingJobIds);
  const extraJobsSample = capSample(extraJobIds);

  // ── Collect and check blob keys ────────────────────────────────
  const allBlobKeys: string[] = [];
  for (const job of localJobs) {
    const keys = collectBlobKeys(job);
    allBlobKeys.push(...keys);
  }
  const uniqueBlobKeys = [...new Set(allBlobKeys)];

  let blobsExistInSupabase = 0;
  const missingBlobKeys: string[] = [];

  for (const key of uniqueBlobKeys) {
    try {
      const exists = await supabaseBlobStore.exists(key);
      if (exists) {
        blobsExistInSupabase += 1;
      } else {
        missingBlobKeys.push(key);
      }
    } catch {
      // Treat check failure as missing
      missingBlobKeys.push(key);
    }
  }

  const missingBlobsSample = capSample(missingBlobKeys);

  // ── Determine verdict ──────────────────────────────────────────
  const verdict: "match" | "mismatch" =
    missingJobIds.length === 0 &&
    extraJobIds.length === 0 &&
    missingBlobKeys.length === 0
      ? "match"
      : "mismatch";

  // ── Build report ───────────────────────────────────────────────
  const report = {
    verdict,
    jobs: {
      localCount: localIds.size,
      supabaseCount: supabaseIds.size,
      missingInSupabaseCount: missingJobIds.length,
      extraInSupabaseCount: extraJobIds.length,
      missingInSupabaseSample: missingJobsSample.sample,
      missingInSupabaseSampleTruncated: missingJobsSample.truncated,
      extraInSupabaseSample: extraJobsSample.sample,
      extraInSupabaseSampleTruncated: extraJobsSample.truncated,
    },
    blobs: {
      totalReferenced: uniqueBlobKeys.length,
      existInSupabase: blobsExistInSupabase,
      missingInSupabaseCount: missingBlobKeys.length,
      missingInSupabaseSample: missingBlobsSample.sample,
      missingInSupabaseSampleTruncated: missingBlobsSample.truncated,
    },
  };

  return Response.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
