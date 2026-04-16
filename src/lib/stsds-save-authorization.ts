/**
 * WeStamp — STSDS Maklumat Am Save Authorization
 *
 * Explicit human-confirmed authorization boundary for the first
 * Maklumat Am save attempt. Authorization must be deliberately issued,
 * is tied to the current job state fingerprint, and becomes stale
 * if the underlying state changes.
 *
 * SAFETY: This module does NOT perform any portal save.
 * It manages the authorization decision only.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalSaveAuthorization,
  PortalSaveAuthorizationStatus,
  PortalSaveAuthorizationReason,
  PortalSaveAuthorizationStateRef,
  PortalSaveAuthorizationExpiry,
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
 * This captures the timestamps of all layers the authorization depends on.
 */
function buildStateRef(job: StampingJob): PortalSaveAuthorizationStateRef | null {
  if (!job.savePreflight || !job.portalDraft) return null;

  return {
    preflightEvaluatedAt: job.savePreflight.evaluatedAt,
    portalDraftedAt: job.portalDraft.draftedAt,
    probeProbedAt: job.portalProbe?.probedAt,
    assertionEvaluatedAt: job.assertionEvaluation?.evaluatedAt,
    lane: job.savePreflight.lane,
  };
}

/**
 * Check whether the current job state matches a previously stored state ref.
 * Returns the reasons why it does not match, or an empty array if it matches.
 */
function checkStateDrift(
  job: StampingJob,
  stateRef: PortalSaveAuthorizationStateRef
): PortalSaveAuthorizationReason[] {
  const reasons: PortalSaveAuthorizationReason[] = [];

  if (
    job.savePreflight &&
    job.savePreflight.evaluatedAt !== stateRef.preflightEvaluatedAt
  ) {
    reasons.push("preflight_changed");
  }

  if (
    job.portalDraft &&
    job.portalDraft.draftedAt !== stateRef.portalDraftedAt
  ) {
    reasons.push("portal_draft_changed");
  }

  if (
    job.portalProbe &&
    stateRef.probeProbedAt &&
    job.portalProbe.probedAt !== stateRef.probeProbedAt
  ) {
    reasons.push("probe_changed");
  }

  if (
    job.assertionEvaluation &&
    stateRef.assertionEvaluatedAt &&
    job.assertionEvaluation.evaluatedAt !== stateRef.assertionEvaluatedAt
  ) {
    reasons.push("assertion_changed");
  }

  return reasons;
}

/**
 * Build an expiry object for a newly issued authorization.
 */
function buildExpiry(issuedAt: string): PortalSaveAuthorizationExpiry {
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
  expiry: PortalSaveAuthorizationExpiry
): PortalSaveAuthorizationExpiry {
  const now = Date.now();
  const expiresAt = new Date(expiry.expiresAt).getTime();
  return {
    ...expiry,
    isExpired: now >= expiresAt,
  };
}

// ─── Staleness Reason Labels ────────────────────────────────────────

const STALE_REASON_LABELS: Record<PortalSaveAuthorizationReason, string> = {
  preflight_not_eligible:
    "Save preflight is not eligible — authorization cannot be issued.",
  preflight_changed:
    "Save preflight was re-evaluated after authorization was issued.",
  portal_draft_changed:
    "Portal draft was updated after authorization was issued.",
  probe_changed:
    "Portal probe was re-run after authorization was issued.",
  assertion_changed:
    "Assertion evaluation changed after authorization was issued.",
  time_expired:
    "Authorization time window has elapsed.",
  explicitly_revoked:
    "Authorization was explicitly revoked.",
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Evaluate the current save authorization state for a job.
 *
 * This does NOT issue authorization — it only evaluates the current state.
 * Call issueMaklumatAmSaveAuthorization() to actually issue authorization.
 *
 * @returns The evaluated authorization state.
 */
export function evaluateMaklumatAmSaveAuthorization(
  job: StampingJob
): PortalSaveAuthorization {
  const now = new Date().toISOString();

  // If no preflight exists or preflight is not eligible/review_required,
  // authorization is not available.
  if (!job.savePreflight) {
    return {
      status: "not_available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        "Save preflight has not been evaluated. Authorization is not available.",
    };
  }

  const preflightEligible =
    job.savePreflight.status === "eligible" ||
    job.savePreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        `Save preflight status is "${job.savePreflight.status}". ` +
        "Resolve all blocking issues before authorization can be considered.",
    };
  }

  // If no existing authorization has ever been issued, it is available.
  if (!job.saveAuthorization?.issuedAt) {
    return {
      status: "available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: [],
      explanation:
        "Save preflight is eligible. Authorization can be issued via explicit local/dev confirmation.",
    };
  }

  // An authorization was previously issued. Check if it is still valid.
  const existing = job.saveAuthorization;

  // Check explicit revocation
  if (existing.status === "revoked") {
    return {
      status: "revoked",
      scope: "maklumat_am_save",
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
  const staleReasons: PortalSaveAuthorizationReason[] = [];

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
      scope: "maklumat_am_save",
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
    scope: "maklumat_am_save",
    evaluatedAt: now,
    issuedAt: existing.issuedAt,
    expiry,
    stateRef: existing.stateRef,
    staleReasons: [],
    explanation:
      "Authorization is active and tied to the current job state. " +
      "No save has been performed.",
  };
}

/**
 * Issue a new save authorization for Maklumat Am.
 *
 * This requires explicit human confirmation — it is the deliberate
 * local/dev-only action that records intent to allow a future save.
 *
 * Prerequisites:
 * - Save preflight must be eligible or review_required
 * - Portal draft must exist
 *
 * @returns The newly issued authorization, or a refusal.
 */
export function issueMaklumatAmSaveAuthorization(
  job: StampingJob
): PortalSaveAuthorization {
  const now = new Date().toISOString();

  // Verify preflight eligibility
  if (!job.savePreflight) {
    return {
      status: "not_available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation: "Cannot issue authorization: save preflight has not been evaluated.",
    };
  }

  const preflightEligible =
    job.savePreflight.status === "eligible" ||
    job.savePreflight.status === "review_required";

  if (!preflightEligible) {
    return {
      status: "not_available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation:
        `Cannot issue authorization: save preflight status is "${job.savePreflight.status}".`,
    };
  }

  if (!job.portalDraft) {
    return {
      status: "not_available",
      scope: "maklumat_am_save",
      evaluatedAt: now,
      staleReasons: ["preflight_not_eligible"],
      explanation: "Cannot issue authorization: no portal draft exists.",
    };
  }

  // Build state ref and expiry
  const stateRef = buildStateRef(job);
  const expiry = buildExpiry(now);

  return {
    status: "active",
    scope: "maklumat_am_save",
    evaluatedAt: now,
    issuedAt: now,
    expiry,
    stateRef: stateRef ?? undefined,
    staleReasons: [],
    explanation:
      "Authorization issued via explicit local/dev confirmation. " +
      "Tied to the current job state. No save has been performed.",
  };
}

/**
 * Revoke an existing save authorization.
 *
 * @returns The revoked authorization state.
 */
export function revokeMaklumatAmSaveAuthorization(
  job: StampingJob
): PortalSaveAuthorization {
  const now = new Date().toISOString();

  return {
    status: "revoked",
    scope: "maklumat_am_save",
    evaluatedAt: now,
    issuedAt: job.saveAuthorization?.issuedAt,
    revokedAt: now,
    stateRef: job.saveAuthorization?.stateRef,
    staleReasons: ["explicitly_revoked"],
    explanation:
      "Authorization has been explicitly revoked. " +
      "A new authorization can be issued if preflight is still eligible.",
  };
}
