/**
 * WeStamp — Tenancy Bahagian A · Field Mapping Registry (Milestone B8)
 *
 * Static registry mapping each WeStamp internal Bahagian A field key
 * to its known portal-side equivalents. Each entry carries an explicit
 * **certainty** — `observed`, `inferred`, or `unknown` — so the
 * future executor never silently treats an unknown selector as
 * actionable.
 *
 * Evidence vintage
 * ────────────────
 * The `observed` portal field keys (`warga`, `EPD_NOKP_TYPE`,
 * `USER_SEX`, `owner_name`, `tb_roc`, `tb_roc_new`, `jenis_perniagaan`,
 * `tb_syarikat`) come from the ε-3 portal field-mapping run
 * documented inline in `stamping-types.ts`. Selectors are not all
 * captured yet — the field NAMES are observed but the CSS/DOM
 * selector strings need a fresh live diagnosis (Milestone B8 Part 3).
 *
 * Invariants
 * ──────────
 * - This file NEVER invents selectors. An entry whose live selector
 *   has not been observed carries `selector: null` and
 *   `selectorCertainty: "unknown"`.
 * - This file NEVER fabricates option codes. An entry with observed
 *   labels but unknown codes carries `optionValues: null` (codes not
 *   yet enumerated) — the executor must treat such entries as
 *   non-actionable until the codes are observed.
 * - `executable: false` for any entry whose `selectorCertainty` is
 *   `unknown` OR whose `optionValuesCertainty` is `unknown` for a
 *   select-type field.
 */

// ─── Public types ──────────────────────────────────────────────────

/** Certainty of a piece of mapping evidence. */
export type BahagianAFieldCertainty = "observed" | "inferred" | "unknown";

/** Tag of the planned portal control. */
export type BahagianAFieldKind =
  | "text_input"
  | "select"
  | "radio_group"
  | "checkbox"
  | "textarea"
  | "button";

/** A single observed `<option>` on a select control. */
export interface BahagianAObservedOption {
  /** Stable portal `<option value>` code. */
  code: string;
  /** Operator-facing label, when observed. */
  label: string | null;
}

/** Single mapping entry. */
export interface BahagianAFieldMappingEntry {
  /** Stable WeStamp-internal field key (e.g. `nameAsPerInstrument`). */
  internalKey: string;
  /** Planned control tag on the portal. */
  fieldKind: BahagianAFieldKind;
  /**
   * Portal `<input name="...">` / `<select name="...">` / similar
   * attribute, or a stable widget identifier we've documented from
   * evidence. `null` when unknown.
   */
  portalFieldKey: string | null;
  /** Operator-facing label observed alongside the field. `null` when unknown. */
  portalLabel: string | null;
  /**
   * Concrete CSS selector that resolves the field on the live form.
   * `null` for any entry whose selector has not been observed and
   * documented. NEVER guessed.
   */
  selector: string | null;
  /** Certainty for `portalFieldKey` + `selector`. */
  selectorCertainty: BahagianAFieldCertainty;
  /**
   * Observed `<option>` value list for select-type fields. `null`
   * when (a) the field is not a select, or (b) the codes have not
   * been observed yet.
   */
  optionValues: BahagianAObservedOption[] | null;
  /** Certainty for `optionValues`. `unknown` covers null option lists. */
  optionValuesCertainty: BahagianAFieldCertainty;
  /**
   * Whether the field is executable by the future B-impl Phase 3
   * executor at this evidence level. `false` for any entry whose
   * selector is unknown or whose option codes are unknown for a
   * select-type field.
   */
  executable: boolean;
  /** Free-text note explaining the certainty / known evidence. */
  note: string;
}

/**
 * Read-only registry: a non-empty list of field-mapping entries
 * for one party type.
 */
export interface BahagianAFieldMappingRegistry {
  /** Party-type label this registry covers. */
  partyType: "individual" | "company_ssm";
  /** All field mapping entries, in stable order. */
  entries: readonly BahagianAFieldMappingEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Compute `executable` from the concrete evidence pieces. Used
 * during registry construction so the invariant is in one place.
 *
 * Rule: an entry is executable only when WeStamp has BOTH a
 * concrete CSS selector (`selector !== null`) AND, for select
 * fields, a documented option-value list. Documenting the portal
 * field NAME alone (e.g. `warga`) is not enough — the executor
 * needs a live-verified selector. At the B8 evidence level no
 * Bahagian A field qualifies; the future modal-diagnosis milestone
 * will populate selectors and flip entries to executable.
 */
function deriveExecutable(
  e: Pick<
    BahagianAFieldMappingEntry,
    "selector" | "fieldKind" | "optionValues"
  >
): boolean {
  if (e.selector === null) return false;
  if (e.fieldKind === "select" && e.optionValues === null) return false;
  return true;
}

// ─── Individual party registry ────────────────────────────────────

/**
 * Registry for `type === "individual"` parties. Includes free-text
 * identity / address fields and the four observed Bahagian A enums.
 */
const INDIVIDUAL_ENTRIES: BahagianAFieldMappingEntry[] = [
  // ── Free-text identity ───────────────────────────────────────────
  {
    internalKey: "nameAsPerInstrument",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Nama (As per Instrument)",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Free-text input. Live selector not yet documented; awaiting B8 Part 3 modal diagnosis.",
  },
  // ── Bahagian A enums (from ε-3 evidence) ─────────────────────────
  {
    internalKey: "citizenshipCategory",
    fieldKind: "select",
    portalFieldKey: "warga",
    portalLabel: "Warga (Citizenship)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: [
      { code: "1", label: "Citizen" },
      { code: "2", label: "Non-citizen" },
      { code: "3", label: "Permanent Resident" },
    ],
    optionValuesCertainty: "observed",
    executable: false,
    note: "ε-3 field-mapping evidence — `warga` is a 3-way enum. Selector not yet documented at the modal layer.",
  },
  {
    internalKey: "identityType",
    fieldKind: "select",
    portalFieldKey: null,
    portalLabel: "Jenis Pengenalan",
    selector: null,
    selectorCertainty: "inferred",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Inferred select — NRIC / passport options. Codes and selector await live modal diagnosis.",
  },
  {
    internalKey: "identityNumber",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "No. Pengenalan",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Free-text NRIC / passport entry. Selector unknown.",
  },
  {
    internalKey: "nricSubType",
    fieldKind: "select",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Kad Pengenalan",
    selector: null,
    selectorCertainty: "observed",
    optionValues: [
      { code: "ic_baru", label: "IC_BARU" },
      { code: "ic_lama", label: "IC_LAMA" },
      { code: "ic_polis", label: "IC_POLIS" },
      { code: "ic_army", label: "IC_ARMY" },
    ],
    optionValuesCertainty: "inferred",
    executable: false,
    note: "ε-3 evidence — 4 sub-types observed. Portal `<option value>` codes not directly captured; the codes above mirror WeStamp's internal enum and are flagged `inferred`.",
  },
  {
    internalKey: "gender",
    fieldKind: "select",
    portalFieldKey: "USER_SEX",
    portalLabel: "Jantina",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `USER_SEX` is the portal field. Option codes (e.g. M / F) not yet captured.",
  },
  // ── TIN ──────────────────────────────────────────────────────────
  {
    internalKey: "tinAutoGenerationExpected",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "TIN",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "TIN field — portal may auto-generate after identity entry. Selector + behavior await live diagnosis.",
  },
  // ── Address / contact ────────────────────────────────────────────
  {
    internalKey: "addressLine1",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Alamat Baris 1",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Free-text address line.",
  },
  {
    internalKey: "addressLine2",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Alamat Baris 2",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Optional second address line.",
  },
  {
    internalKey: "postcode",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Poskod",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Postcode — typically free-text 5-digit field on the portal.",
  },
  {
    internalKey: "city",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Bandar",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "City — typically free-text on the portal.",
  },
  {
    internalKey: "state",
    fieldKind: "select",
    portalFieldKey: null,
    portalLabel: "Negeri",
    selector: null,
    selectorCertainty: "inferred",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "State — inferred select (16 Malaysian states + 3 Federal Territories). Codes await live diagnosis.",
  },
  {
    internalKey: "country",
    fieldKind: "select",
    portalFieldKey: null,
    portalLabel: "Negara",
    selector: null,
    selectorCertainty: "inferred",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Country — inferred select. Codes await live diagnosis.",
  },
  {
    internalKey: "mobile",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "No. Telefon Bimbit",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Mobile number — free text.",
  },
  {
    internalKey: "phone",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "No. Telefon",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Optional landline.",
  },
];

// ─── SSM company registry ─────────────────────────────────────────

const COMPANY_SSM_ENTRIES: BahagianAFieldMappingEntry[] = [
  {
    internalKey: "nameAsPerInstrument",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "Nama Syarikat (As per Instrument)",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Free-text company name input.",
  },
  {
    internalKey: "rocOld",
    fieldKind: "text_input",
    portalFieldKey: "tb_roc",
    portalLabel: "No. ROC (Lama)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `tb_roc` is the old / pre-2017 ROC text input. Selector unknown.",
  },
  {
    internalKey: "rocNew",
    fieldKind: "text_input",
    portalFieldKey: "tb_roc_new",
    portalLabel: "No. ROC (Baru)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `tb_roc_new` is the new / post-2017 ROC text input. Selector unknown.",
  },
  {
    internalKey: "businessType",
    fieldKind: "select",
    portalFieldKey: "jenis_perniagaan",
    portalLabel: "Jenis Perniagaan",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `jenis_perniagaan` has 6 observed options but their codes were NOT captured. Field is non-executable until codes are observed live.",
  },
  {
    internalKey: "companyLocality",
    fieldKind: "select",
    portalFieldKey: "tb_syarikat",
    portalLabel: "Lokaliti Syarikat",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `tb_syarikat` has 2 observed options (local / foreign) but codes were NOT captured.",
  },
  // ── Representative sub-block ─────────────────────────────────────
  {
    internalKey: "companyRepresentative.ownerName",
    fieldKind: "text_input",
    portalFieldKey: "owner_name",
    portalLabel: "Nama Wakil Syarikat",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "ε-3 evidence — `owner_name` is the SSM modal's representative-name field.",
  },
  {
    internalKey: "companyRepresentative.citizenshipCategory",
    fieldKind: "select",
    portalFieldKey: "warga",
    portalLabel: "Warga (Wakil)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: [
      { code: "1", label: "Citizen" },
      { code: "2", label: "Non-citizen" },
      { code: "3", label: "Permanent Resident" },
    ],
    optionValuesCertainty: "observed",
    executable: false,
    note: "Same enum as the individual-party `warga` field. Selector unknown at modal layer.",
  },
  {
    internalKey: "companyRepresentative.identityType",
    fieldKind: "select",
    portalFieldKey: null,
    portalLabel: "Jenis Pengenalan (Wakil)",
    selector: null,
    selectorCertainty: "inferred",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Inferred — same shape as individual identityType.",
  },
  {
    internalKey: "companyRepresentative.identityNumber",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: "No. Pengenalan (Wakil)",
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Free-text representative identity number.",
  },
  {
    internalKey: "companyRepresentative.nricSubType",
    fieldKind: "select",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Kad Pengenalan (Wakil)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: [
      { code: "ic_baru", label: "IC_BARU" },
      { code: "ic_lama", label: "IC_LAMA" },
      { code: "ic_polis", label: "IC_POLIS" },
      { code: "ic_army", label: "IC_ARMY" },
    ],
    optionValuesCertainty: "inferred",
    executable: false,
    note: "Same as individual NRIC sub-type.",
  },
  {
    internalKey: "companyRepresentative.gender",
    fieldKind: "select",
    portalFieldKey: "USER_SEX",
    portalLabel: "Jantina (Wakil)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    executable: false,
    note: "Same as individual gender field.",
  },
];

// ─── Apply executable derivation + freeze ─────────────────────────

function freezeRegistry(
  partyType: BahagianAFieldMappingRegistry["partyType"],
  raw: BahagianAFieldMappingEntry[]
): BahagianAFieldMappingRegistry {
  const entries = raw.map((e) => ({
    ...e,
    executable: deriveExecutable(e),
  }));
  return { partyType, entries: Object.freeze(entries) as readonly BahagianAFieldMappingEntry[] };
}

/** Public registry for individual parties. */
export const BAHAGIAN_A_INDIVIDUAL_REGISTRY: BahagianAFieldMappingRegistry =
  freezeRegistry("individual", INDIVIDUAL_ENTRIES);

/** Public registry for SSM company parties. */
export const BAHAGIAN_A_COMPANY_SSM_REGISTRY: BahagianAFieldMappingRegistry =
  freezeRegistry("company_ssm", COMPANY_SSM_ENTRIES);

/**
 * Lookup helper. Returns the registry for a given party type, or
 * `null` if no registry has been authored yet (e.g. company_non_ssm).
 */
export function getBahagianAFieldMappingRegistry(
  partyType: "individual" | "company_ssm" | "company_non_ssm"
): BahagianAFieldMappingRegistry | null {
  if (partyType === "individual") return BAHAGIAN_A_INDIVIDUAL_REGISTRY;
  if (partyType === "company_ssm") return BAHAGIAN_A_COMPANY_SSM_REGISTRY;
  return null;
}

/** Categorical certainty summary for a registry. */
export interface BahagianAMappingCertaintySummary {
  partyType: BahagianAFieldMappingRegistry["partyType"];
  totalEntries: number;
  observedSelectors: number;
  inferredSelectors: number;
  unknownSelectors: number;
  observedOptionValueLists: number;
  inferredOptionValueLists: number;
  unknownOptionValueLists: number;
  executableEntries: number;
}

/** Roll up a registry into a categorical summary suitable for the UI. */
export function summarizeBahagianAFieldMapping(
  registry: BahagianAFieldMappingRegistry
): BahagianAMappingCertaintySummary {
  const summary: BahagianAMappingCertaintySummary = {
    partyType: registry.partyType,
    totalEntries: registry.entries.length,
    observedSelectors: 0,
    inferredSelectors: 0,
    unknownSelectors: 0,
    observedOptionValueLists: 0,
    inferredOptionValueLists: 0,
    unknownOptionValueLists: 0,
    executableEntries: 0,
  };
  for (const e of registry.entries) {
    if (e.selectorCertainty === "observed") summary.observedSelectors++;
    else if (e.selectorCertainty === "inferred") summary.inferredSelectors++;
    else summary.unknownSelectors++;
    if (e.optionValuesCertainty === "observed") summary.observedOptionValueLists++;
    else if (e.optionValuesCertainty === "inferred") summary.inferredOptionValueLists++;
    else summary.unknownOptionValueLists++;
    if (e.executable) summary.executableEntries++;
  }
  return summary;
}
