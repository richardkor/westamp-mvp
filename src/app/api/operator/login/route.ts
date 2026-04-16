/**
 * POST /api/operator/login
 *
 * Validates the operator passphrase and sets a session cookie.
 * Uses Edge-compatible Web Crypto for HMAC signing.
 *
 * This is a minimal single-passphrase gate — not a user account system.
 */

import { NextRequest } from "next/server";
import { createSessionCookie, SESSION_MAX_AGE_SECONDS } from "../../../../lib/operator-session";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "../../../../lib/rate-limiter";

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit("operatorLogin", clientIp, RATE_LIMITS.operatorLogin);
  if (!rateCheck.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
    );
  }

  const passphrase = process.env.OPERATOR_PASSPHRASE;
  if (!passphrase) {
    return Response.json(
      { error: "Operator access not configured." },
      { status: 503 }
    );
  }

  let body: { passphrase?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }

  if (!body.passphrase || body.passphrase !== passphrase) {
    return Response.json(
      { error: "Invalid passphrase." },
      { status: 401 }
    );
  }

  const cookieValue = await createSessionCookie(passphrase);
  const isProduction = process.env.NODE_ENV === "production";

  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `operator_session=${cookieValue}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${isProduction ? "; Secure" : ""}`
  );

  return response;
}
