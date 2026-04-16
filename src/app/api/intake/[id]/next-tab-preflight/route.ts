/**
 * POST /api/intake/[id]/next-tab-preflight
 *
 * Evaluates the next-tab progression preflight for a job that has
 * a completed save attempt and post-save reconciliation.
 *
 * Determines whether the immediate next tab after Maklumat Am is
 * internally eligible for a later guarded progression attempt.
 *
 * Does NOT click the next tab or perform any portal mutation.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateNextTabProgressionPreflight } from "../../../../../lib/stsds-next-tab-preflight";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Require routing suggestion
  if (!job.routingSuggestion) {
    return Response.json(
      { error: "No routing suggestion exists on this record." },
      { status: 400 }
    );
  }

  // Evaluate preflight
  const preflight = evaluateNextTabProgressionPreflight(job);

  if (!preflight) {
    return Response.json(
      { error: "Next-tab progression preflight could not be evaluated." },
      { status: 500 }
    );
  }

  // Record event
  const nextTabDesc = preflight.nextTabObservedState.expectedNextTabLabel
    ? `${preflight.nextTabObservedState.expectedNextTabLabel} (${preflight.nextTabObservedState.expectedNextTabKey})`
    : "unknown";

  const eventNote =
    `Next-tab preflight: ${preflight.status} — ` +
    `next tab: ${nextTabDesc}, ` +
    `guard: ${preflight.guard.decision}, ` +
    `checks: ${preflight.summary.passedCount}/${preflight.summary.totalChecks} passed`;

  const event = createEvent("next_tab_preflight_evaluated", eventNote);

  const updated = await updateJobOrConflict(id, {
    nextTabPreflight: preflight,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
