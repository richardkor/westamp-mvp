/**
 * WeStamp — STSDS Dry-Run Execution Runner
 *
 * Evaluates the existing automation plan and portal draft against
 * the current portal schema to determine internal execution readiness.
 *
 * This is a structured internal assessment:
 * - Consumes the existing automation plan steps and checkpoints
 * - Consumes the existing portal draft data
 * - Evaluates step-by-step readiness against known schema field keys
 * - Produces a structured trace with per-step and per-checkpoint results
 *
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT execute any browser automation.
 * Does NOT advance job status.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalDryRun,
  PortalDryRunStatus,
  PortalDryRunStepResult,
  PortalDryRunStepStatus,
  PortalDryRunCheckpointResult,
  PortalDryRunSummary,
} from "./stsds-types";

/**
 * Run an internal dry-run evaluation of the automation plan for a job.
 *
 * Returns null only if there is no routing suggestion (cannot determine lane).
 * Otherwise always returns a PortalDryRun — possibly with status "not_ready"
 * or "blocked" if the plan or draft is missing/incomplete.
 *
 * @param job - The stamping job to evaluate
 * @returns A dry-run result, or null if lane cannot be determined
 */
export function runStsdsDryRun(job: StampingJob): PortalDryRun | null {
  if (!job.routingSuggestion) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const now = new Date().toISOString();

  // Short-circuit: no automation plan yet
  if (!job.automationPlan) {
    return {
      status: "not_ready",
      lane,
      evaluatedAt: now,
      stepResults: [],
      checkpointResults: [],
      summary: zeroSummary(),
      blockedReasons: ["Automation plan has not been generated yet."],
      advisoryNotes: [],
    };
  }

  // Short-circuit: no portal draft
  if (!job.portalDraft) {
    return {
      status: "not_ready",
      lane,
      evaluatedAt: now,
      stepResults: [],
      checkpointResults: [],
      summary: zeroSummary(),
      blockedReasons: ["Portal draft has not been created yet."],
      advisoryNotes: [],
    };
  }

  const plan = job.automationPlan;
  const stepResults: PortalDryRunStepResult[] = [];
  const checkpointResults: PortalDryRunCheckpointResult[] = [];
  const blockedReasons: string[] = [];
  const advisoryNotes: string[] = [];

  // ── Evaluate steps ─────────────────────────────────────────────────

  let encounteredBlock = false;

  for (const step of plan.steps) {
    let status: PortalDryRunStepStatus;
    let note: string | undefined;

    if (encounteredBlock) {
      // All steps after a blocking step become pending
      status = "pending";
      note = "Not evaluated — a preceding required step is blocked.";
    } else if (step.type === "stop_for_review") {
      // Review gates are not action steps
      status = "skipped";
      note = step.blockReason ?? "Review gate — not an executable action step.";
      advisoryNotes.push(`Step ${step.seq}: ${step.description}`);
    } else if (step.blocked) {
      status = "blocked";
      note = step.blockReason ?? "Step is blocked due to missing data.";
      blockedReasons.push(note);
      encounteredBlock = true;
    } else {
      status = "ready";
    }

    stepResults.push({
      seq: step.seq,
      stepType: step.type,
      description: step.description,
      fieldKey: step.fieldKey,
      status,
      note,
    });
  }

  // ── Evaluate checkpoints ────────────────────────────────────────────

  for (const cp of plan.validationCheckpoints) {
    let cpStatus: PortalDryRunCheckpointResult["status"];
    let note: string | undefined;

    if (cp.severity === "advisory") {
      cpStatus = "advisory";
      note = "Advisory checkpoint — does not block execution.";
      advisoryNotes.push(cp.description);
    } else if (cp.expectedValue === null) {
      cpStatus = "blocked";
      note = "Required checkpoint has no expected value — validation will not be possible.";
      blockedReasons.push(`Checkpoint: ${cp.description}`);
    } else {
      cpStatus = "ready";
    }

    checkpointResults.push({
      description: cp.description,
      fieldKey: cp.fieldKey,
      expectedValue: cp.expectedValue,
      status: cpStatus,
      note,
    });
  }

  // ── Build summary ───────────────────────────────────────────────────

  const summary = buildSummary(stepResults, checkpointResults);

  // ── Resolve overall status ──────────────────────────────────────────

  let status: PortalDryRunStatus;

  if (plan.status === "not_ready") {
    status = "not_ready";
  } else if (summary.blockedSteps > 0 || summary.blockedCheckpoints > 0) {
    status = "blocked";
  } else if (
    summary.skippedSteps > 0 ||
    summary.advisoryCheckpoints > 0 ||
    plan.status === "review_required"
  ) {
    status = "review_required";
  } else {
    status = "ready_for_internal_review";
  }

  return {
    status,
    lane,
    evaluatedAt: now,
    stepResults,
    checkpointResults,
    summary,
    blockedReasons,
    advisoryNotes,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function zeroSummary(): PortalDryRunSummary {
  return {
    totalSteps: 0,
    readySteps: 0,
    blockedSteps: 0,
    skippedSteps: 0,
    pendingSteps: 0,
    totalCheckpoints: 0,
    readyCheckpoints: 0,
    blockedCheckpoints: 0,
    advisoryCheckpoints: 0,
  };
}

function buildSummary(
  stepResults: PortalDryRunStepResult[],
  checkpointResults: PortalDryRunCheckpointResult[]
): PortalDryRunSummary {
  return {
    totalSteps: stepResults.length,
    readySteps: stepResults.filter((s) => s.status === "ready").length,
    blockedSteps: stepResults.filter((s) => s.status === "blocked").length,
    skippedSteps: stepResults.filter((s) => s.status === "skipped").length,
    pendingSteps: stepResults.filter((s) => s.status === "pending").length,
    totalCheckpoints: checkpointResults.length,
    readyCheckpoints: checkpointResults.filter((c) => c.status === "ready").length,
    blockedCheckpoints: checkpointResults.filter((c) => c.status === "blocked").length,
    advisoryCheckpoints: checkpointResults.filter((c) => c.status === "advisory").length,
  };
}
