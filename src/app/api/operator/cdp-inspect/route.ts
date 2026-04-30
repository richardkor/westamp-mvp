/**
 * POST /api/operator/cdp-inspect
 *
 * Read-only operator-protected route that runs a single CDP-attach
 * cycle against the operator's local Chrome and returns a sanitized
 * `SupervisedSessionReport`.
 *
 * Auth: handled by the existing operator middleware
 * (`src/middleware.ts`) — every request to this path requires a
 * valid `operator_session` cookie. If the cookie is missing or
 * invalid the middleware returns `401` and this route never runs.
 *
 * Inputs (JSON body):
 *   - targetPhaseId? : optional canonical instruction-graph phase
 *                      id used to compute phase compatibility on
 *                      the inspected page.
 *
 * Output:
 *   - 200 with `{ ok: true, report }` on success (including the
 *     `cdp_unreachable` case, which is a legitimate read-only
 *     finding).
 *   - 200 with `{ ok: false, error }` on input-validation failures
 *     and on unexpected inspector throws. The error string is one
 *     of the fixed-vocabulary messages from the route helper —
 *     never a raw Playwright stack trace, never a portal URL.
 *
 * Read-only invariants:
 *   - The route never clicks, fills, types, selects, uploads,
 *     submits, or saves anything via Playwright.
 *   - The route never reads cookies, storage state, tokens, or
 *     `lhdnmsstoken`.
 *   - The route never persists anything.
 *
 * The actual work is delegated to `handleCdpInspectRequest` so the
 * read-only contract is testable without booting a real Chrome.
 */

import { NextRequest } from "next/server";
import { handleCdpInspectRequest } from "../../../../lib/tenancy-supervised-session-route";

// Force Node.js runtime — Playwright's CDP attach is server-only and
// not Edge-compatible. Force-dynamic so this never runs at build time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await handleCdpInspectRequest({
    body,
    envCdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
  });
  return Response.json(result);
}
