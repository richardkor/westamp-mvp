/**
 * WeStamp — Tenancy Supervised Session · API route helper
 *
 * Pure, framework-free request handler that the
 * `POST /api/operator/cdp-inspect` route delegates to. Splitting
 * the logic out of the route file keeps the actual route a one-
 * liner and makes the read-only-CDP-attach contract testable
 * without booting Next.js or attaching to a real Chrome.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for input validation (the only
 *   accepted field is the optional `targetPhaseId`).
 * - The CDP-endpoint resolver (env override → fallback to
 *   `http://127.0.0.1:9222`).
 * - The error-translation layer that turns any unexpected throw
 *   from the inspector into a safe `{ ok: false, error }` response
 *   without leaking Playwright stack traces or raw URL fragments.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute portal actions. The inspector it calls is
 *   the read-only B3 session shell, which only uses `page.url()`
 *   and `page.locator(name).count()` — see
 *   `tenancy-supervised-session-shell.ts` for the full read-only
 *   contract.
 * - It does NOT persist results — every call is transient.
 * - It does NOT touch payment, certificate retrieval, OCR, or any
 *   user-review surface.
 */

import {
  inspectOperatorChromeSessionViaCdp,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import type { TenancyInstructionPhaseId } from "./tenancy-instruction-graph";

// ─── Approved fallbacks / error wording ────────────────────────────

/** Default endpoint — operator's local Chrome with --remote-debugging-port=9222. */
export const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";

/**
 * Connect timeout for the CDP attach. Bounded to keep the operator's
 * UI responsive even when Chrome is not running.
 */
export const DEFAULT_CDP_TIMEOUT_MS = 2000;

/**
 * Stable, sensitive-data-free error wording. The route NEVER returns
 * a raw exception message to the client because the inspector calls
 * Playwright, whose error messages occasionally include raw URLs,
 * port numbers, file paths, or stack traces.
 */
export const ERROR_INVALID_BODY =
  "Invalid request body. Expected JSON object.";
export const ERROR_INVALID_TARGET_PHASE =
  "Invalid targetPhaseId. Must be one of the canonical instruction-graph phase ids.";
export const ERROR_INSPECTOR_FAILED =
  "Browser session inspection failed. Verify Chrome is launched with remote debugging on the configured endpoint.";

// ─── Public types ──────────────────────────────────────────────────

/** Allowed body fields. Anything else is silently dropped. */
export interface CdpInspectRequestBody {
  /**
   * Optional canonical phase id. When supplied it is validated
   * against the canonical phase set; an unknown value yields a
   * 400-style `{ ok: false, error }` response without touching the
   * inspector at all.
   */
  targetPhaseId?: string | undefined;
}

/** Successful response. */
export interface CdpInspectSuccessResponse {
  ok: true;
  report: SupervisedSessionReport;
}

/** Error response. Always carries a safe, fixed-vocabulary `error`. */
export interface CdpInspectErrorResponse {
  ok: false;
  error: string;
}

export type CdpInspectResponse =
  | CdpInspectSuccessResponse
  | CdpInspectErrorResponse;

/** Injectable surface for unit tests. */
export interface HandleCdpInspectOptions {
  /** Parsed JSON body (or `undefined` when parsing failed). */
  body: unknown;
  /** Operator-configurable CDP endpoint from environment. */
  envCdpEndpoint?: string | undefined;
  /**
   * Inspector function. Defaults to the real
   * `inspectOperatorChromeSessionViaCdp`; tests pass a stub to
   * keep Playwright + Chrome out of the loop.
   */
  inspector?: typeof inspectOperatorChromeSessionViaCdp;
  /** Bounded attach timeout. Defaults to `DEFAULT_CDP_TIMEOUT_MS`. */
  timeoutMs?: number;
}

// ─── Phase id validation ───────────────────────────────────────────

/**
 * Set of canonical instruction-graph phase ids. Exported so other
 * route helpers (e.g. the B6 prepare helper, after the B7 fix that
 * lets prepare accept an optional `targetPhaseId`) can validate
 * incoming phase ids without re-declaring the closed set.
 */
export const ALLOWED_PHASE_IDS: ReadonlySet<TenancyInstructionPhaseId> =
  new Set<TenancyInstructionPhaseId>([
    "phase_0_preflight",
    "phase_1_session_positioning",
    "phase_2_maklumat_am_draft",
    "phase_3_bahagian_a_parties",
    "phase_4_bahagian_b_rent",
    "phase_5_bahagian_c_property",
    "phase_6_lampiran_upload",
    "phase_7_rumusan_readback",
    "phase_8_perakuan_hantar",
  ]);

/** Type-guard companion for `ALLOWED_PHASE_IDS`. */
export function isAllowedPhaseId(
  v: unknown
): v is TenancyInstructionPhaseId {
  return (
    typeof v === "string" &&
    ALLOWED_PHASE_IDS.has(v as TenancyInstructionPhaseId)
  );
}

// ─── Public handler ────────────────────────────────────────────────

/**
 * Run a single read-only CDP inspection cycle and return a
 * sanitized response shape suitable for `NextResponse.json(...)`.
 *
 * Failure modes:
 *   - body is not a plain object         → `{ok:false, error: ERROR_INVALID_BODY}`
 *   - body has an invalid targetPhaseId  → `{ok:false, error: ERROR_INVALID_TARGET_PHASE}`
 *   - inspector throws unexpectedly      → `{ok:false, error: ERROR_INSPECTOR_FAILED}`
 *
 * On success the response contains the sanitized
 * `SupervisedSessionReport` from the B3 helper verbatim — including
 * the "cdp_unreachable" status for the common "Chrome not running"
 * case (this is NOT an error from the route's perspective; it's a
 * legitimate read-only finding).
 */
export async function handleCdpInspectRequest(
  opts: HandleCdpInspectOptions
): Promise<CdpInspectResponse> {
  const { body, envCdpEndpoint, inspector, timeoutMs } = opts;
  const inspectorFn = inspector ?? inspectOperatorChromeSessionViaCdp;
  const cdpEndpoint = resolveCdpEndpoint(envCdpEndpoint);
  const timeout = Number.isFinite(timeoutMs) && (timeoutMs as number) > 0
    ? (timeoutMs as number)
    : DEFAULT_CDP_TIMEOUT_MS;

  // ── Body validation ──
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: ERROR_INVALID_BODY };
  }
  const parsed = body as Record<string, unknown>;
  let targetPhaseId: TenancyInstructionPhaseId | undefined;
  if (parsed.targetPhaseId !== undefined && parsed.targetPhaseId !== null) {
    if (!isAllowedPhaseId(parsed.targetPhaseId)) {
      return { ok: false, error: ERROR_INVALID_TARGET_PHASE };
    }
    targetPhaseId = parsed.targetPhaseId;
  }

  // ── Inspector call ──
  let report: SupervisedSessionReport;
  try {
    report = await inspectorFn({
      cdpEndpoint,
      ...(targetPhaseId !== undefined ? { targetPhaseId } : {}),
      timeoutMs: timeout,
    });
  } catch {
    // Defence-in-depth: the B3 inspector already wraps every
    // Playwright surface in try/catch and never throws, so this
    // branch should be unreachable. We still translate any
    // unexpected throw to a fixed-vocabulary safe error so the
    // route never leaks raw stack traces or URL fragments.
    return { ok: false, error: ERROR_INSPECTOR_FAILED };
  }

  return { ok: true, report };
}

/**
 * Resolve the CDP endpoint. Order of precedence:
 *   1. `envCdpEndpoint` (caller supplies — usually
 *      `process.env.WESTAMP_CDP_ENDPOINT`)
 *   2. `DEFAULT_CDP_ENDPOINT` (`http://127.0.0.1:9222`)
 *
 * Empty / whitespace-only env values fall through to the default.
 */
export function resolveCdpEndpoint(envValue?: string | undefined): string {
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    return envValue.trim();
  }
  return DEFAULT_CDP_ENDPOINT;
}
