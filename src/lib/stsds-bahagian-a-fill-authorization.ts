/**
 * WeStamp — STSDS Bahagian A Fill Authorization
 *
 * Explicit human-confirmed authorization boundary for the first
 * Bahagian A field-fill attempt. Authorization must be deliberately issued,
 * is tied to the current Bahagian A fill-preflight and entry-state
 * fingerprint, and becomes stale if the underlying state changes.
 *
 * SAFETY: This module does NOT perform any portal navigation or field fill.
 * It manages the authorization decision only.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalBahagianAFillAuthorization,
  PortalBahagianAFillAuthorizationStatus,
  PortalBahagianAFillAuthorizationReason,
  PortalBahagianAFillAuthorizationStateRef,
  PortalBahagianAFillAuthorizationExpiry,
  PortalLane,
} from "./stsds-types";

/**
 * Authorization expiry window in minutes.
 * After this duration, a previously-issued authorization becomes stale.
 */
const AUTHORIZATION_EXPIRY_MINUTES = 60;

// ─── State Fingerprint ──────────────────────────────────────────────

/**
 * Build a state reference fingerprint from the current job.
 * Captures the timestamps of all layers the fill authorization depends on.
 */
function buildStateRef(
  job: StampingJob
): PortalBahagianAFillAuthorizationStateRef | null {
  if (
    !job.bahagianAFillPreflight ||
    !job.bahagianAEntryState ||
    !job.nextTabAttempt
  ) {
    return null;
  }

  return {
    fillPreflightEvaluatedAt: job.bahagianAFillPreflight.evaluatedAt,
    entryStateObservedAt: job.bahagianAEntryState.observedAt,
    groundingStatus: job.bahagianAEntryState.status,
    nextTabAttemptAttemptedAt: job.nextTabAttempt.attemptedAt,
    lane: job.bahagianAFillPreflight.lane,
  };
}

/**
 * Check whether the current job state matches a previously stored state ref.
 * Returns the reasons why it does not match, or an empty array if it matches.
 */
function checkStateDrift(
  job: StampingJob,
  stateRef: PortalBahagianAFillAuthorizationStateRef
): PortalBahagianAFillAuthorizationReason[] {
  const reasons: PortalBahagianAFillAuthorizationReason[] = [];

  if (
    job.bahagianAFillPreflight &&
    job.bahagianAFillPreflight.evaluatedAt !== stateRef.fillPreflightEvaluatedAt
  ) {
    reasons.push("fill_preflight_changed");
  }

  if (
    job.bahagianAEntryState &&
    job.bahagianAEntryState.observedAt !== stateRef.entryStateObservedAt
  ) {
    reasons.push("entry_state_changed");
  }

  if (
    job.bahagianAEntryState &&
    job.bahagianAEntryState.status !== stateRef.groundingStatus
  ) {
    reasons.push("grounding_status_changed");
  }

  if (
    job.nextTabAttempt &&
    job.nextTabAttempt.attemptedAt !== stateRef.nextTabAttemptAttemptedAt
  ) {
    reasons.push("next_tab_attempt_changed");
  }

  if (
    job.bahagianAFillPreflight &&
    job.bahagianAFillPreflight.lane !== stateRef.lane
  ) {
    reasons.push("lane_changed");
  }

  return reasons;
}

/**
 * Build an expiry object for a newly issued authorization.
 */
function buildExpiry(issuedAt: string): PortalBahagianAFillAuthorizationExpiry {
  const issued = new Date(issuedAt);
  const expiresAt = new Date(
    issued.getTime() + AUTHORIZATION_EXPIRY_MINUTES * 60 * 1000
  );
  return {
    expiresAt: expiresAt.toISOString(),
    isExpired: false,
    windowMinutes: AUTHORIZATION_EXPIRY_MINUTES,
  };
}

/**
 * Check if an existing expiry has elapsed.
 */
function checkExpiry(
  expiry: PortalBahagianAFillAuthorizationExpiry
): PortalBahagianAFillAuthorizationExpiry {
  const now = Date.now();
  const expiresAt = new Date(expiry.expiresAt).getTime();
  return {
    ...expiry,
    isExpired: now >= expiresAt,
  };
}

// ─── Stale Reason Labels ──────────────────────────────────────────────

const STALE_REASON_LABELS: Record<
  PortalBahagianAFillAuthorizationReason,
  string
> = {
  fill_preflight_not_eligible:
    "Bahagian A fill preflight is not eligible — authorization cannot be issued.",
  fill_preflight_changed:
    "Bahagian A fill preflight was re-evaluated after authorization was issued.",
  entry_state_changed:
    "Bahagian A entry-state was re-captured after authorization was issued.",
  grounding_status_changed:
    "Schema grounding status changed after authorization was issued.",
  next_tab_attempt_changed:
    "Next-tab attempt changed after authorization was issued.",
  lane_changed:
    "Portal lane changed after authorization was issued.",
  time_expired: "Authorization time window has elapsed.",
  explicitly_revoked: "Authorization was explicitly revoked.",
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Evaluate the current Bahagian A fill authorization state for a job.
 *
 * This does NOT issue authorization — it only evaluates the current state.
 * Call issueBahagianAFillAuthorization() to actually issue authorization.
 */
export function evaluateBahagianAFillAuthorization(
  job: StampingJob
): PortalBahagianAFillAuthorization {
  const now = new Date().toISOString();

  // Fill preflight must exist and be eligible or review_required
  if (!job.bahagianAFillPreflight) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        "Bahagian A fill preflight has not been evaluated. Authorization is not available.",
    };
  }

  const preflightEligible =
    job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt" ||
    job.bahagianAFillPreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        `Bahagian A fill preflight status is "${job.bahagianAFillPreflight.status}". ` +
        "Resolve all blocking issues before authorization can be considered.",
    };
  }

  // If no existing authorization has ever been issued, it is available.
  if (!job.bahagianAFillAuthorization?.issuedAt) {
    return {
      status: "available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: [],
      explanation:
        "Bahagian A fill preflight is eligible. Authorization can be issued via explicit local/dev confirmation.",
    };
  }

  // An authorization was previously issued. Check if it is still valid.
  const existing = job.bahagianAFillAuthorization;

  // Check explicit revocation
  if (existing.status === "revoked") {
    return {
      status: "revoked",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      issuedAt: existing.issuedAt,
      revokedAt: existing.revokedAt,
      stateRef: existing.stateRef,
      staleReasons: ["explicitly_revoked"],
      explanation:
        "Authorization was explicitly revoked. A new authorization can be issued if fill preflight is still eligible.",
    };
  }

  // Check state drift
  const staleReasons: PortalBahagianAFillAuthorizationReason[] = [];

  if (existing.stateRef) {
    const drift = checkStateDrift(job, existing.stateRef);
    staleReasons.push(...drift);
  }

  // Check time expiry
  let expiry = existing.expiry;
  if (expiry) {
    expiry = checkExpiry(expiry);
    if (expiry.isExpired) {
      staleReasons.push("time_expired");
    }
  }

  if (staleReasons.length > 0) {
    const reasonTexts = staleReasons.map((r) => STALE_REASON_LABELS[r]);
    return {
      status: "stale",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      issuedAt: existing.issuedAt,
      expiry,
      stateRef: existing.stateRef,
      staleReasons,
      explanation:
        `Authorization is stale: ${reasonTexts.join(" ")} ` +
        "A new authorization can be issued if fill preflight is still eligible.",
    };
  }

  // Authorization is still active
  return {
    status: "active",
    scope: "bahagian_a_field_fill",
    evaluatedAt: now,
    issuedAt: existing.issuedAt,
    expiry,
    stateRef: existing.stateRef,
    staleReasons: [],
    explanation:
      "Authorization is active and tied to the current Bahagian A entry-state and fill-preflight. " +
      "No Bahagian A field-filling has been attempted.",
  };
}

/**
 * Issue a new Bahagian A fill authorization.
 *
 * This requires explicit human confirmation — it is the deliberate
 * local/dev-only action that records intent to allow a future first
 * Bahagian A field-fill attempt.
 *
 * Prerequisites:
 * - Bahagian A fill preflight must be eligible_for_later_fill_attempt or review_required
 * - Bahagian A entry-state must exist
 * - Next-tab attempt must exist
 */
export function issueBahagianAFillAuthorization(
  job: StampingJob
): PortalBahagianAFillAuthorization {
  const now = new Date().toISOString();

  // Verify fill preflight eligibility
  if (!job.bahagianAFillPreflight) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        "Cannot issue authorization: Bahagian A fill preflight has not been evaluated.",
    };
  }

  const preflightEligible =
    job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt" ||
    job.bahagianAFillPreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        `Cannot issue authorization: Bahagian A fill preflight status is "${job.bahagianAFillPreflight.status}".`,
    };
  }

  if (!job.bahagianAEntryState) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        "Cannot issue authorization: no Bahagian A entry-state exists.",
    };
  }

  if (!job.nextTabAttempt) {
    return {
      status: "not_available",
      scope: "bahagian_a_field_fill",
      evaluatedAt: now,
      staleReasons: ["fill_preflight_not_eligible"],
      explanation:
        "Cannot issue authorization: no next-tab attempt exists.",
    };
  }

  // Build state ref and expiry
  const stateRef = buildStateRef(job);
  const expiry = buildExpiry(now);

  return {
    status: "active",
    scope: "bahagian_a_field_fill",
    evaluatedAt: now,
    issuedAt: now,
    expiry,
    stateRef: stateRef ?? undefined,
    staleReasons: [],
    explanation:
      "Authorization issued via explicit local/dev confirmation. " +
      "Tied to the current Bahagian A entry-state and fill-preflight. " +
      "No Bahagian A field-filling has been attempted.",
  };
}

/**
 * Revoke an existing Bahagian A fill authorization.
 */
export function revokeBahagianAFillAuthorization(
  job: StampingJob
): PortalBahagianAFillAuthorization {
  const now = new Date().toISOString();

  return {
    status: "revoked",
    scope: "bahagian_a_field_fill",
    evaluatedAt: now,
    issuedAt: job.bahagianAFillAuthorization?.issuedAt,
    revokedAt: now,
    stateRef: job.bahagianAFillAuthorization?.stateRef,
    staleReasons: ["explicitly_revoked"],
    explanation:
      "Authorization has been explicitly revoked. " +
      "A new authorization can be issued if fill preflight is still eligible.",
  };
}
