/**
 * WeStamp — Tenancy Portal Canonical Mapping Helpers (Milestone A3)
 *
 * Pure, framework-free deterministic mappers between WeStamp's
 * internal enum / value space and the e-Duti Setem Sewa/Pajakan
 * portal's `<select>`-option value space, for the five enum / canonical
 * fields the 2026-04-28 ε-3 field-mapping run identified as enum-
 * mismatch blockers:
 *
 *   - pds_salinan        (number-of-copies dropdown)
 *   - pds_harta_state    (property state dropdown)
 *   - pds_harta_country  (property country dropdown)
 *   - pds_harta_cat      (per-property-type category dropdown)
 *   - pds_harta_perabot  (furnishing dropdown)
 *
 * What this module IS
 * ───────────────────
 * - A pure, side-effect-free mapping layer. Safe to call from server
 *   components, API routes, the payload compiler, and the readiness
 *   gap evaluator. No `fetch`, no DOM, no Playwright dependency.
 * - The single source of truth for whether a WeStamp value is safe to
 *   emit to the portal as a `<select>` choice. Every result carries
 *   an explicit `status` of `mapped | unknown_code | unsupported |
 *   ambiguous` plus a human-readable reason.
 * - Conservative by design: codes are NEVER guessed. A label may be
 *   recorded (because it was observed during the field-mapping run)
 *   while the portal `<option value>` code remains null until a
 *   future live-walk records it.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT drive the portal.
 * - It does NOT call any HTTP endpoint, replay any HAR-derived
 *   request, or read cookies / tokens / `lhdnmsstoken`.
 * - It does NOT silently coerce unsupported values to a "best fit"
 *   portal option.
 * - It does NOT log raw `href`, raw role/firm IDs, or any sensitive
 *   value.
 *
 * Evidence basis
 * ──────────────
 * Every seeded label below comes from the 2026-04-28 ε-3 supervised
 * field-mapping run — see `docs/2026-04-28-tenancy-portal-field-
 * mapping.md` §4.8 and §7. Portal `<option value>` codes were NOT
 * captured during that run for any of the five fields modelled here;
 * therefore every entry's `portalCode` is null and `status` is
 * `unknown_code` until a future evidence pass upgrades it.
 *
 * Future evidence-driven upgrades replace `code: null` with the
 * observed code and flip `status` to `"mapped"` — no other changes
 * are required at the call sites.
 */

import type {
  TenancyPortalBuildingType,
  TenancyPortalFurnishedStatus,
  TenancyPortalPropertyType,
} from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Mapping confidence / status, in increasing order of safety:
 *   - `unsupported`   — there is no portal equivalent for this WeStamp
 *                       value and there cannot be without portal-side
 *                       changes (e.g. partially_furnished).
 *   - `ambiguous`     — multiple portal options could plausibly apply
 *                       and operator confirmation is needed before
 *                       any click.
 *   - `unknown_code`  — the portal label is known (observed during
 *                       field mapping) but the portal `<option value>`
 *                       code has NOT yet been captured. Safe to
 *                       describe to the operator; NOT safe to emit
 *                       to the portal yet.
 *   - `mapped`        — both portal label and portal code are known
 *                       and the value is supported. Safe to use.
 */
export type CanonicalMappingStatus =
  | "mapped"
  | "unknown_code"
  | "unsupported"
  | "ambiguous";

/**
 * One canonical mapping result. Always carries the WeStamp input
 * value, a stable portal field key, and a status. `portalLabel` and
 * `portalCode` may be null depending on status.
 */
export interface CanonicalMappingResult<TWeStampValue> {
  /**
   * Portal field name (e.g. `"pds_harta_cat"`). Stable string —
   * useful for diagnostics and for the payload preview.
   */
  portalFieldKey: string;
  /** The WeStamp input value passed in. */
  weStampValue: TWeStampValue;
  /**
   * The portal-side label for this option (e.g. `"Teres"`). Null
   * when the WeStamp value has no portal equivalent (`unsupported`)
   * or when the input is unrecognised.
   */
  portalLabel: string | null;
  /**
   * The portal `<option value>` code (e.g. `"1113"`). Null when not
   * yet observed (`unknown_code`), or when there is no equivalent
   * (`unsupported`), or when the choice is ambiguous.
   */
  portalCode: string | null;
  status: CanonicalMappingStatus;
  /**
   * Stable human-readable explanation for the status. Always
   * non-null when `status !== "mapped"`. Suitable for surfacing in
   * the operator UI without further wrapping.
   */
  reason: string | null;
}

/** WeStamp building-type values that have a Kediaman portal label. */
const KEDIAMAN_LABEL_BY_WESTAMP_VALUE: Partial<
  Record<TenancyPortalBuildingType, string>
> = {
  // Field-mapping evidence: Kediaman has 8 portal options observed
  // (kembar, teres, kondominium, pangsapuri, sesebuah, rumah_pangsa,
  // kluster, townhouse). We map only the WeStamp values that have a
  // direct portal equivalent. WeStamp values with no direct match
  // (rumah_banglo on kediaman, studio, lain_lain) deliberately fall
  // through and yield `unsupported` / `ambiguous`.
  rumah_teres: "Teres",
  rumah_berkembar: "Kembar",
  rumah_kluster: "Kluster",
  townhouse: "Townhouse",
  kondominium: "Kondominium",
};

/**
 * Kediaman portal `<option value>` codes for the mappable WeStamp
 * values, recovered by the ε-4 audit (2026-04-29) from the original
 * ε-3 supervised field-mapping run output. See
 * `docs/2026-04-28-tenancy-portal-field-mapping.md` §8.1.
 *
 * Only the WeStamp values that have a direct Kediaman portal
 * equivalent are recorded here. `apartment` is intentionally NOT
 * mapped to `Pangsapuri` (1115) — the field-mapping run did not
 * confirm the semantic mapping, so it remains `ambiguous` until
 * operator confirmation. `studio` / `lain_lain` / `rumah_banglo`
 * remain `unsupported`.
 */
const KEDIAMAN_PORTAL_CODE_BY_WESTAMP_VALUE: Partial<
  Record<TenancyPortalBuildingType, string>
> = {
  rumah_berkembar: "1112",
  rumah_teres: "1113",
  kondominium: "1114",
  rumah_kluster: "1118",
  townhouse: "1119",
};

/**
 * Per-property-type code tables (`pds_harta_cat` is property-type
 * specific in the portal). Recovered by the ε-4 audit from the ε-3
 * field-mapping run output (`docs/2026-04-28-tenancy-portal-field-
 * mapping.md` §8.1–§8.3).
 *
 * **Important:** integer codes are scoped per `<select>` element and
 * are NOT globally unique. `1119` is `Townhouse` under Kediaman but
 * `Kedai Pejabat` under Perdagangan and `Sesebuah` under
 * Perindustrian. The mapper dispatches by `propertyType` before
 * resolving codes; never reuse codes across property types.
 *
 * Perdagangan / Perindustrian tables are recorded for future
 * reference. WeStamp's `TenancyPortalBuildingType` enum has no value
 * that maps cleanly into either, so applying any WeStamp value with
 * `propertyType ∈ {perdagangan, perindustrian}` still returns
 * `unsupported` until property-type-specific enums are added.
 */
const PERDAGANGAN_PORTAL_LABEL_BY_CODE: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: "1116", label: "Rumah Kedai" },
  { code: "1117", label: "Ruang Perniagaan" },
  { code: "1118", label: "Ruang Pejabat" },
  { code: "1119", label: "Kedai Pejabat" },
];
const PERDAGANGAN_PORTAL_LABELS: ReadonlyArray<string> =
  PERDAGANGAN_PORTAL_LABEL_BY_CODE.map((e) => e.label);

const PERINDUSTRIAN_PORTAL_LABEL_BY_CODE: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: "1119", label: "Sesebuah" },
  { code: "1120", label: "Kembar" },
  { code: "1121", label: "Teres" },
  { code: "1122", label: "Bertingkat (Flatted)" },
  { code: "1123", label: "Banglo" },
];
const PERINDUSTRIAN_PORTAL_LABELS: ReadonlyArray<string> =
  PERINDUSTRIAN_PORTAL_LABEL_BY_CODE.map((e) => e.label);

/**
 * `pds_harta_perabot` portal `<option value>` codes recovered by the
 * ε-4 audit from the ε-3 field-mapping run output
 * (`docs/2026-04-28-tenancy-portal-field-mapping.md` §8.4).
 *
 * The portal exposes only two real options; `partially_furnished`
 * has no portal equivalent and remains `unsupported`.
 */
const FURNISHED_PORTAL_CODE_BY_WESTAMP_VALUE: Partial<
  Record<TenancyPortalFurnishedStatus, string>
> = {
  fully_furnished: "1122",
  unfurnished: "1123",
};

// ─── Helpers ───────────────────────────────────────────────────────

const trim = (v: string | null | undefined): string =>
  typeof v === "string" ? v.trim() : "";

const normalize = (v: string | null | undefined): string =>
  trim(v).replace(/\s+/g, " ").toUpperCase();

// ─── pds_salinan ───────────────────────────────────────────────────

/**
 * Map WeStamp's `duplicateCopies` (a non-negative integer) to a
 * portal `pds_salinan` `<select>` option.
 *
 * Evidence (ε-4b live read-only capture, 2026-04-29 — see
 * `docs/2026-04-28-tenancy-portal-field-mapping.md` §9.1): the
 * dropdown is a direct integer ladder of 21 options — values
 * `"0".."20"`, labels identical to values. There is no placeholder
 * and no >20 sentinel.
 *
 * Therefore:
 *   - 0..20 → `mapped`, `portalCode = String(count)`,
 *     `portalLabel = String(count)`.
 *   - >20 → `unsupported` (dropdown has no option above 20; portals
 *     with >20 copies are out of the modelled range).
 *   - Negative, non-integer, or non-finite → `unsupported`.
 */
export function mapDuplicateCopies(
  count: unknown
): CanonicalMappingResult<unknown> {
  const portalFieldKey = "pds_salinan";
  if (
    typeof count !== "number" ||
    !Number.isFinite(count) ||
    !Number.isInteger(count) ||
    count < 0
  ) {
    return {
      portalFieldKey,
      weStampValue: count,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        'pds_salinan ("Salinan Pendua") expects a non-negative integer count. The supplied value is not a non-negative integer and cannot be mapped to a portal option.',
    };
  }
  // Outside the captured 0..20 range — the dropdown has no >20
  // option (confirmed by ε-4b), so counts above 20 are unsupported.
  if (count > 20) {
    return {
      portalFieldKey,
      weStampValue: count,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `pds_salinan portal dropdown exposes 21 options (0..20). WeStamp's duplicateCopies value ${count} exceeds the dropdown's range — there is no >20 option to select.`,
    };
  }
  // 0..20 — direct integer mapping captured in ε-4b.
  const code = String(count);
  return {
    portalFieldKey,
    weStampValue: count,
    portalLabel: code,
    portalCode: code,
    status: "mapped",
    reason: null,
  };
}

// ─── pds_harta_state ──────────────────────────────────────────────

/**
 * One captured portal-state entry: portal label + portal code.
 * Multiple operator-input aliases can map to the same entry — the
 * three Federal Territories accept both their colloquial short form
 * (e.g. "Kuala Lumpur") and the full portal label form
 * (e.g. "Wilayah Persekutuan Kuala Lumpur").
 */
interface StateEntry {
  portalLabel: string;
  portalCode: string;
}

/**
 * Seeded operator-input → portal-entry table for `pds_harta_state`.
 *
 * Evidence (ε-4b live read-only capture, 2026-04-29 — see
 * `docs/2026-04-28-tenancy-portal-field-mapping.md` §9.2): the
 * portal exposes 16 selectable options (codes "1".."16") plus a
 * placeholder. All 16 are seeded with their captured codes.
 *
 * Aliases:
 *   - "Penang" → resolves to "Pulau Pinang" (code "9").
 *   - "Kuala Lumpur" / "WP Kuala Lumpur" → resolve to
 *     "Wilayah Persekutuan Kuala Lumpur" (code "14").
 *   - "Labuan" / "WP Labuan" → "Wilayah Persekutuan Labuan" ("15").
 *   - "Putrajaya" / "WP Putrajaya" → "Wilayah Persekutuan Putrajaya"
 *     ("16").
 *
 * Keys are stored in normalized form (uppercase, whitespace
 * collapsed) so `normalizeForMatch(input)` is a direct lookup.
 */
const STATE_ENTRY_BY_NORMALIZED_INPUT: ReadonlyMap<string, StateEntry> =
  new Map([
    // Eleven ordinary Malaysian states — operator input is the
    // portal label.
    ["JOHOR", { portalLabel: "Johor", portalCode: "1" }],
    ["KEDAH", { portalLabel: "Kedah", portalCode: "2" }],
    ["KELANTAN", { portalLabel: "Kelantan", portalCode: "3" }],
    ["MELAKA", { portalLabel: "Melaka", portalCode: "4" }],
    ["NEGERI SEMBILAN", { portalLabel: "Negeri Sembilan", portalCode: "5" }],
    ["PAHANG", { portalLabel: "Pahang", portalCode: "6" }],
    ["PERAK", { portalLabel: "Perak", portalCode: "7" }],
    ["PERLIS", { portalLabel: "Perlis", portalCode: "8" }],
    ["PULAU PINANG", { portalLabel: "Pulau Pinang", portalCode: "9" }],
    // Penang alias → Pulau Pinang.
    ["PENANG", { portalLabel: "Pulau Pinang", portalCode: "9" }],
    ["SABAH", { portalLabel: "Sabah", portalCode: "10" }],
    ["SARAWAK", { portalLabel: "Sarawak", portalCode: "11" }],
    ["SELANGOR", { portalLabel: "Selangor", portalCode: "12" }],
    ["TERENGGANU", { portalLabel: "Terengganu", portalCode: "13" }],
    // Federal Territories — accept both colloquial and full forms.
    [
      "KUALA LUMPUR",
      {
        portalLabel: "Wilayah Persekutuan Kuala Lumpur",
        portalCode: "14",
      },
    ],
    [
      "WP KUALA LUMPUR",
      {
        portalLabel: "Wilayah Persekutuan Kuala Lumpur",
        portalCode: "14",
      },
    ],
    [
      "WILAYAH PERSEKUTUAN KUALA LUMPUR",
      {
        portalLabel: "Wilayah Persekutuan Kuala Lumpur",
        portalCode: "14",
      },
    ],
    [
      "LABUAN",
      { portalLabel: "Wilayah Persekutuan Labuan", portalCode: "15" },
    ],
    [
      "WP LABUAN",
      { portalLabel: "Wilayah Persekutuan Labuan", portalCode: "15" },
    ],
    [
      "WILAYAH PERSEKUTUAN LABUAN",
      { portalLabel: "Wilayah Persekutuan Labuan", portalCode: "15" },
    ],
    [
      "PUTRAJAYA",
      { portalLabel: "Wilayah Persekutuan Putrajaya", portalCode: "16" },
    ],
    [
      "WP PUTRAJAYA",
      { portalLabel: "Wilayah Persekutuan Putrajaya", portalCode: "16" },
    ],
    [
      "WILAYAH PERSEKUTUAN PUTRAJAYA",
      { portalLabel: "Wilayah Persekutuan Putrajaya", portalCode: "16" },
    ],
  ]);

/**
 * Map WeStamp's free-string property `state` to a portal
 * `pds_harta_state` option. After ε-4b, all 16 captured states
 * return `mapped` with the captured portal label + code. Aliases
 * (Penang, Kuala Lumpur, etc.) resolve to the canonical portal
 * label. Unrecognized inputs return `unsupported`.
 */
export function mapPropertyState(
  state: string | null | undefined
): CanonicalMappingResult<string> {
  const portalFieldKey = "pds_harta_state";
  const trimmed = trim(state);
  if (trimmed === "") {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        "Property state is blank. Capture a Malaysian state before pds_harta_state can be mapped.",
    };
  }
  const norm = normalize(trimmed);
  const entry = STATE_ENTRY_BY_NORMALIZED_INPUT.get(norm) ?? null;
  if (entry === null) {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Property state "${trimmed}" is not in WeStamp's captured Malaysian-state list (16 portal options + accepted aliases). Add it to the mapping table once a real job uses it.`,
    };
  }
  return {
    portalFieldKey,
    weStampValue: trimmed,
    portalLabel: entry.portalLabel,
    portalCode: entry.portalCode,
    status: "mapped",
    reason: null,
  };
}

// ─── pds_harta_country ────────────────────────────────────────────

/**
 * Captured country entry: portal label + portal code. Mirrors the
 * `StateEntry` shape so the helper code paths stay parallel.
 */
interface CountryEntry {
  portalLabel: string;
  portalCode: string;
}

/**
 * Seeded country dictionary keyed by normalized operator input.
 *
 * Evidence (ε-4b live read-only capture, 2026-04-29 — see
 * `docs/2026-04-28-tenancy-portal-field-mapping.md` §9.3): the
 * portal exposes 279 country options. Only Malaysia is seeded here;
 * the portal label is uppercase as exposed by the portal (`MALAYSIA`).
 *
 * All other countries fall through to `unsupported` until they are
 * specifically captured in a future evidence pass.
 */
const COUNTRY_ENTRY_BY_NORMALIZED_INPUT: ReadonlyMap<string, CountryEntry> =
  new Map([
    ["MALAYSIA", { portalLabel: "MALAYSIA", portalCode: "146" }],
  ]);

/**
 * Map WeStamp's free-string property `country` to a portal
 * `pds_harta_country` option. After ε-4b, Malaysia returns
 * `mapped` with the captured code "146". Other countries return
 * `unsupported`.
 */
export function mapPropertyCountry(
  country: string | null | undefined
): CanonicalMappingResult<string> {
  const portalFieldKey = "pds_harta_country";
  const trimmed = trim(country);
  if (trimmed === "") {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        "Property country is blank. Capture a country before pds_harta_country can be mapped.",
    };
  }
  const norm = normalize(trimmed);
  const entry = COUNTRY_ENTRY_BY_NORMALIZED_INPUT.get(norm) ?? null;
  if (entry === null) {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Property country "${trimmed}" is not in WeStamp's seeded country list (Malaysia only at this milestone). Add it to the mapping table once a real job uses it.`,
    };
  }
  return {
    portalFieldKey,
    weStampValue: trimmed,
    portalLabel: entry.portalLabel,
    portalCode: entry.portalCode,
    status: "mapped",
    reason: null,
  };
}

// ─── pds_harta_cat (property-type-specific) ──────────────────────

/**
 * Property-category mapping. The portal exposes a different option
 * list per `pds_harta_type` (Kediaman / Perdagangan / Perindustrian);
 * WeStamp's `TenancyPortalBuildingType` enum is currently kediaman-
 * style only, so values applied to Perdagangan or Perindustrian
 * yield `unsupported` until WeStamp adds property-type-specific
 * enums.
 *
 * Within Kediaman:
 *   - 5 WeStamp values (rumah_teres, rumah_berkembar, rumah_kluster,
 *     townhouse, kondominium) map to known portal labels (codes
 *     unknown).
 *   - `apartment` maps ambiguously — the closest portal label is
 *     "Pangsapuri" but the field-mapping run did not confirm the
 *     mapping. Operator confirmation needed.
 *   - `studio` and `lain_lain` have no portal equivalent.
 *   - `rumah_banglo` on Kediaman has no portal equivalent (Banglo
 *     exists only under Perindustrian per the observed option list).
 *
 * Tanah Kosong does not have a category dropdown; passing it always
 * returns `mapped` with null label/code (it is a valid no-op).
 */
export function mapPropertyCategory(
  propertyType: TenancyPortalPropertyType | null | undefined,
  buildingType: TenancyPortalBuildingType | null | undefined
): CanonicalMappingResult<TenancyPortalBuildingType | null> {
  const portalFieldKey = "pds_harta_cat";
  const wsValue = (buildingType ?? null) as TenancyPortalBuildingType | null;

  if (propertyType === "tanah_kosong") {
    // No category dropdown for empty land. Treat as mapped so the
    // caller doesn't fire a blocker — there's nothing to send.
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "mapped",
      reason: null,
    };
  }

  // Without a property type, we can't decide which option list applies.
  if (
    propertyType !== "kediaman" &&
    propertyType !== "perdagangan" &&
    propertyType !== "perindustrian"
  ) {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        "pds_harta_type (property type) must be selected before pds_harta_cat can be mapped — it is property-type specific.",
    };
  }

  if (propertyType === "perdagangan" || propertyType === "perindustrian") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Property type "${propertyType}" requires a per-property-type pds_harta_cat selection (e.g. ${
        propertyType === "perdagangan"
          ? PERDAGANGAN_PORTAL_LABELS.join(" / ")
          : PERINDUSTRIAN_PORTAL_LABELS.join(" / ")
      }). WeStamp's TenancyPortalBuildingType enum is kediaman-style only — no model coverage for these categories.`,
    };
  }

  // propertyType === "kediaman" beyond this point.
  if (wsValue === null) {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        "Building type (Jenis Bangunan) is required when pds_harta_type = Kediaman.",
    };
  }
  if (wsValue === "studio") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        'Building type "studio" is not supported by the portal Kediaman pds_harta_cat dropdown. Portal Kediaman dropdown has no "Studio" option.',
    };
  }
  if (wsValue === "lain_lain") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        'Building type "lain_lain" is not supported by the portal Kediaman pds_harta_cat dropdown. Operator must pick one of the 8 fixed kediaman options.',
    };
  }
  if (wsValue === "apartment") {
    // Closest portal label is "Pangsapuri" but the field-mapping run
    // did not confirm the mapping. We surface it as ambiguous so the
    // operator must explicitly confirm.
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "ambiguous",
      reason:
        'Building type "apartment" is ambiguous on Kediaman — closest portal option is "Pangsapuri" but the mapping was not confirmed during field mapping. Operator confirmation required before mapping.',
    };
  }
  if (wsValue === "rumah_banglo") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        'Building type "rumah_banglo" has no Kediaman portal equivalent — "Banglo" appears only under Perindustrian. Reclassify the property type or capture an evidence-backed Kediaman mapping.',
    };
  }

  const portalLabel = KEDIAMAN_LABEL_BY_WESTAMP_VALUE[wsValue] ?? null;
  if (portalLabel === null) {
    // Defensive fallback — should only trigger for any future
    // TenancyPortalBuildingType value not handled above.
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Building type "${wsValue}" has no observed portal Kediaman mapping. Add it to the seeded mapping table once evidence is captured.`,
    };
  }
  // Look up the portal `<option value>` code recovered by ε-4. If
  // the code is seeded for this WeStamp value, status is `mapped`;
  // otherwise (a future label-only entry without code yet), status
  // remains `unknown_code`.
  const portalCode = KEDIAMAN_PORTAL_CODE_BY_WESTAMP_VALUE[wsValue] ?? null;
  if (portalCode === null) {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel,
      portalCode: null,
      status: "unknown_code",
      reason: `pds_harta_cat portal option-code for Kediaman label "${portalLabel}" has not been captured. WeStamp recognizes the label but cannot emit a portal <option value> until the code is observed.`,
    };
  }
  return {
    portalFieldKey,
    weStampValue: wsValue,
    portalLabel,
    portalCode,
    status: "mapped",
    reason: null,
  };
}

// ─── pds_harta_perabot (furnishing) ──────────────────────────────

/**
 * Map WeStamp's `furnishedStatus` to a portal `pds_harta_perabot`
 * option.
 *
 * Evidence: portal exposes only "Dengan Perabot" (≈ fully_furnished)
 * and "Tanpa Perabot" (≈ unfurnished) per the field-mapping run.
 * `partially_furnished` has no portal equivalent — explicitly
 * unsupported. Codes are unknown until captured.
 */
export function mapFurnishedStatus(
  status: TenancyPortalFurnishedStatus | null | undefined
): CanonicalMappingResult<TenancyPortalFurnishedStatus | null> {
  const portalFieldKey = "pds_harta_perabot";
  const wsValue = status ?? null;

  if (wsValue === null) {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        "Furnishing status is required by pds_harta_perabot. Capture furnished or unfurnished before mapping.",
    };
  }
  if (wsValue === "partially_furnished") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason:
        'Furnished status "partially_furnished" is not supported by the portal — pds_harta_perabot exposes only "Dengan Perabot" (fully_furnished) and "Tanpa Perabot" (unfurnished). There is no half-way option to map to.',
    };
  }
  if (wsValue === "fully_furnished") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: "Dengan Perabot",
      portalCode: FURNISHED_PORTAL_CODE_BY_WESTAMP_VALUE.fully_furnished ?? null,
      status: "mapped",
      reason: null,
    };
  }
  if (wsValue === "unfurnished") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: "Tanpa Perabot",
      portalCode: FURNISHED_PORTAL_CODE_BY_WESTAMP_VALUE.unfurnished ?? null,
      status: "mapped",
      reason: null,
    };
  }
  // Defensive fallback — never reached in current type space.
  return {
    portalFieldKey,
    weStampValue: wsValue,
    portalLabel: null,
    portalCode: null,
    status: "unsupported",
    reason: `Furnished status "${wsValue}" is not recognized by WeStamp's mapping table.`,
  };
}

// ─── Convenience predicates ───────────────────────────────────────

/**
 * Convenience for the readiness gate: a mapping is "safe to use"
 * only when status is `"mapped"`. Every other status (including
 * `unknown_code`) is unsafe to emit to the portal.
 */
export function isMappingSafe(
  result: CanonicalMappingResult<unknown>
): boolean {
  return result.status === "mapped";
}
