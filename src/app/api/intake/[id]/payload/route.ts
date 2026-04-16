/**
 * POST /api/intake/[id]/payload
 *
 * Assembles and persists a submission payload draft for a supported
 * tenancy-agreement job in ready_for_submission status.
 *
 * Records a submission_payload_drafted event.
 * Does NOT advance the job status.
 * Does NOT submit to STSDS, MyTax, or any external system.
 *
 * Idempotent: calling this again on a job that already has a payload
 * overwrites the draft with a freshly timestamped one.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { buildSubmissionPayload } from "../../../../../lib/submission-payload";
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

  // Assemble payload draft
  const result = buildSubmissionPayload(job);

  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 400 });
  }

  // Persist payload and record event
  const event = createEvent(
    "submission_payload_drafted",
    `Submission payload draft created for job ${id}`
  );

  const updated = await updateJobOrConflict(id, {
    submissionPayload: result.payload,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
