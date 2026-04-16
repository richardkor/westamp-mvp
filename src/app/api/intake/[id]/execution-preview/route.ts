/**
 * POST /api/intake/[id]/execution-preview
 *
 * Compiles an internal execution preview from current job state.
 * This is an internal compiled view — NOT a live portal interaction.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { compileExecutionPreview } from "../../../../../lib/stsds-execution-preview";

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
      { error: "No routing suggestion available." },
      { status: 400 }
    );
  }

  const preview = compileExecutionPreview(job);

  if (!preview) {
    return Response.json(
      { error: "Could not compile execution preview." },
      { status: 400 }
    );
  }

  const event = createEvent(
    "execution_preview_compiled",
    `Execution preview compiled: status=${preview.status}, ` +
    `inputs=${preview.intendedInputs.length}, ` +
    `targets=${preview.validationTargets.length}, ` +
    `unresolved=${preview.unresolvedSteps.length}.`
  );

  const updated = await updateJobOrConflict(id, {
    executionPreview: preview,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
