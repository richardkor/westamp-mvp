/**
 * WeStamp — STSDS Probe/Attempt Guard
 *
 * Centralized allow-condition for local/dev-only STSDS probe and
 * automation-attempt routes (portal probe, save attempt, bahagian-a
 * grounding, bahagian-a fill attempt, next-tab attempt).
 *
 * These actions launch Playwright, write artifacts to local filesystem
 * (data/portal-probe-artifacts/), and interact with the live LHDN STSDS
 * portal. They must NEVER run in deployed/production environments.
 *
 * Allow condition (all must be true):
 *   1. NODE_ENV is NOT "production"
 *   2. ENABLE_STSDS_PORTAL_PROBE is explicitly set to "true"
 *
 * Returns null if allowed, or a pre-built 403 Response if blocked.
 * Routes call this at the very top of the handler and return early
 * if blocked: `const blocked = assertProbeAllowed(); if (blocked) return blocked;`
 */

/**
 * Check whether STSDS probe/attempt actions are allowed in the current
 * environment. Returns null if allowed, or a 403 Response if blocked.
 */
export function assertProbeAllowed(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      {
        error:
          "This action is local/dev only and is not available in this environment.",
      },
      { status: 403 }
    );
  }

  if (process.env.ENABLE_STSDS_PORTAL_PROBE !== "true") {
    return Response.json(
      {
        error:
          "STSDS probe/attempt actions are not enabled. " +
          "Set ENABLE_STSDS_PORTAL_PROBE=true in your local environment.",
      },
      { status: 403 }
    );
  }

  return null;
}
