/**
 * WeStamp — Stamping Job Store
 *
 * Thin async re-export layer over the storage abstraction.
 * Preserves the existing import interface so all 34+ route files
 * continue to work with minimal changes (adding await).
 *
 * Actual persistence is handled by the job store adapter resolved
 * in src/lib/storage/index.ts (local or supabase).
 *
 * IMPORTANT: This module must only be imported in server-side code
 * (API routes, Server Components). Never import in "use client".
 */

import { jobStore } from "./storage";
import { JobUpdateConflictError } from "./storage/job-store";
import { StampingJob } from "./stamping-types";

/** Persist a new stamping job record. */
export async function createJob(job: StampingJob): Promise<void> {
  await jobStore.createJob(job);
}

/** Retrieve a single stamping job by ID. Returns null if not found. */
export async function getJob(id: string): Promise<StampingJob | null> {
  return await jobStore.getJob(id);
}

/** Update fields on an existing stamping job. Always stamps updatedAt. */
export async function updateJob(
  id: string,
  updates: Partial<Omit<StampingJob, "id" | "createdAt">>
): Promise<StampingJob | null> {
  return await jobStore.updateJob(id, updates);
}

/**
 * Conflict-aware job update: wraps updateJob with automatic mapping of
 * JobUpdateConflictError → HTTP 409, and null (not found) → HTTP 500.
 *
 * Returns the updated StampingJob on success, or a pre-built Response
 * on conflict/not-found. Callers check: if (result instanceof Response)
 * return result.
 *
 * Non-conflict errors (storage failures, network issues) are NOT caught
 * here — they bubble up through the normal error path.
 */
export async function updateJobOrConflict(
  id: string,
  updates: Partial<Omit<StampingJob, "id" | "createdAt">>
): Promise<StampingJob | Response> {
  try {
    const result = await jobStore.updateJob(id, updates);
    if (!result) {
      return Response.json(
        { error: "Failed to update record." },
        { status: 500 }
      );
    }
    return result;
  } catch (err) {
    if (err instanceof JobUpdateConflictError) {
      return Response.json(
        {
          error: "This job was modified by another request. Please refresh and try again.",
          code: "JOB_UPDATE_CONFLICT",
        },
        { status: 409 }
      );
    }
    throw err;
  }
}

/** List all stamping jobs, most recent first. */
export async function listJobs(): Promise<StampingJob[]> {
  return await jobStore.listJobs();
}
