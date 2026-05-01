/**
 * WeStamp — Tenancy Supervised Run Session (Milestone B6)
 *
 * Internal-only model + pure builder + approval-gate helpers that
 * sit between the readiness gate / instruction graph / browser
 * session shell on one side, and the future controlled portal-
 * mutation layer on the other.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the internal "supervised run
 *   session" record stored on a `StampingJob`. The record describes
 *   WeStamp's readiness to begin a future supervised portal run.
 * - A pure synchronous builder (`buildSupervisedRunSessionState`)
 *   that turns the existing readiness report + instruction graph +
 *   (optional) browser session report into a sanitized state value.
 * - The eligibility logic (`canApproveFirstMutation`) for the first-
 *   mutation approval gate.
 * - The pure mutator (`applyFirstMutationApproval`) that applies the
 *   approval to a state value.
 * - The view-model adapter (`buildSupervisedRunSessionViewModel`)
 *   the panel renders.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute portal actions. Approving the first
 *   mutation merely records an internal flag — no Playwright API
 *   is called, no portal URL is hit, no field is filled.
 * - It does NOT persist anything by itself. Persistence is the
 *   route layer's job; this module is pure.
 * - It does NOT touch payment, certificate retrieval, OCR, or any
 *   user-review surface.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print
 *   logic.
 *
 * Sensitive-data policy
 * ─────────────────────
 * The state record (and the view-model) contain ONLY:
 *   - the WeStamp internal job id (NOT a portal draft id)
 *   - fixed enum values (run stage, verdicts, status, page kind,
 *     phase compatibility)
 *   - ISO 8601 timestamps
 *   - small non-sensitive integers (blocker counts)
 *   - boolean flags (firstPortalMutationApproved)
 *   - a small list of stable blocker CODES (e.g.
 *     `pds_jenis_1105_unsupported`) — these are public-vocabulary
 *     codes, not job-specific identifiers
 *   - a single fixed non-execution marker string
 *
 * The state NEVER stores: raw URLs, hrefs, query strings, hashes,
 * cookies, tokens, `lhdnmsstoken`, IC numbers, TINs, firm IDs,
 * party names, addresses, or uploaded document content.
 *
 * Test 8 in `tenancy-supervised-run-session.test.ts` enforces this
 * invariant graph-wide.
 */

import type {
  GraphPhaseCompatibility,
  SupervisedSessionPageKind,
  SupervisedSessionReport,
  SupervisedSessionStatus,
} from "./tenancy-supervised-session-shell";
import type {
  TenancyInstructionGraph,
  TenancyInstructionGraphSupportedPath,
} from "./tenancy-instruction-graph";
import type { TenancyPortalRunReadinessReport } from "./tenancy-portal-run-readiness";

// ─── Public types ──────────────────────────────────────────────────

/** The lane currently supported by this layer. */
export type TenancyRunSessionLane = "sewa_pajakan";

/**
 * Run-stage enum per the B6 brief, extended in B7 with a single
 * post-save value (`phase_2_maklumat_am_saved`) recorded after the
 * controlled Phase 2 Maklumat Am draft-creation/save executor
 * completes successfully. The new value is "sticky" on refresh —
 * a successful Phase 2 save is a fact about the portal-side draft
 * that should not be silently undone by a subsequent prepare call.
 */
export type TenancyRunStage =
  | "not_prepared"
  | "preflight_ready"
  | "browser_not_ready"
  | "awaiting_first_mutation_approval"
  | "first_mutation_approved"
  | "phase_2_maklumat_am_saved"
  | "phase_3_landlord_individual_saved"
  | "phase_3_tenant_individual_saved"
  | "blocked"
  | "aborted";

/**
 * Optional snapshot of the browser session at prepare time. Stored
 * on the run-session record so the operator UI can show "as of X
 * minutes ago, browser was Y" without re-running CDP attach.
 */
export interface TenancyRunSessionBrowserSnapshot {
  status: SupervisedSessionStatus;
  pageKind: SupervisedSessionPageKind;
  phaseCompatibility: GraphPhaseCompatibility;
  /** Total candidate pages reported by Chrome (small integer). */
  candidatePageCount: number;
  /** ISO 8601 timestamp of the inspection. */
  capturedAt: string;
}

/** Operator-approval state for the first portal mutation. */
export interface TenancyRunSessionOperatorApproval {
  firstPortalMutationApproved: boolean;
  /** ISO 8601 timestamp. Present only when approved. */
  approvedAt?: string;
  /**
   * Internal operator marker. Today this is always the literal
   * string `"operator_session"` — we have a single-passphrase auth
   * gate and no per-operator identity. The field exists so a future
   * milestone can plug in a per-operator marker without a schema
   * migration. NEVER stores personally-identifying information.
   */
  approvedBy?: string;
}

/**
 * Narrow result block recorded on the run-session state when the
 * controlled Phase 2 Maklumat Am executor (Milestone B7) attempts
 * a mutation. Sanitized: contains stable enum values + ISO
 * timestamps + safe path/marker enums only. NEVER stores a raw
 * URL, href, exception text, portal numeric IDs, party data, or
 * uploaded document content.
 */
/**
 * Narrow result block recorded on the run-session state when the
 * controlled Phase 3 tenant-individual row-save executor
 * (Milestone B11) attempts a mutation. Same sanitized shape as the
 * landlord result.
 */
export interface TenancyRunSessionPhase3TenantResult {
  status: "saved" | "failed";
  attemptedAt: string;
  savedAt?: string;
  postSavePathKind?:
    | "mytax_dashboard"
    | "stamps_role_change"
    | "stamps_dashboard"
    | "sewa_pajakan_p5_form"
    | "other";
  failureReasonCode?: string;
  preRowCount?: number;
  postRowCount?: number;
}

/**
 * Narrow result block recorded on the run-session state when the
 * controlled Phase 3 landlord-individual row-save executor
 * (Milestone B10) attempts a mutation. Sanitized: stable enum
 * values + ISO timestamps + path-shape enums + sanitized
 * row-count integers only.
 */
export interface TenancyRunSessionPhase3LandlordResult {
  status: "saved" | "failed";
  attemptedAt: string;
  savedAt?: string;
  postSavePathKind?:
    | "mytax_dashboard"
    | "stamps_role_change"
    | "stamps_dashboard"
    | "sewa_pajakan_p5_form"
    | "other";
  /** Stable failure-reason code on `status === "failed"`. */
  failureReasonCode?: string;
  /** Sanitized small integer. Captured on success and most failures. */
  preRowCount?: number;
  /** Sanitized small integer. Captured on success and on row-count failures. */
  postRowCount?: number;
}

export interface TenancyRunSessionPhase2Result {
  /** Always "saved" or "failed" — refusals never reach this block. */
  status: "saved" | "failed";
  /** ISO 8601 timestamp of the attempt. */
  attemptedAt: string;
  /** ISO 8601 timestamp of successful save; absent on failure. */
  savedAt?: string;
  /**
   * Path-shape enum after save (always
   * `"sewa_pajakan_p5_form"` on success — verified by the
   * post-save URL classifier).
   */
  postSavePathKind?:
    | "mytax_dashboard"
    | "stamps_role_change"
    | "stamps_dashboard"
    | "sewa_pajakan_p5_form"
    | "other";
  /**
   * Stable failure-reason code on `status === "failed"`. One of the
   * Phase 2 refusal-reason codes; declared as `string` here to
   * avoid a circular type import. The B7 executor always assigns
   * one of the canonical codes from
   * `tenancy-phase-2-executor.ts`.
   */
  failureReasonCode?: string;
}

/**
 * Persistent state stored on the StampingJob as
 * `supervisedRunSession`. Pure JSON; sanitized.
 */
export interface TenancyRunSessionState {
  /** WeStamp internal job id. NOT a portal draft id. */
  jobId: string;
  lane: TenancyRunSessionLane;
  supportedPath: TenancyInstructionGraphSupportedPath;
  /** Latest readiness verdict captured at prepare time. */
  readinessVerdict: "ready_for_supervised_run" | "blocked";
  /** Latest instruction-graph verdict at prepare time. */
  instructionGraphVerdict: "ready_for_supervised_run" | "blocked";
  /** Optional. Set by a prepare call that included browser inspection. */
  browserSession?: TenancyRunSessionBrowserSnapshot;
  /** Current internal stage. */
  currentRunStage: TenancyRunStage;
  /** First-mutation operator approval. */
  operatorApproval: TenancyRunSessionOperatorApproval;
  /**
   * Up to 6 stable blocker codes drawn from the readiness gap
   * categories + graph blocking-reason categories. Operator-facing
   * UI surfaces a count-only summary; the codes themselves are
   * fixed-vocabulary and not personally-identifying.
   */
  blockedReasonCodes: string[];
  /**
   * Constant non-execution marker. Surfaced as-is in API responses
   * and in the UI footer.
   */
  nonExecutionNote: typeof NON_EXECUTION_NOTE;
  /**
   * Result of the most recent Phase 2 Maklumat Am executor attempt
   * (Milestone B7). Absent until the operator triggers Phase 2.
   * Sanitized; see `TenancyRunSessionPhase2Result`.
   */
  phase2MaklumatAm?: TenancyRunSessionPhase2Result;
  /**
   * Result of the most recent Phase 3 landlord-individual row-save
   * executor attempt (Milestone B10). Absent until the operator
   * triggers Phase 3 landlord. Sanitized.
   */
  phase3LandlordIndividual?: TenancyRunSessionPhase3LandlordResult;
  /**
   * Result of the most recent Phase 3 tenant-individual row-save
   * executor attempt (Milestone B11). Absent until the operator
   * triggers Phase 3 tenant. Sanitized.
   */
  phase3TenantIndividual?: TenancyRunSessionPhase3TenantResult;
  /** ISO 8601 timestamp. Set on first prepare call. */
  createdAt: string;
  /** ISO 8601 timestamp. Refreshed on every state mutation. */
  updatedAt: string;
}

/**
 * Reason a `canApproveFirstMutation` check refuses approval. Stable
 * machine-readable codes for the route + UI to surface specific
 * triage hints.
 *
 * `browser_not_checked` (B6 safety correction): a prepared run
 * session whose `browserSession` snapshot has never been captured
 * is NOT approvable. The operator must explicitly run "Prepare Run
 * Session (with browser check)" first. This rule prevents recording
 * a first-mutation approval against a job whose browser position
 * has not been verified — important because the next milestone
 * (B7) consumes this approval to drive the first real portal
 * mutation, and that mutation must not run on a browser that may
 * still be on MyTax / role-change / an unrelated form.
 */
export type ApprovalRefusalReason =
  | "not_prepared"
  | "readiness_blocked"
  | "instruction_graph_blocked"
  | "browser_not_checked"
  | "browser_unreachable"
  | "browser_incompatible"
  | "session_blocked"
  | "session_aborted"
  | "no_change_already_approved";

/** Result of `canApproveFirstMutation`. */
export type ApprovalEligibility =
  | { ok: true; alreadyApproved: boolean }
  | { ok: false; reason: ApprovalRefusalReason };

// ─── Approved B6 wording (constants) ───────────────────────────────

export const NON_EXECUTION_NOTE =
  "No e-Duti Setem action has been taken." as const;

export const RUN_SESSION_HEADING = "Supervised Run Session";

export const RUN_SESSION_HELPER_TEXT =
  "This records WeStamp's internal readiness to begin a future supervised portal run. It does not execute portal actions.";

export const APPROVAL_BUTTON_LABEL = "Approve First Portal Mutation";
export const PREPARE_BUTTON_LABEL = "Prepare Run Session";

export const APPROVAL_BUTTON_HELPER_WARNING =
  "Approval is internal only. The next milestone is required before WeStamp can create a portal draft.";

export const FIRST_MUTATION_APPROVED_NOTICE =
  "First portal mutation approved internally. No e-Duti Setem action has been taken.";

/**
 * Operator-facing actionable hint surfaced when approval is
 * refused with `browser_not_checked`. Tells the operator the
 * exact next step to take.
 */
export const APPROVAL_BROWSER_CHECK_REQUIRED_HINT =
  "Run a browser check before approving the first portal mutation.";

/** Compact badge / chip text for the same condition. */
export const APPROVAL_BROWSER_CHECK_REQUIRED_LABEL =
  "Browser check required before approval.";

// ─── B7 approved wording (Phase 2 Maklumat Am execution) ──────────

/**
 * Operator-facing button label for the controlled Phase 2 Maklumat
 * Am execution. The label is intentionally explicit because this
 * is the FIRST actual portal mutation WeStamp performs.
 */
export const PHASE_2_EXECUTE_BUTTON_LABEL =
  "Create Portal Draft: Maklumat Am Only";

/** Warning text shown above / next to the Phase 2 execute button. */
export const PHASE_2_EXECUTE_WARNING =
  "This will write Maklumat Am data into e-Duti Setem and save the draft. It will not submit, upload, pay, or retrieve a certificate.";

/** Success text shown after a successful Phase 2 save. */
export const PHASE_2_EXECUTE_SUCCESS =
  "Maklumat Am draft saved. No Hantar, upload, payment, or certificate retrieval was performed.";

// ─── B10 approved wording (Phase 3 landlord-individual save) ──────

/** Operator-facing button label for the controlled landlord row save. */
export const PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL =
  "Save Landlord Row: Individual Only";

/** Warning text shown above / next to the landlord-save button. */
export const PHASE_3_LANDLORD_EXECUTE_WARNING =
  "This will enter one landlord individual row in Bahagian A. It will not enter tenant data, upload, submit, pay, or retrieve a certificate.";

/** Success text shown after a successful landlord row save. */
export const PHASE_3_LANDLORD_EXECUTE_SUCCESS =
  "Landlord individual row saved. No tenant, upload, Hantar, payment, or certificate action was performed.";

// ─── B11 approved wording (Phase 3 tenant-individual save) ────────

/** Operator-facing button label for the controlled tenant row save. */
export const PHASE_3_TENANT_EXECUTE_BUTTON_LABEL =
  "Save Tenant Row: Individual Only";

/** Warning text shown above / next to the tenant-save button. */
export const PHASE_3_TENANT_EXECUTE_WARNING =
  "This will enter one tenant individual row in Bahagian A. It will not enter company data, upload, submit, pay, or retrieve a certificate.";

/** Success text shown after a successful tenant row save. */
export const PHASE_3_TENANT_EXECUTE_SUCCESS =
  "Tenant individual row saved. No company, upload, Hantar, payment, or certificate action was performed.";

// ─── Build / refresh ───────────────────────────────────────────────

/**
 * Maximum number of blocker codes carried on a state record. Caps
 * payload size and avoids unbounded growth even if the readiness
 * gate produces many gaps for an early-capture job.
 */
const MAX_BLOCKED_REASON_CODES = 6;

/** Builder input. */
export interface BuildSupervisedRunSessionStateInput {
  jobId: string;
  /** Latest readiness report (always required). */
  readinessReport: TenancyPortalRunReadinessReport;
  /** Latest offline instruction graph (always required). */
  instructionGraph: TenancyInstructionGraph;
  /** Optional browser session report. Set on prepare calls that included CDP inspection. */
  browserSessionReport?: SupervisedSessionReport | null;
  /**
   * The previous state, when refreshing. Allows preserving an
   * existing `operatorApproval` flag across refreshes without
   * losing the approval (so long as the job is still eligible).
   */
  existingState?: TenancyRunSessionState | null;
  /** Defaults to `new Date().toISOString()`. Injectable for tests. */
  now?: () => string;
}

/**
 * Build (or refresh) a sanitized supervised-run-session state
 * record. Pure. Total. Free of I/O.
 *
 * Stage-derivation rules:
 *   1. existing approval is true AND still eligible (readiness +
 *      graph ready; if browser captured, compatible) →
 *      `first_mutation_approved`
 *   2. readiness or graph is blocked → `blocked`
 *   3. browser session captured BUT unreachable or incompatible →
 *      `browser_not_ready`
 *   4. browser session captured AND compatible →
 *      `awaiting_first_mutation_approval`
 *   5. no browser session captured → `preflight_ready`
 *
 * The previous state's `operatorApproval` is preserved across
 * refreshes only when the job is still eligible per the same rules
 * `canApproveFirstMutation` enforces. If a refresh would invalidate
 * the approval (e.g. readiness regressed), the approval flag is
 * cleared — the operator must re-approve.
 */
export function buildSupervisedRunSessionState(
  input: BuildSupervisedRunSessionStateInput
): TenancyRunSessionState {
  const {
    jobId,
    readinessReport,
    instructionGraph,
    browserSessionReport,
    existingState,
    now,
  } = input;

  const ts = (now ?? defaultNow)();
  const createdAt = existingState?.createdAt ?? ts;

  const browserSnapshot = browserSessionReport
    ? toBrowserSnapshot(browserSessionReport, ts)
    : (existingState?.browserSession ?? undefined);

  const readinessVerdict: TenancyRunSessionState["readinessVerdict"] =
    readinessReport.verdict;
  const instructionGraphVerdict: TenancyRunSessionState["instructionGraphVerdict"] =
    instructionGraph.verdict;

  const blockedReasonCodes = collectBlockedReasonCodes(
    readinessReport,
    instructionGraph
  );

  // Decide whether to preserve the previous approval. Rule: the
  // previous flag survives only when the SAME eligibility rules that
  // `canApproveFirstMutation` uses still hold. If anything regressed,
  // the flag is cleared.
  const previouslyApproved =
    existingState?.operatorApproval.firstPortalMutationApproved === true;

  const stillEligibleForApproval = isEligibleForApproval(
    readinessVerdict,
    instructionGraphVerdict,
    browserSnapshot
  );

  const operatorApproval: TenancyRunSessionOperatorApproval =
    previouslyApproved && stillEligibleForApproval
      ? {
          firstPortalMutationApproved: true,
          ...(existingState?.operatorApproval.approvedAt !== undefined
            ? { approvedAt: existingState.operatorApproval.approvedAt }
            : {}),
          ...(existingState?.operatorApproval.approvedBy !== undefined
            ? { approvedBy: existingState.operatorApproval.approvedBy }
            : {}),
        }
      : { firstPortalMutationApproved: false };

  const currentRunStage = deriveRunStage({
    readinessVerdict,
    instructionGraphVerdict,
    browserSnapshot,
    operatorApprovalActive: operatorApproval.firstPortalMutationApproved,
    previousStage: existingState?.currentRunStage,
  });

  return {
    jobId,
    lane: "sewa_pajakan",
    supportedPath: instructionGraph.supportedPath,
    readinessVerdict,
    instructionGraphVerdict,
    ...(browserSnapshot ? { browserSession: browserSnapshot } : {}),
    currentRunStage,
    operatorApproval,
    blockedReasonCodes,
    nonExecutionNote: NON_EXECUTION_NOTE,
    createdAt,
    updatedAt: ts,
  };
}

// ─── Eligibility + approval ────────────────────────────────────────

/**
 * Check whether the operator may record first-mutation approval on
 * the supplied state.
 *
 * Approval is permitted **only** when ALL of the following hold:
 *   - readiness verdict is `ready_for_supervised_run`
 *   - instruction-graph verdict is `ready_for_supervised_run`
 *   - a browser session snapshot has been captured (i.e.
 *     `browserSession` is present)
 *   - the captured browser session is reachable AND
 *     `phaseCompatibility === "compatible"`
 *
 * **B6 safety correction:** previously the helper allowed approval
 * when no browser session had been captured (treating the absent
 * snapshot as "no information, so don't block"). That is too loose
 * because B6 is the gate immediately before B7's first real portal
 * mutation. Without a verified compatible browser snapshot the
 * mutation could fire on the wrong page (MyTax, role-change, an
 * unrelated form). The corrected rule REQUIRES an explicit
 * compatible snapshot and surfaces a `browser_not_checked` refusal
 * reason when one has not been captured. Operators must click
 * "Prepare Run Session (with browser check)" before approval.
 *
 * Idempotent on already-approved states: `{ ok: true,
 * alreadyApproved: true }`.
 */
export function canApproveFirstMutation(
  state: TenancyRunSessionState
): ApprovalEligibility {
  if (state.currentRunStage === "blocked") {
    return { ok: false, reason: "session_blocked" };
  }
  if (state.currentRunStage === "aborted") {
    return { ok: false, reason: "session_aborted" };
  }
  if (state.currentRunStage === "not_prepared") {
    return { ok: false, reason: "not_prepared" };
  }

  if (state.readinessVerdict !== "ready_for_supervised_run") {
    return { ok: false, reason: "readiness_blocked" };
  }
  if (state.instructionGraphVerdict !== "ready_for_supervised_run") {
    return { ok: false, reason: "instruction_graph_blocked" };
  }

  // B6 safety correction: require an explicit browser snapshot.
  // The "absent snapshot" case is its own refusal reason so the
  // operator UI can show a specific actionable hint ("Run a
  // browser check before approving the first portal mutation.").
  if (!state.browserSession) {
    if (state.operatorApproval.firstPortalMutationApproved) {
      // Defensive: a state record persisted before this rule
      // existed could carry an approval flag without a browser
      // snapshot. Treat it as already-approved (idempotent) rather
      // than spontaneously revoking. New approvals cannot reach
      // this branch because `applyFirstMutationApproval` re-checks
      // eligibility before recording.
      return { ok: true, alreadyApproved: true };
    }
    return { ok: false, reason: "browser_not_checked" };
  }

  const bs = state.browserSession;
  if (bs.status === "cdp_unreachable" || bs.phaseCompatibility === "unknown") {
    return { ok: false, reason: "browser_unreachable" };
  }
  if (bs.phaseCompatibility !== "compatible") {
    return { ok: false, reason: "browser_incompatible" };
  }

  if (state.operatorApproval.firstPortalMutationApproved) {
    return { ok: true, alreadyApproved: true };
  }
  return { ok: true, alreadyApproved: false };
}

/** Options for `applyFirstMutationApproval`. */
export interface ApplyFirstMutationApprovalOptions {
  /** Defaults to `"operator_session"`. Stable internal marker only. */
  approvedBy?: string;
  /** Defaults to `new Date().toISOString()`. Injectable for tests. */
  now?: () => string;
}

/**
 * Apply the first-mutation approval to a state value. Returns a
 * NEW state record — does not mutate the input.
 *
 * Throws ONLY when called against a state that is not eligible.
 * Callers must pre-check via `canApproveFirstMutation`.
 */
export function applyFirstMutationApproval(
  state: TenancyRunSessionState,
  opts: ApplyFirstMutationApprovalOptions = {}
): TenancyRunSessionState {
  const eligibility = canApproveFirstMutation(state);
  if (!eligibility.ok) {
    throw new Error(
      `Cannot approve first mutation: ${eligibility.reason}`
    );
  }
  const approvedBy = opts.approvedBy ?? "operator_session";
  const now = (opts.now ?? defaultNow)();
  const operatorApproval: TenancyRunSessionOperatorApproval = {
    firstPortalMutationApproved: true,
    approvedAt: state.operatorApproval.approvedAt ?? now,
    approvedBy: state.operatorApproval.approvedBy ?? approvedBy,
  };
  return {
    ...state,
    currentRunStage: "first_mutation_approved",
    operatorApproval,
    updatedAt: now,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

function defaultNow(): string {
  return new Date().toISOString();
}

function toBrowserSnapshot(
  report: SupervisedSessionReport,
  ts: string
): TenancyRunSessionBrowserSnapshot {
  return {
    status: report.status,
    pageKind: report.pageKind,
    phaseCompatibility: report.graphPhaseCompatibility,
    candidatePageCount: report.candidatePageCount,
    capturedAt: ts,
  };
}

function isEligibleForApproval(
  readinessVerdict: "ready_for_supervised_run" | "blocked",
  graphVerdict: "ready_for_supervised_run" | "blocked",
  browser: TenancyRunSessionBrowserSnapshot | undefined
): boolean {
  if (readinessVerdict !== "ready_for_supervised_run") return false;
  if (graphVerdict !== "ready_for_supervised_run") return false;
  // B6 safety correction: an absent browser snapshot is NOT
  // eligible for approval. Mirrors `canApproveFirstMutation`.
  if (browser === undefined) return false;
  if (browser.status === "cdp_unreachable") return false;
  if (
    browser.phaseCompatibility === "incompatible" ||
    browser.phaseCompatibility === "unknown"
  ) {
    return false;
  }
  return true;
}

function deriveRunStage(input: {
  readinessVerdict: "ready_for_supervised_run" | "blocked";
  instructionGraphVerdict: "ready_for_supervised_run" | "blocked";
  browserSnapshot: TenancyRunSessionBrowserSnapshot | undefined;
  operatorApprovalActive: boolean;
  previousStage: TenancyRunStage | undefined;
}): TenancyRunStage {
  // Aborted is sticky — operators must explicitly re-prepare.
  if (input.previousStage === "aborted") return "aborted";
  // Phase 2 saved is sticky — a successful portal-side draft save
  // is a fact about the live portal state. A subsequent prepare
  // call must not silently revert this stage. The operator can
  // still re-approve / re-execute later phases; it just can't
  // pretend Phase 2 was never saved.
  if (input.previousStage === "phase_2_maklumat_am_saved") {
    return "phase_2_maklumat_am_saved";
  }
  // Phase 3 landlord-individual saved is also sticky — once a
  // landlord row is committed to e-Duti Setem, no prepare call can
  // pretend it isn't there. This stage strictly succeeds
  // `phase_2_maklumat_am_saved` because the landlord-row save
  // requires Maklumat Am to already be saved (B10 preflight).
  if (input.previousStage === "phase_3_landlord_individual_saved") {
    return "phase_3_landlord_individual_saved";
  }
  // Phase 3 tenant-individual saved succeeds the landlord-row stage
  // (B11). Sticky for the same reason: once the tenant row commits
  // to e-Duti Setem, no prepare call can pretend it isn't there.
  if (input.previousStage === "phase_3_tenant_individual_saved") {
    return "phase_3_tenant_individual_saved";
  }

  if (input.operatorApprovalActive) return "first_mutation_approved";

  if (
    input.readinessVerdict !== "ready_for_supervised_run" ||
    input.instructionGraphVerdict !== "ready_for_supervised_run"
  ) {
    return "blocked";
  }

  if (input.browserSnapshot !== undefined) {
    if (
      input.browserSnapshot.status === "cdp_unreachable" ||
      input.browserSnapshot.phaseCompatibility === "incompatible" ||
      input.browserSnapshot.phaseCompatibility === "unknown"
    ) {
      return "browser_not_ready";
    }
    return "awaiting_first_mutation_approval";
  }

  return "preflight_ready";
}

/**
 * Collect up to MAX_BLOCKED_REASON_CODES stable codes for the
 * blocker summary on the state record. Drawn from the structured
 * portalFieldMappingGaps + graph blockingReasons. Free-text
 * blocking reasons (which can echo party labels) are NOT included
 * here — only stable enum-style codes.
 */
function collectBlockedReasonCodes(
  report: TenancyPortalRunReadinessReport,
  graph: TenancyInstructionGraph
): string[] {
  const codes: string[] = [];
  for (const gap of report.portalFieldMappingGaps) {
    if (codes.length >= MAX_BLOCKED_REASON_CODES) break;
    if (!codes.includes(gap.code)) codes.push(gap.code);
  }
  for (const r of graph.blockingReasons) {
    if (codes.length >= MAX_BLOCKED_REASON_CODES) break;
    if (!codes.includes(r.code)) codes.push(r.code);
  }
  return codes;
}

// ─── View-model adapter (UI layer) ─────────────────────────────────

/** Operator-facing labels for run stage. */
export const RUN_STAGE_LABELS: Record<TenancyRunStage, string> = {
  not_prepared: "Not prepared",
  preflight_ready: "Preflight ready",
  browser_not_ready: "Browser not ready",
  awaiting_first_mutation_approval: "Awaiting first-mutation approval",
  first_mutation_approved: "First mutation approved internally",
  phase_2_maklumat_am_saved: "Phase 2 Maklumat Am draft saved",
  phase_3_landlord_individual_saved:
    "Phase 3 landlord individual row saved",
  phase_3_tenant_individual_saved:
    "Phase 3 tenant individual row saved",
  blocked: "Blocked",
  aborted: "Aborted",
};

/** Operator-facing labels for refusal reasons. */
export const APPROVAL_REFUSAL_LABELS: Record<ApprovalRefusalReason, string> = {
  not_prepared:
    "Run session has not been prepared yet. Click Prepare Run Session first.",
  readiness_blocked:
    "Job readiness verdict is blocked. Resolve readiness gaps before approval.",
  instruction_graph_blocked:
    "Instruction graph verdict is blocked. Resolve graph blockers first.",
  browser_not_checked: APPROVAL_BROWSER_CHECK_REQUIRED_HINT,
  browser_unreachable:
    "Browser session was inspected but Chrome is not reachable on the configured CDP endpoint.",
  browser_incompatible:
    "Browser is reachable but its current page is not compatible with the planned phase.",
  session_blocked:
    "Run session is blocked. Re-prepare after resolving the underlying blockers.",
  session_aborted:
    "Run session was aborted. Re-prepare to resume.",
  no_change_already_approved:
    "First mutation has already been approved.",
};

export interface SupervisedRunSessionViewModel {
  heading: string;
  helperText: string;
  prepareButtonLabel: string;
  approveButtonLabel: string;
  approvalButtonHelperWarning: string;
  nonExecutionNote: string;
  /** Latest stage label (operator-facing). */
  runStageLabel: string;
  /** Run-stage enum value (for styling). */
  runStage: TenancyRunStage;
  /** Readiness verdict label. */
  readinessVerdictLabel: string;
  readinessVerdict: TenancyRunSessionState["readinessVerdict"];
  /** Instruction-graph verdict label. */
  instructionGraphVerdictLabel: string;
  instructionGraphVerdict: TenancyRunSessionState["instructionGraphVerdict"];
  /** Browser phase-compatibility label or null when no browser snapshot. */
  browserPhaseCompatibilityLabel: string | null;
  /** First-mutation approval status label. */
  approvalStatusLabel: string;
  /** Whether the approve button should be enabled. */
  approveButtonEnabled: boolean;
  /** Stable refusal reason when not eligible. */
  approveRefusalReason: ApprovalRefusalReason | null;
  /** Refusal reason label (operator-facing) when applicable. */
  approveRefusalLabel: string | null;
  /** Number of blocker codes, capped to MAX_BLOCKED_REASON_CODES. */
  blockerCount: number;
  /** Up to 6 blocker codes (telemetry-style). */
  blockerCodes: string[];
  /** ISO 8601 timestamp of last update; null when state is null. */
  lastUpdatedAt: string | null;
  /**
   * Approval-completed banner text, populated only when
   * `runStage === "first_mutation_approved"`. Otherwise null.
   */
  approvalCompletedNotice: string | null;
}

/** Convenience labels for verdict columns. */
const READINESS_VERDICT_LABELS: Record<
  TenancyRunSessionState["readinessVerdict"],
  string
> = {
  ready_for_supervised_run: "Ready",
  blocked: "Blocked",
};

const PHASE_COMPATIBILITY_LABELS: Record<GraphPhaseCompatibility, string> = {
  compatible: "Compatible",
  incompatible: "Incompatible",
  unknown: "Not yet known",
};

const APPROVAL_STATUS_LABELS = {
  not_yet: "Not yet approved",
  approved: "Approved internally",
};

/**
 * Build the UI view-model. When `state` is null, returns a
 * "not_prepared" view-model with the prepare button enabled. When
 * `state` is populated, derives the displayed labels from it and
 * computes the approve button's enabled state via
 * `canApproveFirstMutation`.
 */
export function buildSupervisedRunSessionViewModel(
  state: TenancyRunSessionState | null
): SupervisedRunSessionViewModel {
  if (state === null) {
    return {
      heading: RUN_SESSION_HEADING,
      helperText: RUN_SESSION_HELPER_TEXT,
      prepareButtonLabel: PREPARE_BUTTON_LABEL,
      approveButtonLabel: APPROVAL_BUTTON_LABEL,
      approvalButtonHelperWarning: APPROVAL_BUTTON_HELPER_WARNING,
      nonExecutionNote: NON_EXECUTION_NOTE,
      runStageLabel: RUN_STAGE_LABELS.not_prepared,
      runStage: "not_prepared",
      readinessVerdictLabel: "—",
      readinessVerdict: "blocked",
      instructionGraphVerdictLabel: "—",
      instructionGraphVerdict: "blocked",
      browserPhaseCompatibilityLabel: null,
      approvalStatusLabel: APPROVAL_STATUS_LABELS.not_yet,
      approveButtonEnabled: false,
      approveRefusalReason: "not_prepared",
      approveRefusalLabel: APPROVAL_REFUSAL_LABELS.not_prepared,
      blockerCount: 0,
      blockerCodes: [],
      lastUpdatedAt: null,
      approvalCompletedNotice: null,
    };
  }

  const eligibility = canApproveFirstMutation(state);

  return {
    heading: RUN_SESSION_HEADING,
    helperText: RUN_SESSION_HELPER_TEXT,
    prepareButtonLabel: PREPARE_BUTTON_LABEL,
    approveButtonLabel: APPROVAL_BUTTON_LABEL,
    approvalButtonHelperWarning: APPROVAL_BUTTON_HELPER_WARNING,
    nonExecutionNote: NON_EXECUTION_NOTE,
    runStageLabel: RUN_STAGE_LABELS[state.currentRunStage],
    runStage: state.currentRunStage,
    readinessVerdictLabel:
      READINESS_VERDICT_LABELS[state.readinessVerdict] ??
      state.readinessVerdict,
    readinessVerdict: state.readinessVerdict,
    instructionGraphVerdictLabel:
      READINESS_VERDICT_LABELS[state.instructionGraphVerdict] ??
      state.instructionGraphVerdict,
    instructionGraphVerdict: state.instructionGraphVerdict,
    browserPhaseCompatibilityLabel: state.browserSession
      ? (PHASE_COMPATIBILITY_LABELS[state.browserSession.phaseCompatibility] ??
        null)
      : null,
    approvalStatusLabel: state.operatorApproval.firstPortalMutationApproved
      ? APPROVAL_STATUS_LABELS.approved
      : APPROVAL_STATUS_LABELS.not_yet,
    approveButtonEnabled:
      eligibility.ok && !state.operatorApproval.firstPortalMutationApproved,
    approveRefusalReason: eligibility.ok ? null : eligibility.reason,
    approveRefusalLabel: eligibility.ok
      ? null
      : (APPROVAL_REFUSAL_LABELS[eligibility.reason] ?? null),
    blockerCount: state.blockedReasonCodes.length,
    blockerCodes: state.blockedReasonCodes.slice(),
    lastUpdatedAt: state.updatedAt,
    approvalCompletedNotice:
      state.currentRunStage === "first_mutation_approved"
        ? FIRST_MUTATION_APPROVED_NOTICE
        : null,
  };
}
