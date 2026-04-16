/**
 * POST /api/intake/[id]/bahagian-a-grounding
 *
 * DEV/LOCAL ONLY — Captures the Bahagian A entry-state and grounds
 * observed fields against the existing portal schema.
 *
 * This route:
 * - Requires the same environment gate as the portal probe/save-attempt
 * - Requires active, non-stale next-tab authorization
 * - Requires eligible next-tab preflight
 * - Requires a completed prior next-tab attempt into Bahagian A
 * - Launches a real browser, progresses to Bahagian A, observes fields
 * - Captures a screenshot of the entry-state
 * - Grounds observed fields against the schema
 * - Persists the result separately on the job record
 * - Does NOT fill any Bahagian A field
 * - Does NOT continue beyond Bahagian A
 *
 * NOT suitable for serverless/Vercel production deployment.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { captureBahagianAEntryState } from "../../../../../lib/stsds-bahagian-a-grounding";
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

  // Pre-validate: this route performs a fresh live progression, so it
  // requires the same strict boundary as the next-tab attempt itself.
  // A historical completed next-tab attempt alone is NOT sufficient.

  // Require active next-tab authorization
  if (
    !job.nextTabAuthorization ||
    job.nextTabAuthorization.status !== "active"
  ) {
    return Response.json(
      {
        error:
          "Active next-tab authorization is required. " +
          "Issue next-tab authorization before capturing Bahagian A entry-state.",
      },
      { status: 400 }
    );
  }

  // Require eligible next-tab preflight
  if (
    !job.nextTabPreflight ||
    job.nextTabPreflight.status !== "eligible_for_later_attempt"
  ) {
    return Response.json(
      {
        error:
          "Next-tab preflight must be eligible. " +
          "Resolve all blocking issues before capturing Bahagian A entry-state.",
      },
      { status: 400 }
    );
  }

  // Require completed prior next-tab attempt into Bahagian A
  if (!job.nextTabAttempt) {
    return Response.json(
      {
        error:
          "A completed next-tab attempt into Bahagian A is required. " +
          "Perform the next-tab progression attempt first.",
      },
      { status: 400 }
    );
  }

  if (job.nextTabAttempt.status !== "completed_with_stop") {
    return Response.json(
      {
        error:
          `Next-tab attempt status is "${job.nextTabAttempt.status}" — ` +
          "must be \"completed_with_stop\".",
      },
      { status: 400 }
    );
  }

  if (job.nextTabAttempt.toTabKey !== "bahagian_a") {
    return Response.json(
      {
        error:
          `Next-tab attempt target was "${job.nextTabAttempt.toTabKey}" — ` +
          "expected \"bahagian_a\".",
      },
      { status: 400 }
    );
  }

  // Run the Bahagian A entry-state capture
  let entryState;
  try {
    entryState = await captureBahagianAEntryState(job);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Bahagian A grounding failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  // Record event
  const eventType =
    entryState.tabObserved
      ? "bahagian_a_grounding_completed"
      : "bahagian_a_grounding_failed";

  const eventNote =
    `Bahagian A entry-state ${entryState.tabObserved ? "observed" : "not observed"} — ` +
    `${entryState.summary.totalObservedFields} fields observed, ` +
    `${entryState.summary.groundedCount} grounded, ` +
    `${entryState.summary.unmatchedObservedCount} unmatched, ` +
    `${entryState.summary.expectedButNotObservedCount} expected-but-missing — ` +
    `status: ${entryState.status}`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    bahagianAEntryState: entryState,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
