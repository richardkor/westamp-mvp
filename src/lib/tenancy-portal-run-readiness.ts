/**
 * WeStamp — Tenancy Portal Run Readiness Gate (consolidated)
 *
 * Single-shot orchestrator that consolidates the three existing
 * tenancy-portal evaluation layers (required-details readiness, the
 * portal payload compiler, the non-mutating browser instruction
 * draft compiler) into one verdict the operator can act on.
 *
 * What this module IS
 * ───────────────────
 * - A thin orchestrator. It calls the existing helpers and folds
 *   their outputs into a single `TenancyPortalRunReadinessReport`.
 * - The single source of truth for the operator question
 *   "Is this tenancy job ready for a supervised e-Duti Setem run?".
 * - Strict by default — `ready_for_supervised_run` is returned only
 *   when every layer is ready and no unsupported-automation reason
 *   is present.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT redefine readiness rules. It re-uses
 *   `evaluateTenancyPortalReadiness`,
 *   `compileTenancyPortalPayload`,
 *   `compileTenancyBrowserInstructions`.
 * - It does NOT drive a portal, run Playwright, save anything to
 *   the job, persist `browserInstructions`, or trigger any live
 *   action.
 * - It does NOT authorize live submission, payment, or certificate
 *   retrieval — even when the verdict is ready_for_supervised_run.
 *   Final Hantar always requires explicit operator final-approval at
 *   supervised execution time.
 */

import type { StampingJob } from "./stamping-types";
import { evaluateTenancyPortalReadiness } from "./tenancy-portal-requirements";
import {
  compileTenancyPortalPayload,
  type TenancyPortalPayload,
  type TenancyPortalPayloadJobInput,
} from "./tenancy-portal-payload";
import {
  compileTenancyBrowserInstructions,
  type TenancyBrowserInstructionDraft,
} from "./tenancy-browser-instructions";

// ─── Output types ───────────────────────────────────────────────────

/**
 * Two values. `ready_for_supervised_run` is the only verdict that
 * unblocks the next supervised step; everything else is `blocked`.
 */
export type TenancyPortalRunReadinessVerdict =
  | "ready_for_supervised_run"
  | "blocked";

/** Per-layer ready/blocked snapshot. */
export type TenancyPortalRunReadinessLayerStatus = "ready" | "blocked";

/**
 * Standing authorization markers. These are constants in this
 * milestone — the readiness gate NEVER claims any of these are
 * authorized. They are surfaced in the operator panel as a reminder
 * that ready_for_supervised_run is necessary but not sufficient
 * for any portal action.
 */
export interface TenancyPortalRunReadinessAuthorization {
  /** A ready verdict does NOT authorize live submission. */
  liveSubmission: false;
  /** A ready verdict does NOT authorize payment. */
  payment: false;
  /** A ready verdict does NOT authorize certificate retrieval. */
  certificateRetrieval: false;
}

/** Top-level readiness report. */
export interface TenancyPortalRunReadinessReport {
  verdict: TenancyPortalRunReadinessVerdict;
  /** ISO 8601 timestamp of this report. */
  generatedAt: string;
  /**
   * Aggregate, actionable reasons the verdict is `blocked`. Empty
   * when verdict is `ready_for_supervised_run`. Each entry is a
   * concrete sentence the operator can act on (e.g. "missing
   * landlord details", not "not ready").
   */
  blockingReasons: string[];
  /**
   * Standing warnings. Always populated even when verdict is ready,
   * because mutating / irreversible steps still require explicit
   * authorization at supervised execution time.
   */
  warnings: string[];
  /** Per-layer ready/blocked snapshot. */
  requiredDetailsStatus: TenancyPortalRunReadinessLayerStatus;
  payloadStatus: TenancyPortalRunReadinessLayerStatus;
  instructionDraftStatus: TenancyPortalRunReadinessLayerStatus;
  /** Count of mutating instruction-draft steps (Lampiran upload, save). */
  mutatingStepsCount: number;
  /** Count of irreversible instruction-draft steps (Hantar / final submit). */
  irreversibleStepsCount: number;
  /** True when the source PDF is reachable (`storagePath` non-empty). */
  sourcePdfReady: boolean;
  /** Constant — final Hantar always requires explicit operator approval. */
  finalSubmissionRequiresApproval: true;
  /** Standing authorization markers (always all `false`). */
  doesNotAuthorize: TenancyPortalRunReadinessAuthorization;
  /**
   * One-line operator-facing recommended next step. Examples:
   *   - "Capture Bahagian A landlord and tenant details."
   *   - "Select pds_suratcara (Nama Surat Cara)."
   *   - "Job is portal-data-ready. Schedule a supervised portal run.
   *      Final Hantar still requires explicit approval."
   */
  nextRecommendedAction: string;
}

// ─── Compiler ──────────────────────────────────────────────────────

/**
 * Job subset the gate reads. Mirrors the input contract of the
 * payload compiler — by design, since the gate orchestrates the
 * payload compiler.
 */
export type TenancyPortalRunReadinessJobInput = Pick<
  StampingJob,
  | "tenancyPortalDetails"
  | "storagePath"
  | "originalFileName"
  | "mimeType"
  | "documentCategory"
  | "stampingDetails"
>;

/** Stable warning text — surfaced even on a ready verdict. */
const WARNING_NOT_AUTHORIZED =
  "This readiness verdict does NOT authorize live submission, payment, or certificate retrieval. Final Hantar requires explicit operator approval at supervised execution time.";

/**
 * Compute a consolidated readiness verdict for a tenancy job.
 *
 * Definition of `ready_for_supervised_run` (strict, all required):
 *   - `evaluateTenancyPortalReadiness(...).overall === "ready"`
 *   - `compileTenancyPortalPayload(...).overall === "ready"`
 *   - `compileTenancyBrowserInstructions(...).overall === "ready"`
 *   - `payload.unsupportedAutomationReasons.length === 0`
 *   - every section in the instruction draft is `state === "ready"`
 *     AND `automationSupport === "supported"`
 *   - `sourcePdfReady === true` (`storagePath` non-empty)
 *
 * Even when all are ready, `finalSubmissionRequiresApproval` stays
 * `true` and `doesNotAuthorize.*` stays `false` — the gate never
 * authorizes an actual live action.
 *
 * Anything else returns `blocked` with concrete `blockingReasons`.
 */
export function evaluateTenancyPortalRunReadiness(
  job: TenancyPortalRunReadinessJobInput
): TenancyPortalRunReadinessReport {
  const generatedAt = new Date().toISOString();

  // ── Layer 1: required-details readiness ─────────────────────
  const requiredDetailsReport = evaluateTenancyPortalReadiness(job);
  const requiredDetailsStatus: TenancyPortalRunReadinessLayerStatus =
    requiredDetailsReport.overall === "ready" ? "ready" : "blocked";

  // ── Layer 2: portal payload ────────────────────────────────
  const payloadInput: TenancyPortalPayloadJobInput = job;
  const payload: TenancyPortalPayload =
    compileTenancyPortalPayload(payloadInput);
  const payloadStatus: TenancyPortalRunReadinessLayerStatus =
    payload.overall === "ready" ? "ready" : "blocked";

  // ── Layer 3: browser instruction draft ─────────────────────
  const draft: TenancyBrowserInstructionDraft =
    compileTenancyBrowserInstructions(payload);
  const instructionDraftStatus: TenancyPortalRunReadinessLayerStatus =
    draft.overall === "ready" ? "ready" : "blocked";

  // ── Layer 4: source PDF ────────────────────────────────────
  const sourcePdfReady =
    typeof job.storagePath === "string" && job.storagePath.trim().length > 0;

  // ── Aggregate blocking reasons ─────────────────────────────
  // Order matters — we surface the earliest layer's blockers first
  // so the operator's eye lands on the root cause rather than a
  // downstream symptom. Duplicates across layers are de-duplicated.
  const blockingReasons: string[] = [];
  const push = (reason: string) => {
    if (reason && !blockingReasons.includes(reason)) {
      blockingReasons.push(reason);
    }
  };

  // Required-details rows that are missing / conditional_missing.
  // The required-details evaluator's per-row notes are the most
  // actionable text WeStamp produces, so we prefer those over the
  // payload's combined reason where they overlap.
  for (const f of requiredDetailsReport.fields) {
    if (f.state === "missing" || f.state === "conditional_missing") {
      push(`${f.label}${f.notes ? ` — ${f.notes}` : " — required"}`);
    }
  }

  // Payload-level extra blockers (covers pds_suratcara missing path
  // and any other section state derived from the payload compiler
  // beyond the required-details evaluator).
  for (const r of payload.blockingReasons) push(r);

  // Unsupported automation (pds_jenis-by-design unsupported).
  for (const r of payload.unsupportedAutomationReasons) {
    push(`Automation unsupported: ${r}`);
  }

  // Per-section instruction-draft blockers (covers any draft-only
  // gaps beyond payload + required-details, e.g. counts mismatch).
  for (const sec of draft.sections) {
    for (const r of sec.blockingReasons) push(r);
  }

  // Source PDF.
  if (!sourcePdfReady) {
    push(
      "Source PDF is not reachable. The uploaded instrument is required for the Lampiran upload step."
    );
  }

  // ── Decide the strict verdict ──────────────────────────────
  const everySectionReady = draft.sections.every(
    (s) => s.state === "ready" && s.automationSupport === "supported"
  );
  const verdict: TenancyPortalRunReadinessVerdict =
    requiredDetailsStatus === "ready" &&
    payloadStatus === "ready" &&
    instructionDraftStatus === "ready" &&
    payload.unsupportedAutomationReasons.length === 0 &&
    everySectionReady &&
    sourcePdfReady &&
    blockingReasons.length === 0
      ? "ready_for_supervised_run"
      : "blocked";

  // ── Warnings ───────────────────────────────────────────────
  // Always include the standing not-authorized reminder; add
  // mutating / irreversible step counts when present.
  const warnings: string[] = [];
  warnings.push(WARNING_NOT_AUTHORIZED);
  const mutatingStepsCount = draft.kindCounts.mutating_requires_authorization;
  const irreversibleStepsCount =
    draft.kindCounts.irreversible_requires_final_approval;
  if (mutatingStepsCount > 0) {
    warnings.push(
      `${mutatingStepsCount} mutating step${mutatingStepsCount === 1 ? "" : "s"} (e.g. Lampiran upload / Simpan) require explicit operator authorization at execution time.`
    );
  }
  if (irreversibleStepsCount > 0) {
    warnings.push(
      `${irreversibleStepsCount} irreversible step${irreversibleStepsCount === 1 ? "" : "s"} (final Hantar) require explicit final-approval at supervised execution time.`
    );
  }

  // ── Recommended next action ────────────────────────────────
  const nextRecommendedAction = deriveNextRecommendedAction(
    verdict,
    blockingReasons,
    requiredDetailsStatus,
    payloadStatus,
    instructionDraftStatus,
    sourcePdfReady,
    payload
  );

  return {
    verdict,
    generatedAt,
    blockingReasons,
    warnings,
    requiredDetailsStatus,
    payloadStatus,
    instructionDraftStatus,
    mutatingStepsCount,
    irreversibleStepsCount,
    sourcePdfReady,
    finalSubmissionRequiresApproval: true,
    doesNotAuthorize: {
      liveSubmission: false,
      payment: false,
      certificateRetrieval: false,
    },
    nextRecommendedAction,
  };
}

/**
 * Pick a single concrete "what should the operator do next?" line.
 * Priority order is most-blocking-first, so the recommendation
 * always names the root cause, not a downstream symptom.
 */
function deriveNextRecommendedAction(
  verdict: TenancyPortalRunReadinessVerdict,
  blockingReasons: string[],
  requiredDetailsStatus: TenancyPortalRunReadinessLayerStatus,
  payloadStatus: TenancyPortalRunReadinessLayerStatus,
  instructionDraftStatus: TenancyPortalRunReadinessLayerStatus,
  sourcePdfReady: boolean,
  payload: TenancyPortalPayload
): string {
  if (verdict === "ready_for_supervised_run") {
    return "Job is portal-data-ready. Schedule a supervised portal run. Final Hantar still requires explicit operator approval.";
  }

  // Source PDF missing — without the instrument, no Lampiran upload
  // can happen, so this is the lowest-level blocker.
  if (!sourcePdfReady) {
    return "Confirm the source PDF is reachable on the job before continuing.";
  }

  // Required-details layer first.
  if (requiredDetailsStatus === "blocked") {
    if (payload.bahagianA.landlordCount === 0) {
      return "Capture at least one landlord in Bahagian A.";
    }
    if (payload.bahagianA.tenantCount === 0) {
      return "Capture at least one tenant in Bahagian A.";
    }
    if (!payload.bahagianB.instrumentName.captured) {
      return 'Select pds_suratcara (Nama Surat Cara) — today\'s only documented option is "Perjanjian Sewa" / 1101.';
    }
    if (payload.bahagianB.portalDescriptionType === null) {
      return "Select pds_jenis (Jenis Surat Cara) on Bahagian B.";
    }
    if (payload.bahagianB.rentSchedule.length === 0) {
      return "Capture the rent schedule on Bahagian B (one period for fixed rent, two or more for variable).";
    }
    if (!payload.bahagianC.addressLine1) {
      return "Capture the property address on Bahagian C.";
    }
    if (
      payload.bahagianC.propertyType === "kediaman" &&
      payload.bahagianC.buildingTypeRequiredButMissing
    ) {
      return "Select a building type (Jenis Bangunan) on Bahagian C — required when Jenis Harta = Kediaman.";
    }
    return "Resolve the missing required-details fields listed below.";
  }

  // Payload layer.
  if (payloadStatus === "blocked") {
    if (payload.unsupportedAutomationReasons.length > 0) {
      return "This pds_jenis option is not supported by current automation. Handle this job outside the assisted path.";
    }
    return "Resolve the payload-layer blockers listed below.";
  }

  // Instruction-draft layer.
  if (instructionDraftStatus === "blocked") {
    return "Resolve the instruction-draft blockers listed below.";
  }

  // Catch-all — prefer the first concrete blocking reason if we have
  // one, otherwise a generic prompt.
  if (blockingReasons.length > 0) {
    return `Resolve: ${blockingReasons[0]}`;
  }
  return "Resolve the blockers listed below.";
}
