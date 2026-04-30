/**
 * WeStamp — Tenancy Phase 2 Maklumat Am · API route helper
 *
 * Pure handler behind:
 *
 *   POST /api/intake/[id]/supervised-run/execute-phase-2-maklumat-am
 *
 * Splits the route's CDP-attach + page-selection + executor-call
 * sequence out of the Next.js route file so the read-only / write-
 * scoped contract is testable without booting Next.js or attaching
 * to a real Chrome.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the Phase 2 route's flow:
 *     1. validate the job
 *     2. run the pure preflight (`evaluatePhase2Preflight`)
 *     3. build the Phase 2 payload (`buildPhase2MaklumatAmPayload`)
 *     4. attach to CDP, find the p5 page (read-only)
 *     5. call the executor (`executePhase2MaklumatAmSave`)
 *     6. return a sanitized result for the route layer to persist
 * - The translation seam: every step that could fail is funnelled
 *   into a `Phase2ExecutionResult`. The route layer returns the
 *   result verbatim; persistence is its only added concern.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT persist anything. Persistence happens in the route
 *   file via `updateJobOrConflict` so the helper stays pure.
 * - It does NOT touch payment, certificate retrieval, OCR, or any
 *   user-review surface.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print
 *   logic.
 *
 * Read-only / write-scoped invariants
 * ───────────────────────────────────
 *   - The CDP attach uses `chromium.connectOverCDP` (read-only by
 *     definition; does not start a new browser).
 *   - Page selection uses ONLY `page.url()` + the existing
 *     `classifySupervisedSessionPath` classifier. The raw URL is
 *     dropped at this seam.
 *   - The executor itself is the only writer; its surface is the
 *     six Maklumat Am field selectors + the single Simpan
 *     Maklumat Am button (see `tenancy-phase-2-executor.ts`).
 *   - On any failure, `browser.close()` disconnects Playwright's
 *     CDP client without terminating the operator's Chrome.
 */

import {
  buildPhase2MaklumatAmPayload,
  evaluatePhase2Preflight,
  executePhase2MaklumatAmSave,
  PHASE_2_REASON_LABELS,
  type Phase2ExecutionResult,
  type Phase2PageLike,
  type Phase2RefusalReason,
} from "./tenancy-phase-2-executor";
import { classifySupervisedSessionPath } from "./tenancy-supervised-session-path";
import {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_CDP_TIMEOUT_MS,
} from "./tenancy-supervised-session-route";
import type { StampingJob } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Function shape compatible with `chromium.connectOverCDP`. Tests
 * inject a stub; the real Next.js route uses Playwright at runtime.
 */
export type CdpAttachFn = (
  endpoint: string,
  options?: { timeout?: number }
) => Promise<CdpAttachedBrowser>;

/** Minimal Browser surface used by the route helper. */
export interface CdpAttachedBrowser {
  contexts(): { pages(): Phase2PageLike[] }[];
  close(): Promise<void>;
}

/** Options for `executePhase2RouteHandler`. */
export interface ExecutePhase2RouteOptions {
  job: StampingJob;
  /** CDP endpoint resolver. Falls back to default if unset. */
  cdpEndpoint?: string;
  /** Bounded attach timeout. */
  cdpTimeoutMs?: number;
  /**
   * Stub for the CDP attach. Defaults to a thin lazy-imported
   * Playwright wrapper. Tests pass a stub to keep Playwright +
   * Chrome out of the loop.
   */
  attach?: CdpAttachFn;
  /**
   * Stub for the executor. Defaults to
   * `executePhase2MaklumatAmSave`. Tests pass a stub to assert
   * routing behaviour without simulating a full mock page.
   */
  executor?: typeof executePhase2MaklumatAmSave;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
}

// ─── Public handler ───────────────────────────────────────────────

/**
 * Run a single Phase 2 Maklumat Am attempt for the given job.
 *
 * The handler returns a sanitized `Phase2ExecutionResult`
 * regardless of which step refused or failed; the route layer's
 * job is to persist the result and return JSON. Persistence rules
 * (e.g. recording a `supervised_run_phase_2_maklumat_am_saved`
 * event on success) live in the route file.
 *
 * Refuses BEFORE touching CDP whenever any pure-preflight step
 * fails. Refuses AFTER attaching but BEFORE writing if no p5 page
 * is detected. Only invokes the executor on a single resolved p5
 * page.
 */
export async function executePhase2RouteHandler(
  opts: ExecutePhase2RouteOptions
): Promise<Phase2ExecutionResult> {
  const now = opts.now ?? defaultNow;
  const attemptedAt = now();

  // ── Step 1: pure preflight ──
  const preflight = evaluatePhase2Preflight(opts.job);
  if (!preflight.ok) {
    return refusal(preflight.refusalReason, attemptedAt);
  }

  // ── Step 2: build the Phase 2 payload ──
  const payloadResult = buildPhase2MaklumatAmPayload(opts.job);
  if (!payloadResult.ok) {
    return refusal(payloadResult.refusalReason, attemptedAt);
  }

  // ── Step 3: attach to CDP ──
  const attach = opts.attach ?? (await defaultCdpAttach());
  if (!attach) {
    // Playwright import failed — should not happen in a Node
    // runtime, but fail closed on the safe side.
    return refusal("browser_not_reachable", attemptedAt);
  }
  const cdpEndpoint =
    typeof opts.cdpEndpoint === "string" && opts.cdpEndpoint.length > 0
      ? opts.cdpEndpoint
      : DEFAULT_CDP_ENDPOINT;
  const timeoutMs =
    typeof opts.cdpTimeoutMs === "number" && opts.cdpTimeoutMs > 0
      ? opts.cdpTimeoutMs
      : DEFAULT_CDP_TIMEOUT_MS;
  let browser: CdpAttachedBrowser;
  try {
    browser = await attach(cdpEndpoint, { timeout: timeoutMs });
  } catch {
    return refusal("browser_not_reachable", attemptedAt);
  }

  // ── Step 4: find the p5 page ──
  const p5Page = findFirstP5Page(browser);

  // ── Step 5: execute (if a p5 page was found) ──
  let result: Phase2ExecutionResult;
  if (!p5Page) {
    result = refusal("p5_form_not_detected", attemptedAt);
  } else {
    const executor = opts.executor ?? executePhase2MaklumatAmSave;
    try {
      result = await executor({
        page: p5Page,
        payload: payloadResult.payload,
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      });
    } catch {
      // The executor itself catches its own Playwright errors;
      // this branch is defence-in-depth. Translate to safe
      // failure wording without leaking exception text.
      result = {
        status: "failed",
        refusalReason: "save_failed",
        reason: PHASE_2_REASON_LABELS.save_failed,
        attemptedAt,
      };
    }
  }

  // ── Step 6: detach (never close the operator's Chrome) ──
  try {
    await browser.close();
  } catch {
    // Swallow — the operator's browser remains; nothing to do.
  }

  return result;
}

// ─── Internals ────────────────────────────────────────────────────

function defaultNow(): string {
  return new Date().toISOString();
}

function refusal(
  reason: Phase2RefusalReason,
  attemptedAt: string
): Phase2ExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_2_REASON_LABELS[reason],
    attemptedAt,
  };
}

/**
 * Find the first page across every browser context whose URL
 * classifies as `sewa_pajakan_p5_form`. Returns `null` when none
 * is found. Read-only — only `page.url()` is called per page.
 */
function findFirstP5Page(
  browser: CdpAttachedBrowser
): Phase2PageLike | null {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      let rawUrl: string;
      try {
        rawUrl = page.url();
      } catch {
        continue;
      }
      // The raw URL is intentionally dropped at this seam — only
      // the path-shape enum is compared.
      if (
        classifySupervisedSessionPath(rawUrl) === "sewa_pajakan_p5_form"
      ) {
        return page;
      }
    }
  }
  return null;
}

/**
 * Lazy-imported Playwright `connectOverCDP` wrapper. Returns a
 * function compatible with `CdpAttachFn`, or `null` if the import
 * fails (e.g. in a non-Node runtime). Server-only by construction.
 */
async function defaultCdpAttach(): Promise<CdpAttachFn | null> {
  try {
    const { chromium } = await import("playwright");
    return async (endpoint: string, options?: { timeout?: number }) => {
      const browser = await chromium.connectOverCDP(endpoint, options);
      return {
        contexts: () =>
          browser.contexts().map((ctx) => ({
            // Playwright's `Page.locator(...).selectOption(...)` returns
            // `Promise<string[]>` whereas our structural
            // `Phase2LocatorLike.selectOption` returns `Promise<void>`
            // (the executor never reads the return value). The cast
            // below is the standard structural-typing escape hatch
            // at this seam — every method WeStamp actually invokes
            // is structurally compatible.
            pages: () => ctx.pages() as unknown as Phase2PageLike[],
          })),
        close: () => browser.close(),
      };
    };
  } catch {
    return null;
  }
}
