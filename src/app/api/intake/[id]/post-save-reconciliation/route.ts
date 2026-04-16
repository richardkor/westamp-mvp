/**
 * POST /api/intake/[id]/post-save-reconciliation
 *
 * Evaluates the post-save reconciliation for a job that has a
 * completed save attempt. Classifies the stop state, checks for
 * blocking/advisory issues, and records the reconciliation result.
 *
 * Does NOT perform any portal mutation or continuation.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluatePostSaveReconciliation } from "../../../../../lib/stsds-post-save-reconciliation";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Require a save attempt to exist
  if (!job.saveAttempt) {
    return Response.json(
      {
        error:
          "No save attempt exists on this record. " +
          "Perform a save attempt before evaluating post-save reconciliation.",
      },
      { status: 400 }
    );
  }

  // Evaluate reconciliation
  const reconciliation = evaluatePostSaveReconciliation(job);

  if (!reconciliation) {
    return Response.json(
      { error: "Post-save reconciliation could not be evaluated." },
      { status: 500 }
    );
  }

  // Record event
  const eventNote =
    `Post-save reconciliation: ${reconciliation.status} — ` +
    `outcome: ${reconciliation.outcome}, ` +
    `stop reason: ${reconciliation.stopReason}, ` +
    `checks: ${reconciliation.summary.passedCount}/${reconciliation.summary.totalChecks} passed`;

  const event = createEvent("post_save_reconciliation_evaluated", eventNote);

  const updated = await updateJobOrConflict(id, {
    postSaveReconciliation: reconciliation,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
