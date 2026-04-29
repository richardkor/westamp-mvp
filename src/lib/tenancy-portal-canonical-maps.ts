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
 * Per-property-type label tables (`pds_harta_cat` is property-type
 * specific in the portal). For now, only Kediaman has WeStamp values
 * that can map; Perdagangan and Perindustrian have observed labels
 * but no WeStamp enum values that map cleanly, so any WeStamp value
 * applied to those property types yields `unsupported` until WeStamp
 * adds property-type-specific enums.
 *
 * Tables here record portal-side labels only; codes await evidence.
 */
const PERDAGANGAN_PORTAL_LABELS: ReadonlyArray<string> = [
  "Rumah Kedai",
  "Ruang Perniagaan",
  "Ruang Pejabat",
  "Kedai Pejabat",
];
const PERINDUSTRIAN_PORTAL_LABELS: ReadonlyArray<string> = [
  "Sesebuah",
  "Kembar",
  "Teres",
  "Bertingkat",
  "Banglo",
];

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
 * Evidence: the field-mapping run recorded `pds_salinan` as a 21-
 * option dropdown but did NOT enumerate the option codes / labels.
 * Until a future evidence pass records the option list, every
 * numeric input in 0..20 returns `unknown_code` — including
 * intuitively-familiar values like 1 or 2. Surface intuition does
 * NOT make a value safe; only the presence of an observed portal
 * `<option value>` code does, and none have been captured yet.
 * `unknown_code` remains readiness-blocking.
 *
 * Negative or non-integer or non-finite inputs are `unsupported`.
 * Counts above 20 are also `unsupported` — the dropdown's >20
 * option (if any) has not been characterized.
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
  // Known-unsupported beyond the 21-option range. The dropdown was
  // observed to have 21 options total ("likely 1–20 plus more-than-
  // 20" per the field-mapping report). We don't yet have the exact
  // option labels, so we conservatively treat counts >20 as
  // unsupported until the option list is captured.
  if (count > 20) {
    return {
      portalFieldKey,
      weStampValue: count,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `pds_salinan portal dropdown has 21 options (observed); WeStamp's duplicateCopies value ${count} exceeds the safely modelled range. Capture the >20 option label/code before mapping higher counts.`,
    };
  }
  // 0..20 — label and code both unknown until the option list is captured.
  return {
    portalFieldKey,
    weStampValue: count,
    portalLabel: null,
    portalCode: null,
    status: "unknown_code",
    reason: `pds_salinan option list (21 options) has not been captured during field mapping. WeStamp can name the duplicateCopies value (${count}) but cannot emit the matching portal <option value> until the dropdown's labels and codes are recorded.`,
  };
}

// ─── pds_harta_state ──────────────────────────────────────────────

/**
 * Seeded label-only entries for Malaysian states the pilot is
 * expected to encounter. Codes are NOT seeded — every entry status
 * is `unknown_code`. The list is intentionally small; it grows when
 * more states appear in real job data.
 *
 * Each entry's key is the normalized form of the state name. The
 * matcher normalizes the input identically before lookup.
 */
const STATE_LABELS_BY_NORMALIZED: ReadonlyMap<string, string> = new Map([
  ["KUALA LUMPUR", "Kuala Lumpur"],
  ["SELANGOR", "Selangor"],
  ["SARAWAK", "Sarawak"],
]);

/**
 * Map WeStamp's free-string property `state` to a portal
 * `pds_harta_state` option. Currently every recognized state returns
 * `unknown_code` because no portal codes have been captured.
 * Unrecognized states return `unsupported`.
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
        'Property state is blank. Capture a Malaysian state before pds_harta_state can be mapped.',
    };
  }
  const norm = normalize(trimmed);
  const portalLabel = STATE_LABELS_BY_NORMALIZED.get(norm) ?? null;
  if (portalLabel === null) {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Property state "${trimmed}" is not in WeStamp's seeded Malaysian-state list. Add it to the mapping table once a real job uses it.`,
    };
  }
  // Recognized — but we don't have the portal code yet.
  return {
    portalFieldKey,
    weStampValue: trimmed,
    portalLabel,
    portalCode: null,
    status: "unknown_code",
    reason: `pds_harta_state portal option-code list (17 options) has not been captured. WeStamp recognizes the label "${portalLabel}" but cannot emit a portal <option value> until the codes are observed.`,
  };
}

// ─── pds_harta_country ────────────────────────────────────────────

/**
 * Seeded country-label dictionary. Only Malaysia is seeded for now.
 * All other countries fall through to `unsupported` until added.
 */
const COUNTRY_LABELS_BY_NORMALIZED: ReadonlyMap<string, string> = new Map([
  ["MALAYSIA", "Malaysia"],
]);

/**
 * Map WeStamp's free-string property `country` to a portal
 * `pds_harta_country` option. Malaysia is recognized as a label;
 * its portal code is unknown so the result is `unknown_code`.
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
  const portalLabel = COUNTRY_LABELS_BY_NORMALIZED.get(norm) ?? null;
  if (portalLabel === null) {
    return {
      portalFieldKey,
      weStampValue: trimmed,
      portalLabel: null,
      portalCode: null,
      status: "unsupported",
      reason: `Property country "${trimmed}" is not in WeStamp's seeded country list. Add it to the mapping table once a real job uses it.`,
    };
  }
  return {
    portalFieldKey,
    weStampValue: trimmed,
    portalLabel,
    portalCode: null,
    status: "unknown_code",
    reason: `pds_harta_country portal option-code list (279 options) has not been captured. WeStamp recognizes the label "${portalLabel}" but cannot emit a portal <option value> until the codes are observed.`,
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
  // Mappable WeStamp value, label known, code unknown.
  return {
    portalFieldKey,
    weStampValue: wsValue,
    portalLabel,
    portalCode: null,
    status: "unknown_code",
    reason: `pds_harta_cat portal option-code list for Kediaman has not been captured. WeStamp recognizes the label "${portalLabel}" but cannot emit a portal <option value> until codes are observed.`,
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
      portalCode: null,
      status: "unknown_code",
      reason:
        'pds_harta_perabot portal option-code for "Dengan Perabot" has not been captured. WeStamp can name the value but cannot emit a portal <option value> until the code is observed.',
    };
  }
  if (wsValue === "unfurnished") {
    return {
      portalFieldKey,
      weStampValue: wsValue,
      portalLabel: "Tanpa Perabot",
      portalCode: null,
      status: "unknown_code",
      reason:
        'pds_harta_perabot portal option-code for "Tanpa Perabot" has not been captured. WeStamp can name the value but cannot emit a portal <option value> until the code is observed.',
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
