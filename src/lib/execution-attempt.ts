/**
 * WeStamp — Execution Attempt Placeholder Builder
 *
 * Pure function that builds an ExecutionAttempt placeholder for a
 * supported tenancy job that already has a submission payload draft.
 *
 * No side effects. Does not read or write the store. Does not contact
 * any external system. The caller is responsible for persisting the result.
 *
 * Does NOT implement or simulate live STSDS / MyTax execution.
 */

import { randomUUID } from "crypto";
import { StampingJob, ExecutionAttempt } from "./stamping-types";

// ─── Result type ──────────────────────────────────────────────────────

export type BuildAttemptResult =
  | { ok: true; attempt: ExecutionAttempt }
  | { ok: false; reason: string };

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Build an execution attempt placeholder for a ready_for_submission
 * tenancy job that has a valid submission payload draft.
 *
 * Eligibility rules:
 *  1. documentCategory must be "tenancy_agreement"
 *  2. status must be "ready_for_submission"
 *  3. submissionPayload must exist with payloadStatus "draft"
 */
export function buildExecutionAttempt(
  job: StampingJob
): BuildAttemptResult {
  // 1. Category
  if (job.documentCategory !== "tenancy_agreement") {
    return {
      ok: false,
      reason:
        "Execution layer is only supported for tenancy-agreement records.",
    };
  }

  // 2. Status
  if (job.status !== "ready_for_submission") {
    return {
      ok: false,
      reason:
        "Execution layer can only be initialized for records in ready_for_submission status.",
    };
  }

  // 3. Payload draft
  if (!job.submissionPayload || job.submissionPayload.payloadStatus !== "draft") {
    return {
      ok: false,
      reason:
        "No submission payload draft found. Please prepare submission data first.",
    };
  }

  // ── All checks passed — build placeholder ─────────────────────────

  const attempt: ExecutionAttempt = {
    attemptId: randomUUID(),
    createdAt: new Date().toISOString(),
    attemptStatus: "not_enabled",
    payloadJobId: job.id,
    note:
      "Execution layer placeholder initialized. Live STSDS execution is not yet available.",
  };

  return { ok: true, attempt };
}
