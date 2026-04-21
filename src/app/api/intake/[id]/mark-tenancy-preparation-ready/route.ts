/**
 * POST /api/intake/[id]/mark-tenancy-preparation-ready
 *
 * Operator-only action that marks a tenancy job as internally ready for
 * preparation ("Preparation review complete").
 *
 * This is a WeStamp-internal workflow marker. It does NOT submit to any
 * external portal, does NOT call e-Duti Setem, does NOT initiate payment
 * or certificate retrieval, and does NOT advance the job into any
 * submission-track status. It only persists `tenancyPreparationReadiness`
 * on the job and appends a `tenancy_preparation_marked_ready` event.
 *
 * Operator-gated by middleware (`/api/intake/:path*`).
 * Tenancy-agreement jobs only.
 *
 * Preconditions:
 *   - documentCategory === "tenancy_agreement"
 *   - confirmedTenancyInputs must exist (the extraction review must have
 *     been completed before the operator can mark the job ready)
 *
 * Idempotency:
 *   - If the job is already marked ready, returns 409 without mutating
 *     state — keeps the event log meaningful.
 *
 * Request body: no fields required. An empty `{}` is acceptable.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { TenancyPreparationReadiness } from "../../../../../lib/stamping-types";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (job.documentCategory !== "tenancy_agreement") {
    return Response.json(
      {
        error:
          "Marking preparation review complete is only supported for tenancy-agreement documents.",
      },
      { status: 400 },
    );
  }

  if (!job.confirmedTenancyInputs) {
    return Response.json(
      {
        error:
          "Confirm or override the extracted tenancy values before marking preparation review complete.",
      },
      { status: 400 },
    );
  }

  if (job.tenancyPreparationReadiness) {
    return Response.json(
      { error: "This job is already marked as preparation review complete." },
      { status: 409 },
    );
  }

  const readiness: TenancyPreparationReadiness = {
    markedReadyAt: new Date().toISOString(),
    source: "operator_marked",
    basis: {
      hasExtraction: !!job.extractionResult,
      hasConfirmedInputs: true,
      reviewStatus: job.confirmedTenancyInputs.reviewStatus,
    },
  };

  const event = createEvent(
    "tenancy_preparation_marked_ready",
    `Preparation review complete (confirmed inputs: ${job.confirmedTenancyInputs.reviewStatus}).`,
  );

  const updated = await updateJobOrConflict(id, {
    tenancyPreparationReadiness: readiness,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
