/**
 * WeStamp — Tenancy Bahagian A · Field Mapping Registry
 * (Milestone B8 + B9 live-evidence patches)
 *
 * Static registry mapping each WeStamp internal Bahagian A field key
 * to its known portal-side equivalents. Each entry carries an explicit
 * **certainty** — `observed`, `inferred`, or `unknown` — so the
 * future executor never silently treats an unknown selector as
 * actionable.
 *
 * Evidence vintage
 * ────────────────
 * - **B8 (planning)**: portal field NAMES (`warga`, `EPD_NOKP_TYPE`,
 *   `USER_SEX`, `owner_name`, `tb_roc`, `tb_roc_new`,
 *   `jenis_perniagaan`, `tb_syarikat`) carried over from ε-3.
 * - **B9 (live modal capture, 2026-04-30)**: every individual-party
 *   modal field's concrete CSS selector, full live `<option value>`
 *   list for `warga` / `negeri1` / `negara2`, the role-scoped table-
 *   side trigger anchors, the modal close button, and the modal
 *   Simpan button. The Simpan selector is recorded but is NEVER
 *   clicked by the executor at the B9 evidence level — it stays as
 *   a `planned_only` step in the executor draft until a future
 *   milestone authorises the row save.
 *
 * Invariants
 * ──────────
 * - This file NEVER invents selectors. An entry whose live selector
 *   has not been observed carries `selector: null` and
 *   `selectorCertainty: "unknown"`.
 * - This file NEVER fabricates option codes. An entry with observed
 *   labels but unknown codes carries `optionValues: null`.
 * - `executable: false` for any entry whose `selector` is `null` OR
 *   whose `optionValues` is `null` for a select-type field.
 *
 * Sensitive-data policy
 * ─────────────────────
 * Per the working-style update: portal field NAMES, selectors,
 * option codes, and modal titles are non-PII portal-vocabulary
 * identifiers and may appear in operator-only diagnostic output and
 * source code. Real party PII (raw IC numbers, party names typed
 * into the live modal) does NOT belong here — this file documents
 * SCHEMA only, never values.
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

/**
 * Scope of a field across the two role-specific modals (landlord vs
 * tenant). Live B9 evidence: every observed individual-party modal
 * field is `shared` — both modals carry identical field surfaces.
 * The role distinction lives at the table-side trigger anchors and
 * the modal title, not in the field selectors.
 */
export type BahagianAFieldRoleScope =
  | "shared"
  | "landlord_only"
  | "tenant_only";

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
   * when (a) the field is not a select / radio_group, or (b) the
   * codes have not been observed yet. For radio groups, each option
   * `code` is the radio's `id`/`value` and the `selector` resolves
   * the group container; the executor must combine both to click
   * the right radio.
   */
  optionValues: BahagianAObservedOption[] | null;
  /** Certainty for `optionValues`. `unknown` covers null option lists. */
  optionValuesCertainty: BahagianAFieldCertainty;
  /**
   * Role scope. Most modal fields are `shared`; trigger anchors
   * (table-side) are role-specific.
   */
  roleScope: BahagianAFieldRoleScope;
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
 * concrete CSS selector (`selector !== null`) AND, for select /
 * radio_group fields, a documented option-value list. Documenting
 * the portal field NAME alone (e.g. `warga`) is not enough — the
 * executor needs a live-verified selector.
 */
function deriveExecutable(
  e: Pick<
    BahagianAFieldMappingEntry,
    "selector" | "fieldKind" | "optionValues"
  >
): boolean {
  if (e.selector === null) return false;
  if (
    (e.fieldKind === "select" || e.fieldKind === "radio_group") &&
    e.optionValues === null
  ) {
    return false;
  }
  return true;
}

// ─── Live B9 option-value evidence ─────────────────────────────────

/**
 * `warga` — citizenship status. Captured live 2026-04-30 from the
 * landlord Tambah Individu modal. Note the order: the live `<select>`
 * lists Citizen → Permanent Resident → Non-citizen (codes 1, 3, 2).
 * WeStamp keeps the codes verbatim; ordering is portal-defined.
 */
const WARGA_OPTIONS: BahagianAObservedOption[] = [
  { code: "1", label: "Warganegara" },
  { code: "3", label: "Penduduk Tetap" },
  { code: "2", label: "Bukan Warganegara" },
];

/**
 * `negeri1` — Malaysian state + "Luar Negara" sentinel. 17 options
 * total. Captured live 2026-04-30.
 */
const NEGERI1_OPTIONS: BahagianAObservedOption[] = [
  { code: "1", label: "Johor" },
  { code: "2", label: "Kedah" },
  { code: "3", label: "Kelantan" },
  { code: "4", label: "Melaka" },
  { code: "5", label: "Negeri Sembilan" },
  { code: "6", label: "Pahang" },
  { code: "7", label: "Perak" },
  { code: "8", label: "Perlis" },
  { code: "9", label: "Pulau Pinang" },
  { code: "10", label: "Sabah" },
  { code: "11", label: "Sarawak" },
  { code: "12", label: "Selangor" },
  { code: "13", label: "Terengganu" },
  { code: "14", label: "Wilayah Persekutuan Kuala Lumpur" },
  { code: "15", label: "Wilayah Persekutuan Labuan" },
  { code: "16", label: "Wilayah Persekutuan Putrajaya" },
  { code: "17", label: "Luar Negara" },
];

/**
 * `negara2` — country of residence select. The live list has 200+
 * options keyed by numeric portal codes. We document the small
 * subset relevant to the typical Malaysian-tenancy flow plus the
 * sentinel for foreign country. The full list is observable on the
 * live modal; if WeStamp ever needs a non-Malaysian country, the
 * executor can re-fetch `<option>`s at runtime.
 *
 * Live evidence captured Malaysia code (Malaysia is in the list as
 * one of the 200+ options; the diagnostic captured the first 32
 * options alphabetically). For the executor's first execution
 * milestone we document only the most-commonly-needed code pending
 * a follow-up live extraction.
 */
const NEGARA2_PARTIAL_OPTIONS: BahagianAObservedOption[] = [
  // Empty placeholder — observed in the live modal as the default.
  { code: "", label: "Sila pilih..." },
  // Malaysia code is on the live select but past the diagnostic's
  // 32-option cap. Future live capture will fill the rest.
];

/**
 * NRIC sub-type radio group. Captured live 2026-04-30 — these are
 * input[type=radio] elements all sharing `name="EPD_NOKP_TYPE"` but
 * distinguished by their `id` (which is also each radio's value).
 *
 * The selector for the GROUP is `input[name="EPD_NOKP_TYPE"]`. To
 * pick a specific value the executor must click the radio whose
 * `id` matches the desired code.
 */
const NRIC_SUBTYPE_OPTIONS: BahagianAObservedOption[] = [
  { code: "IC_BARU", label: "No. Kad Pengenalan(Baharu)" },
  { code: "IC_LAMA", label: "No. Kad Pengenalan(Lama)" },
  { code: "IC_POLIS", label: "No. Polis" },
  { code: "IC_ARMY", label: "No. Tentera" },
];

/**
 * Gender radio group. `name="USER_SEX"`, ids `USER_SEX-1`/`USER_SEX-2`.
 */
const USER_SEX_OPTIONS: BahagianAObservedOption[] = [
  { code: "USER_SEX-1", label: "Lelaki" },
  { code: "USER_SEX-2", label: "Perempuan" },
];

// ─── Individual party registry (B9 live-evidence patch) ───────────

const INDIVIDUAL_ENTRIES: BahagianAFieldMappingEntry[] = [
  // ── Free-text identity ───────────────────────────────────────────
  {
    internalKey: "nameAsPerInstrument",
    fieldKind: "text_input",
    portalFieldKey: "tb_nama",
    portalLabel: "Nama Seperti Dalam Surat Cara*",
    selector: 'input#tb_nama',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false, // derived below
    note: "B9 live evidence — required free-text input on the Tambah Individu modal.",
  },
  // ── Bahagian A enums ─────────────────────────────────────────────
  {
    internalKey: "citizenshipCategory",
    fieldKind: "select",
    portalFieldKey: "warga",
    portalLabel: "Status Warganegara*",
    selector: 'select#warga',
    selectorCertainty: "observed",
    optionValues: WARGA_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — 3 options (1=Warganegara, 2=Bukan Warganegara, 3=Penduduk Tetap).",
  },
  {
    internalKey: "identityType",
    fieldKind: "radio_group",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Pengenalan",
    selector: 'input[name="EPD_NOKP_TYPE"]',
    selectorCertainty: "observed",
    optionValues: NRIC_SUBTYPE_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — `EPD_NOKP_TYPE` on the live modal is a 4-radio group (IC_BARU/IC_LAMA/IC_POLIS/IC_ARMY), not a select. The portal also exposes a passport branch (`input#passportin`) when `warga` is set to non-citizen — see the observed-but-unmapped list. WeStamp's existing `identityType` field doubles for the radio choice today; future iterations may split out a dedicated NRIC-only sub-enum.",
  },
  {
    internalKey: "identityNumber",
    fieldKind: "text_input",
    portalFieldKey: "kpin",
    portalLabel: "No. Pengenalan Diri*",
    selector: 'input#kpin',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — disabled by default. The live modal enables `#kpin` only after an `EPD_NOKP_TYPE` radio is picked. Executor draft must select a radio FIRST, then fill `#kpin`.",
  },
  {
    internalKey: "nricSubType",
    fieldKind: "radio_group",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Pengenalan (sub-type)",
    selector: 'input[name="EPD_NOKP_TYPE"]',
    selectorCertainty: "observed",
    optionValues: NRIC_SUBTYPE_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — same radio group as `identityType` above. WeStamp's separate `nricSubType` enum (`ic_baru`/`ic_lama`/`ic_polis`/`ic_army`) maps 1:1 to the portal codes (`IC_BARU`/`IC_LAMA`/`IC_POLIS`/`IC_ARMY`).",
  },
  {
    internalKey: "gender",
    fieldKind: "radio_group",
    portalFieldKey: "USER_SEX",
    portalLabel: "Jantina*",
    selector: 'input[name="USER_SEX"]',
    selectorCertainty: "observed",
    optionValues: USER_SEX_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — `USER_SEX` is a 2-radio group; ids `USER_SEX-1` / `USER_SEX-2` map to Lelaki / Perempuan.",
  },
  // ── TIN ──────────────────────────────────────────────────────────
  {
    internalKey: "tinAutoGenerationExpected",
    fieldKind: "text_input",
    portalFieldKey: "tb_cukai",
    portalLabel: "No. Pengenalan Cukai (TIN)",
    selector: 'input[name="tb_cukai"]',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — TIN entry input. The live modal also exposes `input[name=\"tb_cukai_display\"]` (readonly mirror) and auto-populates the value when a recognised IC is entered. WeStamp's `tinAutoGenerationExpected` flag is internal-only — the executor leaves the field blank when the flag is true.",
  },
  // ── Address / contact ────────────────────────────────────────────
  {
    internalKey: "addressLine1",
    fieldKind: "text_input",
    portalFieldKey: "tb_alamat_1",
    portalLabel: "Alamat*",
    selector: 'input#tb_alamat_1',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — required address line 1.",
  },
  {
    internalKey: "addressLine2",
    fieldKind: "text_input",
    portalFieldKey: "tb_alamat_2",
    portalLabel: "Alamat (baris 2)",
    selector: 'input#tb_alamat_2',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — optional second address line. The live modal also exposes a third address-line field (`#tb_alamat_3`) which WeStamp does not currently model.",
  },
  {
    internalKey: "postcode",
    fieldKind: "text_input",
    portalFieldKey: "tb_poskod",
    portalLabel: "Poskod*",
    selector: 'input#tb_poskod',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — required postcode input.",
  },
  {
    internalKey: "city",
    fieldKind: "text_input",
    portalFieldKey: "tb_city",
    portalLabel: "Bandar*",
    selector: 'input#tb_city',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — required city input.",
  },
  {
    internalKey: "state",
    fieldKind: "select",
    portalFieldKey: "negeri1",
    portalLabel: "Negeri*",
    selector: 'select#negeri1',
    selectorCertainty: "observed",
    optionValues: NEGERI1_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — 17 options (16 Malaysian states + `Luar Negara`).",
  },
  {
    internalKey: "country",
    fieldKind: "select",
    portalFieldKey: "negara2",
    portalLabel: "Negara*",
    selector: 'select#negara2',
    selectorCertainty: "observed",
    optionValues: NEGARA2_PARTIAL_OPTIONS,
    optionValuesCertainty: "inferred",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — `select#negara2` exists with 200+ options; the diagnostic capped enumeration at 32 alphabetical entries. WeStamp's executor can re-enumerate at runtime if a non-default country code is required. Marked `inferred` until the full list is captured.",
  },
  {
    internalKey: "mobile",
    fieldKind: "text_input",
    portalFieldKey: "tb_telno",
    portalLabel: "No. Telefon*",
    selector: 'input#tb_telno',
    selectorCertainty: "observed",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "B9 live evidence — required phone input. The portal does not separate mobile vs landline; WeStamp's `mobile` value is written here.",
  },
  {
    internalKey: "phone",
    fieldKind: "text_input",
    portalFieldKey: null,
    portalLabel: null,
    selector: null,
    selectorCertainty: "unknown",
    optionValues: null,
    optionValuesCertainty: "unknown",
    roleScope: "shared",
    executable: false,
    note: "WeStamp models `phone` separately from `mobile`, but the live modal exposes only one phone field (`#tb_telno`). `phone` has no portal counterpart at this evidence level.",
  },
];

// ─── SSM company registry (still B8-evidence — not yet captured) ──

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
    roleScope: "shared",
    executable: false,
    note: "Free-text company name input. SSM modal not yet captured live — pending future milestone.",
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
    roleScope: "shared",
    executable: false,
    note: "ε-3 evidence — `tb_roc` is the old / pre-2017 ROC text input. SSM modal selector still pending live capture.",
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
    roleScope: "shared",
    executable: false,
    note: "ε-3 evidence — `tb_roc_new` is the new / post-2017 ROC text input. SSM modal selector still pending live capture.",
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
    roleScope: "shared",
    executable: false,
    note: "ε-3 evidence — `jenis_perniagaan` has 6 observed options but their codes were NOT captured. SSM modal selector still pending live capture.",
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
    roleScope: "shared",
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
    roleScope: "shared",
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
    optionValues: WARGA_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "Same enum as the individual-party `warga` field. SSM modal selector still pending live capture.",
  },
  {
    internalKey: "companyRepresentative.identityType",
    fieldKind: "radio_group",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Pengenalan (Wakil)",
    selector: null,
    selectorCertainty: "inferred",
    optionValues: NRIC_SUBTYPE_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "Inferred — same shape as individual identityType radio group.",
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
    roleScope: "shared",
    executable: false,
    note: "Free-text representative identity number.",
  },
  {
    internalKey: "companyRepresentative.nricSubType",
    fieldKind: "radio_group",
    portalFieldKey: "EPD_NOKP_TYPE",
    portalLabel: "Jenis Kad Pengenalan (Wakil)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: NRIC_SUBTYPE_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
    executable: false,
    note: "Same as individual NRIC sub-type.",
  },
  {
    internalKey: "companyRepresentative.gender",
    fieldKind: "radio_group",
    portalFieldKey: "USER_SEX",
    portalLabel: "Jantina (Wakil)",
    selector: null,
    selectorCertainty: "observed",
    optionValues: USER_SEX_OPTIONS,
    optionValuesCertainty: "observed",
    roleScope: "shared",
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

// ─── Modal triggers + buttons (B9 live evidence) ──────────────────

/**
 * Add-party trigger anchors observed inside each role's `<fieldset>`.
 * The live anchors are plain `<a>` tags with no `id`/`name`/`class`,
 * distinguished only by their text content. The executor must
 * resolve them by:
 *   1. scoping to the role's `<fieldset>` (the one containing the
 *      role heading, e.g. `MAKLUMAT PEMBERI SEWA / TUAN TANAH /
 *      LANDLORD`);
 *   2. matching the anchor's exact text content.
 *
 * Because the selector is text-scoped rather than id-based, we
 * record the trigger as a `BahagianAModalTrigger` with the
 * resolution algorithm in `selectorAlgorithm` rather than a single
 * CSS string. Future executor implementations should resolve via
 * Playwright's `locator(...).filter({ hasText })` chain.
 */
export interface BahagianAModalTrigger {
  /** Role whose modal this trigger opens. */
  role: "landlord" | "tenant";
  /** Type of party-add modal it opens. */
  partyType: "individual" | "company_ssm" | "company_non_ssm";
  /** Human-readable observed text. */
  textObserved: string;
  /**
   * Plain-language algorithm for resolving the trigger uniquely.
   * The executor implementation chooses how to translate this
   * (Playwright `filter` chain, manual DOM walk, etc.).
   */
  selectorAlgorithm: string;
  certainty: BahagianAFieldCertainty;
}

export const BAHAGIAN_A_MODAL_TRIGGERS: readonly BahagianAModalTrigger[] = Object.freeze([
  {
    role: "landlord",
    partyType: "individual",
    textObserved: "Individu",
    selectorAlgorithm: 'fieldset containing heading text matching /LANDLORD|PEMBERI SEWA|TUAN TANAH/i, then `a` with exact text "Individu"',
    certainty: "observed",
  },
  {
    role: "landlord",
    partyType: "company_ssm",
    textObserved: "Syarikat/Perniagaan/Agensi Berdaftar Dengan SSM",
    selectorAlgorithm: 'fieldset containing heading /LANDLORD|PEMBERI SEWA|TUAN TANAH/i, then `a` with exact text matching that label',
    certainty: "observed",
  },
  {
    role: "landlord",
    partyType: "company_non_ssm",
    textObserved: "Syarikat/Perniagaan/Agensi Tidak Berdaftar Dengan SSM",
    selectorAlgorithm: 'fieldset containing heading /LANDLORD|PEMBERI SEWA|TUAN TANAH/i, then `a` with exact text matching that label',
    certainty: "observed",
  },
  {
    role: "tenant",
    partyType: "individual",
    textObserved: "Individu",
    selectorAlgorithm: 'fieldset containing heading /TENANT|PENYEWA/i, then `a` with exact text "Individu"',
    certainty: "observed",
  },
  {
    role: "tenant",
    partyType: "company_ssm",
    textObserved: "Syarikat/Perniagaan/Agensi Berdaftar Dengan SSM",
    selectorAlgorithm: 'fieldset containing heading /TENANT|PENYEWA/i, then `a` with exact text matching that label',
    certainty: "observed",
  },
  {
    role: "tenant",
    partyType: "company_non_ssm",
    textObserved: "Syarikat/Perniagaan/Agensi Tidak Berdaftar Dengan SSM",
    selectorAlgorithm: 'fieldset containing heading /TENANT|PENYEWA/i, then `a` with exact text matching that label',
    certainty: "observed",
  },
]);

/**
 * Modal-level buttons. Captured live 2026-04-30 from the landlord
 * Tambah Individu modal.
 *
 * The save/Simpan selector is RECORDED but NEVER clicked by the
 * executor at the B9 evidence level — see
 * `tenancy-bahagian-a-executor-draft.ts` for the planned-only step.
 */
export const BAHAGIAN_A_MODAL_CLOSE_SELECTOR = "button.bootbox-close-button";

/**
 * Save button selector — DO NOT click in B9.
 *
 * The selector is broad on purpose (`input.btn` inside the modal).
 * The B9 live capture observed exactly one such Simpan button per
 * modal instance (text="Simpan"). The executor draft references
 * this constant only for `planned_only` step generation; tests
 * assert no test path invokes a click on this selector.
 */
export const BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9 =
  "input.btn"; // resolved to the Simpan button within the open modal

/** Tab anchor that reveals the Bahagian A section on the p5 form. */
export const BAHAGIAN_A_TAB_ANCHOR_TEXT = "Bahagian A";

// ─── Observed-but-unmapped fields ─────────────────────────────────

/**
 * Live B9 modal exposes additional fields WeStamp does not yet
 * model. Documented here so the next milestone can decide whether
 * to extend the data model. The executor must NOT silently fill
 * any of these — they remain operator-only until WeStamp captures
 * the corresponding internal-key value.
 */
export interface BahagianAObservedUnmappedField {
  portalFieldKey: string;
  portalLabel: string;
  selector: string;
  fieldKind: BahagianAFieldKind;
  /** Why it doesn't have an internal key yet. */
  reason: string;
}

export const BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS: readonly BahagianAObservedUnmappedField[] =
  Object.freeze([
    {
      portalFieldKey: "DSD_APPLY_DATE",
      portalLabel: "Tarikh Lahir*",
      selector: "input#DSD_APPLY_DATE",
      fieldKind: "text_input",
      reason:
        "Date of birth field, required for individual parties. WeStamp has no `dateOfBirth` field on `TenancyPortalParty` yet — capture is needed before the executor can run.",
    },
    {
      portalFieldKey: "negara1",
      portalLabel: "Negara Asal*",
      selector: "select#negara1",
      fieldKind: "select",
      reason:
        "Country-of-origin select. Visible only when `warga !== 1` (non-citizen / PR). WeStamp's `nationality` flag does not yet model country of origin.",
    },
    {
      portalFieldKey: "passportin",
      portalLabel: "No.Pasport*",
      selector: "input#passportin",
      fieldKind: "text_input",
      reason:
        "Passport number input, visible only when `warga !== 1`. WeStamp uses a single `identityNumber` for both NRIC and passport; the executor must route to the right field based on `identityType`.",
    },
    {
      portalFieldKey: "tb_alamat_3",
      portalLabel: "Alamat (baris 3)",
      selector: "input#tb_alamat_3",
      fieldKind: "text_input",
      reason:
        "Third address line. WeStamp's model only tracks two address lines.",
    },
    {
      portalFieldKey: "tb_email",
      portalLabel: "E-mail",
      selector: "input#tb_email",
      fieldKind: "text_input",
      reason:
        "Optional email input. WeStamp does not yet capture an email on `TenancyPortalParty`.",
    },
    {
      portalFieldKey: "tb_cukai_display",
      portalLabel: "TIN (display, readonly)",
      selector: 'input[name="tb_cukai_display"]',
      fieldKind: "text_input",
      reason:
        "Read-only mirror of the TIN value. The executor reads `tb_cukai` (editable input) and ignores this display field.",
    },
  ]);

// ─── Categorical summary ──────────────────────────────────────────

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
