/**
 * GET /api/receipt/[id]?token=<receiptToken>
 *
 * Public-safe receipt API for stamping jobs.
 *
 * Returns only a minimal public-facing subset of job data.
 * Requires an unguessable receipt token — job ID alone is never enough.
 * Legacy jobs without a receipt token fail closed (403).
 *
 * Does NOT expose internal STSDS state, fulfilment internals, events,
 * payment references, adjudication numbers, or internal ops notes.
 */

import { NextRequest } from "next/server";
import { getJob } from "../../../../lib/stamping-store";
import { DOCUMENT_CATEGORY_LABELS } from "../../../../lib/stamping-types";
import { derivePublicStatus } from "../../../../lib/public-status";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token");

  // Token is always required
  if (!token) {
    return Response.json(
      { error: "Access denied." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const job = await getJob(id);

  if (!job) {
    return Response.json(
      { error: "Access denied." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  // Legacy jobs fail closed — no receiptToken means no public access
  if (!job.receiptToken) {
    return Response.json(
      { error: "Access denied." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  // Token must match
  if (job.receiptToken !== token) {
    return Response.json(
      { error: "Access denied." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  // Return safe public-only subset
  const publicStatus = derivePublicStatus({
    status: job.status,
    fulfilmentState: job.fulfilmentState
      ? {
          delivered: job.fulfilmentState.delivered,
          certificateStatus: job.fulfilmentState.certificateStatus,
          paymentStatus: job.fulfilmentState.paymentStatus,
        }
      : null,
  });

  // Certificate is downloadable only when delivered + certificate file exists
  const certificateReady =
    job.fulfilmentState?.delivered === true &&
    typeof job.fulfilmentState?.certificateStoragePath === "string" &&
    job.fulfilmentState.certificateStoragePath.length > 0;

  return Response.json(
    {
      id: job.id,
      originalFileName: job.originalFileName,
      documentCategory: job.documentCategory,
      categoryLabel:
        DOCUMENT_CATEGORY_LABELS[job.documentCategory] ??
        job.documentCategory,
      createdAt: job.createdAt,
      publicStatus,
      certificateReady,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
