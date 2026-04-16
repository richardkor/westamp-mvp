/**
 * POST /api/intake/[id]/save-attempt
 *
 * DEV/LOCAL ONLY — Performs the first Maklumat Am save attempt
 * against the real e-Duti Setem portal.
 *
 * This route:
 * - Requires the same environment gate as the portal probe
 * - Requires active non-stale save authorization
 * - Requires eligible save preflight
 * - Launches a real browser, replays Maklumat Am fills, clicks save
 * - Captures post-save evidence (screenshot, portal message)
 * - Stops immediately after the save outcome is observed
 * - Does NOT continue to the next tab
 * - Does NOT perform upload, payment, or submission
 *
 * NOT suitable for serverless/Vercel production deployment.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runMaklumatAmSaveAttempt } from "../../../../../lib/stsds-save-attempt";
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
  if (!job.saveAuthorization || job.saveAuthorization.status !== "active") {
    return Response.json(
      {
        error:
          "Active save authorization is required. " +
          "Issue save authorization before attempting the save.",
      },
      { status: 400 }
    );
  }

  if (!job.savePreflight || job.savePreflight.status !== "eligible") {
    return Response.json(
      {
        error:
          "Save preflight must be eligible. " +
          "Resolve all blocking and advisory issues before attempting the save.",
      },
      { status: 400 }
    );
  }

  // Run the save attempt
  let attempt;
  try {
    attempt = await runMaklumatAmSaveAttempt(job);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Save attempt failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  // Record event
  const eventType =
    attempt.status === "completed_with_stop"
      ? "save_attempt_completed"
      : attempt.status === "blocked"
        ? "save_attempt_blocked"
        : "save_attempt_failed";

  const outcomeLabel = attempt.evidence?.outcome ?? "not attempted";
  const eventNote =
    `Save attempt ${attempt.status} for ${attempt.lane} lane — ` +
    `outcome: ${outcomeLabel}, ` +
    `auth: ${attempt.authorizationWasActive ? "active" : "not active"}, ` +
    `preflight: ${attempt.preflightWasEligible ? "eligible" : "not eligible"}`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    saveAttempt: attempt,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
