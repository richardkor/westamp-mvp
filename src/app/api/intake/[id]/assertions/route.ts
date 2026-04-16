/**
 * POST /api/intake/[id]/assertions
 *
 * Builds a mock portal-state snapshot from the current job's internal
 * draft state, evaluates all registered portal assertions, and persists
 * the assertion evaluation result on the job record.
 *
 * This does NOT interact with the live e-Duti Setem portal.
 * This does NOT execute any browser automation.
 * This does NOT advance the job status.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  buildMockSnapshot,
  evaluatePortalAssertions,
} from "../../../../../lib/stsds-assertions";

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
      {
        error:
          "No routing suggestion available. A routing suggestion must be saved before evaluating assertions.",
      },
      { status: 400 }
    );
  }

  if (!job.portalDraft) {
    return Response.json(
      {
        error:
          "No portal draft available. A portal draft must be created before evaluating assertions.",
      },
      { status: 400 }
    );
  }

  const snapshot = buildMockSnapshot(job);
  if (!snapshot) {
    return Response.json(
      { error: "Unable to build portal-state snapshot from current job data." },
      { status: 400 }
    );
  }

  const assertionEvaluation = evaluatePortalAssertions(job, snapshot);
  if (!assertionEvaluation) {
    return Response.json(
      { error: "Unable to evaluate portal assertions from current job data." },
      { status: 400 }
    );
  }

  const isUpdate = !!job.assertionEvaluation;
  const eventType = isUpdate
    ? "assertion_evaluation_updated"
    : "assertion_evaluation_created";
  const statusLabel =
    assertionEvaluation.status === "ready_for_internal_review"
      ? "ready for internal review"
      : assertionEvaluation.status === "blocking_mismatches"
        ? "blocking mismatches found"
        : assertionEvaluation.status === "advisory_mismatches"
          ? "advisory mismatches found"
          : "not ready";
  const eventNote = isUpdate
    ? `Assertion evaluation updated for ${assertionEvaluation.lane} lane (${statusLabel})`
    : `Assertion evaluation created for ${assertionEvaluation.lane} lane (${statusLabel})`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    assertionEvaluation,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
