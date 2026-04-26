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
  TenancyPortalParty,
  TenancyPortalPropertyType,
} from "./stamping-types";

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
    if (typeof rp.operatorNote === "string" && rp.operatorNote.trim()) {
      value.property.operatorNote = rp.operatorNote.trim();
    }
  }

  if (typeof c.operatorNote === "string" && c.operatorNote.trim()) {
    value.operatorNote = c.operatorNote.trim();
  }

  return { ok: true, value };
}
