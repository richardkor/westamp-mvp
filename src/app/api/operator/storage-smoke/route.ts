/**
 * GET /api/operator/storage-smoke
 *
 * Operator-only smoke verification for the active storage backend.
 * Reports backend identity and runs narrow real checks:
 *   - local mode: job store list check
 *   - supabase mode: job store list + blob write/read roundtrip
 *
 * Does NOT expose secrets. Does NOT migrate data.
 * Protected by operator middleware.
 */

import { getStorageInfo } from "../../../../lib/storage/storage-info";
import { jobStore, blobStore } from "../../../../lib/storage";

interface SmokeCheckResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function GET() {
  const info = getStorageInfo();

  const result: {
    backend: string;
    supabaseConfigured: boolean;
    checks: {
      jobStore: SmokeCheckResult;
      blobStore: SmokeCheckResult | null;
    };
  } = {
    backend: info.backend,
    supabaseConfigured: info.supabaseConfigured,
    checks: {
      jobStore: { ok: false },
      blobStore: null,
    },
  };

  // ── Job store smoke ─────────────────────────────────────────────
  try {
    const jobs = await jobStore.listJobs();
    result.checks.jobStore = { ok: true, jobCount: jobs.length };
  } catch (err) {
    result.checks.jobStore = {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown job store error",
    };
  }

  // ── Blob store smoke (supabase mode only) ───────────────────────
  if (info.backend === "supabase") {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const smokeKey = `smoke-tests/${ts}.txt`;
    const smokeData = Buffer.from(`smoke-check-${ts}`);

    try {
      await blobStore.saveBlob(smokeKey, smokeData);
      const readBack = await blobStore.readBlob(smokeKey);

      if (!readBack) {
        result.checks.blobStore = {
          ok: false,
          error: "Blob written but read-back returned null.",
          smokeKey,
        };
      } else if (readBack.toString() !== smokeData.toString()) {
        result.checks.blobStore = {
          ok: false,
          error: "Blob round-trip mismatch.",
          smokeKey,
        };
      } else {
        result.checks.blobStore = { ok: true, smokeKey };
      }
    } catch (err) {
      result.checks.blobStore = {
        ok: false,
        error:
          err instanceof Error ? err.message : "Unknown blob store error",
        smokeKey,
      };
    }
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
