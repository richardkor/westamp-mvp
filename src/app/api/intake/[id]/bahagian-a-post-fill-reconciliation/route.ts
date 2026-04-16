/**
 * POST /api/intake/[id]/bahagian-a-post-fill-reconciliation
 *
 * Evaluates the immediate post-fill reconciliation for the first
 * Bahagian A single-field fill attempt.
 *
 * This route:
 * - Is a pure evaluator — does NOT touch the live portal
 * - Does NOT fill any second field
 * - Does NOT save Bahagian A
 * - Does NOT continue beyond Bahagian A
 * - Records a workflow event
 * - Persists the reconciliation on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateBahagianAFirstFieldPostFillReconciliation } from "../../../../../lib/stsds-bahagian-a-post-fill-reconciliation";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Require a fill attempt to exist before reconciliation
  if (!job.bahagianAFillAttempt) {
    return Response.json(
      {
        error:
          "No Bahagian A fill attempt exists. " +
          "Perform a fill attempt before evaluating post-fill reconciliation.",
      },
      { status: 400 }
    );
  }

  // Evaluate the reconciliation
  const reconciliation =
    evaluateBahagianAFirstFieldPostFillReconciliation(job);

  // Record event
  const eventNote =
    `Bahagian A post-fill reconciliation evaluated — ` +
    `status: ${reconciliation.status}, ` +
    `outcome: ${reconciliation.outcome}, ` +
    `stop reason: ${reconciliation.stopReason}, ` +
    `target: "${reconciliation.targetField?.labelText ?? "unknown"}", ` +
    `readback match: ${reconciliation.readbackMatch ?? "unknown"}`;

  const event = createEvent(
    "bahagian_a_post_fill_reconciliation_evaluated",
    eventNote
  );

  const updated = await updateJobOrConflict(id, {
    bahagianAPostFillReconciliation: reconciliation,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
