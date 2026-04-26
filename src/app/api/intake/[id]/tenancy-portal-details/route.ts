/**
 * POST /api/intake/[id]/tenancy-portal-details
 *
 * Operator-only update path for the structured tenancy-portal
 * required-details block (`tenancyPortalDetails`) on a stamping job.
 * Gated by `src/middleware.ts` under the `/api/intake/:path*` matcher,
 * so it is reachable only with a valid `operator_session` cookie.
 *
 * Accepts the full `TenancyPortalDetails` shape (parties, optional
 * instrument, optional property, optional operator note). The route
 * validates the shape via
 * `validateTenancyPortalDetailsInput` from
 * `src/lib/tenancy-portal-requirements.ts` and persists the
 * normalised value, stamping `updatedAt` server-side.
 *
 * Does NOT
 * ────────
 * - submit anything to e-Duti Setem
 * - touch fulfilment state, payment, certificate, or main job status
 * - change the public receipt status
 * - change the duty calculation
 * - touch tenancy template / generation files
 *
 * Eligibility
 * ───────────
 * - Job must exist (404 if not).
 * - Job's `documentCategory` must be `tenancy_agreement` (400 otherwise).
 * - Body must validate per `validateTenancyPortalDetailsInput`.
 */

import { NextRequest } from "next/server";
import {
  getJob,
  updateJobOrConflict,
} from "../../../../../lib/stamping-store";
import {
  appendEvent,
  createEvent,
} from "../../../../../lib/stamping-workflow";
import { validateTenancyPortalDetailsInput } from "../../../../../lib/tenancy-portal-requirements";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
          "Tenancy portal details apply only to tenancy-agreement jobs.",
      },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validated = validateTenancyPortalDetailsInput(body);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const tenancyPortalDetails = validated.value;
  const event = createEvent(
    "tenancy_portal_details_updated",
    `Tenancy portal details saved (${tenancyPortalDetails.parties.length} parties${
      tenancyPortalDetails.instrument ? ", instrument captured" : ""
    }${tenancyPortalDetails.property ? ", property captured" : ""}).`
  );

  const result = await updateJobOrConflict(id, {
    tenancyPortalDetails,
    events: appendEvent(job.events, event),
  });
  if (result instanceof Response) return result;

  return Response.json({
    id: result.id,
    tenancyPortalDetails: result.tenancyPortalDetails ?? null,
  });
}
