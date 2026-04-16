/**
 * POST /api/intake/[id]/execute
 *
 * Creates and persists an execution attempt placeholder for a supported
 * tenancy job that already has a submission payload draft.
 *
 * Records an execution_attempt_initialized event.
 * Does NOT advance the job status.
 * Does NOT contact STSDS, MyTax, or any external system.
 * Does NOT invent LHDN reference numbers or certificate records.
 *
 * Idempotent: calling this again replaces the existing attempt with a
 * freshly timestamped placeholder.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { buildExecutionAttempt } from "../../../../../lib/execution-attempt";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Build execution attempt placeholder
  const result = buildExecutionAttempt(job);

  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 400 });
  }

  // Persist attempt and record event
  const event = createEvent(
    "execution_attempt_initialized",
    `Execution layer placeholder initialized (attempt ${result.attempt.attemptId})`
  );

  const updated = await updateJobOrConflict(id, {
    executionAttempt: result.attempt,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
