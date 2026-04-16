/**
 * POST /api/operator/migrate-to-supabase
 *
 * Operator-only one-shot migration from local storage to Supabase.
 *
 * Default behavior (no query params): dry-run scan — reads local jobs
 * and blobs, reports what would be migrated, writes nothing.
 *
 * Live migration: POST ?mode=live — reads local data and writes to
 * Supabase with idempotent upserts. Safe to re-run.
 *
 * Requires Supabase env to be configured (SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY). Fails clearly if not.
 *
 * Protected by operator middleware.
 */

import { NextRequest } from "next/server";
import { localJobStore } from "../../../../lib/storage/job-store";
import { localBlobStore } from "../../../../lib/storage/blob-store";
import { supabaseBlobStore } from "../../../../lib/storage/supabase-blob-store";
import { getSupabaseClient } from "../../../../lib/storage/supabase-config";
import { getStorageInfo } from "../../../../lib/storage/storage-info";
import type { StampingJob } from "../../../../lib/stamping-types";

const JOBS_TABLE = "westamp_jobs";

interface ItemError {
  key: string;
  error: string;
}

interface MigrationReport {
  mode: "dry-run" | "live";
  jobs: {
    total: number;
    migrated: number;
    failed: number;
    errors: ItemError[];
  };
  blobs: {
    total: number;
    exists: number;
    missing: number;
    migrated: number;
    failed: number;
    missingKeys: string[];
    errors: ItemError[];
  };
}

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

export async function POST(request: NextRequest) {
  // ── Guard: Supabase must be configured ─────────────────────────
  const info = getStorageInfo();
  if (!info.supabaseConfigured) {
    return Response.json(
      {
        error:
          "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      },
      { status: 400 }
    );
  }

  // ── Determine mode ─────────────────────────────────────────────
  const mode = request.nextUrl.searchParams.get("mode");
  const isLive = mode === "live";

  // ── Read all local jobs ────────────────────────────────────────
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

  // ── Build report structure ─────────────────────────────────────
  const report: MigrationReport = {
    mode: isLive ? "live" : "dry-run",
    jobs: { total: localJobs.length, migrated: 0, failed: 0, errors: [] },
    blobs: {
      total: 0,
      exists: 0,
      missing: 0,
      migrated: 0,
      failed: 0,
      missingKeys: [],
      errors: [],
    },
  };

  // ── Collect and check all blob keys ────────────────────────────
  const allBlobKeys: string[] = [];
  for (const job of localJobs) {
    const keys = collectBlobKeys(job);
    allBlobKeys.push(...keys);
  }

  // Deduplicate blob keys (in case any overlap)
  const uniqueBlobKeys = [...new Set(allBlobKeys)];
  report.blobs.total = uniqueBlobKeys.length;

  const existingBlobKeys: string[] = [];
  for (const key of uniqueBlobKeys) {
    try {
      const exists = await localBlobStore.exists(key);
      if (exists) {
        existingBlobKeys.push(key);
      } else {
        report.blobs.missing += 1;
        report.blobs.missingKeys.push(key);
      }
    } catch (err) {
      report.blobs.missing += 1;
      report.blobs.missingKeys.push(key);
    }
  }
  report.blobs.exists = existingBlobKeys.length;

  // ── Dry-run: return scan report without writing ────────────────
  if (!isLive) {
    return Response.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // ── Live migration: write jobs ─────────────────────────────────
  // Uses direct Supabase upsert for idempotent re-runs.
  // supabaseJobStore.createJob() uses .insert() which throws on
  // duplicate keys — not suitable for a re-runnable migration.
  const supabase = getSupabaseClient();

  for (const job of localJobs) {
    try {
      const { error } = await supabase.from(JOBS_TABLE).upsert(
        {
          id: job.id,
          payload: job,
          created_at: job.createdAt,
          updated_at: job.updatedAt,
        },
        { onConflict: "id" }
      );

      if (error) {
        report.jobs.failed += 1;
        report.jobs.errors.push({ key: job.id, error: error.message });
      } else {
        report.jobs.migrated += 1;
      }
    } catch (err) {
      report.jobs.failed += 1;
      report.jobs.errors.push({
        key: job.id,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // ── Live migration: write blobs ────────────────────────────────
  for (const key of existingBlobKeys) {
    try {
      const data = await localBlobStore.readBlob(key);
      if (!data) {
        // Existed during scan but unreadable now — treat as failure
        report.blobs.failed += 1;
        report.blobs.errors.push({
          key,
          error: "File existed during scan but readBlob returned null.",
        });
        continue;
      }
      await supabaseBlobStore.saveBlob(key, data);
      report.blobs.migrated += 1;
    } catch (err) {
      report.blobs.failed += 1;
      report.blobs.errors.push({
        key,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return Response.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
