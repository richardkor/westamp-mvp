/**
 * POST /api/intake/[id]/extract
 *
 * Attempts to extract suggested tenancy details from the uploaded PDF.
 * Only works for tenancy-agreement records.
 *
 * Stores the extraction result (with nullable suggested fields) on the
 * job record. Records an extraction_completed event.
 *
 * All extracted values are UNVERIFIED SUGGESTIONS.
 * Does NOT auto-confirm values or advance the job status.
 *
 * If extraction finds nothing, returns a result with null fields and
 * fieldsExtracted: 0. This is not an error state.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { extractTenancyDetails } from "../../../../../lib/tenancy-extraction";
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

  // Only tenancy agreements are supported for extraction
  if (job.documentCategory !== "tenancy_agreement") {
    return Response.json(
      { error: "Extraction is only supported for tenancy-agreement documents." },
      { status: 400 }
    );
  }

  // Must have a stored file
  if (!job.storagePath) {
    return Response.json(
      { error: "No uploaded file found on this record." },
      { status: 400 }
    );
  }

  // Run extraction
  const result = await extractTenancyDetails(job.storagePath);

  // Persist result and record event
  const note =
    result.fieldsExtracted > 0
      ? `Extraction completed: ${result.fieldsExtracted} field(s) suggested from PDF`
      : "Extraction completed: no fields could be detected from PDF";

  const event = createEvent("extraction_completed", note);

  const updated = await updateJobOrConflict(id, {
    extractionResult: result,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
