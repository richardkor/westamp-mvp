/**
 * Storage — Unified access to persistence abstractions.
 *
 * Resolves the active storage backend based on STORAGE_BACKEND env var:
 *   - "local" (default): local JSON file + filesystem adapters
 *   - "supabase": Supabase Postgres + Storage adapters
 *
 * Local mode is the default and does not require any Supabase env vars.
 * Supabase mode fails fast on first use if required env vars are missing.
 *
 * Supabase adapters are loaded lazily — only when STORAGE_BACKEND=supabase.
 * This ensures local mode never imports Supabase SDK or trips on missing config.
 */

import { localJobStore } from "./job-store";
import { localBlobStore } from "./blob-store";
import type { JobStore } from "./job-store";
import type { BlobStore } from "./blob-store";

export type { JobStore } from "./job-store";
export type { BlobStore } from "./blob-store";

function resolveJobStore(): JobStore {
  const backend = process.env.STORAGE_BACKEND;
  if (backend === "supabase") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseJobStore } = require("./supabase-job-store") as {
      supabaseJobStore: JobStore;
    };
    return supabaseJobStore;
  }
  return localJobStore;
}

function resolveBlobStore(): BlobStore {
  const backend = process.env.STORAGE_BACKEND;
  if (backend === "supabase") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseBlobStore } = require("./supabase-blob-store") as {
      supabaseBlobStore: BlobStore;
    };
    return supabaseBlobStore;
  }
  return localBlobStore;
}

export const jobStore: JobStore = resolveJobStore();
export const blobStore: BlobStore = resolveBlobStore();
