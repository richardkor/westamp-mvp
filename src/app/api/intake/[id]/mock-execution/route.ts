/**
 * POST /api/intake/[id]/mock-execution
 *
 * Runs or re-runs the internal mock executor against the compiled
 * browser-instruction set for a stamping job.
 *
 * The mock executor deterministically simulates execution using the
 * precondition.met values already resolved by the instruction compiler.
 *
 * This does NOT interact with the live e-Duti Setem portal.
 * This does NOT execute any real browser automation.
 * This does NOT advance the job status.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runMockExecution } from "../../../../../lib/stsds-mock-executor";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (!job.browserInstructions) {
    return Response.json(
      {
        error:
          "No browser instructions available. Browser instructions must be compiled before running mock execution.",
      },
      { status: 400 }
    );
  }

  const mockExecution = runMockExecution(job);
  if (!mockExecution) {
    return Response.json(
      { error: "Unable to run mock execution from current job data." },
      { status: 400 }
    );
  }

  const isUpdate = !!job.mockExecution;
  const eventType = isUpdate
    ? "mock_execution_updated"
    : "mock_execution_created";
  const statusLabel =
    mockExecution.status === "ready_for_internal_review"
      ? "ready for internal review"
      : mockExecution.status === "review_required"
        ? "review required"
        : mockExecution.status === "blocked"
          ? "blocked"
          : mockExecution.status === "failed"
            ? "failed"
            : "not ready";
  const eventNote = isUpdate
    ? `Mock execution updated for ${mockExecution.lane} lane (${statusLabel})`
    : `Mock execution created for ${mockExecution.lane} lane (${statusLabel})`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    mockExecution,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
