/**
 * WeStamp — STSDS Maklumat Am Save-Boundary Preflight + Mutation Guard
 *
 * Pure evaluator that determines whether WeStamp would be internally
 * eligible to attempt the first save action for Maklumat Am in a future
 * milestone. This does NOT perform any save.
 *
 * Consumes existing layers:
 * - portal draft
 * - automation plan
 * - browser instructions
 * - dry run
 * - assertion evaluation
 * - portal probe result + artifacts
 *
 * Returns a structured preflight result with blocking/advisory/informational
 * checks and a mutation guard decision.
 *
 * SAFETY: This is a pure function. It does NOT touch the live portal.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalSavePreflight,
  PortalSavePreflightStatus,
  PortalSavePreflightCheck,
  PortalSavePreflightSeverity,
  PortalMutationGuard,
  PortalMutationGuardReason,
  PortalLane,
} from "./stsds-types";

// ─── Check Definitions ─────────────────────────────────────────────

/**
 * A check definition: what to evaluate and at what severity.
 */
interface CheckDef {
  checkId: string;
  description: string;
  severity: PortalSavePreflightSeverity;
  evaluate: (job: StampingJob) => { passed: boolean; reason?: string };
}

/**
 * Build the check definitions for the current lane.
 * All checks are grounded in existing layers — no speculative rules.
 */
function buildCheckDefs(lane: PortalLane): CheckDef[] {
  const checks: CheckDef[] = [];

  // ── Blocking checks ───────────────────────────────────────────

  checks.push({
    checkId: "portal_draft_exists",
    description: "Portal draft exists",
    severity: "blocking",
    evaluate: (job) => ({
      passed: !!job.portalDraft,
      reason: job.portalDraft ? undefined : "No portal draft has been created.",
    }),
  });

  checks.push({
    checkId: "portal_draft_lane_matches",
    description: "Portal draft lane matches routing suggestion",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalDraft || !job.routingSuggestion) {
        return { passed: false, reason: "Portal draft or routing suggestion is missing." };
      }
      const matches = job.portalDraft.lane === job.routingSuggestion.suggestedLane;
      return {
        passed: matches,
        reason: matches ? undefined : `Draft lane "${job.portalDraft.lane}" does not match routing "${job.routingSuggestion.suggestedLane}".`,
      };
    },
  });

  checks.push({
    checkId: "required_maklumat_am_stamp_office",
    description: "Stamp office is present in Maklumat Am draft",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalDraft) return { passed: false, reason: "No portal draft." };
      const ma = lane === "sewa_pajakan"
        ? job.portalDraft.maklumatAmSewaPajakan
        : job.portalDraft.maklumatAmPenyetemanAm;
      const hasValue = !!ma?.stampOffice;
      return {
        passed: hasValue,
        reason: hasValue ? undefined : "Stamp office is missing from Maklumat Am draft.",
      };
    },
  });

  checks.push({
    checkId: "required_maklumat_am_instrument_date",
    description: "Instrument date is present in Maklumat Am draft",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalDraft) return { passed: false, reason: "No portal draft." };
      const ma = lane === "sewa_pajakan"
        ? job.portalDraft.maklumatAmSewaPajakan
        : job.portalDraft.maklumatAmPenyetemanAm;
      const hasValue = !!ma?.instrumentDate;
      return {
        passed: hasValue,
        reason: hasValue ? undefined : "Instrument date is missing from Maklumat Am draft.",
      };
    },
  });

  // Lane-specific required field checks
  if (lane === "sewa_pajakan") {
    // Note: monthlyRent and leaseMonths are NOT Maklumat Am inputs.
    // They belong to later portal tabs / broader tenancy readiness
    // and are intentionally excluded from the Maklumat Am save preflight.
  }

  if (lane === "penyeteman_am") {
    checks.push({
      checkId: "required_penyeteman_document_name",
      description: "Portal document name is present in Maklumat Am draft",
      severity: "blocking",
      evaluate: (job) => {
        const ma = job.portalDraft?.maklumatAmPenyetemanAm;
        const hasValue = !!ma?.portalDocumentName;
        return {
          passed: !!hasValue,
          reason: hasValue ? undefined : "Portal document name (Nama Surat Cara) is missing from Maklumat Am draft.",
        };
      },
    });
  }

  checks.push({
    checkId: "browser_instructions_exist",
    description: "Browser instructions have been compiled",
    severity: "blocking",
    evaluate: (job) => ({
      passed: !!job.browserInstructions,
      reason: job.browserInstructions ? undefined : "Browser instructions have not been compiled.",
    }),
  });

  checks.push({
    checkId: "browser_instructions_not_blocked",
    description: "Browser instructions are not blocked",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.browserInstructions) return { passed: false, reason: "No browser instructions." };
      const blocked = job.browserInstructions.status === "blocked";
      return {
        passed: !blocked,
        reason: blocked
          ? `Browser instructions are blocked: ${job.browserInstructions.blockedReasons.join("; ")}`
          : undefined,
      };
    },
  });

  checks.push({
    checkId: "dry_run_not_blocked",
    description: "Dry run is not blocked",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.dryRun) return { passed: false, reason: "No dry run has been evaluated." };
      const blocked = job.dryRun.status === "blocked";
      return {
        passed: !blocked,
        reason: blocked
          ? `Dry run is blocked: ${(job.dryRun as { blockedReasons?: string[] }).blockedReasons?.join("; ") ?? "unknown reason"}`
          : undefined,
      };
    },
  });

  checks.push({
    checkId: "assertion_no_blocking_mismatch",
    description: "Assertion evaluation has no blocking mismatches",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.assertionEvaluation) {
        return { passed: false, reason: "No assertion evaluation has been performed." };
      }
      const hasBlocking = job.assertionEvaluation.status === "blocking_mismatches";
      return {
        passed: !hasBlocking,
        reason: hasBlocking
          ? `Blocking assertion mismatches: ${job.assertionEvaluation.blockingMismatches.join("; ")}`
          : undefined,
      };
    },
  });

  checks.push({
    checkId: "probe_not_failed",
    description: "Most recent portal probe did not fail",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalProbe) {
        return { passed: false, reason: "No portal probe has been run." };
      }
      if (job.portalProbe.status === "failed") {
        return {
          passed: false,
          reason: `Portal probe failed: ${job.portalProbe.notes.join("; ")}`,
        };
      }
      if (job.portalProbe.status === "blocked") {
        return {
          passed: false,
          reason: `Portal probe is blocked: ${job.portalProbe.notes.join("; ")}`,
        };
      }
      return { passed: true };
    },
  });

  checks.push({
    checkId: "probe_no_blocking_readback_failure",
    description: "No blocking selector/readback failures in most recent probe",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalProbe) return { passed: false, reason: "No portal probe." };
      const failedSteps = job.portalProbe.stepResults.filter(
        (s) => s.status === "failed"
      );
      if (failedSteps.length > 0) {
        return {
          passed: false,
          reason: `${failedSteps.length} probe step(s) failed: ${failedSteps.map((s) => s.note ?? s.description).join("; ")}`,
        };
      }
      return { passed: true };
    },
  });

  checks.push({
    checkId: "draft_probe_not_drifted",
    description: "Portal draft has not been updated after the last probe",
    severity: "blocking",
    evaluate: (job) => {
      if (!job.portalDraft || !job.portalProbe) {
        return { passed: false, reason: "Portal draft or probe is missing." };
      }
      const draftTime = new Date(job.portalDraft.draftedAt).getTime();
      const probeTime = new Date(job.portalProbe.probedAt).getTime();
      if (draftTime > probeTime) {
        return {
          passed: false,
          reason: `Portal draft was updated (${job.portalDraft.draftedAt}) after the last probe (${job.portalProbe.probedAt}). Re-run the probe to capture current state.`,
        };
      }
      return { passed: true };
    },
  });

  // ── Advisory checks ───────────────────────────────────────────

  checks.push({
    checkId: "assertion_no_advisory_mismatch",
    description: "Assertion evaluation has no advisory mismatches",
    severity: "advisory",
    evaluate: (job) => {
      if (!job.assertionEvaluation) return { passed: true }; // covered by blocking check
      const hasAdvisory = job.assertionEvaluation.status === "advisory_mismatches";
      return {
        passed: !hasAdvisory,
        reason: hasAdvisory
          ? `Advisory assertion mismatches: ${job.assertionEvaluation.advisoryMismatches.join("; ")}`
          : undefined,
      };
    },
  });

  checks.push({
    checkId: "probe_no_low_confidence_readback",
    description: "No low-confidence readbacks in most recent probe",
    severity: "advisory",
    evaluate: (job) => {
      if (!job.portalProbe?.observedSnapshot) return { passed: true };
      const lowConf = job.portalProbe.observedSnapshot.allFields.filter(
        (f) => f.readbackConfidence === "low_confidence"
      );
      if (lowConf.length > 0) {
        return {
          passed: false,
          reason: `${lowConf.length} field(s) have low-confidence readback: ${lowConf.map((f) => f.fieldKey).join(", ")}`,
        };
      }
      return { passed: true };
    },
  });

  checks.push({
    checkId: "probe_no_fallback_selector_on_critical_fields",
    description: "No container/schema fallback selectors used on critical fields",
    severity: "advisory",
    evaluate: (job) => {
      if (!job.portalProbe?.observedSnapshot) return { passed: true };
      const fallbackFields = job.portalProbe.observedSnapshot.allFields.filter(
        (f) =>
          f.selectorMethod === "container_fallback" ||
          f.selectorMethod === "schema_hint_fallback"
      );
      if (fallbackFields.length > 0) {
        return {
          passed: false,
          reason: `${fallbackFields.length} field(s) used fallback selectors: ${fallbackFields.map((f) => `${f.fieldKey} (${f.selectorMethod})`).join(", ")}`,
        };
      }
      return { passed: true };
    },
  });

  checks.push({
    checkId: "probe_has_evidence_artifacts",
    description: "Probe captured evidence artifacts",
    severity: "advisory",
    evaluate: (job) => {
      if (!job.portalProbe?.artifactCollection) {
        return {
          passed: false,
          reason: "No evidence artifacts were captured during the most recent probe.",
        };
      }
      const hasScreenshots = job.portalProbe.artifactCollection.screenshotCount > 0;
      return {
        passed: hasScreenshots,
        reason: hasScreenshots
          ? undefined
          : "No screenshot artifacts were captured during the most recent probe.",
      };
    },
  });

  // ── Informational checks ──────────────────────────────────────

  checks.push({
    checkId: "probe_normalized_readback_count",
    description: "Count of fields that required readback normalization",
    severity: "informational",
    evaluate: (job) => {
      if (!job.portalProbe?.observedSnapshot) return { passed: true };
      const normalized = job.portalProbe.observedSnapshot.allFields.filter(
        (f) => f.readbackConfidence === "normalized"
      );
      if (normalized.length > 0) {
        return {
          passed: false,
          reason: `${normalized.length} field(s) required normalization: ${normalized.map((f) => f.fieldKey).join(", ")}`,
        };
      }
      return { passed: true };
    },
  });

  checks.push({
    checkId: "automation_plan_has_stop_reasons",
    description: "Automation plan stop reasons noted",
    severity: "informational",
    evaluate: (job) => {
      if (!job.automationPlan) return { passed: true };
      const hasStops = job.automationPlan.stopReasons.length > 0;
      return {
        passed: !hasStops,
        reason: hasStops
          ? `Automation plan has ${job.automationPlan.stopReasons.length} stop reason(s).`
          : undefined,
      };
    },
  });

  return checks;
}

// ─── Mutation Guard ─────────────────────────────────────────────────

/**
 * Evaluate the mutation guard based on check results.
 * Returns the guard decision and active reasons.
 */
function evaluateMutationGuard(
  checks: PortalSavePreflightCheck[]
): PortalMutationGuard {
  const reasons: PortalMutationGuardReason[] = [];

  // Map failed blocking checks to guard reasons
  const failedBlocking = checks.filter(
    (c) => c.severity === "blocking" && !c.passed
  );
  const failedAdvisory = checks.filter(
    (c) => c.severity === "advisory" && !c.passed
  );

  for (const check of failedBlocking) {
    switch (check.checkId) {
      case "portal_draft_exists":
      case "portal_draft_lane_matches":
        reasons.push("missing_portal_draft");
        break;
      case "required_maklumat_am_stamp_office":
      case "required_maklumat_am_instrument_date":
      case "required_penyeteman_document_name":
        reasons.push("missing_required_maklumat_am_field");
        break;
      case "browser_instructions_exist":
        reasons.push("missing_browser_instructions");
        break;
      case "browser_instructions_not_blocked":
        reasons.push("browser_instructions_blocked");
        break;
      case "dry_run_not_blocked":
        reasons.push("dry_run_blocked");
        break;
      case "assertion_no_blocking_mismatch":
        reasons.push("assertion_blocking_mismatch");
        break;
      case "probe_not_failed":
        // Determine probe_failed vs probe_blocked vs probe_missing
        reasons.push("probe_failed");
        break;
      case "probe_no_blocking_readback_failure":
        reasons.push("probe_readback_failure");
        break;
      case "draft_probe_not_drifted":
        reasons.push("draft_probe_drift");
        break;
    }
  }

  // Deduplicate reasons
  const uniqueReasons = [...new Set(reasons)];

  if (uniqueReasons.length > 0) {
    return {
      decision: "refused",
      reasons: uniqueReasons,
      explanation:
        `Save is refused: ${uniqueReasons.length} blocking guard reason(s) are active. ` +
        `Resolve all blocking issues before a save attempt can be considered.`,
    };
  }

  if (failedAdvisory.length > 0) {
    return {
      decision: "review_gated",
      reasons: ["manual_confirmation_required"],
      explanation:
        `No blocking issues, but ${failedAdvisory.length} advisory issue(s) require human review ` +
        `before a save attempt can be considered.`,
    };
  }

  return {
    decision: "permitted",
    reasons: [],
    explanation:
      "All blocking and advisory checks passed. Internally eligible for a future save attempt. " +
      "No save has been performed.",
  };
}

// ─── Public Evaluator ───────────────────────────────────────────────

/**
 * Evaluate the Maklumat Am save-boundary preflight for a stamping job.
 *
 * This is a PURE function — no portal interaction, no side effects.
 * It consumes the existing layers on the job record and returns a
 * structured readiness assessment.
 *
 * @param job - The stamping job with all existing layers populated
 * @returns The save preflight evaluation result
 */
export function evaluateMaklumatAmSavePreflight(
  job: StampingJob
): PortalSavePreflight {
  const now = new Date().toISOString();

  // Determine lane
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";

  // Build and evaluate checks
  const checkDefs = buildCheckDefs(lane);
  const checks: PortalSavePreflightCheck[] = checkDefs.map((def) => {
    const result = def.evaluate(job);
    return {
      checkId: def.checkId,
      description: def.description,
      severity: def.severity,
      passed: result.passed,
      reason: result.reason,
    };
  });

  // Compute summary
  const totalChecks = checks.length;
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

  // Collect human-readable reasons
  const blockingReasons = checks
    .filter((c) => c.severity === "blocking" && !c.passed && c.reason)
    .map((c) => c.reason!);
  const advisoryReasons = checks
    .filter((c) => c.severity === "advisory" && !c.passed && c.reason)
    .map((c) => c.reason!);

  // Evaluate mutation guard
  const mutationGuard = evaluateMutationGuard(checks);

  // Determine overall status
  let status: PortalSavePreflightStatus;
  if (!job.portalDraft) {
    status = "not_ready";
  } else if (blockingFailures > 0) {
    status = "blocking_issues";
  } else if (advisoryFailures > 0) {
    status = "review_required";
  } else {
    status = "eligible";
  }

  return {
    status,
    lane,
    evaluatedAt: now,
    checks,
    mutationGuard,
    summary: {
      totalChecks,
      passedCount,
      blockingFailures,
      advisoryFailures,
      informationalFailures,
    },
    blockingReasons,
    advisoryReasons,
    lastProbeReference: job.portalProbe?.probedAt,
  };
}
