/**
 * WeStamp — Tenancy Phase 3 Landlord Individual · API route helper
 *
 * Pure handler behind:
 *
 *   POST /api/intake/[id]/supervised-run/execute-phase-3-landlord-individual
 *
 * Mirrors the B7 Phase 2 route helper structurally:
 *   1. validate the job + run pure preflight
 *   2. build the executor payload
 *   3. attach to CDP
 *   4. find the p5 page
 *   5. wrap the Playwright Page in a `Phase3PageLike` adapter
 *      (translating the high-level helpers — tab anchor click,
 *      role-scoped anchor click, role-scoped table-row count — to
 *      Playwright `page.evaluateHandle` / `locator` chains)
 *   6. call the executor
 *   7. return a sanitized `Phase3LandlordExecutionResult` for the
 *      Next.js route to persist
 */

import {
  buildPhase3LandlordPayload,
  evaluatePhase3LandlordPreflight,
  executePhase3LandlordIndividualSave,
  PHASE_3_LANDLORD_REASON_LABELS,
  type Phase3LandlordExecutionResult,
  type Phase3LandlordRefusalReason,
  type Phase3PageLike,
} from "./tenancy-phase-3-landlord-executor";
import { classifySupervisedSessionPath } from "./tenancy-supervised-session-path";
import {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_CDP_TIMEOUT_MS,
} from "./tenancy-supervised-session-route";
import type { StampingJob } from "./stamping-types";

// ─── Public types ──────────────────────────────────────────────────

export type Phase3LandlordCdpAttachFn = (
  endpoint: string,
  options?: { timeout?: number }
) => Promise<Phase3LandlordCdpAttachedBrowser>;

export interface Phase3LandlordCdpAttachedBrowser {
  contexts(): { pages(): Phase3PageLike[] }[];
  close(): Promise<void>;
}

export interface ExecutePhase3LandlordRouteOptions {
  job: StampingJob;
  cdpEndpoint?: string;
  cdpTimeoutMs?: number;
  attach?: Phase3LandlordCdpAttachFn;
  executor?: typeof executePhase3LandlordIndividualSave;
  now?: () => string;
}

// ─── Public handler ───────────────────────────────────────────────

export async function executePhase3LandlordRouteHandler(
  opts: ExecutePhase3LandlordRouteOptions
): Promise<Phase3LandlordExecutionResult> {
  const now = opts.now ?? defaultNow;
  const attemptedAt = now();

  // ── Step 1: pure preflight ──
  const preflight = evaluatePhase3LandlordPreflight(opts.job);
  if (!preflight.ok) {
    return refusal(preflight.refusalReason, attemptedAt);
  }
  const party = preflight.party;

  // ── Step 2: build payload ──
  const payloadResult = buildPhase3LandlordPayload(party);
  if (!payloadResult.ok) {
    return {
      ...refusal(payloadResult.refusalReason, attemptedAt),
      ...(payloadResult.failedFieldKey
        ? { failedFieldKey: payloadResult.failedFieldKey }
        : {}),
    };
  }

  // ── Step 3: attach to CDP ──
  const attach = opts.attach ?? (await defaultCdpAttach());
  if (!attach) {
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
  let browser: Phase3LandlordCdpAttachedBrowser;
  try {
    browser = await attach(cdpEndpoint, { timeout: timeoutMs });
  } catch {
    return refusal("browser_not_reachable", attemptedAt);
  }

  // ── Step 4: find the p5 page ──
  const p5Page = findFirstP5Page(browser);

  // ── Step 5: execute (if a p5 page was found) ──
  let result: Phase3LandlordExecutionResult;
  if (!p5Page) {
    result = refusal("p5_form_not_detected", attemptedAt);
  } else {
    const executor =
      opts.executor ?? executePhase3LandlordIndividualSave;
    try {
      result = await executor({
        page: p5Page,
        payload: payloadResult.payload,
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      });
    } catch {
      result = {
        status: "failed",
        refusalReason: "save_failed",
        reason: PHASE_3_LANDLORD_REASON_LABELS.save_failed,
        attemptedAt,
      };
    }
  }

  // ── Step 6: detach (never close the operator's Chrome) ──
  try {
    await browser.close();
  } catch {
    // swallow
  }

  return result;
}

// ─── Internals ────────────────────────────────────────────────────

function defaultNow(): string {
  return new Date().toISOString();
}

function refusal(
  reason: Phase3LandlordRefusalReason,
  attemptedAt: string
): Phase3LandlordExecutionResult {
  return {
    status: "refused",
    refusalReason: reason,
    reason: PHASE_3_LANDLORD_REASON_LABELS[reason],
    attemptedAt,
  };
}

function findFirstP5Page(
  browser: Phase3LandlordCdpAttachedBrowser
): Phase3PageLike | null {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      let rawUrl: string;
      try {
        rawUrl = page.url();
      } catch {
        continue;
      }
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
 * Lazy-imported Playwright wrapper. Translates the executor's
 * structural `Phase3PageLike` to live Playwright calls — including
 * the higher-level helpers (tab anchor click, role-scoped anchor
 * click, role-scoped row count) which we translate via
 * `evaluateHandle` + `evaluate`.
 *
 * Returns `null` when Playwright cannot be imported (not a Node
 * runtime) — the route then refuses with `browser_not_reachable`.
 */
async function defaultCdpAttach(): Promise<Phase3LandlordCdpAttachFn | null> {
  try {
    const { chromium } = await import("playwright");
    return async (endpoint: string, options?: { timeout?: number }) => {
      const browser = await chromium.connectOverCDP(endpoint, options);
      return {
        contexts: () =>
          browser.contexts().map((ctx) => ({
            pages: () => ctx.pages().map((p) => adaptPlaywrightPage(p)),
          })),
        close: () => browser.close(),
      };
    };
  } catch {
    return null;
  }
}

/**
 * Adapt a Playwright Page to the executor's `Phase3PageLike`
 * surface. The adapter implements the high-level helpers
 * (`clickTabAnchor`, `clickRoleScopedAnchor`,
 * `countTableRowsInRoleSection`) via `page.evaluateHandle` /
 * `evaluate` so the executor stays decoupled from Playwright.
 *
 * The adapter's runtime-only logic mirrors B9's diagnostic — find
 * the role's `<fieldset>` by walking up from a heading whose text
 * matches `roleHeadingMatch`, then scope the action inside that
 * fieldset.
 *
 * Bundles are returned as a single value so the helper can be
 * tested without instantiating Playwright.
 */
function adaptPlaywrightPage(
  rawPage: unknown
): Phase3PageLike {
  // Use `unknown` here so we don't import Playwright types into
  // the client bundle. Cast inside the closure where we know the
  // shape.
  type PlaywrightPageShape = {
    url(): string;
    locator(selector: string): unknown;
    waitForLoadState(
      state: "load" | "domcontentloaded" | "networkidle",
      options?: { timeout?: number }
    ): Promise<void>;
    evaluate(
      fn: (args: { selector: string; timeoutMs: number }) => unknown,
      args: { selector: string; timeoutMs: number }
    ): Promise<unknown>;
    evaluateHandle<T>(
      fn: (args: { roleHeadingMatch?: string; anchorText?: string; tabText?: string }) => T,
      args: { roleHeadingMatch?: string; anchorText?: string; tabText?: string }
    ): Promise<{
      asElement(): null | {
        click(opts?: { timeout?: number }): Promise<void>;
        evaluate<R>(fn: (el: unknown) => R): Promise<R>;
      };
      dispose(): Promise<void>;
    }>;
  };
  const page = rawPage as PlaywrightPageShape;

  // Inner function — finds an element by text inside the role
  // section via DOM walk. Used twice (clickRoleScopedAnchor +
  // countTableRowsInRoleSection).
  const ROLE_SCOPE_FN = `
    function findFieldsetByHeadingMatch(roleHeadingMatch) {
      const re = new RegExp(roleHeadingMatch, "i");
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, legend")
      );
      for (const h of headings) {
        const t = h.textContent || "";
        if (re.test(t)) {
          const fs = h.closest("fieldset");
          if (fs) return fs;
        }
      }
      return null;
    }
  `;
  void ROLE_SCOPE_FN;

  return {
    url: () => page.url(),
    locator: (selector: string) =>
      adaptPlaywrightLocator(page.locator(selector)),
    waitForLoadState: (state, options) =>
      page.waitForLoadState(state, options),
    async clickTabAnchor(args) {
      const handle = await page.evaluateHandle(
        ({ tabText }: { tabText?: string }) => {
          if (typeof tabText !== "string") return null;
          const anchors = Array.from(document.querySelectorAll("a"));
          for (const a of anchors) {
            const t = (a.textContent || "").trim();
            if (t === tabText) return a;
          }
          return null;
        },
        { tabText: args.text }
      );
      const el = handle.asElement();
      if (!el) {
        await handle.dispose();
        throw new Error("clickTabAnchor: anchor not found");
      }
      await el.click({ timeout: args.timeout });
      await handle.dispose();
      // Allow tab swap animation to settle.
      await new Promise((r) => setTimeout(r, 400));
    },
    async clickRoleScopedAnchor(args) {
      const handle = await page.evaluateHandle(
        ({
          roleHeadingMatch,
          anchorText,
        }: {
          roleHeadingMatch?: string;
          anchorText?: string;
        }) => {
          if (
            typeof roleHeadingMatch !== "string" ||
            typeof anchorText !== "string"
          )
            return null;
          const re = new RegExp(roleHeadingMatch, "i");
          const headings = Array.from(
            document.querySelectorAll("h1, h2, h3, h4, h5, legend")
          );
          for (const h of headings) {
            if (!re.test(h.textContent || "")) continue;
            const fs = h.closest("fieldset");
            if (!fs) continue;
            const anchors = Array.from(fs.querySelectorAll("a"));
            for (const a of anchors) {
              const t = (a.textContent || "").trim();
              if (t === anchorText) return a;
            }
          }
          return null;
        },
        { roleHeadingMatch: args.roleHeadingMatch, anchorText: args.anchorText }
      );
      const el = handle.asElement();
      if (!el) {
        await handle.dispose();
        throw new Error("clickRoleScopedAnchor: anchor not found");
      }
      await el.click({ timeout: args.timeout });
      await handle.dispose();
      // Allow modal open animation.
      await new Promise((r) => setTimeout(r, 800));
    },
    async countTableRowsInRoleSection(args) {
      const handle = await page.evaluateHandle(
        ({ roleHeadingMatch }: { roleHeadingMatch?: string }) => {
          if (typeof roleHeadingMatch !== "string") return null;
          const re = new RegExp(roleHeadingMatch, "i");
          const headings = Array.from(
            document.querySelectorAll("h1, h2, h3, h4, h5, legend")
          );
          for (const h of headings) {
            if (!re.test(h.textContent || "")) continue;
            const fs = h.closest("fieldset");
            if (!fs) continue;
            const tbl = fs.querySelector("table");
            if (!tbl) continue;
            return tbl;
          }
          return null;
        },
        { roleHeadingMatch: args.roleHeadingMatch }
      );
      const el = handle.asElement();
      if (!el) {
        await handle.dispose();
        return 0;
      }
      const count = await el.evaluate((t: unknown) => {
        const table = t as HTMLTableElement;
        return table.querySelectorAll("tbody tr").length;
      });
      await handle.dispose();
      return count;
    },
  };
}

/**
 * Adapt a Playwright Locator to the executor's `Phase3LocatorLike`.
 * Direct passthrough for `count`, `click`, `fill`, `isVisible`,
 * `inputValue`. `selectOption` accepts the same union shape
 * Playwright already supports natively.
 */
function adaptPlaywrightLocator(rawLoc: unknown) {
  type PlaywrightLocatorShape = {
    count(): Promise<number>;
    click(options?: { timeout?: number }): Promise<void>;
    fill(value: string, options?: { timeout?: number }): Promise<void>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    inputValue(options?: { timeout?: number }): Promise<string>;
    selectOption(
      target: string | { value: string } | { label: string },
      options?: { timeout?: number }
    ): Promise<unknown>;
    press(key: string, options?: { timeout?: number }): Promise<void>;
  };
  const loc = rawLoc as PlaywrightLocatorShape;
  return {
    count: () => loc.count(),
    click: (opts?: { timeout?: number }) => loc.click(opts),
    fill: (value: string, opts?: { timeout?: number }) =>
      loc.fill(value, opts),
    isVisible: (opts?: { timeout?: number }) => loc.isVisible(opts),
    inputValue: (opts?: { timeout?: number }) => loc.inputValue(opts),
    selectOption: async (
      target: string | { value: string } | { label: string },
      opts?: { timeout?: number }
    ) => {
      await loc.selectOption(target, opts);
    },
    press: (key: string, opts?: { timeout?: number }) =>
      loc.press(key, opts),
  };
}

