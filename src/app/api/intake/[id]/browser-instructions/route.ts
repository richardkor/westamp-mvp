/**
 * POST /api/intake/[id]/browser-instructions
 *
 * Compiles or updates the internal browser-automation instruction set
 * for a stamping job.
 *
 * The instruction set is the adapter contract a future browser driver
 * would consume to execute the automation plan against the portal.
 *
 * This does NOT interact with the live e-Duti Setem portal.
 * This does NOT execute any browser automation.
 * This does NOT advance the job status.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { compileStsdsBrowserInstructions } from "../../../../../lib/stsds-browser-instructions";

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
          "No routing suggestion available. A routing suggestion must be saved before compiling browser instructions.",
      },
      { status: 400 }
    );
  }

  const browserInstructions = compileStsdsBrowserInstructions(job);
  if (!browserInstructions) {
    return Response.json(
      { error: "Unable to compile browser instructions from current job data." },
      { status: 400 }
    );
  }

  const isUpdate = !!job.browserInstructions;
  const eventType = isUpdate
    ? "browser_instructions_updated"
    : "browser_instructions_compiled";
  const statusLabel =
    browserInstructions.status === "ready_for_internal_review"
      ? "ready for internal review"
      : browserInstructions.status === "review_required"
        ? "review required"
        : browserInstructions.status === "blocked"
          ? "blocked"
          : "not ready";
  const eventNote = isUpdate
    ? `Browser instructions updated for ${browserInstructions.lane} lane (${statusLabel})`
    : `Browser instructions compiled for ${browserInstructions.lane} lane (${statusLabel})`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    browserInstructions,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
