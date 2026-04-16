/**
 * POST /api/intake/[id]/save-preflight
 *
 * Evaluates the Maklumat Am save-boundary preflight for a stamping job.
 *
 * This route:
 * - Runs the pure save-preflight evaluator against the current job state
 * - Persists the result on the job record
 * - Records a workflow event
 * - Does NOT touch the live portal
 * - Does NOT perform any save action
 *
 * This is an internal readiness assessment only.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateMaklumatAmSavePreflight } from "../../../../../lib/stsds-save-preflight";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (!job.portalDraft) {
    return Response.json(
      {
        error:
          "No portal draft available. Create a portal draft before evaluating save preflight.",
      },
      { status: 400 }
    );
  }

  if (!job.routingSuggestion) {
    return Response.json(
      {
        error: "No routing suggestion available.",
      },
      { status: 400 }
    );
  }

  // Evaluate the save preflight
  const preflight = evaluateMaklumatAmSavePreflight(job);

  // Record event
  const statusLabel =
    preflight.status === "eligible"
      ? "internally eligible"
      : preflight.status === "blocking_issues"
        ? "blocking issues found"
        : preflight.status === "review_required"
          ? "review required"
          : "not ready";
  const guardLabel = preflight.mutationGuard.decision;
  const eventNote =
    `Save preflight evaluated for ${preflight.lane} lane — ${statusLabel}, ` +
    `guard: ${guardLabel}, ${preflight.summary.passedCount}/${preflight.summary.totalChecks} checks passed`;

  const event = createEvent("save_preflight_evaluated", eventNote);

  const updated = await updateJobOrConflict(id, {
    savePreflight: preflight,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
