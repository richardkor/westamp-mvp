/**
 * WeStamp — Bahagian A Next-Field Preflight Evaluator
 *
 * Evaluates whether a future second Bahagian A field-fill attempt could
 * later be internally eligible, and identifies the preferred next candidate.
 *
 * Grounded in:
 * - First-field fill attempt result
 * - First-field post-fill reconciliation
 * - Bahagian A entry-state / schema grounding
 * - Fill-preflight / fill authorization context
 *
 * This is a pure evaluator — no browser interaction, no portal mutation,
 * no field filling.
 *
 * Does NOT:
 * - Fill a second field
 * - Save Bahagian A
 * - Navigate to any other tab
 * - Upload, pay, or submit
 */

import { StampingJob } from "./stamping-types";
import {
  PortalBahagianANextFieldPreflight,
  PortalBahagianANextFieldPreflightStatus,
  PortalBahagianANextFieldPreflightCheck,
  PortalBahagianANextFieldGuard,
  PortalBahagianANextFieldGuardReason,
  PortalBahagianANextFieldCandidate,
  PortalObservedField,
  PortalSchemaGroundingEntry,
  PortalLane,
} from "./stsds-types";

// ─── Candidate Selection ──────────────────────────────────────────

/**
 * Identify all remaining grounded editable candidates, excluding
 * the field that was already filled in the first attempt.
 */
function findRemainingCandidates(
  job: StampingJob
): {
  observed: PortalObservedField;
  grounding: PortalSchemaGroundingEntry;
}[] {
  if (!job.bahagianAEntryState) return [];

  const { groundingEntries } = job.bahagianAEntryState;
  const firstFilledIndex = job.bahagianAFillAttempt?.target?.observedFieldIndex;

  const candidates: {
    observed: PortalObservedField;
    grounding: PortalSchemaGroundingEntry;
  }[] = [];

  for (const entry of groundingEntries) {
    if (entry.match !== "matched") continue;
    if (!entry.observedField) continue;
    if (entry.observedField.mode !== "editable") continue;
    // Exclude the already-filled field
    if (
      firstFilledIndex !== undefined &&
      entry.observedField.index === firstFilledIndex
    ) {
      continue;
    }
    candidates.push({
      observed: entry.observedField,
      grounding: entry,
    });
  }

  return candidates;
}

/**
 * Select the single preferred next candidate from the remaining set.
 *
 * Preference rules:
 * 1. text_input fields first (safest)
 * 2. Fields that are currently empty
 * 3. Lowest index (natural page order)
 *
 * Returns null if no candidates exist.
 */
function selectNextCandidate(
  candidates: { observed: PortalObservedField; grounding: PortalSchemaGroundingEntry }[]
): PortalBahagianANextFieldCandidate | null {
  if (candidates.length === 0) return null;

  // Sort: text_input first, then empty first, then by index
  const sorted = [...candidates].sort((a, b) => {
    const aText = a.observed.typeHint === "text_input" ? 0 : 1;
    const bText = b.observed.typeHint === "text_input" ? 0 : 1;
    if (aText !== bText) return aText - bText;

    const aEmpty = !a.observed.currentValue || a.observed.currentValue.trim() === "";
    const bEmpty = !b.observed.currentValue || b.observed.currentValue.trim() === "";
    if (aEmpty && !bEmpty) return -1;
    if (!aEmpty && bEmpty) return 1;

    return a.observed.index - b.observed.index;
  });

  const selected = sorted[0];
  const isTextInput = selected.observed.typeHint === "text_input";
  const isEmpty = !selected.observed.currentValue || selected.observed.currentValue.trim() === "";
  const isUnambiguous = candidates.length === 1 || isTextInput;

  // Use a test marker as the intended value (consistent with first fill pattern)
  const intendedValue = "WeStamp-Test-Fill-2";

  return {
    observedFieldIndex: selected.observed.index,
    labelText: selected.observed.labelText,
    schemaFieldKey: selected.grounding.schemaFieldKey,
    schemaFieldLabel: selected.grounding.schemaFieldLabel,
    intendedValue,
    valueSource: "test_marker",
    selectionBasis:
      `Next grounded editable ${selected.observed.typeHint} field: "${selected.observed.labelText}" ` +
      `(schema: "${selected.grounding.schemaFieldLabel ?? "unknown"}"). ` +
      (isEmpty ? "Field is currently empty. " : `Field has existing value: "${selected.observed.currentValue}". `) +
      (isUnambiguous
        ? "Selection is unambiguous."
        : `${candidates.length} candidates remain — this was preferred by type/emptiness/order.`),
    isUnambiguous,
  };
}

// ─── Main Evaluator ───────────────────────────────────────────────

/**
 * Evaluate the Bahagian A next-field preflight for a job.
 *
 * Determines whether a future second Bahagian A field-fill attempt could
 * later be internally eligible, based on the first fill result,
 * post-fill reconciliation, entry-state, and grounding.
 *
 * Returns null only if routing suggestion is completely absent.
 */
export function evaluateBahagianANextFieldPreflight(
  job: StampingJob
): PortalBahagianANextFieldPreflight | null {
  const now = new Date().toISOString();

  if (!job.routingSuggestion) return null;

  const lane: PortalLane = job.routingSuggestion.suggestedLane;
  const checks: PortalBahagianANextFieldPreflightCheck[] = [];

  // ── Check 1: First fill attempt exists ──────────────────────────
  const hasFirstFill = !!job.bahagianAFillAttempt;
  checks.push({
    checkId: "first_fill_attempt_exists",
    description: "A first Bahagian A fill attempt has been performed",
    severity: "blocking",
    passed: hasFirstFill,
    ...(!hasFirstFill && {
      reason: "No first Bahagian A fill attempt exists.",
    }),
  });

  // ── Check 2: First fill attempt completed (not failed/blocked) ──
  const firstFillCompleted =
    hasFirstFill &&
    job.bahagianAFillAttempt!.status === "completed_with_stop";
  checks.push({
    checkId: "first_fill_attempt_completed",
    description:
      "First fill attempt completed with stop (not failed or blocked)",
    severity: "blocking",
    passed: firstFillCompleted,
    ...(!firstFillCompleted &&
      hasFirstFill && {
        reason: `First fill attempt status is "${job.bahagianAFillAttempt!.status}" — must be "completed_with_stop".`,
      }),
  });

  // ── Check 3: Post-fill reconciliation exists ────────────────────
  const hasRecon = !!job.bahagianAPostFillReconciliation;
  checks.push({
    checkId: "post_fill_reconciliation_exists",
    description:
      "Post-fill reconciliation has been evaluated for the first fill attempt",
    severity: "blocking",
    passed: hasRecon,
    ...(!hasRecon && {
      reason:
        "No post-fill reconciliation exists. Evaluate it before considering a next field.",
    }),
  });

  // ── Check 4: Post-fill reconciliation is not blocking/failed ────
  const reconStatus = job.bahagianAPostFillReconciliation?.status;
  const reconNotBlocking =
    hasRecon &&
    reconStatus !== "blocking_issue" &&
    reconStatus !== "fill_attempt_failed" &&
    reconStatus !== "not_ready";
  checks.push({
    checkId: "post_fill_reconciliation_not_blocking",
    description:
      "Post-fill reconciliation has no blocking issues or failures",
    severity: "blocking",
    passed: reconNotBlocking,
    ...(!reconNotBlocking &&
      hasRecon && {
        reason: `Post-fill reconciliation status is "${reconStatus}" — must be "stopped_cleanly" or "review_required".`,
      }),
  });

  // ── Check 5: Bahagian A entry-state exists and was observed ─────
  const hasEntryState =
    !!job.bahagianAEntryState && job.bahagianAEntryState.tabObserved;
  checks.push({
    checkId: "entry_state_exists",
    description: "Bahagian A entry-state exists and was observed",
    severity: "blocking",
    passed: hasEntryState,
    ...(!hasEntryState && {
      reason: "No observed Bahagian A entry-state exists.",
    }),
  });

  // ── Find remaining candidates ───────────────────────────────────
  const remainingCandidates = findRemainingCandidates(job);
  const remainingCandidateCount = remainingCandidates.length;

  // ── Check 6: At least one additional grounded editable candidate ─
  const hasAdditionalCandidate = remainingCandidateCount > 0;
  checks.push({
    checkId: "has_additional_candidate",
    description:
      "At least one additional grounded editable field exists beyond the first filled field",
    severity: "blocking",
    passed: hasAdditionalCandidate,
    ...(!hasAdditionalCandidate && {
      reason:
        "No additional grounded editable candidates remain after the first fill. " +
        "All matched editable fields may have already been filled or none were grounded.",
    }),
  });

  // ── Select the preferred next candidate ─────────────────────────
  const nextCandidate = selectNextCandidate(remainingCandidates);

  // ── Check 7: Candidate selection is unambiguous ─────────────────
  const isUnambiguous = nextCandidate?.isUnambiguous ?? false;
  checks.push({
    checkId: "candidate_selection_unambiguous",
    description:
      "Next candidate field can be selected without ambiguity",
    severity: "advisory",
    passed: isUnambiguous || !hasAdditionalCandidate,
    ...(!isUnambiguous &&
      hasAdditionalCandidate && {
        reason:
          `${remainingCandidateCount} candidates remain and the preferred selection is weakly preferred. ` +
          "Human review recommended before filling.",
      }),
  });

  // ── Check 8: No visible portal validation/error from first fill ─
  const firstFillMessage =
    job.bahagianAFillAttempt?.evidence?.observedPortalMessage ?? "";
  const hasVisibleError =
    firstFillMessage.toLowerCase().includes("ralat") ||
    firstFillMessage.toLowerCase().includes("error") ||
    firstFillMessage.toLowerCase().includes("validation") ||
    firstFillMessage.toLowerCase().includes("sila");
  checks.push({
    checkId: "no_visible_portal_error_after_first_fill",
    description:
      "No visible portal validation or error message remains after the first fill",
    severity: "blocking",
    passed: !hasVisibleError,
    ...(hasVisibleError && {
      reason: `Visible portal message after first fill: "${firstFillMessage}"`,
    }),
  });

  // ── Check 9: No evidence of unstable Bahagian A state ───────────
  const firstFillNotes = job.bahagianAFillAttempt?.notes ?? [];
  const evidenceNotes = job.bahagianAFillAttempt?.evidence?.notes ?? [];
  const allNotes = [...firstFillNotes, ...evidenceNotes];
  const hasUnstableIndicator = allNotes.some(
    (n) =>
      n.toLowerCase().includes("unstable") ||
      n.toLowerCase().includes("unexpected") ||
      n.toLowerCase().includes("crash") ||
      n.toLowerCase().includes("timeout")
  );
  checks.push({
    checkId: "no_unstable_state",
    description:
      "No evidence suggests unstable or unexpected Bahagian A state after first fill",
    severity: "blocking",
    passed: !hasUnstableIndicator,
    ...(hasUnstableIndicator && {
      reason:
        "Notes from first fill attempt suggest unstable or unexpected state.",
    }),
  });

  // ── Check 10: No unintended second fill or progression ──────────
  const hasSecondFillOrProgression = allNotes.some(
    (n) =>
      n.toLowerCase().includes("second field") ||
      n.toLowerCase().includes("additional field") ||
      n.toLowerCase().includes("bahagian b") ||
      n.toLowerCase().includes("tab progression")
  );
  checks.push({
    checkId: "no_unintended_second_fill_or_progression",
    description:
      "No evidence of unintended second fill or later-tab progression from first attempt",
    severity: "blocking",
    passed: !hasSecondFillOrProgression,
    ...(hasSecondFillOrProgression && {
      reason:
        "Notes suggest a second fill or later progression may have already occurred.",
    }),
  });

  // ── Check 11 (advisory): Next candidate has text_input type ─────
  const candidateIsTextInput =
    nextCandidate !== null &&
    remainingCandidates.find(
      (c) => c.observed.index === nextCandidate.observedFieldIndex
    )?.observed.typeHint === "text_input";
  checks.push({
    checkId: "candidate_is_text_input",
    description:
      "Preferred next candidate is a text_input field (safest for automated fill)",
    severity: "advisory",
    passed: candidateIsTextInput || !hasAdditionalCandidate,
    ...(!candidateIsTextInput &&
      hasAdditionalCandidate && {
        reason:
          `Next candidate "${nextCandidate?.labelText}" type hint is not text_input — ` +
          "fill may require different interaction strategy.",
      }),
  });

  // ── Check 12 (informational): Post-fill reconciliation was clean ─
  const reconClean = reconStatus === "stopped_cleanly";
  checks.push({
    checkId: "post_fill_reconciliation_clean",
    description:
      "Post-fill reconciliation stopped cleanly (informational baseline)",
    severity: "informational",
    passed: reconClean,
    ...(!reconClean &&
      hasRecon && {
        reason: `Post-fill reconciliation status is "${reconStatus}" — not "stopped_cleanly".`,
      }),
  });

  // ── Build first-filled-field reference ──────────────────────────
  const firstFilledField = job.bahagianAFillAttempt?.target
    ? {
        labelText: job.bahagianAFillAttempt.target.labelText,
        schemaFieldKey: job.bahagianAFillAttempt.target.schemaFieldKey,
        observedFieldIndex: job.bahagianAFillAttempt.target.observedFieldIndex,
      }
    : undefined;

  // ── Derive guard, status, and build result ──────────────────────
  const guard = deriveGuard(checks, reconStatus, hasAdditionalCandidate, nextCandidate);
  const status = deriveStatus(checks);

  return buildResult({
    status,
    lane,
    evaluatedAt: now,
    firstFilledField,
    nextCandidate: nextCandidate ?? undefined,
    remainingCandidateCount,
    checks,
    guard,
  });
}

// ─── Internal Helpers ─────────────────────────────────────────────────

function deriveStatus(
  checks: PortalBahagianANextFieldPreflightCheck[]
): PortalBahagianANextFieldPreflightStatus {
  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  if (blockingFailures.length > 0) {
    // Distinguish "not_ready" (missing prerequisites) from "blocking_issues"
    const missingPrereqs = blockingFailures.some(
      (c) =>
        c.checkId === "first_fill_attempt_exists" ||
        c.checkId === "post_fill_reconciliation_exists" ||
        c.checkId === "entry_state_exists"
    );
    if (missingPrereqs) return "not_ready";
    return "blocking_issues";
  }

  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );
  if (advisoryFailures.length > 0) return "review_required";

  return "eligible_for_later_next_field_attempt";
}

function deriveGuard(
  checks: PortalBahagianANextFieldPreflightCheck[],
  reconStatus: string | undefined,
  hasAdditionalCandidate: boolean,
  nextCandidate: PortalBahagianANextFieldCandidate | null
): PortalBahagianANextFieldGuard {
  const reasons: PortalBahagianANextFieldGuardReason[] = [];

  const failedCheckIds = new Set(
    checks.filter((c) => !c.passed).map((c) => c.checkId)
  );

  // Blocking guard reasons
  if (failedCheckIds.has("first_fill_attempt_exists")) {
    reasons.push("first_fill_attempt_missing");
  }
  if (failedCheckIds.has("first_fill_attempt_completed")) {
    reasons.push("first_fill_attempt_failed");
  }
  if (failedCheckIds.has("post_fill_reconciliation_exists")) {
    reasons.push("first_fill_reconciliation_missing");
  }
  if (failedCheckIds.has("post_fill_reconciliation_not_blocking")) {
    // This check only fails for blocking_issue, fill_attempt_failed, or not_ready.
    // All three are genuine blocking conditions — map them accordingly.
    reasons.push("first_fill_reconciliation_blocking");
  }
  // Separately: if reconciliation exists but is merely review_required (not blocking),
  // that is an advisory condition — not a refusal.
  if (
    reconStatus === "review_required" &&
    !failedCheckIds.has("post_fill_reconciliation_not_blocking")
  ) {
    reasons.push("first_fill_reconciliation_not_clean");
  }
  if (failedCheckIds.has("entry_state_exists")) {
    reasons.push("entry_state_missing");
  }
  if (failedCheckIds.has("has_additional_candidate")) {
    reasons.push("no_additional_grounded_editable_candidate");
  }
  if (failedCheckIds.has("no_visible_portal_error_after_first_fill")) {
    reasons.push("visible_portal_error_after_first_fill");
  }
  if (failedCheckIds.has("no_unstable_state")) {
    reasons.push("unstable_bahagian_a_state");
  }
  if (failedCheckIds.has("no_unintended_second_fill_or_progression")) {
    reasons.push("unintended_progression_detected");
  }

  // Advisory guard reasons
  if (failedCheckIds.has("candidate_selection_unambiguous")) {
    reasons.push("candidate_selection_ambiguous");
  }
  if (failedCheckIds.has("candidate_is_text_input")) {
    reasons.push("candidate_mapping_partial");
  }

  // Determine decision
  const blockingReasons = reasons.filter((r) =>
    [
      "first_fill_attempt_missing",
      "first_fill_attempt_failed",
      "first_fill_reconciliation_missing",
      "first_fill_reconciliation_blocking",
      "entry_state_missing",
      "no_additional_grounded_editable_candidate",
      "visible_portal_error_after_first_fill",
      "unstable_bahagian_a_state",
      "unintended_progression_detected",
    ].includes(r)
  );

  const advisoryReasons = reasons.filter((r) =>
    [
      "first_fill_reconciliation_not_clean",
      "candidate_selection_ambiguous",
      "candidate_value_source_missing",
      "candidate_mapping_partial",
      "candidate_readback_confidence_low",
    ].includes(r)
  );

  let decision: "refused" | "review_gated" | "permitted";
  let explanation: string;

  if (blockingReasons.length > 0) {
    decision = "refused";
    explanation =
      `Next-field fill is refused: ${blockingReasons.length} blocking reason(s). ` +
      "Resolve all blocking issues before a second fill attempt can be considered.";
  } else if (advisoryReasons.length > 0) {
    decision = "review_gated";
    explanation =
      `Next-field fill is review-gated: ${advisoryReasons.length} advisory reason(s). ` +
      "Human review recommended before proceeding with a second fill attempt.";
  } else {
    decision = "permitted";
    explanation =
      "Next-field fill is internally permitted. " +
      "A future second Bahagian A fill attempt could later be allowed via explicit authorization.";
  }

  return { decision, reasons, explanation };
}

interface BuildResultArgs {
  status: PortalBahagianANextFieldPreflightStatus;
  lane: PortalLane;
  evaluatedAt: string;
  firstFilledField?: {
    labelText: string;
    schemaFieldKey?: string;
    observedFieldIndex: number;
  };
  nextCandidate?: PortalBahagianANextFieldCandidate;
  remainingCandidateCount: number;
  checks: PortalBahagianANextFieldPreflightCheck[];
  guard: PortalBahagianANextFieldGuard;
}

function buildResult(
  args: BuildResultArgs
): PortalBahagianANextFieldPreflight {
  const {
    status,
    lane,
    evaluatedAt,
    firstFilledField,
    nextCandidate,
    remainingCandidateCount,
    checks,
    guard,
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

  const advisoryReasons = checks
    .filter((c) => c.severity === "advisory" && !c.passed)
    .map((c) => c.reason ?? c.description);

  let explanation: string;
  if (status === "eligible_for_later_next_field_attempt") {
    explanation =
      "All next-field preflight checks passed. " +
      `${remainingCandidateCount} grounded editable candidate(s) remain. ` +
      (nextCandidate
        ? `Preferred next candidate: "${nextCandidate.labelText}". `
        : "") +
      "A future second Bahagian A field-fill attempt could later be allowed " +
      "via explicit authorization. No second field has been filled.";
  } else if (status === "review_required") {
    explanation =
      `Next-field preflight passed all blocking checks but found ${advisoryFailures} advisory issue(s). ` +
      `Advisory: ${advisoryReasons.join("; ")} ` +
      "Human review recommended before a second fill attempt.";
  } else if (status === "blocking_issues") {
    explanation =
      `Next-field preflight found ${blockingFailures} blocking issue(s). ` +
      `Blocking: ${blockingReasons.join("; ")} ` +
      "Resolve all blocking issues before considering a second fill.";
  } else {
    explanation =
      "Next-field preflight cannot be evaluated — required data is missing. " +
      `Missing: ${blockingReasons.join("; ")}`;
  }

  return {
    status,
    lane,
    evaluatedAt,
    firstFilledField,
    nextCandidate,
    remainingCandidateCount,
    checks,
    guard,
    summary: {
      totalChecks: checks.length,
      passedCount,
      blockingFailures,
      advisoryFailures,
      informationalFailures,
    },
    blockingReasons,
    advisoryReasons,
    explanation,
  };
}
