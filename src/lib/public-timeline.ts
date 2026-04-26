/**
 * Public-Facing Progress Timeline Derivation
 *
 * Builds a calm, lane-agnostic progress timeline from a stamping job's
 * sanitised inputs. Used only by public receipt routes — never exposes
 * raw internal status names, fulfilment internals, STSDS state, or the
 * nominal-duty lifecycle vocabulary.
 *
 * The shape is intentionally identical across Tenancy Agreement,
 * Employment Contract, Statutory Declaration, and Other / Not Sure.
 * Steps that don't apply to a given job's current state are marked
 * neutrally as "upcoming" rather than removed, so the public timeline
 * looks consistent regardless of category and never communicates that
 * a step is "missing".
 *
 * This module mirrors the safety posture of `public-status.ts`:
 * minimal allowed inputs, conservative fallbacks, no leakage of
 * internal jargon.
 */

/** Step keys are stable enum strings — safe to expose; no jargon. */
export type PublicTimelineStepKey =
  | "received"
  | "under_review"
  | "awaiting_confirmation"
  | "awaiting_payment"
  | "stamping_in_progress"
  | "completed";

/**
 * Per-step state. "done" / "current" / "upcoming" — no "skipped",
 * because the timeline is meant to look consistent and a missing
 * step would feel like a gap rather than a calm "not yet".
 */
export type PublicTimelineStepState = "done" | "current" | "upcoming";

export interface PublicTimelineStep {
  /** Stable key for styling / keying. No internal jargon. */
  key: PublicTimelineStepKey;
  /** Public-safe label. */
  label: string;
  /** Current state of this step. */
  state: PublicTimelineStepState;
  /** Optional one-line public-safe sub-note. */
  description?: string;
}

/**
 * Allowed inputs. Minimal sanitised subset of the underlying job —
 * this module deliberately accepts only what it needs and trusts
 * nothing else. Aligned with `derivePublicStatus`'s input style.
 */
export interface PublicTimelineInput {
  /** Internal job status (NOT exposed in output). */
  status: string;
  /** True only if there is a stored `fulfilmentState` on the job. */
  hasFulfilmentState: boolean;
  /** Sanitised fulfilment-state subset, or null. */
  fulfilmentState?: {
    delivered?: boolean;
    certificateStatus?: string;
    paymentStatus?: string;
  } | null;
  /**
   * Internal nominal-duty lifecycle state. NOT exposed in output —
   * used only as a hint for which step is "current" on registry
   * categories. Pass `null` for tenancy / other.
   */
  nominalDutyState?:
    | "received"
    | "under_review"
    | "awaiting_user"
    | "external_portal_in_progress"
    | "completed"
    | "cannot_proceed"
    | null;
}

/** Standard label set. Public copy only — no internal vocabulary. */
const STEP_LABELS: Record<PublicTimelineStepKey, string> = {
  received: "Document received",
  under_review: "Details under review",
  awaiting_confirmation: "Awaiting your confirmation",
  awaiting_payment: "Awaiting payment",
  stamping_in_progress: "Stamping in progress",
  completed: "Completed",
};

/**
 * Build the public-facing timeline.
 *
 * Logic priority is highest-truth-first: any explicit fulfilment fact
 * (delivered, certificate retrieved, payment recorded) outranks any
 * lifecycle hint. The lifecycle state is consulted only to decide
 * whether the early "under review" step is "done" vs "current", and
 * whether the "awaiting your confirmation" step should be highlighted.
 *
 * Conservative fallback for any unknown shape: every step is
 * "upcoming" except `received`, which is `done` whenever this
 * function is called (a job cannot have a public receipt without
 * having been received).
 */
export function derivePublicTimeline(
  input: PublicTimelineInput
): PublicTimelineStep[] {
  const fs = input.fulfilmentState ?? null;
  const nd = input.nominalDutyState ?? null;
  const delivered = fs?.delivered === true;
  const paymentDone = fs?.paymentStatus === "payment_marked_done";
  const awaitingPayment = fs?.paymentStatus === "awaiting_payment";
  const certRetrieved = fs?.certificateStatus === "certificate_retrieved";
  const waitingForCert = fs?.certificateStatus === "waiting_for_certificate";

  // ── Step: Document received ─────────────────────────────────────
  // Always done at the moment a public receipt exists.
  const received: PublicTimelineStep = {
    key: "received",
    label: STEP_LABELS.received,
    state: "done",
  };

  // ── Step: Details under review ──────────────────────────────────
  // "done" once any meaningful operator engagement has begun:
  //   - the main job status moved past "uploaded", OR
  //   - a fulfilment-state record exists (operator has touched it),
  //   - the nominal-duty lifecycle has moved off "received".
  // Otherwise "current" if the job is freshly uploaded, "upcoming"
  // never (review is always either current or already past).
  const reviewBegun =
    input.status !== "uploaded" ||
    input.hasFulfilmentState ||
    (nd !== null && nd !== "received");
  const underReview: PublicTimelineStep = {
    key: "under_review",
    label: STEP_LABELS.under_review,
    state: reviewBegun ? "done" : "current",
  };

  // ── Step: Awaiting your confirmation ────────────────────────────
  // "current" when the operator has explicitly flagged the job as
  // needing user input (nominal-duty `awaiting_user` or
  // `cannot_proceed`). Both are presented identically to the user —
  // the difference is internal-only.
  // "done" once delivered (the confirmation step, if it ever
  // happened, is in the past).
  // "upcoming" otherwise — shown neutrally as "Not yet required".
  let awaitingConfirmationState: PublicTimelineStepState;
  let awaitingConfirmationDescription: string | undefined;
  if (delivered) {
    awaitingConfirmationState = "done";
  } else if (nd === "awaiting_user" || nd === "cannot_proceed") {
    awaitingConfirmationState = "current";
    awaitingConfirmationDescription =
      "We may have reached out about a detail on your document.";
  } else {
    awaitingConfirmationState = "upcoming";
    awaitingConfirmationDescription = "Not yet required.";
  }
  const awaitingConfirmation: PublicTimelineStep = {
    key: "awaiting_confirmation",
    label: STEP_LABELS.awaiting_confirmation,
    state: awaitingConfirmationState,
    ...(awaitingConfirmationDescription
      ? { description: awaitingConfirmationDescription }
      : {}),
  };

  // ── Step: Awaiting payment ──────────────────────────────────────
  // "done" if payment has been recorded as completed, or the job is
  // already past payment (certificate retrieved, delivered).
  // "current" if payment is the active waiting state.
  // "upcoming" otherwise — shown neutrally as "Not yet started".
  let awaitingPaymentState: PublicTimelineStepState;
  let awaitingPaymentDescription: string | undefined;
  if (delivered || certRetrieved || waitingForCert || paymentDone) {
    awaitingPaymentState = "done";
  } else if (awaitingPayment) {
    awaitingPaymentState = "current";
  } else {
    awaitingPaymentState = "upcoming";
    awaitingPaymentDescription = "Not yet started.";
  }
  const awaitingPaymentStep: PublicTimelineStep = {
    key: "awaiting_payment",
    label: STEP_LABELS.awaiting_payment,
    state: awaitingPaymentState,
    ...(awaitingPaymentDescription
      ? { description: awaitingPaymentDescription }
      : {}),
  };

  // ── Step: Stamping in progress ──────────────────────────────────
  // "done" if delivered.
  // "current" if past payment but pre-delivery (waiting for certificate
  // or certificate retrieved but not yet delivered), OR if the
  // operator has flagged external-portal handling for a nominal-duty
  // job. The nominal-duty hint is consulted only to lift this step
  // from "upcoming" to "current"; the wording does not mention any
  // portal name.
  // "upcoming" otherwise — shown neutrally as "Not yet started".
  let stampingState: PublicTimelineStepState;
  let stampingDescription: string | undefined;
  if (delivered) {
    stampingState = "done";
  } else if (
    certRetrieved ||
    waitingForCert ||
    paymentDone ||
    nd === "external_portal_in_progress"
  ) {
    stampingState = "current";
  } else {
    stampingState = "upcoming";
    stampingDescription = "Not yet started.";
  }
  const stampingInProgress: PublicTimelineStep = {
    key: "stamping_in_progress",
    label: STEP_LABELS.stamping_in_progress,
    state: stampingState,
    ...(stampingDescription ? { description: stampingDescription } : {}),
  };

  // ── Step: Completed ─────────────────────────────────────────────
  // "done" only if delivered. Never "current" — completion is binary
  // and is only ever a closed state.
  const completed: PublicTimelineStep = {
    key: "completed",
    label: STEP_LABELS.completed,
    state: delivered ? "done" : "upcoming",
  };

  return [
    received,
    underReview,
    awaitingConfirmation,
    awaitingPaymentStep,
    stampingInProgress,
    completed,
  ];
}
