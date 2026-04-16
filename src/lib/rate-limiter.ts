/**
 * WeStamp — Per-IP Rate Limiter (In-Memory Fixed Window)
 *
 * Provides per-endpoint, per-IP rate limiting using a fixed window counter.
 * Each endpoint gets its own independent rate limit configuration.
 *
 * Algorithm: Fixed window counter. Each composite key "endpointId:ip" maps
 * to a { count, windowStart } entry. Requests within the window increment
 * the counter; when the window elapses the counter resets. If the counter
 * reaches maxRequests within a window the request is denied.
 *
 * Known limitation: a 2x burst is theoretically possible at the boundary
 * of two adjacent windows. Acceptable for these conservative limits.
 *
 * SINGLE-INSTANCE ONLY. This in-memory Map will not work in serverless
 * or multi-instance deployments. For production scaling, replace with
 * Redis or a distributed rate-limiting service.
 *
 * IP extraction is best-effort — headers can be spoofed. On Vercel,
 * x-forwarded-for is always present and trustworthy.
 */

import { NextRequest } from "next/server";

// ─── Types ────────────────────────────────────────────────────────────

/** Per-endpoint rate limit configuration. */
export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Internal tracking entry for a single IP + endpoint window. */
interface WindowEntry {
  count: number;
  windowStart: number; // timestamp in ms
}

// ─── State ────────────────────────────────────────────────────────────

/**
 * Module-level rate limit state. Key format: "endpointId:ip".
 * Single Map for all endpoints — cleanup sweeps everything in one pass.
 */
const windows = new Map<string, WindowEntry>();

/**
 * Entries older than this are certainly expired and safe to delete.
 * Set to the longest configured window (operatorLogin: 15 min).
 */
const CLEANUP_THRESHOLD_MS = 900_000;

// ─── Pre-configured Endpoint Limits ──────────────────────────────────

export const RATE_LIMITS = {
  /** POST /api/intake — 10 requests per 60 seconds */
  intake: { windowMs: 60_000, maxRequests: 10 } as const,
  /** POST /api/generate-pdf — 5 requests per 60 seconds */
  generatePdf: { windowMs: 60_000, maxRequests: 5 } as const,
  /** POST /api/operator/login — 5 requests per 15 minutes */
  operatorLogin: { windowMs: 900_000, maxRequests: 5 } as const,
} satisfies Record<string, RateLimitConfig>;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Extract the client IP address from request headers (best-effort).
 *
 * Priority:
 *   1. x-forwarded-for — leftmost value (client IP behind proxy)
 *   2. x-real-ip — single IP from reverse proxy
 *   3. "unknown" fallback
 *
 * Caveat: all three sources are spoofable by the client. This is
 * best-effort identification, not a security guarantee. On Vercel,
 * x-forwarded-for is set by the edge and cannot be spoofed.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  return "unknown";
}

/**
 * Check whether a request from the given IP to the given endpoint
 * is within rate limits.
 *
 * Mutates internal module state (increments counters, resets windows).
 * Runs opportunistic cleanup on every call.
 *
 * @param endpointId - Unique identifier for the endpoint (e.g. "intake")
 * @param ip - Client IP address from getClientIp()
 * @param config - Rate limit configuration for this endpoint
 * @returns Whether the request is allowed and, if not, how long to wait
 */
export function checkRateLimit(
  endpointId: string,
  ip: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const key = `${endpointId}:${ip}`;
  const now = Date.now();
  const entry = windows.get(key);

  // No entry or window expired — start a new window
  if (!entry || now - entry.windowStart >= config.windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Within window and under limit — allow
  if (entry.count < config.maxRequests) {
    entry.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Within window and at/over limit — deny
  const retryAfterMs = entry.windowStart + config.windowMs - now;
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return { allowed: false, retryAfterSeconds };
}

// ─── Internal ────────────────────────────────────────────────────────

/**
 * Remove all expired entries. Called opportunistically on every check.
 * Entries older than CLEANUP_THRESHOLD_MS are certainly expired
 * regardless of which endpoint they belong to.
 */
function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now - entry.windowStart > CLEANUP_THRESHOLD_MS) {
      windows.delete(key);
    }
  }
}

// ─── Test-Only ───────────────────────────────────────────────────────

/**
 * Clear all rate limit state. Test-only — call in beforeEach.
 * @internal
 */
export function _resetForTesting(): void {
  windows.clear();
}
