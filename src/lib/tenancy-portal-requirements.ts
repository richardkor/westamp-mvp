/**
 * WeStamp — Tenancy Portal Requirements (Sewa/Pajakan)
 *
 * Pure derivation helper. Evaluates a tenancy job's
 * `tenancyPortalDetails` (plus a few related job fields like
 * `storagePath`) against the e-Duti Setem Sewa/Pajakan submission
 * requirements observed to date, and returns a structured readiness
 * report.
 *
 * What this module IS
 * ───────────────────
 * - A pure, side-effect-free evaluator. Safe to call from server
 *   components, API routes, and the operator panel.
 * - Returns a `TenancyPortalReadinessReport` listing every required
 *   field with a `state` (ready / missing / conditional_missing /
 *   operator_fallback), its target portal section (Bahagian A/B/C/
 *   Rumusan/Lampiran/Perakuan), and a short portal-meaning hint.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT drive the portal.
 * - It does NOT mutate the job.
 * - It does NOT make duty calculations.
 * - It does NOT make claims about whether the portal will accept the
 *   data — only whether WeStamp has captured the structurally-
 *   required fields.
 *
 * Scope guardrails — fields intentionally NOT required
 * ────────────────────────────────────────────────────
 * - Landlord / tenant email
 * - Whether the instrument was signed in Malaysia or outside Malaysia
 * - Received-in-Malaysia date
 *
 * These will only be added if a future live portal gate proves they
 * block submission.
 */

import type {
  StampingJob,
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalInstrumentName,
  TenancyPortalInstrumentNameCode,
  TenancyPortalInstrumentRelationship,
  TenancyPortalLandAreaUnit,
  TenancyPortalLandRegistry,
  TenancyPortalMaklumatAm,
  TenancyPortalParty,
  TenancyPortalPropertyType,
} from "./stamping-types";
import {
  TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_PORTAL_CODES,
  TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES,
} from "./stamping-types";

/**
 * Allowed enum values for `pds_ps` (instrument relationship). Re-
 * exported as a Set so the validator and the readiness evaluator
 * agree on the same value space without duplicating the keys.
 */
export const ALLOWED_INSTRUMENT_RELATIONSHIPS: ReadonlySet<TenancyPortalInstrumentRelationship> =
  new Set(
    Object.keys(
      TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_PORTAL_CODES
    ) as TenancyPortalInstrumentRelationship[]
  );

/**
 * `pds_jenis` values for which `pds_balasan` (consideration) is
 * required at the Hantar gate.
 *
 * Evidence audit (Milestone A2 review patch, 2026-04-29):
 *   - The 2026-04-22 live gate-chain walk (recorded in
 *     `stsds-submission-readiness.ts`) enumerated 14 `:invalid`
 *     fields at Hantar gate 2: pds_jenis, pds_poskod, pds_city,
 *     pds_harta_state, pds_harta_type, pds_floor, pds_mp,
 *     pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim,
 *     pds_daerah, pds_luas, par_id. **pds_balasan was NOT among
 *     them.** That is direct portal evidence the field was not
 *     blocking submission on the fixed-rent path tested.
 *   - `sewa-pajakan-gate-chain.ts` and `stsds-lane-knowledge.ts`
 *     contain no mention of pds_balasan as a Hantar gate field.
 *   - The 2026-04-28 ε-3 field-mapping report records pds_balasan
 *     as a single text input on Bahagian B but makes no claim that
 *     the portal requires it for any pds_jenis path.
 *
 * Conclusion: fixed_rent_during_tenancy must NOT be treated as
 * requiring pds_balasan. It is captured-but-optional there.
 *
 * `premium_only` is retained on the structural argument that under
 * this pds_jenis the rent-schedule shape is not used and the only
 * Maklumat Am field that can carry the premium amount is
 * pds_balasan. This is structural, not observed — a future reviewer
 * may lift this entry if even the structural argument is judged too
 * strong without a direct live-walk confirmation.
 *
 * Exported so the readiness gate and payload compiler use the same
 * set without duplicating the rule.
 */
export const PDS_JENIS_REQUIRING_BALASAN: ReadonlySet<TenancyPortalDescriptionType> =
  new Set<TenancyPortalDescriptionType>([
    "premium_only",
  ]);

/**
 * Allowed values for the Bahagian C land-area unit (`pds_luasunit`).
 * Re-exported as a Set so the validator and the readiness evaluator
 * agree on the same value space without duplicating the keys.
 */
export const ALLOWED_LAND_AREA_UNITS: ReadonlySet<TenancyPortalLandAreaUnit> =
  new Set(
    Object.keys(TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES) as TenancyPortalLandAreaUnit[]
  );

/**
 * Pds_suratcara option table — the authoritative list of accepted
 * "Nama Surat Cara" code/label pairs. Sourced from repo evidence
 * (`src/lib/stsds-lane-knowledge.ts` records `pds_suratcara=1101
 * (Perjanjian Sewa) accepted` from the Apr 2026 live walk). New
 * codes are added here only when supported by additional evidence.
 *
 * Exported so the operator panel renders the same option set the
 * validator accepts.
 */
export const INSTRUMENT_NAME_OPTIONS: ReadonlyArray<{
  code: TenancyPortalInstrumentNameCode;
  label: string;
}> = [
  { code: "1101", label: "Perjanjian Sewa" },
];

const INSTRUMENT_NAME_CODE_SET: ReadonlySet<TenancyPortalInstrumentNameCode> =
  new Set(INSTRUMENT_NAME_OPTIONS.map((o) => o.code));

const INSTRUMENT_NAME_LABEL_BY_CODE: Record<
  TenancyPortalInstrumentNameCode,
  string
> = INSTRUMENT_NAME_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.code]: o.label }),
  {} as Record<TenancyPortalInstrumentNameCode, string>
);

/** Look up the canonical label for a given code. Returns null if unknown. */
export function getInstrumentNameLabelForCode(
  code: TenancyPortalInstrumentNameCode | string | null | undefined
): string | null {
  if (!code) return null;
  return (
    INSTRUMENT_NAME_LABEL_BY_CODE[code as TenancyPortalInstrumentNameCode] ??
    null
  );
}

/**
 * Description-type values for which the standard `rentSchedule` shape
 * (start/end/monthlyRent rows) is meaningful. The other observed
 * portal options need different data (premium, crop share, amendment
 * reference) that this milestone does NOT model — the readiness
 * evaluator marks them as unsupported by current automation.
 *
 * Exported so the payload compiler (`tenancy-portal-payload.ts`) can
 * use the same set without redefining it.
 */
export const DESCRIPTION_TYPES_WITH_RENT_SCHEDULE: ReadonlySet<TenancyPortalDescriptionType> =
  new Set(["fixed_rent_during_tenancy", "variable_rent_during_tenancy"]);

/** Allowed values for the portal description type. Exported for reuse. */
export const ALLOWED_DESCRIPTION_TYPES: ReadonlySet<TenancyPortalDescriptionType> =
  new Set([
    "fixed_rent_during_tenancy",
    "variable_rent_during_tenancy",
    "amendment_to_original_tenancy",
    "other_item_49f",
    "premium_only",
    "crop_share_only",
  ]);

/**
 * Public-friendly labels (Bahasa Malaysia portal text). Exported so
 * the payload compiler can render the same labels without
 * redefinition.
 */
export const DESCRIPTION_TYPE_LABELS: Record<TenancyPortalDescriptionType, string> = {
  fixed_rent_during_tenancy:
    "Perjanjian Sewa/Pajakan · Bayaran Sewa Tetap Dalam Tempoh Penyewaan",
  variable_rent_during_tenancy:
    "Perjanjian Sewa/Pajakan · Bayaran Sewa Berbeza Dalam Tempoh Penyewaan",
  amendment_to_original_tenancy:
    "Perjanjian Sewa/Pajakan · Terdapat Pindaan Ke Atas Perjanjian Sewa/Pajakan Yang Asal",
  other_item_49f: "Lain-lain (BUTIRAN 49(f), Jadual Pertama Akta Setem 1949)",
  premium_only: "Premium atau balasan sahaja",
  crop_share_only: "Nisbah hasil tanaman sahaja",
};

// ─── Output types ───────────────────────────────────────────────────

export type TenancyPortalReadinessState =
  | "ready"
  | "missing"
  | "conditional_missing"
  | "operator_fallback";

export type TenancyPortalSection =
  | "bahagian_a"
  | "bahagian_b"
  | "bahagian_c"
  | "rumusan"
  | "lampiran"
  | "perakuan";

/**
 * One row of the portal-execution payload / gap preview.
 * Stable shape suitable for both the server-side helper and the
 * operator panel rendering.
 */
export interface TenancyPortalFieldReadiness {
  /** Stable internal key for grouping/keying. */
  fieldKey: string;
  /** Operator-facing label. */
  label: string;
  /** Which portal section this field lives in. */
  section: TenancyPortalSection;
  /** Current state. */
  state: TenancyPortalReadinessState;
  /**
   * Current WeStamp value rendered as a short string for display.
   * Null when WeStamp has nothing to show. Sensitive identifier
   * numbers (NRIC / passport) are NOT redacted here — the caller is
   * expected to be the operator panel only.
   */
  currentValue: string | null;
  /** Short portal-side meaning, e.g. "Tarikh Surat Cara". Optional. */
  portalMeaning?: string;
  /** Free-text note explaining the state, e.g. "company registration number not entered". */
  notes?: string;
}

/**
 * Top-level readiness report. `overall` is `ready` only when there
 * are zero unresolved missing rows. `operator_fallback` rows do not
 * block readiness.
 */
export interface TenancyPortalReadinessReport {
  overall: "ready" | "blocked";
  /** Generated-at timestamp for display, not stored. */
  evaluatedAt: string;
  fields: TenancyPortalFieldReadiness[];
  /** Aggregate counts derived from `fields[].state`. */
  summary: {
    ready: number;
    missing: number;
    conditional_missing: number;
    operator_fallback: number;
  };
}

// ─── Field-level helpers ────────────────────────────────────────────

const NON_EMPTY = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const NON_NEG_INT = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v);

const POS_NUM = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

function partyDisplayLabel(p: TenancyPortalParty, idx: number): string {
  const role = p.role === "landlord" ? "Landlord" : "Tenant";
  const name = NON_EMPTY(p.nameAsPerInstrument)
    ? p.nameAsPerInstrument
    : `(unnamed ${role.toLowerCase()})`;
  return `${role} ${idx + 1}: ${name}`;
}

/**
 * Decide which identity field type a party requires based on its
 * `type` and `nationality`. Companies require company_registration;
 * individuals require nric for Malaysians or passport for non-
 * Malaysians.
 */
function expectedIdentityType(p: TenancyPortalParty):
  | "nric"
  | "passport"
  | "company_registration"
  | null {
  if (p.type === "company_ssm" || p.type === "company_non_ssm") {
    return "company_registration";
  }
  if (p.type === "individual") {
    if (p.nationality === "non_malaysian") return "passport";
    if (p.nationality === "malaysian") return "nric";
  }
  return null;
}

// ─── Main evaluator ─────────────────────────────────────────────────

/**
 * Evaluate the tenancy-portal readiness of a job. Inspects only the
 * fields needed for derivation; does NOT read any other side-effects.
 *
 * Notes on missing-vs-conditional handling:
 * - A field is `missing` when it is unconditionally required and not
 *   present.
 * - A field is `conditional_missing` when it is required in the
 *   current configuration (e.g. building type when property type is
 *   kediaman) but not in others. Treated as blocking when applicable.
 * - A field is `operator_fallback` when present but explicitly marked
 *   as a fallback (currently only premises area = 0 with the
 *   `premisesAreaIsZeroFallback` flag set). Not blocking.
 */
export function evaluateTenancyPortalReadiness(
  job: Pick<
    StampingJob,
    "tenancyPortalDetails" | "storagePath" | "documentCategory"
  >
): TenancyPortalReadinessReport {
  const fields: TenancyPortalFieldReadiness[] = [];
  const tpd: TenancyPortalDetails | undefined = job.tenancyPortalDetails;

  // ── Bahagian A — Parties ──────────────────────────────────────
  const parties = tpd?.parties ?? [];
  const landlords = parties.filter((p) => p.role === "landlord");
  const tenants = parties.filter((p) => p.role === "tenant");

  fields.push({
    fieldKey: "parties.atLeastOneLandlord",
    label: "At least one landlord",
    section: "bahagian_a",
    state: landlords.length > 0 ? "ready" : "missing",
    currentValue: landlords.length > 0 ? `${landlords.length} captured` : null,
    portalMeaning: "Bahagian A · Pemberi Sewa",
  });
  fields.push({
    fieldKey: "parties.atLeastOneTenant",
    label: "At least one tenant",
    section: "bahagian_a",
    state: tenants.length > 0 ? "ready" : "missing",
    currentValue: tenants.length > 0 ? `${tenants.length} captured` : null,
    portalMeaning: "Bahagian A · Penyewa",
  });

  parties.forEach((p, idx) => {
    const partyLabel = partyDisplayLabel(p, idx);
    const expectedId = expectedIdentityType(p);

    fields.push({
      fieldKey: `parties[${idx}].nameAsPerInstrument`,
      label: `${partyLabel} — Name`,
      section: "bahagian_a",
      state: NON_EMPTY(p.nameAsPerInstrument) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.nameAsPerInstrument)
        ? p.nameAsPerInstrument
        : null,
      portalMeaning: "Nama mengikut surat cara",
    });

    if (p.type === "individual") {
      fields.push({
        fieldKey: `parties[${idx}].nationality`,
        label: `${partyLabel} — Nationality`,
        section: "bahagian_a",
        state:
          p.nationality === "malaysian" || p.nationality === "non_malaysian"
            ? "ready"
            : "missing",
        currentValue: p.nationality ?? null,
        portalMeaning: "Status warganegara (individu)",
      });
    }

    if (expectedId) {
      const idLabel =
        expectedId === "nric"
          ? "NRIC"
          : expectedId === "passport"
            ? "Passport"
            : "Company registration number";
      const correctType = p.identityType === expectedId;
      const haveValue = NON_EMPTY(p.identityNumber);
      fields.push({
        fieldKey: `parties[${idx}].identity`,
        label: `${partyLabel} — ${idLabel}`,
        section: "bahagian_a",
        state: correctType && haveValue ? "ready" : "conditional_missing",
        currentValue: haveValue ? (p.identityNumber as string) : null,
        portalMeaning: idLabel,
        notes:
          !correctType
            ? `Expected identity type "${expectedId}" for this party type.`
            : !haveValue
              ? "Value not entered."
              : undefined,
      });
    }

    // TIN — optional (auto-generated by MyTax). Only flagged when
    // operator has indicated TIN auto-generation is NOT expected and
    // no value is present. Otherwise informational.
    const tinPresent = NON_EMPTY(p.tin);
    fields.push({
      fieldKey: `parties[${idx}].tin`,
      label: `${partyLabel} — TIN`,
      section: "bahagian_a",
      state: tinPresent
        ? "ready"
        : p.tinAutoGenerationExpected
          ? "ready"
          : "conditional_missing",
      currentValue: tinPresent ? (p.tin as string) : null,
      portalMeaning: "Tax Identification Number",
      notes: !tinPresent
        ? p.tinAutoGenerationExpected
          ? "Operator expects TIN to be auto-generated by MyTax after identity entry."
          : "TIN not entered. Mark as auto-generated if MyTax will issue it on the portal."
        : undefined,
    });

    // Address (line1 / postcode / city / state / country)
    fields.push({
      fieldKey: `parties[${idx}].addressLine1`,
      label: `${partyLabel} — Address line 1`,
      section: "bahagian_a",
      state: NON_EMPTY(p.addressLine1) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.addressLine1) ? p.addressLine1 : null,
      portalMeaning: "Alamat",
    });
    fields.push({
      fieldKey: `parties[${idx}].postcode`,
      label: `${partyLabel} — Postcode`,
      section: "bahagian_a",
      state: NON_EMPTY(p.postcode) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.postcode) ? p.postcode : null,
    });
    fields.push({
      fieldKey: `parties[${idx}].city`,
      label: `${partyLabel} — City`,
      section: "bahagian_a",
      state: NON_EMPTY(p.city) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.city) ? p.city : null,
    });
    fields.push({
      fieldKey: `parties[${idx}].state`,
      label: `${partyLabel} — State`,
      section: "bahagian_a",
      state: NON_EMPTY(p.state) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.state) ? p.state : null,
    });
    fields.push({
      fieldKey: `parties[${idx}].country`,
      label: `${partyLabel} — Country`,
      section: "bahagian_a",
      state: NON_EMPTY(p.country) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.country) ? p.country : null,
    });
    fields.push({
      fieldKey: `parties[${idx}].mobile`,
      label: `${partyLabel} — Mobile`,
      section: "bahagian_a",
      state: NON_EMPTY(p.mobile) ? "ready" : "missing",
      currentValue: NON_EMPTY(p.mobile) ? p.mobile : null,
      portalMeaning: "No. Telefon Bimbit",
    });
  });

  // ── Bahagian B — Instrument and rent ──────────────────────────
  const instrument = tpd?.instrument;
  fields.push({
    fieldKey: "instrument.instrumentDate",
    label: "Instrument date",
    section: "bahagian_b",
    state: NON_EMPTY(instrument?.instrumentDate) ? "ready" : "missing",
    currentValue: instrument?.instrumentDate ?? null,
    portalMeaning: "Tarikh Surat Cara",
  });
  fields.push({
    fieldKey: "instrument.duplicateCopies",
    label: "Duplicate copies",
    section: "bahagian_b",
    state: NON_NEG_INT(instrument?.duplicateCopies) ? "ready" : "missing",
    currentValue:
      typeof instrument?.duplicateCopies === "number"
        ? String(instrument.duplicateCopies)
        : null,
    portalMeaning: "Salinan Pendua",
  });
  // Bahagian B · Section 1 — Nama Surat Cara (`pds_suratcara`).
  // Required. Distinct from pds_jenis below — both are required at
  // Hantar gate 1 and the portal does NOT cascade-populate one from
  // the other (see `src/lib/sewa-pajakan-gate-chain.ts` line 192).
  // The accepted code/label pair must be in INSTRUMENT_NAME_OPTIONS.
  const instrumentNameSelection = instrument?.portalInstrumentName;
  const instrumentNameCodeKnown =
    instrumentNameSelection !== undefined &&
    INSTRUMENT_NAME_CODE_SET.has(
      instrumentNameSelection.code as TenancyPortalInstrumentNameCode
    );
  fields.push({
    fieldKey: "instrument.portalInstrumentName",
    label: "Instrument name (Bahagian B · pds_suratcara)",
    section: "bahagian_b",
    state: instrumentNameCodeKnown ? "ready" : "missing",
    currentValue: instrumentNameCodeKnown
      ? `${instrumentNameSelection.code} · ${instrumentNameSelection.label}`
      : null,
    portalMeaning: "Nama Surat Cara",
    notes: instrumentNameCodeKnown
      ? "Distinct field from pds_jenis below. Both are required at Hantar gate 1."
      : 'Required. Pick one of the documented Nama Surat Cara options (today: "Perjanjian Sewa" / 1101).',
  });

  // Bahagian B · Section 3 — Diskripsi Surat Cara (`pds_jenis`).
  // Required. The selected value also drives whether the rent-schedule
  // shape can be evaluated at all: only the two rent-based types
  // (fixed / variable) line up with the schedule shape this model
  // supports. The other four observed options need different data
  // that we deliberately do not model in this milestone.
  const descType = instrument?.portalDescriptionType;
  const descTypeIsKnown =
    descType !== undefined && ALLOWED_DESCRIPTION_TYPES.has(descType);
  const descTypeSupportsRentSchedule =
    descTypeIsKnown && DESCRIPTION_TYPES_WITH_RENT_SCHEDULE.has(descType);
  fields.push({
    fieldKey: "instrument.portalDescriptionType",
    label: "Instrument description (Bahagian B · pds_jenis)",
    section: "bahagian_b",
    state: descTypeIsKnown ? "ready" : "missing",
    currentValue: descTypeIsKnown ? DESCRIPTION_TYPE_LABELS[descType] : null,
    portalMeaning: "Diskripsi Surat Cara",
    notes: descTypeIsKnown
      ? descTypeSupportsRentSchedule
        ? undefined
        : "This portal option needs different data (premium / crop share / amendment reference) that the current model does not capture. Job is not supported by automation — handle outside the assisted path."
      : "Required. Select one of the six observed Sewa/Pajakan portal options.",
  });

  // Rent schedule. Validity rule depends on the description type:
  //   - fixed_rent_during_tenancy        → length >= 1
  //   - variable_rent_during_tenancy     → length >= 2
  //   - any of the other four            → schedule shape is not the
  //                                        right fit; the schedule row
  //                                        is reported as a non-blocker
  //                                        but the description-type
  //                                        row above already blocks
  //                                        readiness via "missing"
  //                                        state propagation through
  //                                        the unsupported notes.
  const sched = instrument?.rentSchedule ?? [];
  const eachRowComplete = (r: { startDate: string; endDate: string; monthlyRent: number }) =>
    NON_EMPTY(r.startDate) && NON_EMPTY(r.endDate) && POS_NUM(r.monthlyRent);
  const schedRowsValid = sched.length > 0 && sched.every(eachRowComplete);
  let scheduleState: TenancyPortalReadinessState;
  let scheduleNote: string | undefined;
  if (descType === "fixed_rent_during_tenancy") {
    scheduleState = schedRowsValid ? "ready" : "missing";
    if (!schedRowsValid) {
      scheduleNote =
        "Fixed rent expects one schedule row with start, end, and monthly rent > 0.";
    }
  } else if (descType === "variable_rent_during_tenancy") {
    if (!schedRowsValid) {
      scheduleState = "missing";
      scheduleNote =
        "Each period needs start, end, and monthly rent > 0.";
    } else if (sched.length < 2) {
      scheduleState = "missing";
      scheduleNote = "Variable rent expects at least two periods.";
    } else {
      scheduleState = "ready";
    }
  } else if (descTypeIsKnown) {
    // amendment / other_49f / premium_only / crop_share_only — the
    // schedule shape doesn't apply. Flag conditionally so the row
    // is informational rather than a blocker (the description-type
    // row carries the actual blocking state).
    scheduleState = "conditional_missing";
    scheduleNote =
      "Schedule shape not applicable for this description type — see Bahagian B description note above.";
  } else {
    // Description type not yet selected — treat schedule as missing
    // until the operator picks one.
    scheduleState = "missing";
    scheduleNote = "Pick the instrument description first.";
  }
  fields.push({
    fieldKey: "instrument.rentSchedule",
    label:
      descType === "variable_rent_during_tenancy"
        ? "Rent schedule (multiple periods)"
        : "Rent schedule",
    section: "bahagian_b",
    state: scheduleState,
    currentValue:
      sched.length > 0
        ? sched
            .map((r) => `${r.startDate}→${r.endDate} @ RM${r.monthlyRent}/mo`)
            .join(" · ")
        : null,
    portalMeaning: "Jadual Sewa",
    notes: scheduleNote,
  });

  // ── Bahagian C — Property ─────────────────────────────────────
  const property = tpd?.property;
  fields.push({
    fieldKey: "property.addressLine1",
    label: "Property address line 1",
    section: "bahagian_c",
    state: NON_EMPTY(property?.addressLine1) ? "ready" : "missing",
    currentValue: property?.addressLine1 ?? null,
    portalMeaning: "Alamat Harta",
  });
  fields.push({
    fieldKey: "property.postcode",
    label: "Property postcode",
    section: "bahagian_c",
    state: NON_EMPTY(property?.postcode) ? "ready" : "missing",
    currentValue: property?.postcode ?? null,
  });
  fields.push({
    fieldKey: "property.city",
    label: "Property city",
    section: "bahagian_c",
    state: NON_EMPTY(property?.city) ? "ready" : "missing",
    currentValue: property?.city ?? null,
  });
  fields.push({
    fieldKey: "property.state",
    label: "Property state",
    section: "bahagian_c",
    state: NON_EMPTY(property?.state) ? "ready" : "missing",
    currentValue: property?.state ?? null,
  });
  fields.push({
    fieldKey: "property.country",
    label: "Property country",
    section: "bahagian_c",
    state: NON_EMPTY(property?.country) ? "ready" : "missing",
    currentValue: property?.country ?? null,
  });
  fields.push({
    fieldKey: "property.propertyType",
    label: "Property type (Jenis Harta)",
    section: "bahagian_c",
    state: NON_EMPTY(property?.propertyType) ? "ready" : "missing",
    currentValue: property?.propertyType ?? null,
    portalMeaning: "Jenis Harta (Kediaman / Perdagangan / Perindustrian / Tanah Kosong)",
  });
  // Building type — required when propertyType === "kediaman".
  if (property?.propertyType === "kediaman") {
    fields.push({
      fieldKey: "property.buildingType",
      label: "Building type (Jenis Bangunan)",
      section: "bahagian_c",
      state: NON_EMPTY(property?.buildingType)
        ? "ready"
        : "conditional_missing",
      currentValue: property?.buildingType ?? null,
      portalMeaning: "Required when Jenis Harta = Kediaman.",
    });
  }
  // Premises area — operator fallback path supported.
  const areaIsZero =
    typeof property?.premisesAreaSqm === "number" &&
    property.premisesAreaSqm === 0;
  const areaIsPositive = POS_NUM(property?.premisesAreaSqm);
  const areaState: TenancyPortalReadinessState = areaIsPositive
    ? "ready"
    : areaIsZero && property?.premisesAreaIsZeroFallback === true
      ? "operator_fallback"
      : "missing";
  fields.push({
    fieldKey: "property.premisesAreaSqm",
    label: "Premises area (sqm)",
    section: "bahagian_c",
    state: areaState,
    currentValue:
      typeof property?.premisesAreaSqm === "number"
        ? String(property.premisesAreaSqm)
        : null,
    portalMeaning: "Luas Premis (m²)",
    notes:
      areaState === "operator_fallback"
        ? "Operator confirmed: 0 entered as fallback because no value is available on the instrument."
        : areaState === "missing"
          ? "Required, or enter 0 with explicit fallback flag."
          : undefined,
  });

  // ── Bahagian C · Land-registry sub-block ─────────────────────
  // Added in Milestone A1 (2026-04-29) after the ε-3 field-mapping
  // run proved these portal fields are required at Hantar gate. We
  // only mark the per-field rows as `missing` when the operator has
  // started capturing a property block — a brand-new empty job is
  // already blocked at the property-type / address rows above, so
  // doubling up the readiness rows for an empty property would only
  // add noise.
  const landRegistry = property?.landRegistry;
  const lrPresent = property !== undefined;
  const lrField = (
    fieldKey: string,
    label: string,
    state: TenancyPortalReadinessState,
    currentValue: string | null,
    portalMeaning: string,
    notes?: string
  ): void => {
    fields.push({
      fieldKey,
      label,
      section: "bahagian_c",
      state,
      currentValue,
      portalMeaning,
      notes,
    });
  };
  if (lrPresent) {
    // pds_mp / Milik Penuh
    lrField(
      "property.landRegistry.milikPenuh",
      "Milik Penuh (Bahagian C · pds_mp)",
      NON_EMPTY(landRegistry?.milikPenuh) ? "ready" : "missing",
      NON_EMPTY(landRegistry?.milikPenuh) ? landRegistry?.milikPenuh ?? null : null,
      "pds_mp · Milik Penuh"
    );
    // pds_lot
    lrField(
      "property.landRegistry.lot",
      "Lot number (Bahagian C · pds_lot)",
      NON_EMPTY(landRegistry?.lot) ? "ready" : "missing",
      NON_EMPTY(landRegistry?.lot) ? landRegistry?.lot ?? null : null,
      "pds_lot · No. Lot"
    );
    // pds_mukim
    lrField(
      "property.landRegistry.mukim",
      "Mukim (Bahagian C · pds_mukim)",
      NON_EMPTY(landRegistry?.mukim) ? "ready" : "missing",
      NON_EMPTY(landRegistry?.mukim) ? landRegistry?.mukim ?? null : null,
      "pds_mukim · Mukim"
    );
    // pds_daerah
    lrField(
      "property.landRegistry.daerah",
      "Daerah (Bahagian C · pds_daerah)",
      NON_EMPTY(landRegistry?.daerah) ? "ready" : "missing",
      NON_EMPTY(landRegistry?.daerah) ? landRegistry?.daerah ?? null : null,
      "pds_daerah · Daerah"
    );
    // pds_luas — must be a positive finite number; distinct from
    // premisesAreaSqm above.
    const luasValid =
      typeof landRegistry?.luas === "number" &&
      Number.isFinite(landRegistry.luas) &&
      landRegistry.luas > 0;
    lrField(
      "property.landRegistry.luas",
      "Land area (Bahagian C · pds_luas)",
      luasValid ? "ready" : "missing",
      typeof landRegistry?.luas === "number" ? String(landRegistry.luas) : null,
      "pds_luas · Luas Tanah",
      luasValid
        ? "Distinct from Premises area (Luas Premis). Land-title value, not built-up area."
        : "Required. Positive numeric value of land area on the title. Distinct from premises area."
    );
    // pds_luasunit — must be one of the four observed portal codes
    const luasUnitValid =
      typeof landRegistry?.luasUnit === "string" &&
      ALLOWED_LAND_AREA_UNITS.has(landRegistry.luasUnit);
    lrField(
      "property.landRegistry.luasUnit",
      "Land-area unit (Bahagian C · pds_luasunit)",
      luasUnitValid ? "ready" : "missing",
      typeof landRegistry?.luasUnit === "string" ? landRegistry.luasUnit : null,
      "pds_luasunit · Unit Luas",
      luasUnitValid
        ? undefined
        : "Required. Pick one of: Ekar / Hektar / Kps / Mps."
    );
    // pds_kegunaan — optional. Surfaced as informational so the
    // operator can see whether they captured a value, but does NOT
    // contribute to overall readiness.
    fields.push({
      fieldKey: "property.landRegistry.kegunaan",
      label: "Property usage (Bahagian C · pds_kegunaan, optional)",
      section: "bahagian_c",
      state: "ready",
      currentValue: NON_EMPTY(landRegistry?.kegunaan)
        ? landRegistry?.kegunaan ?? null
        : null,
      portalMeaning: "pds_kegunaan · Kegunaan",
      notes: NON_EMPTY(landRegistry?.kegunaan)
        ? undefined
        : "Optional in this milestone. Capture if the title document specifies a usage.",
    });
  }

  // ── Maklumat Am — Sewa/Pajakan portal metadata ───────────────
  // Added in Milestone A2 (2026-04-29). Section enum stays as
  // `bahagian_b` for these rows because the existing convention
  // already groups Maklumat Am-tab fields (pds_suratcara, pds_jenis)
  // under `bahagian_b`. The data model itself stores them under a
  // distinct `tenancyPortalDetails.maklumatAm` sub-object.
  const maklumatAm = tpd?.maklumatAm;

  // pds_dutisetem — required by the portal. Captured-select shape:
  // we don't know the full 17-option list yet, so the readiness rule
  // only checks that the operator has supplied a non-empty code.
  const dutyStampCode = maklumatAm?.dutyStampType?.code;
  fields.push({
    fieldKey: "maklumatAm.dutyStampType",
    label: "Duty type · Jenis Duti Setem (Maklumat Am · pds_dutisetem)",
    section: "bahagian_b",
    state: NON_EMPTY(dutyStampCode) ? "ready" : "missing",
    currentValue: NON_EMPTY(dutyStampCode)
      ? maklumatAm?.dutyStampType?.label
        ? `${dutyStampCode} · ${maklumatAm.dutyStampType.label}`
        : dutyStampCode
      : null,
    portalMeaning: "pds_dutisetem · Jenis Duti Setem",
    notes: NON_EMPTY(dutyStampCode)
      ? undefined
      : "Required. Operator-captured portal code (17-option dropdown; full enum not yet catalogued in WeStamp).",
  });

  // pds_ps — required, narrow 2-value enum
  const instrRel = maklumatAm?.instrumentRelationship;
  const instrRelKnown =
    typeof instrRel === "string" &&
    ALLOWED_INSTRUMENT_RELATIONSHIPS.has(instrRel);
  fields.push({
    fieldKey: "maklumatAm.instrumentRelationship",
    label: "Instrument relationship (Maklumat Am · pds_ps)",
    section: "bahagian_b",
    state: instrRelKnown ? "ready" : "missing",
    currentValue: instrRelKnown ? instrRel : null,
    portalMeaning: "pds_ps · Hubungan Surat Cara",
    notes: instrRelKnown
      ? undefined
      : 'Required. Pick "principal" (p · Prinsipal) or "related_lease_49e" (s · Surat Cara berkaitan Pajakan 49(e)).',
  });

  // pds_balasan — conditional on pds_jenis. The conditional rule
  // mirrors the gap evaluator: required when pds_jenis is fixed-rent
  // OR premium-only; captured-but-optional otherwise. Malformed
  // values (non-positive) are flagged as `missing` so the row is
  // visibly broken in the preview.
  const balasan = maklumatAm?.balasan;
  const balasanSupplied = typeof balasan === "number";
  const balasanIsValid =
    balasanSupplied && Number.isFinite(balasan) && balasan > 0;
  const balasanRequiredHere =
    descTypeIsKnown && PDS_JENIS_REQUIRING_BALASAN.has(descType);
  let balasanState: TenancyPortalReadinessState;
  let balasanNote: string | undefined;
  if (balasanSupplied && !balasanIsValid) {
    // Operator supplied a value but it's malformed — surface as
    // missing so the operator sees the row broken and fixes it.
    balasanState = "missing";
    balasanNote =
      "Supplied value is not a positive number. pds_balasan must be > 0 when supplied.";
  } else if (balasanRequiredHere) {
    balasanState = balasanIsValid ? "ready" : "missing";
    if (!balasanIsValid) {
      balasanNote = `Required when pds_jenis = "${DESCRIPTION_TYPE_LABELS[descType as TenancyPortalDescriptionType]}". NEVER auto-derived from rent schedule.`;
    }
  } else {
    // pds_jenis path doesn't require balasan; informational row.
    balasanState = "ready";
    balasanNote = balasanIsValid
      ? "Captured. Optional for the current pds_jenis path."
      : "Optional for the current pds_jenis path. NEVER auto-derived from rent schedule.";
  }
  fields.push({
    fieldKey: "maklumatAm.balasan",
    label: "Consideration · Balasan (Maklumat Am · pds_balasan)",
    section: "bahagian_b",
    state: balasanState,
    currentValue: balasanSupplied ? String(balasan) : null,
    portalMeaning: "pds_balasan · Balasan / Premium",
    notes: balasanNote,
  });

  // pds_remit — optional. Always informational unless future
  // evidence proves otherwise.
  const remitCode = maklumatAm?.remission?.code;
  fields.push({
    fieldKey: "maklumatAm.remission",
    label: "Remission · Remit (Maklumat Am · pds_remit, optional)",
    section: "bahagian_b",
    state: "ready",
    currentValue: NON_EMPTY(remitCode)
      ? maklumatAm?.remission?.label
        ? `${remitCode} · ${maklumatAm.remission.label}`
        : remitCode
      : null,
    portalMeaning: "pds_remit · Pelepasan / Remission",
    notes: NON_EMPTY(remitCode)
      ? undefined
      : "Optional. 16-option dropdown; full enum not yet catalogued.",
  });

  // pds_perjanjian flags — optional. Always informational.
  const treaty = maklumatAm?.treatyExemption;
  const treatyChecked: string[] = [];
  if (treaty?.kmkt === true) treatyChecked.push("kmkt");
  if (treaty?.klnm === true) treatyChecked.push("klnm");
  if (treaty?.vienna === true) treatyChecked.push("vienna");
  fields.push({
    fieldKey: "maklumatAm.treatyExemption",
    label: "Treaty / diplomatic exemption (Maklumat Am · pds_perjanjian, optional)",
    section: "bahagian_b",
    state: "ready",
    currentValue: treatyChecked.length > 0 ? treatyChecked.join(", ") : null,
    portalMeaning: "pds_perjanjian · checkbox group (kmkt / klnm / vienna)",
    notes:
      treatyChecked.length > 0
        ? undefined
        : "Optional. Unchecked is the normal case.",
  });

  // pds_radio_ya / pds_radio_tidak — observed but purpose unconfirmed
  // by the field-mapping run. Intentionally NOT modelled in A2.
  // Future field-mapping evidence will determine whether these need
  // capture; until then, do not surface a fake row.

  // ── Lampiran — source PDF presence ────────────────────────────
  fields.push({
    fieldKey: "lampiran.sourcePdf",
    label: "Source PDF (uploaded instrument)",
    section: "lampiran",
    state: NON_EMPTY(job.storagePath) ? "ready" : "missing",
    currentValue: job.storagePath ?? null,
    portalMeaning: "File yang akan dimuatnaik di Lampiran",
  });

  // ── Rumusan / Perakuan — stub rows (informational) ────────────
  // No data-layer requirement for these in this milestone; included
  // so the gap preview clearly maps to all six portal sections and
  // operators see the chain end-to-end.
  fields.push({
    fieldKey: "rumusan.dutyComparison",
    label: "Portal-vs-WeStamp duty comparison",
    section: "rumusan",
    state: "ready",
    currentValue: "Pending portal value",
    portalMeaning:
      "Compared at supervised execution time. Mismatch must stop automation.",
  });
  fields.push({
    fieldKey: "perakuan.finalDeclaration",
    label: "Final declaration",
    section: "perakuan",
    state: "ready",
    currentValue: "Supervised gate at submission time",
    portalMeaning: "Final supervised submission gate. Not automated.",
  });

  // ── Aggregate ─────────────────────────────────────────────────
  const summary = {
    ready: 0,
    missing: 0,
    conditional_missing: 0,
    operator_fallback: 0,
  };
  for (const f of fields) summary[f.state]++;

  const overall: "ready" | "blocked" =
    summary.missing === 0 && summary.conditional_missing === 0
      ? "ready"
      : "blocked";

  return {
    overall,
    evaluatedAt: new Date().toISOString(),
    fields,
    summary,
  };
}

// ─── Validator (server-side input) ──────────────────────────────────

/**
 * Server-side shape validator for the operator save route. Returns a
 * normalised `TenancyPortalDetails` object on success, or a string
 * describing the first invalid field on failure. Does NOT make any
 * portal-readiness judgements — that's `evaluateTenancyPortalReadiness`.
 *
 * The validator is conservative: trims strings, rejects unknown types,
 * coerces numerics, and rejects obvious malformed shapes (e.g. parties
 * not an array). Empty optional fields are stripped.
 */
export function validateTenancyPortalDetailsInput(
  candidate: unknown
): { ok: true; value: TenancyPortalDetails } | { ok: false; error: string } {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.parties)) {
    return { ok: false, error: "`parties` must be an array." };
  }

  const parties: TenancyPortalParty[] = [];
  for (let i = 0; i < c.parties.length; i++) {
    const raw = c.parties[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `parties[${i}] must be an object.` };
    }
    const p = raw as Record<string, unknown>;
    const role = p.role;
    if (role !== "landlord" && role !== "tenant") {
      return { ok: false, error: `parties[${i}].role must be 'landlord' or 'tenant'.` };
    }
    const type = p.type;
    if (
      type !== "individual" &&
      type !== "company_ssm" &&
      type !== "company_non_ssm"
    ) {
      return {
        ok: false,
        error: `parties[${i}].type must be one of 'individual', 'company_ssm', 'company_non_ssm'.`,
      };
    }
    if (typeof p.nameAsPerInstrument !== "string") {
      return { ok: false, error: `parties[${i}].nameAsPerInstrument must be a string.` };
    }
    const party: TenancyPortalParty = {
      role,
      type,
      nameAsPerInstrument: (p.nameAsPerInstrument as string).trim(),
      addressLine1: typeof p.addressLine1 === "string" ? p.addressLine1.trim() : "",
      postcode: typeof p.postcode === "string" ? p.postcode.trim() : "",
      city: typeof p.city === "string" ? p.city.trim() : "",
      state: typeof p.state === "string" ? p.state.trim() : "",
      country: typeof p.country === "string" ? p.country.trim() : "",
      mobile: typeof p.mobile === "string" ? p.mobile.trim() : "",
    };
    if (p.nationality === "malaysian" || p.nationality === "non_malaysian") {
      party.nationality = p.nationality;
    } else if (p.nationality === null) {
      party.nationality = null;
    }
    if (
      p.identityType === "nric" ||
      p.identityType === "passport" ||
      p.identityType === "company_registration"
    ) {
      party.identityType = p.identityType;
    }
    if (typeof p.identityNumber === "string" && p.identityNumber.trim()) {
      party.identityNumber = p.identityNumber.trim();
    }
    if (typeof p.tin === "string" && p.tin.trim()) {
      party.tin = p.tin.trim();
    }
    if (p.tinAutoGenerationExpected === true) {
      party.tinAutoGenerationExpected = true;
    }
    if (typeof p.addressLine2 === "string" && p.addressLine2.trim()) {
      party.addressLine2 = p.addressLine2.trim();
    }
    if (typeof p.phone === "string" && p.phone.trim()) {
      party.phone = p.phone.trim();
    }
    if (typeof p.operatorNote === "string" && p.operatorNote.trim()) {
      party.operatorNote = p.operatorNote.trim();
    }
    parties.push(party);
  }

  const value: TenancyPortalDetails = {
    updatedAt: new Date().toISOString(),
    parties,
  };

  // Optional instrument block
  if (c.instrument && typeof c.instrument === "object") {
    const ri = c.instrument as Record<string, unknown>;
    if (
      typeof ri.instrumentDate !== "string" ||
      ri.instrumentDate.trim() === ""
    ) {
      return { ok: false, error: "instrument.instrumentDate must be a non-empty string." };
    }
    if (
      typeof ri.duplicateCopies !== "number" ||
      !Number.isInteger(ri.duplicateCopies) ||
      ri.duplicateCopies < 0
    ) {
      return { ok: false, error: "instrument.duplicateCopies must be a non-negative integer." };
    }
    if (
      typeof ri.portalDescriptionType !== "string" ||
      !ALLOWED_DESCRIPTION_TYPES.has(
        ri.portalDescriptionType as TenancyPortalDescriptionType
      )
    ) {
      return {
        ok: false,
        error:
          "instrument.portalDescriptionType must be one of: " +
          Array.from(ALLOWED_DESCRIPTION_TYPES).join(", ") +
          ".",
      };
    }
    if (!Array.isArray(ri.rentSchedule)) {
      return { ok: false, error: "instrument.rentSchedule must be an array." };
    }
    type ScheduleRow = {
      startDate: string;
      endDate: string;
      monthlyRent: number;
      durationMonths?: number;
    };
    const schedule: ScheduleRow[] = [];
    for (let idx = 0; idx < ri.rentSchedule.length; idx++) {
      const r = ri.rentSchedule[idx] as Record<string, unknown>;
      if (typeof r.startDate !== "string" || !r.startDate.trim()) {
        return {
          ok: false,
          error: `instrument.rentSchedule[${idx}].startDate must be a string.`,
        };
      }
      if (typeof r.endDate !== "string" || !r.endDate.trim()) {
        return {
          ok: false,
          error: `instrument.rentSchedule[${idx}].endDate must be a string.`,
        };
      }
      if (
        typeof r.monthlyRent !== "number" ||
        !Number.isFinite(r.monthlyRent) ||
        r.monthlyRent < 0
      ) {
        return {
          ok: false,
          error: `instrument.rentSchedule[${idx}].monthlyRent must be a non-negative number.`,
        };
      }
      const row: ScheduleRow = {
        startDate: (r.startDate as string).trim(),
        endDate: (r.endDate as string).trim(),
        monthlyRent: r.monthlyRent as number,
      };
      if (
        typeof r.durationMonths === "number" &&
        Number.isInteger(r.durationMonths) &&
        r.durationMonths > 0
      ) {
        row.durationMonths = r.durationMonths;
      }
      schedule.push(row);
    }
    value.instrument = {
      instrumentDate: ri.instrumentDate.trim(),
      duplicateCopies: ri.duplicateCopies as number,
      portalDescriptionType: ri.portalDescriptionType as TenancyPortalDescriptionType,
      rentSchedule: schedule,
    };

    // Optional Bahagian B · pds_suratcara block. When present, the
    // code must be one of `INSTRUMENT_NAME_OPTIONS`. Operator-supplied
    // labels are accepted as-is BUT if a known label exists for the
    // code we normalise to the canonical one to keep the option table
    // authoritative.
    if (
      ri.portalInstrumentName !== undefined &&
      ri.portalInstrumentName !== null
    ) {
      if (typeof ri.portalInstrumentName !== "object") {
        return {
          ok: false,
          error: "instrument.portalInstrumentName must be an object.",
        };
      }
      const rin = ri.portalInstrumentName as Record<string, unknown>;
      if (
        typeof rin.code !== "string" ||
        !INSTRUMENT_NAME_CODE_SET.has(
          rin.code as TenancyPortalInstrumentNameCode
        )
      ) {
        return {
          ok: false,
          error:
            "instrument.portalInstrumentName.code must be one of: " +
            INSTRUMENT_NAME_OPTIONS.map((o) => o.code).join(", ") +
            ".",
        };
      }
      const code = rin.code as TenancyPortalInstrumentNameCode;
      const canonicalLabel = INSTRUMENT_NAME_LABEL_BY_CODE[code];
      const suppliedLabel =
        typeof rin.label === "string" && rin.label.trim()
          ? rin.label.trim()
          : canonicalLabel;
      const normalisedName: TenancyPortalInstrumentName = {
        code,
        label: canonicalLabel ?? suppliedLabel,
      };
      value.instrument.portalInstrumentName = normalisedName;
    }

    if (typeof ri.operatorNote === "string" && ri.operatorNote.trim()) {
      value.instrument.operatorNote = ri.operatorNote.trim();
    }
  }

  // Optional property block
  if (c.property && typeof c.property === "object") {
    const rp = c.property as Record<string, unknown>;
    const requiredStrings: Record<string, string> = {};
    for (const k of [
      "addressLine1",
      "postcode",
      "city",
      "state",
      "country",
    ] as const) {
      const v = rp[k];
      if (typeof v !== "string") {
        return { ok: false, error: `property.${k} must be a string.` };
      }
      requiredStrings[k] = v.trim();
    }
    const allowedPropertyTypes = new Set<TenancyPortalPropertyType>([
      "kediaman",
      "perdagangan",
      "perindustrian",
      "tanah_kosong",
    ]);
    if (!allowedPropertyTypes.has(rp.propertyType as TenancyPortalPropertyType)) {
      return {
        ok: false,
        error:
          "property.propertyType must be one of 'kediaman', 'perdagangan', 'perindustrian', 'tanah_kosong'.",
      };
    }
    if (
      typeof rp.premisesAreaSqm !== "number" ||
      !Number.isFinite(rp.premisesAreaSqm) ||
      rp.premisesAreaSqm < 0
    ) {
      return {
        ok: false,
        error: "property.premisesAreaSqm must be a non-negative number.",
      };
    }
    value.property = {
      addressLine1: requiredStrings.addressLine1,
      postcode: requiredStrings.postcode,
      city: requiredStrings.city,
      state: requiredStrings.state,
      country: requiredStrings.country,
      propertyType: rp.propertyType as TenancyPortalPropertyType,
      premisesAreaSqm: rp.premisesAreaSqm as number,
    };
    if (typeof rp.addressLine2 === "string" && rp.addressLine2.trim()) {
      value.property.addressLine2 = rp.addressLine2.trim();
    }
    const allowedBuildingTypes = new Set<TenancyPortalBuildingType>([
      "rumah_teres",
      "rumah_banglo",
      "rumah_berkembar",
      "rumah_kluster",
      "townhouse",
      "apartment",
      "kondominium",
      "studio",
      "lain_lain",
    ]);
    if (
      typeof rp.buildingType === "string" &&
      allowedBuildingTypes.has(rp.buildingType as TenancyPortalBuildingType)
    ) {
      value.property.buildingType = rp.buildingType as TenancyPortalBuildingType;
    }
    const allowedFurnished = new Set<TenancyPortalFurnishedStatus>([
      "fully_furnished",
      "partially_furnished",
      "unfurnished",
    ]);
    if (
      typeof rp.furnishedStatus === "string" &&
      allowedFurnished.has(rp.furnishedStatus as TenancyPortalFurnishedStatus)
    ) {
      value.property.furnishedStatus =
        rp.furnishedStatus as TenancyPortalFurnishedStatus;
    }
    if (typeof rp.floor === "string" && rp.floor.trim()) {
      value.property.floor = rp.floor.trim();
    }
    if (
      typeof rp.numberOfFloors === "number" &&
      Number.isInteger(rp.numberOfFloors) &&
      rp.numberOfFloors > 0
    ) {
      value.property.numberOfFloors = rp.numberOfFloors;
    }
    if (rp.premisesAreaIsZeroFallback === true) {
      value.property.premisesAreaIsZeroFallback = true;
    }

    // Optional Bahagian C land-registry sub-block.
    //
    // Partial-save semantics (post-A1-review patch): each field is
    // accepted independently. Missing or blank values are silently
    // omitted from the persisted shape; *malformed* values (wrong
    // type, negative number, unknown enum code) are rejected with a
    // specific error so the operator can fix them. The completeness
    // check belongs to the readiness gate, not the validator —
    // partial captures must persist so they survive page reload.
    if (rp.landRegistry !== undefined && rp.landRegistry !== null) {
      if (typeof rp.landRegistry !== "object") {
        return {
          ok: false,
          error: "property.landRegistry must be an object.",
        };
      }
      const rlr = rp.landRegistry as Record<string, unknown>;
      const lr: TenancyPortalLandRegistry = {};

      // Text fields — each independently optional. Reject only when
      // a value is supplied as a non-string (programmer / API misuse).
      for (const k of [
        "milikPenuh",
        "lot",
        "mukim",
        "daerah",
      ] as const) {
        const v = rlr[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== "string") {
          return {
            ok: false,
            error: `property.landRegistry.${k} must be a string when supplied.`,
          };
        }
        const trimmed = v.trim();
        if (trimmed !== "") lr[k] = trimmed;
      }

      // luas — optional. When present must be a positive finite
      // number. We reject negatives / NaN / Infinity so the operator
      // sees a clear error instead of silent value drift.
      if (rlr.luas !== undefined && rlr.luas !== null) {
        if (
          typeof rlr.luas !== "number" ||
          !Number.isFinite(rlr.luas) ||
          rlr.luas <= 0
        ) {
          return {
            ok: false,
            error:
              "property.landRegistry.luas must be a positive finite number when supplied.",
          };
        }
        lr.luas = rlr.luas;
      }

      // luasUnit — optional. When present must be one of the four
      // observed portal codes.
      if (rlr.luasUnit !== undefined && rlr.luasUnit !== null) {
        if (
          typeof rlr.luasUnit !== "string" ||
          !ALLOWED_LAND_AREA_UNITS.has(
            rlr.luasUnit as TenancyPortalLandAreaUnit
          )
        ) {
          return {
            ok: false,
            error:
              "property.landRegistry.luasUnit must be one of: " +
              Array.from(ALLOWED_LAND_AREA_UNITS).join(", ") +
              " when supplied.",
          };
        }
        lr.luasUnit = rlr.luasUnit as TenancyPortalLandAreaUnit;
      }

      // kegunaan — always optional. Trim and only persist when a real
      // value is supplied.
      if (typeof rlr.kegunaan === "string" && rlr.kegunaan.trim()) {
        lr.kegunaan = rlr.kegunaan.trim();
      }

      // Persist only when at least one field was successfully
      // captured. An empty sub-block adds noise without value.
      if (Object.keys(lr).length > 0) {
        value.property.landRegistry = lr;
      }
    }

    if (typeof rp.operatorNote === "string" && rp.operatorNote.trim()) {
      value.property.operatorNote = rp.operatorNote.trim();
    }
  }

  // Optional Maklumat Am sub-block (Milestone A2). Same partial-save
  // semantics as land-registry: missing / blank values are silently
  // omitted; malformed values are rejected with a clear error. Sub-
  // block is dropped entirely if no field made it through.
  if (c.maklumatAm !== undefined && c.maklumatAm !== null) {
    if (typeof c.maklumatAm !== "object") {
      return { ok: false, error: "maklumatAm must be an object." };
    }
    const rma = c.maklumatAm as Record<string, unknown>;
    const ma: TenancyPortalMaklumatAm = {};

    // pds_dutisetem — captured-select. When supplied we require a
    // non-empty `code` so the readiness gate has something to check;
    // we accept an optional `label`.
    if (rma.dutyStampType !== undefined && rma.dutyStampType !== null) {
      if (typeof rma.dutyStampType !== "object") {
        return {
          ok: false,
          error: "maklumatAm.dutyStampType must be an object when supplied.",
        };
      }
      const ds = rma.dutyStampType as Record<string, unknown>;
      if (ds.code !== undefined && ds.code !== null) {
        if (typeof ds.code !== "string") {
          return {
            ok: false,
            error:
              "maklumatAm.dutyStampType.code must be a string when supplied.",
          };
        }
        const trimmedCode = ds.code.trim();
        if (trimmedCode !== "") {
          const captured: { code: string; label?: string } = {
            code: trimmedCode,
          };
          if (typeof ds.label === "string" && ds.label.trim()) {
            captured.label = ds.label.trim();
          }
          ma.dutyStampType = captured;
        }
      }
    }

    // pds_ps — narrow enum
    if (
      rma.instrumentRelationship !== undefined &&
      rma.instrumentRelationship !== null
    ) {
      if (
        typeof rma.instrumentRelationship !== "string" ||
        !ALLOWED_INSTRUMENT_RELATIONSHIPS.has(
          rma.instrumentRelationship as TenancyPortalInstrumentRelationship
        )
      ) {
        return {
          ok: false,
          error:
            "maklumatAm.instrumentRelationship must be one of: " +
            Array.from(ALLOWED_INSTRUMENT_RELATIONSHIPS).join(", ") +
            " when supplied.",
        };
      }
      ma.instrumentRelationship =
        rma.instrumentRelationship as TenancyPortalInstrumentRelationship;
    }

    // pds_balasan — positive finite number when supplied
    if (rma.balasan !== undefined && rma.balasan !== null) {
      if (
        typeof rma.balasan !== "number" ||
        !Number.isFinite(rma.balasan) ||
        rma.balasan <= 0
      ) {
        return {
          ok: false,
          error:
            "maklumatAm.balasan must be a positive finite number when supplied.",
        };
      }
      ma.balasan = rma.balasan;
    }

    // pds_remit — captured-select; same shape as dutyStampType.
    if (rma.remission !== undefined && rma.remission !== null) {
      if (typeof rma.remission !== "object") {
        return {
          ok: false,
          error: "maklumatAm.remission must be an object when supplied.",
        };
      }
      const rm = rma.remission as Record<string, unknown>;
      if (rm.code !== undefined && rm.code !== null) {
        if (typeof rm.code !== "string") {
          return {
            ok: false,
            error:
              "maklumatAm.remission.code must be a string when supplied.",
          };
        }
        const trimmedCode = rm.code.trim();
        if (trimmedCode !== "") {
          const captured: { code: string; label?: string } = {
            code: trimmedCode,
          };
          if (typeof rm.label === "string" && rm.label.trim()) {
            captured.label = rm.label.trim();
          }
          ma.remission = captured;
        }
      }
    }

    // pds_perjanjian — three independent booleans. Anything other
    // than `true` is treated as "not checked" (no exemption claimed)
    // and is omitted from the persisted shape.
    if (
      rma.treatyExemption !== undefined &&
      rma.treatyExemption !== null
    ) {
      if (typeof rma.treatyExemption !== "object") {
        return {
          ok: false,
          error:
            "maklumatAm.treatyExemption must be an object when supplied.",
        };
      }
      const rt = rma.treatyExemption as Record<string, unknown>;
      const treaty: { kmkt?: boolean; klnm?: boolean; vienna?: boolean } = {};
      // Reject non-boolean supplied values so silent type drift is
      // caught — but allow the keys to be omitted entirely.
      for (const k of ["kmkt", "klnm", "vienna"] as const) {
        const v = rt[k];
        if (v === undefined || v === null) continue;
        if (typeof v !== "boolean") {
          return {
            ok: false,
            error: `maklumatAm.treatyExemption.${k} must be a boolean when supplied.`,
          };
        }
        if (v === true) treaty[k] = true;
      }
      if (Object.keys(treaty).length > 0) {
        ma.treatyExemption = treaty;
      }
    }

    if (Object.keys(ma).length > 0) {
      value.maklumatAm = ma;
    }
  }

  if (typeof c.operatorNote === "string" && c.operatorNote.trim()) {
    value.operatorNote = c.operatorNote.trim();
  }

  return { ok: true, value };
}
