/**
 * POST /api/intake/[id]/submission-readiness
 *
 * Evaluates the internal portal submission readiness for a job.
 * This is an advisory-only assessment based on proven portal behaviour.
 * It does NOT submit anything to the portal.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateSubmissionReadiness } from "../../../../../lib/stsds-submission-readiness";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (!job.routingSuggestion) {
    return Response.json(
      { error: "No routing suggestion available. Route the job first." },
      { status: 400 }
    );
  }

  const readiness = evaluateSubmissionReadiness(job);

  if (!readiness) {
    return Response.json(
      { error: "Could not evaluate submission readiness." },
      { status: 400 }
    );
  }

  const event = createEvent(
    "submission_readiness_evaluated",
    `Submission readiness: ${readiness.status}. ` +
    `Proven blockers: ${readiness.provenBlockers.filter((b) => !b.satisfied).length} unsatisfied. ` +
    `Unresolved checks: ${readiness.unresolvedChecks.length}.`
  );

  const updated = await updateJobOrConflict(id, {
    submissionReadiness: readiness,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
