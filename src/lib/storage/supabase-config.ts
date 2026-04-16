/**
 * Supabase Configuration — Lazy Client Singleton
 *
 * Validates required environment variables and creates a Supabase
 * client on first call. Does NOT validate at import time — this
 * ensures local mode never trips on missing Supabase env vars.
 *
 * Server-side only. Uses service-role key for full access.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns a validated Supabase client.
 * Throws immediately if required env vars are missing.
 * Safe to call repeatedly — returns cached singleton.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "STORAGE_BACKEND=supabase requires SUPABASE_URL environment variable."
    );
  }
  if (!key) {
    throw new Error(
      "STORAGE_BACKEND=supabase requires SUPABASE_SERVICE_ROLE_KEY environment variable."
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}
