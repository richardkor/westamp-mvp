/**
 * WeStamp — Tenancy Supervised Run · Phase 3 Tenant-Individual Row Executor
 * (Milestone B11 · THIRD mutation milestone)
 *
 * Tightly-scoped, fail-closed-by-default helper that performs the
 * **single** controlled portal mutation authorised by Milestone B11:
 *   - navigate to the Bahagian A tab on the live Sewa/Pajakan p5 form
 *   - capture the pre-save tenant row count
 *   - open the Tambah Individu modal scoped to the TENANT fieldset
 *   - fill the captured tenant-individual party fields
 *     (identity-resolution-first path; skip gender/DOB on resolved IC)
 *   - click the modal Simpan button exactly once
 *   - verify the tenant row count climbed by exactly 1
 *   - stop
 *
 * Reuses every public constant + type the B10 landlord executor
 * exports (modal selectors, fallbacks, postcode pattern, locator/
 * page-like interfaces, etc.) — only the role-scoped resolution
 * algorithm and the preflight rules differ between roles.
 *
 * What this module IS / IS NOT
 * ────────────────────────────
 * - IS: pure executor for ONE tenant-individual row save.
 * - IS NOT: anything Bahagian B / C / Lampiran / Perakuan / Hantar /
 *   payment / certificate / OCR / user-review related. The executor
 *   never touches selectors outside the tab anchor, the tenant
 *   trigger, the modal field surface, the modal Simpan button, and
 *   the tenant-table row counter.
 * - DOES NOT save another landlord row, company row, or any other
 *   subsequent party.
 */

import {
  classifySupervisedSessionPath,
  type SupervisedSessionPathKind,
} from "./tenancy-supervised-session-path";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  deriveDobFromIcBaru,
  PHASE_3_ADDRESS_LINE_1_FALLBACK_VALUE,
  PHASE_3_ADDRESS_LINE_2_FALLBACK_VALUE,
  PHASE_3_MODAL_FIELD_SELECTORS,
  PHASE_3_MODAL_SAVE_SELECTOR,
  PHASE_3_POSTCODE_PATTERN,
  PHASE_3_TAB_ANCHOR_TEXT,
  PHASE_3_TELEPHONE_FALLBACK_VALUE,
  type Phase3LocatorLike,
  type Phase3PageLike,
  type Phase3SelectOptionTarget,
} from "./tenancy-phase-3-landlord-executor";
import type { StampingJob, TenancyPortalParty } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

export type Phase3TenantExecutionStatus =
  | "not_attempted"
  | "refused"
  | "started"
  | "saved"
  | "failed";

export type Phase3TenantRefusalReason =
  | "job_not_found"
  | "unsupported_lane"
  | "readiness_not_ready"
  | "instruction_graph_not_ready"
  | "maklumat_am_not_saved"
  /**
   * The tenant row save requires the landlord row to already be
   * saved (per the B10 milestone). This code surfaces when the
   * supervised-run-session stage is below
   * `phase_3_landlord_individual_saved`.
   */
  | "landlord_row_not_saved"
  | "supervised_session_missing"
  | "browser_not_reachable"
  | "browser_not_phase_compatible"
  | "p5_form_not_detected"
  | "bahagian_a_not_accessible"
  | "tenant_individual_party_missing"
  | "tenant_individual_trigger_missing"
  | "modal_not_opened"
  | "required_field_missing"
  | "selector_missing"
  | "ambiguous_selector"
  | "option_missing"
  | "fill_failed"
  | "identity_resolution_failed"
  | "manual_identity_fallback_required"
  | "modal_save_missing"
  | "modal_save_click_failed"
  | "row_count_not_updated"
  | "post_save_verification_failed"
  | "save_failed";

export type Phase3TenantFailedFieldKey =
  | "tenant_party"
  | "bahagian_a_tab"
  | "tenant_individual_trigger"
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

export interface Phase3TenantExecutionResult {
  status: Phase3TenantExecutionStatus;
  refusalReason?: Phase3TenantRefusalReason;
  reason: string;
  attemptedAt: string;
  savedAt?: string;
  postSavePathKind?: SupervisedSessionPathKind;
  failedFieldKey?: Phase3TenantFailedFieldKey;
  preRowCount?: number;
  postRowCount?: number;
  expectedOptionValue?: string;
  /**
   * Operator-facing diagnostic mirroring the B10 landlord
   * executor: true iff the executor used the `"0"` fallback for
   * the telephone field rather than `party.mobile`.
   */
  telephoneFallbackUsed?: boolean;
}

export interface Phase3TenantPayload {
  party: TenancyPortalParty;
  citizenshipPortalCode: string;
  nricSubTypeRadioId: string;
  genderRadioId: string;
  dateOfBirthDdMmYyyy?: string;
  statePortalCode: string;
  countryLabel: string;
  telephoneValue: string;
  telephoneFallbackUsed: boolean;
  addressLine1Value: string;
  addressLine1FallbackUsed: boolean;
  addressLine2Value: string;
  addressLine2FallbackUsed: boolean;
  postcodeValue: string;
}

// ─── Tenant-specific constants ─────────────────────────────────────

export const PHASE_3_TENANT_HEADING_MATCH = "TENANT|PENYEWA";

/** Same anchor label the landlord modal uses, scoped to the TENANT fieldset. */
export const PHASE_3_TENANT_TRIGGER_TEXT = "Individu";

// ─── Reason labels ─────────────────────────────────────────────────

export const PHASE_3_TENANT_REASON_LABELS: Record<
  Phase3TenantExecutionStatus | Phase3TenantRefusalReason,
  string
> = {
  not_attempted: "Phase 3 tenant-individual row save has not been attempted.",
  refused: "Phase 3 tenant-individual save refused before any portal contact.",
  started: "Phase 3 tenant-individual save attempt has started.",
  saved: "Tenant-individual row saved.",
  failed: "Phase 3 tenant-individual save attempt failed mid-flight.",
  job_not_found: "Job record not found.",
  unsupported_lane: "Job is not on the Sewa/Pajakan supported path.",
  readiness_not_ready:
    "Job readiness verdict is not ready_for_supervised_run.",
  instruction_graph_not_ready:
    "Instruction graph verdict is not ready_for_supervised_run.",
  maklumat_am_not_saved:
    "Phase 2 Maklumat Am draft has not been saved yet — save it before attempting a Bahagian A tenant row.",
  landlord_row_not_saved:
    "Bahagian A landlord-individual row has not been saved yet — save it before attempting the tenant row.",
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
  tenant_individual_party_missing:
    "No individual tenant party is captured on the job.",
  tenant_individual_trigger_missing:
    "The tenant-side `Individu` trigger anchor was not found inside the TENANT fieldset.",
  modal_not_opened:
    "Clicking the tenant trigger did not open a Tambah modal.",
  required_field_missing:
    "A required tenant-individual field is missing or unmapped.",
  selector_missing:
    "A required modal field selector did not resolve on the live form.",
  ambiguous_selector:
    "A required modal field selector matched multiple elements.",
  option_missing:
    "A required `<option value>` code was not present in the live select. No portal interaction occurred for this field.",
  fill_failed:
    "A modal fill / select / radio click failed before the Simpan button was clicked.",
  identity_resolution_failed:
    "The IC was filled but neither the portal's TIN auto-resolution nor the invalid-IC fallback signal appeared within the bounded wait. No portal row was committed.",
  manual_identity_fallback_required:
    "The portal could not auto-resolve the IC against LHDN. Manual fallback entry (gender, date of birth, free-text TIN) is required and is NOT automated by this milestone. No portal row was committed.",
  modal_save_missing:
    "The modal Simpan button was not found inside the open bootbox modal.",
  modal_save_click_failed:
    "The modal Simpan button was found but its click failed.",
  row_count_not_updated:
    "Modal Simpan was clicked but the tenant table row count did not climb by exactly 1 — the row may NOT have been saved.",
  post_save_verification_failed:
    "Post-save URL classification failed — the page is no longer the Sewa/Pajakan p5 form.",
  save_failed: "Phase 3 tenant save failed (unspecified).",
};

// ─── Pure preflight ────────────────────────────────────────────────

export type Phase3TenantPreflightOutcome =
  | { ok: true; party: TenancyPortalParty }
  | { ok: false; refusalReason: Phase3TenantRefusalReason };

/**
 * Pure pre-CDP preflight. Refuses before any browser contact when:
 *   - the job is not tenancy_agreement
 *   - readiness / instruction-graph verdicts are not ready
 *   - the supervised run session doesn't exist
 *   - Phase 2 Maklumat Am is not yet saved
 *   - **Phase 3 landlord row is not yet saved** (B10 dependency)
 *   - no individual tenant is captured on the job
 *   - any required tenant-individual field is missing
 *
 * Stage rule: the run-session stage must be EXACTLY
 * `phase_3_landlord_individual_saved` for this preflight to pass.
 * `phase_3_tenant_individual_saved` is also acceptable (idempotent
 * already-saved attempt would have its own dedup); higher stages
 * indicate the row was already saved AND a later phase advanced.
 * For B11 we accept both.
 */
export function evaluatePhase3TenantPreflight(
  job: StampingJob
): Phase3TenantPreflightOutcome {
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
  // Stage gate: Maklumat Am saved → required.
  if (
    session.currentRunStage !== "phase_2_maklumat_am_saved" &&
    session.currentRunStage !== "phase_3_landlord_individual_saved" &&
    session.currentRunStage !== "phase_3_tenant_individual_saved"
  ) {
    return { ok: false, refusalReason: "maklumat_am_not_saved" };
  }
  // Stage gate: landlord row saved → required.
  if (
    session.currentRunStage !== "phase_3_landlord_individual_saved" &&
    session.currentRunStage !== "phase_3_tenant_individual_saved"
  ) {
    return { ok: false, refusalReason: "landlord_row_not_saved" };
  }
  // Tenant-individual presence guard.
  const parties = job.tenancyPortalDetails?.parties ?? [];
  const tenant = parties.find(
    (p) => p.role === "tenant" && p.type === "individual"
  );
  if (!tenant) {
    return { ok: false, refusalReason: "tenant_individual_party_missing" };
  }
  const missing = collectMissingTenantFields(tenant);
  if (missing.length > 0) {
    return { ok: false, refusalReason: "required_field_missing" };
  }
  return { ok: true, party: tenant };
}

export function collectMissingTenantFields(
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

function resolveStatePortalCode(stateValue: string): string | null {
  const v = stateValue.trim().toLowerCase();
  if (!v) return null;
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

export type Phase3TenantPayloadResult =
  | { ok: true; payload: Phase3TenantPayload }
  | {
      ok: false;
      refusalReason: Phase3TenantRefusalReason;
      failedFieldKey?: Phase3TenantFailedFieldKey;
    };

export function buildPhase3TenantPayload(
  party: TenancyPortalParty
): Phase3TenantPayloadResult {
  const citizenshipPortalCode =
    party.citizenshipCategory && CITIZENSHIP_TO_WARGA[party.citizenshipCategory];
  if (!citizenshipPortalCode) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "citizenshipCategory",
    };
  }
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
  const genderRadioId = party.gender && GENDER_TO_RADIO_ID[party.gender];
  if (!genderRadioId) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "gender",
    };
  }
  const dateOfBirthDdMmYyyy: string | undefined =
    party.nricSubType === "ic_baru"
      ? deriveDobFromIcBaru(party.identityNumber ?? "") ?? undefined
      : undefined;
  const statePortalCode = resolveStatePortalCode(party.state);
  if (!statePortalCode) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "state",
    };
  }
  const countryLabel = (party.country ?? "").trim().toUpperCase();
  if (!countryLabel) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "country",
    };
  }
  const partyMobile = (party.mobile ?? "").trim();
  const telephoneValue: string =
    partyMobile.length > 0 ? partyMobile : PHASE_3_TELEPHONE_FALLBACK_VALUE;
  const telephoneFallbackUsed = partyMobile.length === 0;
  const partyAddr1 = (party.addressLine1 ?? "").trim();
  const addressLine1Value: string =
    partyAddr1.length > 0
      ? partyAddr1
      : PHASE_3_ADDRESS_LINE_1_FALLBACK_VALUE;
  const addressLine1FallbackUsed = partyAddr1.length === 0;
  const partyAddr2 = (party.addressLine2 ?? "").trim();
  const addressLine2Value: string =
    partyAddr2.length > 0
      ? partyAddr2
      : PHASE_3_ADDRESS_LINE_2_FALLBACK_VALUE;
  const addressLine2FallbackUsed = partyAddr2.length === 0;
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

// ─── Executor ──────────────────────────────────────────────────────

export interface ExecutePhase3TenantOptions {
  page: Phase3PageLike;
  payload: Phase3TenantPayload;
  now?: () => string;
  fillTimeoutMs?: number;
  clickTimeoutMs?: number;
  selectTimeoutMs?: number;
  postSaveWaitMs?: number;
  postClickStabilizationMs?: number;
  identityResolutionWaitMs?: number;
}

const DEFAULT_FILL_TIMEOUT_MS = 5000;
const DEFAULT_CLICK_TIMEOUT_MS = 5000;
const DEFAULT_SELECT_TIMEOUT_MS = 5000;
const DEFAULT_POST_SAVE_WAIT_MS = 15000;
const DEFAULT_POST_CLICK_STABILIZATION_MS = 1500;
const DEFAULT_IDENTITY_RESOLUTION_WAIT_MS = 8000;
const IDENTITY_RESOLUTION_POLL_INTERVAL_MS = 200;

function defaultNow(): string {
  return new Date().toISOString();
}

interface FailureEnrichment {
  failedFieldKey?: Phase3TenantFailedFieldKey;
  expectedOptionValue?: string;
  preRowCount?: number;
  postRowCount?: number;
}

function refused(
  reason: Phase3TenantRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase3TenantExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_3_TENANT_REASON_LABELS[reason],
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
  reason: Phase3TenantRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase3TenantExecutionResult {
  return {
    status: "failed",
    refusalReason: reason,
    reason: PHASE_3_TENANT_REASON_LABELS[reason],
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
  failedFieldKey: Phase3TenantFailedFieldKey
): Promise<
  | { ok: true; locator: Phase3LocatorLike }
  | { ok: false; result: Phase3TenantExecutionResult }
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
    const tin = await readTinHiddenValue(page);
    if (tin && tin.length > 0) return "tin_resolved";
    if (!sawGender) {
      sawGender = await isGenderRadioVisible(page, genderRadioId);
    }
    await sleep(pollIntervalMs);
  }
  const finalTin = await readTinHiddenValue(page);
  if (finalTin && finalTin.length > 0) return "tin_resolved";
  if (sawGender) return "manual_fallback";
  if (await isGenderRadioVisible(page, genderRadioId)) {
    return "manual_fallback";
  }
  return "neither";
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Run the controlled Phase 3 tenant-individual row save against a
 * Page-like surface. Mirror of the B10 landlord executor with two
 * differences:
 *   - role-scoped resolution targets `TENANT|PENYEWA` headings
 *   - the executor's selector-allow-list is otherwise identical
 *     (modal field surface is shared between the two roles' modals)
 */
export async function executePhase3TenantIndividualSave(
  opts: ExecutePhase3TenantOptions
): Promise<Phase3TenantExecutionResult> {
  const attemptedAt = (opts.now ?? defaultNow)();
  const fillTimeout = opts.fillTimeoutMs ?? DEFAULT_FILL_TIMEOUT_MS;
  const clickTimeout = opts.clickTimeoutMs ?? DEFAULT_CLICK_TIMEOUT_MS;
  const selectTimeout = opts.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS;
  const postSaveWait = opts.postSaveWaitMs ?? DEFAULT_POST_SAVE_WAIT_MS;
  const postClickStabilization =
    opts.postClickStabilizationMs ?? DEFAULT_POST_CLICK_STABILIZATION_MS;
  const identityResolutionWait =
    opts.identityResolutionWaitMs ?? DEFAULT_IDENTITY_RESOLUTION_WAIT_MS;
  const { page, payload } = opts;

  // Step 1: pre-mutation page-kind guard
  let preUrl: string;
  try {
    preUrl = page.url();
  } catch {
    return refused("p5_form_not_detected", attemptedAt);
  }
  if (classifySupervisedSessionPath(preUrl) !== "sewa_pajakan_p5_form") {
    return refused("p5_form_not_detected", attemptedAt);
  }

  // Step 2: navigate to the Bahagian A tab
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

  // Step 3: capture pre-save tenant row count
  let preRowCount: number;
  try {
    preRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_3_TENANT_HEADING_MATCH,
    });
  } catch {
    return refused("bahagian_a_not_accessible", attemptedAt, {
      failedFieldKey: "bahagian_a_tab",
    });
  }

  // Step 4: open the tenant-individual modal
  try {
    await page.clickRoleScopedAnchor({
      roleHeadingMatch: PHASE_3_TENANT_HEADING_MATCH,
      anchorText: PHASE_3_TENANT_TRIGGER_TEXT,
      timeout: clickTimeout,
    });
  } catch {
    return refused("tenant_individual_trigger_missing", attemptedAt, {
      failedFieldKey: "tenant_individual_trigger",
      preRowCount,
    });
  }

  // Step 5: confirm the modal opened
  const saveR = await requireUnique(
    page,
    PHASE_3_MODAL_SAVE_SELECTOR,
    attemptedAt,
    "modal_save_button"
  );
  if (!saveR.ok) {
    return failed("modal_not_opened", attemptedAt, {
      failedFieldKey: "modal_open",
      preRowCount,
    });
  }
  const saveLocator = saveR.locator;

  // Step 6: fill the modal fields (same cascade as landlord)
  const party = payload.party;

  // 6a. Name
  const nameR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.name,
    attemptedAt,
    "nameAsPerInstrument"
  );
  if (!nameR.ok) return { ...nameR.result, preRowCount };
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

  // 6b. warga
  const wargaR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.warga,
    attemptedAt,
    "citizenshipCategory"
  );
  if (!wargaR.ok) return { ...wargaR.result, preRowCount };
  try {
    await wargaR.locator.selectOption(
      { value: payload.citizenshipPortalCode } as Phase3SelectOptionTarget,
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "citizenshipCategory",
      expectedOptionValue: payload.citizenshipPortalCode,
      preRowCount,
    });
  }

  // 6c. NRIC sub-type radio
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

  // 6d. kpin
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

  // 6d.1: identity-resolution-first cascade trigger
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
  // resolution === "tin_resolved" — skip gender + DOB.

  // 6g. addressLine1
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

  // 6h. addressLine2 (mandatory, always fills)
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

  // 6i. postcode
  const pcR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.postcode,
    attemptedAt,
    "postcode"
  );
  if (!pcR.ok) return { ...pcR.result, preRowCount };
  try {
    await pcR.locator.fill(payload.postcodeValue, { timeout: fillTimeout });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "postcode",
      preRowCount,
    });
  }

  // 6j. city
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

  // 6k. state
  const stateR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.state,
    attemptedAt,
    "state"
  );
  if (!stateR.ok) return { ...stateR.result, preRowCount };
  try {
    await stateR.locator.selectOption(
      { value: payload.statePortalCode } as Phase3SelectOptionTarget,
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "state",
      expectedOptionValue: payload.statePortalCode,
      preRowCount,
    });
  }

  // 6l. country (by label)
  const countryR = await requireUnique(
    page,
    PHASE_3_MODAL_FIELD_SELECTORS.country,
    attemptedAt,
    "country"
  );
  if (!countryR.ok) return { ...countryR.result, preRowCount };
  try {
    await countryR.locator.selectOption(
      { label: payload.countryLabel } as Phase3SelectOptionTarget,
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "country",
      preRowCount,
    });
  }

  // 6m. mobile / No. Telefon (mandatory; fallback "0")
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

  // Step 7: click the modal Simpan button
  try {
    await saveLocator.click({ timeout: clickTimeout });
  } catch {
    return failed("modal_save_click_failed", attemptedAt, {
      failedFieldKey: "modal_save_button",
      preRowCount,
    });
  }

  // Step 8: bounded networkidle wait (non-fatal)
  try {
    await page.waitForLoadState("networkidle", { timeout: postSaveWait });
  } catch {
    // non-fatal
  }

  // Step 9: post-click stabilization wait
  await sleep(postClickStabilization);

  // Step 10: post-save URL guard
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

  // Step 11: verify tenant row count climbed by exactly 1
  let postRowCount: number;
  try {
    postRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_3_TENANT_HEADING_MATCH,
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
    reason: PHASE_3_TENANT_REASON_LABELS.saved,
    attemptedAt,
    savedAt: (opts.now ?? defaultNow)(),
    postSavePathKind: postPathKind,
    preRowCount,
    postRowCount,
    telephoneFallbackUsed: payload.telephoneFallbackUsed,
  };
}
