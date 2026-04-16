/**
 * WeStamp — STSDS Next-Tab Progression Authorization
 *
 * Explicit human-confirmed authorization boundary for the first
 * next-tab progression attempt. Authorization must be deliberately issued,
 * is tied to the current post-save job state fingerprint, and becomes
 * stale if the underlying state changes.
 *
 * SAFETY: This module does NOT perform any portal navigation or click.
 * It manages the authorization decision only.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalNextTabAuthorization,
  PortalNextTabAuthorizationStatus,
  PortalNextTabAuthorizationReason,
  PortalNextTabAuthorizationStateRef,
  PortalNextTabAuthorizationExpiry,
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
 * Captures the timestamps of all layers the next-tab authorization depends on.
 */
function buildStateRef(
  job: StampingJob
): PortalNextTabAuthorizationStateRef | null {
  if (
    !job.nextTabPreflight ||
    !job.postSaveReconciliation ||
    !job.saveAttempt
  ) {
    return null;
  }

  return {
    nextTabPreflightEvaluatedAt: job.nextTabPreflight.evaluatedAt,
    reconciliationEvaluatedAt: job.postSaveReconciliation.evaluatedAt,
    saveAttemptAttemptedAt: job.saveAttempt.attemptedAt,
    postSaveSnapshotCapturedAt:
      job.saveAttempt.postSaveSnapshot?.capturedAt,
    lane: job.nextTabPreflight.lane,
    expectedNextTabKey:
      job.nextTabPreflight.nextTabObservedState.expectedNextTabKey ??
      "bahagian_a",
  };
}

/**
 * Check whether the current job state matches a previously stored state ref.
 * Returns the reasons why it does not match, or an empty array if it matches.
 */
function checkStateDrift(
  job: StampingJob,
  stateRef: PortalNextTabAuthorizationStateRef
): PortalNextTabAuthorizationReason[] {
  const reasons: PortalNextTabAuthorizationReason[] = [];

  if (
    job.nextTabPreflight &&
    job.nextTabPreflight.evaluatedAt !== stateRef.nextTabPreflightEvaluatedAt
  ) {
    reasons.push("preflight_changed");
  }

  if (
    job.postSaveReconciliation &&
    job.postSaveReconciliation.evaluatedAt !==
      stateRef.reconciliationEvaluatedAt
  ) {
    reasons.push("reconciliation_changed");
  }

  if (
    job.saveAttempt &&
    job.saveAttempt.attemptedAt !== stateRef.saveAttemptAttemptedAt
  ) {
    reasons.push("save_attempt_changed");
  }

  if (
    job.saveAttempt?.postSaveSnapshot &&
    stateRef.postSaveSnapshotCapturedAt &&
    job.saveAttempt.postSaveSnapshot.capturedAt !==
      stateRef.postSaveSnapshotCapturedAt
  ) {
    reasons.push("post_save_snapshot_changed");
  }

  // Check if the expected next tab changed
  const currentNextTab =
    job.nextTabPreflight?.nextTabObservedState?.expectedNextTabKey;
  if (currentNextTab && currentNextTab !== stateRef.expectedNextTabKey) {
    reasons.push("expected_next_tab_changed");
  }

  return reasons;
}

/**
 * Build an expiry object for a newly issued authorization.
 */
function buildExpiry(issuedAt: string): PortalNextTabAuthorizationExpiry {
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
  expiry: PortalNextTabAuthorizationExpiry
): PortalNextTabAuthorizationExpiry {
  const now = Date.now();
  const expiresAt = new Date(expiry.expiresAt).getTime();
  return {
    ...expiry,
    isExpired: now >= expiresAt,
  };
}

// ─── Stale Reason Labels ──────────────────────────────────────────────

const STALE_REASON_LABELS: Record<
  PortalNextTabAuthorizationReason,
  string
> = {
  preflight_not_eligible:
    "Next-tab preflight is not eligible — authorization cannot be issued.",
  preflight_changed:
    "Next-tab preflight was re-evaluated after authorization was issued.",
  reconciliation_changed:
    "Post-save reconciliation changed after authorization was issued.",
  save_attempt_changed:
    "Save attempt changed after authorization was issued.",
  post_save_snapshot_changed:
    "Post-save snapshot changed after authorization was issued.",
  expected_next_tab_changed:
    "Expected next tab changed after authorization was issued.",
  time_expired: "Authorization time window has elapsed.",
  explicitly_revoked: "Authorization was explicitly revoked.",
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Evaluate the current next-tab authorization state for a job.
 *
 * This does NOT issue authorization — it only evaluates the current state.
 * Call issueNextTabProgressionAuthorization() to actually issue authorization.
 */
export function evaluateNextTabProgressionAuthorization(
  job: StampingJob
): PortalNextTabAuthorization {
  const now = new Date().toISOString();

  // Next-tab preflight must exist and be eligible or review_required
  if (!job.nextTabPreflight) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        "Next-tab preflight has not been evaluated. Authorization is not available.",
    };
  }

  const preflightEligible =
    job.nextTabPreflight.status === "eligible_for_later_attempt" ||
    job.nextTabPreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        `Next-tab preflight status is "${job.nextTabPreflight.status}". ` +
        "Resolve all blocking issues before authorization can be considered.",
    };
  }

  // If no existing authorization has ever been issued, it is available.
  if (!job.nextTabAuthorization?.issuedAt) {
    return {
      status: "available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: [],
      explanation:
        "Next-tab preflight is eligible. Authorization can be issued via explicit local/dev confirmation.",
    };
  }

  // An authorization was previously issued. Check if it is still valid.
  const existing = job.nextTabAuthorization;

  // Check explicit revocation
  if (existing.status === "revoked") {
    return {
      status: "revoked",
      scope: "next_tab_progression",
      evaluatedAt: now,
      issuedAt: existing.issuedAt,
      revokedAt: existing.revokedAt,
      stateRef: existing.stateRef,
      staleReasons: ["explicitly_revoked"],
      explanation:
        "Authorization was explicitly revoked. A new authorization can be issued if preflight is still eligible.",
    };
  }

  // Check state drift
  const staleReasons: PortalNextTabAuthorizationReason[] = [];

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
      scope: "next_tab_progression",
      evaluatedAt: now,
      issuedAt: existing.issuedAt,
      expiry,
      stateRef: existing.stateRef,
      staleReasons,
      explanation:
        `Authorization is stale: ${reasonTexts.join(" ")} ` +
        "A new authorization can be issued if preflight is still eligible.",
    };
  }

  // Authorization is still active
  return {
    status: "active",
    scope: "next_tab_progression",
    evaluatedAt: now,
    issuedAt: existing.issuedAt,
    expiry,
    stateRef: existing.stateRef,
    staleReasons: [],
    explanation:
      "Authorization is active and tied to the current post-save state. " +
      "No next-tab progression has been attempted.",
  };
}

/**
 * Issue a new next-tab progression authorization.
 *
 * This requires explicit human confirmation — it is the deliberate
 * local/dev-only action that records intent to allow a future next-tab
 * progression attempt.
 *
 * Prerequisites:
 * - Next-tab preflight must be eligible_for_later_attempt or review_required
 * - Post-save reconciliation must exist
 * - Save attempt must exist
 */
export function issueNextTabProgressionAuthorization(
  job: StampingJob
): PortalNextTabAuthorization {
  const now = new Date().toISOString();

  // Verify preflight eligibility
  if (!job.nextTabPreflight) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        "Cannot issue authorization: next-tab preflight has not been evaluated.",
    };
  }

  const preflightEligible =
    job.nextTabPreflight.status === "eligible_for_later_attempt" ||
    job.nextTabPreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        `Cannot issue authorization: next-tab preflight status is "${job.nextTabPreflight.status}".`,
    };
  }

  if (!job.postSaveReconciliation) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        "Cannot issue authorization: no post-save reconciliation exists.",
    };
  }

  if (!job.saveAttempt) {
    return {
      status: "not_available",
      scope: "next_tab_progression",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation: "Cannot issue authorization: no save attempt exists.",
    };
  }

  // Build state ref and expiry
  const stateRef = buildStateRef(job);
  const expiry = buildExpiry(now);

  return {
    status: "active",
    scope: "next_tab_progression",
    evaluatedAt: now,
    issuedAt: now,
    expiry,
    stateRef: stateRef ?? undefined,
    staleReasons: [],
    explanation:
      "Authorization issued via explicit local/dev confirmation. " +
      "Tied to the current post-save state. No next-tab progression has been attempted.",
  };
}

/**
 * Revoke an existing next-tab progression authorization.
 */
export function revokeNextTabProgressionAuthorization(
  job: StampingJob
): PortalNextTabAuthorization {
  const now = new Date().toISOString();

  return {
    status: "revoked",
    scope: "next_tab_progression",
    evaluatedAt: now,
    issuedAt: job.nextTabAuthorization?.issuedAt,
    revokedAt: now,
    stateRef: job.nextTabAuthorization?.stateRef,
    staleReasons: ["explicitly_revoked"],
    explanation:
      "Authorization has been explicitly revoked. " +
      "A new authorization can be issued if preflight is still eligible.",
  };
}
