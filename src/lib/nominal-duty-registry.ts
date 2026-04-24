/**
 * WeStamp — Nominal Fixed-Duty Registry
 *
 * Small, explicit registry of document categories that WeStamp treats
 * as "nominal / fixed-duty candidates handled via an assisted operator
 * path" — the curated non-tenancy lane.
 *
 * This registry exists so non-tenancy categories that an operator can
 * carry end-to-end through e-Duti Setem manually (for a likely
 * fixed-duty instrument) share ONE handling model, instead of each
 * category being a one-off special case in the operator UI.
 *
 * What this registry is NOT:
 *   - It is NOT an automation framework. None of these categories are
 *     driven through WeStamp's submission/payment/certificate flow.
 *   - It is NOT a duty calculator. The "nominal/fixed-duty" framing is
 *     a *likely* profile — every entry still requires the operator to
 *     confirm the duty against the live portal and the document.
 *   - It does NOT reuse sewa_pajakan advisory evidence. The Proven
 *     Hantar Gate Chain, lane readiness gates, and Bahagian C
 *     preflights are sewa_pajakan-only and do not apply to anything
 *     in this registry.
 *   - It does NOT reopen OCR/extraction. Entries are classified by
 *     the uploader's declared category, then confirmed by the operator.
 *
 * Adding a new entry:
 *   1. Add the `DocumentCategory` key (defined in `stamping-types.ts`).
 *   2. Provide the six fields below.
 *   3. Update the SOP and operator checklist to list the new example.
 *   4. Do not reuse this registry to imply automation or guaranteed
 *      duty treatment.
 */

import type { DocumentCategory } from "./stamping-types";

/**
 * Shared note about why sewa_pajakan portal evidence does not apply to
 * these categories. Kept as a single constant so UI and docs cannot
 * drift on the separation rule.
 */
export const NOMINAL_DUTY_SEWA_PAJAKAN_SEPARATION_NOTE =
  "The Proven Hantar Gate Chain, lane-specific readiness gates, and " +
  "Bahagian C preflight panels on WeStamp cover the sewa_pajakan " +
  "tenancy lane only. Nominal-duty categories are taken through " +
  "e-Duti Setem manually by the operator.";

export interface NominalDutyRegistryEntry {
  /** Document category key (matches `DocumentCategory`). */
  categoryKey: DocumentCategory;
  /** Internal, operator-facing display label for the panel heading. */
  internalLabel: string;
  /** Handling mode label shown in the operator panel's first row. */
  handlingModeLabel: string;
  /** Duty profile label shown in the operator panel. Must be tentative. */
  dutyFramingLabel: string;
  /**
   * Items the operator must personally verify before any portal work.
   * Each bullet is a full operator-visible sentence.
   */
  operatorConfirmationBullets: readonly string[];
  /**
   * Conditions that should stop the operator and trigger user contact
   * (or internal escalation) instead of proceeding.
   */
  stopTriggers: readonly string[];
}

// ── Registry entries ─────────────────────────────────────────────────

const EMPLOYMENT_CONTRACT_ENTRY: NominalDutyRegistryEntry = {
  categoryKey: "employment_contract",
  internalLabel: "Employment Contract",
  handlingModeLabel: "Assisted operator handling",
  dutyFramingLabel: "Likely nominal/fixed-duty document (operator to confirm)",
  operatorConfirmationBullets: [
    "The uploaded PDF is in fact an employment contract — not a " +
      "tenancy, service, secondment, internship, or consultancy " +
      "agreement misfiled under this category.",
    "The PDF is signed and complete enough to proceed (signatures, " +
      "dates, and party details present).",
    "Nothing about the instrument suggests it should be treated as " +
      "a different category or duty treatment before any portal " +
      "work begins.",
  ],
  stopTriggers: [
    "The category looks wrong or the document is a mixed instrument.",
    "The PDF is unsigned, redacted, illegible, or obviously incomplete.",
    "The operator cannot confidently confirm the instrument type.",
  ],
};

// Statutory Declaration (Surat Akuan Berkanun).
// Admitted 2026-04-23 under `docs/nominal-duty-admission-rules.md`:
//   §2.1 identifiability — carries a standard "Statutory Declaration"
//        / "Surat Akuan Berkanun" title block and a Commissioner for
//        Oaths attestation block.
//   §2.2 confirm/stop — title check + attestation-block check +
//        execution check; stop triggers are directly PDF-checkable.
//   §2.3 assisted-path fit — no calculator, no backend logic, manual
//        handling in e-Duti Setem.
//   §2.4 sewa_pajakan independence — no reuse of tenancy evidence.
//   §2.5–§2.7 — duty class does not depend on value or consideration;
//        standard "Likely nominal/fixed-duty" framing holds.
// Duty is confirmed by the operator against the live portal and the
// document itself. Nothing here is a duty promise.
const STATUTORY_DECLARATION_ENTRY: NominalDutyRegistryEntry = {
  categoryKey: "statutory_declaration",
  internalLabel: "Statutory Declaration",
  handlingModeLabel: "Assisted operator handling",
  dutyFramingLabel: "Likely nominal/fixed-duty document (operator to confirm)",
  operatorConfirmationBullets: [
    "The uploaded PDF is titled as, and structured as, a Statutory " +
      "Declaration (Surat Akuan Berkanun) — not an affidavit, a " +
      "witness statement, a letter, or a different instrument " +
      "misfiled under this category.",
    "The standard Commissioner for Oaths attestation block is " +
      "present, signed by the Commissioner, and dated.",
    "The declaration is fully executed by the declarant (declarant " +
      "signature and date present), not a draft or a partially " +
      "completed template.",
    "Nothing in the body of the declaration suggests it should be " +
      "treated as a different kind of instrument (for example, a " +
      "contract, deed, assignment, or transfer dressed up with a " +
      "declaration block).",
  ],
  stopTriggers: [
    "The document is not titled or structured as a Statutory " +
      "Declaration / Surat Akuan Berkanun.",
    "The Commissioner for Oaths attestation block is absent, " +
      "incomplete, or unsigned.",
    "The declarant has not signed, the declaration is undated, or " +
      "the document is clearly a draft or template.",
    "The operator cannot confidently confirm the instrument type " +
      "from the face of the document.",
  ],
};

/**
 * Ordered registry of nominal-duty categories. Only categories whose
 * handling has been deliberately approved should appear here.
 */
const NOMINAL_DUTY_REGISTRY: readonly NominalDutyRegistryEntry[] = [
  EMPLOYMENT_CONTRACT_ENTRY,
  STATUTORY_DECLARATION_ENTRY,
];

// ── Public helpers ───────────────────────────────────────────────────

/**
 * Returns the registry entry for a document category, or `null` if
 * the category is not part of the nominal-duty assisted path.
 *
 * Accepts a plain `string | null | undefined` because some call sites
 * (job DTOs on the hosted pages) hold `documentCategory` as `string`
 * rather than the strict `DocumentCategory` union. The comparison is
 * a safe runtime `.find` against the known registry keys, so unknown
 * strings simply return `null`.
 */
export function getNominalDutyEntry(
  category: string | null | undefined
): NominalDutyRegistryEntry | null {
  if (!category) return null;
  return (
    NOMINAL_DUTY_REGISTRY.find((entry) => entry.categoryKey === category) ??
    null
  );
}

/**
 * Whether a document category is part of the nominal-duty assisted path.
 */
export function isNominalDutyCategory(
  category: string | null | undefined
): boolean {
  return getNominalDutyEntry(category) !== null;
}

/**
 * Full registry, for docs/tests that want to enumerate supported
 * nominal-duty categories. Do not mutate.
 */
export function listNominalDutyEntries(): readonly NominalDutyRegistryEntry[] {
  return NOMINAL_DUTY_REGISTRY;
}
