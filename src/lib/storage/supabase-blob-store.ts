/**
 * Supabase Blob Store — Supabase Storage-backed BlobStore implementation
 *
 * Stores files in a private Supabase Storage bucket `westamp-files`.
 * Preserves current storage key semantics (e.g. `uploads/<id>.pdf`,
 * `uploads/certificates/<id>-cert.pdf`).
 *
 * Server-side only. Uses service-role key via supabase-config.ts.
 */

import { getSupabaseClient } from "./supabase-config";
import type { BlobStore } from "./blob-store";

const BUCKET = "westamp-files";

export const supabaseBlobStore: BlobStore = {
  async saveBlob(key: string, data: Buffer): Promise<string> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, data, {
        upsert: true,
        contentType: "application/octet-stream",
      });

    if (error) {
      console.error("supabaseBlobStore.saveBlob error:", error);
      throw new Error(`Failed to save blob ${key}: ${error.message}`);
    }

    return key;
  },

  async readBlob(key: string): Promise<Buffer | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(key);

    if (error) {
      // Treat not-found as null rather than throwing
      if (
        error.message?.includes("not found") ||
        error.message?.includes("Object not found")
      ) {
        return null;
      }
      console.error("supabaseBlobStore.readBlob error:", error);
      throw new Error(`Failed to read blob ${key}: ${error.message}`);
    }

    if (!data) return null;

    // Convert Web API Blob to Node Buffer
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  },

  async exists(key: string): Promise<boolean> {
    const supabase = getSupabaseClient();

    // Split key into folder + filename for Supabase list API
    const lastSlash = key.lastIndexOf("/");
    const folder = lastSlash >= 0 ? key.slice(0, lastSlash) : "";
    const fileName = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, { search: fileName, limit: 1 });

    if (error) {
      console.error("supabaseBlobStore.exists error:", error);
      return false;
    }

    return (data ?? []).some((f) => f.name === fileName);
  },
};
