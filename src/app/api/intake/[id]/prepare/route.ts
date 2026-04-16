/**
 * POST /api/intake/[id]/prepare
 *
 * Validates eligibility and creates a preparation snapshot for a
 * tenancy-agreement stamping record. Advances status to "prepared".
 *
 * Only tenancy-agreement records at "intake_reviewed" status are eligible.
 * Other categories or statuses return 400.
 *
 * Does NOT submit to LHDN, does NOT collect payment, does NOT parse
 * the uploaded PDF.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { prepareForStamping } from "../../../../../lib/preparation-service";
import {
  shouldRouteToManualReview,
  createEvent,
  appendEvent,
} from "../../../../../lib/stamping-workflow";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Run eligibility checks and assemble snapshot
  const result = prepareForStamping(job);

  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 400 });
  }

  // Check if the job should be routed to manual review
  const reviewCheck = shouldRouteToManualReview(job);

  if (reviewCheck.required) {
    const event = createEvent(
      "moved_to_manual_review",
      reviewCheck.reason
    );
    const updated = await updateJobOrConflict(id, {
      preparationSnapshot: result.snapshot,
      status: "manual_review_required",
      notes: reviewCheck.reason,
      events: appendEvent(job.events, event),
    });

    if (updated instanceof Response) return updated;

    return Response.json(updated);
  }

  // Standard path: persist snapshot and advance status
  const prepEvent = createEvent("preparation_completed");
  const updated = await updateJobOrConflict(id, {
    preparationSnapshot: result.snapshot,
    status: "prepared",
    events: appendEvent(job.events, prepEvent),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
