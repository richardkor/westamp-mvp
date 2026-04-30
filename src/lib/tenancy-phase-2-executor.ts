/**
 * WeStamp — Tenancy Supervised Run · Phase 2 Maklumat Am Executor
 * (Milestone B7 · FIRST mutation milestone)
 *
 * Tightly-scoped, fail-closed-by-default helper that performs the
 * **single** controlled portal mutation authorized by Milestone B7:
 *   - select pds_suratcara on the Sewa/Pajakan p5 form
 *   - capture a sanitized hidden-field snapshot of the rest of
 *     Maklumat Am (pds_jenis / pds_salinan / pds_date_suratcara)
 *   - click Simpan Maklumat Am exactly once
 *   - verify the post-save URL still classifies as
 *     `sewa_pajakan_p5_form`
 *   - stop
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the Phase 2 result type, the
 *   pure preflight check (`evaluatePhase2Preflight`), the pure
 *   payload builder (`buildPhase2MaklumatAmPayload`), and the
 *   guarded executor (`executePhase2MaklumatAmSave`).
 * - The fixed-vocabulary refusal/failure code surface for the
 *   Phase 2 route to translate into safe operator-facing messages.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT perform Bahagian A / B / C / Lampiran / Perakuan /
 *   Hantar / payment / certificate-retrieval actions. The executor
 *   touches ONLY the single visible Maklumat Am control listed in
 *   `PHASE_2_FIELD_SELECTORS` (`pds_suratcara`) and the single
 *   `Simpan Maklumat Am` button.
 * - It does NOT navigate the operator's browser, open new pages,
 *   close pages, or change tabs.
 * - It does NOT read cookies, storage state, tokens, or
 *   `lhdnmsstoken`.
 * - It does NOT write hidden portal-managed fields, ever — no
 *   `force: true`, no JS-evaluate write, no DOM mutation. Hidden
 *   fields are read-only from the executor's point of view.
 * - It does NOT log field VALUES — only field-name presence /
 *   count / category diagnostics with stable enums.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print
 *   logic.
 *
 * Read-only-by-default
 * ────────────────────
 * The executor is invoked ONLY after the route has verified every
 * precondition listed in the B7 brief. If any precondition is
 * missing the executor is never called. Inside the executor, every
 * selector resolution is checked for uniqueness (count === 1)
 * before any selectOption / click — ambiguous matches fail closed
 * with `ambiguous_selector`.
 *
 * Sensitive-data policy
 * ─────────────────────
 * The serialized `Phase2ExecutionResult` contains ONLY:
 *   - the fixed enum values (`status`, `refusalReason`)
 *   - ISO 8601 timestamps
 *   - a path-shape enum (`postSavePathKind`)
 *   - a fixed-vocabulary `reason` string built from a closed map
 *   - a sanitized hidden-field snapshot (presence / visibility /
 *     selected-value-CATEGORY / option-existence / value-length)
 *
 * The result NEVER stores: raw URLs, hrefs, query strings, hashes,
 * cookies, tokens, `lhdnmsstoken`, IC numbers, TINs, firm IDs,
 * party names, addresses, raw exception text / stacks, uploaded
 * document content, raw option labels, raw select values, raw
 * date string values, or any field VALUE submitted to the portal.
 */

import {
  classifySupervisedSessionPath,
  type SupervisedSessionPathKind,
} from "./tenancy-supervised-session-path";
import {
  compileTenancyPortalPayload,
  type TenancyPortalPayloadJobInput,
} from "./tenancy-portal-payload";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import { canApproveFirstMutation } from "./tenancy-supervised-run-session";
import type { StampingJob } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

/** Top-level execution status. */
export type Phase2ExecutionStatus =
  | "not_attempted"
  | "refused"
  | "started"
  | "saved"
  | "failed";

/**
 * Stable, machine-readable refusal/failure codes. The route +
 * operator UI map each code to a fixed-vocabulary safe sentence.
 *
 * **B7 third-attempt patch — failure-code granularity:** the
 * single broad `save_failed` was split into four phase-specific
 * codes (`save_fill_failed`, `save_click_failed`, `save_wait_failed`,
 * `post_save_verification_failed`) so an operator inspecting a
 * refusal can tell which step inside the save sequence failed
 * without leaking portal HTML or stack traces. `save_failed` is
 * kept ONLY as a defence-in-depth fallback — under normal flow
 * the executor always returns one of the four specific codes.
 *
 * **B7 fourth-attempt patch — option-value preflight:**
 * `required_option_missing` was added so the executor can refuse
 * BEFORE any selectOption is called when the required pds_suratcara
 * `<option value>` code is not present in the live `<select>`.
 */
export type Phase2RefusalReason =
  | "job_not_found"
  | "unsupported_lane"
  | "readiness_not_ready"
  | "instruction_graph_not_ready"
  | "supervised_session_missing"
  | "first_mutation_not_approved"
  | "browser_not_reachable"
  | "browser_not_phase_compatible"
  | "p5_form_not_detected"
  | "required_field_missing"
  | "selector_missing"
  | "ambiguous_selector"
  | "save_button_missing"
  | "required_option_missing"
  | "save_fill_failed"
  | "save_click_failed"
  | "save_wait_failed"
  | "save_failed"
  | "post_save_verification_failed";

/**
 * Stable, sanitized field-key enum carried on a `Phase2ExecutionResult`
 * to identify exactly which step inside the save sequence
 * failed. After the B7 sixth-attempt evidence patch, the only
 * writable Maklumat Am control on the live Sewa/Pajakan p5 surface
 * is `pds_suratcara`. The other Maklumat Am fields are hidden /
 * portal-managed and the executor never writes them — so the
 * failure-key surface is correspondingly narrow:
 *   - `pds_suratcara` for the single visible select fill failure
 *   - `save_button` for click failures
 *   - `post_save_verification` for the final URL-classifier step
 *
 * No portal-side-only identifiers, no HTML element ids, no
 * sensitive values — only stable WeStamp-internal field keys.
 */
export type Phase2FailedFieldKey =
  | "pds_suratcara"
  | "save_button"
  | "post_save_verification";

/**
 * Categorical descriptor of a `<select>` element's currently-selected
 * value. The raw value string is NEVER carried — only the category.
 *   - `empty`         — `value === ""`
 *   - `code_like`     — value matches `[A-Za-z0-9_-]+` (portal-
 *                       canonical code shape, e.g. "1101")
 *   - `non_canonical` — value contains characters outside the
 *                       canonical-code charset
 *
 * The category names deliberately avoid the word "token" because
 * the result-serialization sensitive-data invariant forbids any
 * occurrence of that word (it doubles as a keyword for auth
 * tokens / `lhdnmsstoken`).
 */
export type Phase2SelectedValueCategory =
  | "empty"
  | "code_like"
  | "non_canonical";

/**
 * Sanitized snapshot of a hidden Maklumat Am `<select>` element.
 * Only structural / categorical facts — no raw values, no labels.
 */
export interface Phase2HiddenSelectSnapshot {
  /** True iff the selector resolved to exactly one element. */
  present: boolean;
  /**
   * Visibility per Playwright's actionability rule, captured as a
   * bool so a hidden field reads as `false`. Absent if `present`
   * is false.
   */
  visible?: boolean;
  /** Categorical descriptor of the currently-selected value. */
  selectedValueCategory?: Phase2SelectedValueCategory;
  /**
   * Whether the expected `<option value="…">` code WeStamp would
   * have written exists on the live `<select>`. Reported as a
   * bool — never the option label, never the option value.
   */
  expectedOptionExists?: boolean;
}

/**
 * Sanitized snapshot of the hidden Maklumat Am date input.
 */
export interface Phase2HiddenDateSnapshot {
  /** True iff the selector resolved to exactly one element. */
  present: boolean;
  visible?: boolean;
  /** True iff the input has any non-empty value. */
  hasValue?: boolean;
  /**
   * Length of the live input value string (capped at 64 to avoid
   * surfacing surprisingly long content). Never the value itself.
   */
  valueLength?: number;
}

/**
 * Composite hidden-field snapshot the executor captures BEFORE
 * clicking save. Carried on the `Phase2ExecutionResult` for both
 * success and failure paths so the operator UI can corroborate
 * why a save attempt was or was not made.
 */
export interface Phase2HiddenFieldSnapshot {
  pdsJenis: Phase2HiddenSelectSnapshot;
  pdsSalinan: Phase2HiddenSelectSnapshot;
  pdsDateSuratcara: Phase2HiddenDateSnapshot;
}

/** Result of a single executor invocation. */
export interface Phase2ExecutionResult {
  status: Phase2ExecutionStatus;
  /** Present iff status is `refused` or `failed`. */
  refusalReason?: Phase2RefusalReason;
  /**
   * Stable, sensitive-data-free description. Drawn from a closed
   * map keyed by `refusalReason` (or "saved" / "started"). Never
   * contains a raw URL, exception text, or field value.
   */
  reason: string;
  /** ISO 8601 timestamp of the attempt. */
  attemptedAt: string;
  /** ISO 8601 timestamp of successful save; absent on refusal/failure. */
  savedAt?: string;
  /** Path-shape classification of the page after save. Verification surface. */
  postSavePathKind?: SupervisedSessionPathKind;
  /**
   * Sanitized field key identifying exactly where in the save
   * sequence the failure occurred. Optional — present on most
   * failure / refusal codes (where knowable). Never contains an
   * HTML element id, a portal-side identifier, or any sensitive
   * value. See `Phase2FailedFieldKey` for the closed enum.
   */
  failedFieldKey?: Phase2FailedFieldKey;
  /**
   * For `required_option_missing` only: the stable portal
   * `<option value>` code WeStamp expected to find on the live
   * `<select>`. Never contains free-text option labels, never
   * contains the full live option list — only the single
   * expected code. Codes are public-vocabulary mappings (e.g.
   * `"1101"` for Perjanjian Sewa) — non-sensitive.
   */
  expectedOptionValue?: string;
  /**
   * Sanitized hidden-field snapshot captured before any save click.
   * Present whenever the executor reached the snapshot step
   * (i.e. all pre-mutation guards passed). Optional on early
   * refusals (`p5_form_not_detected`, `selector_missing` for
   * pds_suratcara, `save_button_missing`, etc.).
   */
  hiddenFieldSnapshot?: Phase2HiddenFieldSnapshot;
}

/**
 * Maklumat Am field payload the executor consumes. Each value is a
 * portal-canonical code (digits / single-character enums) resolved
 * by `buildPhase2MaklumatAmPayload`.
 *
 * **Only `pdsSuratcaraCode` is written.** `pdsJenisCode` and
 * `pdsSalinanCode` are carried solely so the read-only hidden-field
 * snapshot can verify that the live `<select>` carries the
 * portal-canonical option code WeStamp would have used. The
 * executor NEVER writes `pds_jenis`, `pds_salinan`, or
 * `pds_date_suratcara`.
 *
 * Live p5 Maklumat Am inspection (B7 sixth-attempt diagnosis,
 * 2026-04-30) showed only `pds_suratcara` and the save button
 * `input#pdsL01_button_simpan` as operator-facing controls. The
 * other three Maklumat Am fields are stably hidden in the DOM
 * (`offsetWidth || offsetHeight || getClientRects().length` all
 * zero, no recognised replacement-widget wrapper class). The
 * portal manages them itself: `pds_salinan` and
 * `pds_date_suratcara` come pre-populated; `pds_jenis` is
 * server-derived from `pds_suratcara`. The Phase 2 executor
 * intentionally does not force-write those hidden portal-managed
 * fields. If the portal later rejects the save because one of
 * them is wrong, that must be treated as `save_failed` /
 * server validation and patched only on new live evidence.
 *
 * **Notes on `pds_ps` and `pds_dutisetem` (earlier B7 patches):**
 * Both remain skipped — `pds_ps` is a hidden `<input>` portal-
 * managed via JS, and `pds_dutisetem` is a state-of-stamping-office
 * select auto-populated from the property state. Neither has a
 * key in this payload; neither is written by the executor.
 */
export interface Phase2MaklumatAmPayload {
  /** WRITTEN to the live form. Visible select. */
  pdsSuratcaraCode: string;
  /**
   * Snapshot-only. The expected `<option value>` code on the
   * hidden `pds_jenis` select that WeStamp would have written
   * before B7's sixth-attempt evidence diagnosis. Used to confirm
   * the live form's hidden `pds_jenis` does carry that option;
   * NEVER selected.
   */
  pdsJenisCode: string;
  /**
   * Snapshot-only. The expected `<option value>` code on the
   * hidden `pds_salinan` select that WeStamp would have written.
   * Used to confirm option existence; NEVER selected.
   */
  pdsSalinanCode: string;
}

/**
 * Stable selector strings exported for tests.
 *
 * `pds_suratcara` is the only writable Maklumat Am control. The
 * hidden Maklumat Am fields use a separate constant
 * (`PHASE_2_HIDDEN_FIELD_SELECTORS`) so the writable / read-only
 * surfaces can never be conflated by mistake.
 *
 * `pds_ps` and `pds_dutisetem` are deliberately absent — see
 * `Phase2MaklumatAmPayload` for the full rationale. They are
 * neither in the writable map nor in the read-only snapshot map:
 * the executor doesn't touch them, even read-only.
 */
export const PHASE_2_FIELD_SELECTORS = {
  pds_suratcara: 'select[name="pds_suratcara"]',
} as const;

/**
 * Stable selector strings for the hidden Maklumat Am fields the
 * executor PROBES (read-only) but NEVER writes. Used by the
 * snapshot capture step. See `Phase2HiddenFieldSnapshot`.
 */
export const PHASE_2_HIDDEN_FIELD_SELECTORS = {
  pds_jenis: 'select[name="pds_jenis"]',
  pds_salinan: 'select[name="pds_salinan"]',
  pds_date_suratcara:
    'input[name="pds_date_suratcara"], input[name="pds_date"]',
} as const;

/**
 * Save-button selector. Strict id lookup against the evidenced
 * live element (`<input type="button" id="pdsL01_button_simpan">`,
 * confirmed 2026-04-30 against operator's CDP-attached p5 form).
 * Fail-closed if the element is missing or if more than one
 * matches. Never falls back to text-based lookup, never uses
 * brittle nth-child selectors. There is also a sibling
 * `pdsL01_button_simpan_hidden` on the same form (a hidden
 * Enter-key handler); the strict id below resolves to exactly
 * one element and never targets the hidden sibling.
 */
export const PHASE_2_SAVE_BUTTON_SELECTOR = "input#pdsL01_button_simpan";

/** Stable reason wording — keyed by status / refusalReason. */
export const PHASE_2_REASON_LABELS: Record<
  Phase2ExecutionStatus | Phase2RefusalReason,
  string
> = {
  // Status labels
  not_attempted: "Phase 2 Maklumat Am has not been attempted.",
  refused: "Phase 2 Maklumat Am attempt refused before any portal contact.",
  started: "Phase 2 Maklumat Am attempt has started.",
  saved: "Maklumat Am draft saved.",
  failed: "Phase 2 Maklumat Am attempt failed mid-flight.",
  // Refusal / failure labels
  job_not_found: "Job record not found.",
  unsupported_lane: "Job is not on the Sewa/Pajakan supported path.",
  readiness_not_ready:
    "Job readiness verdict is not ready_for_supervised_run.",
  instruction_graph_not_ready:
    "Instruction graph verdict is not ready_for_supervised_run.",
  supervised_session_missing:
    "Supervised run session has not been prepared yet.",
  first_mutation_not_approved:
    "First portal mutation has not been approved.",
  browser_not_reachable:
    "Operator's Chrome is not reachable on the configured CDP endpoint.",
  browser_not_phase_compatible:
    "Browser session is not compatible with Phase 2.",
  p5_form_not_detected:
    "No Sewa/Pajakan p5 form was detected in the operator's open Chrome pages.",
  required_field_missing:
    "Required Maklumat Am field is missing or unmapped.",
  selector_missing:
    "A required Maklumat Am field selector did not resolve on the page.",
  ambiguous_selector:
    "A required Maklumat Am field selector matched multiple elements.",
  save_button_missing:
    "Simpan Maklumat Am button was not found on the page.",
  required_option_missing:
    "A required Maklumat Am `<option value>` code was not present in the live select. No portal interaction occurred.",
  save_fill_failed:
    "The pds_suratcara select failed before the save button was clicked.",
  save_click_failed:
    "The Simpan Maklumat Am button was found but its click failed.",
  save_wait_failed:
    "The post-click network-idle wait failed or timed out.",
  save_failed:
    "A Maklumat Am save step failed (unspecified).",
  post_save_verification_failed:
    "Post-save URL classification failed — the page is no longer the Sewa/Pajakan p5 form.",
};

// ─── Pure preflight ────────────────────────────────────────────────

/** Outcome of `evaluatePhase2Preflight`. */
export type Phase2PreflightOutcome =
  | { ok: true }
  | { ok: false; refusalReason: Phase2RefusalReason };

/**
 * Pure preflight check — runs every B7 precondition that does NOT
 * require browser contact. Fail-closed; the route layer must call
 * this BEFORE attaching to CDP.
 *
 * Preconditions checked here:
 *   1. job is tenancy / sewa_pajakan
 *   2. readiness verdict is `ready_for_supervised_run`
 *   3. instruction graph verdict is `ready_for_supervised_run`
 *   4. supervisedRunSession exists
 *   5. supervisedRunSession.currentRunStage is `first_mutation_approved`
 *   6. supervisedRunSession.operatorApproval.firstPortalMutationApproved === true
 *
 * Browser-side preconditions (CDP reachable, p5 page detected,
 * phase compatibility) are checked by the route layer after this
 * preflight passes — by separating concerns the pure preflight
 * stays testable without Playwright.
 */
export function evaluatePhase2Preflight(
  job: StampingJob
): Phase2PreflightOutcome {
  // 1. Lane gate.
  if (job.documentCategory !== "tenancy_agreement") {
    return { ok: false, refusalReason: "unsupported_lane" };
  }

  // 2. Readiness verdict.
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  if (readinessReport.verdict !== "ready_for_supervised_run") {
    return { ok: false, refusalReason: "readiness_not_ready" };
  }

  // 3. Instruction graph verdict.
  const graph = buildTenancyInstructionGraphFromJob(job);
  if (graph.verdict !== "ready_for_supervised_run") {
    return { ok: false, refusalReason: "instruction_graph_not_ready" };
  }

  // 4. Supervised run session exists.
  const session = job.supervisedRunSession;
  if (!session) {
    return { ok: false, refusalReason: "supervised_session_missing" };
  }

  // 5+6. First-mutation approval. Reuse the existing eligibility
  // helper which already enforces the same rules. We additionally
  // require the explicit stage match — the brief is precise here.
  if (
    session.currentRunStage !== "first_mutation_approved" ||
    !session.operatorApproval.firstPortalMutationApproved
  ) {
    return { ok: false, refusalReason: "first_mutation_not_approved" };
  }
  // Defence-in-depth: the eligibility helper must also still
  // accept the state. This catches the edge case where readiness
  // regressed since the prepare snapshot AND the previous approval
  // somehow survived.
  const eligibility = canApproveFirstMutation(session);
  if (!(eligibility.ok && eligibility.alreadyApproved)) {
    return { ok: false, refusalReason: "first_mutation_not_approved" };
  }

  return { ok: true };
}

// ─── Pure payload builder ──────────────────────────────────────────

export type Phase2PayloadResult =
  | { ok: true; payload: Phase2MaklumatAmPayload }
  | { ok: false; refusalReason: Phase2RefusalReason };

/**
 * Build the Phase 2 Maklumat Am payload from the job. Pure;
 * side-effect-free. Returns `required_field_missing` if the
 * pds_suratcara code or the description type is missing /
 * unmapped (these are the only payload values the executor still
 * uses — pdsSuratcaraCode for the visible-select selectOption,
 * pds_jenis / pds_salinan codes for the read-only snapshot's
 * option-existence checks).
 *
 * The pds_jenis code is hardcoded to "1103"
 * (`fixed_rent_during_tenancy`) because B-impl Phase 0 only
 * supports that path. Any other description type is rejected at
 * payload-build time as defence-in-depth — the readiness gate +
 * instruction graph already block such jobs upstream.
 */
export function buildPhase2MaklumatAmPayload(
  job: StampingJob
): Phase2PayloadResult {
  // Compile the existing payload to reuse already-mapped values.
  const payload = compileTenancyPortalPayload(
    job as TenancyPortalPayloadJobInput
  );

  const pdsSuratcaraCode = payload.bahagianB.instrumentName.code ?? null;
  const pdsSalinanCode =
    payload.bahagianB.duplicateCopiesMapping.portalCode ?? null;
  const descType = payload.bahagianB.portalDescriptionType ?? null;

  if (
    typeof pdsSuratcaraCode !== "string" ||
    pdsSuratcaraCode.length === 0 ||
    typeof pdsSalinanCode !== "string" ||
    pdsSalinanCode.length === 0 ||
    descType !== "fixed_rent_during_tenancy"
  ) {
    return { ok: false, refusalReason: "required_field_missing" };
  }

  return {
    ok: true,
    payload: {
      pdsSuratcaraCode,
      pdsJenisCode: "1103",
      pdsSalinanCode,
    },
  };
}

// ─── Page-like surface (test-injectable) ──────────────────────────

/**
 * Minimal Page surface used by `executePhase2MaklumatAmSave`. The
 * concrete `Page` type from Playwright satisfies this interface —
 * the structural type lets tests pass mock objects without a real
 * Playwright import.
 *
 * Only the methods this executor actually uses are listed. Any
 * future addition to this list is a deliberate scope expansion.
 */
export interface Phase2PageLike {
  url(): string;
  locator(selector: string): Phase2LocatorLike;
  waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<void>;
}

/**
 * Minimal Locator surface.
 *
 * `isVisible` and `inputValue` were added in B7's sixth-attempt
 * patch so the executor can capture the hidden-field snapshot
 * read-only. Both methods exist natively on Playwright's
 * `Locator` and are structurally compatible.
 *
 * `selectOption` is intentionally NOT used with `force: true` —
 * if pds_suratcara is hidden the actionability check will fail
 * cleanly and surface as `save_fill_failed`. The executor never
 * bypasses visibility on any field.
 */
export interface Phase2LocatorLike {
  count(): Promise<number>;
  selectOption(
    value: string,
    options?: { timeout?: number }
  ): Promise<void>;
  click(options?: { timeout?: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  inputValue(options?: { timeout?: number }): Promise<string>;
}

// (Compile-time Playwright structural-compatibility assertions used
// to live here, but importing `Page` / `Locator` types from the
// `"playwright"` package transitively pulled `playwright-core` into
// the client bundle when the panel touched this module. The
// structural `Phase2PageLike` / `Phase2LocatorLike` interfaces
// above are sufficient for the executor's contract; runtime
// Playwright access lives in `tenancy-phase-2-route.ts`.)

// ─── Executor ──────────────────────────────────────────────────────

/** Executor input. */
export interface ExecutePhase2Options {
  page: Phase2PageLike;
  payload: Phase2MaklumatAmPayload;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
  /** Default save-click timeout. */
  clickTimeoutMs?: number;
  /** Default selectOption timeout. */
  selectTimeoutMs?: number;
  /** Bounded post-save networkidle wait. */
  postSaveWaitMs?: number;
  /** Bounded read timeout for snapshot probes. */
  snapshotReadTimeoutMs?: number;
}

const DEFAULT_SELECT_TIMEOUT_MS = 5000;
const DEFAULT_CLICK_TIMEOUT_MS = 5000;
const DEFAULT_POST_SAVE_WAIT_MS = 15000;
const DEFAULT_SNAPSHOT_READ_TIMEOUT_MS = 2000;
const SNAPSHOT_VALUE_LENGTH_CAP = 64;

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Optional sanitized enrichment carried on a refusal/failure
 * result. `failedFieldKey`, `expectedOptionValue`, and
 * `hiddenFieldSnapshot` are the only extra fields the result type
 * allows; everything else is a fixed enum / timestamp / sentence.
 */
interface FailureEnrichment {
  failedFieldKey?: Phase2FailedFieldKey;
  expectedOptionValue?: string;
  hiddenFieldSnapshot?: Phase2HiddenFieldSnapshot;
}

function refused(
  reason: Phase2RefusalReason,
  attemptedAt: string,
  enrichment: FailureEnrichment = {}
): Phase2ExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_2_REASON_LABELS[reason],
    attemptedAt,
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.expectedOptionValue !== undefined
      ? { expectedOptionValue: enrichment.expectedOptionValue }
      : {}),
    ...(enrichment.hiddenFieldSnapshot !== undefined
      ? { hiddenFieldSnapshot: enrichment.hiddenFieldSnapshot }
      : {}),
  };
}

function failed(
  reason: Phase2RefusalReason,
  attemptedAt: string,
  postSavePathKind?: SupervisedSessionPathKind,
  enrichment: FailureEnrichment = {}
): Phase2ExecutionResult {
  return {
    status: "failed",
    refusalReason: reason,
    reason: PHASE_2_REASON_LABELS[reason],
    attemptedAt,
    ...(postSavePathKind !== undefined ? { postSavePathKind } : {}),
    ...(enrichment.failedFieldKey !== undefined
      ? { failedFieldKey: enrichment.failedFieldKey }
      : {}),
    ...(enrichment.expectedOptionValue !== undefined
      ? { expectedOptionValue: enrichment.expectedOptionValue }
      : {}),
    ...(enrichment.hiddenFieldSnapshot !== undefined
      ? { hiddenFieldSnapshot: enrichment.hiddenFieldSnapshot }
      : {}),
  };
}

/**
 * Resolve a single-element locator. Returns the locator on
 * success, or a refusal result on count !== 1.
 */
async function requireSingleLocator(
  page: Phase2PageLike,
  selector: string,
  attemptedAt: string,
  ambiguousReason: Phase2RefusalReason = "ambiguous_selector",
  missingReason: Phase2RefusalReason = "selector_missing"
): Promise<
  | { ok: true; locator: Phase2LocatorLike }
  | { ok: false; result: Phase2ExecutionResult }
> {
  const locator = page.locator(selector);
  let count: number;
  try {
    count = await locator.count();
  } catch {
    return { ok: false, result: refused(missingReason, attemptedAt) };
  }
  if (count === 0) {
    return { ok: false, result: refused(missingReason, attemptedAt) };
  }
  if (count > 1) {
    return { ok: false, result: refused(ambiguousReason, attemptedAt) };
  }
  return { ok: true, locator };
}

/**
 * Categorize a select element's currently-selected `value` string
 * without echoing the raw string.
 */
function categorizeSelectedValue(value: string): Phase2SelectedValueCategory {
  if (value === "") return "empty";
  if (/^[A-Za-z0-9_-]+$/.test(value)) return "code_like";
  return "non_canonical";
}

/**
 * Capture a sanitized snapshot of one hidden Maklumat Am `<select>`
 * field. Read-only: no selectOption / fill / click / force / JS
 * write is performed. All probes are wrapped in try/catch so
 * snapshot capture never throws — a probe failure is reported as
 * the relevant field marked `present: false` (and downstream code
 * decides whether that's a save-blocker).
 */
async function captureHiddenSelectSnapshot(
  page: Phase2PageLike,
  selector: string,
  expectedOptionValue: string,
  readTimeoutMs: number
): Promise<Phase2HiddenSelectSnapshot> {
  const loc = page.locator(selector);
  let count: number;
  try {
    count = await loc.count();
  } catch {
    return { present: false };
  }
  if (count !== 1) {
    return { present: false };
  }
  const present = true;
  let visible: boolean | undefined;
  try {
    visible = await loc.isVisible({ timeout: readTimeoutMs });
  } catch {
    visible = undefined;
  }
  let selectedValueCategory: Phase2SelectedValueCategory | undefined;
  try {
    const v = await loc.inputValue({ timeout: readTimeoutMs });
    selectedValueCategory = categorizeSelectedValue(v);
  } catch {
    selectedValueCategory = undefined;
  }
  // Option-existence probe: reject any expected value that contains
  // anything outside the canonical-code charset BEFORE building a
  // compound selector. Defensive — the payload builder already only
  // produces canonical values; this is belt-and-braces.
  let expectedOptionExists: boolean | undefined;
  if (/^[A-Za-z0-9_-]+$/.test(expectedOptionValue)) {
    const optionSelector = `${selector} option[value="${expectedOptionValue}"]`;
    try {
      const optCount = await page.locator(optionSelector).count();
      expectedOptionExists = optCount > 0;
    } catch {
      expectedOptionExists = undefined;
    }
  } else {
    expectedOptionExists = false;
  }
  const out: Phase2HiddenSelectSnapshot = { present };
  if (visible !== undefined) out.visible = visible;
  if (selectedValueCategory !== undefined) {
    out.selectedValueCategory = selectedValueCategory;
  }
  if (expectedOptionExists !== undefined) {
    out.expectedOptionExists = expectedOptionExists;
  }
  return out;
}

/**
 * Capture a sanitized snapshot of the hidden Maklumat Am date
 * `<input>` field. Read-only.
 */
async function captureHiddenDateSnapshot(
  page: Phase2PageLike,
  selector: string,
  readTimeoutMs: number
): Promise<Phase2HiddenDateSnapshot> {
  const loc = page.locator(selector);
  let count: number;
  try {
    count = await loc.count();
  } catch {
    return { present: false };
  }
  if (count !== 1) {
    return { present: false };
  }
  const present = true;
  let visible: boolean | undefined;
  try {
    visible = await loc.isVisible({ timeout: readTimeoutMs });
  } catch {
    visible = undefined;
  }
  let hasValue: boolean | undefined;
  let valueLength: number | undefined;
  try {
    const v = await loc.inputValue({ timeout: readTimeoutMs });
    hasValue = typeof v === "string" && v.length > 0;
    if (typeof v === "string") {
      valueLength = Math.min(v.length, SNAPSHOT_VALUE_LENGTH_CAP);
    }
  } catch {
    hasValue = undefined;
    valueLength = undefined;
  }
  const out: Phase2HiddenDateSnapshot = { present };
  if (visible !== undefined) out.visible = visible;
  if (hasValue !== undefined) out.hasValue = hasValue;
  if (valueLength !== undefined) out.valueLength = valueLength;
  return out;
}

/**
 * Compose the full hidden-field snapshot. Never throws; always
 * returns a complete record (with `present: false` for any field
 * that couldn't be resolved).
 */
async function captureHiddenFieldSnapshot(
  page: Phase2PageLike,
  payload: Phase2MaklumatAmPayload,
  readTimeoutMs: number
): Promise<Phase2HiddenFieldSnapshot> {
  return {
    pdsJenis: await captureHiddenSelectSnapshot(
      page,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis,
      payload.pdsJenisCode,
      readTimeoutMs
    ),
    pdsSalinan: await captureHiddenSelectSnapshot(
      page,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan,
      payload.pdsSalinanCode,
      readTimeoutMs
    ),
    pdsDateSuratcara: await captureHiddenDateSnapshot(
      page,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara,
      readTimeoutMs
    ),
  };
}

/**
 * Run the controlled Phase 2 Maklumat Am save flow against a
 * Page-like surface. Caller is responsible for selecting the right
 * page (the route layer enumerates browser contexts and picks the
 * page that classifies as `sewa_pajakan_p5_form`).
 *
 * Flow:
 *   1. Pre-mutation guard: read `page.url()`, classify, refuse if
 *      not `sewa_pajakan_p5_form`.
 *   2. Pre-mutation guard: pds_suratcara + save button each resolve
 *      to EXACTLY one element.
 *   3. Pre-mutation guard: option `value="<pdsSuratcaraCode>"`
 *      exists in the live `pds_suratcara` select.
 *   4. Hidden-field snapshot capture (read-only).
 *   5. Select pds_suratcara (the only writable Maklumat Am control).
 *   6. Click the single Simpan Maklumat Am button.
 *   7. Wait for the bounded networkidle round-trip.
 *   8. Read the post-save `page.url()`, classify, refuse if not
 *      `sewa_pajakan_p5_form`.
 *
 * Steps 1-3 occur BEFORE any write. If the form is inconsistent
 * with our expectations, the visible select is not selected — the
 * operator's portal session is left untouched.
 */
export async function executePhase2MaklumatAmSave(
  opts: ExecutePhase2Options
): Promise<Phase2ExecutionResult> {
  const attemptedAt = (opts.now ?? defaultNow)();
  const selectTimeout = opts.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS;
  const clickTimeout = opts.clickTimeoutMs ?? DEFAULT_CLICK_TIMEOUT_MS;
  const postSaveWait = opts.postSaveWaitMs ?? DEFAULT_POST_SAVE_WAIT_MS;
  const snapshotReadTimeout =
    opts.snapshotReadTimeoutMs ?? DEFAULT_SNAPSHOT_READ_TIMEOUT_MS;

  // ── Step 1: pre-mutation page-kind guard ──
  let preUrl: string;
  try {
    preUrl = opts.page.url();
  } catch {
    return refused("p5_form_not_detected", attemptedAt);
  }
  if (classifySupervisedSessionPath(preUrl) !== "sewa_pajakan_p5_form") {
    return refused("p5_form_not_detected", attemptedAt);
  }

  // ── Step 2: pre-mutation selector uniqueness guard ──
  // The executor writes ONLY pds_suratcara and clicks ONLY the
  // single Simpan Maklumat Am button. The hidden Maklumat Am
  // fields (pds_jenis / pds_salinan / pds_date_suratcara) are
  // probed read-only in Step 4 — their presence/absence is
  // reported in the snapshot rather than treated as an
  // executor-layer refusal.
  //
  // Selectors intentionally absent from the writable surface:
  //   - `pds_ps`         — hidden input, portal-managed (B7 1st).
  //   - `pds_dutisetem`  — state-of-stamping-office select, auto-
  //                         populated from property state (B7 5th).
  //   - `pds_jenis`      — hidden, server-derived from pds_suratcara
  //                         (B7 6th).
  //   - `pds_salinan`    — hidden, pre-populated by portal (B7 6th).
  //   - `pds_date_suratcara` — hidden, pre-populated by portal
  //                            (B7 6th).
  // WeStamp's readiness gate still requires the operator to capture
  // every Maklumat Am model field; the executor simply does not
  // write the hidden ones to the live form.
  const suratcaraR = await requireSingleLocator(
    opts.page,
    PHASE_2_FIELD_SELECTORS.pds_suratcara,
    attemptedAt
  );
  if (!suratcaraR.ok) return suratcaraR.result;
  const suratcaraLocator = suratcaraR.locator;

  const saveR = await requireSingleLocator(
    opts.page,
    PHASE_2_SAVE_BUTTON_SELECTOR,
    attemptedAt,
    "ambiguous_selector",
    "save_button_missing"
  );
  if (!saveR.ok) return saveR.result;
  const saveLocator = saveR.locator;

  // ── Step 3: pds_suratcara option-value preflight ──
  // Verify the required `<option value>` code exists in the live
  // `pds_suratcara` select BEFORE any selectOption is called. This
  // catches value-code mismatches against the live portal cleanly,
  // with no client-side DOM mutation.
  if (!/^[A-Za-z0-9_-]+$/.test(opts.payload.pdsSuratcaraCode)) {
    return refused("required_option_missing", attemptedAt, {
      failedFieldKey: "pds_suratcara",
      expectedOptionValue: opts.payload.pdsSuratcaraCode,
    });
  }
  const suratcaraOptionSelector = `${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="${opts.payload.pdsSuratcaraCode}"]`;
  let suratcaraOptionCount: number;
  try {
    suratcaraOptionCount = await opts.page
      .locator(suratcaraOptionSelector)
      .count();
  } catch {
    suratcaraOptionCount = 0;
  }
  if (suratcaraOptionCount === 0) {
    return refused("required_option_missing", attemptedAt, {
      failedFieldKey: "pds_suratcara",
      expectedOptionValue: opts.payload.pdsSuratcaraCode,
    });
  }

  // ── Step 4: hidden-field snapshot (read-only) ──
  // Captures sanitized presence / visibility / selected-value-
  // category / option-existence facts for the three hidden
  // Maklumat Am fields the executor never writes. Never throws;
  // never blocks the save attempt — its purpose is operator-facing
  // diagnostic context on both saved and failed outcomes.
  const hiddenFieldSnapshot = await captureHiddenFieldSnapshot(
    opts.page,
    opts.payload,
    snapshotReadTimeout
  );

  // ── Step 5: select pds_suratcara (the only writable Maklumat Am control) ──
  // No `force: true`. If pds_suratcara turns out to be hidden /
  // detached / disabled on the live form, Playwright's actionability
  // check will fail cleanly and surface as `save_fill_failed` with
  // `failedFieldKey: pds_suratcara`. The executor never bypasses
  // visibility on any field.
  try {
    await suratcaraLocator.selectOption(opts.payload.pdsSuratcaraCode, {
      timeout: selectTimeout,
    });
  } catch {
    return failed("save_fill_failed", attemptedAt, undefined, {
      failedFieldKey: "pds_suratcara",
      hiddenFieldSnapshot,
    });
  }

  // ── Step 6: click the single Simpan Maklumat Am button ──
  try {
    await saveLocator.click({ timeout: clickTimeout });
  } catch {
    return failed("save_click_failed", attemptedAt, undefined, {
      failedFieldKey: "save_button",
      hiddenFieldSnapshot,
    });
  }

  // ── Step 7: bounded networkidle wait for the server save ──
  try {
    await opts.page.waitForLoadState("networkidle", {
      timeout: postSaveWait,
    });
  } catch {
    // Treat the timeout / network failure as `save_wait_failed`
    // — we don't know whether the server save succeeded; safer
    // to fail closed and let the operator inspect.
    return failed("save_wait_failed", attemptedAt, undefined, {
      failedFieldKey: "post_save_verification",
      hiddenFieldSnapshot,
    });
  }

  // ── Step 8: post-save URL guard ──
  let postUrl: string;
  try {
    postUrl = opts.page.url();
  } catch {
    return failed("post_save_verification_failed", attemptedAt, undefined, {
      failedFieldKey: "post_save_verification",
      hiddenFieldSnapshot,
    });
  }
  const postPathKind = classifySupervisedSessionPath(postUrl);
  if (postPathKind !== "sewa_pajakan_p5_form") {
    return failed("post_save_verification_failed", attemptedAt, postPathKind, {
      failedFieldKey: "post_save_verification",
      hiddenFieldSnapshot,
    });
  }

  return {
    status: "saved",
    reason: PHASE_2_REASON_LABELS.saved,
    attemptedAt,
    savedAt: (opts.now ?? defaultNow)(),
    postSavePathKind: postPathKind,
    hiddenFieldSnapshot,
  };
}
