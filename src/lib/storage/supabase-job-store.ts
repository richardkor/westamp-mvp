/**
 * Supabase Job Store — Supabase-backed JobStore implementation
 *
 * Stores job metadata in a `westamp_jobs` Postgres table with columns:
 *   id TEXT PRIMARY KEY
 *   payload JSONB NOT NULL
 *   created_at TIMESTAMPTZ
 *   updated_at TIMESTAMPTZ
 *
 * The full StampingJob object is stored as JSONB in the payload column.
 * Structural columns (id, created_at, updated_at) are denormalized
 * for indexing and querying.
 *
 * updateJob uses optimistic concurrency control: the write includes
 * a conditional predicate on updated_at so concurrent modifications
 * are detected and surfaced as JobUpdateConflictError rather than
 * silently overwritten.
 *
 * Server-side only. Uses service-role key via supabase-config.ts.
 */

import { getSupabaseClient } from "./supabase-config";
import type { JobStore } from "./job-store";
import { JobUpdateConflictError } from "./job-store";
import type { StampingJob } from "../stamping-types";

const TABLE = "westamp_jobs";

export const supabaseJobStore: JobStore = {
  async getJob(id: string): Promise<StampingJob | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("payload")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("supabaseJobStore.getJob error:", error);
      throw new Error(`Failed to get job ${id}: ${error.message}`);
    }

    if (!data) return null;
    return data.payload as StampingJob;
  },

  async listJobs(): Promise<StampingJob[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("payload")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("supabaseJobStore.listJobs error:", error);
      throw new Error(`Failed to list jobs: ${error.message}`);
    }

    return (data ?? []).map((row) => row.payload as StampingJob);
  },

  async createJob(job: StampingJob): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(TABLE).insert({
      id: job.id,
      payload: job,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    });

    if (error) {
      console.error("supabaseJobStore.createJob error:", error);
      throw new Error(`Failed to create job ${job.id}: ${error.message}`);
    }
  },

  async updateJob(
    id: string,
    updates: Partial<Omit<StampingJob, "id" | "createdAt">>
  ): Promise<StampingJob | null> {
    const supabase = getSupabaseClient();

    // Read current row — include updated_at for CAS guard
    const { data: existing, error: readError } = await supabase
      .from(TABLE)
      .select("payload, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("supabaseJobStore.updateJob read error:", readError);
      throw new Error(`Failed to read job ${id}: ${readError.message}`);
    }

    if (!existing) return null;

    const previousUpdatedAt = existing.updated_at as string;
    const current = existing.payload as StampingJob;
    const merged: StampingJob = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Conditional write: only succeed if updated_at has not changed since
    // our read. If another request updated the row between our read and
    // this write, the .eq("updated_at", ...) predicate won't match any
    // rows, and writeResult will be an empty array.
    const { data: writeResult, error: writeError } = await supabase
      .from(TABLE)
      .update({
        payload: merged,
        updated_at: merged.updatedAt,
      })
      .eq("id", id)
      .eq("updated_at", previousUpdatedAt)
      .select("id");

    if (writeError) {
      console.error("supabaseJobStore.updateJob write error:", writeError);
      throw new Error(`Failed to update job ${id}: ${writeError.message}`);
    }

    // If no rows were updated, another request modified this job
    // between our read and write — optimistic concurrency conflict.
    if (!writeResult || writeResult.length === 0) {
      throw new JobUpdateConflictError(id);
    }

    return merged;
  },
};
