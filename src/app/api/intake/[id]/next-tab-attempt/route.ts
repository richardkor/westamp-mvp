/**
 * POST /api/intake/[id]/next-tab-attempt
 *
 * DEV/LOCAL ONLY — Performs the first next-tab progression attempt
 * from Maklumat Am into Bahagian A against the real e-Duti Setem portal.
 *
 * This route:
 * - Requires the same environment gate as the portal probe/save-attempt
 * - Requires active non-stale next-tab authorization
 * - Requires eligible next-tab preflight
 * - Launches a real browser, replays Maklumat Am state, clicks next tab
 * - Captures post-click evidence (screenshot, portal message)
 * - Stops immediately after the post-click outcome is observed
 * - Does NOT fill any Bahagian A fields
 * - Does NOT click any further tabs
 * - Does NOT perform upload, payment, or submission
 *
 * NOT suitable for serverless/Vercel production deployment.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runNextTabProgressionAttempt } from "../../../../../lib/stsds-next-tab-attempt";
import { assertProbeAllowed } from "../../../../../lib/stsds-probe-guard";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = assertProbeAllowed();
  if (blocked) return blocked;

  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Pre-validate key requirements at the route level
  if (
    !job.nextTabAuthorization ||
    job.nextTabAuthorization.status !== "active"
  ) {
    return Response.json(
      {
        error:
          "Active next-tab authorization is required. " +
          "Issue next-tab authorization before attempting the progression.",
      },
      { status: 400 }
    );
  }

  if (
    !job.nextTabPreflight ||
    job.nextTabPreflight.status !== "eligible_for_later_attempt"
  ) {
    return Response.json(
      {
        error:
          "Next-tab preflight must be eligible. " +
          "Resolve all blocking issues before attempting the progression.",
      },
      { status: 400 }
    );
  }

  // Run the next-tab progression attempt
  let attempt;
  try {
    attempt = await runNextTabProgressionAttempt(job);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Next-tab attempt failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  // Record event
  const eventType =
    attempt.status === "completed_with_stop"
      ? "next_tab_attempt_completed"
      : attempt.status === "blocked"
        ? "next_tab_attempt_blocked"
        : "next_tab_attempt_failed";

  const outcomeLabel = attempt.evidence?.outcome ?? "not attempted";
  const eventNote =
    `Next-tab attempt ${attempt.status} — ` +
    `${attempt.fromTabKey} → ${attempt.toTabKey} (${attempt.toTabLabel}), ` +
    `outcome: ${outcomeLabel}, ` +
    `auth: ${attempt.authorizationWasActive ? "active" : "not active"}, ` +
    `preflight: ${attempt.preflightWasEligible ? "eligible" : "not eligible"}`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    nextTabAttempt: attempt,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
