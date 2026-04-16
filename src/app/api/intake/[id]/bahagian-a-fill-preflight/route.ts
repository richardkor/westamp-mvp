/**
 * POST /api/intake/[id]/bahagian-a-fill-preflight
 *
 * Evaluates the Bahagian A fill preflight for a job.
 *
 * Determines whether a first Bahagian A field-fill attempt could
 * later be internally eligible, based on the observed entry-state
 * and schema grounding quality.
 *
 * This route:
 * - Does NOT touch the live portal
 * - Does NOT fill any Bahagian A field
 * - Records a workflow event
 * - Persists the preflight result on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateBahagianAFillPreflight } from "../../../../../lib/stsds-bahagian-a-fill-preflight";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  const preflight = evaluateBahagianAFillPreflight(job);

  if (!preflight) {
    return Response.json(
      { error: "Cannot evaluate Bahagian A fill preflight — no routing suggestion exists." },
      { status: 400 }
    );
  }

  const eventNote =
    `Bahagian A fill preflight evaluated — status: ${preflight.status}, ` +
    `guard: ${preflight.guard.decision}, ` +
    `blocking: ${preflight.summary.blockingFailures}, ` +
    `advisory: ${preflight.summary.advisoryFailures}, ` +
    `grounded fields: ${preflight.fieldModeSummary.editableCount} editable / ` +
    `${preflight.fieldModeSummary.readOnlyCount} read-only / ` +
    `${preflight.fieldModeSummary.derivedCount} derived / ` +
    `${preflight.fieldModeSummary.unknownCount} unknown`;

  const event = createEvent("bahagian_a_fill_preflight_evaluated", eventNote);

  const updated = await updateJobOrConflict(id, {
    bahagianAFillPreflight: preflight,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
