/**
 * WeStamp — Tenancy Bahagian A · Party Entry Plan (Milestone B8)
 *
 * Pure helper that converts the existing WeStamp party data into a
 * planned Bahagian A party-entry plan. Side-effect-free; never opens
 * a browser, never touches Playwright, never persists anything.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the per-party / per-job Bahagian A
 *   readiness verdict at the planning layer (executor-independent).
 * - The list of internal WeStamp field keys each party type requires
 *   before WeStamp can attempt portal-side modal entry.
 * - The cumulative `expectedRowCountAfter` for each planned party,
 *   used downstream to verify the live Bahagian A table after each
 *   row commit.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT enumerate portal field selectors or option codes —
 *   that is `tenancy-bahagian-a-field-mapping.ts`'s job.
 * - It does NOT decide whether the live portal is in the right state
 *   to begin party entry — that lives in the modal-diagnosis layer.
 * - It does NOT execute or save any party row. B8 is a planning
 *   milestone; no portal mutation happens here.
 */

import type {
  StampingJob,
  TenancyPortalParty,
  TenancyPortalPartyRole,
  TenancyPortalPartyType,
} from "./stamping-types";

/**
 * Minimum fields needed to build a Bahagian A party plan. The
 * operator panel passes a synthesized `liveJobInput` that does not
 * include `id` during edit-mode preview, so `id` is optional here
 * — the plan defaults to `""` when absent.
 */
export type TenancyBahagianAPartyPlanJobInput = Pick<
  StampingJob,
  "tenancyPortalDetails"
> & { id?: string };

// ─── Public types ──────────────────────────────────────────────────

/** Plan-status enum for both per-party and overall verdicts. */
export type TenancyBahagianAPartyPlanStatus =
  | "ready_for_modal_mapping"
  | "blocked_missing_party_data"
  | "unsupported_party_type"
  | "mapping_unknown";

/**
 * One internal WeStamp field key required for a party of a given
 * type. Internal keys are the field keys that already exist on the
 * `TenancyPortalParty` / `TenancyPortalCompanyRepresentative`
 * model — the planner never invents new keys.
 */
export interface TenancyBahagianAPartyRequiredFieldKey {
  /** Stable internal field key (e.g. `nameAsPerInstrument`, `companyRepresentative.gender`). */
  internalKey: string;
  /** Whether the field is unconditionally required. */
  required: true;
  /** Human-readable reason this field is required. */
  reason: string;
}

/**
 * Single planned party. Carries enough context for the operator UI
 * and the future executor to know exactly which party comes next,
 * which fields are missing, and what row count to expect after the
 * portal modal save.
 *
 * `partyName` and `identityNumberPresent` are surfaced to help the
 * operator distinguish parties at a glance during development. The
 * raw identity number is NEVER copied here — only a presence bool.
 */
export interface TenancyBahagianAPlannedPartyEntry {
  /** 1-based ordinal, in the order parties appear in the job. */
  ordinal: number;
  role: TenancyPortalPartyRole;
  type: TenancyPortalPartyType;
  /** Operator-facing party name as captured. Optional. */
  partyName?: string;
  /** True iff `identityNumber` is captured (presence only). */
  identityNumberPresent: boolean;
  /** All internal field keys this party type requires. */
  requiredInternalFields: TenancyBahagianAPartyRequiredFieldKey[];
  /** Subset of required keys that are not yet captured on the party record. */
  missingInternalFields: string[];
  /**
   * Plain-language blocker descriptions, one per distinct missing
   * field group. Empty when `planStatus === "ready_for_modal_mapping"`.
   */
  blockers: string[];
  /**
   * Cumulative Bahagian A table row count expected AFTER this party
   * is committed via the portal modal. Equal to ordinal — every
   * planned party adds exactly one row. Useful as the
   * `verify_row_count` expected-count downstream.
   */
  expectedRowCountAfter: number;
  /** Per-party verdict. */
  planStatus: TenancyBahagianAPartyPlanStatus;
}

/** Overall plan envelope. */
export interface TenancyBahagianAPartyPlan {
  jobId: string;
  /** Always `sewa_pajakan` for tenancy jobs in this milestone. */
  lane: "sewa_pajakan";
  /** Stable phase id matching `tenancy-instruction-graph`. */
  phase: "phase_3_bahagian_a_parties";
  expectedPartyCount: number;
  landlordCount: number;
  tenantCount: number;
  parties: TenancyBahagianAPlannedPartyEntry[];
  /**
   * Aggregated verdict. The most-blocking per-party verdict wins:
   *   - any `unsupported_party_type` → overall is unsupported
   *   - else any `blocked_missing_party_data` → overall is blocked
   *   - else any `mapping_unknown` → overall is mapping_unknown
   *   - else `ready_for_modal_mapping`
   *
   * If `expectedPartyCount === 0` the overall verdict is
   * `blocked_missing_party_data` — every Bahagian A pass requires
   * at least one party.
   */
  overallStatus: TenancyBahagianAPartyPlanStatus;
  blockers: string[];
}

// ─── Field requirement matrices ────────────────────────────────────

/**
 * Internal field keys required for an `individual` party. Mirrors
 * the existing readiness gate in `tenancy-portal-run-readiness.ts`
 * but is duplicated here at the planning layer so the planner can
 * be tested without depending on the readiness module's verdict
 * shape.
 */
const INDIVIDUAL_REQUIRED_FIELDS: TenancyBahagianAPartyRequiredFieldKey[] = [
  { internalKey: "nameAsPerInstrument", required: true, reason: "Party name as written on the instrument." },
  { internalKey: "citizenshipCategory", required: true, reason: "Bahagian A `warga` (3-way citizenship enum)." },
  { internalKey: "identityType", required: true, reason: "NRIC / passport selector." },
  { internalKey: "identityNumber", required: true, reason: "Identity document number." },
  { internalKey: "nricSubType", required: true, reason: "Bahagian A `EPD_NOKP_TYPE` — required when identityType=nric." },
  { internalKey: "gender", required: true, reason: "Bahagian A `USER_SEX`." },
  { internalKey: "addressLine1", required: true, reason: "Mailing address line 1." },
  { internalKey: "postcode", required: true, reason: "Postcode." },
  { internalKey: "city", required: true, reason: "City." },
  { internalKey: "state", required: true, reason: "State." },
  { internalKey: "country", required: true, reason: "Country." },
  { internalKey: "mobile", required: true, reason: "Mobile / contact number." },
];

/**
 * Internal field keys required for an `company_ssm` party. The
 * representative sub-block carries an additional set mirroring the
 * individual requirements.
 */
const COMPANY_SSM_REQUIRED_FIELDS: TenancyBahagianAPartyRequiredFieldKey[] = [
  { internalKey: "nameAsPerInstrument", required: true, reason: "Company name as written on the instrument." },
  // At least one of rocOld / rocNew is required (handled specially below).
  // We list both as conditional here so the missing-fields list
  // reports a single combined blocker when neither is set.
  { internalKey: "rocOldOrNew", required: true, reason: "Bahagian A `tb_roc` and/or `tb_roc_new` — at least one ROC value required." },
  { internalKey: "businessType", required: true, reason: "Bahagian A `jenis_perniagaan` (SSM business type)." },
  { internalKey: "companyLocality", required: true, reason: "Bahagian A `tb_syarikat` (local vs foreign company)." },
  { internalKey: "companyRepresentative.ownerName", required: true, reason: "Bahagian A `owner_name` — representative full name." },
  { internalKey: "companyRepresentative.citizenshipCategory", required: true, reason: "Representative `warga`." },
  { internalKey: "companyRepresentative.identityType", required: true, reason: "Representative identity type." },
  { internalKey: "companyRepresentative.identityNumber", required: true, reason: "Representative identity number." },
  { internalKey: "companyRepresentative.nricSubType", required: true, reason: "Representative `EPD_NOKP_TYPE` — required when identityType=nric." },
  { internalKey: "companyRepresentative.gender", required: true, reason: "Representative `USER_SEX`." },
  { internalKey: "addressLine1", required: true, reason: "Mailing address line 1." },
  { internalKey: "postcode", required: true, reason: "Postcode." },
  { internalKey: "city", required: true, reason: "City." },
  { internalKey: "state", required: true, reason: "State." },
  { internalKey: "country", required: true, reason: "Country." },
  { internalKey: "mobile", required: true, reason: "Company mobile / contact number." },
];

// ─── Per-party evaluator ──────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Compute `(missingInternalFields, blockers)` for an individual
 * party.
 */
function evaluateIndividual(party: TenancyPortalParty): {
  required: TenancyBahagianAPartyRequiredFieldKey[];
  missing: string[];
  blockers: string[];
} {
  const required = INDIVIDUAL_REQUIRED_FIELDS;
  const missing: string[] = [];
  const blockers: string[] = [];
  if (!isNonEmptyString(party.nameAsPerInstrument)) missing.push("nameAsPerInstrument");
  if (!party.citizenshipCategory) missing.push("citizenshipCategory");
  if (!party.identityType) missing.push("identityType");
  if (!isNonEmptyString(party.identityNumber)) missing.push("identityNumber");
  if (party.identityType === "nric" && !party.nricSubType) {
    missing.push("nricSubType");
  }
  if (!party.gender) missing.push("gender");
  if (!isNonEmptyString(party.addressLine1)) missing.push("addressLine1");
  if (!isNonEmptyString(party.postcode)) missing.push("postcode");
  if (!isNonEmptyString(party.city)) missing.push("city");
  if (!isNonEmptyString(party.state)) missing.push("state");
  if (!isNonEmptyString(party.country)) missing.push("country");
  if (!isNonEmptyString(party.mobile)) missing.push("mobile");
  if (missing.length > 0) {
    blockers.push(
      `Missing required individual-party fields: ${missing.join(", ")}.`
    );
  }
  return { required, missing, blockers };
}

/**
 * Compute `(missingInternalFields, blockers)` for an SSM company
 * party. ROC requirement is a combined "at least one of old/new".
 */
function evaluateCompanySsm(party: TenancyPortalParty): {
  required: TenancyBahagianAPartyRequiredFieldKey[];
  missing: string[];
  blockers: string[];
} {
  const required = COMPANY_SSM_REQUIRED_FIELDS;
  const missing: string[] = [];
  const blockers: string[] = [];
  if (!isNonEmptyString(party.nameAsPerInstrument)) missing.push("nameAsPerInstrument");
  // ROC: at least one of rocOld / rocNew.
  const hasRoc =
    isNonEmptyString(party.rocOld) || isNonEmptyString(party.rocNew);
  if (!hasRoc) missing.push("rocOldOrNew");
  if (!party.businessType || !isNonEmptyString(party.businessType.code)) {
    missing.push("businessType");
  }
  if (!party.companyLocality) missing.push("companyLocality");
  // Representative sub-block.
  const rep = party.companyRepresentative;
  if (!rep || !isNonEmptyString(rep.ownerName))
    missing.push("companyRepresentative.ownerName");
  if (!rep || !rep.citizenshipCategory)
    missing.push("companyRepresentative.citizenshipCategory");
  if (!rep || !rep.identityType)
    missing.push("companyRepresentative.identityType");
  if (!rep || !isNonEmptyString(rep.identityNumber))
    missing.push("companyRepresentative.identityNumber");
  if (rep && rep.identityType === "nric" && !rep.nricSubType) {
    missing.push("companyRepresentative.nricSubType");
  }
  if (!rep || !rep.gender) missing.push("companyRepresentative.gender");
  // Address / contact (same shape as individual).
  if (!isNonEmptyString(party.addressLine1)) missing.push("addressLine1");
  if (!isNonEmptyString(party.postcode)) missing.push("postcode");
  if (!isNonEmptyString(party.city)) missing.push("city");
  if (!isNonEmptyString(party.state)) missing.push("state");
  if (!isNonEmptyString(party.country)) missing.push("country");
  if (!isNonEmptyString(party.mobile)) missing.push("mobile");
  if (missing.length > 0) {
    blockers.push(
      `Missing required SSM-company fields: ${missing.join(", ")}.`
    );
  }
  return { required, missing, blockers };
}

function evaluateParty(
  party: TenancyPortalParty,
  ordinal: number
): TenancyBahagianAPlannedPartyEntry {
  const expectedRowCountAfter = ordinal;
  if (party.type === "individual") {
    const { required, missing, blockers } = evaluateIndividual(party);
    const planStatus: TenancyBahagianAPartyPlanStatus =
      missing.length > 0 ? "blocked_missing_party_data" : "ready_for_modal_mapping";
    return {
      ordinal,
      role: party.role,
      type: party.type,
      partyName: party.nameAsPerInstrument || undefined,
      identityNumberPresent: isNonEmptyString(party.identityNumber),
      requiredInternalFields: required,
      missingInternalFields: missing,
      blockers,
      expectedRowCountAfter,
      planStatus,
    };
  }
  if (party.type === "company_ssm") {
    const { required, missing, blockers } = evaluateCompanySsm(party);
    const planStatus: TenancyBahagianAPartyPlanStatus =
      missing.length > 0 ? "blocked_missing_party_data" : "ready_for_modal_mapping";
    return {
      ordinal,
      role: party.role,
      type: party.type,
      partyName: party.nameAsPerInstrument || undefined,
      identityNumberPresent: false, // company has no individual identityNumber
      requiredInternalFields: required,
      missingInternalFields: missing,
      blockers,
      expectedRowCountAfter,
      planStatus,
    };
  }
  // company_non_ssm — modelled in the type system but the field
  // requirements are not yet evidenced. Mark unsupported until a
  // future milestone captures the required portal fields.
  return {
    ordinal,
    role: party.role,
    type: party.type,
    partyName: party.nameAsPerInstrument || undefined,
    identityNumberPresent: false,
    requiredInternalFields: [],
    missingInternalFields: [],
    blockers: [
      "company_non_ssm party type is not yet supported by the Bahagian A planner. The portal fields for non-SSM entities have not been observed.",
    ],
    expectedRowCountAfter,
    planStatus: "unsupported_party_type",
  };
}

// ─── Public entry point ────────────────────────────────────────────

/**
 * Build the Bahagian A party-entry plan for a job. Pure;
 * deterministic; never throws.
 *
 * Returns a plan with `overallStatus="blocked_missing_party_data"`
 * for any job that:
 *   - has no `tenancyPortalDetails`
 *   - has zero parties
 *   - has any party with missing required identity fields
 *
 * Returns `overallStatus="unsupported_party_type"` if any party is
 * `company_non_ssm` (until that path is observed and modelled).
 */
export function buildTenancyBahagianAPartyPlan(
  job: TenancyBahagianAPartyPlanJobInput
): TenancyBahagianAPartyPlan {
  // `id` may be missing on synthetic live-edit inputs; default to
  // an empty string so the plan still renders during editing.
  const jobId = typeof job.id === "string" ? job.id : "";
  const details = job.tenancyPortalDetails;
  const parties = details?.parties ?? [];
  const evaluatedParties = parties.map((p, i) => evaluateParty(p, i + 1));
  const landlordCount = evaluatedParties.filter((p) => p.role === "landlord").length;
  const tenantCount = evaluatedParties.filter((p) => p.role === "tenant").length;

  const blockers: string[] = [];
  if (parties.length === 0) {
    blockers.push("No parties captured. Bahagian A requires at least one party.");
  }
  for (const ep of evaluatedParties) {
    for (const b of ep.blockers) {
      blockers.push(`Party #${ep.ordinal} (${ep.role}, ${ep.type}): ${b}`);
    }
  }

  // Aggregate the most-blocking per-party verdict.
  let overallStatus: TenancyBahagianAPartyPlanStatus = "ready_for_modal_mapping";
  if (parties.length === 0) {
    overallStatus = "blocked_missing_party_data";
  } else if (
    evaluatedParties.some((p) => p.planStatus === "unsupported_party_type")
  ) {
    overallStatus = "unsupported_party_type";
  } else if (
    evaluatedParties.some((p) => p.planStatus === "blocked_missing_party_data")
  ) {
    overallStatus = "blocked_missing_party_data";
  } else if (
    evaluatedParties.some((p) => p.planStatus === "mapping_unknown")
  ) {
    overallStatus = "mapping_unknown";
  }

  return {
    jobId,
    lane: "sewa_pajakan",
    phase: "phase_3_bahagian_a_parties",
    expectedPartyCount: parties.length,
    landlordCount,
    tenantCount,
    parties: evaluatedParties,
    overallStatus,
    blockers,
  };
}

/**
 * Compact summary string for the operator UI plan card. One line
 * per party plus an overall verdict line. Never includes raw IC
 * numbers, party addresses, or any per-field value — only the
 * planned ordinal, role, type, blocker count, and verdict enum.
 */
export function summarizeTenancyBahagianAPartyPlan(
  plan: TenancyBahagianAPartyPlan
): string[] {
  const lines: string[] = [];
  lines.push(
    `Job ${plan.jobId} · ${plan.expectedPartyCount} parties (${plan.landlordCount}L · ${plan.tenantCount}T) · overall=${plan.overallStatus}`
  );
  for (const p of plan.parties) {
    const missing =
      p.missingInternalFields.length > 0
        ? ` missing=${p.missingInternalFields.length}`
        : "";
    lines.push(
      `  #${p.ordinal} ${p.role}/${p.type} · row-after=${p.expectedRowCountAfter} · ${p.planStatus}${missing}`
    );
  }
  return lines;
}
