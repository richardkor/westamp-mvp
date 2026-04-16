/**
 * Operator Session — Edge-Compatible Cookie Helper
 *
 * Creates and verifies operator session cookies using Web Crypto API only.
 * Compatible with Next.js Edge middleware runtime.
 *
 * Cookie value format: <timestamp>.<hex-signature>
 * Signature = HMAC-SHA256(timestamp, passphrase)
 *
 * Session lifetime: 8 hours from creation. Server-side enforcement —
 * the timestamp is checked on every verification, not just at login.
 * Browser cookie Max-Age is set to match, but server-side check is
 * the source of truth.
 */

/** Maximum operator session lifetime in milliseconds (8 hours). */
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** Maximum operator session lifetime in seconds (for cookie Max-Age). */
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;

const ENCODER = new TextEncoder();

async function hmacSign(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    ENCODER.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Creates a session cookie value: <timestamp>.<signature>
 */
export async function createSessionCookie(passphrase: string): Promise<string> {
  const timestamp = Date.now().toString();
  const signature = await hmacSign(timestamp, passphrase);
  return `${timestamp}.${signature}`;
}

/**
 * Verifies a session cookie value against the passphrase.
 *
 * Returns true only if:
 *   1. Cookie format is valid (<timestamp>.<signature>)
 *   2. Timestamp parses as a finite number
 *   3. Timestamp is not in the future (with 60s tolerance for clock skew)
 *   4. Session age does not exceed SESSION_MAX_AGE_MS
 *   5. HMAC signature matches
 *
 * Any malformed, expired, or suspicious value returns false.
 */
export async function verifySessionCookie(
  cookieValue: string,
  passphrase: string
): Promise<boolean> {
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) return false;

  const timestampStr = cookieValue.slice(0, dotIndex);
  const providedSig = cookieValue.slice(dotIndex + 1);

  if (!timestampStr || !providedSig) return false;

  // Timestamp must be a finite number
  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;

  const now = Date.now();

  // Reject future timestamps (allow 60s tolerance for clock skew)
  if (timestamp > now + 60_000) return false;

  // Reject expired sessions
  if (now - timestamp > SESSION_MAX_AGE_MS) return false;

  // Verify HMAC signature
  const expectedSig = await hmacSign(timestampStr, passphrase);
  return expectedSig === providedSig;
}
