/**
 * WeStamp — Tenancy Supervised Run · Phase 4 Bahagian B Fixed-Rent Save
 * (Milestone B12 · FOURTH mutation milestone)
 *
 * Tightly-scoped, fail-closed-by-default helper that performs the
 * **single** controlled portal mutation authorised by Milestone B12:
 *   - navigate to the Bahagian B tab on the live Sewa/Pajakan p5 form
 *   - select pds_jenis = "1103" (fixed-rent during tenancy)
 *   - open the "Tambah Tempoh Perjanjian" rent-period modal
 *   - fill exactly one fixed-rent period row (start, end, monthly rent)
 *   - click the modal "Tambah Bayaran" button to commit the row
 *   - click the section-level "Simpan Bahagian B" button exactly once
 *   - verify post-save the page is still on p5
 *   - stop
 *
 * What this module IS / IS NOT
 * ────────────────────────────
 * - IS: pure executor for ONE Bahagian B fixed-rent single-period
 *   save. Reuses the structural `Phase3PageLike` / `Phase3LocatorLike`
 *   interfaces and the supervised-session path classifier.
 * - IS NOT: anything Bahagian C / Lampiran / Perakuan / Hantar /
 *   payment / certificate / OCR / user-review related. The executor
 *   never touches selectors outside the Bahagian B tab anchor, the
 *   six observed Bahagian B selectors (pds_jenis, the rent-add
 *   trigger anchor, the modal date/rent inputs, the modal save
 *   button, and the section save button), and the post-save URL
 *   guard.
 * - DOES NOT modify Bahagian A rows. Anti-regression tests assert
 *   no role-scoped LANDLORD/TENANT trigger anchors are clicked.
 * - DOES NOT support variable-rent, amendment, or multi-period rent
 *   schedules. The preflight refuses on those paths with stable
 *   refusal codes.
 */

import {
  classifySupervisedSessionPath,
  type SupervisedSessionPathKind,
} from "./tenancy-supervised-session-path";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  PHASE_3_TAB_ANCHOR_TEXT,
  type Phase3LocatorLike,
  type Phase3PageLike,
  type Phase3SelectOptionTarget,
} from "./tenancy-phase-3-landlord-executor";
import type { StampingJob } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

export type Phase4BahagianBExecutionStatus =
  | "not_attempted"
  | "refused"
  | "started"
  | "saved"
  | "failed";

export type Phase4BahagianBRefusalReason =
  | "job_not_found"
  | "unsupported_lane"
  | "readiness_not_ready"
  | "instruction_graph_not_ready"
  | "maklumat_am_not_saved"
  /**
   * The Bahagian B save requires BOTH the landlord and tenant
   * Bahagian A rows to already be saved (B10 + B11). This code
   * surfaces when the supervised-run-session stage is below
   * `phase_3_tenant_individual_saved`.
   */
  | "bahagian_a_not_complete"
  /** Rent type is not `fixed_rent_during_tenancy`. B12 supports only that path. */
  | "unsupported_rent_type"
  /** Rent schedule has more than one period. */
  | "unsupported_multi_period"
  /** Job carries an amendment-flow marker (instrumentRelationship === "amendment"). */
  | "unsupported_amendment"
  | "supervised_session_missing"
  | "browser_not_reachable"
  | "browser_not_phase_compatible"
  | "p5_form_not_detected"
  | "bahagian_b_not_accessible"
  | "selector_missing"
  | "ambiguous_selector"
  | "option_missing"
  | "required_field_missing"
  | "fill_failed"
  | "rent_modal_open_failed"
  | "rent_modal_save_click_failed"
  | "rent_row_not_added"
  | "save_button_missing"
  | "save_click_failed"
  | "save_wait_failed"
  | "post_save_verification_failed"
  | "save_failed";

export type Phase4BahagianBFailedFieldKey =
  | "bahagian_b_tab"
  | "pds_jenis"
  | "rent_add_trigger"
  | "rent_modal_open"
  | "rent_modal_start_date"
  | "rent_modal_end_date"
  | "rent_modal_monthly_rent"
  | "rent_modal_save_button"
  | "rent_row_count"
  | "section_save_button"
  | "post_save_verification";

export interface Phase4BahagianBExecutionResult {
  status: Phase4BahagianBExecutionStatus;
  refusalReason?: Phase4BahagianBRefusalReason;
  reason: string;
  attemptedAt: string;
  savedAt?: string;
  postSavePathKind?: SupervisedSessionPathKind;
  failedFieldKey?: Phase4BahagianBFailedFieldKey;
  /** Pre-mutation rent-table row count. Captured BEFORE the rent-add modal. */
  preRentRowCount?: number;
  /** Post-rent-modal-save rent-table row count. */
  postRentRowCount?: number;
  /**
   * Sanitized values written to the form. Operator-facing
   * diagnostic only — strings come from the captured job data, no
   * portal-side identifiers.
   */
  fieldsWritten?: {
    pdsJenisCode: string;
    rentStartDateDdMmYyyy: string;
    rentEndDateDdMmYyyy: string;
    monthlyRentValue: string;
  };
}

export interface Phase4BahagianBPayload {
  /** Always `"1103"` for fixed-rent during tenancy. */
  pdsJenisCode: "1103";
  /** Rent-period start date in dd/mm/yyyy. */
  rentStartDateDdMmYyyy: string;
  /** Rent-period end date in dd/mm/yyyy. */
  rentEndDateDdMmYyyy: string;
  /**
   * Monthly rent value as a plain numeric string (e.g. `"1000"` or
   * `"1500.50"`). The portal accepts comma-less decimal-dot input.
   */
  monthlyRentValue: string;
}

// ─── Public selector + label constants ─────────────────────────────

export const PHASE_4_TAB_ANCHOR_TEXT = "Bahagian B";

/** `select#pds_jenis` — same selector observed in B7 (was hidden then; visible in Bahagian B). */
export const PHASE_4_PDS_JENIS_SELECTOR = "select#pds_jenis";

/** Fixed-rent during tenancy portal code. */
export const PHASE_4_PDS_JENIS_FIXED_RENT_CODE = "1103";

/**
 * Rent-add trigger anchor. Plain `<a>` with no id/class — text-
 * scoped resolution only. The executor uses the structural
 * `clickRoleScopedAnchor` helper but with a Bahagian-B-legend
 * heading match.
 */
export const PHASE_4_RENT_ADD_TRIGGER_TEXT_PATTERN =
  "Klik untuk isi dan tambah maklumat amaun";

/** Heading-match for the Bahagian B legend. */
export const PHASE_4_BAHAGIAN_B_HEADING_MATCH = "B\\.\\s+MAKLUMAT.*SURAT CARA";

/** Rent-period modal selectors. */
export const PHASE_4_RENT_MODAL_SELECTORS = {
  startDate: "input#date_agreement_start",
  endDate: "input#date_agreement_end",
  monthlyRent: 'input[name="pds_premis"]',
  saveButton: '.bootbox.modal.in input[type="submit"]',
} as const;

/** Section-level Simpan button. */
export const PHASE_4_SECTION_SAVE_SELECTOR = "input#pdsL01_bhgn_b";

// ─── Reason labels ─────────────────────────────────────────────────

export const PHASE_4_BAHAGIAN_B_REASON_LABELS: Record<
  Phase4BahagianBExecutionStatus | Phase4BahagianBRefusalReason,
  string
> = {
  not_attempted: "Phase 4 Bahagian B fixed-rent save has not been attempted.",
  refused: "Phase 4 Bahagian B save refused before any portal contact.",
  started: "Phase 4 Bahagian B save attempt has started.",
  saved: "Bahagian B fixed-rent data saved.",
  failed: "Phase 4 Bahagian B save attempt failed mid-flight.",
  job_not_found: "Job record not found.",
  unsupported_lane: "Job is not on the Sewa/Pajakan supported path.",
  readiness_not_ready:
    "Job readiness verdict is not ready_for_supervised_run.",
  instruction_graph_not_ready:
    "Instruction graph verdict is not ready_for_supervised_run.",
  maklumat_am_not_saved:
    "Phase 2 Maklumat Am draft has not been saved yet.",
  bahagian_a_not_complete:
    "Both Bahagian A landlord and tenant rows must be saved before Bahagian B fixed-rent save.",
  unsupported_rent_type:
    "Bahagian B B12 milestone supports only fixed-rent during tenancy.",
  unsupported_multi_period:
    "Bahagian B B12 milestone supports only single-period rent schedules.",
  unsupported_amendment:
    "Bahagian B B12 milestone does not support amendment flows.",
  supervised_session_missing:
    "Supervised run session has not been prepared yet.",
  browser_not_reachable:
    "Operator's Chrome is not reachable on the configured CDP endpoint.",
  browser_not_phase_compatible:
    "Browser session is not compatible with Phase 4.",
  p5_form_not_detected:
    "No Sewa/Pajakan p5 form was detected in the operator's open Chrome pages.",
  bahagian_b_not_accessible:
    "The Bahagian B section could not be revealed on the live p5 form.",
  selector_missing:
    "A required Bahagian B selector did not resolve on the live form.",
  ambiguous_selector:
    "A required Bahagian B selector matched multiple elements.",
  option_missing:
    "A required `<option value>` code was not present in the live select.",
  required_field_missing:
    "A required Bahagian B field is missing or unmapped.",
  fill_failed:
    "A Bahagian B field fill / select failed before the save button was clicked.",
  rent_modal_open_failed:
    "Clicking the rent-add trigger did not open the Tambah Tempoh Perjanjian modal.",
  rent_modal_save_click_failed:
    "The rent-modal Tambah Bayaran button click failed.",
  rent_row_not_added:
    "The rent-modal save was clicked but the rent table did not gain a row.",
  save_button_missing:
    "The Simpan Bahagian B button was not found on the page.",
  save_click_failed:
    "The Simpan Bahagian B button was found but its click failed.",
  save_wait_failed:
    "The post-click network-idle wait failed or timed out.",
  post_save_verification_failed:
    "Post-save URL classification failed — the page is no longer the Sewa/Pajakan p5 form.",
  save_failed: "Phase 4 Bahagian B save failed (unspecified).",
};

// ─── Pure preflight ────────────────────────────────────────────────

export type Phase4BahagianBPreflightOutcome =
  | { ok: true }
  | { ok: false; refusalReason: Phase4BahagianBRefusalReason };

export function evaluatePhase4BahagianBPreflight(
  job: StampingJob
): Phase4BahagianBPreflightOutcome {
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
  // Stage gate hierarchy: Maklumat Am → landlord → tenant → Bahagian B.
  if (
    session.currentRunStage !== "phase_2_maklumat_am_saved" &&
    session.currentRunStage !== "phase_3_landlord_individual_saved" &&
    session.currentRunStage !== "phase_3_tenant_individual_saved" &&
    session.currentRunStage !== "phase_4_bahagian_b_fixed_rent_saved"
  ) {
    return { ok: false, refusalReason: "maklumat_am_not_saved" };
  }
  if (
    session.currentRunStage !== "phase_3_tenant_individual_saved" &&
    session.currentRunStage !== "phase_4_bahagian_b_fixed_rent_saved"
  ) {
    return { ok: false, refusalReason: "bahagian_a_not_complete" };
  }
  // Rent-type / multi-period / amendment guards.
  const instrument = job.tenancyPortalDetails?.instrument;
  if (!instrument) {
    return { ok: false, refusalReason: "required_field_missing" };
  }
  // Amendment path check FIRST — surfaces the most specific code.
  if (instrument.portalDescriptionType === "amendment_to_original_tenancy") {
    return { ok: false, refusalReason: "unsupported_amendment" };
  }
  if (instrument.portalDescriptionType !== "fixed_rent_during_tenancy") {
    return { ok: false, refusalReason: "unsupported_rent_type" };
  }
  const rentSchedule = instrument.rentSchedule ?? [];
  if (rentSchedule.length !== 1) {
    return { ok: false, refusalReason: "unsupported_multi_period" };
  }
  const period = rentSchedule[0];
  if (
    !period ||
    !period.startDate ||
    !period.endDate ||
    typeof period.monthlyRent !== "number" ||
    period.monthlyRent <= 0
  ) {
    return { ok: false, refusalReason: "required_field_missing" };
  }
  return { ok: true };
}

// ─── Pure payload builder ──────────────────────────────────────────

export type Phase4BahagianBPayloadResult =
  | { ok: true; payload: Phase4BahagianBPayload }
  | {
      ok: false;
      refusalReason: Phase4BahagianBRefusalReason;
      failedFieldKey?: Phase4BahagianBFailedFieldKey;
    };

/**
 * Build the Bahagian B fixed-rent payload from a job. Pure;
 * side-effect-free.
 */
export function buildPhase4BahagianBPayload(
  job: StampingJob
): Phase4BahagianBPayloadResult {
  const instrument = job.tenancyPortalDetails?.instrument;
  if (!instrument) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
    };
  }
  const rentSchedule = instrument.rentSchedule ?? [];
  if (rentSchedule.length !== 1) {
    return {
      ok: false,
      refusalReason: "unsupported_multi_period",
    };
  }
  const period = rentSchedule[0];
  const start = isoDateToDdMmYyyy(period.startDate);
  const end = isoDateToDdMmYyyy(period.endDate);
  if (!start) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "rent_modal_start_date",
    };
  }
  if (!end) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "rent_modal_end_date",
    };
  }
  if (typeof period.monthlyRent !== "number" || period.monthlyRent <= 0) {
    return {
      ok: false,
      refusalReason: "required_field_missing",
      failedFieldKey: "rent_modal_monthly_rent",
    };
  }
  return {
    ok: true,
    payload: {
      pdsJenisCode: PHASE_4_PDS_JENIS_FIXED_RENT_CODE,
      rentStartDateDdMmYyyy: start,
      rentEndDateDdMmYyyy: end,
      monthlyRentValue: formatRentNumeric(period.monthlyRent),
    },
  };
}

/**
 * Convert an ISO YYYY-MM-DD date string to dd/mm/yyyy. Returns
 * `null` on malformed input.
 */
export function isoDateToDdMmYyyy(iso: string | undefined): string | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2];
  const dd = m[3];
  if (
    Number(mm) < 1 ||
    Number(mm) > 12 ||
    Number(dd) < 1 ||
    Number(dd) > 31
  ) {
    return null;
  }
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format a numeric rent value as a comma-less decimal-dot string.
 * Integer values render without trailing `.00`. The live portal
 * accepts both `"1000"` and `"1000.50"`.
 */
export function formatRentNumeric(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

// ─── Executor ──────────────────────────────────────────────────────

export interface ExecutePhase4BahagianBOptions {
  page: Phase3PageLike;
  payload: Phase4BahagianBPayload;
  now?: () => string;
  fillTimeoutMs?: number;
  clickTimeoutMs?: number;
  selectTimeoutMs?: number;
  postSaveWaitMs?: number;
  postClickStabilizationMs?: number;
}

const DEFAULT_FILL_TIMEOUT_MS = 5000;
const DEFAULT_CLICK_TIMEOUT_MS = 5000;
const DEFAULT_SELECT_TIMEOUT_MS = 5000;
const DEFAULT_POST_SAVE_WAIT_MS = 15000;
const DEFAULT_POST_CLICK_STABILIZATION_MS = 1500;

function defaultNow(): string {
  return new Date().toISOString();
}

interface FailureEnrichment {
  failedFieldKey?: Phase4BahagianBFailedFieldKey;
  preRentRowCount?: number;
  postRentRowCount?: number;
  fieldsWritten?: Phase4BahagianBExecutionResult["fieldsWritten"];
}

function refused(
  reason: Phase4BahagianBRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase4BahagianBExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_4_BAHAGIAN_B_REASON_LABELS[reason],
    attemptedAt,
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.preRentRowCount !== undefined
      ? { preRentRowCount: enrichment.preRentRowCount }
      : {}),
    ...(enrichment.postRentRowCount !== undefined
      ? { postRentRowCount: enrichment.postRentRowCount }
      : {}),
  };
}

function failed(
  reason: Phase4BahagianBRefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase4BahagianBExecutionResult {
  return {
    status: "failed",
    refusalReason: reason,
    reason: PHASE_4_BAHAGIAN_B_REASON_LABELS[reason],
    attemptedAt,
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.preRentRowCount !== undefined
      ? { preRentRowCount: enrichment.preRentRowCount }
      : {}),
    ...(enrichment.postRentRowCount !== undefined
      ? { postRentRowCount: enrichment.postRentRowCount }
      : {}),
  };
}

async function requireUnique(
  page: Phase3PageLike,
  selector: string,
  attemptedAt: string,
  failedFieldKey: Phase4BahagianBFailedFieldKey
): Promise<
  | { ok: true; locator: Phase3LocatorLike }
  | { ok: false; result: Phase4BahagianBExecutionResult }
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

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Run the controlled Phase 4 Bahagian B fixed-rent save flow.
 *
 * Flow:
 *   1. Pre-mutation page-kind guard (URL → sewa_pajakan_p5_form)
 *   2. Click Bahagian B tab anchor
 *   3. Capture pre-save rent-table row count (in Bahagian B
 *      fieldset, scoped via `countTableRowsInRoleSection` with the
 *      Bahagian B heading match)
 *   4. Select pds_jenis = "1103"
 *   5. Click rent-add trigger anchor (text-scoped inside Bahagian B)
 *   6. Modal-open guard: rent-modal save button resolves
 *   7. Fill rent-modal fields (start date, end date, monthly rent)
 *   8. Click rent-modal save button (Tambah Bayaran)
 *   9. Verify rent-table row count climbed
 *   10. Click section-level Simpan Bahagian B
 *   11. Wait for networkidle
 *   12. Post-save URL guard (still p5)
 *   13. Return saved
 */
export async function executePhase4BahagianBSave(
  opts: ExecutePhase4BahagianBOptions
): Promise<Phase4BahagianBExecutionResult> {
  const attemptedAt = (opts.now ?? defaultNow)();
  const fillTimeout = opts.fillTimeoutMs ?? DEFAULT_FILL_TIMEOUT_MS;
  const clickTimeout = opts.clickTimeoutMs ?? DEFAULT_CLICK_TIMEOUT_MS;
  const selectTimeout = opts.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS;
  const postSaveWait = opts.postSaveWaitMs ?? DEFAULT_POST_SAVE_WAIT_MS;
  const postClickStabilization =
    opts.postClickStabilizationMs ?? DEFAULT_POST_CLICK_STABILIZATION_MS;
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

  // Step 2: navigate to Bahagian B tab
  try {
    await page.clickTabAnchor({
      text: PHASE_4_TAB_ANCHOR_TEXT,
      timeout: clickTimeout,
    });
  } catch {
    return refused("bahagian_b_not_accessible", attemptedAt, {
      failedFieldKey: "bahagian_b_tab",
    });
  }

  // Step 3: capture pre-save rent-table row count
  let preRentRowCount: number;
  try {
    preRentRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_4_BAHAGIAN_B_HEADING_MATCH,
    });
  } catch {
    return refused("bahagian_b_not_accessible", attemptedAt, {
      failedFieldKey: "bahagian_b_tab",
    });
  }

  // Step 4: select pds_jenis = "1103"
  const jenisR = await requireUnique(
    page,
    PHASE_4_PDS_JENIS_SELECTOR,
    attemptedAt,
    "pds_jenis"
  );
  if (!jenisR.ok) return { ...jenisR.result, preRentRowCount };
  try {
    await jenisR.locator.selectOption(
      { value: payload.pdsJenisCode } as Phase3SelectOptionTarget,
      { timeout: selectTimeout }
    );
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "pds_jenis",
      preRentRowCount,
    });
  }

  // Step 5: click rent-add trigger anchor (text-scoped inside Bahagian B fieldset)
  try {
    await page.clickRoleScopedAnchor({
      roleHeadingMatch: PHASE_4_BAHAGIAN_B_HEADING_MATCH,
      anchorText: PHASE_4_RENT_ADD_TRIGGER_TEXT_PATTERN,
      timeout: clickTimeout,
    });
  } catch {
    return failed("rent_modal_open_failed", attemptedAt, {
      failedFieldKey: "rent_add_trigger",
      preRentRowCount,
    });
  }

  // Step 6: modal-open guard
  const rentModalSaveR = await requireUnique(
    page,
    PHASE_4_RENT_MODAL_SELECTORS.saveButton,
    attemptedAt,
    "rent_modal_save_button"
  );
  if (!rentModalSaveR.ok) {
    return failed("rent_modal_open_failed", attemptedAt, {
      failedFieldKey: "rent_modal_open",
      preRentRowCount,
    });
  }
  const rentModalSaveLocator = rentModalSaveR.locator;

  // Step 7: fill rent-modal fields
  // 7a. Start date
  const startR = await requireUnique(
    page,
    PHASE_4_RENT_MODAL_SELECTORS.startDate,
    attemptedAt,
    "rent_modal_start_date"
  );
  if (!startR.ok) return { ...startR.result, preRentRowCount };
  try {
    await startR.locator.fill(payload.rentStartDateDdMmYyyy, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "rent_modal_start_date",
      preRentRowCount,
    });
  }

  // 7b. End date
  const endR = await requireUnique(
    page,
    PHASE_4_RENT_MODAL_SELECTORS.endDate,
    attemptedAt,
    "rent_modal_end_date"
  );
  if (!endR.ok) return { ...endR.result, preRentRowCount };
  try {
    await endR.locator.fill(payload.rentEndDateDdMmYyyy, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "rent_modal_end_date",
      preRentRowCount,
    });
  }

  // 7c. Monthly rent
  const rentR = await requireUnique(
    page,
    PHASE_4_RENT_MODAL_SELECTORS.monthlyRent,
    attemptedAt,
    "rent_modal_monthly_rent"
  );
  if (!rentR.ok) return { ...rentR.result, preRentRowCount };
  try {
    await rentR.locator.fill(payload.monthlyRentValue, {
      timeout: fillTimeout,
    });
  } catch {
    return failed("fill_failed", attemptedAt, {
      failedFieldKey: "rent_modal_monthly_rent",
      preRentRowCount,
    });
  }

  // Tab off the rent field to fire any onblur calculation.
  try {
    await rentR.locator.press("Tab", { timeout: clickTimeout });
  } catch {
    // non-fatal — the next click will fire the same blur cascade
  }
  // Brief settle.
  await sleep(400);

  // Step 8: click rent-modal save (Tambah Bayaran)
  try {
    await rentModalSaveLocator.click({ timeout: clickTimeout });
  } catch {
    return failed("rent_modal_save_click_failed", attemptedAt, {
      failedFieldKey: "rent_modal_save_button",
      preRentRowCount,
    });
  }

  // Stabilize after rent-modal close.
  await sleep(postClickStabilization);

  // Step 9: verify rent row count climbed
  let postRentRowCount: number;
  try {
    postRentRowCount = await page.countTableRowsInRoleSection({
      roleHeadingMatch: PHASE_4_BAHAGIAN_B_HEADING_MATCH,
    });
  } catch {
    return failed("rent_row_not_added", attemptedAt, {
      failedFieldKey: "rent_row_count",
      preRentRowCount,
    });
  }
  if (postRentRowCount <= preRentRowCount) {
    return failed("rent_row_not_added", attemptedAt, {
      failedFieldKey: "rent_row_count",
      preRentRowCount,
      postRentRowCount,
    });
  }

  // Step 10: click section-level Simpan Bahagian B
  const sectionSaveR = await requireUnique(
    page,
    PHASE_4_SECTION_SAVE_SELECTOR,
    attemptedAt,
    "section_save_button"
  );
  if (!sectionSaveR.ok) {
    // Re-shape the result to use save_button_missing.
    return failed("save_button_missing", attemptedAt, {
      failedFieldKey: "section_save_button",
      preRentRowCount,
      postRentRowCount,
    });
  }
  try {
    await sectionSaveR.locator.click({ timeout: clickTimeout });
  } catch {
    return failed("save_click_failed", attemptedAt, {
      failedFieldKey: "section_save_button",
      preRentRowCount,
      postRentRowCount,
    });
  }

  // Step 11: networkidle wait
  try {
    await page.waitForLoadState("networkidle", { timeout: postSaveWait });
  } catch {
    return failed("save_wait_failed", attemptedAt, {
      failedFieldKey: "post_save_verification",
      preRentRowCount,
      postRentRowCount,
    });
  }

  await sleep(postClickStabilization);

  // Step 12: post-save URL guard
  let postUrl: string;
  try {
    postUrl = page.url();
  } catch {
    return failed("post_save_verification_failed", attemptedAt, {
      failedFieldKey: "post_save_verification",
      preRentRowCount,
      postRentRowCount,
    });
  }
  const postPathKind = classifySupervisedSessionPath(postUrl);
  if (postPathKind !== "sewa_pajakan_p5_form") {
    return failed("post_save_verification_failed", attemptedAt, {
      failedFieldKey: "post_save_verification",
      preRentRowCount,
      postRentRowCount,
    });
  }

  return {
    status: "saved",
    reason: PHASE_4_BAHAGIAN_B_REASON_LABELS.saved,
    attemptedAt,
    savedAt: (opts.now ?? defaultNow)(),
    postSavePathKind: postPathKind,
    preRentRowCount,
    postRentRowCount,
    fieldsWritten: {
      pdsJenisCode: payload.pdsJenisCode,
      rentStartDateDdMmYyyy: payload.rentStartDateDdMmYyyy,
      rentEndDateDdMmYyyy: payload.rentEndDateDdMmYyyy,
      monthlyRentValue: payload.monthlyRentValue,
    },
  };
}

// Re-export the tab anchor text from B10 for symmetry.
export { PHASE_3_TAB_ANCHOR_TEXT };
