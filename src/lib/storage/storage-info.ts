/**
 * Storage Backend Introspection
 *
 * Reports the active storage backend and whether Supabase
 * configuration is present. Does NOT expose secret values.
 */

export interface StorageInfo {
  backend: "local" | "supabase";
  supabaseConfigured: boolean;
}

export function getStorageInfo(): StorageInfo {
  const backend =
    process.env.STORAGE_BACKEND === "supabase" ? "supabase" : "local";
  const supabaseConfigured =
    !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { backend, supabaseConfigured };
}
