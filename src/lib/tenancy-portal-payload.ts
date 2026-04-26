/**
 * WeStamp — Tenancy Portal Payload Compiler
 *
 * Deterministic helper that converts a job's stored
 * `tenancyPortalDetails` (plus a few related fields like
 * `storagePath`, `originalFileName`, `mimeType`, and the existing
 * `stampingDetails.calculatedDuty`) into a structured portal-ready
 * payload covering Bahagian A, Bahagian B, Bahagian C, Rumusan
 * Pengiraan, Lampiran, and Perakuan.
 *
 * What this module IS
 * ───────────────────
 * - A pure, side-effect-free compiler. Safe to call from server
 *   components, API routes, and the operator panel.
 * - Returns a `TenancyPortalPayload` object plus per-section
 *   readiness so the operator can see at a glance "what would WeStamp
 *   send to the portal, section by section, if the job is ready".
 * - Reuses `evaluateTenancyPortalReadiness` for blocking decisions —
 *   no duplicated readiness logic.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT drive the portal.
 * - It does NOT generate Playwright instructions.
 * - It does NOT submit anything.
 * - It does NOT calculate new duty — it only surfaces the existing
 *   `stampingDetails.calculatedDuty` if available.
 * - It does NOT modify the job.
 *
 * Scope guardrails (mirrored from `tenancy-portal-requirements`)
 * ──────────────────────────────────────────────────────────────
 * - Landlord/tenant email is NOT in the payload.
 * - Signed-in-Malaysia / signed-outside-Malaysia is NOT in the payload.
 * - Received-in-Malaysia date is NOT in the payload.
 *
 * If a future supervised live walk proves any of these is required,
 * they can be added without rewriting the compiler shape.
 */

import type {
  StampingJob,
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalIdentityType,
  TenancyPortalNationality,
  TenancyPortalParty,
  TenancyPortalPartyRole,
  TenancyPortalPartyType,
  TenancyPortalPropertyType,
} from "./stamping-types";

import {
  ALLOWED_DESCRIPTION_TYPES,
  DESCRIPTION_TYPE_LABELS,
  DESCRIPTION_TYPES_WITH_RENT_SCHEDULE,
  evaluateTenancyPortalReadiness,
} from "./tenancy-portal-requirements";

// ─── Output types ───────────────────────────────────────────────────

export type TenancyPortalPayloadSection =
  | "bahagian_a"
  | "bahagian_b"
  | "bahagian_c"
  | "rumusan"
  | "lampiran"
  | "perakuan";

export type TenancyPortalPayloadOverall = "ready" | "blocked";

export type TenancyPortalPayloadSectionState = "ready" | "blocked";

/**
 * Per-section readiness summary. Mirrors the overall structure but
 * scoped to one portal section. Helps the operator preview pinpoint
 * which section is the actual blocker.
 */
export interface TenancyPortalPayloadSectionReadiness {
  section: TenancyPortalPayloadSection;
  state: TenancyPortalPayloadSectionState;
  blockingReasons: string[];
}

/** Bahagian A · single party row in the payload. */
export interface TenancyPortalPayloadParty {
  role: TenancyPortalPartyRole;
  type: TenancyPortalPartyType;
  /**
   * Operator-facing label for the portal's party-type selection
   * (e.g. "Individu", "Syarikat (SSM)", "Syarikat (Bukan SSM)").
   * Derived from `type` here so the operator preview can show the
   * intended portal text without re-deriving it themselves.
   */
  portalPartyCategoryLabel: string;
  name: string;
  nationality: TenancyPortalNationality | null;
  identityType: TenancyPortalIdentityType | null;
  identityNumber: string | null;
  tin: string | null;
  /** Operator hint that MyTax will auto-generate the TIN. */
  tinAutoGenerationExpected: boolean;
  addressLine1: string;
  addressLine2: string | null;
  postcode: string;
  city: string;
  state: string;
  country: string;
  mobile: string;
  phone: string | null;
}

/** Bahagian A · summary block. */
export interface TenancyPortalPayloadBahagianA {
  parties: TenancyPortalPayloadParty[];
  landlordCount: number;
  tenantCount: number;
}

/** Bahagian B · single rent-period row in the payload. */
export interface TenancyPortalPayloadRentPeriod {
  startDate: string;
  endDate: string;
  monthlyRent: number;
  durationMonths: number | null;
}

/**
 * Mode used to interpret the rent-schedule rows. Values:
 *   - "fixed"            — exactly one row expected; covers whole tenancy.
 *   - "variable"         — multiple rows expected; one per rent period.
 *   - "unsupported"      — pds_jenis is one of the four observed
 *                          options that this milestone does NOT model
 *                          (amendment / other-49f / premium-only /
 *                          crop-share-only). Schedule rows present are
 *                          surfaced for transparency only.
 *   - "not_yet_selected" — operator has not picked a pds_jenis value.
 */
export type TenancyPortalPayloadRentScheduleMode =
  | "fixed"
  | "variable"
  | "unsupported"
  | "not_yet_selected";

/**
 * Whether the chosen pds_jenis option is currently supported by
 * WeStamp's automation path.
 */
export type TenancyPortalPayloadAutomationSupport = "supported" | "blocked";

/** Bahagian B · summary block. */
export interface TenancyPortalPayloadBahagianB {
  instrumentDate: string | null;
  duplicateCopies: number | null;
  portalDescriptionType: TenancyPortalDescriptionType | null;
  portalDescriptionLabel: string | null;
  rentScheduleMode: TenancyPortalPayloadRentScheduleMode;
  rentSchedule: TenancyPortalPayloadRentPeriod[];
  automationSupportStatus: TenancyPortalPayloadAutomationSupport;
  /** Free-text reason when blocked. Null when supported. */
  automationSupportReason: string | null;
}

/** Bahagian C · summary block. */
export interface TenancyPortalPayloadBahagianC {
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  propertyType: TenancyPortalPropertyType | null;
  /** Portal-side label for `propertyType`, e.g. "Kediaman". */
  propertyTypeLabel: string | null;
  buildingType: TenancyPortalBuildingType | null;
  /** Set to true when buildingType is required by current
   *  configuration but absent. */
  buildingTypeRequiredButMissing: boolean;
  furnishedStatus: TenancyPortalFurnishedStatus | null;
  floor: string | null;
  numberOfFloors: number | null;
  premisesAreaSqm: number | null;
  /** True only when the value is explicitly `0` and the operator
   *  fallback flag is set. */
  premisesAreaIsZeroFallback: boolean;
}

/** Rumusan Pengiraan · placeholder block. */
export interface TenancyPortalPayloadRumusan {
  /** WeStamp's existing internal duty calculation, if available.
   *  Reused verbatim from `stampingDetails.calculatedDuty.totalDuty`
   *  — never recalculated. */
  westampInternalCalculatedDuty: number | null;
  /** Aggregate of the rent schedule, derived locally. Null if no
   *  schedule is captured. */
  rentTotalSummary: {
    /** Total months across all rent periods (sum of durationMonths
     *  if available; falls back to start/end span when missing). */
    totalMonths: number;
    /** Sum of (monthlyRent × periodMonths) across all periods. */
    totalRent: number;
  } | null;
  /**
   * Compared against the live portal value at supervised execution
   * time. Two values today: "ready_for_future_comparison" if the
   * payload has a duty AND the schedule, else "not_compared".
   */
  comparisonStatus: "not_compared" | "ready_for_future_comparison";
}

/** Lampiran · placeholder block. */
export interface TenancyPortalPayloadLampiran {
  sourcePdfStoragePath: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  /** True only when the source PDF is reachable; the actual upload
   *  is a separate supervised step that this milestone does NOT
   *  perform. */
  readyToUpload: boolean;
}

/** Perakuan · supervised gate marker. */
export interface TenancyPortalPayloadPerakuan {
  /** Constant — the final declaration is always supervised. */
  finalSubmissionGate: "supervised";
  /** Constant — the payload stage is NEVER allowed to final-submit. */
  finalSubmissionAllowedAtPayloadStage: false;
  /** Operator-facing reminder. */
  note: string;
}

/** Top-level payload object returned by the compiler. */
export interface TenancyPortalPayload {
  /** ISO 8601 timestamp when the payload was generated. */
  generatedAt: string;
  /** Aggregate readiness across all sections. */
  overall: TenancyPortalPayloadOverall;
  /** Aggregated blocking reasons across sections. May be empty when
   *  overall is "ready". */
  blockingReasons: string[];
  /** Subset of blocking reasons specifically about unsupported
   *  pds_jenis options. May be empty even when blocked for other
   *  reasons. */
  unsupportedAutomationReasons: string[];
  bahagianA: TenancyPortalPayloadBahagianA;
  bahagianB: TenancyPortalPayloadBahagianB;
  bahagianC: TenancyPortalPayloadBahagianC;
  rumusan: TenancyPortalPayloadRumusan;
  lampiran: TenancyPortalPayloadLampiran;
  perakuan: TenancyPortalPayloadPerakuan;
  sectionReadiness: TenancyPortalPayloadSectionReadiness[];
}

// ─── Internal label maps ────────────────────────────────────────────

const PARTY_TYPE_LABELS: Record<TenancyPortalPartyType, string> = {
  individual: "Individu",
  company_ssm: "Syarikat (SSM)",
  company_non_ssm: "Syarikat (Bukan SSM)",
};

const PROPERTY_TYPE_LABELS: Record<TenancyPortalPropertyType, string> = {
  kediaman: "Kediaman",
  perdagangan: "Perdagangan",
  perindustrian: "Perindustrian",
  tanah_kosong: "Tanah Kosong",
};

const PERAKUAN_NOTE =
  "Final submission is a supervised gate. The payload stage NEVER " +
  "submits to e-Duti Setem. Submission requires explicit operator " +
  "authorization at execution time.";

// ─── Compiler ──────────────────────────────────────────────────────

/**
 * Job subset the compiler reads. Restricted on purpose so it is
 * obvious this helper does not look at fulfilment state, payment,
 * portal probes, or anything else.
 */
export type TenancyPortalPayloadJobInput = Pick<
  StampingJob,
  | "tenancyPortalDetails"
  | "storagePath"
  | "originalFileName"
  | "mimeType"
  | "documentCategory"
  | "stampingDetails"
>;

const NON_EMPTY = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Compile a `TenancyPortalPayload` from a job's stored details.
 *
 * Behaviour highlights
 * ────────────────────
 * - Reuses `evaluateTenancyPortalReadiness` to determine `overall`
 *   and to harvest section blocking reasons. Does NOT redefine the
 *   readiness rules.
 * - Maps `portalDescriptionType` to a human-readable Bahasa Malaysia
 *   label and to a rent-schedule mode.
 * - Surfaces premises-area-zero-fallback explicitly so the preview
 *   can warn the operator that the value is operator-confirmed.
 * - Computes a small Rumusan summary (total months, total rent) by
 *   walking the schedule rows. Does NOT recalculate stamp duty.
 */
export function compileTenancyPortalPayload(
  job: TenancyPortalPayloadJobInput
): TenancyPortalPayload {
  const tpd: TenancyPortalDetails | undefined = job.tenancyPortalDetails;
  const generatedAt = new Date().toISOString();

  // ── Bahagian A ──────────────────────────────────────────────
  const parties: TenancyPortalPayloadParty[] = (tpd?.parties ?? []).map((p) =>
    mapParty(p)
  );
  const landlordCount = parties.filter((x) => x.role === "landlord").length;
  const tenantCount = parties.filter((x) => x.role === "tenant").length;
  const bahagianA: TenancyPortalPayloadBahagianA = {
    parties,
    landlordCount,
    tenantCount,
  };

  // ── Bahagian B ──────────────────────────────────────────────
  const bahagianB = mapBahagianB(tpd);

  // ── Bahagian C ──────────────────────────────────────────────
  const bahagianC = mapBahagianC(tpd);

  // ── Rumusan ─────────────────────────────────────────────────
  const rumusan = mapRumusan(job, bahagianB);

  // ── Lampiran ────────────────────────────────────────────────
  const lampiran: TenancyPortalPayloadLampiran = {
    sourcePdfStoragePath: NON_EMPTY(job.storagePath) ? job.storagePath : null,
    originalFileName: NON_EMPTY(job.originalFileName)
      ? job.originalFileName
      : null,
    mimeType: NON_EMPTY(job.mimeType) ? job.mimeType : null,
    readyToUpload: NON_EMPTY(job.storagePath),
  };

  // ── Perakuan ────────────────────────────────────────────────
  const perakuan: TenancyPortalPayloadPerakuan = {
    finalSubmissionGate: "supervised",
    finalSubmissionAllowedAtPayloadStage: false,
    note: PERAKUAN_NOTE,
  };

  // ── Cross-section readiness ─────────────────────────────────
  const report = evaluateTenancyPortalReadiness({
    tenancyPortalDetails: tpd,
    storagePath: job.storagePath,
    documentCategory: job.documentCategory,
  });

  const sectionReadiness = buildSectionReadiness(report.fields, bahagianB);

  // Aggregate top-level reasons. Any non-ready section's reasons
  // bubble up. Unsupported-automation reasons are tagged separately
  // so the preview can call them out.
  const blockingReasons: string[] = [];
  const unsupportedAutomationReasons: string[] = [];
  for (const sr of sectionReadiness) {
    for (const reason of sr.blockingReasons) {
      blockingReasons.push(reason);
    }
  }
  if (bahagianB.automationSupportStatus === "blocked" && bahagianB.automationSupportReason) {
    unsupportedAutomationReasons.push(bahagianB.automationSupportReason);
  }

  const overall: TenancyPortalPayloadOverall =
    report.overall === "ready" &&
    bahagianB.automationSupportStatus === "supported"
      ? "ready"
      : "blocked";

  return {
    generatedAt,
    overall,
    blockingReasons,
    unsupportedAutomationReasons,
    bahagianA,
    bahagianB,
    bahagianC,
    rumusan,
    lampiran,
    perakuan,
    sectionReadiness,
  };
}

// ─── Section mappers ───────────────────────────────────────────────

function mapParty(p: TenancyPortalParty): TenancyPortalPayloadParty {
  return {
    role: p.role,
    type: p.type,
    portalPartyCategoryLabel: PARTY_TYPE_LABELS[p.type],
    name: p.nameAsPerInstrument,
    nationality: p.nationality ?? null,
    identityType: p.identityType ?? null,
    identityNumber: NON_EMPTY(p.identityNumber) ? p.identityNumber : null,
    tin: NON_EMPTY(p.tin) ? p.tin : null,
    tinAutoGenerationExpected: p.tinAutoGenerationExpected === true,
    addressLine1: p.addressLine1,
    addressLine2: NON_EMPTY(p.addressLine2) ? p.addressLine2 : null,
    postcode: p.postcode,
    city: p.city,
    state: p.state,
    country: p.country,
    mobile: p.mobile,
    phone: NON_EMPTY(p.phone) ? p.phone : null,
  };
}

function mapBahagianB(
  tpd: TenancyPortalDetails | undefined
): TenancyPortalPayloadBahagianB {
  const instrument = tpd?.instrument;
  const descType = instrument?.portalDescriptionType;
  const descKnown =
    descType !== undefined && ALLOWED_DESCRIPTION_TYPES.has(descType);
  const descSupportsSchedule =
    descKnown && DESCRIPTION_TYPES_WITH_RENT_SCHEDULE.has(descType);

  let rentScheduleMode: TenancyPortalPayloadRentScheduleMode;
  if (!descKnown) {
    rentScheduleMode = "not_yet_selected";
  } else if (descType === "fixed_rent_during_tenancy") {
    rentScheduleMode = "fixed";
  } else if (descType === "variable_rent_during_tenancy") {
    rentScheduleMode = "variable";
  } else {
    rentScheduleMode = "unsupported";
  }

  let automationSupportStatus: TenancyPortalPayloadAutomationSupport;
  let automationSupportReason: string | null;
  if (!descKnown) {
    automationSupportStatus = "blocked";
    automationSupportReason =
      "Bahagian B description (pds_jenis) not yet selected.";
  } else if (descSupportsSchedule) {
    automationSupportStatus = "supported";
    automationSupportReason = null;
  } else {
    automationSupportStatus = "blocked";
    automationSupportReason = `pds_jenis "${
      DESCRIPTION_TYPE_LABELS[descType]
    }" is not supported by current automation. Handle this job outside the assisted path until the data model is extended.`;
  }

  const rentSchedule: TenancyPortalPayloadRentPeriod[] =
    instrument?.rentSchedule.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      monthlyRent: r.monthlyRent,
      durationMonths:
        typeof r.durationMonths === "number" ? r.durationMonths : null,
    })) ?? [];

  return {
    instrumentDate: instrument?.instrumentDate ?? null,
    duplicateCopies:
      typeof instrument?.duplicateCopies === "number"
        ? instrument.duplicateCopies
        : null,
    portalDescriptionType: descKnown ? descType : null,
    portalDescriptionLabel: descKnown ? DESCRIPTION_TYPE_LABELS[descType] : null,
    rentScheduleMode,
    rentSchedule,
    automationSupportStatus,
    automationSupportReason,
  };
}

function mapBahagianC(
  tpd: TenancyPortalDetails | undefined
): TenancyPortalPayloadBahagianC {
  const property = tpd?.property;
  const propertyType = property?.propertyType ?? null;
  const buildingType = property?.buildingType ?? null;
  const buildingTypeRequiredButMissing =
    propertyType === "kediaman" && !NON_EMPTY(buildingType);
  const areaIsZero =
    typeof property?.premisesAreaSqm === "number" &&
    property.premisesAreaSqm === 0;
  const premisesAreaIsZeroFallback =
    areaIsZero && property?.premisesAreaIsZeroFallback === true;

  return {
    addressLine1: property?.addressLine1 ?? null,
    addressLine2: NON_EMPTY(property?.addressLine2)
      ? property?.addressLine2 ?? null
      : null,
    postcode: property?.postcode ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    country: property?.country ?? null,
    propertyType,
    propertyTypeLabel: propertyType ? PROPERTY_TYPE_LABELS[propertyType] : null,
    buildingType,
    buildingTypeRequiredButMissing,
    furnishedStatus: property?.furnishedStatus ?? null,
    floor: NON_EMPTY(property?.floor) ? property?.floor ?? null : null,
    numberOfFloors:
      typeof property?.numberOfFloors === "number"
        ? property.numberOfFloors
        : null,
    premisesAreaSqm:
      typeof property?.premisesAreaSqm === "number"
        ? property.premisesAreaSqm
        : null,
    premisesAreaIsZeroFallback,
  };
}

function mapRumusan(
  job: TenancyPortalPayloadJobInput,
  bahagianB: TenancyPortalPayloadBahagianB
): TenancyPortalPayloadRumusan {
  const totalDuty = job.stampingDetails?.calculatedDuty?.totalDuty;
  const westampInternalCalculatedDuty =
    typeof totalDuty === "number" && Number.isFinite(totalDuty)
      ? totalDuty
      : null;

  // Build a lightweight rent total summary by walking the captured
  // schedule. If durationMonths is missing for a row, we estimate
  // from the start/end span (calendar months, ceiling). Only used
  // for the operator preview; not a duty recalculation.
  let rentTotalSummary: TenancyPortalPayloadRumusan["rentTotalSummary"] = null;
  if (bahagianB.rentSchedule.length > 0) {
    let totalMonths = 0;
    let totalRent = 0;
    for (const r of bahagianB.rentSchedule) {
      const months =
        r.durationMonths !== null
          ? r.durationMonths
          : estimateMonthsBetween(r.startDate, r.endDate);
      if (months !== null && Number.isFinite(months) && months > 0) {
        totalMonths += months;
        totalRent += months * r.monthlyRent;
      }
    }
    if (totalMonths > 0) {
      rentTotalSummary = { totalMonths, totalRent };
    }
  }

  const comparisonStatus: TenancyPortalPayloadRumusan["comparisonStatus"] =
    westampInternalCalculatedDuty !== null && rentTotalSummary !== null
      ? "ready_for_future_comparison"
      : "not_compared";

  return {
    westampInternalCalculatedDuty,
    rentTotalSummary,
    comparisonStatus,
  };
}

/**
 * Estimate calendar-months between two ISO date strings. Returns null
 * if either date is malformed or end < start. Conservative: rounds up
 * to the next whole month so the preview never under-counts.
 */
function estimateMonthsBetween(
  startIso: string,
  endIso: string
): number | null {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  const startDate = new Date(s);
  const endDate = new Date(e);
  const yearDiff = endDate.getUTCFullYear() - startDate.getUTCFullYear();
  const monthDiff = endDate.getUTCMonth() - startDate.getUTCMonth();
  const dayDiff = endDate.getUTCDate() - startDate.getUTCDate();
  const months = yearDiff * 12 + monthDiff + (dayDiff >= 0 ? 0 : -1);
  return Math.max(1, months + 1);
}

// ─── Section readiness aggregation ─────────────────────────────────

/**
 * Group the readiness evaluator's per-field rows by section and
 * determine each section's blocking reasons. The Bahagian B
 * automation-support reason is also folded into the bahagian_b
 * blocking list when applicable.
 */
function buildSectionReadiness(
  fields: ReturnType<
    typeof evaluateTenancyPortalReadiness
  >["fields"],
  bahagianB: TenancyPortalPayloadBahagianB
): TenancyPortalPayloadSectionReadiness[] {
  const sections: TenancyPortalPayloadSection[] = [
    "bahagian_a",
    "bahagian_b",
    "bahagian_c",
    "rumusan",
    "lampiran",
    "perakuan",
  ];
  const out: TenancyPortalPayloadSectionReadiness[] = [];
  for (const section of sections) {
    const sectionFields = fields.filter((f) => f.section === section);
    const blocking: string[] = [];
    for (const f of sectionFields) {
      if (f.state === "missing" || f.state === "conditional_missing") {
        blocking.push(`${f.label}${f.notes ? ` — ${f.notes}` : " — required"}`);
      }
    }
    if (
      section === "bahagian_b" &&
      bahagianB.automationSupportStatus === "blocked" &&
      bahagianB.automationSupportReason
    ) {
      // Avoid duplicating the same reason if it's already there.
      const reason = `Automation: ${bahagianB.automationSupportReason}`;
      if (!blocking.includes(reason)) blocking.push(reason);
    }
    out.push({
      section,
      state: blocking.length === 0 ? "ready" : "blocked",
      blockingReasons: blocking,
    });
  }
  return out;
}
