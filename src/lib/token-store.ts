/**
 * WeStamp — Persistent PDF Render Token Store
 *
 * Stores serialized form data behind an opaque UUID token so that
 * Puppeteer can visit a print page and retrieve the data server-side
 * without exposing personal data in URLs.
 *
 * Backed by the blob storage abstraction (local filesystem or Supabase
 * Storage) so token payloads survive across processes and deployments.
 * Each token is stored as a JSON blob at `print-tokens/<uuid>.json`.
 *
 * Token payloads include createdAt / expiresAt metadata. Expiry is
 * checked on read — no background cleanup worker is needed.
 *
 * removeToken() overwrites the stored payload with an immediately-expired
 * envelope rather than deleting it, so invalidation works without
 * requiring delete support from the storage backend.
 *
 * getData() returns a discriminated result so callers can distinguish
 * normal invalid/expired tokens from corrupt/unreadable storage.
 */

import { blobStore } from "./storage";

// ─── Types ────────────────────────────────────────────────────────────

/** Discriminated result from getData(). */
export type GetTokenResult =
  | { status: "valid"; data: unknown }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "corrupt"; error: string };

/** Shape of the JSON envelope stored in blob storage. */
interface TokenEnvelope {
  data: unknown;
  createdAt: string;
  expiresAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 120_000; // 120 seconds

/** Storage key prefix for all print tokens. */
const TOKEN_PREFIX = "print-tokens";

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Store data and return an opaque UUID token.
 * The token is valid for the TTL period.
 *
 * Writes a JSON envelope to blob storage at `print-tokens/<token>.json`.
 */
export async function storeData(
  data: unknown,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();

  const envelope: TokenEnvelope = {
    data,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };

  const key = `${TOKEN_PREFIX}/${token}.json`;
  const buffer = Buffer.from(JSON.stringify(envelope), "utf-8");
  await blobStore.saveBlob(key, buffer);

  return token;
}

/**
 * Retrieve data by token.
 *
 * Returns a discriminated result:
 * - "valid"     → data is present and within its TTL
 * - "not_found" → no stored payload exists for this token
 * - "expired"   → payload exists but expiresAt has passed (including
 *                  tokens invalidated by removeToken())
 * - "corrupt"   → payload exists but could not be read or parsed
 *                  (storage corruption or format mismatch)
 */
export async function getData(token: string): Promise<GetTokenResult> {
  const key = `${TOKEN_PREFIX}/${token}.json`;

  let buffer: Buffer | null;
  try {
    buffer = await blobStore.readBlob(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "corrupt", error: `Storage read failed: ${message}` };
  }

  if (!buffer) {
    return { status: "not_found" };
  }

  // Parse the stored JSON envelope
  let envelope: TokenEnvelope;
  try {
    const raw = JSON.parse(buffer.toString("utf-8"));

    // Validate envelope shape — must have data, createdAt, expiresAt
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("data" in raw) ||
      typeof raw.createdAt !== "string" ||
      typeof raw.expiresAt !== "string"
    ) {
      return {
        status: "corrupt",
        error: "Token envelope is missing required fields.",
      };
    }

    envelope = raw as TokenEnvelope;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "corrupt", error: `JSON parse failed: ${message}` };
  }

  // Check expiry
  const expiresAt = new Date(envelope.expiresAt).getTime();
  if (isNaN(expiresAt)) {
    return { status: "corrupt", error: "expiresAt is not a valid date." };
  }

  if (Date.now() > expiresAt) {
    return { status: "expired" };
  }

  return { status: "valid", data: envelope.data };
}

/**
 * Invalidate a token by overwriting its stored payload with an
 * immediately-expired envelope.
 *
 * After removeToken(), any subsequent getData() call will see
 * expiresAt in the past and return { status: "expired" }.
 *
 * Uses overwrite (saveBlob naturally overwrites in local mode and
 * uses upsert semantics in Supabase mode).
 */
export async function removeToken(token: string): Promise<void> {
  const key = `${TOKEN_PREFIX}/${token}.json`;

  const expiredEnvelope: TokenEnvelope = {
    data: null,
    createdAt: new Date().toISOString(),
    expiresAt: "1970-01-01T00:00:00.000Z",
  };

  const buffer = Buffer.from(JSON.stringify(expiredEnvelope), "utf-8");
  await blobStore.saveBlob(key, buffer);
}
