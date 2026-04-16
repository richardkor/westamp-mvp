/**
 * WeStamp — Bahagian A Post-Fill Reconciliation Evaluator
 *
 * Evaluates the immediate outcome of the first Bahagian A single-field
 * fill attempt and classifies the stop state.
 *
 * Grounded in the actual fill attempt result:
 * - target field + intended value
 * - observed post-fill readback
 * - readback match/mismatch
 * - visible portal warnings/errors
 * - evidence artifacts
 *
 * This is a pure evaluator — no browser interaction, no portal mutation.
 * Produces a structured PortalBahagianAPostFillReconciliation result.
 *
 * Does NOT:
 * - Fill a second field
 * - Save Bahagian A
 * - Continue to any later tab
 * - Perform uploads, payment, or submission
 * - Modify job status
 */

import { StampingJob } from "./stamping-types";
import {
  PortalBahagianAPostFillReconciliation,
  PortalBahagianAPostFillReconciliationStatus,
  PortalBahagianAPostFillOutcome,
  PortalBahagianAPostFillStopReason,
  PortalBahagianAPostFillCheck,
  PortalLane,
} from "./stsds-types";

/**
 * Evaluate the Bahagian A post-fill reconciliation for a job.
 *
 * Requires:
 * - A Bahagian A fill attempt exists on the job
 * - The fill attempt should have evidence (readback, screenshot, outcome)
 *
 * Returns a structured reconciliation result.
 */
export function evaluateBahagianAFirstFieldPostFillReconciliation(
  job: StampingJob
): PortalBahagianAPostFillReconciliation {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";

  const checks: PortalBahagianAPostFillCheck[] = [];

  // ── Check 1: Fill attempt exists ───────────────────────────────
  const fillAttemptExists = !!job.bahagianAFillAttempt;
  checks.push({
    checkId: "fill_attempt_exists",
    description: "A Bahagian A fill attempt record exists on the job",
    severity: "blocking",
    passed: fillAttemptExists,
    ...(!fillAttemptExists && {
      reason: "No Bahagian A fill attempt has been performed.",
    }),
  });

  if (!fillAttemptExists) {
    return buildResult({
      status: "not_ready",
      outcome: "post_fill_state_incomplete",
      stopReason: "stopped_no_fill_attempt",
      lane,
      evaluatedAt: now,
      checks,
      basedOnFillAttemptEvidence: false,
    });
  }

  const attempt = job.bahagianAFillAttempt!;

  // ── Check 2: Fill attempt status indicates a real attempt ──────
  const realAttemptOccurred =
    attempt.status === "completed_with_stop" || attempt.status === "failed";
  checks.push({
    checkId: "fill_attempt_real",
    description:
      "Fill attempt status indicates a real attempt occurred (completed_with_stop or failed)",
    severity: "blocking",
    passed: realAttemptOccurred,
    ...(!realAttemptOccurred && {
      reason: `Fill attempt status is "${attempt.status}" — expected "completed_with_stop" or "failed".`,
    }),
  });

  // ── Check 3: Target field exists ──────────────────────────────
  const hasTarget = !!attempt.target;
  checks.push({
    checkId: "target_field_exists",
    description: "A target field was identified for the fill attempt",
    severity: "blocking",
    passed: hasTarget,
    ...(!hasTarget && {
      reason: "No target field was recorded on the fill attempt.",
    }),
  });

  // ── Check 4: Intended value exists ────────────────────────────
  const hasIntendedValue = !!attempt.target?.intendedValue;
  checks.push({
    checkId: "intended_value_exists",
    description: "An intended fill value was recorded",
    severity: "blocking",
    passed: hasIntendedValue,
    ...(!hasIntendedValue && {
      reason: "No intended value was recorded on the fill target.",
    }),
  });

  // ── Check 5: Post-fill evidence exists ────────────────────────
  const hasEvidence = !!attempt.evidence;
  checks.push({
    checkId: "post_fill_evidence_exists",
    description:
      "Post-fill evidence (readback, screenshot, outcome) was captured",
    severity: "blocking",
    passed: hasEvidence,
    ...(!hasEvidence && {
      reason: "No post-fill evidence was captured during the fill attempt.",
    }),
  });

  // ── Check 6: Observed readback exists ─────────────────────────
  const hasReadback =
    hasEvidence && attempt.evidence!.readbackValue !== undefined;
  checks.push({
    checkId: "observed_readback_exists",
    description:
      "A post-fill readback value was captured for the target field",
    severity: "blocking",
    passed: hasReadback,
    ...(!hasReadback && {
      reason:
        "No post-fill readback value was captured — cannot verify fill outcome.",
    }),
  });

  // ── Check 7: Observed value matches intended value ────────────
  const readbackValue = attempt.evidence?.readbackValue ?? null;
  const intendedValue = attempt.target?.intendedValue ?? null;
  const readbackMatch = attempt.evidence?.readbackMatch ?? false;

  // Exact match first, then approved normalization (trim + case)
  let valueMatches = readbackMatch;
  if (
    !valueMatches &&
    readbackValue !== null &&
    intendedValue !== null
  ) {
    valueMatches =
      readbackValue.trim().toLowerCase() ===
      intendedValue.trim().toLowerCase();
  }

  checks.push({
    checkId: "readback_matches_intended",
    description:
      "Observed post-fill readback matches the intended value (exact or normalized)",
    severity: "blocking",
    passed: valueMatches,
    ...(!valueMatches && {
      reason: hasReadback
        ? `Readback value "${readbackValue}" does not match intended value "${intendedValue}".`
        : "Readback not available — match cannot be determined.",
    }),
  });

  // ── Check 8: No visible portal validation/error message ───────
  const observedMessage = attempt.evidence?.observedPortalMessage ?? "";
  const hasVisibleError =
    observedMessage.toLowerCase().includes("ralat") ||
    observedMessage.toLowerCase().includes("error") ||
    observedMessage.toLowerCase().includes("validation") ||
    observedMessage.toLowerCase().includes("sila");
  checks.push({
    checkId: "no_visible_portal_error",
    description:
      "No visible portal validation or error message after the field fill",
    severity: "blocking",
    passed: !hasVisibleError,
    ...(hasVisibleError && {
      reason: `Visible portal message detected after fill: "${observedMessage}"`,
    }),
  });

  // ── Check 9: No evidence of unintended second-field fill ──────
  const fillNotes = attempt.notes ?? [];
  const evidenceNotes = attempt.evidence?.notes ?? [];
  const allNotes = [...fillNotes, ...evidenceNotes];
  const hasSecondFieldIndicator = allNotes.some(
    (n) =>
      n.toLowerCase().includes("second field") ||
      n.toLowerCase().includes("additional field") ||
      n.toLowerCase().includes("next field")
  );
  checks.push({
    checkId: "no_unintended_second_field_fill",
    description:
      "No evidence suggests a second field was unintentionally filled",
    severity: "blocking",
    passed: !hasSecondFieldIndicator,
    ...(hasSecondFieldIndicator && {
      reason:
        "Notes suggest a possible second-field fill — only one field should have been filled.",
    }),
  });

  // ── Check 10: No evidence of later-tab progression ────────────
  const hasTabProgression = allNotes.some(
    (n) =>
      n.toLowerCase().includes("next tab") ||
      n.toLowerCase().includes("tab progression") ||
      n.toLowerCase().includes("bahagian b")
  );
  checks.push({
    checkId: "no_unintended_tab_progression",
    description:
      "No evidence suggests unintended progression beyond Bahagian A",
    severity: "blocking",
    passed: !hasTabProgression,
    ...(hasTabProgression && {
      reason:
        "Notes indicate possible later-tab progression — automation should have stopped after single-field fill.",
    }),
  });

  // ── Check 11: Post-fill evidence artifacts exist ──────────────
  const hasArtifacts =
    !!attempt.evidence?.screenshotFilePath ||
    !!attempt.evidence?.screenshotFileName;
  checks.push({
    checkId: "post_fill_artifacts_exist",
    description: "Post-fill screenshot artifact was captured",
    severity: "advisory",
    passed: hasArtifacts,
    ...(!hasArtifacts && {
      reason: "No post-fill screenshot artifact reference found.",
    }),
  });

  // ── Check 12: Fill attempt outcome is success-like ────────────
  const fillOutcome = attempt.evidence?.outcome ?? "unknown";
  const isSuccessOutcome = fillOutcome === "field_filled_successfully";
  checks.push({
    checkId: "fill_outcome_success",
    description:
      "Fill attempt outcome indicates the field was filled successfully",
    severity: "informational",
    passed: isSuccessOutcome,
    ...(!isSuccessOutcome && {
      reason: `Fill outcome is "${fillOutcome}" — expected "field_filled_successfully".`,
    }),
  });

  // ── Build reconciliation result ────────────────────────────────
  return buildResult({
    status: deriveStatus(checks, attempt.status),
    outcome: deriveOutcome(checks, attempt.status),
    stopReason: deriveStopReason(checks, attempt.status, fillOutcome),
    lane,
    evaluatedAt: now,
    checks,
    basedOnFillAttemptEvidence: hasEvidence,
    targetField: attempt.target
      ? {
          labelText: attempt.target.labelText,
          schemaFieldKey: attempt.target.schemaFieldKey,
          schemaFieldLabel: attempt.target.schemaFieldLabel,
          observedFieldIndex: attempt.target.observedFieldIndex,
        }
      : undefined,
    intendedValue: attempt.target?.intendedValue,
    observedValue: readbackValue,
    readbackMatch: valueMatches,
    fillAttemptOutcome: fillOutcome,
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────────

function deriveStatus(
  checks: PortalBahagianAPostFillCheck[],
  attemptStatus: string
): PortalBahagianAPostFillReconciliationStatus {
  if (attemptStatus === "blocked" || attemptStatus === "not_ready") {
    return "not_ready";
  }
  if (attemptStatus === "failed") return "fill_attempt_failed";

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
  checks: PortalBahagianAPostFillCheck[],
  attemptStatus: string
): PortalBahagianAPostFillOutcome {
  if (attemptStatus === "failed") return "field_fill_attempt_failed";
  if (attemptStatus === "blocked" || attemptStatus === "not_ready") {
    return "post_fill_state_incomplete";
  }

  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  if (blockingFailures.length > 0) {
    return "field_fill_observed_with_blocking_issue";
  }

  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );
  if (advisoryFailures.length > 0) {
    return "field_fill_observed_but_review_required";
  }

  return "field_fill_observed_and_stopped_cleanly";
}

function deriveStopReason(
  checks: PortalBahagianAPostFillCheck[],
  attemptStatus: string,
  fillOutcome: string
): PortalBahagianAPostFillStopReason {
  if (attemptStatus === "blocked" || attemptStatus === "not_ready") {
    return "stopped_no_fill_attempt";
  }
  if (attemptStatus === "failed") return "stopped_due_to_fill_failure";

  const failedCheckIds = new Set(
    checks.filter((c) => !c.passed).map((c) => c.checkId)
  );

  if (failedCheckIds.has("readback_matches_intended")) {
    return "stopped_due_to_readback_mismatch";
  }
  if (failedCheckIds.has("no_visible_portal_error")) {
    return "stopped_due_to_visible_validation_error";
  }
  if (failedCheckIds.has("observed_readback_exists")) {
    return "stopped_due_to_missing_post_fill_readback";
  }
  if (
    failedCheckIds.has("no_unintended_second_field_fill") ||
    failedCheckIds.has("no_unintended_tab_progression") ||
    fillOutcome === "unknown"
  ) {
    return "stopped_due_to_unexpected_field_state";
  }

  return "stopped_after_expected_field_fill_observation";
}

interface BuildResultArgs {
  status: PortalBahagianAPostFillReconciliationStatus;
  outcome: PortalBahagianAPostFillOutcome;
  stopReason: PortalBahagianAPostFillStopReason;
  lane: PortalLane;
  evaluatedAt: string;
  checks: PortalBahagianAPostFillCheck[];
  basedOnFillAttemptEvidence: boolean;
  targetField?: {
    labelText: string;
    schemaFieldKey?: string;
    schemaFieldLabel?: string;
    observedFieldIndex: number;
  };
  intendedValue?: string;
  observedValue?: string | null;
  readbackMatch?: boolean;
  fillAttemptOutcome?: string;
}

function buildResult(
  args: BuildResultArgs
): PortalBahagianAPostFillReconciliation {
  const {
    status,
    outcome,
    stopReason,
    lane,
    evaluatedAt,
    checks,
    basedOnFillAttemptEvidence,
    targetField,
    intendedValue,
    observedValue,
    readbackMatch,
    fillAttemptOutcome,
  } = args;

  const passedCount = checks.filter((c) => c.passed).length;
  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  ).length;
  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  ).length;
  const informationalFailures = checks.filter(
    (c) => c.severity === "informational" && !c.passed
  ).length;

  const blockingReasons = checks
    .filter((c) => c.severity === "blocking" && !c.passed)
    .map((c) => c.reason ?? c.description);

  const reviewReasons = checks
    .filter((c) => c.severity === "advisory" && !c.passed)
    .map((c) => c.reason ?? c.description);

  // Build explanation
  const evidenceBasis = basedOnFillAttemptEvidence
    ? "Reconciliation is grounded in actual fill attempt evidence (readback, screenshot, outcome)."
    : "No fill attempt evidence was available — reconciliation is based on incomplete data.";

  let explanation: string;
  if (status === "stopped_cleanly") {
    explanation =
      "First Bahagian A field fill completed and automation stopped cleanly. " +
      "All post-fill checks passed. No blocking or advisory issues detected. " +
      "No second field was filled. No Bahagian A save was attempted. " +
      evidenceBasis;
  } else if (status === "fill_attempt_failed") {
    explanation =
      "Bahagian A fill attempt failed. " +
      (blockingReasons.length > 0
        ? `Blocking: ${blockingReasons.join("; ")} `
        : "Review the fill attempt notes for details. ") +
      evidenceBasis;
  } else if (status === "blocking_issue") {
    explanation =
      `Post-fill reconciliation found ${blockingFailures} blocking issue(s). ` +
      `Blocking: ${blockingReasons.join("; ")} ` +
      evidenceBasis;
  } else if (status === "review_required") {
    explanation =
      `Post-fill reconciliation passed all blocking checks but found ${advisoryFailures} advisory issue(s). ` +
      `Advisory: ${reviewReasons.join("; ")} ` +
      evidenceBasis;
  } else {
    explanation =
      "Post-fill reconciliation cannot be evaluated — " +
      "required data is missing. " +
      evidenceBasis;
  }

  return {
    status,
    outcome,
    stopReason,
    lane,
    evaluatedAt,
    checks,
    targetField,
    intendedValue,
    observedValue,
    readbackMatch,
    fillAttemptOutcome,
    basedOnFillAttemptEvidence,
    summary: {
      totalChecks: checks.length,
      passedCount,
      blockingFailures,
      advisoryFailures,
      informationalFailures,
    },
    blockingReasons,
    reviewReasons,
    explanation,
  };
}
