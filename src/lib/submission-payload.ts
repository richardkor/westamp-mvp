/**
 * WeStamp — Submission Payload Assembly
 *
 * Pure function that assembles a SubmissionPayloadDraft for a supported
 * tenancy-agreement job already in ready_for_submission.
 *
 * No side effects. Does not read or write the store. Does not call any
 * external API. The caller is responsible for persisting the result.
 *
 * Only produces payloads for supported tenancy jobs with a complete
 * preparation snapshot. All other jobs are rejected with a reason.
 *
 * Does NOT implement or simulate live STSDS / MyTax submission.
 */

import { StampingJob, SubmissionPayloadDraft } from "./stamping-types";

// ─── Result type ──────────────────────────────────────────────────────

export type BuildPayloadResult =
  | { ok: true; payload: SubmissionPayloadDraft }
  | { ok: false; reason: string };

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Assemble a submission payload draft from a ready_for_submission job.
 *
 * Eligibility rules:
 *  1. documentCategory must be "tenancy_agreement"
 *  2. status must be "ready_for_submission"
 *  3. preparationSnapshot must exist and be complete
 *  4. storagePath, originalFileName, mimeType must be present
 */
export function buildSubmissionPayload(
  job: StampingJob
): BuildPayloadResult {
  // 1. Category
  if (job.documentCategory !== "tenancy_agreement") {
    return {
      ok: false,
      reason:
        "Submission payload drafting is only supported for tenancy-agreement records.",
    };
  }

  // 2. Status
  if (job.status !== "ready_for_submission") {
    return {
      ok: false,
      reason:
        "Submission payload can only be drafted for records in ready_for_submission status.",
    };
  }

  // 3. Preparation snapshot
  const snap = job.preparationSnapshot;
  if (!snap) {
    return {
      ok: false,
      reason:
        "No preparation snapshot found. Please complete the preparation step first.",
    };
  }

  // 4. File reference
  if (!job.storagePath || !job.originalFileName || !job.mimeType) {
    return {
      ok: false,
      reason: "Uploaded file reference is incomplete on this record.",
    };
  }

  // ── All checks passed — assemble payload draft ────────────────────

  const payload: SubmissionPayloadDraft = {
    payloadStatus: "draft",
    draftedAt: new Date().toISOString(),
    internalJobId: job.id,
    documentCategory: "tenancy_agreement",
    uploadedFile: {
      originalFileName: job.originalFileName,
      storagePath: job.storagePath,
      mimeType: job.mimeType,
      fileSizeBytes: job.fileSize,
    },
    tenancyDetails: {
      monthlyRent: snap.tenancyDetails.monthlyRent,
      leaseMonths: snap.tenancyDetails.leaseMonths,
      duplicateCopies: snap.tenancyDetails.duplicateCopies,
    },
    dutyCalculation: {
      baseDuty: snap.dutyCalculation.baseDuty,
      duplicateCopyTotal: snap.dutyCalculation.duplicateCopyTotal,
      totalDuty: snap.dutyCalculation.totalDuty,
      rateTierLabel: snap.dutyCalculation.rateTierLabel,
    },
    dataSource: "user_entered_unverified",
    preparedAt: snap.preparedAt,
  };

  return { ok: true, payload };
}
