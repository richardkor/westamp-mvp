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

import type {
  StampingJob,
  TenancyPortalParty,
  TenancyPortalProperty,
} from "./stamping-types";
import {
  ALLOWED_INSTRUMENT_RELATIONSHIPS,
  ALLOWED_LAND_AREA_UNITS,
  PDS_JENIS_REQUIRING_BALASAN,
} from "./tenancy-portal-requirements";
import {
  isMappingSafe,
  mapDuplicateCopies,
  mapFurnishedStatus,
  mapPropertyCategory,
  mapPropertyCountry,
  mapPropertyState,
} from "./tenancy-portal-canonical-maps";
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
 * Field-mapping safety-blocker categories. Surfaced in the operator
 * UI under a "Portal field mapping gaps discovered" heading so it is
 * obvious that the verdict is `blocked` because of newly-discovered
 * portal requirements that WeStamp's model / compiler does not yet
 * support — distinct from the existing blocker categories (missing
 * required-details, payload section blocked, instruction-draft
 * section blocked).
 *
 * The categories mirror the four groups documented in
 * `docs/2026-04-28-tenancy-portal-field-mapping.md` §4 and §7.
 */
export type TenancyPortalFieldMappingGapCategory =
  /** pds_jenis values / rent-schedule shapes that need a multi-pass compiler. */
  | "multi_pass_unsupported"
  /** Bahagian C land-registry fields the WeStamp model has no slot for. */
  | "land_registry_not_modelled"
  /**
   * Maklumat Am portal fields that are now modelled but still need
   * operator capture before the run can be deemed ready (Milestone A2).
   */
  | "maklumat_am_not_captured"
  /** Portal value-set mismatch (enum / dropdown) requiring explicit handling. */
  | "portal_enum_mismatch"
  /** Per-party gaps (citizenship-3way / NRIC sub-type / gender / SSM rep id). */
  | "party_model_not_modelled";

/** One safety-blocker entry. Always blocking in this milestone. */
export interface TenancyPortalFieldMappingGap {
  /** Stable category for grouping in the UI. */
  category: TenancyPortalFieldMappingGapCategory;
  /**
   * Stable, machine-readable code (e.g. `pds_jenis_1104_unsupported`).
   * Useful for tests and for telemetry; never localized.
   */
  code: string;
  /** Operator-facing reason — concrete and actionable. */
  reason: string;
}

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
   * Field-mapping safety blockers (added by the 2026-04-28 supervised
   * field-mapping correction milestone). Each entry is one specific
   * portal requirement that WeStamp's current model / compiler does
   * not yet handle correctly — see `docs/2026-04-28-tenancy-portal-
   * field-mapping.md`. These reasons are also included in the
   * top-level `blockingReasons` so existing UI rendering still picks
   * them up.
   *
   * When this list is non-empty the verdict is ALWAYS `blocked`,
   * regardless of any other layer being ready.
   */
  portalFieldMappingGaps: TenancyPortalFieldMappingGap[];
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

  // ── Field-mapping safety blockers (2026-04-28 correction) ───
  // Evaluated after the existing layers so the operator sees their
  // already-familiar reason set first; gaps are appended below those
  // and additionally surfaced via `portalFieldMappingGaps` for the
  // operator UI's dedicated heading.
  const portalFieldMappingGaps = evaluateTenancyPortalFieldMappingGaps(job);
  for (const g of portalFieldMappingGaps) {
    push(g.reason);
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
    portalFieldMappingGaps.length === 0 &&
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
    payload,
    portalFieldMappingGaps
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
    portalFieldMappingGaps,
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
  payload: TenancyPortalPayload,
  portalFieldMappingGaps: TenancyPortalFieldMappingGap[]
): string {
  if (verdict === "ready_for_supervised_run") {
    return "Job is portal-data-ready. Schedule a supervised portal run. Final Hantar still requires explicit operator approval.";
  }

  // Field-mapping safety gaps take priority once the per-layer
  // blockers have been resolved — they are structural model gaps
  // that the operator cannot fix from this job alone; the data model
  // and / or compiler need to be extended in a separate milestone.
  // Mention them explicitly so the operator knows the recommended
  // action is "do not run; escalate to engineering", not "capture
  // more data".
  if (portalFieldMappingGaps.length > 0) {
    const cats = new Set(portalFieldMappingGaps.map((g) => g.category));
    if (cats.has("multi_pass_unsupported")) {
      return "This job's pds_jenis / rent-schedule shape needs a multi-pass compiler. Do not run live until the multi-pass milestone lands.";
    }
    return "Portal field-mapping gaps discovered. Do not run live until the data model and compiler are updated to cover the missing portal fields listed below.";
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

// ─── Field-mapping safety blockers (2026-04-28 correction) ─────────

/**
 * Stable explanation suffix used at the head of every gap reason.
 * Centralised so the operator UI shows a single, consistent narrative
 * across all four gap categories.
 */
const FIELD_MAPPING_GAP_HEADER =
  "Portal field-mapping run found additional e-Duti Setem fields not yet captured by WeStamp.";

/**
 * Evaluate the four safety-blocker categories against a job. Pure;
 * called by `evaluateTenancyPortalRunReadiness`. Each returned entry
 * is treated as a hard blocker — there are no warnings in this
 * milestone (matches the strict scope of the 2026-04-28 correction).
 *
 * The function deliberately does NOT inspect WeStamp's existing
 * required-details readiness — those are surfaced through the
 * pre-existing layers. Its only job is to surface gaps the
 * field-mapping run proved exist regardless of whether WeStamp's
 * older model thinks the data is "ready".
 *
 * The function reads only from `job.tenancyPortalDetails`. We don't
 * take the compiled payload as an input because the gap categories
 * are about model shape (presence / absence of fields, value-set
 * compatibility) and a payload re-derivation would not add
 * information.
 */
export function evaluateTenancyPortalFieldMappingGaps(
  job: TenancyPortalRunReadinessJobInput
): TenancyPortalFieldMappingGap[] {
  const gaps: TenancyPortalFieldMappingGap[] = [];
  const tpd = job.tenancyPortalDetails;

  // ── A) Multi-pass unsupported conditions ────────────────────
  // Variable-rent (1104) and amendment (1105) require server
  // round-trips that reveal additional conditional fields. The
  // committed instruction-draft compiler is single-pass and cannot
  // safely drive either path. Multiple rent periods imply the same
  // multi-pass requirement even when the operator has not picked
  // pds_jenis = 1104 explicitly (e.g. someone selected fixed-rent
  // but entered two periods).
  const descType = tpd?.instrument?.portalDescriptionType ?? null;
  if (descType === "variable_rent_during_tenancy") {
    gaps.push({
      category: "multi_pass_unsupported",
      code: "pds_jenis_1104_unsupported",
      reason:
        'pds_jenis = "Bayaran Sewa Berbeza Dalam Tempoh Penyewaan" (1104, variable rent) requires a multi-pass compiler. The portal does not reveal per-period fields client-side; reveal happens only after a server-side Simpan round-trip.',
    });
  }
  if (descType === "amendment_to_original_tenancy") {
    gaps.push({
      category: "multi_pass_unsupported",
      code: "pds_jenis_1105_unsupported",
      reason:
        'pds_jenis = "Terdapat Pindaan Ke Atas Perjanjian Sewa/Pajakan Yang Asal" (1105, amendment) requires a multi-pass compiler. The portal\'s par_id ("No Adjudikasi Surat Cara Sewa/Pajakan Asal") field stays hidden after dropdown change and only reveals server-side.',
    });
  }
  const scheduleLength = tpd?.instrument?.rentSchedule?.length ?? 0;
  if (scheduleLength > 1) {
    gaps.push({
      category: "multi_pass_unsupported",
      code: "rent_schedule_multiple_periods",
      reason: `Rent schedule has ${scheduleLength} periods. Multiple-period rent shapes require a multi-pass compiler that can re-inspect the portal for the per-period fields revealed only after Simpan Bahagian B.`,
    });
  }

  // ── B) Bahagian C land-registry fields ──────────────────────
  // Milestone A1 (2026-04-29) added the land-registry sub-block to
  // the data model and operator UI. The Category B blockers are now
  // per-field: each fires only when the corresponding field is
  // missing or invalid, and is lifted as soon as the operator
  // captures a valid value. `pds_kegunaan` is optional per scope and
  // never blocks readiness.
  //
  // The blockers still fire whenever a `property` block has been
  // started but `landRegistry` (or specific sub-fields) is missing —
  // a brand-new empty job is already blocked at the property-type /
  // address rows, so doubling up the land-registry blockers on an
  // empty property would only add noise.
  if (tpd?.property) {
    const lr = tpd.property.landRegistry;
    const isBlankString = (v: string | undefined): boolean =>
      typeof v !== "string" || v.trim().length === 0;
    const milikPenuhMissing = !lr || isBlankString(lr.milikPenuh);
    const lotMissing = !lr || isBlankString(lr.lot);
    const mukimMissing = !lr || isBlankString(lr.mukim);
    const daerahMissing = !lr || isBlankString(lr.daerah);
    const luasMissing =
      !lr ||
      typeof lr.luas !== "number" ||
      !Number.isFinite(lr.luas) ||
      lr.luas <= 0;
    const luasUnitMissing =
      !lr ||
      typeof lr.luasUnit !== "string" ||
      !ALLOWED_LAND_AREA_UNITS.has(lr.luasUnit);

    if (milikPenuhMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_mp_milik_penuh_not_modelled",
        reason:
          'Bahagian C field pds_mp ("Milik Penuh") is required by the portal and not yet captured on this job.',
      });
    }
    if (lotMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_lot_not_modelled",
        reason:
          'Bahagian C field pds_lot ("No. Lot") is required by the portal and not yet captured on this job.',
      });
    }
    if (mukimMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_mukim_not_modelled",
        reason:
          'Bahagian C field pds_mukim ("Mukim") is required by the portal and not yet captured on this job.',
      });
    }
    if (daerahMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_daerah_not_modelled",
        reason:
          'Bahagian C field pds_daerah ("Daerah") is required by the portal and not yet captured on this job.',
      });
    }
    if (luasMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_luas_not_modelled",
        reason:
          'Bahagian C field pds_luas ("Luas Tanah") is required by the portal and not yet captured (must be a positive numeric land-title area). Distinct from premisesAreaSqm (built-up area).',
      });
    }
    if (luasUnitMissing) {
      gaps.push({
        category: "land_registry_not_modelled",
        code: "pds_luasunit_not_modelled",
        reason:
          'Bahagian C field pds_luasunit ("Unit Luas") is required by the portal and not yet captured. Must be one of: ekar, hektar, kps, mps.',
      });
    }
  }

  // ── B2) Maklumat Am required field captures (Milestone A2) ──
  // The Maklumat Am sub-block is now modelled (see
  // `TenancyPortalMaklumatAm` in `stamping-types.ts`) but specific
  // fields still need operator capture before a tenancy job can be
  // declared ready. This category fires per-field blockers exactly
  // like the land-registry category.
  //
  // Conditional rules:
  //   - pds_dutisetem        always required
  //   - pds_ps               always required (must be a known enum)
  //   - pds_balasan          required when pds_jenis is in
  //                          PDS_JENIS_REQUIRING_BALASAN; otherwise
  //                          captured-but-optional. Malformed
  //                          (non-positive) values always block.
  //   - pds_remit            optional throughout — never blocks
  //   - pds_perjanjian flags optional throughout — never block
  //   - pds_radio_ya/tidak   intentionally NOT modelled (purpose
  //                          unconfirmed); not surfaced as a gap.
  const ma = tpd?.maklumatAm;

  // pds_dutisetem missing
  if (
    !ma ||
    !ma.dutyStampType ||
    typeof ma.dutyStampType.code !== "string" ||
    ma.dutyStampType.code.trim() === ""
  ) {
    gaps.push({
      category: "maklumat_am_not_captured",
      code: "pds_dutisetem_not_captured",
      reason:
        'Maklumat Am field pds_dutisetem ("Jenis Duti Setem") is required by the portal and not yet captured on this job.',
    });
  }

  // pds_ps missing or unknown
  if (
    !ma ||
    typeof ma.instrumentRelationship !== "string" ||
    !ALLOWED_INSTRUMENT_RELATIONSHIPS.has(ma.instrumentRelationship)
  ) {
    gaps.push({
      category: "maklumat_am_not_captured",
      code: "pds_ps_not_captured",
      reason:
        'Maklumat Am field pds_ps (instrument relationship) is required by the portal and not yet captured. Must be one of: principal (p · Prinsipal), related_lease_49e (s · Surat Cara berkaitan Pajakan 49(e)).',
    });
  }

  // pds_balasan — three sub-cases:
  //   (i)   supplied but malformed (non-positive / non-finite) → block
  //   (ii)  missing AND pds_jenis path requires it → block
  //   (iii) missing AND pds_jenis path doesn't require it → no block
  const balasanSupplied =
    ma !== undefined && ma !== null && typeof ma.balasan === "number";
  const balasanIsPositive =
    balasanSupplied &&
    Number.isFinite(ma!.balasan!) &&
    (ma!.balasan as number) > 0;
  const descTypeForBalasan = tpd?.instrument?.portalDescriptionType ?? null;
  const balasanRequiredHere =
    descTypeForBalasan !== null &&
    PDS_JENIS_REQUIRING_BALASAN.has(descTypeForBalasan);
  if (balasanSupplied && !balasanIsPositive) {
    gaps.push({
      category: "maklumat_am_not_captured",
      code: "pds_balasan_invalid",
      reason:
        'Maklumat Am field pds_balasan ("Balasan / Premium") was supplied but is not a positive finite number. The portal expects a single positive consideration amount.',
    });
  } else if (!balasanSupplied && balasanRequiredHere) {
    gaps.push({
      category: "maklumat_am_not_captured",
      code: "pds_balasan_not_captured",
      reason: `Maklumat Am field pds_balasan is required when pds_jenis is ${descTypeForBalasan}. WeStamp does NOT auto-derive this from the rent schedule — operator must enter the consideration explicitly.`,
    });
  }

  // pds_remit / pds_perjanjian / pds_radio_ya / pds_radio_tidak —
  // intentionally do NOT emit blockers (per A2 scope).

  // ── C) Portal enum mismatch risks ───────────────────────────
  // After Milestone A3 the per-field decisions are delegated to the
  // pure canonical-mapping helpers in `tenancy-portal-canonical-maps.ts`.
  // Each helper returns a `CanonicalMappingResult` whose `status`
  // dictates whether a blocker fires:
  //
  //   - status="mapped"        → no blocker
  //   - status="unknown_code"  → blocker fires (label known, code not yet observed)
  //   - status="unsupported"   → blocker fires (no portal equivalent)
  //   - status="ambiguous"     → blocker fires (operator confirmation needed)
  //
  // The blocker codes below are preserved from earlier milestones for
  // backward compatibility with operator UI and tests; one new code
  // (`pds_harta_cat_unknown_code`) was added for the case where a
  // mappable Kediaman value has no portal `<option value>` captured
  // yet — that case used to be silently no-blocker, which was unsafe.
  const property: TenancyPortalProperty | undefined = tpd?.property;

  // pds_salinan — driven by the duplicateCopies value on the captured
  // instrument. We only check when an instrument is captured, since
  // the field has no meaning without one.
  if (tpd?.instrument) {
    const salinan = mapDuplicateCopies(tpd.instrument.duplicateCopies);
    if (!isMappingSafe(salinan)) {
      gaps.push({
        category: "portal_enum_mismatch",
        code: "pds_salinan_no_canonical_mapping",
        reason: salinan.reason ?? "pds_salinan mapping is not yet safe.",
      });
    }
  }

  if (property) {
    // pds_harta_state — only fires when the operator has typed
    // something. A blank state is gated by the existing required-
    // details readiness layer above.
    if (property.state && property.state.trim().length > 0) {
      const stateMap = mapPropertyState(property.state);
      if (!isMappingSafe(stateMap)) {
        gaps.push({
          category: "portal_enum_mismatch",
          code: "pds_harta_state_no_canonical_mapping",
          reason: stateMap.reason ?? "pds_harta_state mapping is not yet safe.",
        });
      }
    }

    // pds_harta_country — same shape as state.
    if (property.country && property.country.trim().length > 0) {
      const countryMap = mapPropertyCountry(property.country);
      if (!isMappingSafe(countryMap)) {
        gaps.push({
          category: "portal_enum_mismatch",
          code: "pds_harta_country_no_canonical_mapping",
          reason:
            countryMap.reason ?? "pds_harta_country mapping is not yet safe.",
        });
      }
    }

    // pds_harta_cat — property-type-specific. Translate the
    // canonical-mapping status into one of the existing blocker
    // codes (preserved for backward compatibility) plus a new
    // `pds_harta_cat_unknown_code` blocker for the "label known,
    // code unknown" case.
    const catMap = mapPropertyCategory(
      property.propertyType,
      property.buildingType
    );
    if (!isMappingSafe(catMap)) {
      // Decide which legacy blocker code to emit based on the
      // specific WeStamp value + property type combo.
      let blockerCode: string;
      if (
        property.propertyType === "perdagangan" ||
        property.propertyType === "perindustrian"
      ) {
        blockerCode = "pds_harta_cat_propertyType_unsupported";
      } else if (
        property.propertyType === "kediaman" &&
        (property.buildingType === "studio" ||
          property.buildingType === "lain_lain" ||
          property.buildingType === "apartment")
      ) {
        blockerCode = `building_type_${property.buildingType}_no_portal_equivalent`;
      } else if (catMap.status === "unknown_code") {
        // Mappable Kediaman value (label known) — code not yet
        // captured. Surface as a distinct blocker so operators know
        // the difference between "no portal equivalent" and "we
        // know the label but need the code".
        blockerCode = "pds_harta_cat_unknown_code";
      } else {
        // Defensive fallback — covers e.g. Kediaman + rumah_banglo
        // and any future TenancyPortalBuildingType values not in
        // the seeded Kediaman label table.
        blockerCode = "pds_harta_cat_propertyType_unsupported";
      }
      gaps.push({
        category: "portal_enum_mismatch",
        code: blockerCode,
        reason: catMap.reason ?? "pds_harta_cat mapping is not yet safe.",
      });
    }

    // pds_harta_perabot — driven by furnishedStatus when supplied.
    // Blank furnishedStatus is captured-but-optional at the
    // required-details layer; we only fire enum-mismatch blockers
    // when the operator has chosen a value.
    if (property.furnishedStatus !== undefined) {
      const furnMap = mapFurnishedStatus(property.furnishedStatus);
      if (!isMappingSafe(furnMap)) {
        // Preserve the existing partially_furnished blocker code
        // for backward compatibility.
        const blockerCode =
          property.furnishedStatus === "partially_furnished"
            ? "furnished_status_partially_furnished_unsupported"
            : "pds_harta_perabot_unknown_code";
        gaps.push({
          category: "portal_enum_mismatch",
          code: blockerCode,
          reason: furnMap.reason ?? "pds_harta_perabot mapping is not yet safe.",
        });
      }
    }
  }

  // ── D) Per-party model gaps ─────────────────────────────────
  // The portal requires gender, 3-way citizenship (citizen / non-
  // citizen / PR), NRIC sub-type, and — for SSM-registered companies
  // — full representative-person identity capture. WeStamp's data
  // model has none of these fields. Surface as per-party blockers so
  // the operator can see exactly which party rows are unsupported.
  const parties: TenancyPortalParty[] = tpd?.parties ?? [];
  parties.forEach((p, idx) => {
    const partyLabel = `${p.role === "landlord" ? "Landlord" : "Tenant"} #${idx + 1}${
      p.nameAsPerInstrument ? ` (${p.nameAsPerInstrument})` : ""
    }`;

    // Gender is required by every party row in the portal.
    gaps.push({
      category: "party_model_not_modelled",
      code: `party_${idx}_gender_not_modelled`,
      reason: `${partyLabel}: portal field USER_SEX (gender) is required and not modelled by WeStamp.`,
    });

    // 3-way citizenship (PR is the missing third value).
    gaps.push({
      category: "party_model_not_modelled",
      code: `party_${idx}_citizenship_3way_not_modelled`,
      reason: `${partyLabel}: portal warga is a 3-option enum (Citizen / Non-citizen / PR). WeStamp's nationality is 2-way — Permanent Resident is unmodelled.`,
    });

    // NRIC sub-type (4-way) — only meaningful for individuals using
    // an NRIC; passport and company_registration paths do not need
    // this field. Still surface as not-modelled since the portal
    // requires it for the NRIC path.
    if (p.type === "individual" && p.identityType === "nric") {
      gaps.push({
        category: "party_model_not_modelled",
        code: `party_${idx}_nric_subtype_not_modelled`,
        reason: `${partyLabel}: portal EPD_NOKP_TYPE is a 4-option NRIC sub-type (IC_BARU / IC_LAMA / IC_POLIS / IC_ARMY). WeStamp captures a single NRIC string with no sub-type.`,
      });
    }

    // SSM company representative-person identity capture is required
    // by the portal SSM modal. WeStamp does not model an owner /
    // representative on company parties at all.
    if (p.type === "company_ssm") {
      gaps.push({
        category: "party_model_not_modelled",
        code: `party_${idx}_ssm_rep_identity_not_modelled`,
        reason: `${partyLabel}: SSM-registered company. Portal SSM Tambah modal requires full representative-person identity (owner_name, citizenship, IC type, IC/passport, gender). WeStamp has no representative-identity capture for company parties.`,
      });
    }
  });

  return gaps;
}

/**
 * Group an array of field-mapping gaps by category. Convenience
 * helper for the operator UI; the order of categories is stable so
 * the panel renders the same section ordering every time.
 */
export function groupTenancyPortalFieldMappingGaps(
  gaps: TenancyPortalFieldMappingGap[]
): { category: TenancyPortalFieldMappingGapCategory; gaps: TenancyPortalFieldMappingGap[] }[] {
  const order: TenancyPortalFieldMappingGapCategory[] = [
    "multi_pass_unsupported",
    "land_registry_not_modelled",
    "maklumat_am_not_captured",
    "portal_enum_mismatch",
    "party_model_not_modelled",
  ];
  return order
    .map((category) => ({
      category,
      gaps: gaps.filter((g) => g.category === category),
    }))
    .filter((g) => g.gaps.length > 0);
}

/**
 * Stable header text the operator UI uses verbatim. Exported so the
 * panel does not duplicate the wording.
 */
export const TENANCY_PORTAL_FIELD_MAPPING_GAPS_HEADER =
  "Portal field mapping gaps discovered";

/**
 * Stable explanation paragraph the operator UI shows under the
 * gaps-discovered heading. Approved wording from the 2026-04-28
 * safety-correction milestone.
 */
export const TENANCY_PORTAL_FIELD_MAPPING_GAPS_EXPLANATION =
  "The tenancy portal field-mapping run found additional e-Duti Setem fields that are not yet captured by WeStamp. This job must not proceed to live portal execution until the model and compiler are updated.";

/**
 * Stable header-narrative line. Exported for telemetry / tests so a
 * change to the text is easy to grep.
 */
export const TENANCY_PORTAL_FIELD_MAPPING_GAP_HEADER =
  FIELD_MAPPING_GAP_HEADER;
