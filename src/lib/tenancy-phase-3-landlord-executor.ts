/**
 * WeStamp — Tenancy Supervised Run · Phase 3 Landlord-Individual Row Executor
 * (Milestone B10 · SECOND mutation milestone)
 *
 * Tightly-scoped, fail-closed-by-default helper that performs the
 * **single** controlled portal mutation authorised by Milestone B10:
 *   - navigate to the Bahagian A tab on the live Sewa/Pajakan p5 form
 *   - capture the pre-save landlord row count
 *   - open the Tambah Individu modal scoped to the LANDLORD fieldset
 *   - fill the captured landlord-individual party fields
 *   - click the modal Simpan button exactly once
 *   - verify the landlord row count climbed by exactly 1
 *   - stop
 *
 * What this module IS / IS NOT
 * ────────────────────────────
 * - IS: pure executor over a structural `Phase3PageLike` /
 *   `Phase3LocatorLike` interface; testable without a real browser.
 * - IS NOT: anything Bahagian B / C / Lampiran / Perakuan / Hantar /
 *   payment / certificate / OCR / user-review related. The executor
 *   never touches selectors outside the tab anchor, the landlord
 *   trigger, the modal field surface, the modal Simpan button, and
 *   the landlord-table row counter.
 * - DOES NOT save tenant rows, company rows, or any subsequent party.
 *
 * Sensitive-data policy
 * ─────────────────────
 * Per the working-style update, the executor MAY accept actual
 * captured party VALUES from the operator's job record (name, IC,
 * address, etc.) — those are the operator's own internal data feeding
 * into the live form. The result the executor RETURNS is sanitized:
 * stable enums, ISO timestamps, path-shape enums, sanitized
 * row-count integers, optional `failedFieldKey` from a closed enum.
 * The result NEVER stores raw URLs, hrefs, cookies, tokens,
 * `lhdnmsstoken`, raw HTML, exception text, party VALUES echoed
 * back, or uploaded document content.
 */

import {
  classifySupervisedSessionPath,
  type SupervisedSessionPathKind,
} from "./tenancy-supervised-session-path";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  BAHAGIAN_A_INDIVIDUAL_REGISTRY,
  BAHAGIAN_A_TAB_ANCHOR_TEXT,
} from "./tenancy-bahagian-a-field-mapping";
import type { StampingJob, TenancyPortalParty } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

/** Top-level execution status. */
export type Phase3LandlordExecutionStatus =
  | "not_attempted"
  | "refused"
  | "started"
  | "saved"
  | "failed";

/**
 * Stable, machine-readable refusal/failure codes per the B10 brief.
 * The route + UI map each code to a fixed-vocabulary safe sentence.
 */
export type Phase3LandlordRefusalReason =
  | "job_not_found"
  | "unsupported_lane"
  | "readiness_not_ready"
  | "instruction_graph_not_ready"
  | "maklumat_am_not_saved"
  | "supervised_session_missing"
  | "browser_not_reachable"
  | "browser_not_phase_compatible"
  | "p5_form_not_detected"
  | "bahagian_a_not_accessible"
  | "landlord_individual_party_missing"
  | "landlord_individual_trigger_missing"
  | "modal_not_opened"
  | "required_field_missing"
  | "selector_missing"
  | "ambiguous_selector"
  | "option_missing"
  | "fill_failed"
  /**
   * Legacy code from the first cascade-fix iteration, retained for
   * compatibility. Today's executor prefers the more specific
   * `identity_resolution_failed` / `manual_identity_fallback_required`
   * codes below.
   */
  | "identity_cascade_failed"
  /**
   * The kpin (identity number) was filled and the portal's
   * blur cascade fired, but neither the TIN auto-resolution nor
   * the invalid-IC fallback path produced a definitive signal
   * within the bounded wait. The dependent fields stayed empty
   * AND the gender fallback radios stayed hidden. NEVER force-
   * write hidden fields — fail closed.
   */
  | "identity_resolution_failed"
  /**
   * The kpin (identity number) was filled and the portal's blur
   * cascade fired, but the portal could NOT resolve the IC against
   * LHDN. The portal exposed the gender / DOB fallback fields,
   * which is a signal that the IC is unrecognised and operator
   * fallback entry is required. B10 does NOT auto-fill the
   * fallback path — fail closed and surface this code so the
   * operator can correct the IC or move to the next milestone.
   */
  | "manual_identity_fallback_required"
  | "modal_save_missing"
  | "modal_save_click_failed"
  | "row_count_not_updated"
  | "post_save_verification_failed"
  | "save_failed";

/**
 * Sanitized field-key enum identifying where the executor failed.
 * Drawn from the closed set of internal field keys WeStamp drives
 * (no portal element ids, no raw values).
 */
export type Phase3LandlordFailedFieldKey =
  | "landlord_party"
  | "bahagian_a_tab"
  | "landlord_individual_trigger"
  | "modal_open"
  | "nameAsPerInstrument"
  | "citizenshipCategory"
  | "nricSubType"
  | "identityNumber"
  | "gender"
  | "dateOfBirth"
  | "addressLine1"
  | "postcode"
  | "city"
  | "state"
  | "country"
  | "mobile"
  | "modal_save_button"
  | "row_count_verification"
  | "post_save_verification";

/** Result of a single executor invocation. */
export interface Phase3LandlordExecutionResult {
  status: Phase3LandlordExecutionStatus;
  refusalReason?: Phase3LandlordRefusalReason;
  /** Stable, sensitive-data-free description from a closed map. */
  reason: string;
  attemptedAt: string;
  savedAt?: string;
  postSavePathKind?: SupervisedSessionPathKind;
  /** Where in the flow we failed. */
  failedFieldKey?: Phase3LandlordFailedFieldKey;
  /**
   * Pre-mutation landlord-table row count captured BEFORE clicking
   * the trigger. Always present once the executor reached step 4.
   */
  preRowCount?: number;
  /**
   * Post-mutation landlord-table row count captured AFTER the
   * networkidle wait. Present only when the executor reached step 12.
   */
  postRowCount?: number;
  /**
   * For `option_missing` only: the expected portal `<option value>`
   * code WeStamp tried to select.
   */
  expectedOptionValue?: string;
  /**
   * Operator-facing diagnostic: true iff the executor used the
   * `"0"` telephone fallback for `input#tb_telno` rather than the
   * `party.mobile` value. Surfaced so the UI can prompt for a
   * real telephone number during the future review/confirmation
   * step before final Hantar.
   */
  telephoneFallbackUsed?: boolean;
}

/** Maklumat-Am-style payload — every value the executor needs to fill. */
export interface Phase3LandlordPayload {
  /** The landlord-individual party itself. */
  party: TenancyPortalParty;
  /** Mapped portal `<option value>` for `warga`. e.g. `"1"`. */
  citizenshipPortalCode: string;
  /** Mapped portal id for the chosen NRIC sub-type radio. e.g. `"IC_BARU"`. */
  nricSubTypeRadioId: string;
  /** Mapped portal id for the chosen gender radio. e.g. `"USER_SEX-1"`. */
  genderRadioId: string;
  /**
   * Date of birth in `dd/mm/yyyy` form (the format observed on the
   * live portal's bootbox date inputs). Optional for the
   * identity-resolution-first path: the portal auto-derives DOB
   * from the IC, so the executor does NOT fill this on a resolved
   * IC. Retained on the payload type for the future invalid-IC
   * fallback path.
   */
  dateOfBirthDdMmYyyy?: string;
  /**
   * Mapped portal `<option value>` for `negeri1`. e.g. `"14"` for
   * Wilayah Persekutuan Kuala Lumpur.
   */
  statePortalCode: string;
  /**
   * Country option to select. We use `{ label }` so the executor
   * can match the live label without WeStamp needing to know the
   * portal's numeric country code.
   */
  countryLabel: string;
  /**
   * Telephone value the executor will fill into `input#tb_telno`.
   *
   * No. Telefon is mandatory in e-Duti Setem Bahagian A. It may
   * not exist in uploaded documents. For MVP/testing, WeStamp
   * uses `party.mobile` when available; otherwise it falls back
   * to `"0"`. Future user-review collection can replace this
   * fallback with an operator-provided value.
   */
  telephoneValue: string;
  /**
   * True iff `telephoneValue` is the `"0"` fallback rather than
   * a value sourced from `party.mobile`. Operator-facing diagnostic
   * — surfaced on the result for the UI.
   */
  telephoneFallbackUsed: boolean;
  /**
   * Address line 1 value. Required by the portal. Sourced from
   * `party.addressLine1` when non-empty; falls back to a stable
   * test sentinel when missing (B10 MVP rule — operator review
   * later collects a real value before Hantar).
   */
  addressLine1Value: string;
  /** True iff addressLine1Value is the fallback. */
  addressLine1FallbackUsed: boolean;
  /**
   * Address line 2 value. Live B10 evidence indicates this field
   * is mandatory on the live Tambah modal. Sourced from
   * `party.addressLine2` when non-empty; falls back to a stable
   * test sentinel when missing.
   */
  addressLine2Value: string;
  /** True iff addressLine2Value is the fallback. */
  addressLine2FallbackUsed: boolean;
  /**
   * Postcode value. Must be exactly 5 numeric digits per portal
   * convention. Sourced from `party.postcode` when valid;
   * payload-build refuses with `required_field_missing` /
   * `failedFieldKey: postcode` when the captured value is
   * malformed. Operators MUST capture a valid 5-digit postcode.
   */
  postcodeValue: string;
}

/**
 * Telephone fallback constant. Captured on the payload + result so
 * tests can lock the value without re-deriving the rule.
 */
export const PHASE_3_TELEPHONE_FALLBACK_VALUE = "0";

/**
 * Stable test fallbacks for mandatory address fields when WeStamp
 * source data lacks them. e-Duti Setem Bahagian A is observed to
 * require both address lines; the captured PDFs / source documents
 * may not always carry a meaningful second line. The fallbacks let
 * the test draft commit; future user-review collects a real value
 * before final Hantar.
 */
export const PHASE_3_ADDRESS_LINE_1_FALLBACK_VALUE = "no. 22";
export const PHASE_3_ADDRESS_LINE_2_FALLBACK_VALUE = "jalan";

/**
 * Postcode validation regex. Malaysian postcodes are exactly
 * 5 numeric digits. The payload builder rejects any other shape
 * (including 4-digit or alphanumeric values) with
 * `required_field_missing` / `failedFieldKey: postcode`.
 */
export const PHASE_3_POSTCODE_PATTERN = /^[0-9]{5}$/;

// ─── Public selector + label constants ─────────────────────────────

export const PHASE_3_TAB_ANCHOR_TEXT = BAHAGIAN_A_TAB_ANCHOR_TEXT; // "Bahagian A"

export const PHASE_3_LANDLORD_HEADING_MATCH =
  "LANDLORD|PEMBERI SEWA|TUAN TANAH";

export const PHASE_3_LANDLORD_TRIGGER_TEXT = "Individu";

/**
 * Modal save button selector — scoped to the open bootbox modal so
 * it never collides with the page-level `input#pdsL01_button_simpan`
 * (B7's save button). Live B10 evidence (2026-05-01) showed the
 * modal's Simpan button is rendered as
 *   `<input type="submit" value="Simpan " class="btn btn-primary">`
 * (note the trailing space on `value`), with no `id` or `name`. The
 * scope `.bootbox.modal.in input[type="submit"]` resolves to
 * exactly one element inside the open modal and never matches the
 * page-level B7 button (which is `<input id="pdsL01_button_simpan"
 * type="button">` — a different `type`).
 *
 * Anti-regression test verifies it is NOT the page-level save
 * button selector.
 */
export const PHASE_3_MODAL_SAVE_SELECTOR =
  '.bootbox.modal.in input[type="submit"]';

/** Modal field selectors — pulled verbatim from the B9 registry. */
export const PHASE_3_MODAL_FIELD_SELECTORS = {
  name: "input#tb_nama",
  warga: "select#warga",
  nricSubTypeGroup: 'input[name="EPD_NOKP_TYPE"]',
  identityNumber: "input#kpin",
  genderGroup: 'input[name="USER_SEX"]',
  dateOfBirth: "input#DSD_APPLY_DATE",
  /**
   * Hidden TIN field. Populated by the portal AFTER the kpin blur
   * cascade fires AND the LHDN identity lookup resolves. Used by
   * the identity-resolution-first path to detect a valid IC: when
   * `inputValue()` returns a non-empty string, the resolved-path
   * is taken (skip gender + DOB).
   */
  tinHidden: 'input[name="tb_cukai"]',
  /**
   * Readonly visible mirror of the resolved TIN. Populated as a
   * follow-up to the hidden field. Currently used only for
   * diagnostics (not as the primary signal).
   */
  tinDisplay: 'input[name="tb_cukai_display"]',
  addressLine1: "input#tb_alamat_1",
  addressLine2: "input#tb_alamat_2",
  postcode: "input#tb_poskod",
  city: "input#tb_city",
  state: "select#negeri1",
  country: "select#negara2",
  mobile: "input#tb_telno",
} as const;

// ─── Reason labels ─────────────────────────────────────────────────

export const PHASE_3_LANDLORD_REASON_LABELS: Record<
  Phase3LandlordExecutionStatus | Phase3LandlordRefusalReason,
  string
> = {
  not_attempted: "Phase 3 landlord-individual row save has not been attempted.",
  refused: "Phase 3 landlord-individual save refused before any portal contact.",
  started: "Phase 3 landlord-individual save attempt has started.",
  saved: "Landlord-individual row saved.",
  failed: "Phase 3 landlord-individual save attempt failed mid-flight.",
  job_not_found: "Job record not found.",
  unsupported_lane: "Job is not on the Sewa/Pajakan supported path.",
  readiness_not_ready:
    "Job readiness verdict is not ready_for_supervised_run.",
  instruction_graph_not_ready:
    "Instruction graph verdict is not ready_for_supervised_run.",
  maklumat_am_not_saved:
    "Phase 2 Maklumat Am draft has not been saved yet — save it before attempting a Bahagian A row.",
  supervised_session_missing:
    "Supervised run session has not been prepared yet.",
  browser_not_reachable:
    "Operator's Chrome is not reachable on the configured CDP endpoint.",
  browser_not_phase_compatible:
    "Browser session is not compatible with Phase 3.",
  p5_form_not_detected:
    "No Sewa/Pajakan p5 form was detected in the operator's open Chrome pages.",
  bahagian_a_not_accessible:
    "The Bahagian A section could not be revealed on the live p5 form.",
  landlord_individual_party_missing:
    "No individual landlord party is captured on the job.",
  landlord_individual_trigger_missing:
    "The landlord-side `Individu` trigger anchor was not found inside the LANDLORD fieldset.",
  modal_not_opened:
    "Clicking the landlord trigger did not open a Tambah modal.",
  required_field_missing:
    "A required landlord-individual field is missing or unmapped.",
  selector_missing:
    "A required modal field selector did not resolve on the live form.",
  ambiguous_selector:
    "A required modal field selector matched multiple elements.",
  option_missing:
    "A required `<option value>` code was not present in the live select. No portal interaction occurred for this field.",
  fill_failed:
    "A modal fill / select / radio click failed before the Simpan button was clicked.",
  identity_cascade_failed:
    "The IC / kpin field was filled but the portal's identity-validation cascade did not reveal the gender / DOB / TIN fields. No portal row was committed.",
  identity_resolution_failed:
    "The IC was filled but neither the portal's TIN auto-resolution nor the invalid-IC fallback signal appeared within the bounded wait. No portal row was committed.",
  manual_identity_fallback_required:
    "The portal could not auto-resolve the IC against LHDN. Manual fallback entry (gender, date of birth, free-text TIN) is required and is NOT automated by this milestone. No portal row was committed.",
  modal_save_missing:
    "The modal Simpan button was not found inside the open bootbox modal.",
  modal_save_click_failed:
    "The modal Simpan button was found but its click failed.",
  row_count_not_updated:
    "Modal Simpan was clicked but the landlord table row count did not climb by exactly 1 — the row may NOT have been saved.",
  post_save_verification_failed:
    "Post-save URL classification failed — the page is no longer the Sewa/Pajakan p5 form.",
  save_failed: "Phase 3 landlord save failed (unspecified).",
};

// ─── Pure preflight ────────────────────────────────────────────────

export type Phase3LandlordPreflightOutcome =
  | { ok: true; party: TenancyPortalParty }
  | { ok: false; refusalReason: Phase3LandlordRefusalReason };

/**
 * Pure pre-CDP preflight. Refuses before any browser contact when:
 *   - the job is not tenancy_agreement
 *   - readiness / instruction-graph verdicts are not ready
 *   - the supervised run session doesn't exist
 *   - Phase 2 Maklumat Am is not yet saved
 *   - no individual landlord is captured on the job
 *   - any required landlord-individual field is missing
 *
 * Browser-side preconditions (CDP reachable, p5 detected, phase
 * compatible, Bahagian A accessible) are checked by the route /
 * executor after this preflight passes.
 */
export function evaluatePhase3LandlordPreflight(
  job: StampingJob
): Phase3LandlordPreflightOutcome {
  if (job.documentCategory !== "tenancy_agreement") {
    return { ok: false, refusalReason: "unsupported_lane" };
  }
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  if (readinessReport.verdict !== "ready_for_supervised_run") {
    return { ok: false, refusalReason: "readiness_not_ready" };
  }
  const graph = buildTenancyInstructionGraphFromJob(job);
  if (graph.verdict !== "ready_for_supervised_run") {
    return { ok: false, refusalReason: "instruction_graph_not_ready" };
  }
  const session = job.supervisedRunSession;
  if (!session) {
    return { ok: false, refusalReason: "supervised_session_missing" };
  }
  // Maklumat Am must already be saved (sticky stage).
  if (session.currentRunStage !== "phase_2_maklumat_am_saved") {
    return { ok: false, refusalReason: "maklumat_am_not_saved" };
  }
  // Landlord-individual presence guard.
  const parties = job.tenancyPortalDetails?.parties ?? [];
  const landlord = parties.find(
    (p) => p.role === "landlord" && p.type === "individual"
  );
  if (!landlord) {
    return { ok: false, refusalReason: "landlord_individual_party_missing" };
  }
  // Required-field guard (the fields the executor will write).
  const missing = collectMissingLandlordFields(landlord);
  if (missing.length > 0) {
    return { ok: false, refusalReason: "required_field_missing" };
  }
  return { ok: true, party: landlord };
}

/**
 * Stable list of internal field keys required for an individual
 * landlord row. Mirrors `tenancy-bahagian-a-party-plan.ts` but keeps
 * the executor self-contained.
 */
export function collectMissingLandlordFields(
  party: TenancyPortalParty
): string[] {
  const missing: string[] = [];
  if (!party.nameAsPerInstrument) missing.push("nameAsPerInstrument");
  if (!party.citizenshipCategory) missing.push("citizenshipCategory");
  if (!party.identityType) missing.push("identityType");
  if (!party.identityNumber) missing.push("identityNumber");
  if (party.identityType === "nric" && !party.nricSubType) {
    missing.push("nricSubType");
  }
  if (!party.gender) missing.push("gender");
  if (!party.addressLine1) missing.push("addressLine1");
  if (!party.postcode) missing.push("postcode");
  if (!party.city) missing.push("city");
  if (!party.state) missing.push("state");
  if (!party.country) missing.push("country");
  if (!party.mobile) missing.push("mobile");
  return missing;
}

// ─── Payload mappers ───────────────────────────────────────────────

const CITIZENSHIP_TO_WARGA: Record<string, string> = {
  citizen: "1",
  non_citizen: "2",
  permanent_resident: "3",
};

const NRIC_SUBTYPE_TO_RADIO_ID: Record<string, string> = {
  ic_baru: "IC_BARU",
  ic_lama: "IC_LAMA",
  ic_polis: "IC_POLIS",
  ic_army: "IC_ARMY",
};

const GENDER_TO_RADIO_ID: Record<string, string> = {
  male: "USER_SEX-1",
  female: "USER_SEX-2",
};

/**
 * State-name → portal `negeri1` `<option value>` map. Built from the
 * 17 codes captured in the B9 registry. Match is case-insensitive
 * and tolerates common abbreviations (`KL`, `Kuala Lumpur` → 14).
 */
function resolveStatePortalCode(stateValue: string): string | null {
  const v = stateValue.trim().toLowerCase();
  if (!v) return null;
  // Direct exact-match table.
  const exact: Record<string, string> = {
    johor: "1",
    kedah: "2",
    kelantan: "3",
    melaka: "4",
    "negeri sembilan": "5",
    pahang: "6",
    perak: "7",
    perlis: "8",
    "pulau pinang": "9",
    penang: "9",
    sabah: "10",
    sarawak: "11",
    selangor: "12",
    terengganu: "13",
    "wilayah persekutuan kuala lumpur": "14",
    "kuala lumpur": "14",
    kl: "14",
    "wilayah persekutuan labuan": "15",
    labuan: "15",
    "wilayah persekutuan putrajaya": "16",
    putrajaya: "16",
    "luar negara": "17",
  };
  return exact[v] ?? null;
}

/**
 * Derive a `dd/mm/yyyy` date-of-birth string from a Malaysian NRIC
 * IC_BARU number. The first 6 digits encode `YYMMDD`. Years <= 30
 * resolve to 20YY; >= 31 resolve to 19YY (a heuristic that is
 * conventional for current Malaysian portals).
 *
 * Returns `null` when the IC isn't recognisably an `ic_baru` number.
 */
export function deriveDobFromIcBaru(
  identityNumber: string
): string | null {
  const digits = identityNumber.replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const yearNum = Number(yy);
  const monthNum = Number(mm);
  const dayNum = Number(dd);
  if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum) || !Number.isFinite(dayNum))
    return null;
  if (monthNum < 1 || monthNum > 12) return null;
  if (dayNum < 1 || dayNum > 31) return null;
  const fullYear = yearNum <= 30 ? 2000 + yearNum : 1900 + yearNum;
  return `${dd}/${mm}/${fullYear}`;
}

export type Phase3LandlordPayloadResult =
  | { ok: true; payload: Phase3LandlordPayload }
  | {
      ok: false;
      refusalReason: Phase3LandlordRefusalReason;
      failedFieldKey?: Phase3LandlordFailedFieldKey;
    };

/**
 * Build the executor payload from a landlord party. Pure; resolves
 * every captured WeStamp value to a portal-canonical code where
 * possible. Refuses with a clear code when a required mapping is
 * absent (e.g. a state name that doesn't match any of the 17 portal
 * options).
 */
export function buildPhase3LandlordPayload(
  party: TenancyPortalParty
): Phase3LandlordPayloadResult {
  // Citizenship.
  const citizenshipPortalCode =
    party.citizenshipCategory && CITIZENSHIP_TO_WARGA[party.citizenshipCategory];
  if (!citizenshipPortalCode) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "citizenshipCategory",
    };
  }
  // NRIC sub-type. Required only for NRIC parties.
  if (party.identityType !== "nric") {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "nricSubType",
    };
  }
  const nricSubTypeRadioId =
    party.nricSubType && NRIC_SUBTYPE_TO_RADIO_ID[party.nricSubType];
  if (!nricSubTypeRadioId) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "nricSubType",
    };
  }
  // Gender.
  const genderRadioId =
    party.gender && GENDER_TO_RADIO_ID[party.gender];
  if (!genderRadioId) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "gender",
    };
  }
  // Date of birth — derived from IC for ic_baru. Optional because
  // the identity-resolution-first path does not fill DOB (the portal
  // auto-derives it from the IC). We keep the derivation for any
  // future invalid-IC fallback path; if the IC isn't ic_baru-shaped
  // the value stays undefined, which is also fine.
  const dateOfBirthDdMmYyyy: string | undefined =
    party.nricSubType === "ic_baru"
      ? deriveDobFromIcBaru(party.identityNumber ?? "") ?? undefined
      : undefined;
  // State.
  const statePortalCode = resolveStatePortalCode(party.state);
  if (!statePortalCode) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "state",
    };
  }
  // Country — resolved by label at runtime.
  const countryLabel = (party.country ?? "").trim().toUpperCase();
  if (!countryLabel) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "country",
    };
  }
  // Telephone — mandatory portal field; party.mobile when present,
  // else fall back to "0". The fallback is acceptable for B10 MVP
  // because LHDN does not verify telephone at Bahagian A entry;
  // future user-review will collect a real value before Hantar.
  const partyMobile = (party.mobile ?? "").trim();
  const telephoneValue: string =
    partyMobile.length > 0 ? partyMobile : PHASE_3_TELEPHONE_FALLBACK_VALUE;
  const telephoneFallbackUsed = partyMobile.length === 0;
  // Address line 1 — required portal field. Use party value when
  // non-empty; fall back to a stable test sentinel.
  const partyAddr1 = (party.addressLine1 ?? "").trim();
  const addressLine1Value: string =
    partyAddr1.length > 0
      ? partyAddr1
      : PHASE_3_ADDRESS_LINE_1_FALLBACK_VALUE;
  const addressLine1FallbackUsed = partyAddr1.length === 0;
  // Address line 2 — also required (B10 live evidence). Same
  // fallback pattern.
  const partyAddr2 = (party.addressLine2 ?? "").trim();
  const addressLine2Value: string =
    partyAddr2.length > 0
      ? partyAddr2
      : PHASE_3_ADDRESS_LINE_2_FALLBACK_VALUE;
  const addressLine2FallbackUsed = partyAddr2.length === 0;
  // Postcode — must be exactly 5 numeric digits. Refuse on
  // malformed values rather than guess.
  const partyPostcode = (party.postcode ?? "").trim();
  if (!PHASE_3_POSTCODE_PATTERN.test(partyPostcode)) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "postcode",
    };
  }
  const postcodeValue = partyPostcode;
  return {
    ok: true,
    payload: {
      party,
      citizenshipPortalCode,
      nricSubTypeRadioId,
      genderRadioId,
      ...(dateOfBirthDdMmYyyy !== undefined ? { dateOfBirthDdMmYyyy } : {}),
      statePortalCode,
      countryLabel,
      telephoneValue,
      telephoneFallbackUsed,
      addressLine1Value,
      addressLine1FallbackUsed,
      addressLine2Value,
      addressLine2FallbackUsed,
      postcodeValue,
    },
  };
}

// ─── Page-like surface (test-injectable) ──────────────────────────

export type Phase3SelectOptionTarget =
  | string
  | { value: string }
  | { label: string };

export interface Phase3LocatorLike {
  count(): Promise<number>;
  selectOption(
    target: Phase3SelectOptionTarget,
    options?: { timeout?: number }
  ): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  inputValue(options?: { timeout?: number }): Promise<string>;
  /**
   * Press a keyboard key on the locator's element. Mirrors
   * Playwright's `Locator.press` signature. Used by the executor
   * to trigger the live portal's blur / validation cascade after
   * filling `input#kpin` (B10 cascade fix).
   */
  press(key: string, options?: { timeout?: number }): Promise<void>;
}

export interface Phase3PageLike {
  url(): string;
  locator(selector: string): Phase3LocatorLike;
  waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<void>;
  /** Click a top-level tab anchor by visible text. */
  clickTabAnchor(args: { text: string; timeout?: number }): Promise<void>;
  /**
   * Click an anchor whose text equals `anchorText`, scoped inside the
   * `<fieldset>` whose heading text matches `roleHeadingMatch`
   * (case-insensitive substring or pipe-delimited alternation).
   */
  clickRoleScopedAnchor(args: {
    roleHeadingMatch: string;
    anchorText: string;
    timeout?: number;
  }): Promise<void>;
  /**
   * Read the row count of the first `<table>` inside the
   * `<fieldset>` whose heading text matches `roleHeadingMatch`.
   * Returns 0 when there's no table or no body rows.
   */
  countTableRowsInRoleSection(args: {
    roleHeadingMatch: string;
  }): Promise<number>;
}

// ─── Executor ──────────────────────────────────────────────────────

export interface ExecutePhase3LandlordOptions {
  page: Phase3PageLike;
  payload: Phase3LandlordPayload;
  now?: () => string;
  fillTimeoutMs?: number;
  clickTimeoutMs?: number;
  selectTimeoutMs?: number;
  postSaveWaitMs?: number;
  /**
   * Optional bounded extra wait after the modal Simpan click before
   * re-reading the row count. Defaults to 1500ms — modal animations
   * + DOM updates need a moment.
   */
  postClickStabilizationMs?: number;
  /**
   * Legacy cascade-wait config — retained for compatibility but
   * no longer the primary path. The new resolution wait below
   * supersedes it.
   */
  identityCascadeWaitMs?: number;
  /**
   * Bounded total time the executor will wait for the portal's
   * identity-resolution outcome AFTER filling `input#kpin` and
   * pressing Tab. Polls every 200 ms for one of:
   *   1. `tb_cukai` (hidden TIN) becomes non-empty → resolved
   *      path → skip gender + DOB → continue to address.
   *   2. Gender radio (`input#USER_SEX-*`) becomes visible →
   *      invalid-IC fallback path → fail with
   *      `manual_identity_fallback_required` (NOT auto-filled in
   *      this milestone).
   *   3. Neither signal within timeout → fail with
   *      `identity_resolution_failed`.
   *
   * Defaults to 8000 ms. Live LHDN identity AJAX typically
   * resolves in 1-3 s.
   */
  identityResolutionWaitMs?: number;
}

const DEFAULT_FILL_TIMEOUT_MS = 5000;
const DEFAULT_CLICK_TIMEOUT_MS = 5000;
const DEFAULT_SELECT_TIMEOUT_MS = 5000;
const DEFAULT_POST_SAVE_WAIT_MS = 15000;
const DEFAULT_POST_CLICK_STABILIZATION_MS = 1500;
const DEFAULT_IDENTITY_CASCADE_WAIT_MS = 5000;
const IDENTITY_CASCADE_POLL_INTERVAL_MS = 200;
const DEFAULT_IDENTITY_RESOLUTION_WAIT_MS = 8000;
const IDENTITY_RESOLUTION_POLL_INTERVAL_MS = 200;

function defaultNow(): string {
  return new Date().toISOString();
}

interface FailureEnrichment {
  failedFieldKey?: Phase3LandlordFailedFieldKey;
  expectedOptionValue?: string;
  preRowCount?: number;
  postRowCount?: number;
}

function refused(
  reason: Phase3LandlordRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase3LandlordExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_3_LANDLORD_REASON_LABELS[reason],
    attemptedAt,
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.expectedOptionValue !== undefined
      ? { expectedOptionValue: enrichment.expectedOptionValue }
      : {}),
    ...(enrichment.preRowCount !== undefined
      ? { preRowCount: enrichment.preRowCount }
      : {}),
    ...(enrichment.postRowCount !== undefined
      ? { postRowCount: enrichment.postRowCount }
      : {}),
  };
}

function failed(
  reason: Phase3LandlordRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase3LandlordExecutionResult {
  return {
    status: "failed",
    refusalReason: reason,
    reason: PHASE_3_LANDLORD_REASON_LABELS[reason],
    attemptedAt,
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.expectedOptionValue !== undefined
      ? { expectedOptionValue: enrichment.expectedOptionValue }
      : {}),
    ...(enrichment.preRowCount !== undefined
      ? { preRowCount: enrichment.preRowCount }
      : {}),
    ...(enrichment.postRowCount !== undefined
      ? { postRowCount: enrichment.postRowCount }
      : {}),
  };
}

async function requireUnique(
  page: Phase3PageLike,
  selector: string,
  attemptedAt: string,
  failedFieldKey: Phase3LandlordFailedFieldKey
): Promise<
  | { ok: true; locator: Phase3LocatorLike }
  | { ok: false; result: Phase3LandlordExecutionResult }
> {
  const locator = page.locator(selector);
  let count: number;
  try {
    count = await locator.count();
  } catch {
    return {
      ok: false,
      result: refused("selector_missing", attemptedAt, { failedFieldKey }),
    };
  }
  if (count === 0)
    return {
      ok: false,
      result: refused("selector_missing", attemptedAt, { failedFieldKey }),
    };
  if (count > 1)
    return {
      ok: false,
      result: refused("ambiguous_selector", attemptedAt, { failedFieldKey }),
    };
  return { ok: true, locator };
}

/**
 * Execute the controlled Phase 3 landlord-individual row save
 * against a Page-like surface. Caller (the route layer) is
 * responsible for selecting the right page (the route's
 * `findFirstP5Page` helper). The executor itself never opens or
 * closes pages.
 */
export async function executePhase3LandlordIndividualSave(
  opts: ExecutePhase3LandlordOptions
): Promise<Phase3LandlordExecutionResult> {
  const attemptedAt = (opts.now ?? defaultNow)();
  const fillTimeout = opts.fillTimeoutMs ?? DEFAULT_FILL_TIMEOUT_MS;
  const clickTimeout = opts.clickTimeoutMs ?? DEFAULT_CLICK_TIMEOUT_MS;
  const selectTimeout = opts.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS;
  const postSaveWait = opts.postSaveWaitMs ?? DEFAULT_POST_SAVE_WAIT_MS;
  const postClickStabilization =
    opts.postClickStabilizationMs ?? DEFAULT_POST_CLICK_STABILIZATION_MS;
  const identityCascadeWait =
    opts.identityCascadeWaitMs ?? DEFAULT_IDENTITY_CASCADE_WAIT_MS;
  void identityCascadeWait; // legacy config; resolution-first path uses identityResolutionWait
  const identityResolutionWait =
    opts.identityResolutionWaitMs ?? DEFAULT_IDENTITY_RESOLUTION_WAIT_MS;
  const { page, payload } = opts;
  const { party } = payload;

  // ── Step 1: pre-mutation page-kind guard ──
  let preUrl: string;
  try {
    preUrl = page.url();
  } catch {
    return refused("p5_form_not_detected", attemptedAt);
  }
  if (classifySupervisedSessionPath(preUrl) !== "sewa_pajakan_p5_form") {
    return refused("p5_form_not_detected", attemptedAt);
  }

  // ── Step 2: navigate to the Bahagian A tab ──
  try {
    await page.clickTabAnchor({
      text: PHASE_3_TAB_ANCHOR_TEXT,
      timeout: clickTimeout,
    });
  } catch {
    return refused("bahagian_a_not_accessible", attemptedAt, {
      failedFieldKey: "bahagian_a_tab",
    });
  }

  // ── Step 3: capture pre-save landlord row count ──
  let preRowCount: number;
  try {
    preRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_3_LANDLORD_HEADING_MATCH,
    });
  } catch {
    return refused("bahagian_a_not_accessible", attemptedAt, {
      failedFieldKey: "bahagian_a_tab",
    });
  }

  // ── Step 4: open the landlord-individual modal ──
  try {
    await page.clickRoleScopedAnchor({
      roleHeadingMatch: PHASE_3_LANDLORD_HEADING_MATCH,
      anchorText: PHASE_3_LANDLORD_TRIGGER_TEXT,
      timeout: clickTimeout,
    });
  } catch {
    return refused("landlord_individual_trigger_missing", attemptedAt, {
      failedFieldKey: "landlord_individual_trigger",
      preRowCount,
    });
  }

  // ── Step 5: confirm the modal opened (the modal save button must
  // resolve uniquely).
  const saveR = await requireUnique(
    page,
    PHASE_3_MODAL_SAVE_SELECTOR,
    attemptedAt,
    "modal_save_button"
  );
  if (!saveR.ok) {
    // The save selector didn't resolve → modal didn't open OR our
    // selector is wrong.
    return failed("modal_not_opened", attemptedAt, {
      failedFieldKey: "modal_open",
      preRowCount,
    });
  }
  const saveLocator = saveR.locator;

  // ── Step 6: fill the modal fields, in the order the live form
  // cascades (warga first → NRIC sub-type radio → kpin → gender →
  // dob → address → state → country → mobile).
  // Each step has its own try/catch so failures can be attributed
  // to a specific field via `failedFieldKey`.

  // 6a. Name (always visible).
  const nameR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.name,
    attemptedAt,
    "nameAsPerInstrument"
  );
  if (!nameR.ok)
    return { ...nameR.result, preRowCount };
  try {
    await nameR.locator.fill(party.nameAsPerInstrument, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "nameAsPerInstrument",
      preRowCount,
    });
  }

  // 6b. warga (citizenship).
  const wargaR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.warga,
    attemptedAt,
    "citizenshipCategory"
  );
  if (!wargaR.ok) return { ...wargaR.result, preRowCount };
  try {
    await wargaR.locator.selectOption(
      { value: payload.citizenshipPortalCode },
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "citizenshipCategory",
      expectedOptionValue: payload.citizenshipPortalCode,
      preRowCount,
    });
  }

  // 6c. NRIC sub-type radio. Selector is `input#<RADIO_ID>` for the
  // specific radio (B9 capture: each radio carries a unique id).
  const nricRadioSel = `input#${payload.nricSubTypeRadioId}`;
  const nricR = await requireUnique(
    page,
    nricRadioSel,
    attemptedAt,
    "nricSubType"
  );
  if (!nricR.ok) return { ...nricR.result, preRowCount };
  try {
    await nricR.locator.click({ timeout: clickTimeout });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "nricSubType",
      preRowCount,
    });
  }

  // 6d. kpin (identity number) — enabled after radio click.
  const kpinR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.identityNumber,
    attemptedAt,
    "identityNumber"
  );
  if (!kpinR.ok) return { ...kpinR.result, preRowCount };
  try {
    await kpinR.locator.fill(party.identityNumber!, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "identityNumber",
      preRowCount,
    });
  }

  // ── Step 6d.1: identity-resolution-first cascade ──
  //
  // OPERATOR INSIGHT (2026-05-01): the live Bahagian A modal
  // exposes gender / DOB / TIN fields ONLY when the entered IC is
  // not recognised by LHDN identity lookup. For a valid Malaysian
  // IC, the portal:
  //   - resolves the underlying TIN automatically
  //   - populates `tb_cukai` (hidden) with the resolved TIN
  //   - DOES NOT require operator entry of gender or DOB
  //   - the portal manages those fields itself
  //
  // The resolved-IC happy path therefore SKIPS gender and DOB
  // entirely. Filling them on a resolved IC was the cause of the
  // prior B10 row_count_not_updated failure — the portal validates
  // the form's resolution-state at Simpan time and silently
  // rejects commits where operator-entered gender/DOB conflict
  // with portal-resolved state.
  //
  // The executor first triggers a HUMAN-LIKE Tab keypress on kpin
  // to fire the portal's blur handler, then polls for one of:
  //   (a) tb_cukai populated → resolved path → continue
  //   (b) gender radio visible → invalid-IC fallback → fail
  //       (`manual_identity_fallback_required`); NOT auto-filled
  //       in this milestone
  //   (c) neither within bounded timeout → fail
  //       (`identity_resolution_failed`)
  //
  // The executor never force-writes hidden fields, never force-
  // clicks invisible radios, never sets tb_cukai by JS. Both
  // failure paths fail BEFORE clicking modal Simpan.
  try {
    await kpinR.locator.press("Tab", { timeout: clickTimeout });
  } catch {
    return failed("identity_resolution_failed", attemptedAt, {
      failedFieldKey: "identityNumber",
      preRowCount,
    });
  }
  const resolution = await waitForIdentityResolution(
    page,
    payload.genderRadioId,
    identityResolutionWait,
    IDENTITY_RESOLUTION_POLL_INTERVAL_MS
  );
  if (resolution === "manual_fallback") {
    return failed("manual_identity_fallback_required", attemptedAt, {
      failedFieldKey: "identityNumber",
      preRowCount,
    });
  }
  if (resolution === "neither") {
    return failed("identity_resolution_failed", attemptedAt, {
      failedFieldKey: "identityNumber",
      preRowCount,
    });
  }
  // resolution === "tin_resolved" — continue. Gender + DOB are
  // intentionally NOT touched on this path.

  // 6g. addressLine1 (mandatory). Uses payload.addressLine1Value
  // which falls back to a stable sentinel when WeStamp source data
  // is missing. Live B10 evidence: this field is required AND
  // visible after IC resolution; the portal does not auto-fill it.
  const a1R = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.addressLine1,
    attemptedAt,
    "addressLine1"
  );
  if (!a1R.ok) return { ...a1R.result, preRowCount };
  try {
    await a1R.locator.fill(payload.addressLine1Value, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "addressLine1",
      preRowCount,
    });
  }

  // 6h. addressLine2 (mandatory per B10 operator-screenshot
  // evidence). Always fills — uses fallback sentinel when WeStamp
  // source data is missing.
  const a2R = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.addressLine2,
    attemptedAt,
    "addressLine1"
  );
  if (!a2R.ok) return { ...a2R.result, preRowCount };
  try {
    await a2R.locator.fill(payload.addressLine2Value, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "addressLine1",
      preRowCount,
    });
  }

  // 6i. postcode (mandatory, exactly 5 digits — payload-builder
  // already validated this).
  const pcR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.postcode,
    attemptedAt,
    "postcode"
  );
  if (!pcR.ok) return { ...pcR.result, preRowCount };
  try {
    await pcR.locator.fill(payload.postcodeValue, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "postcode",
      preRowCount,
    });
  }

  // 6j. city.
  const cityR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.city,
    attemptedAt,
    "city"
  );
  if (!cityR.ok) return { ...cityR.result, preRowCount };
  try {
    await cityR.locator.fill(party.city, { timeout: fillTimeout });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "city",
      preRowCount,
    });
  }

  // 6k. state.
  const stateR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.state,
    attemptedAt,
    "state"
  );
  if (!stateR.ok) return { ...stateR.result, preRowCount };
  try {
    await stateR.locator.selectOption(
      { value: payload.statePortalCode },
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "state",
      expectedOptionValue: payload.statePortalCode,
      preRowCount,
    });
  }

  // 6l. country (resolved by label).
  const countryR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.country,
    attemptedAt,
    "country"
  );
  if (!countryR.ok) return { ...countryR.result, preRowCount };
  try {
    await countryR.locator.selectOption(
      { label: payload.countryLabel },
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "country",
      preRowCount,
    });
  }

  // 6m. mobile / No. Telefon.
  //
  // No. Telefon (mandatory) — `input#tb_telno`. The portal requires
  // a non-empty value. WeStamp uses `payload.telephoneValue`, which
  // the payload builder resolves to `party.mobile` when present
  // and falls back to `"0"` when WeStamp's source data carries no
  // phone number. The fallback is acceptable for B10 MVP because
  // LHDN does not verify the telephone at Bahagian A entry; future
  // user-review collection should prompt for a real value before
  // Hantar.
  const mobileR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.mobile,
    attemptedAt,
    "mobile"
  );
  if (!mobileR.ok) return { ...mobileR.result, preRowCount };
  try {
    await mobileR.locator.fill(payload.telephoneValue, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "mobile",
      preRowCount,
    });
  }

  // ── Step 7: click the modal Simpan button ──
  try {
    await saveLocator.click({ timeout: clickTimeout });
  } catch {
    return failed("modal_save_click_failed", attemptedAt, {
      failedFieldKey: "modal_save_button",
      preRowCount,
    });
  }

  // ── Step 8: bounded networkidle wait ──
  try {
    await page.waitForLoadState("networkidle", { timeout: postSaveWait });
  } catch {
    // Some bootbox commits stay client-side without triggering
    // network — non-fatal; row-count check below is the source of
    // truth.
  }

  // ── Step 9: post-click stabilization wait ──
  await sleep(postClickStabilization);

  // ── Step 10: post-save URL guard ──
  let postUrl: string;
  try {
    postUrl = page.url();
  } catch {
    return failed("post_save_verification_failed", attemptedAt, {
      failedFieldKey: "post_save_verification",
      preRowCount,
    });
  }
  const postPathKind = classifySupervisedSessionPath(postUrl);
  if (postPathKind !== "sewa_pajakan_p5_form") {
    return failed("post_save_verification_failed", attemptedAt, {
      failedFieldKey: "post_save_verification",
      preRowCount,
    });
  }

  // ── Step 11: verify landlord row count climbed by exactly 1 ──
  let postRowCount: number;
  try {
    postRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_3_LANDLORD_HEADING_MATCH,
    });
  } catch {
    return failed("post_save_verification_failed", attemptedAt, {
      failedFieldKey: "row_count_verification",
      preRowCount,
    });
  }
  if (postRowCount !== preRowCount + 1) {
    return failed("row_count_not_updated", attemptedAt, {
      failedFieldKey: "row_count_verification",
      preRowCount,
      postRowCount,
    });
  }

  return {
    status: "saved",
    reason: PHASE_3_LANDLORD_REASON_LABELS.saved,
    attemptedAt,
    savedAt: (opts.now ?? defaultNow)(),
    postSavePathKind: postPathKind,
    preRowCount,
    postRowCount,
    telephoneFallbackUsed: payload.telephoneFallbackUsed,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Bounded poll for a selector to resolve AND become visible. Used
 * by the legacy identity-cascade wait step (kept for compatibility).
 * Returns `true` as soon as the element is visible, `false` on
 * timeout.
 */
async function waitForVisible(
  page: Phase3PageLike,
  selector: string,
  totalTimeoutMs: number,
  pollIntervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    const loc = page.locator(selector);
    let count = 0;
    try {
      count = await loc.count();
    } catch {
      count = 0;
    }
    if (count >= 1) {
      let visible = false;
      try {
        visible = await loc.isVisible({ timeout: pollIntervalMs });
      } catch {
        visible = false;
      }
      if (visible) return true;
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

/**
 * Outcome of `waitForIdentityResolution`.
 *   - `"tin_resolved"`     — the hidden `tb_cukai` field carries a
 *                            non-empty value (LHDN found the IC).
 *   - `"manual_fallback"`  — the gender radio became visible AND
 *                            tb_cukai stayed empty (LHDN did NOT
 *                            find the IC).
 *   - `"neither"`          — neither signal within the timeout.
 *
 * `tin_resolved` strictly wins when both signals fire — the
 * operator brief is explicit that the resolved-IC path skips
 * gender. If a future portal version exposes both, we still
 * prefer the resolved path.
 */
type IdentityResolutionOutcome =
  | "tin_resolved"
  | "manual_fallback"
  | "neither";

async function readTinHiddenValue(page: Phase3PageLike): Promise<string> {
  try {
    const loc = page.locator(PHASE_3_MODAL_FIELD_SELECTORS.tinHidden);
    const c = await loc.count();
    if (c === 0) return "";
    return (await loc.inputValue({ timeout: 500 })) ?? "";
  } catch {
    return "";
  }
}

async function isGenderRadioVisible(
  page: Phase3PageLike,
  genderRadioId: string
): Promise<boolean> {
  try {
    const loc = page.locator(`input#${genderRadioId}`);
    const c = await loc.count();
    if (c === 0) return false;
    return await loc.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

async function waitForIdentityResolution(
  page: Phase3PageLike,
  genderRadioId: string,
  totalTimeoutMs: number,
  pollIntervalMs: number
): Promise<IdentityResolutionOutcome> {
  const deadline = Date.now() + totalTimeoutMs;
  let sawGender = false;
  while (Date.now() < deadline) {
    // Probe TIN first — resolved-path takes priority.
    const tin = await readTinHiddenValue(page);
    if (tin && tin.length > 0) return "tin_resolved";
    // Probe gender visibility — sticky observation across polls so
    // a brief flash counts as fallback even if it later hides.
    if (!sawGender) {
      sawGender = await isGenderRadioVisible(page, genderRadioId);
    }
    await sleep(pollIntervalMs);
  }
  // Final check: TIN may have resolved on the last interval.
  const finalTin = await readTinHiddenValue(page);
  if (finalTin && finalTin.length > 0) return "tin_resolved";
  if (sawGender) return "manual_fallback";
  // Last-chance gender check (if it became visible on the last
  // polling interval).
  if (await isGenderRadioVisible(page, genderRadioId)) {
    return "manual_fallback";
  }
  return "neither";
}

// Re-export the registry so consumers don't need a second import.
export { BAHAGIAN_A_INDIVIDUAL_REGISTRY };
