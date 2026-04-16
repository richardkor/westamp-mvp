/**
 * WeStamp — Post-Save Reconciliation Evaluator
 *
 * Evaluates the immediate outcome of the first Maklumat Am save attempt
 * and classifies the stop state.
 *
 * Key design: assertions are REFRESHED against the post-save observed
 * snapshot captured during the save attempt — NOT the pre-save assertion
 * evaluation already stored on the job. This ensures reconciliation
 * reflects actual post-save portal state.
 *
 * Consumes:
 * - Save attempt result (including post-save snapshot)
 * - Assertion evaluation refreshed against the post-save snapshot
 * - Save evidence metadata
 *
 * This is a pure evaluator — no browser interaction, no portal mutation.
 * Produces a structured PortalPostSaveReconciliation result.
 *
 * Does NOT:
 * - Continue to any next tab
 * - Perform uploads, payment, or submission
 * - Modify job status
 */

import { StampingJob } from "./stamping-types";
import {
  PortalPostSaveReconciliation,
  PortalPostSaveReconciliationStatus,
  PortalPostSaveOutcome,
  PortalPostSaveStopReason,
  PortalPostSaveCheck,
  PortalAssertionEvaluation,
  PortalLane,
} from "./stsds-types";
import { evaluatePortalAssertions } from "./stsds-assertions";

/**
 * Evaluate the post-save reconciliation for a job.
 *
 * Requires:
 * - A save attempt exists on the job
 * - Ideally, a postSaveSnapshot on the save attempt (captured after save click)
 *
 * Assertions are explicitly re-evaluated against the post-save snapshot,
 * NOT the pre-save assertionEvaluation on the job.
 *
 * Returns a structured reconciliation or null if no save attempt exists.
 */
export function evaluatePostSaveReconciliation(
  job: StampingJob
): PortalPostSaveReconciliation | null {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";

  const checks: PortalPostSaveCheck[] = [];

  // ── Check 1: Save attempt exists ────────────────────────────────
  const saveAttemptExists = !!job.saveAttempt;
  checks.push({
    checkId: "save_attempt_exists",
    description: "A save attempt record exists on the job",
    severity: "blocking",
    passed: saveAttemptExists,
    ...(!saveAttemptExists && {
      reason: "No save attempt has been performed.",
    }),
  });

  if (!saveAttemptExists) {
    return buildResult({
      status: "not_ready",
      outcome: "post_save_state_incomplete",
      stopReason: "stopped_no_save_attempt",
      lane,
      evaluatedAt: now,
      checks,
      postSaveAssertionEvaluation: null,
      basedOnPostSaveSnapshot: false,
    });
  }

  const attempt = job.saveAttempt!;

  // ── Check 2: Save attempt indicates a real attempt occurred ─────
  const realAttemptOccurred =
    attempt.status === "completed_with_stop" || attempt.status === "failed";
  checks.push({
    checkId: "save_attempt_real",
    description: "Save attempt status indicates a real attempt occurred",
    severity: "blocking",
    passed: realAttemptOccurred,
    ...(!realAttemptOccurred && {
      reason: `Save attempt status is "${attempt.status}" — expected "completed_with_stop" or "failed".`,
    }),
  });

  // ── Check 3: Post-save evidence exists ──────────────────────────
  const hasEvidence = !!attempt.evidence;
  checks.push({
    checkId: "post_save_evidence_exists",
    description: "Post-save evidence (screenshot, portal message) was captured",
    severity: "blocking",
    passed: hasEvidence,
    ...(!hasEvidence && {
      reason: "No post-save evidence was captured during the save attempt.",
    }),
  });

  // ── Check 4: Post-save artifacts exist ──────────────────────────
  const hasArtifacts =
    !!attempt.evidence?.screenshotFilePath ||
    !!attempt.evidence?.screenshotFileName;
  checks.push({
    checkId: "post_save_artifacts_exist",
    description: "Post-save screenshot artifact was captured",
    severity: "advisory",
    passed: hasArtifacts,
    ...(!hasArtifacts && {
      reason: "No post-save screenshot artifact reference found.",
    }),
  });

  // ── Check 5: No visible portal error/validation message ─────────
  const observedMessage = attempt.evidence?.observedPortalMessage ?? "";
  const hasVisibleError =
    observedMessage.toLowerCase().includes("ralat") ||
    observedMessage.toLowerCase().includes("error") ||
    observedMessage.toLowerCase().includes("validation");
  checks.push({
    checkId: "no_visible_portal_error",
    description: "No visible portal error or validation message after save",
    severity: "blocking",
    passed: !hasVisibleError,
    ...(hasVisibleError && {
      reason: `Visible portal error detected: "${observedMessage}"`,
    }),
  });

  // ── Check 6: Save outcome is success-like ───────────────────────
  const outcomeValue = attempt.evidence?.outcome ?? "unknown";
  const isSuccessOutcome = outcomeValue === "success_message";
  checks.push({
    checkId: "save_outcome_success",
    description: "Save outcome indicates a success/accepted state",
    severity: "blocking",
    passed: isSuccessOutcome,
    ...(!isSuccessOutcome && {
      reason: `Save outcome is "${outcomeValue}" — expected "success_message".`,
    }),
  });

  // ── Check 7: No unintended next-tab progression ─────────────────
  const hasTabProgression = attempt.notes.some(
    (n) =>
      n.toLowerCase().includes("next tab") ||
      n.toLowerCase().includes("continue to tab") ||
      n.toLowerCase().includes("tab progression")
  );
  checks.push({
    checkId: "no_unintended_tab_progression",
    description: "No unintended next-tab progression occurred after save",
    severity: "blocking",
    passed: !hasTabProgression,
    ...(hasTabProgression && {
      reason:
        "Notes indicate possible next-tab progression — automation should have stopped after save.",
    }),
  });

  // ── Refresh assertions against the POST-SAVE snapshot ───────────
  // This is the core distinction: we do NOT use job.assertionEvaluation
  // (which was evaluated pre-save). Instead, we re-run assertions against
  // the post-save snapshot captured after the save click.
  const postSaveSnapshot = attempt.postSaveSnapshot ?? null;
  const basedOnPostSaveSnapshot = !!postSaveSnapshot;

  let postSaveAssertionEvaluation: PortalAssertionEvaluation | null = null;

  if (postSaveSnapshot && job.routingSuggestion) {
    postSaveAssertionEvaluation = evaluatePortalAssertions(
      job,
      postSaveSnapshot
    );
  }

  // ── Check 8: Post-save snapshot exists ──────────────────────────
  checks.push({
    checkId: "post_save_snapshot_exists",
    description:
      "Post-save observed snapshot was captured (Maklumat Am field readback after save)",
    severity: "advisory",
    passed: basedOnPostSaveSnapshot,
    ...(!basedOnPostSaveSnapshot && {
      reason:
        "No post-save snapshot was captured — assertion refresh could not be performed against post-save state.",
    }),
  });

  // ── Check 9: Post-save assertion evaluation produced ────────────
  const hasRefreshedAssertions = !!postSaveAssertionEvaluation;
  checks.push({
    checkId: "post_save_assertion_evaluation_refreshed",
    description:
      "Assertion evaluation was refreshed against the post-save snapshot (not pre-save state)",
    severity: "advisory",
    passed: hasRefreshedAssertions,
    ...(!hasRefreshedAssertions && {
      reason: basedOnPostSaveSnapshot
        ? "Post-save snapshot exists but assertion evaluation could not be produced."
        : "No post-save snapshot available — assertions evaluated against pre-save state would be stale.",
    }),
  });

  // ── Check 10: No blocking assertion mismatch after save ─────────
  // Uses the REFRESHED post-save assertion evaluation, not the stale
  // pre-save one on the job.
  const blockingAssertionMismatches =
    postSaveAssertionEvaluation?.summary?.blockingMismatchCount ?? 0;
  const noBlockingAssertionMismatch =
    !hasRefreshedAssertions || blockingAssertionMismatches === 0;
  checks.push({
    checkId: "no_blocking_assertion_mismatch_post_save",
    description:
      "No blocking assertion mismatches remain in post-save refreshed evaluation",
    severity: "blocking",
    passed: noBlockingAssertionMismatch,
    ...(!noBlockingAssertionMismatch && {
      reason: `${blockingAssertionMismatches} blocking assertion mismatch(es) remain after save (evaluated against post-save snapshot).`,
    }),
  });

  // ── Derive status, outcome, and stop reason ─────────────────────
  return buildResult({
    status: deriveStatus(checks, attempt.status),
    outcome: deriveOutcome(checks, attempt.status),
    stopReason: deriveStopReason(checks, attempt.status, outcomeValue),
    lane,
    evaluatedAt: now,
    checks,
    postSaveAssertionEvaluation,
    basedOnPostSaveSnapshot,
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────────

function deriveStatus(
  checks: PortalPostSaveCheck[],
  attemptStatus: string
): PortalPostSaveReconciliationStatus {
  if (attemptStatus === "blocked") return "not_ready";
  if (attemptStatus === "failed") return "save_failed";

  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  if (blockingFailures.length > 0) return "blocking_issue";

  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );
  if (advisoryFailures.length > 0) return "review_required";

  return "stopped_cleanly";
}

function deriveOutcome(
  checks: PortalPostSaveCheck[],
  attemptStatus: string
): PortalPostSaveOutcome {
  if (attemptStatus === "failed") return "save_attempt_failed";
  if (attemptStatus === "blocked") return "post_save_state_incomplete";

  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  if (blockingFailures.length > 0) return "save_observed_with_blocking_issue";

  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );
  if (advisoryFailures.length > 0) return "save_observed_but_review_required";

  return "save_observed_and_stopped_cleanly";
}

function deriveStopReason(
  checks: PortalPostSaveCheck[],
  attemptStatus: string,
  outcomeValue: string
): PortalPostSaveStopReason {
  if (attemptStatus === "blocked") return "stopped_no_save_attempt";
  if (attemptStatus === "failed") return "stopped_due_to_save_failure";

  const failedCheckIds = new Set(
    checks.filter((c) => !c.passed).map((c) => c.checkId)
  );

  if (failedCheckIds.has("no_visible_portal_error")) {
    return "stopped_due_to_visible_validation_error";
  }
  if (failedCheckIds.has("post_save_evidence_exists")) {
    return "stopped_due_to_missing_post_save_snapshot";
  }
  if (failedCheckIds.has("no_blocking_assertion_mismatch_post_save")) {
    return "stopped_due_to_post_save_blocking_mismatch";
  }
  if (
    failedCheckIds.has("no_unintended_tab_progression") ||
    outcomeValue === "unknown"
  ) {
    return "stopped_due_to_unexpected_portal_state";
  }

  return "stopped_after_expected_save_observation";
}

interface BuildResultArgs {
  status: PortalPostSaveReconciliationStatus;
  outcome: PortalPostSaveOutcome;
  stopReason: PortalPostSaveStopReason;
  lane: PortalLane;
  evaluatedAt: string;
  checks: PortalPostSaveCheck[];
  postSaveAssertionEvaluation: PortalAssertionEvaluation | null;
  basedOnPostSaveSnapshot: boolean;
}

function buildResult(args: BuildResultArgs): PortalPostSaveReconciliation {
  const {
    status,
    outcome,
    stopReason,
    lane,
    evaluatedAt,
    checks,
    postSaveAssertionEvaluation,
    basedOnPostSaveSnapshot,
  } = args;

  const passedCount = checks.filter((c) => c.passed).length;
  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  ).length;
  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  ).length;

  const blockingReasons = checks
    .filter((c) => c.severity === "blocking" && !c.passed)
    .map((c) => c.reason ?? c.description);

  const reviewReasons = checks
    .filter((c) => c.severity === "advisory" && !c.passed)
    .map((c) => c.reason ?? c.description);

  const postSaveAssertionStatus =
    postSaveAssertionEvaluation?.status ?? undefined;

  // Build explanation — explicitly state whether based on post-save snapshot
  const snapshotBasis = basedOnPostSaveSnapshot
    ? "Assertions were refreshed against the post-save observed snapshot."
    : "No post-save snapshot was available — assertion-based checks could not use post-save state.";

  let explanation: string;
  if (status === "stopped_cleanly") {
    explanation =
      "Save attempt completed and automation stopped cleanly. " +
      "All post-save checks passed. No blocking issues detected. " +
      snapshotBasis;
  } else if (status === "save_failed") {
    explanation =
      "Save attempt failed. " +
      (blockingReasons.length > 0
        ? `Blocking: ${blockingReasons.join("; ")} `
        : "Review the save attempt notes for details. ") +
      snapshotBasis;
  } else if (status === "blocking_issue") {
    explanation =
      `Post-save reconciliation found ${blockingFailures} blocking issue(s). ` +
      `Blocking: ${blockingReasons.join("; ")} ` +
      snapshotBasis;
  } else if (status === "review_required") {
    explanation =
      `Post-save reconciliation passed all blocking checks but found ${advisoryFailures} advisory issue(s). ` +
      `Advisory: ${reviewReasons.join("; ")} ` +
      snapshotBasis;
  } else {
    explanation =
      "Post-save reconciliation cannot be evaluated — " +
      "required data is missing. " +
      snapshotBasis;
  }

  return {
    status,
    outcome,
    stopReason,
    lane,
    evaluatedAt,
    checks,
    postSaveAssertionStatus,
    postSaveAssertionEvaluation: postSaveAssertionEvaluation ?? undefined,
    basedOnPostSaveSnapshot,
    summary: {
      totalChecks: checks.length,
      passedCount,
      blockingFailures,
      advisoryFailures,
    },
    blockingReasons,
    reviewReasons,
    explanation,
  };
}
