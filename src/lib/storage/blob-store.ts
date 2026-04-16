/**
 * Blob Store — Persistence Abstraction for File/Blob Storage
 *
 * Defines the async interface for file persistence (uploaded PDFs,
 * certificate PDFs) and provides a local filesystem adapter that
 * preserves current behavior.
 *
 * All routes that read or write files should go through this interface
 * rather than using ad hoc fs access.
 */

import fs from "fs";
import path from "path";

// ─── Interface ──────────────────────────────────────────────────────

export interface BlobStore {
  /** Save a blob. Returns the storage key/path reference. */
  saveBlob(key: string, data: Buffer): Promise<string>;

  /** Read a blob by key. Returns null if not found. */
  readBlob(key: string): Promise<Buffer | null>;

  /** Check if a blob exists. */
  exists(key: string): Promise<boolean>;
}

// ─── Local Filesystem Adapter ───────────────────────────────────────

const BASE_DIR = process.cwd();

function resolveLocalPath(key: string): string {
  return path.join(BASE_DIR, key);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const localBlobStore: BlobStore = {
  async saveBlob(key: string, data: Buffer): Promise<string> {
    const fullPath = resolveLocalPath(key);
    ensureDir(fullPath);
    fs.writeFileSync(fullPath, data);
    return key;
  },

  async readBlob(key: string): Promise<Buffer | null> {
    const fullPath = resolveLocalPath(key);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath);
  },

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(resolveLocalPath(key));
  },
};
