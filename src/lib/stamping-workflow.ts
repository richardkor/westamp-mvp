/**
 * WeStamp — Stamping Workflow Service
 *
 * Centralized transition rules and event helpers for stamping jobs.
 * Determines which state transitions are valid and blocks invalid ones.
 *
 * Does NOT perform side effects. The caller is responsible for
 * persisting any changes via the store.
 *
 * Does NOT implement real STSDS submission, payment, or certificate
 * retrieval. Those are future milestones.
 */

import {
  StampingJob,
  StampingJobStatus,
  JobEvent,
  JobEventType,
  JobArtifacts,
  SUPPORTED_FOR_AUTOMATION,
  DocumentCategory,
} from "./stamping-types";

// ─── Transition Map ──────────────────────────────────────────────────

/**
 * Defines the set of valid next statuses for each current status.
 *
 * Statuses marked (reserved) have transitions defined but are not
 * user-triggerable in this milestone.
 */
const TRANSITION_MAP: Record<StampingJobStatus, StampingJobStatus[]> = {
  uploaded: ["intake_reviewed", "manual_review_required", "failed"],
  intake_reviewed: ["prepared", "manual_review_required", "failed"],
  prepared: ["ready_for_submission", "manual_review_required", "failed"],
  ready_for_submission: ["submitted", "manual_review_required", "failed"],  // submitted is reserved
  submitted: ["processing", "manual_review_required", "failed"],            // reserved
  processing: ["completed", "manual_review_required", "failed"],            // reserved
  completed: [],                                                            // terminal
  failed: ["uploaded"],                                                     // allow retry from start
  manual_review_required: [],                                               // terminal until admin action
};

/**
 * Statuses that the user can trigger via the transition API in this milestone.
 * All others require backend/admin action or are reserved for future features.
 */
const USER_TRIGGERABLE: Set<StampingJobStatus> = new Set([
  "ready_for_submission",
]);

/**
 * Statuses that the system (server-side logic) can trigger.
 * These are not exposed as user-facing buttons but can be called
 * by internal endpoints with { systemTriggered: true }.
 */
const SYSTEM_TRIGGERABLE: Set<StampingJobStatus> = new Set([
  "manual_review_required",
  "failed",
]);

// ─── Transition Validation ───────────────────────────────────────────

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

export interface TransitionOptions {
  /** When true, bypasses user-triggerable check (for server-side logic). */
  systemTriggered?: boolean;
}

/**
 * Check whether a job can transition to the given target status.
 * Returns { ok: true } if valid, or { ok: false, reason } if blocked.
 *
 * Pass { systemTriggered: true } for transitions driven by server-side
 * logic (e.g. routing to manual_review_required or failed).
 */
export function canTransition(
  job: StampingJob,
  target: StampingJobStatus,
  options?: TransitionOptions
): TransitionResult {
  // 1. Is the target a valid next state from the current status?
  const validNext = TRANSITION_MAP[job.status];
  if (!validNext || !validNext.includes(target)) {
    return {
      ok: false,
      reason: `Cannot move from "${job.status}" to "${target}". This transition is not allowed.`,
    };
  }

  // 2. Is the target triggerable?
  const isSystem = options?.systemTriggered === true;
  if (isSystem) {
    // System transitions must be in the SYSTEM_TRIGGERABLE set
    if (!SYSTEM_TRIGGERABLE.has(target)) {
      return {
        ok: false,
        reason: `The "${target}" status cannot be set by system logic.`,
      };
    }
  } else {
    // User transitions must be in the USER_TRIGGERABLE set
    if (!USER_TRIGGERABLE.has(target)) {
      return {
        ok: false,
        reason: `The "${target}" status is not available yet. This will be enabled in a future update.`,
      };
    }
  }

  // 3. Category-specific checks
  if (target === "ready_for_submission") {
    const cat = job.documentCategory as DocumentCategory;
    if (!SUPPORTED_FOR_AUTOMATION[cat]) {
      return {
        ok: false,
        reason:
          "Automated stamping workflow is not yet available for this document category.",
      };
    }

    // Must have preparation snapshot
    if (!job.preparationSnapshot) {
      return {
        ok: false,
        reason:
          "This job cannot move to the next step yet. Please complete the required stamping details first.",
      };
    }

    // Must have stamping details
    if (!job.stampingDetails) {
      return {
        ok: false,
        reason:
          "This job cannot move to the next step yet. Please complete the required stamping details first.",
      };
    }

    // Must have a stored file
    if (!job.storagePath) {
      return {
        ok: false,
        reason: "No uploaded document found on this record.",
      };
    }
  }

  return { ok: true };
}

/**
 * Return the list of valid next statuses for a job.
 * Useful for UI to determine which actions to show.
 */
export function getValidNextStatuses(job: StampingJob): StampingJobStatus[] {
  const validNext = TRANSITION_MAP[job.status] ?? [];
  return validNext.filter((target) => canTransition(job, target).ok);
}

// ─── Manual Review Evaluation ────────────────────────────────────────

export interface ManualReviewResult {
  required: boolean;
  reason?: string;
}

/**
 * Human-readable labels for each tenancy structure flag.
 * Used to produce clearer manual-review reasons.
 */
const STRUCTURE_FLAG_LABELS: Record<string, string> = {
  hasPremiumOrFine: "Tenancy includes a premium or fine",
  hasVariableRent: "Rent is variable, percentage-based, or has escalation clauses",
  isMixedUse: "Property classification is mixed-use or ambiguous",
  isPeriodicOrIndefinite: "Lease term is periodic, rolling, or indefinite",
  hasBundledCharges: "Charges are bundled with rent (e.g. maintenance, furnishing, service charges)",
  hasUnusualConsideration: "Tenancy includes unusual or unclear consideration",
};

/**
 * Evaluate whether a job should be routed to manual_review_required
 * instead of proceeding through the straight-through workflow.
 *
 * Uses grounded conditions derivable from existing job data:
 *  1. Category is not supported for automation
 *  2. supportedForAutomation flag is inconsistent (data integrity guard)
 *  3. Tenancy structure flags indicate unsupported terms
 *  4. stampingDetails.manualReviewReason was set by the calculator
 *
 * Does NOT implement OCR, AI analysis, or speculative checks.
 */
export function shouldRouteToManualReview(
  job: StampingJob
): ManualReviewResult {
  const cat = job.documentCategory as DocumentCategory;

  // 1. Unsupported category that somehow reached a workflow step beyond uploaded
  if (!SUPPORTED_FOR_AUTOMATION[cat]) {
    return {
      required: true,
      reason:
        "Automated stamping workflow is not available for this document category.",
    };
  }

  // 2. Data integrity: supportedForAutomation flag disagrees with category
  if (job.supportedForAutomation === false && SUPPORTED_FOR_AUTOMATION[cat]) {
    return {
      required: true,
      reason:
        "This record is flagged as not suitable for automated processing.",
    };
  }

  // 3. Check persisted tenancy structure flags
  const flags = job.stampingDetails?.structureFlags;
  if (flags) {
    const activeFlags = Object.entries(flags)
      .filter(([, value]) => value === true)
      .map(([key]) => STRUCTURE_FLAG_LABELS[key] ?? key);

    if (activeFlags.length > 0) {
      return {
        required: true,
        reason:
          activeFlags.length === 1
            ? `${activeFlags[0]}.`
            : activeFlags.map((f) => `• ${f}`).join("\n"),
      };
    }
  }

  // 4. Calculator previously flagged manual review
  if (job.stampingDetails?.manualReviewReason) {
    return {
      required: true,
      reason: job.stampingDetails.manualReviewReason,
    };
  }

  return { required: false };
}

// ─── Event Helpers ───────────────────────────────────────────────────

/** Create a new event entry. */
export function createEvent(
  type: JobEventType,
  note?: string
): JobEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
}

/** Append an event to a job's event history (returns new array). */
export function appendEvent(
  existingEvents: JobEvent[] | undefined,
  event: JobEvent
): JobEvent[] {
  return [...(existingEvents ?? []), event];
}

// ─── Artifact Helpers ────────────────────────────────────────────────

/**
 * Build the initial artifact structure for a job.
 * Only originalDocument is populated. Certificate and final package
 * are null placeholders for future milestones.
 */
export function buildInitialArtifacts(job: StampingJob): JobArtifacts {
  return {
    originalDocument: {
      fileName: job.originalFileName,
      storagePath: job.storagePath,
      mimeType: job.mimeType,
    },
    stampCertificate: null,
    finalPackage: null,
  };
}
