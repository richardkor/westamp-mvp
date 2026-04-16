/**
 * WeStamp — Bahagian A Fill Preflight Evaluator
 *
 * Evaluates whether a first Bahagian A field-fill attempt could later
 * be allowed, based on the real observed Bahagian A entry-state and
 * current schema grounding quality.
 *
 * This is a pure evaluator — no browser interaction, no portal mutation,
 * no field filling.
 *
 * Does NOT:
 * - Fill any Bahagian A field
 * - Save Bahagian A
 * - Navigate to any other tab
 * - Upload, pay, or submit
 */

import { StampingJob } from "./stamping-types";
import {
  PortalBahagianAFillPreflight,
  PortalBahagianAFillPreflightStatus,
  PortalBahagianAFillPreflightCheck,
  PortalBahagianAFillGuard,
  PortalBahagianAFillGuardReason,
  PortalBahagianAFieldModeSummary,
  PortalLane,
} from "./stsds-types";

/**
 * Evaluate the Bahagian A fill preflight for a job.
 *
 * Determines whether a first Bahagian A field-fill attempt could later
 * be internally eligible, based on entry-state, schema grounding, and
 * surrounding layers.
 *
 * Returns null only if routing suggestion is completely absent.
 */
export function evaluateBahagianAFillPreflight(
  job: StampingJob
): PortalBahagianAFillPreflight | null {
  const now = new Date().toISOString();

  if (!job.routingSuggestion) return null;

  const lane: PortalLane = job.routingSuggestion.suggestedLane;
  const entryState = job.bahagianAEntryState;
  const groundingStatus = entryState?.status ?? null;

  // ── Compute field mode summary ──────────────────────────────────
  const fieldModeSummary: PortalBahagianAFieldModeSummary = {
    editableCount: 0,
    readOnlyCount: 0,
    derivedCount: 0,
    unknownCount: 0,
  };

  if (entryState?.observedFields) {
    for (const f of entryState.observedFields) {
      if (f.mode === "editable") fieldModeSummary.editableCount++;
      else if (f.mode === "read_only") fieldModeSummary.readOnlyCount++;
      else if (f.mode === "derived") fieldModeSummary.derivedCount++;
      else fieldModeSummary.unknownCount++;
    }
  }

  const checks: PortalBahagianAFillPreflightCheck[] = [];

  // ── Check 1: Bahagian A entry-state exists ────────────────────
  const hasEntryState = !!entryState;
  checks.push({
    checkId: "entry_state_exists",
    description: "Bahagian A entry-state has been captured",
    severity: "blocking",
    passed: hasEntryState,
    ...(!hasEntryState && {
      reason: "No Bahagian A entry-state exists. Capture the entry-state first.",
    }),
  });

  // ── Check 2: Bahagian A was actually observed ─────────────────
  const tabObserved = entryState?.tabObserved === true;
  checks.push({
    checkId: "bahagian_a_observed",
    description: "Bahagian A tab was actually observed in the portal",
    severity: "blocking",
    passed: tabObserved,
    ...(!tabObserved && hasEntryState && {
      reason: "Bahagian A entry-state exists but the tab was not actually observed.",
    }),
    ...(!tabObserved && !hasEntryState && {
      reason: "No entry-state — cannot determine if Bahagian A was observed.",
    }),
  });

  // ── Check 3: Schema grounding exists and is not "not_observed" ─
  const groundingExists =
    hasEntryState && groundingStatus !== null && groundingStatus !== "not_observed";
  checks.push({
    checkId: "schema_grounding_exists",
    description: "Schema grounding result exists for Bahagian A",
    severity: "blocking",
    passed: groundingExists,
    ...(!groundingExists && {
      reason: groundingStatus === "not_observed"
        ? "Schema grounding status is \"not_observed\"."
        : "No schema grounding result available.",
    }),
  });

  // ── Check 4: At least one grounded/matched field ──────────────
  const groundedCount = entryState?.summary?.groundedCount ?? 0;
  const hasGroundedFields = groundedCount > 0;
  checks.push({
    checkId: "has_grounded_fields",
    description: "At least one observed field is matched to a schema entry",
    severity: "blocking",
    passed: hasGroundedFields,
    ...(!hasGroundedFields && {
      reason: `Zero grounded fields. Cannot plan a fill without at least one known field mapping. ` +
        `Observed: ${entryState?.summary?.totalObservedFields ?? 0}, ` +
        `unmatched: ${entryState?.summary?.unmatchedObservedCount ?? 0}.`,
    }),
  });

  // ── Check 5: Not all observed fields are read-only/derived ────
  const totalObserved = entryState?.summary?.totalObservedFields ?? 0;
  const hasEditableFields = fieldModeSummary.editableCount > 0;
  const allReadOnlyOrDerived =
    totalObserved > 0 &&
    fieldModeSummary.editableCount === 0 &&
    fieldModeSummary.unknownCount === 0;
  checks.push({
    checkId: "has_editable_fields",
    description: "At least one observed field appears editable (not read-only/derived)",
    severity: "blocking",
    passed: hasEditableFields,
    ...(!hasEditableFields && totalObserved > 0 && {
      reason: allReadOnlyOrDerived
        ? `All ${totalObserved} observed fields are read-only or derived. No editable fields to fill.`
        : `No editable fields detected. Read-only: ${fieldModeSummary.readOnlyCount}, ` +
          `derived: ${fieldModeSummary.derivedCount}, unknown: ${fieldModeSummary.unknownCount}.`,
    }),
    ...(!hasEditableFields && totalObserved === 0 && {
      reason: "No observed fields at all — cannot determine editability.",
    }),
  });

  // ── Check 6: Next-tab attempt completed into Bahagian A ───────
  const nextTabAttemptOk =
    !!job.nextTabAttempt &&
    job.nextTabAttempt.status === "completed_with_stop" &&
    job.nextTabAttempt.toTabKey === "bahagian_a";
  checks.push({
    checkId: "next_tab_attempt_completed",
    description: "Next-tab attempt completed successfully into Bahagian A",
    severity: "blocking",
    passed: nextTabAttemptOk,
    ...(!nextTabAttemptOk && {
      reason: !job.nextTabAttempt
        ? "No next-tab attempt has been performed."
        : job.nextTabAttempt.toTabKey !== "bahagian_a"
          ? `Next-tab attempt targeted "${job.nextTabAttempt.toTabKey}" — expected "bahagian_a".`
          : `Next-tab attempt status is "${job.nextTabAttempt.status}" — must be "completed_with_stop".`,
    }),
  });

  // ── Check 7: Lane is known ────────────────────────────────────
  const laneKnown =
    lane === "sewa_pajakan" || lane === "penyeteman_am";
  checks.push({
    checkId: "lane_known",
    description: "Portal lane is known and supported",
    severity: "blocking",
    passed: laneKnown,
    ...(!laneKnown && {
      reason: `Lane is "${lane}" — must be "sewa_pajakan" or "penyeteman_am".`,
    }),
  });

  // ── Check 8: No unintended progression beyond Bahagian A ──────
  // Check if the next-tab attempt evidence suggests we went past Bahagian A
  const nextTabOutcome = job.nextTabAttempt?.evidence?.outcome;
  const observedTabLabel = job.nextTabAttempt?.evidence?.observedTabLabel;
  const unintendedProgression =
    !!observedTabLabel &&
    !observedTabLabel.toLowerCase().includes("bahagian a") &&
    !observedTabLabel.toLowerCase().includes("bahagian_a") &&
    nextTabOutcome === "tab_became_active";
  checks.push({
    checkId: "no_unintended_progression",
    description: "No evidence of unintended progression beyond Bahagian A",
    severity: "blocking",
    passed: !unintendedProgression,
    ...(unintendedProgression && {
      reason: `Observed active tab label "${observedTabLabel}" does not match Bahagian A. ` +
        `Possible unintended progression beyond the expected tab.`,
    }),
  });

  // ── Check 9 (advisory): Grounding quality is at least partial ─
  const groundingQualityOk =
    groundingStatus === "partially_matched" ||
    groundingStatus === "ready_for_review";
  checks.push({
    checkId: "grounding_quality_adequate",
    description: "Schema grounding quality is at least partially matched",
    severity: "advisory",
    passed: groundingQualityOk,
    ...(!groundingQualityOk && groundingExists && {
      reason: `Schema grounding status is "${groundingStatus}" — ` +
        `partial or full matching recommended before fill.`,
    }),
  });

  // ── Check 10 (advisory): No unknown field modes ──────────────
  const noUnknownModes = fieldModeSummary.unknownCount === 0;
  checks.push({
    checkId: "no_unknown_field_modes",
    description: "All observed field modes are determined (no unknowns)",
    severity: "advisory",
    passed: noUnknownModes,
    ...(!noUnknownModes && {
      reason: `${fieldModeSummary.unknownCount} field(s) have unknown mode — ` +
        `fill behavior for these fields cannot be predicted.`,
    }),
  });

  // ── Check 11 (advisory): No expected-but-missing schema fields
  const expectedMissing = entryState?.summary?.expectedButNotObservedCount ?? 0;
  const noExpectedMissing = expectedMissing === 0;
  checks.push({
    checkId: "no_expected_missing_fields",
    description: "All expected schema fields were observed",
    severity: "advisory",
    passed: noExpectedMissing,
    ...(!noExpectedMissing && {
      reason: `${expectedMissing} schema field(s) expected on Bahagian A were not observed. ` +
        `These may need manual investigation.`,
    }),
  });

  // ── Check 12 (informational): Entry-state quality warnings ────
  const qualityNotes = entryState?.summary?.qualityNotes ?? [];
  const noQualityWarnings = qualityNotes.length === 0;
  checks.push({
    checkId: "entry_state_quality",
    description: "Entry-state observation has no quality warnings",
    severity: "informational",
    passed: noQualityWarnings,
    ...(!noQualityWarnings && {
      reason: `Entry-state has ${qualityNotes.length} quality note(s): ` +
        qualityNotes.join("; "),
    }),
  });

  // ── Check 13 (informational): Next-tab attempt outcome clarity ─
  const outcomeIsClear =
    nextTabOutcome === "tab_became_active" ||
    nextTabOutcome === "tab_content_visible";
  checks.push({
    checkId: "next_tab_outcome_clear",
    description: "Next-tab attempt outcome was clear (tab active or content visible)",
    severity: "informational",
    passed: outcomeIsClear,
    ...(!outcomeIsClear && {
      reason: `Next-tab attempt outcome was "${nextTabOutcome ?? "unknown"}" — ` +
        `not a clear active/visible confirmation.`,
    }),
  });

  // ── Aggregate ──────────────────────────────────────────────────
  const blockingFailures = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  ).length;
  const advisoryFailures = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  ).length;
  const informationalFailures = checks.filter(
    (c) => c.severity === "informational" && !c.passed
  ).length;
  const passedCount = checks.filter((c) => c.passed).length;

  const blockingReasons = checks
    .filter((c) => c.severity === "blocking" && !c.passed && c.reason)
    .map((c) => c.reason!);
  const advisoryReasons = checks
    .filter((c) => c.severity === "advisory" && !c.passed && c.reason)
    .map((c) => c.reason!);

  // ── Guard decision ─────────────────────────────────────────────
  const guardReasons: PortalBahagianAFillGuardReason[] = [];

  if (!hasEntryState) guardReasons.push("entry_state_missing");
  if (!tabObserved && hasEntryState) guardReasons.push("bahagian_a_not_observed");
  if (!hasGroundedFields && groundingExists) guardReasons.push("no_grounded_fields");
  if (allReadOnlyOrDerived) guardReasons.push("all_fields_read_only_or_derived");
  if (!groundingExists) guardReasons.push("schema_grounding_not_observed");
  if (groundingExists && !hasGroundedFields && !hasEditableFields) {
    guardReasons.push("grounding_incomplete_no_editable");
  }
  if (!nextTabAttemptOk) guardReasons.push("next_tab_attempt_missing_or_failed");
  if (unintendedProgression) guardReasons.push("unintended_progression_beyond_bahagian_a");
  if (!laneKnown) guardReasons.push("lane_unknown");

  // Advisory guard reasons
  if (!groundingQualityOk && groundingExists) guardReasons.push("partial_grounding_quality");
  if (!noUnknownModes) guardReasons.push("unknown_field_modes_present");
  if (!noExpectedMissing) guardReasons.push("expected_schema_fields_missing");
  if (!noQualityWarnings) guardReasons.push("entry_state_has_quality_warnings");
  if (!outcomeIsClear && nextTabAttemptOk) guardReasons.push("next_tab_attempt_outcome_uncertain");

  let guardDecision: "refused" | "review_gated" | "permitted";
  let guardExplanation: string;

  if (blockingFailures > 0) {
    guardDecision = "refused";
    guardExplanation =
      `Bahagian A fill is refused: ${blockingFailures} blocking condition(s) failed. ` +
      blockingReasons.join(" ");
  } else if (advisoryFailures > 0) {
    guardDecision = "review_gated";
    guardExplanation =
      `Bahagian A fill requires review: all blocking conditions passed, but ` +
      `${advisoryFailures} advisory condition(s) need attention. ` +
      advisoryReasons.join(" ");
  } else {
    guardDecision = "permitted";
    guardExplanation =
      "All blocking and advisory conditions passed. " +
      "A first Bahagian A field-fill attempt is internally eligible for a later guarded attempt.";
  }

  const guard: PortalBahagianAFillGuard = {
    decision: guardDecision,
    reasons: guardReasons,
    explanation: guardExplanation,
  };

  // ── Determine overall status ───────────────────────────────────
  let status: PortalBahagianAFillPreflightStatus;
  if (!hasEntryState || !tabObserved) {
    status = "not_ready";
  } else if (blockingFailures > 0) {
    status = "blocking_issues";
  } else if (advisoryFailures > 0) {
    status = "review_required";
  } else {
    status = "eligible_for_later_fill_attempt";
  }

  // ── Overall explanation ────────────────────────────────────────
  let explanation: string;
  if (status === "not_ready") {
    explanation =
      "Bahagian A fill preflight cannot be evaluated — " +
      "the entry-state has not been captured or the tab was not observed.";
  } else if (status === "blocking_issues") {
    explanation =
      `Bahagian A fill preflight has ${blockingFailures} blocking issue(s). ` +
      "A first fill attempt would be refused until these are resolved.";
  } else if (status === "review_required") {
    explanation =
      `Bahagian A fill preflight passed all blocking checks, but ` +
      `${advisoryFailures} advisory issue(s) require review before a fill attempt.`;
  } else {
    explanation =
      "Bahagian A fill preflight passed all blocking and advisory checks. " +
      "A first field-fill attempt is internally eligible for a later guarded attempt.";
  }

  return {
    status,
    lane,
    evaluatedAt: now,
    groundingStatus,
    fieldModeSummary,
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
