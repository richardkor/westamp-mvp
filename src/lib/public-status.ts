/**
 * Public Status Mapping
 *
 * Derives a safe, restrained public-facing status label from internal
 * job state. Used only by public receipt routes — never exposes raw
 * internal status names, fulfilment internals, or STSDS state.
 *
 * Priority: fulfilment lifecycle fields checked first (most specific
 * wins), then job status fallback. Evaluated top-to-bottom.
 */

export type PublicStatus =
  | "Received"
  | "Awaiting Payment"
  | "In Progress"
  | "Under Review"
  | "Completed";

interface PublicStatusInput {
  status: string;
  fulfilmentState?: {
    delivered?: boolean;
    certificateStatus?: string;
    paymentStatus?: string;
  } | null;
}

/**
 * Derives a safe public status label from internal job state.
 * Conservative fallback: "Received".
 */
export function derivePublicStatus(job: PublicStatusInput): PublicStatus {
  const fs = job.fulfilmentState;

  // Rule 1: delivered is the ONLY path to Completed
  if (fs?.delivered === true) return "Completed";

  // Rule 2: certificate_retrieved but not delivered
  if (fs?.certificateStatus === "certificate_retrieved") return "In Progress";

  // Rule 3: waiting_for_certificate
  if (fs?.certificateStatus === "waiting_for_certificate") return "In Progress";

  // Rule 4: payment_marked_done (post-payment, pre-certificate fallback)
  if (fs?.paymentStatus === "payment_marked_done") return "In Progress";

  // Rule 5: awaiting_payment
  if (fs?.paymentStatus === "awaiting_payment") return "Awaiting Payment";

  // Rule 6: manual review
  if (job.status === "manual_review_required") return "Under Review";

  // Rule 7: failed
  if (job.status === "failed") return "Under Review";

  // Rule 8: conservative default
  return "Received";
}
