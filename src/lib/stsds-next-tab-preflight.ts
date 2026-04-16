/**
 * WeStamp — Next-Tab Progression Preflight Evaluator
 *
 * Evaluates whether the immediate next tab after Maklumat Am is
 * internally eligible for a later guarded progression attempt.
 *
 * Consumes:
 * - Portal schema tab order (per-lane)
 * - Save attempt result + post-save snapshot
 * - Post-save reconciliation
 * - Refreshed post-save assertion evaluation
 * - Save authorization / save preflight context
 *
 * This is a pure evaluator — no browser interaction, no portal mutation,
 * no next-tab click.
 *
 * Does NOT:
 * - Click the next tab
 * - Navigate into Bahagian A/B/C, Lampiran, or Perakuan
 * - Upload any document
 * - Make any payment or submission
 */

import { StampingJob } from "./stamping-types";
import {
  PortalNextTabPreflight,
  PortalNextTabPreflightStatus,
  PortalNextTabPreflightCheck,
  PortalNextTabObservedState,
  PortalNextTabObservedAvailability,
  PortalNextTabGuard,
  PortalNextTabGuardReason,
  PortalLane,
  PortalTabKey,
} from "./stsds-types";
import { getPortalSchema } from "./stsds-portal-schema";

// ─── Schema-based Tab Resolution ──────────────────────────────────────

/**
 * Determine the immediate next tab after the current tab for a lane,
 * using the portal schema ordering.
 */
function resolveNextTab(
  lane: PortalLane,
  currentTabKey: PortalTabKey
): { tabKey: PortalTabKey; tabLabel: string } | null {
  const schema = getPortalSchema(lane);
  const currentIndex = schema.findIndex((s) => s.tabKey === currentTabKey);
  if (currentIndex < 0 || currentIndex >= schema.length - 1) return null;
  const next = schema[currentIndex + 1];
  return { tabKey: next.tabKey, tabLabel: next.tabLabel };
}

// ─── Observed State Assessment ────────────────────────────────────────

/**
 * Assess what WeStamp currently knows about the next tab's availability
 * from post-save evidence. Grounded in existing data only.
 */
function assessNextTabObservedState(
  job: StampingJob,
  lane: PortalLane,
  nextTab: { tabKey: PortalTabKey; tabLabel: string } | null
): PortalNextTabObservedState {
  if (!nextTab) {
    return {
      expectedNextTabKey: null,
      expectedNextTabLabel: null,
      availability: "unknown",
      availabilitySource: "schema_resolution_failed",
      unintendedProgressionDetected: false,
      note: "Could not resolve the next tab from the portal schema.",
    };
  }

  const attempt = job.saveAttempt;
  const reconciliation = job.postSaveReconciliation;

  // Check for unintended progression in save attempt notes
  const unintendedProgression = attempt?.notes?.some(
    (n) =>
      n.toLowerCase().includes("next tab") ||
      n.toLowerCase().includes("tab progression") ||
      n.toLowerCase().includes("continue to tab")
  ) ?? false;

  // If the save attempt failed or was blocked, next tab state is unknown
  if (!attempt || attempt.status === "failed" || attempt.status === "blocked") {
    return {
      expectedNextTabKey: nextTab.tabKey,
      expectedNextTabLabel: nextTab.tabLabel,
      availability: "unknown",
      availabilitySource: "save_attempt_not_completed",
      unintendedProgressionDetected: unintendedProgression,
      note: "Save attempt did not complete successfully — next tab state is unknown.",
    };
  }

  // If there's a visible error in the post-save evidence, next tab may not be available
  const observedMessage = attempt.evidence?.observedPortalMessage ?? "";
  const hasVisibleError =
    observedMessage.toLowerCase().includes("ralat") ||
    observedMessage.toLowerCase().includes("error") ||
    observedMessage.toLowerCase().includes("validation");

  if (hasVisibleError) {
    return {
      expectedNextTabKey: nextTab.tabKey,
      expectedNextTabLabel: nextTab.tabLabel,
      availability: "observed_error",
      availabilitySource: "post_save_portal_message",
      unintendedProgressionDetected: unintendedProgression,
      note: `Post-save portal message indicates an error: "${observedMessage}"`,
    };
  }

  // If the save outcome was success_message and reconciliation is clean,
  // infer the next tab is likely available (standard portal flow unlocks
  // the next tab after a successful save)
  const outcomeIsSuccess = attempt.evidence?.outcome === "success_message";
  const reconciliationIsClean =
    reconciliation?.status === "stopped_cleanly";

  if (outcomeIsSuccess && reconciliationIsClean) {
    return {
      expectedNextTabKey: nextTab.tabKey,
      expectedNextTabLabel: nextTab.tabLabel,
      availability: "inferred_available",
      availabilitySource: "save_success_and_clean_reconciliation",
      unintendedProgressionDetected: unintendedProgression,
      note:
        "Save completed with success message and clean reconciliation. " +
        "Next tab availability is inferred from standard portal flow, not explicitly confirmed.",
    };
  }

  if (outcomeIsSuccess) {
    return {
      expectedNextTabKey: nextTab.tabKey,
      expectedNextTabLabel: nextTab.tabLabel,
      availability: "inferred_available",
      availabilitySource: "save_success_message",
      unintendedProgressionDetected: unintendedProgression,
      note:
        "Save completed with success message. " +
        "Next tab availability is inferred, not explicitly confirmed.",
    };
  }

  // Fallback: state is unknown
  return {
    expectedNextTabKey: nextTab.tabKey,
    expectedNextTabLabel: nextTab.tabLabel,
    availability: "unknown",
    availabilitySource: "insufficient_post_save_evidence",
    unintendedProgressionDetected: unintendedProgression,
    note:
      "Post-save evidence is insufficient to determine next tab availability.",
  };
}

// ─── Main Evaluator ───────────────────────────────────────────────────

/**
 * Evaluate the next-tab progression preflight for a job.
 *
 * Determines whether the immediate next tab after Maklumat Am is
 * internally eligible for a later guarded progression attempt,
 * based on schema order and all post-save layers.
 *
 * Returns null only if routing suggestion is completely absent.
 */
export function evaluateNextTabProgressionPreflight(
  job: StampingJob
): PortalNextTabPreflight | null {
  const now = new Date().toISOString();

  if (!job.routingSuggestion) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const currentTabKey: PortalTabKey = "maklumat_am";
  const nextTab = resolveNextTab(lane, currentTabKey);
  const observedState = assessNextTabObservedState(job, lane, nextTab);

  const checks: PortalNextTabPreflightCheck[] = [];

  // ── Check 1: Save attempt exists and completed ──────────────────
  const saveCompleted =
    !!job.saveAttempt &&
    job.saveAttempt.status === "completed_with_stop";
  checks.push({
    checkId: "save_attempt_completed",
    description: "Maklumat Am save attempt exists and completed with stop",
    severity: "blocking",
    passed: saveCompleted,
    ...(!saveCompleted && {
      reason: !job.saveAttempt
        ? "No save attempt exists."
        : `Save attempt status is "${job.saveAttempt.status}" — must be "completed_with_stop".`,
    }),
  });

  // ── Check 2: Post-save reconciliation exists ────────────────────
  const hasReconciliation = !!job.postSaveReconciliation;
  checks.push({
    checkId: "reconciliation_exists",
    description: "Post-save reconciliation has been evaluated",
    severity: "blocking",
    passed: hasReconciliation,
    ...(!hasReconciliation && {
      reason: "No post-save reconciliation exists.",
    }),
  });

  // ── Check 3: No blocking issues in reconciliation ──────────────
  const reconciliationClean =
    hasReconciliation &&
    job.postSaveReconciliation!.status !== "blocking_issue" &&
    job.postSaveReconciliation!.status !== "save_failed";
  checks.push({
    checkId: "reconciliation_no_blocking",
    description: "Post-save reconciliation does not contain blocking issues",
    severity: "blocking",
    passed: reconciliationClean,
    ...(!reconciliationClean &&
      hasReconciliation && {
        reason: `Reconciliation status is "${job.postSaveReconciliation!.status}".`,
      }),
    ...(!reconciliationClean &&
      !hasReconciliation && {
        reason: "Cannot evaluate — reconciliation is missing.",
      }),
  });

  // ── Check 4: Post-save snapshot exists ──────────────────────────
  const hasPostSaveSnapshot = !!job.saveAttempt?.postSaveSnapshot;
  checks.push({
    checkId: "post_save_snapshot_exists",
    description: "Post-save observed snapshot was captured after save",
    severity: "blocking",
    passed: hasPostSaveSnapshot,
    ...(!hasPostSaveSnapshot && {
      reason: "No post-save snapshot available from the save attempt.",
    }),
  });

  // ── Check 5: No blocking assertion mismatches in refreshed eval ─
  const postSaveAssertionEval =
    job.postSaveReconciliation?.postSaveAssertionEvaluation;
  const blockingMismatches =
    postSaveAssertionEval?.summary?.blockingMismatchCount ?? 0;
  const noBlockingAssertionMismatch =
    !postSaveAssertionEval || blockingMismatches === 0;
  checks.push({
    checkId: "no_blocking_assertion_mismatch",
    description:
      "Refreshed post-save assertions do not contain blocking mismatches",
    severity: "blocking",
    passed: noBlockingAssertionMismatch,
    ...(!noBlockingAssertionMismatch && {
      reason: `${blockingMismatches} blocking assertion mismatch(es) remain in post-save evaluation.`,
    }),
  });

  // ── Check 6: Expected next tab is known from schema ─────────────
  const nextTabKnown = !!nextTab;
  checks.push({
    checkId: "expected_next_tab_known",
    description: "Expected next tab is resolved from the portal schema for this lane",
    severity: "blocking",
    passed: nextTabKnown,
    ...(!nextTabKnown && {
      reason: `Could not resolve the next tab after "${currentTabKey}" for lane "${lane}".`,
    }),
  });

  // ── Check 7: Observed post-save state does not indicate error ───
  const noObservedError =
    observedState.availability !== "observed_error" &&
    observedState.availability !== "observed_disabled";
  checks.push({
    checkId: "no_observed_post_save_error",
    description:
      "Observed post-save state does not indicate portal error or tab disabled",
    severity: "blocking",
    passed: noObservedError,
    ...(!noObservedError && {
      reason: `Next tab availability is "${observedState.availability}": ${observedState.note ?? "portal state suggests progression should be refused."}`,
    }),
  });

  // ── Check 8: No unintended progression already occurred ─────────
  checks.push({
    checkId: "no_unintended_progression",
    description:
      "No evidence suggests unintended next-tab progression already occurred",
    severity: "blocking",
    passed: !observedState.unintendedProgressionDetected,
    ...(observedState.unintendedProgressionDetected && {
      reason:
        "Save attempt notes indicate possible unintended tab progression.",
    }),
  });

  // ── Check 9: Next-tab availability confirmed or honestly unknown ─
  const availabilityConfirmedOrInferred =
    observedState.availability === "confirmed_enabled" ||
    observedState.availability === "inferred_available";
  checks.push({
    checkId: "next_tab_availability_signal",
    description:
      "Next-tab availability is confirmed or inferred from post-save evidence",
    severity: "advisory",
    passed: availabilityConfirmedOrInferred,
    ...(!availabilityConfirmedOrInferred && {
      reason: `Next tab availability is "${observedState.availability}" — cannot confirm the next tab is ready.`,
    }),
  });

  // ── Check 10: Post-save evidence completeness ──────────────────
  const hasPostSaveEvidence = !!job.saveAttempt?.evidence;
  checks.push({
    checkId: "post_save_evidence_complete",
    description: "Post-save evidence (screenshot, portal message) was captured",
    severity: "advisory",
    passed: hasPostSaveEvidence,
    ...(!hasPostSaveEvidence && {
      reason: "Post-save evidence is missing or incomplete.",
    }),
  });

  // ── Check 11: Post-save assertion evaluation was refreshed ──────
  const assertionsRefreshed = !!postSaveAssertionEval;
  checks.push({
    checkId: "assertions_refreshed_against_post_save",
    description:
      "Assertion evaluation was refreshed against post-save snapshot",
    severity: "advisory",
    passed: assertionsRefreshed,
    ...(!assertionsRefreshed && {
      reason:
        "Assertion evaluation was not refreshed against post-save state.",
    }),
  });

  // ── Derive status ──────────────────────────────────────────────
  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );
  const informationalFailures = checks.filter(
    (c) => c.severity === "informational" && !c.passed
  );

  let status: PortalNextTabPreflightStatus;
  if (!job.saveAttempt || !hasReconciliation) {
    status = "not_ready";
  } else if (blockingFailures.length > 0) {
    status = "blocking_issues";
  } else if (advisoryFailures.length > 0) {
    status = "review_required";
  } else {
    status = "eligible_for_later_attempt";
  }

  // ── Build guard ────────────────────────────────────────────────
  const guard = buildGuard(checks, observedState, status);

  // ── Build reasons ──────────────────────────────────────────────
  const blockingReasons = blockingFailures.map(
    (c) => c.reason ?? c.description
  );
  const advisoryReasons = advisoryFailures.map(
    (c) => c.reason ?? c.description
  );

  // ── Build explanation ──────────────────────────────────────────
  const nextTabDesc = nextTab
    ? `${nextTab.tabLabel} (${nextTab.tabKey})`
    : "unknown";

  let explanation: string;
  if (status === "eligible_for_later_attempt") {
    explanation =
      `Next-tab progression preflight passed. The immediate next tab "${nextTabDesc}" ` +
      `is internally eligible for a later guarded progression attempt. ` +
      `No next-tab click has been performed.`;
  } else if (status === "review_required") {
    explanation =
      `Next-tab progression preflight has no blocking issues but found ` +
      `${advisoryFailures.length} advisory condition(s) for "${nextTabDesc}". ` +
      `Advisory: ${advisoryReasons.join("; ")}`;
  } else if (status === "blocking_issues") {
    explanation =
      `Next-tab progression preflight found ${blockingFailures.length} blocking issue(s) ` +
      `for "${nextTabDesc}". Blocking: ${blockingReasons.join("; ")}`;
  } else {
    explanation =
      "Next-tab progression preflight cannot be evaluated — " +
      "required prior layers are missing.";
  }

  return {
    status,
    lane,
    evaluatedAt: now,
    currentTabKey,
    nextTabObservedState: observedState,
    checks,
    guard,
    summary: {
      totalChecks: checks.length,
      passedCount: checks.filter((c) => c.passed).length,
      blockingFailures: blockingFailures.length,
      advisoryFailures: advisoryFailures.length,
      informationalFailures: informationalFailures.length,
    },
    blockingReasons,
    advisoryReasons,
    explanation,
  };
}

// ─── Guard Builder ────────────────────────────────────────────────────

function buildGuard(
  checks: PortalNextTabPreflightCheck[],
  observedState: PortalNextTabObservedState,
  status: PortalNextTabPreflightStatus
): PortalNextTabGuard {
  const reasons: PortalNextTabGuardReason[] = [];

  // Map failed checks to guard reasons
  for (const check of checks) {
    if (check.passed) continue;

    switch (check.checkId) {
      case "save_attempt_completed":
        reasons.push("save_attempt_missing_or_failed");
        break;
      case "reconciliation_exists":
      case "reconciliation_no_blocking":
        reasons.push("reconciliation_missing_or_blocking");
        break;
      case "no_blocking_assertion_mismatch":
        reasons.push("blocking_assertion_mismatch_post_save");
        break;
      case "expected_next_tab_known":
        reasons.push("expected_next_tab_unknown");
        break;
      case "no_observed_post_save_error":
        reasons.push("observed_post_save_error");
        break;
      case "no_unintended_progression":
        reasons.push("unintended_progression_detected");
        break;
      case "post_save_snapshot_exists":
        reasons.push("post_save_snapshot_missing");
        break;
      case "next_tab_availability_signal":
        if (observedState.availability === "unknown") {
          reasons.push("next_tab_availability_unknown");
        } else if (observedState.availability === "observed_disabled") {
          reasons.push("next_tab_observed_disabled");
        } else {
          reasons.push("next_tab_availability_inferred_not_confirmed");
        }
        break;
      case "post_save_evidence_complete":
        reasons.push("post_save_evidence_incomplete");
        break;
      case "assertions_refreshed_against_post_save":
        reasons.push("low_readback_confidence_on_critical_fields");
        break;
    }
  }

  // Deduplicate
  const uniqueReasons = [...new Set(reasons)];

  let decision: "refused" | "review_gated" | "permitted";
  let explanation: string;

  if (status === "not_ready" || status === "blocking_issues") {
    decision = "refused";
    explanation =
      uniqueReasons.length > 0
        ? `Progression refused: ${uniqueReasons.join(", ").replace(/_/g, " ")}.`
        : "Progression refused — required prior layers are missing.";
  } else if (status === "review_required") {
    decision = "review_gated";
    explanation =
      `Progression requires human review before proceeding: ${uniqueReasons.join(", ").replace(/_/g, " ")}.`;
  } else {
    decision = "permitted";
    explanation =
      "All progression checks passed. Next-tab progression is internally permitted for a later guarded attempt.";
  }

  return { decision, reasons: uniqueReasons, explanation };
}
