/**
 * WeStamp — Nominal-Duty Internal Lifecycle
 *
 * Small, internal, operator-facing lifecycle for nominal-duty registry
 * jobs (Employment Contract, Statutory Declaration, and future admitted
 * categories). Tenancy jobs have rich sewa_pajakan progression via
 * `StampingJobStatus`; nominal-duty jobs do not, and would otherwise
 * look frozen at "Uploaded" from the moment of intake through the
 * operator's external e-Duti Setem work.
 *
 * What this lifecycle IS
 * ──────────────────────
 * - A parallel, optional state field on `StampingJob`
 *   (`nominalDutyState`) used to reflect what the operator is actually
 *   doing with the job right now.
 * - Operator-visible only. Every state is phrased so it cannot be
 *   confused with automation, portal submission, payment, or
 *   certificate retrieval.
 *
 * What this lifecycle IS NOT
 * ──────────────────────────
 * - A replacement for `StampingJobStatus`. The main status enum is
 *   unchanged; tenancy jobs continue to use it exclusively.
 * - A transition engine. Any state may move to any other state — the
 *   operator is the authority, not a state machine. Audit trail is
 *   the full `events[]` log.
 * - A promise. "Completed (external stamping done)" is an operator
 *   attestation, not an automated detection.
 * - A public-status input. `derivePublicStatus` does not read this
 *   field; the public receipt continues to be driven by
 *   `fulfilmentState` and the main `status`.
 *
 * Scope
 * ─────
 * - This module only defines types, labels, and the validator. The
 *   API route at `/api/intake/[id]/nominal-duty-state` calls the
 *   validator and writes the field; the operator page reads it.
 */

/**
 * Internal operational state for nominal-duty registry jobs.
 *
 * Ordering is presentation order for the operator dropdown, not a
 * forced progression. The operator may move in any direction
 * (including back) because real cases don't always proceed linearly.
 */
export type NominalDutyState =
  | "received"
  | "under_review"
  | "awaiting_user"
  | "external_portal_in_progress"
  | "completed"
  | "cannot_proceed";

/**
 * Short operator-visible label per state. Phrasing is deliberately
 * restrained: no "submitted", no "paid", no "stamped" unless the
 * operator has actually done those things. The "Completed" label is
 * clear that the operator is attesting to external stamping work —
 * it is not a system-detected completion.
 */
export const NOMINAL_DUTY_STATE_LABELS: Record<NominalDutyState, string> = {
  received: "Received (not yet reviewed)",
  under_review: "Under operator review",
  awaiting_user: "Awaiting user confirmation",
  external_portal_in_progress: "External portal work in progress",
  completed: "Completed (external stamping done — operator-attested)",
  cannot_proceed: "Cannot proceed (see note)",
};

/**
 * One-line description shown beneath the label so an operator reading
 * the state alone understands what it means. Kept short and factual.
 */
export const NOMINAL_DUTY_STATE_DESCRIPTIONS: Record<NominalDutyState, string> =
  {
    received:
      "Intake saved. No operator has started reviewing this job yet.",
    under_review:
      "An operator is actively reviewing the uploaded document and the registry checks.",
    awaiting_user:
      "Operator has contacted the user about a missing detail, mismatched category, or unclear instrument, and is waiting for a reply.",
    external_portal_in_progress:
      "Operator has started handling this job manually in e-Duti Setem. No automation is running; WeStamp is not driving the portal.",
    completed:
      "Operator attests that external e-Duti Setem stamping was completed for this job. This is an internal attestation, not a public delivery mark.",
    cannot_proceed:
      "Operator has determined the job cannot continue on the nominal-duty assisted path — for example, the document does not match its category or is out of scope. See the note for the reason.",
  };

/**
 * Canonical ordering for operator dropdowns and presentation. Not a
 * forced progression; see type-level comment.
 */
export const NOMINAL_DUTY_STATE_ORDER: readonly NominalDutyState[] = [
  "received",
  "under_review",
  "awaiting_user",
  "external_portal_in_progress",
  "completed",
  "cannot_proceed",
];

/** Runtime validator for a candidate nominal-duty state value. */
export function isValidNominalDutyState(
  candidate: unknown
): candidate is NominalDutyState {
  return (
    typeof candidate === "string" &&
    (NOMINAL_DUTY_STATE_ORDER as readonly string[]).includes(candidate)
  );
}

/** Maximum allowed length for the accompanying operator note. */
export const NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH = 2000;

/**
 * Build the human-readable transition description appended to the
 * `nominal_duty_state_changed` event log entry. Compact, so the
 * events list stays scannable.
 */
export function formatNominalDutyTransitionNote(
  fromState: NominalDutyState | undefined,
  toState: NominalDutyState,
  note: string | undefined
): string {
  const from = fromState
    ? NOMINAL_DUTY_STATE_LABELS[fromState]
    : "(initial)";
  const to = NOMINAL_DUTY_STATE_LABELS[toState];
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    return `Nominal-duty state: ${from} → ${to}. Note: ${trimmedNote}`;
  }
  return `Nominal-duty state: ${from} → ${to}.`;
}
