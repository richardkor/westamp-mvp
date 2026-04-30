/**
 * WeStamp — Tenancy Supervised Run Session · API route helpers
 *
 * Pure handlers behind the two B6 routes:
 *
 *   POST /api/intake/[id]/supervised-run/prepare
 *   POST /api/intake/[id]/supervised-run/approve-first-mutation
 *
 * Splitting these out of the route files keeps the actual Next.js
 * routes thin (parse JSON, look up the job, call the helper, persist
 * the new state, return JSON) and makes the read-only, no-portal-
 * mutation contract testable without booting Next.js.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for prepare-route validation, the
 *   eligibility checks the approval-route enforces, and the
 *   error-translation layer between the inspector / readiness gate
 *   and the route response.
 * - The injection seam for tests: the inspector is parameterised so
 *   tests can supply a stub instead of a real Playwright attach.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute portal actions. The "approve first
 *   mutation" handler just records an internal flag — no Playwright
 *   API is called.
 * - It does NOT persist anything by itself. Persistence is the route
 *   layer's job; this module is pure.
 * - It does NOT touch payment, certificate retrieval, OCR, or any
 *   user-review surface.
 */

import {
  inspectOperatorChromeSessionViaCdp,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import {
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
  canApproveFirstMutation,
  type ApprovalRefusalReason,
  type TenancyRunSessionState,
} from "./tenancy-supervised-run-session";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_CDP_TIMEOUT_MS,
} from "./tenancy-supervised-session-route";
import type { StampingJob } from "./stamping-types";

// ─── Approved wording / error strings ──────────────────────────────

export const ERROR_INVALID_BODY =
  "Invalid request body. Expected JSON object.";
export const ERROR_NOT_TENANCY_JOB =
  "Supervised run session applies only to tenancy-agreement jobs.";
export const ERROR_INVALID_INSPECT_FLAG =
  "Invalid inspectBrowserSession flag. Must be a boolean.";
export const ERROR_BROWSER_INSPECTION_FAILED =
  "Browser session inspection failed. Verify Chrome is launched with remote debugging enabled.";
export const ERROR_NOT_ELIGIBLE_PREFIX = "First mutation approval refused: ";

// ─── Public types ──────────────────────────────────────────────────

/** Body accepted by the prepare route. */
export interface PrepareRequestBody {
  /**
   * When `true`, the route runs a single CDP attach cycle to
   * snapshot the browser session. Defaults to `false` (no portal
   * contact at all). Even when `true`, the inspection is the read-
   * only B3 inspector — no clicks / fills / submits.
   */
  inspectBrowserSession?: boolean;
}

/** Successful response from the prepare route. */
export interface PrepareSuccessResponse {
  ok: true;
  state: TenancyRunSessionState;
}

/** Successful response from the approval route. */
export interface ApproveSuccessResponse {
  ok: true;
  state: TenancyRunSessionState;
  /** True when the call applied an approval; false when the state was already approved. */
  applied: boolean;
  /** Constant non-execution marker — operator UI surfaces this verbatim. */
  notice: string;
}

/** Error response shape used by both routes. */
export interface RouteErrorResponse {
  ok: false;
  /** Stable fixed-vocabulary error message. Never raw exception text. */
  error: string;
  /**
   * Stable refusal code on approval-eligibility failures. Absent on
   * other error responses.
   */
  reason?: ApprovalRefusalReason;
}

export type PrepareRouteResponse = PrepareSuccessResponse | RouteErrorResponse;
export type ApproveRouteResponse = ApproveSuccessResponse | RouteErrorResponse;

/** Inspector signature alias for the optional injection. */
export type SupervisedSessionInspector =
  typeof inspectOperatorChromeSessionViaCdp;

/** Options for the prepare handler. Extracted so tests can stub each input. */
export interface HandlePrepareRequestOptions {
  job: StampingJob;
  /** Parsed JSON body (or `undefined` when JSON parsing failed). */
  body: unknown;
  /** Stub for the inspector, defaults to the real read-only B3 inspector. */
  inspector?: SupervisedSessionInspector;
  /** CDP endpoint override; falls back to env / default in the route layer. */
  cdpEndpoint?: string;
  /** Inspection timeout. */
  cdpTimeoutMs?: number;
  /**
   * Existing run-session state on the job. Allows preserving
   * createdAt + approval across refreshes.
   */
  existingState?: TenancyRunSessionState | null;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

/** Options for the approval handler. */
export interface HandleApproveRequestOptions {
  job: StampingJob;
  /** Stable internal marker, defaults to `"operator_session"`. */
  approvedBy?: string;
  /** Injectable clock. */
  now?: () => string;
}

// ─── Public handlers ───────────────────────────────────────────────

/**
 * Prepare or refresh the supervised-run-session state for a job.
 *
 * Flow:
 *   1. Validate the job is a tenancy-agreement job (route layer
 *      should have handled the 404 case already).
 *   2. Validate the body — only the optional `inspectBrowserSession`
 *      boolean is accepted.
 *   3. Compute readiness via `evaluateTenancyPortalRunReadiness`.
 *   4. Compile the offline instruction graph.
 *   5. If `inspectBrowserSession === true`, run ONE read-only CDP
 *      attach cycle. On failure, return the inspector's
 *      `cdp_unreachable` report verbatim — the prepare call is
 *      considered successful even when CDP is down.
 *   6. Build the run-session state and return it. Persistence is
 *      the route file's job.
 *
 * Pure: no I/O of its own. The inspector argument is the only
 * external surface, and it is stubbed in tests.
 */
export async function handlePrepareRequest(
  opts: HandlePrepareRequestOptions
): Promise<PrepareRouteResponse> {
  const { job, body, existingState } = opts;

  if (job.documentCategory !== "tenancy_agreement") {
    return { ok: false, error: ERROR_NOT_TENANCY_JOB };
  }

  // ── Body validation ──
  let inspectBrowserSession = false;
  if (body !== undefined && body !== null) {
    if (typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: ERROR_INVALID_BODY };
    }
    const parsed = body as Record<string, unknown>;
    if (parsed.inspectBrowserSession !== undefined) {
      if (typeof parsed.inspectBrowserSession !== "boolean") {
        return { ok: false, error: ERROR_INVALID_INSPECT_FLAG };
      }
      inspectBrowserSession = parsed.inspectBrowserSession;
    }
  }

  // ── Readiness + offline instruction graph ──
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraphFromJob(job);

  // ── Optional read-only browser inspection ──
  let browserSessionReport: SupervisedSessionReport | undefined;
  if (inspectBrowserSession) {
    const inspector = opts.inspector ?? inspectOperatorChromeSessionViaCdp;
    const cdpEndpoint =
      typeof opts.cdpEndpoint === "string" && opts.cdpEndpoint.length > 0
        ? opts.cdpEndpoint
        : DEFAULT_CDP_ENDPOINT;
    const timeoutMs =
      typeof opts.cdpTimeoutMs === "number" && opts.cdpTimeoutMs > 0
        ? opts.cdpTimeoutMs
        : DEFAULT_CDP_TIMEOUT_MS;
    try {
      browserSessionReport = await inspector({
        cdpEndpoint,
        targetPhaseId: "phase_1_session_positioning",
        timeoutMs,
      });
    } catch {
      // The B3 inspector itself never throws — it returns a
      // `cdp_unreachable` report. This branch is defence-in-depth
      // only; if hit, return a fixed-vocabulary error.
      return { ok: false, error: ERROR_BROWSER_INSPECTION_FAILED };
    }
  }

  const state = buildSupervisedRunSessionState({
    jobId: job.id,
    readinessReport,
    instructionGraph: graph,
    ...(browserSessionReport !== undefined ? { browserSessionReport } : {}),
    ...(existingState !== undefined && existingState !== null
      ? { existingState }
      : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });

  return { ok: true, state };
}

/**
 * Apply the operator's first-mutation approval to the existing
 * run-session state on the job.
 *
 * Flow:
 *   1. Validate the job is a tenancy-agreement job.
 *   2. Require a prepared run session on the job. Reject with
 *      `not_prepared` otherwise.
 *   3. Re-evaluate readiness + offline graph at approval time. If
 *      either has regressed since the prepared snapshot, refresh
 *      the state first, then re-check eligibility.
 *   4. Run `canApproveFirstMutation`. On refusal, return a
 *      sanitized error response with the stable refusal reason.
 *   5. On approval, return the new state via
 *      `applyFirstMutationApproval`.
 *
 * Approval NEVER triggers any Playwright API call, never opens a
 * browser, never clicks anything, never creates a draft, never
 * uploads, never submits. It is purely an internal flag.
 */
export async function handleApproveFirstMutationRequest(
  opts: HandleApproveRequestOptions
): Promise<ApproveRouteResponse> {
  const { job, approvedBy, now } = opts;
  const FIRST_MUTATION_APPROVED_NOTICE =
    "First portal mutation approved internally. No e-Duti Setem action has been taken.";

  if (job.documentCategory !== "tenancy_agreement") {
    return { ok: false, error: ERROR_NOT_TENANCY_JOB };
  }

  if (!job.supervisedRunSession) {
    const reason: ApprovalRefusalReason = "not_prepared";
    return {
      ok: false,
      error: `${ERROR_NOT_ELIGIBLE_PREFIX}${reason}`,
      reason,
    };
  }

  // Re-evaluate readiness + graph at approval time. If the job has
  // changed since the prepared snapshot was taken (e.g. the operator
  // edited tenancy details after preparing), the snapshot we approve
  // must reflect the *current* job — so we always refresh first.
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraphFromJob(job);

  const refreshed = buildSupervisedRunSessionState({
    jobId: job.id,
    readinessReport,
    instructionGraph: graph,
    existingState: job.supervisedRunSession,
    ...(job.supervisedRunSession.browserSession !== undefined
      ? {
          // We do NOT re-run CDP attach here; the operator must
          // call prepare with `inspectBrowserSession: true` if
          // they want a fresh browser snapshot. Approval reuses
          // the existing snapshot when it was previously captured.
        }
      : {}),
    ...(now !== undefined ? { now } : {}),
  });

  const eligibility = canApproveFirstMutation(refreshed);
  if (!eligibility.ok) {
    return {
      ok: false,
      error: `${ERROR_NOT_ELIGIBLE_PREFIX}${eligibility.reason}`,
      reason: eligibility.reason,
    };
  }

  if (eligibility.alreadyApproved) {
    return {
      ok: true,
      state: refreshed,
      applied: false,
      notice: FIRST_MUTATION_APPROVED_NOTICE,
    };
  }

  const approved = applyFirstMutationApproval(refreshed, {
    ...(approvedBy !== undefined ? { approvedBy } : {}),
    ...(now !== undefined ? { now } : {}),
  });

  return {
    ok: true,
    state: approved,
    applied: true,
    notice: FIRST_MUTATION_APPROVED_NOTICE,
  };
}
