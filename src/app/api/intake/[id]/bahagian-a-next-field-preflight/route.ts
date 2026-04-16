/**
 * POST /api/intake/[id]/bahagian-a-next-field-preflight
 *
 * Evaluates whether a future second Bahagian A field-fill attempt
 * could later be internally eligible, and identifies the preferred
 * next candidate field.
 *
 * This route:
 * - Is a pure evaluator — does NOT touch the live portal
 * - Does NOT fill any second field
 * - Does NOT save Bahagian A
 * - Does NOT continue beyond Bahagian A
 * - Records a workflow event
 * - Persists the preflight on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateBahagianANextFieldPreflight } from "../../../../../lib/stsds-bahagian-a-next-field-preflight";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Evaluate the next-field preflight
  const preflight = evaluateBahagianANextFieldPreflight(job);

  if (!preflight) {
    return Response.json(
      {
        error:
          "Cannot evaluate next-field preflight: no routing suggestion exists.",
      },
      { status: 400 }
    );
  }

  // Record event
  const eventNote =
    `Bahagian A next-field preflight evaluated — ` +
    `status: ${preflight.status}, ` +
    `guard: ${preflight.guard.decision}, ` +
    `remaining candidates: ${preflight.remainingCandidateCount}, ` +
    `next candidate: "${preflight.nextCandidate?.labelText ?? "none"}"`;

  const event = createEvent(
    "bahagian_a_next_field_preflight_evaluated",
    eventNote
  );

  const updated = await updateJobOrConflict(id, {
    bahagianANextFieldPreflight: preflight,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
