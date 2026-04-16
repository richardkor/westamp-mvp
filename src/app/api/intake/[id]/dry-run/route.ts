/**
 * POST /api/intake/[id]/dry-run
 *
 * Runs or updates the internal dry-run evaluation for a stamping job.
 *
 * The dry-run evaluates the existing automation plan and portal draft
 * against the portal schema to determine internal execution readiness.
 *
 * This does NOT interact with the live e-Duti Setem portal.
 * This does NOT execute any browser automation.
 * This does NOT advance the job status.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runStsdsDryRun } from "../../../../../lib/stsds-dry-run";

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
          "No routing suggestion available. A routing suggestion must be saved before running a dry-run evaluation.",
      },
      { status: 400 }
    );
  }

  const dryRun = runStsdsDryRun(job);
  if (!dryRun) {
    return Response.json(
      { error: "Unable to run dry-run evaluation from current job data." },
      { status: 400 }
    );
  }

  const isUpdate = !!job.dryRun;
  const eventType = isUpdate ? "dry_run_updated" : "dry_run_created";
  const statusLabel =
    dryRun.status === "ready_for_internal_review"
      ? "ready for internal review"
      : dryRun.status === "review_required"
        ? "review required"
        : dryRun.status === "blocked"
          ? "blocked"
          : "not ready";
  const eventNote = isUpdate
    ? `Dry-run evaluation updated for ${dryRun.lane} lane (${statusLabel})`
    : `Dry-run evaluation created for ${dryRun.lane} lane (${statusLabel})`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    dryRun,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
