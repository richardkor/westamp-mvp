/**
 * WeStamp — Preparation Service
 *
 * Pure function that validates eligibility and assembles a preparation
 * snapshot for a tenancy-agreement stamping record.
 *
 * No side effects. Does not read or write the store. Does not call
 * any external API. The caller is responsible for persisting the result.
 *
 * Only tenancy agreements are supported. Other categories are rejected.
 */

import { StampingJob, PreparationSnapshot } from "./stamping-types";

// ─── Result types ─────────────────────────────────────────────────────

export type PrepareResult =
  | { ok: true; snapshot: PreparationSnapshot }
  | { ok: false; reason: string };

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Validate a stamping job for preparation eligibility and, if eligible,
 * return the normalized preparation snapshot.
 *
 * Eligibility rules:
 *  1. documentCategory must be "tenancy_agreement"
 *  2. status must be "intake_reviewed"
 *  3. storagePath must be non-empty
 *  4. stampingDetails must exist with valid fields
 *  5. calculatedDuty must be structurally complete
 */
export function prepareForStamping(job: StampingJob): PrepareResult {
  // 1. Category
  if (job.documentCategory !== "tenancy_agreement") {
    return {
      ok: false,
      reason:
        "Only tenancy-agreement records can be prepared for stamping at this time.",
    };
  }

  // 2. Status
  if (job.status !== "intake_reviewed") {
    return {
      ok: false,
      reason:
        "This record cannot be prepared for stamping yet. Please ensure the required stamping details are complete.",
    };
  }

  // 3. Uploaded file reference
  if (!job.storagePath) {
    return {
      ok: false,
      reason: "No uploaded file reference found on this record.",
    };
  }

  // 4. Stamping details
  const sd = job.stampingDetails;
  if (!sd) {
    return {
      ok: false,
      reason:
        "This record cannot be prepared for stamping yet. Please ensure the required stamping details are complete.",
    };
  }

  if (
    typeof sd.monthlyRent !== "number" ||
    !Number.isFinite(sd.monthlyRent) ||
    sd.monthlyRent <= 0
  ) {
    return { ok: false, reason: "Monthly rent is missing or invalid." };
  }

  if (
    typeof sd.leaseMonths !== "number" ||
    !Number.isInteger(sd.leaseMonths) ||
    sd.leaseMonths <= 0
  ) {
    return { ok: false, reason: "Lease duration is missing or invalid." };
  }

  if (
    typeof sd.duplicateCopies !== "number" ||
    !Number.isInteger(sd.duplicateCopies) ||
    sd.duplicateCopies < 0
  ) {
    return { ok: false, reason: "Duplicate copies value is missing or invalid." };
  }

  // 5. Duty calculation structure
  const dc = sd.calculatedDuty;
  if (
    !dc ||
    typeof dc.baseDuty !== "number" ||
    typeof dc.duplicateCopyTotal !== "number" ||
    typeof dc.totalDuty !== "number" ||
    typeof dc.rateTierLabel !== "string" ||
    !dc.rateTierLabel
  ) {
    return {
      ok: false,
      reason: "Duty calculation data is incomplete or invalid.",
    };
  }

  // ── All checks passed — assemble snapshot ──────────────────────────

  const snapshot: PreparationSnapshot = {
    preparedAt: new Date().toISOString(),
    documentCategory: "tenancy_agreement",
    uploadedFile: {
      originalFileName: job.originalFileName,
      storagePath: job.storagePath,
    },
    tenancyDetails: {
      monthlyRent: sd.monthlyRent,
      leaseMonths: sd.leaseMonths,
      duplicateCopies: sd.duplicateCopies,
    },
    dutyCalculation: {
      baseDuty: dc.baseDuty,
      duplicateCopyTotal: dc.duplicateCopyTotal,
      totalDuty: dc.totalDuty,
      rateTierLabel: dc.rateTierLabel,
    },
    dataSource: "user_entered_unverified",
  };

  return { ok: true, snapshot };
}
