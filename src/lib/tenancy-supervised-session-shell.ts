/**
 * WeStamp — Tenancy Supervised Browser Session Shell (Milestone B3)
 *
 * Read-only operator-side helper that inspects an existing real
 * Chrome / CDP session and answers, in sanitized terms:
 *   · Is Chrome reachable on the configured CDP endpoint?
 *   · Which page is the operator on (MyTax, e-Duti Setem dashboard,
 *     role-change page, Sewa/Pajakan p5 form, or unknown)?
 *   · Are the key non-sensitive DOM markers present on that page?
 *   · Is the page suitable for the next planned instruction-graph
 *     phase?
 *   · What should the operator do next manually?
 *
 * What this module IS
 * ───────────────────
 * - A pure classification + sanitization helper
 *   (`buildSupervisedSessionReport`). Pre-classified, pre-sanitized
 *   inputs in; a `SupervisedSessionReport` out. Safe to call from
 *   server components, API routes, or the operator panel.
 * - A path-classification helper (`classifySupervisedSessionPath`)
 *   that takes a raw URL **at the boundary** and returns ONLY a
 *   `SupervisedSessionPathKind` enum — the raw URL, query string,
 *   hash, and href are dropped at this seam and never propagated.
 * - A lazy-imported, server-only Playwright CDP attach wrapper
 *   (`inspectOperatorChromeSessionViaCdp`) that uses
 *   `chromium.connectOverCDP` to enumerate open pages, sanitizes
 *   each into a `SanitizedPageDescriptor`, and delegates to the
 *   pure helper. **Read-only.** Never clicks, fills, selects,
 *   uploads, submits, or saves. Never reads cookies / storage /
 *   tokens. Never closes the operator's browser.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT mutate the portal. There is no `page.click`,
 *   `page.fill`, `page.selectOption`, `page.evaluate(..)` that
 *   writes to the DOM, `setInputFiles`, `request.post`, or any
 *   other mutating Playwright API anywhere in this module.
 * - It does NOT submit, save, upload, or pay anything.
 * - It does NOT extract field values that contain user data. Marker
 *   queries are presence-only (`locator(...).count() > 0`).
 * - It does NOT store cookies, tokens, SSO values, lhdnmsstoken,
 *   IC numbers, TINs, firm IDs, party names, addresses, or
 *   uploaded document content.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print
 *   logic.
 *
 * Sensitive-data policy
 * ─────────────────────
 * The serialized `SupervisedSessionReport` contains only:
 *   - the fixed enum values (status / pageKind / pathKind /
 *     compatibility)
 *   - small non-sensitive integers (candidatePageCount)
 *   - boolean marker flags (presence of stable form / select / tab
 *     names — never the values inside them)
 *   - operator-facing recommended-action strings drawn from a fixed
 *     vocabulary
 *
 * Test 9 in `tenancy-supervised-session-shell.test.ts` enforces
 * this invariant graph-wide.
 */

import type { TenancyInstructionPhaseId } from "./tenancy-instruction-graph";
import {
  classifySupervisedSessionPath as classifySupervisedSessionPathImpl,
  type SupervisedSessionPathKind as SupervisedSessionPathKindImpl,
} from "./tenancy-supervised-session-path";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Coarse session status — what the operator's Chrome session looks
 * like to WeStamp. Mirrors the brief's required state set.
 *
 *   - cdp_unreachable          : CDP attach failed (Chrome not
 *                                 launched with --remote-debugging
 *                                 or wrong endpoint).
 *   - chrome_reachable_no_pages: Chrome is reachable but exposes
 *                                 zero open pages we recognise.
 *   - mytax_dashboard          : The operator is on the MyTax
 *                                 dashboard / login surface.
 *   - stamps_role_change       : The operator is on the e-Duti Setem
 *                                 role-change page.
 *   - stamps_dashboard         : The operator is on the post-firm
 *                                 e-Duti Setem dashboard.
 *   - sewa_pajakan_p5_form     : The operator is on the Sewa /
 *                                 Pajakan p5 form (draft create or
 *                                 edit).
 *   - unknown_page             : Some other page WeStamp does not
 *                                 yet recognise.
 */
export type SupervisedSessionStatus =
  | "cdp_unreachable"
  | "chrome_reachable_no_pages"
  | "mytax_dashboard"
  | "stamps_role_change"
  | "stamps_dashboard"
  | "sewa_pajakan_p5_form"
  | "unknown_page";

/**
 * Page-kind enum — the kind WeStamp identified for the selected
 * page. `"unknown"` covers pages that did not match any kind.
 */
export type SupervisedSessionPageKind =
  | "mytax_dashboard"
  | "stamps_role_change"
  | "stamps_dashboard"
  | "sewa_pajakan_p5_form"
  | "unknown";

/**
 * Path-shape enum — coarser than page kind because it derives from
 * URL pathname only (no DOM marker information). Returned by
 * `classifySupervisedSessionPath` at the URL-receiving boundary so
 * the raw URL never propagates into a `SupervisedSessionReport`.
 *
 * The implementation lives in
 * `tenancy-supervised-session-path.ts` so that client-reachable
 * code paths (e.g. the Phase 2 executor) can import the classifier
 * without transitively pulling Playwright into the client bundle.
 * This module re-exports the type and function to keep existing
 * callers unaffected.
 */
export type SupervisedSessionPathKind = SupervisedSessionPathKindImpl;

/** Compatibility of the selected page with a target instruction-graph phase. */
export type GraphPhaseCompatibility = "compatible" | "incompatible" | "unknown";

/**
 * Boolean DOM-marker flags. Every flag is presence-only — `true`
 * iff the corresponding selector matched at least one element. NO
 * value extraction occurs.
 *
 * Fields cover the marker set called out in the brief plus a few
 * tab-presence booleans the operator UI will eventually need to
 * triage incomplete forms.
 */
export interface SupervisedSessionSafeMarkers {
  // Sewa/Pajakan p5 form — fixed-vocabulary select / input names
  pdsSuratcaraPresent: boolean;
  pdsJenisPresent: boolean;
  pdsSalinanPresent: boolean;
  pdsHartaStatePresent: boolean;
  pdsHartaCountryPresent: boolean;
  pdsHartaTypePresent: boolean;
  pdsHartaPerabotPresent: boolean;
  pdsLuasUnitPresent: boolean;
  pdsAlamat1Present: boolean;
  // Tab indicators (visible-tab presence; values are not read)
  hasMaklumatAmTab: boolean;
  hasBahagianATab: boolean;
  hasBahagianBTab: boolean;
  hasBahagianCTab: boolean;
  hasLampiranTab: boolean;
  hasRumusanTab: boolean;
  hasPerakuanTab: boolean;
}

/** Default all-false marker block. Used when CDP is unreachable. */
export const ABSENT_MARKERS: Readonly<SupervisedSessionSafeMarkers> =
  Object.freeze({
    pdsSuratcaraPresent: false,
    pdsJenisPresent: false,
    pdsSalinanPresent: false,
    pdsHartaStatePresent: false,
    pdsHartaCountryPresent: false,
    pdsHartaTypePresent: false,
    pdsHartaPerabotPresent: false,
    pdsLuasUnitPresent: false,
    pdsAlamat1Present: false,
    hasMaklumatAmTab: false,
    hasBahagianATab: false,
    hasBahagianBTab: false,
    hasBahagianCTab: false,
    hasLampiranTab: false,
    hasRumusanTab: false,
    hasPerakuanTab: false,
  });

/**
 * One sanitized page descriptor consumed by the pure helper. The
 * raw URL has been dropped at the boundary; only the pre-classified
 * `pathKind` and the safe-marker flags remain.
 */
export interface SanitizedPageDescriptor {
  pathKind: SupervisedSessionPathKind;
  safeMarkers: Readonly<SupervisedSessionSafeMarkers>;
}

/** Pure-helper input. */
export interface SupervisedSessionInspectionInput {
  /** Whether CDP attach succeeded. */
  reachable: boolean;
  /**
   * Sanitized list of pages reported by Chrome, post-classification
   * and post-marker-extraction. Empty when CDP is unreachable or
   * when Chrome is reachable but exposes no pages.
   */
  pages: SanitizedPageDescriptor[];
  /**
   * Optional target instruction-graph phase to check compatibility
   * against. Omitting this returns
   * `graphPhaseCompatibility: "unknown"`.
   */
  targetPhaseId?: TenancyInstructionPhaseId;
}

/** Top-level sanitized output report. */
export interface SupervisedSessionReport {
  status: SupervisedSessionStatus;
  reachable: boolean;
  /** Total page count returned by Chrome (pre-filter). Small integer. */
  candidatePageCount: number;
  /** The page kind WeStamp picked as the most relevant (or `"unknown"`). */
  selectedPageKind: SupervisedSessionPageKind;
  /** Alias for `selectedPageKind` — keeps the brief's required field name. */
  pageKind: SupervisedSessionPageKind;
  /** The path-shape of the selected page. */
  pathKind: SupervisedSessionPathKind;
  /** Marker booleans for the selected page (or all-false on unreachable). */
  safeMarkers: SupervisedSessionSafeMarkers;
  /** Compatibility of the selected page with `targetPhaseId`. */
  graphPhaseCompatibility: GraphPhaseCompatibility;
  /** One operator-facing sentence drawn from the approved vocabulary. */
  recommendedOperatorAction: string;
  /** Short, sanitized free-text reason for the status. */
  reason: string;
}

// ─── Approved operator-action vocabulary (constants) ───────────────

export const OPERATOR_ACTION_LAUNCH_CHROME =
  "Launch Chrome with remote debugging enabled.";
export const OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD =
  "Open the e-Duti Setem dashboard.";
export const OPERATOR_ACTION_COMPLETE_FIRM_SELECTION =
  "Complete firm selection manually.";
export const OPERATOR_ACTION_OPEN_P5_FORM =
  "Open the Sewa/Pajakan p5 form.";
export const OPERATOR_ACTION_READY_FOR_VERIFICATION =
  "Ready for read-only phase-position verification.";
export const OPERATOR_ACTION_NAVIGATE_MANUALLY =
  "Page not recognised. Navigate manually to the Sewa/Pajakan p5 form.";

// ─── Path classification (URL-boundary) ────────────────────────────

/**
 * Re-export of `classifySupervisedSessionPath` from
 * `tenancy-supervised-session-path.ts`. The implementation moved
 * out of this file so that client-reachable code paths (e.g. the
 * Phase 2 executor) can import the classifier without transitively
 * loading Playwright into the client bundle.
 *
 * Behaviour and contract are unchanged. See the implementation
 * file for full documentation.
 */
export const classifySupervisedSessionPath =
  classifySupervisedSessionPathImpl;

// ─── Pure builder ──────────────────────────────────────────────────

/**
 * Build the sanitized session report from pre-classified, pre-
 * sanitized inputs. Pure. Total. Free of I/O.
 *
 * Rules:
 *   - reachable === false                              → `cdp_unreachable`
 *   - reachable === true && pages.length === 0         → `chrome_reachable_no_pages`
 *   - otherwise pick the most-relevant page (priority:
 *       sewa_pajakan_p5_form > stamps_role_change >
 *       stamps_dashboard > mytax_dashboard > other) and report its
 *       safe markers + compute compatibility against
 *       `targetPhaseId`.
 */
export function buildSupervisedSessionReport(
  input: SupervisedSessionInspectionInput
): SupervisedSessionReport {
  const { reachable, pages, targetPhaseId } = input;

  if (!reachable) {
    return {
      status: "cdp_unreachable",
      reachable: false,
      candidatePageCount: 0,
      selectedPageKind: "unknown",
      pageKind: "unknown",
      pathKind: "other",
      safeMarkers: { ...ABSENT_MARKERS },
      graphPhaseCompatibility: deriveGraphPhaseCompatibility(
        "unknown",
        targetPhaseId,
        false
      ),
      recommendedOperatorAction: OPERATOR_ACTION_LAUNCH_CHROME,
      reason: "CDP endpoint is not reachable.",
    };
  }

  const candidatePageCount = pages.length;

  if (candidatePageCount === 0) {
    return {
      status: "chrome_reachable_no_pages",
      reachable: true,
      candidatePageCount: 0,
      selectedPageKind: "unknown",
      pageKind: "unknown",
      pathKind: "other",
      safeMarkers: { ...ABSENT_MARKERS },
      graphPhaseCompatibility: deriveGraphPhaseCompatibility(
        "unknown",
        targetPhaseId,
        true
      ),
      recommendedOperatorAction: OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD,
      reason: "Chrome is reachable but has no recognisable open pages.",
    };
  }

  const selected = selectMostRelevantPage(pages);
  const selectedPageKind = pageKindFromPath(selected.pathKind);
  const status = statusFromPageKind(selectedPageKind);
  const compatibility = deriveGraphPhaseCompatibility(
    selectedPageKind,
    targetPhaseId,
    true
  );
  const recommendedOperatorAction = deriveRecommendedOperatorAction(
    selectedPageKind,
    targetPhaseId
  );
  const reason = deriveReason(status, selectedPageKind);

  return {
    status,
    reachable: true,
    candidatePageCount,
    selectedPageKind,
    pageKind: selectedPageKind,
    pathKind: selected.pathKind,
    safeMarkers: { ...ABSENT_MARKERS, ...selected.safeMarkers },
    graphPhaseCompatibility: compatibility,
    recommendedOperatorAction,
    reason,
  };
}

// ─── Lazy-imported CDP attach wrapper (server-only) ────────────────

/**
 * Server-only Playwright CDP wrapper that:
 *   1. Tries to attach to `cdpEndpoint` with a bounded timeout. On
 *      failure, returns the `cdp_unreachable` report.
 *   2. Enumerates open pages from every browser context.
 *   3. For each page: (a) reads `page.url()` and immediately drops
 *      it through `classifySupervisedSessionPath`, retaining only
 *      the resulting enum; (b) on Sewa/Pajakan p5 pages only, runs
 *      a fixed list of presence-only locator counts to populate
 *      `SupervisedSessionSafeMarkers`. **No value extraction.**
 *   4. Disconnects (does NOT close the browser).
 *   5. Delegates to the pure helper.
 *
 * Read-only by construction:
 *   - No `page.click`, `page.fill`, `page.selectOption`,
 *     `page.evaluate(..)` mutation, `page.setInputFiles`,
 *     `page.goto`, `page.reload`, `page.bringToFront`,
 *     `request.post` etc. anywhere.
 *   - Only `page.url()` and `page.locator(name).count()`.
 *   - No reads of `page.context().storageState()`, cookies, headers,
 *     localStorage, sessionStorage, or tokens.
 *
 * The Playwright import is dynamic so this module is safe to import
 * from client bundles (the dynamic import only resolves at call
 * time on the server). Callers who never invoke this function pay
 * no Playwright cost at module load.
 */
export async function inspectOperatorChromeSessionViaCdp(opts: {
  cdpEndpoint: string;
  targetPhaseId?: TenancyInstructionPhaseId;
  /** Bounded attach timeout. Default: 2000 ms. */
  timeoutMs?: number;
}): Promise<SupervisedSessionReport> {
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 2000;

  // Defensive guard: refuse obviously-bad endpoints early.
  if (typeof opts.cdpEndpoint !== "string" || opts.cdpEndpoint.length === 0) {
    return buildSupervisedSessionReport({
      reachable: false,
      pages: [],
      ...(opts.targetPhaseId !== undefined
        ? { targetPhaseId: opts.targetPhaseId }
        : {}),
    });
  }

  // Dynamic import keeps this file safe in client bundles.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return buildSupervisedSessionReport({
      reachable: false,
      pages: [],
      ...(opts.targetPhaseId !== undefined
        ? { targetPhaseId: opts.targetPhaseId }
        : {}),
    });
  }

  let browser: import("playwright").Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(opts.cdpEndpoint, {
      timeout: timeoutMs,
    });
  } catch {
    return buildSupervisedSessionReport({
      reachable: false,
      pages: [],
      ...(opts.targetPhaseId !== undefined
        ? { targetPhaseId: opts.targetPhaseId }
        : {}),
    });
  }

  let pages: SanitizedPageDescriptor[] = [];
  try {
    pages = await sanitizePagesReadOnly(browser);
  } finally {
    // Always release the CDP connection. Never close the operator's
    // browser — this is a read-only inspection, not a session
    // takeover.
    try {
      await browser.close();
    } catch {
      // Swallow: the operator's browser remains. Nothing to do.
    }
  }

  return buildSupervisedSessionReport({
    reachable: true,
    pages,
    ...(opts.targetPhaseId !== undefined
      ? { targetPhaseId: opts.targetPhaseId }
      : {}),
  });
}

/**
 * Read-only enumeration of pages: collect URLs, classify into path
 * kinds at the boundary, drop the URLs, and run a fixed list of
 * presence-only locator counts for Sewa/Pajakan p5 markers.
 */
async function sanitizePagesReadOnly(
  browser: import("playwright").Browser
): Promise<SanitizedPageDescriptor[]> {
  const out: SanitizedPageDescriptor[] = [];
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      let rawUrl: string;
      try {
        rawUrl = page.url();
      } catch {
        continue;
      }
      const pathKind = classifySupervisedSessionPath(rawUrl);
      // The raw URL is intentionally dropped at this seam.
      let safeMarkers: SupervisedSessionSafeMarkers = { ...ABSENT_MARKERS };
      if (pathKind === "sewa_pajakan_p5_form") {
        try {
          safeMarkers = await readP5SafeMarkers(page);
        } catch {
          // Marker read failed; fall back to all-false. Never throw.
        }
      }
      out.push({ pathKind, safeMarkers });
    }
  }
  return out;
}

/**
 * Read-only marker reader for the Sewa/Pajakan p5 form. Each
 * marker is the boolean answer to "is at least one element with
 * this stable name attached to the page?". No value extraction.
 *
 * The `locator(...).count()` API does NOT mutate the DOM; it is a
 * pure read-only query.
 */
async function readP5SafeMarkers(
  page: import("playwright").Page
): Promise<SupervisedSessionSafeMarkers> {
  const has = async (sel: string): Promise<boolean> => {
    try {
      return (await page.locator(sel).count()) > 0;
    } catch {
      return false;
    }
  };
  const tabHas = async (label: string): Promise<boolean> => {
    // Tabs are looked up by their stable Bahasa labels; if the
    // portal renders multiple tab implementations, any one matching
    // suffices. Read-only.
    try {
      return (
        (await page
          .locator(`a:has-text("${label}"), button:has-text("${label}")`)
          .count()) > 0
      );
    } catch {
      return false;
    }
  };
  const [
    pdsSuratcaraPresent,
    pdsJenisPresent,
    pdsSalinanPresent,
    pdsHartaStatePresent,
    pdsHartaCountryPresent,
    pdsHartaTypePresent,
    pdsHartaPerabotPresent,
    pdsLuasUnitPresent,
    pdsAlamat1Present,
    hasMaklumatAmTab,
    hasBahagianATab,
    hasBahagianBTab,
    hasBahagianCTab,
    hasLampiranTab,
    hasRumusanTab,
    hasPerakuanTab,
  ] = await Promise.all([
    has('select[name="pds_suratcara"]'),
    has('select[name="pds_jenis"]'),
    has('select[name="pds_salinan"]'),
    has('select[name="pds_harta_state"]'),
    has('select[name="pds_harta_country"]'),
    has('select[name="pds_harta_type"]'),
    has('select[name="pds_harta_perabot"]'),
    has('select[name="pds_luasunit"]'),
    has('input[name="pds_alamat_1"], textarea[name="pds_alamat_1"]'),
    tabHas("Maklumat Am"),
    tabHas("Bahagian A"),
    tabHas("Bahagian B"),
    tabHas("Bahagian C"),
    tabHas("Lampiran"),
    tabHas("Rumusan"),
    tabHas("Perakuan"),
  ]);
  return {
    pdsSuratcaraPresent,
    pdsJenisPresent,
    pdsSalinanPresent,
    pdsHartaStatePresent,
    pdsHartaCountryPresent,
    pdsHartaTypePresent,
    pdsHartaPerabotPresent,
    pdsLuasUnitPresent,
    pdsAlamat1Present,
    hasMaklumatAmTab,
    hasBahagianATab,
    hasBahagianBTab,
    hasBahagianCTab,
    hasLampiranTab,
    hasRumusanTab,
    hasPerakuanTab,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

/**
 * Pick the most operator-relevant page. Priority order:
 *   sewa_pajakan_p5_form > stamps_role_change > stamps_dashboard
 *   > mytax_dashboard > other.
 *
 * `pages` is non-empty by precondition (callers handle the empty
 * case before invoking).
 */
function selectMostRelevantPage(
  pages: SanitizedPageDescriptor[]
): SanitizedPageDescriptor {
  const order: SupervisedSessionPathKind[] = [
    "sewa_pajakan_p5_form",
    "stamps_role_change",
    "stamps_dashboard",
    "mytax_dashboard",
    "other",
  ];
  for (const k of order) {
    const hit = pages.find((p) => p.pathKind === k);
    if (hit) return hit;
  }
  return pages[0];
}

function pageKindFromPath(
  pathKind: SupervisedSessionPathKind
): SupervisedSessionPageKind {
  if (pathKind === "other") return "unknown";
  return pathKind;
}

function statusFromPageKind(
  pageKind: SupervisedSessionPageKind
): SupervisedSessionStatus {
  switch (pageKind) {
    case "mytax_dashboard":
      return "mytax_dashboard";
    case "stamps_role_change":
      return "stamps_role_change";
    case "stamps_dashboard":
      return "stamps_dashboard";
    case "sewa_pajakan_p5_form":
      return "sewa_pajakan_p5_form";
    case "unknown":
      return "unknown_page";
  }
}

/**
 * Compute graph-phase compatibility. The mapping below mirrors the
 * scoping document §4 phase-by-phase requirements:
 *
 *   Phase 0 (offline preflight)         → compatible regardless of page
 *   Phase 1 (session/portal positioning)→ stamps_role_change or stamps_dashboard
 *   Phase 2 → 8 (any portal contact)    → sewa_pajakan_p5_form
 *
 * Returns `unknown` when:
 *   - `targetPhaseId` is undefined (caller didn't ask), OR
 *   - CDP is unreachable (we cannot know the page).
 */
function deriveGraphPhaseCompatibility(
  pageKind: SupervisedSessionPageKind,
  targetPhaseId: TenancyInstructionPhaseId | undefined,
  reachable: boolean
): GraphPhaseCompatibility {
  if (!reachable) return "unknown";
  if (targetPhaseId === undefined) return "unknown";

  switch (targetPhaseId) {
    case "phase_0_preflight":
      // Offline phase — always compatible (no page contact needed).
      return "compatible";
    case "phase_1_session_positioning":
      if (
        pageKind === "stamps_role_change" ||
        pageKind === "stamps_dashboard"
      ) {
        return "compatible";
      }
      if (pageKind === "unknown") return "unknown";
      return "incompatible";
    case "phase_2_maklumat_am_draft":
    case "phase_3_bahagian_a_parties":
    case "phase_4_bahagian_b_rent":
    case "phase_5_bahagian_c_property":
    case "phase_6_lampiran_upload":
    case "phase_7_rumusan_readback":
    case "phase_8_perakuan_hantar":
      if (pageKind === "sewa_pajakan_p5_form") return "compatible";
      if (pageKind === "unknown") return "unknown";
      return "incompatible";
  }
}

/**
 * Choose an approved operator-action sentence based on the page
 * kind and (optionally) the target phase. Uses only fixed-vocabulary
 * constants — never composes a per-job string.
 */
function deriveRecommendedOperatorAction(
  pageKind: SupervisedSessionPageKind,
  targetPhaseId: TenancyInstructionPhaseId | undefined
): string {
  switch (pageKind) {
    case "mytax_dashboard":
      return OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD;
    case "stamps_role_change":
      return OPERATOR_ACTION_COMPLETE_FIRM_SELECTION;
    case "stamps_dashboard":
      // When the operator is on the dashboard and the target phase
      // is the (read-only) positioning phase, no further action is
      // needed before phase-position verification. Otherwise direct
      // them to the p5 form (Phase 2+ requires it).
      if (targetPhaseId === "phase_1_session_positioning") {
        return OPERATOR_ACTION_READY_FOR_VERIFICATION;
      }
      return OPERATOR_ACTION_OPEN_P5_FORM;
    case "sewa_pajakan_p5_form":
      return OPERATOR_ACTION_READY_FOR_VERIFICATION;
    case "unknown":
      return OPERATOR_ACTION_NAVIGATE_MANUALLY;
  }
}

function deriveReason(
  status: SupervisedSessionStatus,
  pageKind: SupervisedSessionPageKind
): string {
  switch (status) {
    case "cdp_unreachable":
      return "CDP endpoint is not reachable.";
    case "chrome_reachable_no_pages":
      return "Chrome is reachable but has no recognisable open pages.";
    case "mytax_dashboard":
      return "Operator session is on the MyTax dashboard.";
    case "stamps_role_change":
      return "Operator session is on the e-Duti Setem role-change page.";
    case "stamps_dashboard":
      return "Operator session is on the e-Duti Setem dashboard.";
    case "sewa_pajakan_p5_form":
      return "Operator session is on the Sewa/Pajakan p5 form.";
    case "unknown_page":
      // Reference the pageKind enum (always `unknown` here) so the
      // reason is still deterministic / fixed-vocabulary.
      return `Selected page kind is ${pageKind}.`;
  }
}
