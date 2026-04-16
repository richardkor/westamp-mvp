/**
 * Job Store — Persistence Abstraction for Stamping Jobs
 *
 * Defines the async interface for job metadata persistence and provides
 * a local JSON-file adapter that preserves current behavior.
 *
 * All route and workflow code should access job data through this
 * interface rather than through ad hoc file/JSON access.
 */

import fs from "fs";
import path from "path";
import { StampingJob } from "../stamping-types";

// ─── Conflict Error ────────────────────────────────────────────────

/**
 * Thrown when an updateJob call detects that the record was modified
 * by another request between read and write (optimistic concurrency
 * conflict). Callers may catch this to retry or report the conflict.
 *
 * Only applies to Supabase mode. Local mode is last-write-wins by
 * design (single-process, file-based — no concurrent access).
 */
export class JobUpdateConflictError extends Error {
  public readonly code = "JOB_UPDATE_CONFLICT";
  public readonly jobId: string;

  constructor(jobId: string) {
    super(
      `Conflict: job ${jobId} was modified by another request. Retry the operation.`
    );
    this.name = "JobUpdateConflictError";
    this.jobId = jobId;
  }
}

// ─── Interface ──────────────────────────────────────────────────────

export interface JobStore {
  /** Retrieve a single job by ID. Returns null if not found. */
  getJob(id: string): Promise<StampingJob | null>;

  /** List all jobs, most recent first. */
  listJobs(): Promise<StampingJob[]>;

  /** Persist a new job record. */
  createJob(job: StampingJob): Promise<void>;

  /** Update fields on an existing job. Always stamps updatedAt. Returns updated job or null. */
  updateJob(
    id: string,
    updates: Partial<Omit<StampingJob, "id" | "createdAt">>
  ): Promise<StampingJob | null>;
}

// ─── Local JSON File Adapter ────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "stamping-jobs.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readAll(): StampingJob[] {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return [];
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    return JSON.parse(raw) as StampingJob[];
  } catch {
    return [];
  }
}

function writeAll(jobs: StampingJob[]): void {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(jobs, null, 2), "utf8");
}

export const localJobStore: JobStore = {
  async getJob(id: string): Promise<StampingJob | null> {
    return readAll().find((j) => j.id === id) ?? null;
  },

  async listJobs(): Promise<StampingJob[]> {
    return readAll().slice().reverse();
  },

  async createJob(job: StampingJob): Promise<void> {
    const jobs = readAll();
    jobs.push(job);
    writeAll(jobs);
  },

  async updateJob(
    id: string,
    updates: Partial<Omit<StampingJob, "id" | "createdAt">>
  ): Promise<StampingJob | null> {
    const jobs = readAll();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    const updated: StampingJob = {
      ...jobs[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    jobs[idx] = updated;
    writeAll(jobs);
    return updated;
  },
};
