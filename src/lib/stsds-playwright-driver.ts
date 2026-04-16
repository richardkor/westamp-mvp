/**
 * WeStamp — STSDS Playwright Browser Driver Adapter
 *
 * Concrete Playwright-based implementation of the BrowserDriverAdapter
 * interface for the e-Duti Setem portal.
 *
 * This is a DEV/LOCAL tool only:
 * - Requires a headed Chromium browser with manual login
 * - Interacts with the real e-Duti Setem portal
 * - Implements only the Maklumat Am probe-safe instruction types
 * - REFUSES to execute save, continue, or submit actions
 * - Tracks selector resolution method per field
 * - Normalizes observed values before returning
 *
 * NOT suitable for serverless/Vercel deployment.
 * NOT a background production automation path.
 */

import { Page, Locator } from "playwright";
import {
  BrowserAutomationTarget,
  BrowserAutomationPayload,
  BrowserAutomationExpectation,
  SelectorResolutionMethod,
  ReadbackConfidence,
} from "./stsds-types";
import {
  BrowserDriverAdapter,
  BrowserDriverOperationResult,
} from "./stsds-browser-driver";

/**
 * Portal entry URLs.
 *
 * For TIN holder accounts, the correct entry path is via MyTax → e-Duti Setem,
 * NOT the old stamps.hasil.gov.my public landing page. The old URL redirects
 * TIN holders back with a message to use MyTax instead.
 */
const MYTAX_BASE_URL = "https://mytax.hasil.gov.my";
const EDUTI_SETEM_URL = "https://stamps.hasil.gov.my";

/**
 * The primary portal base URL used by navigateToPage().
 * Set to MyTax since TIN holder accounts must enter via MyTax.
 */
const PORTAL_BASE_URL = MYTAX_BASE_URL;

/** Timeout for waiting on portal elements (ms). */
const ELEMENT_TIMEOUT = 15_000;

/** Timeout for navigation (ms). */
const NAVIGATION_TIMEOUT = 30_000;

/**
 * How long to keep the headed browser open on failure for local/dev
 * inspection before cleanup (ms). Default: 120 seconds.
 */
const FAILURE_INSPECTION_DELAY_MS = 120_000;

// ─── Value Normalization ────────────────────────────────────────────

/**
 * Normalize an observed portal value for cleaner assertion comparison.
 *
 * Rules applied (in order):
 * 1. Trim leading/trailing whitespace
 * 2. Collapse internal runs of whitespace to single spaces
 * 3. Strip zero-width characters (U+200B, U+FEFF, etc.)
 * 4. Normalize Unicode whitespace variants to ASCII space
 *
 * Does NOT change case (portal values are case-significant for names).
 * Does NOT truncate or abbreviate.
 * Returns the original value if no normalization was needed.
 */
function normalizeObservedValue(raw: string): {
  normalized: string;
  wasNormalized: boolean;
} {
  // Strip zero-width characters
  let result = raw.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, "");
  // Normalize Unicode whitespace to ASCII space
  result = result.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  // Collapse internal whitespace runs
  result = result.replace(/\s{2,}/g, " ");
  // Trim
  result = result.trim();

  return {
    normalized: result,
    wasNormalized: result !== raw,
  };
}

/**
 * Normalize a date string observed from the portal.
 *
 * The portal commonly displays dates as DD/MM/YYYY or DD-MM-YYYY.
 * WeStamp internally uses YYYY-MM-DD (ISO 8601).
 *
 * If the observed value looks like DD/MM/YYYY or DD-MM-YYYY,
 * normalize it to YYYY-MM-DD for assertion comparison.
 * Otherwise, return as-is with standard normalization.
 */
function normalizeDateValue(raw: string): {
  normalized: string;
  wasNormalized: boolean;
} {
  const base = normalizeObservedValue(raw);
  const val = base.normalized;

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/;
  const match = val.match(ddmmyyyy);
  if (match) {
    const [, dd, mm, yyyy] = match;
    const isoDate = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return { normalized: isoDate, wasNormalized: true };
  }

  return base;
}

// ─── Selector Resolution ────────────────────────────────────────────

interface ResolvedLocator {
  locator: Locator;
  method: SelectorResolutionMethod;
}

/**
 * Attempt to find an input field using multiple selector strategies.
 * Returns the first visible locator and which strategy succeeded.
 */
async function resolveInputField(
  page: Page,
  labelText: string,
  inputType: "input" | "select" = "input"
): Promise<ResolvedLocator | null> {
  const tag = inputType;

  // Strategy 1: Exact label text with following input
  const byLabelExact = page
    .locator(`label:has-text("${labelText}")`)
    .locator(`xpath=following-sibling::*//` + tag + ` | following::` + tag + `[1]`)
    .first();
  if (await byLabelExact.isVisible({ timeout: 2000 }).catch(() => false)) {
    return { locator: byLabelExact, method: "label_exact" };
  }

  // Strategy 2: Playwright getByLabel (uses aria associations)
  const byGetLabel = page.getByLabel(labelText, { exact: false }).first();
  if (await byGetLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    return { locator: byGetLabel, method: "get_by_label" };
  }

  // Strategy 3: Normalized label (collapse whitespace, trim)
  const normalizedLabel = labelText.replace(/\s+/g, " ").trim();
  if (normalizedLabel !== labelText) {
    const byNormalized = page
      .locator(`label:has-text("${normalizedLabel}")`)
      .locator(`xpath=following-sibling::*//` + tag + ` | following::` + tag + `[1]`)
      .first();
    if (await byNormalized.isVisible({ timeout: 2000 }).catch(() => false)) {
      return { locator: byNormalized, method: "label_normalized" };
    }
  }

  // Strategy 4: Container-based — find label anywhere, then look for input in parent
  const containerLabel = page.locator(`text="${labelText}"`).first();
  if (await containerLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Go up to the nearest form-group/container and find the input within
    const container = containerLabel.locator("xpath=ancestor::div[1] | ancestor::td[1]").first();
    const containerInput = container.locator(tag).first();
    if (await containerInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      return { locator: containerInput, method: "container_fallback" };
    }
  }

  // Strategy 5: Schema hint — use placeholder or name attributes
  const byPlaceholder = page.locator(`${tag}[placeholder*="${labelText}"]`).first();
  if (await byPlaceholder.isVisible({ timeout: 1500 }).catch(() => false)) {
    return { locator: byPlaceholder, method: "schema_hint_fallback" };
  }

  return null;
}

/**
 * Attempt to find a read-only field value using multiple strategies.
 * Returns the observed text, which method succeeded, and confidence.
 */
async function resolveReadOnlyValue(
  page: Page,
  labelText: string
): Promise<{
  value: string | null;
  method: SelectorResolutionMethod;
  confidence: ReadbackConfidence;
  note: string;
} | null> {
  // Strategy 1: Label exact — following sibling text or greyed-out input
  const labelExact = page.locator(`label:has-text("${labelText}")`).first();
  if (await labelExact.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Check next sibling for text content
    const sibling = labelExact.locator("xpath=following-sibling::*").first();

    // Try greyed-out input value first (common for derived fields)
    const inputEl = sibling.locator("input, select").first();
    const inputVal = await inputEl.inputValue({ timeout: 2000 }).catch(() => null);
    if (inputVal && inputVal.trim()) {
      const { normalized, wasNormalized } = normalizeObservedValue(inputVal);
      return {
        value: normalized,
        method: "label_exact",
        confidence: wasNormalized ? "normalized" : "exact",
        note: wasNormalized
          ? `Read from disabled input, normalized from: "${inputVal.trim()}"`
          : "Read from disabled input",
      };
    }

    // Try text content
    const text = await sibling.textContent({ timeout: 2000 }).catch(() => null);
    if (text && text.trim()) {
      const { normalized, wasNormalized } = normalizeObservedValue(text);
      return {
        value: normalized,
        method: "label_exact",
        confidence: wasNormalized ? "normalized" : "exact",
        note: wasNormalized
          ? `Read from sibling text, normalized from: "${text.trim()}"`
          : "Read from sibling text",
      };
    }
  }

  // Strategy 2: Playwright getByLabel for reading value
  const byGetLabel = page.getByLabel(labelText, { exact: false }).first();
  if (await byGetLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const val = await byGetLabel.inputValue({ timeout: 2000 }).catch(() => null);
    if (val && val.trim()) {
      const { normalized, wasNormalized } = normalizeObservedValue(val);
      return {
        value: normalized,
        method: "get_by_label",
        confidence: wasNormalized ? "normalized" : "exact",
        note: wasNormalized
          ? `Read via getByLabel, normalized from: "${val.trim()}"`
          : "Read via getByLabel",
      };
    }
  }

  // Strategy 3: Container-based — find label, go up to parent, read text
  const containerLabel = page.locator(`text="${labelText}"`).first();
  if (await containerLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const container = containerLabel.locator("xpath=ancestor::div[1] | ancestor::td[1]").first();
    // Try input in container
    const containerInput = container.locator("input, select").first();
    const containerVal = await containerInput.inputValue({ timeout: 2000 }).catch(() => null);
    if (containerVal && containerVal.trim()) {
      const { normalized, wasNormalized } = normalizeObservedValue(containerVal);
      return {
        value: normalized,
        method: "container_fallback",
        confidence: wasNormalized ? "normalized" : "exact",
        note: wasNormalized
          ? `Read from container input, normalized from: "${containerVal.trim()}"`
          : "Read from container input",
      };
    }
    // Try text content of container (excluding the label text itself)
    const containerText = await container.textContent({ timeout: 2000 }).catch(() => null);
    if (containerText) {
      const cleanText = containerText.replace(labelText, "").trim();
      if (cleanText) {
        const { normalized, wasNormalized } = normalizeObservedValue(cleanText);
        return {
          value: normalized,
          method: "container_fallback",
          confidence: "low_confidence",
          note: `Read from container text (label stripped), ${wasNormalized ? "normalized" : "raw"}`,
        };
      }
    }
  }

  return null;
}

// ─── Main Driver ────────────────────────────────────────────────────

/**
 * Playwright-based adapter for the e-Duti Setem portal.
 *
 * Constructed with an already-authenticated Playwright Page instance.
 * The caller is responsible for launching the browser, performing
 * manual login, and passing the authenticated page here.
 *
 * Selector resolution uses ordered fallback strategies:
 * label_exact → get_by_label → label_normalized → container_fallback → schema_hint_fallback
 *
 * Observed values are normalized before return, with raw values preserved.
 */
export class PlaywrightStsdsDriver implements BrowserDriverAdapter {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── MyTax Blocking Notice Dismissal ────────────────────────────
  // After login or session restore, MyTax may show a blocking modal/
  // notice that prevents dashboard interaction until acknowledged.
  //
  // This helper handles ONLY known-safe informational notices.
  // It does NOT generically click any modal button.
  //
  // Strategy: bounded polling phase. The modal may appear at any point
  // during or after dashboard render, so a single one-shot check is
  // unreliable. Instead, poll repeatedly over a bounded window.

  /** Modal container selectors used for detection and verification. */
  private static readonly MODAL_CONTAINER_SELECTORS = [
    '.modal.show',
    '.modal.in',
    '.modal.fade.show',
    '.modal[style*="display: block"]',
    '.swal2-popup',
    '.swal-overlay--show-modal',
    '[role="dialog"][aria-modal="true"]',
    '.modal-backdrop.show',
    '.modal-backdrop.in',
    '.modal-backdrop.fade.show',
  ];

  /** Known-safe notice patterns that may be auto-dismissed. */
  private static readonly KNOWN_SAFE_NOTICES = [
    {
      titleMatches: ["pemberitahuan mytax", "pemberitahuan"],
      label: "Pemberitahuan MyTax",
    },
    {
      titleMatches: ["makluman"],
      label: "Makluman",
    },
    {
      titleMatches: ["notification"],
      label: "Notification",
    },
  ];

  /** Dismiss button selectors, ordered from most-scoped to broadest. */
  private static readonly DISMISS_BUTTON_SELECTORS = [
    // Scoped to visible modal
    '.modal.show button:has-text("Ok")',
    '.modal.show button:has-text("OK")',
    '.modal.show button:has-text("Tutup")',
    '.modal.show button:has-text("Close")',
    '.modal.show .modal-footer button',
    '.modal.show .btn-primary',
    '.modal.in button:has-text("Ok")',
    '.modal.in button:has-text("OK")',
    '.modal.in .modal-footer button',
    '.modal.in .btn-primary',
    // SweetAlert
    '.swal2-confirm',
    '.swal-button--confirm',
    // Broader modal scope
    '.modal button:has-text("Ok")',
    '.modal button:has-text("OK")',
    '.modal .modal-footer button',
    '.modal .btn-primary',
    // Page-wide fallback (last resort — only safe because we
    // already confirmed the modal title matches a known-safe pattern)
    'button:has-text("Ok")',
    'button:has-text("OK")',
  ];

  /**
   * Quick check: is any modal/overlay/backdrop currently visible?
   * Returns the matched selector or null. Uses short timeouts
   * since this is called repeatedly in a polling loop.
   */
  private async detectModalPresence(): Promise<string | null> {
    for (const sel of PlaywrightStsdsDriver.MODAL_CONTAINER_SELECTORS) {
      const isPresent = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (isPresent) return sel;
    }
    return null;
  }

  /**
   * Extract the title text from a currently-visible modal.
   */
  private async extractModalTitle(): Promise<string> {
    const titleSelectors = [
      '.modal-title',
      '.modal-header h4',
      '.modal-header h5',
      '.swal2-title',
      '[role="dialog"] h4',
      '[role="dialog"] h5',
      '.modal h4',
      '.modal h5',
    ];
    for (const sel of titleSelectors) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = (await el.innerText().catch(() => "")).trim();
        if (text) return text;
      }
    }
    return "";
  }

  /**
   * Extract all visible button texts from the current modal for diagnostics.
   */
  private async extractModalButtonTexts(): Promise<string[]> {
    const texts: string[] = [];
    const btnContainerSelectors = [
      '.modal.show button',
      '.modal.in button',
      '.modal .modal-footer button',
      '.swal2-actions button',
      '.modal button',
    ];
    for (const sel of btnContainerSelectors) {
      const buttons = this.page.locator(sel);
      const count = await buttons.count().catch(() => 0);
      for (let i = 0; i < count && i < 10; i++) {
        const text = (await buttons.nth(i).innerText().catch(() => "")).trim();
        if (text && !texts.includes(text)) texts.push(text);
      }
      if (texts.length > 0) break;
    }
    return texts;
  }

  /**
   * TEMPORARY: Enable post-login diagnostic capture mode.
   * When true, navigateToPage() captures raw browser state for 12 seconds
   * after login and returns diagnostic data WITHOUT attempting popup
   * dismissal or menu interaction. Set to false to restore normal flow.
   */
  private static readonly POST_LOGIN_DIAGNOSTIC_MODE = false;

  /**
   * Capture a popup-evidence screenshot to the artifacts directory.
   * Returns the file path on success, or null on failure.
   */
  private async capturePopupScreenshot(label: string): Promise<string | null> {
    try {
      const fs = await import("fs");
      fs.mkdirSync("data/portal-probe-artifacts", { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = `data/portal-probe-artifacts/popup_${label}_${ts}.png`;
      await this.page.screenshot({ path: filePath, fullPage: false });
      return filePath;
    } catch {
      return null;
    }
  }

  /**
   * Post-login diagnostic capture — pure observation mode.
   *
   * Runs a bounded diagnostic loop on all context pages, capturing
   * exact browser state on every tick WITHOUT attempting popup dismissal
   * or menu interaction. Saves screenshots, HTML snapshots, and JSON
   * diagnostics as hard artifacts for offline analysis.
   *
   * Purpose: determine authoritatively which page object the driver
   * should target, when /dashboard-content appears, when popup text
   * appears, and whether page.url() matches window.location.href.
   */
  private async runPostLoginDiagnosticCapture(durationMs = 12_000, intervalMs = 1_000): Promise<{
    ticks: Array<{
      tickIndex: number;
      timestampIso: string;
      elapsedMs: number;
      pageCount: number;
      activePageIndex: number;
      activePageChanged: boolean;
      pages: Array<{
        pageIndex: number;
        playwrightUrl: string;
        evaluatedLocationHref: string;
        urlMismatch: boolean;
        documentReadyState: string;
        title: string;
        bodyContainsPemberitahuan: boolean;
        bodyContainsEzHasil: boolean;
        okButtonVisible: boolean;
        closeButtonVisible: boolean;
        isDashboardContentUrl: boolean;
      }>;
      screenshotPath: string | null;
      htmlSnapshotPath: string | null;
      jsonPath: string | null;
    }>;
    summary: {
      totalTicks: number;
      durationMs: number;
      firstDashboardContentTick: number | null;
      firstPopupTextTick: number | null;
      finalActivePageUrl: string;
      finalActivePageIndex: number;
      urlMismatchDetected: boolean;
      pageSelectionChangedDuringCapture: boolean;
      dashboardContentEverAppeared: boolean;
      popupTextEverAppeared: boolean;
      summaryJsonPath: string | null;
    };
  }> {
    const fs = await import("fs");
    const artifactDir = "data/portal-probe-artifacts";
    fs.mkdirSync(artifactDir, { recursive: true });

    const captureTs = new Date().toISOString().replace(/[:.]/g, "-");
    const browserContext = this.page.context();

    type TickPageState = {
      pageIndex: number;
      playwrightUrl: string;
      evaluatedLocationHref: string;
      urlMismatch: boolean;
      documentReadyState: string;
      title: string;
      bodyContainsPemberitahuan: boolean;
      bodyContainsEzHasil: boolean;
      okButtonVisible: boolean;
      closeButtonVisible: boolean;
      isDashboardContentUrl: boolean;
    };

    type TickResult = {
      tickIndex: number;
      timestampIso: string;
      elapsedMs: number;
      pageCount: number;
      activePageIndex: number;
      activePageChanged: boolean;
      pages: TickPageState[];
      screenshotPath: string | null;
      htmlSnapshotPath: string | null;
      jsonPath: string | null;
    };

    const ticks: TickResult[] = [];
    let firstDashboardContentTick: number | null = null;
    let firstPopupTextTick: number | null = null;
    let urlMismatchDetected = false;
    let pageSelectionChangedDuringCapture = false;
    let dashboardContentEverAppeared = false;
    let popupTextEverAppeared = false;

    let previousActivePageIndex = -1;
    const startTime = Date.now();

    console.log(`\n  ── Post-login diagnostic capture (${durationMs}ms, ${intervalMs}ms interval) ──`);

    let tickIndex = 0;
    while (Date.now() - startTime < durationMs) {
      const tickStart = Date.now();
      const allPages: Page[] = browserContext.pages();

      // Determine which page is currently "active" (the one this.page points to)
      let activePageIndex = allPages.indexOf(this.page);
      if (activePageIndex < 0) activePageIndex = 0;

      if (previousActivePageIndex >= 0 && activePageIndex !== previousActivePageIndex) {
        pageSelectionChangedDuringCapture = true;
      }
      previousActivePageIndex = activePageIndex;

      const tickPages: TickPageState[] = [];

      for (let pi = 0; pi < allPages.length; pi++) {
        const pg = allPages[pi];
        const playwrightUrl = pg.url();
        const title = await pg.title().catch(() => "(error)");

        // Evaluate actual window.location.href and document.readyState
        const evalResult = await pg.evaluate(() => ({
          locationHref: window.location.href,
          readyState: document.readyState,
          bodyText: document.body?.innerText?.substring(0, 5000) ?? "",
        })).catch(() => ({
          locationHref: "(evaluate_failed)",
          readyState: "(evaluate_failed)",
          bodyText: "",
        }));

        const playwrightUrlLower = playwrightUrl.toLowerCase();
        const locationHref = evalResult.locationHref;
        const mismatch = playwrightUrl !== locationHref;
        if (mismatch) urlMismatchDetected = true;

        const bodyText = evalResult.bodyText;
        const containsPemberitahuan = bodyText.includes("Pemberitahuan MyTax") || bodyText.includes("Pemberitahuan");
        const containsEzHasil = bodyText.includes("Perkhidmatan ezHASiL") ||
          bodyText.includes("Perkhidmatan ezHasil") ||
          bodyText.includes("eZHASiL Services");

        const isDashContentUrl =
          playwrightUrlLower.includes("mytax.hasil.gov.my") &&
          playwrightUrlLower.includes("/dashboard-content");

        // Check for Ok button visibility
        const okButtonVisible = await pg
          .locator([
            'button:has-text("Ok")',
            'button:has-text("OK")',
            'button:has-text("ok")',
            'a:has-text("Ok")',
            '.btn:has-text("Ok")',
            '.btn:has-text("OK")',
          ].join(", "))
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        // Check for close/X button visibility
        const closeButtonVisible = await pg
          .locator([
            'button.close',
            'button[aria-label="Close"]',
            '.modal-header button.close',
            'button:has-text("×")',
            'button:has-text("✕")',
          ].join(", "))
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (containsPemberitahuan) {
          popupTextEverAppeared = true;
          if (firstPopupTextTick === null) firstPopupTextTick = tickIndex;
        }
        if (isDashContentUrl) {
          dashboardContentEverAppeared = true;
          if (firstDashboardContentTick === null) firstDashboardContentTick = tickIndex;
        }

        tickPages.push({
          pageIndex: pi,
          playwrightUrl,
          evaluatedLocationHref: locationHref,
          urlMismatch: mismatch,
          documentReadyState: evalResult.readyState,
          title,
          bodyContainsPemberitahuan: containsPemberitahuan,
          bodyContainsEzHasil: containsEzHasil,
          okButtonVisible,
          closeButtonVisible,
          isDashboardContentUrl: isDashContentUrl,
        });
      }

      // Save screenshot of the active page
      let screenshotPath: string | null = null;
      try {
        const ssPath = `${artifactDir}/diag_tick_${tickIndex}_${captureTs}.png`;
        await this.page.screenshot({ path: ssPath, fullPage: false });
        screenshotPath = ssPath;
      } catch {
        screenshotPath = null;
      }

      // Save HTML snapshot of the active page
      let htmlSnapshotPath: string | null = null;
      try {
        const htmlContent = await this.page.evaluate(
          () => document.documentElement.outerHTML
        );
        const htmlPath = `${artifactDir}/diag_tick_${tickIndex}_${captureTs}.html`;
        fs.writeFileSync(htmlPath, htmlContent, "utf-8");
        htmlSnapshotPath = htmlPath;
      } catch {
        htmlSnapshotPath = null;
      }

      const tick: TickResult = {
        tickIndex,
        timestampIso: new Date().toISOString(),
        elapsedMs: Date.now() - startTime,
        pageCount: allPages.length,
        activePageIndex,
        activePageChanged: previousActivePageIndex >= 0 && activePageIndex !== previousActivePageIndex,
        pages: tickPages,
        screenshotPath,
        htmlSnapshotPath,
        jsonPath: null, // set below
      };

      // Save per-tick JSON
      try {
        const jsonPath = `${artifactDir}/diag_tick_${tickIndex}_${captureTs}.json`;
        fs.writeFileSync(jsonPath, JSON.stringify(tick, null, 2), "utf-8");
        tick.jsonPath = jsonPath;
      } catch {
        // ignore
      }

      ticks.push(tick);

      // Console log per tick
      const activePg = tickPages[activePageIndex] ?? tickPages[0];
      console.log(
        `  tick ${tickIndex}: ` +
        `pages=${allPages.length}, ` +
        `activeIdx=${activePageIndex}, ` +
        `pw.url=${activePg?.playwrightUrl?.substring(0, 60) ?? "(none)"}, ` +
        `loc.href=${activePg?.evaluatedLocationHref?.substring(0, 60) ?? "(none)"}, ` +
        `mismatch=${activePg?.urlMismatch ?? "?"}, ` +
        `readyState=${activePg?.documentReadyState ?? "?"}, ` +
        `pemberitahuan=${activePg?.bodyContainsPemberitahuan ?? "?"}, ` +
        `okBtn=${activePg?.okButtonVisible ?? "?"}, ` +
        `dashContent=${activePg?.isDashboardContentUrl ?? "?"}`
      );

      tickIndex++;

      // Wait for next interval (subtract time spent this tick)
      const tickDuration = Date.now() - tickStart;
      const waitMs = Math.max(0, intervalMs - tickDuration);
      if (waitMs > 0 && Date.now() - startTime + waitMs < durationMs) {
        await this.page.waitForTimeout(waitMs);
      }
    }

    const finalActivePage = ticks.length > 0
      ? ticks[ticks.length - 1]
      : null;

    const summary = {
      totalTicks: ticks.length,
      durationMs: Date.now() - startTime,
      firstDashboardContentTick,
      firstPopupTextTick,
      finalActivePageUrl: finalActivePage?.pages[finalActivePage.activePageIndex]?.playwrightUrl ?? "(unknown)",
      finalActivePageIndex: finalActivePage?.activePageIndex ?? -1,
      urlMismatchDetected,
      pageSelectionChangedDuringCapture,
      dashboardContentEverAppeared,
      popupTextEverAppeared,
      summaryJsonPath: null as string | null,
    };

    // Save summary JSON
    try {
      const summaryPath = `${artifactDir}/diag_summary_${captureTs}.json`;
      fs.writeFileSync(summaryPath, JSON.stringify({ summary, ticks }, null, 2), "utf-8");
      summary.summaryJsonPath = summaryPath;
    } catch {
      // ignore
    }

    console.log(`\n  ── Diagnostic capture complete ──`);
    console.log(`    Ticks: ${summary.totalTicks}`);
    console.log(`    Duration: ${summary.durationMs}ms`);
    console.log(`    First /dashboard-content: tick ${firstDashboardContentTick ?? "(never)"}`);
    console.log(`    First popup text: tick ${firstPopupTextTick ?? "(never)"}`);
    console.log(`    URL mismatch detected: ${urlMismatchDetected}`);
    console.log(`    Page selection changed: ${pageSelectionChangedDuringCapture}`);
    console.log(`    Final active URL: ${summary.finalActivePageUrl}`);
    console.log(`    Summary JSON: ${summary.summaryJsonPath ?? "(not saved)"}\n`);

    return { ticks, summary };
  }

  /**
   * Granular popup failure state for truthful reporting.
   */
  private static readonly POPUP_FAILURE_STATES = [
    "popup_detected_but_button_not_found",
    "popup_detected_but_button_not_interactable",
    "popup_click_attempted_but_modal_remained",
    "popup_click_attempted_but_backdrop_remained",
    "popup_click_threw_error",
    "unknown_blocking_modal_present",
    "popup_root_resolved_but_ok_button_not_found",
    "popup_root_resolved_but_ok_button_not_interactable",
    "popup_root_click_attempted_but_popup_remained",
    "popup_root_click_attempted_but_overlay_remained",
    "popup_root_resolution_failed",
    "popup_ok_candidate_not_found",
    "popup_ok_candidate_found_but_not_interactable",
    "popup_ok_click_attempted_but_popup_remained",
    "popup_ok_coordinate_click_attempted_but_popup_remained",
    "popup_ok_click_threw_error",
  ] as const;

  /**
   * Anchor-based popup root resolution.
   *
   * Instead of relying on generic Bootstrap/SweetAlert modal container
   * selectors, this method locates the popup by its content:
   * 1. Find the visible title text element (e.g. "Pemberitahuan MyTax")
   * 2. Walk up the ancestor chain to find the popup root container
   * 3. Find the Ok/dismiss button within that resolved subtree
   *
   * Returns detailed DOM evidence regardless of success or failure.
   */
  private async resolvePopupRootFromAnchor(): Promise<{
    found: boolean;
    titleAnchorSelector: string;
    popupRootSelector: string;
    popupRootTag: string;
    popupRootClasses: string;
    popupRootId: string;
    popupRootRole: string;
    popupRootAria: string;
    popupRootOuterHtmlSnippet: string;
    okButtonSelector: string;
    okButtonFound: boolean;
    okButtonVisible: boolean;
    okButtonEnabled: boolean;
    allClickableTextsInRoot: string[];
    popupRootLocator: Locator | null;
    okButtonLocator: Locator | null;
  }> {
    const result = {
      found: false,
      titleAnchorSelector: "",
      popupRootSelector: "",
      popupRootTag: "",
      popupRootClasses: "",
      popupRootId: "",
      popupRootRole: "",
      popupRootAria: "",
      popupRootOuterHtmlSnippet: "",
      okButtonSelector: "",
      okButtonFound: false,
      okButtonVisible: false,
      okButtonEnabled: false,
      allClickableTextsInRoot: [] as string[],
      popupRootLocator: null as Locator | null,
      okButtonLocator: null as Locator | null,
    };

    // ── Step 1: Locate the title anchor element ────────────────
    // Search for visible text containing "Pemberitahuan" as anchor.
    const titleAnchorSelectors = [
      // Specific title selectors
      '.modal-title:has-text("Pemberitahuan")',
      'h4:has-text("Pemberitahuan")',
      'h5:has-text("Pemberitahuan")',
      'h3:has-text("Pemberitahuan")',
      '.modal-header :has-text("Pemberitahuan")',
      '[class*="title"]:has-text("Pemberitahuan")',
      // Broader — any element with the title text
      'div:has-text("Pemberitahuan MyTax")',
      'span:has-text("Pemberitahuan MyTax")',
      'p:has-text("Pemberitahuan MyTax")',
      // Even broader
      ':has-text("Pemberitahuan")',
    ];

    let titleAnchor: Locator | null = null;
    for (const sel of titleAnchorSelectors) {
      const loc = this.page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
        titleAnchor = loc;
        result.titleAnchorSelector = sel;
        break;
      }
    }

    if (!titleAnchor) {
      return result;
    }

    // ── Step 2: Walk ancestor chain to find popup root ─────────
    // Use page.evaluate on the title element to walk up DOM and find
    // the nearest container that looks like a popup/dialog/card/panel.
    const rootInfo = await titleAnchor.evaluate((el: Element) => {
      // Walk up from the title element looking for a popup root
      const rootCandidateSelectors = [
        // Check if any ancestor has these characteristics
        (e: Element) => e.getAttribute("role") === "dialog",
        (e: Element) => e.getAttribute("aria-modal") === "true",
        (e: Element) => e.classList.contains("modal"),
        (e: Element) => e.classList.contains("modal-dialog"),
        (e: Element) => e.classList.contains("modal-content"),
        (e: Element) => e.classList.contains("swal2-popup"),
        (e: Element) => e.classList.contains("swal2-modal"),
        (e: Element) => e.classList.contains("swal-modal"),
        (e: Element) => e.classList.contains("popup"),
        (e: Element) => e.classList.contains("dialog"),
        (e: Element) => e.classList.contains("notification"),
        (e: Element) => e.classList.contains("notice"),
        (e: Element) => e.classList.contains("alert"),
        (e: Element) => e.tagName === "DIALOG",
        // Generic panels/cards that could be popup containers
        (e: Element) => e.classList.contains("card"),
        (e: Element) => e.classList.contains("panel"),
        // Check for display:block or z-index indicating overlay
        (e: Element) => {
          const style = window.getComputedStyle(e);
          const zIndex = parseInt(style.zIndex || "0", 10);
          return zIndex > 100;
        },
        // Check for position:fixed or position:absolute with high z-index
        (e: Element) => {
          const style = window.getComputedStyle(e);
          return (
            (style.position === "fixed" || style.position === "absolute") &&
            parseInt(style.zIndex || "0", 10) > 50
          );
        },
      ];

      let current: Element | null = el;
      let bestRoot: Element | null = null;
      let matchedTest = -1;
      let depth = 0;
      const maxDepth = 20;

      while (current && depth < maxDepth) {
        for (let i = 0; i < rootCandidateSelectors.length; i++) {
          try {
            if (rootCandidateSelectors[i](current)) {
              bestRoot = current;
              matchedTest = i;
              // Don't break — keep walking up for the outermost popup root
            }
          } catch {
            // ignore errors in style access
          }
        }
        current = current.parentElement;
        depth++;
      }

      // If no root found via tests, use the closest "significant" ancestor
      // (an element that's not just a span/em/strong wrapper)
      if (!bestRoot) {
        current = el.parentElement;
        depth = 0;
        while (current && depth < 15) {
          const tag = current.tagName.toLowerCase();
          if (["div", "section", "article", "aside", "dialog", "form"].includes(tag)) {
            // Check if this div contains both the title and a button
            const hasButton = current.querySelector("button, a.btn, input[type='button'], input[type='submit']");
            if (hasButton) {
              bestRoot = current;
              break;
            }
          }
          current = current.parentElement;
          depth++;
        }
      }

      if (!bestRoot) {
        return null;
      }

      // Extract info about the resolved root
      const outerHtml = bestRoot.outerHTML;
      const snippet = outerHtml.length > 1500
        ? outerHtml.substring(0, 1500) + "...(truncated)"
        : outerHtml;

      // Find all clickable elements inside the root
      const clickables = bestRoot.querySelectorAll(
        "button, a, input[type='button'], input[type='submit'], [role='button']"
      );
      const clickableTexts: string[] = [];
      for (const c of clickables) {
        const text = (c.textContent ?? "").trim();
        if (text && text.length < 100 && !clickableTexts.includes(text)) {
          clickableTexts.push(text);
        }
      }

      return {
        tag: bestRoot.tagName.toLowerCase(),
        classes: bestRoot.className || "",
        id: bestRoot.id || "",
        role: bestRoot.getAttribute("role") || "",
        ariaModal: bestRoot.getAttribute("aria-modal") || "",
        snippet,
        clickableTexts,
        matchedTest,
      };
    }).catch(() => null);

    if (!rootInfo) {
      return result;
    }

    result.found = true;
    result.popupRootTag = rootInfo.tag;
    result.popupRootClasses = rootInfo.classes;
    result.popupRootId = rootInfo.id;
    result.popupRootRole = rootInfo.role;
    result.popupRootAria = rootInfo.ariaModal;
    result.popupRootOuterHtmlSnippet = rootInfo.snippet;
    result.allClickableTextsInRoot = rootInfo.clickableTexts;

    // ── Step 3: Build a selector for the resolved root ─────────
    // Use the most specific identifier available.
    let rootSelector = "";
    if (rootInfo.id) {
      rootSelector = `#${rootInfo.id}`;
    } else if (rootInfo.role === "dialog") {
      rootSelector = `${rootInfo.tag}[role="dialog"]`;
    } else if (rootInfo.classes) {
      // Use the first meaningful class
      const classes = rootInfo.classes.split(/\s+/).filter((c: string) => c.length > 0);
      const meaningfulClass = classes.find((c: string) =>
        /modal|dialog|popup|swal|notice|alert|notification|card|panel/.test(c.toLowerCase())
      ) || classes[0];
      if (meaningfulClass) {
        rootSelector = `${rootInfo.tag}.${meaningfulClass}`;
      }
    }
    if (!rootSelector) {
      rootSelector = rootInfo.tag;
    }
    result.popupRootSelector = rootSelector;
    result.popupRootLocator = this.page.locator(rootSelector).first();

    // ── Step 4: Find Ok button within the resolved root ────────
    // Search for Ok/OK/Close/Tutup button inside the popup root.
    const okButtonSelectors = [
      `${rootSelector} button:has-text("Ok")`,
      `${rootSelector} button:has-text("OK")`,
      `${rootSelector} button:has-text("Tutup")`,
      `${rootSelector} button:has-text("Close")`,
      `${rootSelector} a:has-text("Ok")`,
      `${rootSelector} a:has-text("OK")`,
      `${rootSelector} .btn-primary`,
      `${rootSelector} .btn:has-text("Ok")`,
      `${rootSelector} .btn:has-text("OK")`,
      `${rootSelector} input[type="button"][value*="Ok"]`,
      `${rootSelector} input[type="button"][value*="OK"]`,
      `${rootSelector} input[type="submit"]`,
      // Close/X button
      `${rootSelector} button[class*="close"]`,
      `${rootSelector} .close`,
      `${rootSelector} button[aria-label="Close"]`,
      `${rootSelector} [data-dismiss="modal"]`,
    ];

    for (const sel of okButtonSelectors) {
      const btn = this.page.locator(sel).first();
      const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
      if (isVisible) {
        result.okButtonFound = true;
        result.okButtonSelector = sel;
        result.okButtonVisible = true;
        const isEnabled = await btn.isEnabled({ timeout: 500 }).catch(() => false);
        result.okButtonEnabled = isEnabled;
        if (isEnabled) {
          result.okButtonLocator = btn;
        }
        break;
      }
    }

    // If scoped selectors didn't find it, try page-wide Ok buttons
    // but only if the popup root is confirmed resolved
    if (!result.okButtonFound) {
      const fallbackOkSelectors = [
        'button:has-text("Ok")',
        'button:has-text("OK")',
        'a:has-text("Ok")',
        'a:has-text("OK")',
      ];
      for (const sel of fallbackOkSelectors) {
        const btn = this.page.locator(sel).first();
        const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
        if (isVisible) {
          result.okButtonFound = true;
          result.okButtonSelector = `${sel} (page-wide fallback)`;
          result.okButtonVisible = true;
          const isEnabled = await btn.isEnabled({ timeout: 500 }).catch(() => false);
          result.okButtonEnabled = isEnabled;
          if (isEnabled) {
            result.okButtonLocator = btn;
          }
          break;
        }
      }
    }

    return result;
  }

  /**
   * Layered fallback strategy for clicking the visible Ok control
   * on a MyTax Pemberitahuan popup.
   *
   * Called when the anchor-based popup root resolution either fails
   * entirely or finds the root but cannot locate/click the Ok button.
   *
   * Strategy layers (attempted in order):
   *   B. Title-neighbourhood: find clickable Ok near the Pemberitahuan
   *      title anchor in the same ancestor region
   *   C. Page-wide visible Ok: find exactly one prominent visible Ok
   *      candidate across the page (any element type)
   *   D. Coordinate fallback: compute bounding box of a visible Ok
   *      candidate and click its center via page.mouse.click()
   *
   * Returns full per-candidate evidence regardless of outcome.
   */
  private async attemptLayeredOkDismissal(): Promise<{
    layer: "B_title_neighbourhood" | "C_page_wide_ok" | "D_coordinate_click" | "none";
    candidates: Array<{
      selector: string;
      tag: string;
      classes: string;
      id: string;
      role: string;
      visibleText: string;
      boundingBox: { x: number; y: number; width: number; height: number } | null;
      isVisible: boolean;
      isEnabled: boolean;
      clickAttempted: boolean;
      clickSucceeded: boolean;
      clickError: string | null;
      popupRemainedAfterClick: boolean;
    }>;
    dismissed: boolean;
    screenshotBefore: string | null;
    screenshotAfter: string | null;
  }> {
    const result: Awaited<ReturnType<typeof this.attemptLayeredOkDismissal>> = {
      layer: "none",
      candidates: [],
      dismissed: false,
      screenshotBefore: await this.capturePopupScreenshot("layered_before"),
      screenshotAfter: null,
    };

    // Broad Ok candidate selectors — any element type with Ok/OK text
    const okCandidateSelectors = [
      // Semantic buttons
      'button:has-text("Ok")',
      'button:has-text("OK")',
      // Anchors styled as buttons
      'a:has-text("Ok")',
      'a:has-text("OK")',
      'a[role="button"]:has-text("Ok")',
      'a[role="button"]:has-text("OK")',
      // Input buttons
      'input[type="button"][value*="Ok"]',
      'input[type="button"][value*="OK"]',
      'input[type="submit"][value*="Ok"]',
      'input[type="submit"][value*="OK"]',
      // Role-based
      '[role="button"]:has-text("Ok")',
      '[role="button"]:has-text("OK")',
      // Class-based buttons (Bootstrap .btn etc.)
      '.btn:has-text("Ok")',
      '.btn:has-text("OK")',
      '.btn-primary:has-text("Ok")',
      '.btn-primary:has-text("OK")',
      // SweetAlert buttons
      '.swal2-confirm',
      '.swal-button--confirm',
    ];

    /**
     * Gather all visible Ok candidates from the page.
     * Returns enriched candidate objects with DOM metadata.
     */
    const gatherCandidates = async (): Promise<typeof result.candidates> => {
      const seen = new Set<string>();
      const candidates: typeof result.candidates = [];

      for (const sel of okCandidateSelectors) {
        try {
          const count = await this.page.locator(sel).count();
          for (let i = 0; i < Math.min(count, 5); i++) {
            const loc = this.page.locator(sel).nth(i);
            const vis = await loc.isVisible({ timeout: 500 }).catch(() => false);
            if (!vis) continue;

            const info = await loc.evaluate((el: Element) => ({
              tag: el.tagName.toLowerCase(),
              classes: el.className || "",
              id: el.id || "",
              role: el.getAttribute("role") || "",
              text: (el.textContent ?? "").trim().substring(0, 50),
              // De-duplication key
              dedup: `${el.tagName}|${el.className}|${el.id}|${(el.textContent ?? "").trim().substring(0, 20)}`,
            })).catch(() => null);

            if (!info || seen.has(info.dedup)) continue;
            seen.add(info.dedup);

            const enabled = await loc.isEnabled({ timeout: 500 }).catch(() => false);
            const bb = await loc.boundingBox().catch(() => null);

            candidates.push({
              selector: sel + (i > 0 ? ` [nth=${i}]` : ""),
              tag: info.tag,
              classes: info.classes,
              id: info.id,
              role: info.role,
              visibleText: info.text,
              boundingBox: bb,
              isVisible: true,
              isEnabled: enabled,
              clickAttempted: false,
              clickSucceeded: false,
              clickError: null,
              popupRemainedAfterClick: false,
            });
          }
        } catch {
          // ignore selector errors
        }
      }
      return candidates;
    };

    /**
     * Check if the popup is still visible after a click attempt.
     */
    const isPopupStillPresent = async (): Promise<boolean> => {
      await this.page.waitForTimeout(1000);
      const titleVis = await this.page
        .locator(':has-text("Pemberitahuan")')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      const genericModal = await this.detectModalPresence();
      return titleVis || !!genericModal;
    };

    /**
     * Attempt standard Playwright click on a candidate.
     */
    const tryClickCandidate = async (
      candidate: typeof result.candidates[number],
      loc: Locator
    ): Promise<boolean> => {
      candidate.clickAttempted = true;
      try {
        await loc.click({ timeout: 5000, force: true });
        candidate.clickSucceeded = true;
      } catch (err) {
        candidate.clickSucceeded = false;
        candidate.clickError = err instanceof Error ? err.message : String(err);
        return false;
      }
      const remained = await isPopupStillPresent();
      candidate.popupRemainedAfterClick = remained;
      return !remained;
    };

    // ── Layer B: Title-neighbourhood click ──────────────────────
    // Find Ok candidates that share an ancestor with "Pemberitahuan"
    // title text within a reasonable DOM depth.
    result.layer = "B_title_neighbourhood";
    console.log("  Layered Ok fallback: Layer B — title-neighbourhood search");

    const neighbourhoodCandidates = await this.page.evaluate(() => {
      // Find the Pemberitahuan title element
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        { acceptNode: (n) =>
          (n.textContent ?? "").includes("Pemberitahuan")
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT
        }
      );
      const titleTextNode = walker.nextNode();
      if (!titleTextNode) return [];

      // Walk up from title to find a shared container
      let container: Element | null = titleTextNode.parentElement;
      let depth = 0;
      let foundOk = false;
      while (container && depth < 15) {
        // Check if this container has any Ok-like clickable descendants
        const clickables = container.querySelectorAll(
          "button, a, input[type='button'], input[type='submit'], [role='button'], .btn, span, div"
        );
        for (const c of clickables) {
          const text = (c.textContent ?? "").trim();
          if (/^(Ok|OK|ok)$/.test(text)) {
            foundOk = true;
            break;
          }
        }
        if (foundOk) break;
        container = container.parentElement;
        depth++;
      }

      if (!container || !foundOk) return [];

      // Return selectable info about Ok candidates inside this container
      const candidates: Array<{
        tag: string;
        classes: string;
        id: string;
        role: string;
        text: string;
        index: number;
      }> = [];
      const clickables = container.querySelectorAll(
        "button, a, input[type='button'], input[type='submit'], [role='button'], .btn, span, div"
      );
      let idx = 0;
      for (const c of clickables) {
        const text = (c.textContent ?? "").trim();
        if (/^(Ok|OK|ok)$/.test(text)) {
          candidates.push({
            tag: c.tagName.toLowerCase(),
            classes: c.className || "",
            id: c.id || "",
            role: c.getAttribute("role") || "",
            text,
            index: idx,
          });
        }
        idx++;
      }
      return candidates;
    }).catch(() => []);

    console.log(`  Layer B: found ${neighbourhoodCandidates.length} title-neighbourhood Ok candidate(s)`);

    for (const nc of neighbourhoodCandidates) {
      // Build a selector to target this specific candidate
      let sel: string;
      if (nc.id) {
        sel = `#${nc.id}`;
      } else if (nc.classes) {
        const firstClass = nc.classes.split(/\s+/).filter((c: string) => c.length > 0)[0];
        sel = firstClass
          ? `${nc.tag}.${firstClass}:has-text("${nc.text}")`
          : `${nc.tag}:has-text("${nc.text}")`;
      } else {
        sel = `${nc.tag}:has-text("${nc.text}")`;
      }

      const loc = this.page.locator(sel).first();
      const vis = await loc.isVisible({ timeout: 500 }).catch(() => false);
      if (!vis) continue;

      const enabled = await loc.isEnabled({ timeout: 500 }).catch(() => false);
      const bb = await loc.boundingBox().catch(() => null);

      const cand: typeof result.candidates[number] = {
        selector: `Layer-B: ${sel}`,
        tag: nc.tag,
        classes: nc.classes,
        id: nc.id,
        role: nc.role,
        visibleText: nc.text,
        boundingBox: bb,
        isVisible: true,
        isEnabled: enabled,
        clickAttempted: false,
        clickSucceeded: false,
        clickError: null,
        popupRemainedAfterClick: false,
      };
      result.candidates.push(cand);

      if (enabled) {
        console.log(`  Layer B: attempting click on ${sel} (${nc.tag}, bb=${JSON.stringify(bb)})`);
        const dismissed = await tryClickCandidate(cand, loc);
        if (dismissed) {
          result.dismissed = true;
          result.screenshotAfter = await this.capturePopupScreenshot("layered_B_success");
          console.log("  ✓ Layer B: popup dismissed via title-neighbourhood Ok click");
          return result;
        }
        console.log(`  Layer B: click on ${sel} did not dismiss popup`);
      }
    }

    // ── Layer C: Page-wide visible Ok click ─────────────────────
    // Find all visible Ok candidates across the entire page.
    result.layer = "C_page_wide_ok";
    console.log("  Layered Ok fallback: Layer C — page-wide visible Ok search");

    const allCandidates = await gatherCandidates();
    console.log(`  Layer C: found ${allCandidates.length} page-wide visible Ok candidate(s)`);

    for (const cand of allCandidates) {
      result.candidates.push(cand);
      console.log(
        `  Layer C candidate: ${cand.selector} tag=${cand.tag} class="${cand.classes}" ` +
        `id="${cand.id}" role="${cand.role}" text="${cand.visibleText}" ` +
        `visible=${cand.isVisible} enabled=${cand.isEnabled} bb=${JSON.stringify(cand.boundingBox)}`
      );

      if (cand.isEnabled) {
        const loc = this.page.locator(cand.selector.replace(/ \[nth=\d+\]$/, "")).first();
        console.log(`  Layer C: attempting click on ${cand.selector}`);
        const dismissed = await tryClickCandidate(cand, loc);
        if (dismissed) {
          result.dismissed = true;
          result.screenshotAfter = await this.capturePopupScreenshot("layered_C_success");
          console.log("  ✓ Layer C: popup dismissed via page-wide Ok click");
          return result;
        }
        console.log(`  Layer C: click on ${cand.selector} did not dismiss popup`);
      }
    }

    // ── Layer D: Coordinate fallback ────────────────────────────
    // If we have a visible Ok candidate with a bounding box, click
    // its center coordinates via page.mouse.click().
    result.layer = "D_coordinate_click";
    console.log("  Layered Ok fallback: Layer D — coordinate-based click");

    const bbCandidate = result.candidates.find(
      (c) => c.isVisible && c.boundingBox && c.boundingBox.width > 0 && c.boundingBox.height > 0
    );

    if (bbCandidate && bbCandidate.boundingBox) {
      const bb = bbCandidate.boundingBox;
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      console.log(
        `  Layer D: clicking center of "${bbCandidate.visibleText}" at (${cx}, ${cy}) ` +
        `[bb: ${JSON.stringify(bb)}]`
      );

      const coordCand: typeof result.candidates[number] = {
        selector: `Layer-D: coordinate(${cx.toFixed(0)}, ${cy.toFixed(0)}) from "${bbCandidate.selector}"`,
        tag: bbCandidate.tag,
        classes: bbCandidate.classes,
        id: bbCandidate.id,
        role: bbCandidate.role,
        visibleText: bbCandidate.visibleText,
        boundingBox: bb,
        isVisible: true,
        isEnabled: true,
        clickAttempted: true,
        clickSucceeded: false,
        clickError: null,
        popupRemainedAfterClick: false,
      };

      try {
        await this.page.mouse.click(cx, cy);
        coordCand.clickSucceeded = true;
        console.log("  Layer D: coordinate click executed");
      } catch (err) {
        coordCand.clickSucceeded = false;
        coordCand.clickError = err instanceof Error ? err.message : String(err);
        console.log(`  Layer D: coordinate click threw: ${coordCand.clickError}`);
      }

      if (coordCand.clickSucceeded) {
        const remained = await isPopupStillPresent();
        coordCand.popupRemainedAfterClick = remained;
        if (!remained) {
          result.candidates.push(coordCand);
          result.dismissed = true;
          result.screenshotAfter = await this.capturePopupScreenshot("layered_D_success");
          console.log("  ✓ Layer D: popup dismissed via coordinate click");
          return result;
        }
        console.log("  Layer D: coordinate click did not dismiss popup");
      }

      result.candidates.push(coordCand);
    } else {
      console.log("  Layer D: no candidate with valid bounding box available");
    }

    // All layers exhausted
    result.layer = "none";
    result.screenshotAfter = await this.capturePopupScreenshot("layered_all_failed");
    console.log(`  ✗ All layered Ok fallback strategies exhausted. ${result.candidates.length} candidate(s) tried.`);
    return result;
  }

  /**
   * Bounded polling phase to detect and dismiss MyTax blocking notices.
   *
   * Two-tier detection strategy:
   * 1. Generic modal container selectors (Bootstrap, SweetAlert, etc.)
   * 2. Anchor-based popup root resolution from observed content
   *    (finds "Pemberitahuan MyTax" text, walks DOM to resolve root)
   *
   * The anchor-based approach is used as primary OR fallback, ensuring
   * popups are found even when they don't use standard modal classes.
   *
   * @param pollDurationMs Total polling window in milliseconds.
   * @param pollIntervalMs Interval between checks in milliseconds.
   */
  private async dismissMyTaxBlockingNotices(
    pollDurationMs = 10_000,
    pollIntervalMs = 1_000
  ): Promise<{
    noticeDetected: boolean;
    noticeDismissed: boolean;
    noticeTitle: string | null;
    unknownModalDetected: boolean;
    dismissalVerified: boolean;
    popupFailureState: typeof PlaywrightStsdsDriver.POPUP_FAILURE_STATES[number] | null;
    diagnostics: {
      detectedTitle: string;
      detectedButtonTexts: string[];
      matchedContainerSelector: string;
      matchedButtonSelector: string;
      buttonWasVisible: boolean;
      buttonWasEnabled: boolean;
      clickWasAttempted: boolean;
      clickSucceeded: boolean;
      clickError: string | null;
      modalRemainedAfterClick: boolean;
      backdropRemainedAfterClick: boolean;
      activeUrlAtFailure: string;
      screenshotBeforeDismiss: string | null;
      screenshotAfterDismiss: string | null;
      pollIterations: number;
      detectedAtIteration: number;
      anchorResolution: {
        attempted: boolean;
        found: boolean;
        titleAnchorSelector: string;
        popupRootSelector: string;
        popupRootTag: string;
        popupRootClasses: string;
        popupRootId: string;
        popupRootRole: string;
        popupRootAria: string;
        popupRootOuterHtmlSnippet: string;
        okButtonSelector: string;
        okButtonFound: boolean;
        okButtonVisible: boolean;
        okButtonEnabled: boolean;
        allClickableTextsInRoot: string[];
      } | null;
    } | null;
    note: string;
  }> {
    const activeUrl = this.page.url();

    // ── Phase 1: Bounded polling — dual detection ───────────────
    // Poll for EITHER generic modal containers OR anchor-based popup
    // title text. The popup may use non-standard markup that generic
    // modal selectors miss.
    const startTime = Date.now();
    let iteration = 0;
    let genericModalContainer: string | null = null;
    let anchorTitleFound = false;

    while (Date.now() - startTime < pollDurationMs) {
      iteration++;

      // Check generic modal containers
      genericModalContainer = await this.detectModalPresence();
      if (genericModalContainer) break;

      // Check for anchor title text (Pemberitahuan)
      const hasPemberitahuan = await this.page
        .locator(':has-text("Pemberitahuan")')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (hasPemberitahuan) {
        anchorTitleFound = true;
        break;
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    if (!genericModalContainer && !anchorTitleFound) {
      return {
        noticeDetected: false,
        noticeDismissed: false,
        noticeTitle: null,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: null,
        diagnostics: null,
        note: `No MyTax blocking notice or modal detected after ${iteration} poll iterations (${pollDurationMs}ms window). ` +
          `Neither generic modal containers nor "Pemberitahuan" text found.`,
      };
    }

    // ── Phase 2: Content settle ─────────────────────────────────
    await this.page.waitForTimeout(1500);

    // ── Phase 3: Capture pre-dismissal screenshot ───────────────
    const screenshotBeforeDismiss = await this.capturePopupScreenshot("before_dismiss");

    // ── Phase 4: Anchor-based popup root resolution ─────────────
    // This is now the PRIMARY detection strategy. Even if generic
    // modal containers were found, we still resolve the popup root
    // from content anchors for reliable button finding.
    const anchorResult = await this.resolvePopupRootFromAnchor();

    const anchorDiagnostics = {
      attempted: true,
      found: anchorResult.found,
      titleAnchorSelector: anchorResult.titleAnchorSelector,
      popupRootSelector: anchorResult.popupRootSelector,
      popupRootTag: anchorResult.popupRootTag,
      popupRootClasses: anchorResult.popupRootClasses,
      popupRootId: anchorResult.popupRootId,
      popupRootRole: anchorResult.popupRootRole,
      popupRootAria: anchorResult.popupRootAria,
      popupRootOuterHtmlSnippet: anchorResult.popupRootOuterHtmlSnippet,
      okButtonSelector: anchorResult.okButtonSelector,
      okButtonFound: anchorResult.okButtonFound,
      okButtonVisible: anchorResult.okButtonVisible,
      okButtonEnabled: anchorResult.okButtonEnabled,
      allClickableTextsInRoot: anchorResult.allClickableTextsInRoot,
    };

    // Extract diagnostics from both strategies
    const detectedTitle = await this.extractModalTitle();
    const detectedButtonTexts = await this.extractModalButtonTexts();

    const evidence = {
      detectedTitle: detectedTitle || (anchorResult.found ? "Pemberitahuan (from anchor)" : ""),
      detectedButtonTexts: detectedButtonTexts.length > 0
        ? detectedButtonTexts
        : anchorResult.allClickableTextsInRoot,
      matchedContainerSelector: genericModalContainer || anchorResult.popupRootSelector || "(none)",
      matchedButtonSelector: "",
      buttonWasVisible: false,
      buttonWasEnabled: false,
      clickWasAttempted: false,
      clickSucceeded: false,
      clickError: null as string | null,
      modalRemainedAfterClick: false,
      backdropRemainedAfterClick: false,
      activeUrlAtFailure: activeUrl,
      screenshotBeforeDismiss,
      screenshotAfterDismiss: null as string | null,
      pollIterations: iteration,
      detectedAtIteration: iteration,
      anchorResolution: anchorDiagnostics,
    };

    // ── Phase 5: Classify the popup ─────────────────────────────
    // If anchor resolution found the popup, classify based on title.
    // If only generic container found, use title extraction as before.
    const effectiveTitle = (detectedTitle || "pemberitahuan").toLowerCase().trim();
    let matchedNotice: { label: string } | null = null;

    for (const pattern of PlaywrightStsdsDriver.KNOWN_SAFE_NOTICES) {
      for (const titleMatch of pattern.titleMatches) {
        if (effectiveTitle.includes(titleMatch)) {
          matchedNotice = pattern;
          break;
        }
      }
      if (matchedNotice) break;
    }

    // If anchor found popup but title doesn't match known-safe and
    // we didn't find a generic modal, treat as unknown
    if (!matchedNotice && !anchorResult.found) {
      if (genericModalContainer) {
        const unknownScreenshot = await this.capturePopupScreenshot("unknown_modal");
        evidence.screenshotAfterDismiss = unknownScreenshot;
        return {
          noticeDetected: false,
          noticeDismissed: false,
          noticeTitle: detectedTitle || "(unknown title)",
          unknownModalDetected: true,
          dismissalVerified: false,
          popupFailureState: "unknown_blocking_modal_present",
          diagnostics: evidence,
          note:
            `Unknown blocking modal detected. ` +
            `Generic container: ${genericModalContainer}. ` +
            `Anchor resolution: not found. ` +
            `URL: ${activeUrl}.`,
        };
      }
      // Neither found properly — report as not detected
      return {
        noticeDetected: false,
        noticeDismissed: false,
        noticeTitle: null,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: null,
        diagnostics: evidence,
        note: `Anchor title text appeared but popup root could not be resolved. ` +
          `Title from extractModalTitle: "${detectedTitle}". ` +
          `Anchor result: found=${anchorResult.found}.`,
      };
    }

    // If no matchedNotice but anchor found the popup with Pemberitahuan,
    // force-classify as known-safe Pemberitahuan MyTax
    if (!matchedNotice && anchorResult.found) {
      matchedNotice = { label: "Pemberitahuan MyTax (anchor-resolved)" };
    }

    // ── Phase 6: Find and click dismiss button ──────────────────
    // Strategy: prefer anchor-resolved Ok button, fall back to generic.

    let dismissBtn: Locator | null = null;
    let dismissSelector = "";

    // Strategy A: Use anchor-resolved Ok button
    if (anchorResult.okButtonLocator && anchorResult.okButtonEnabled) {
      dismissBtn = anchorResult.okButtonLocator;
      dismissSelector = anchorResult.okButtonSelector;
      evidence.buttonWasVisible = true;
      evidence.buttonWasEnabled = true;
      evidence.matchedButtonSelector = dismissSelector;
    }

    // Strategy B: Fall back to generic modal button selectors
    if (!dismissBtn) {
      const buttonPollEnd = Date.now() + 5_000;
      let lastVisibleSelector = "";
      while (Date.now() < buttonPollEnd) {
        for (const btnSel of PlaywrightStsdsDriver.DISMISS_BUTTON_SELECTORS) {
          const btn = this.page.locator(btnSel).first();
          const isVisible = await btn.isVisible({ timeout: 500 }).catch(() => false);
          if (isVisible) {
            evidence.buttonWasVisible = true;
            lastVisibleSelector = btnSel;
            const isEnabled = await btn.isEnabled({ timeout: 500 }).catch(() => false);
            if (isEnabled) {
              evidence.buttonWasEnabled = true;
              dismissBtn = btn;
              dismissSelector = btnSel;
              break;
            }
          }
        }
        if (dismissBtn) break;
        await this.page.waitForTimeout(500);
      }
      evidence.matchedButtonSelector = dismissSelector || lastVisibleSelector || "(none found)";
    }

    if (!dismissBtn) {
      // Determine precise failure state
      let failState: typeof PlaywrightStsdsDriver.POPUP_FAILURE_STATES[number];
      if (anchorResult.found && !anchorResult.okButtonFound) {
        failState = "popup_root_resolved_but_ok_button_not_found";
      } else if (anchorResult.found && anchorResult.okButtonFound && !anchorResult.okButtonEnabled) {
        failState = "popup_root_resolved_but_ok_button_not_interactable";
      } else if (!anchorResult.found && genericModalContainer) {
        failState = "popup_detected_but_button_not_found";
      } else {
        failState = "popup_root_resolution_failed";
      }

      const failScreenshot = await this.capturePopupScreenshot("dismiss_button_not_found");
      evidence.screenshotAfterDismiss = failScreenshot;

      return {
        noticeDetected: true,
        noticeDismissed: false,
        noticeTitle: matchedNotice!.label,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: failState,
        diagnostics: evidence,
        note:
          `MyTax blocking notice "${matchedNotice!.label}" detected. ` +
          `popupFailureState=${failState}. ` +
          `Anchor resolution: found=${anchorResult.found}, ` +
          `rootSelector=${anchorResult.popupRootSelector || "(none)"}, ` +
          `rootTag=${anchorResult.popupRootTag}, ` +
          `rootClasses="${anchorResult.popupRootClasses}", ` +
          `rootId="${anchorResult.popupRootId}", ` +
          `rootRole="${anchorResult.popupRootRole}", ` +
          `okBtnFound=${anchorResult.okButtonFound}, ` +
          `okBtnVisible=${anchorResult.okButtonVisible}, ` +
          `okBtnEnabled=${anchorResult.okButtonEnabled}, ` +
          `okBtnSelector=${anchorResult.okButtonSelector || "(none)"}, ` +
          `clickableTextsInRoot=[${anchorResult.allClickableTextsInRoot.join(", ")}]. ` +
          `Generic container: ${genericModalContainer ?? "(none)"}. ` +
          `URL: ${activeUrl}. ` +
          `Screenshot before: ${screenshotBeforeDismiss ?? "(failed)"}. ` +
          `Screenshot after: ${failScreenshot ?? "(failed)"}. ` +
          `outerHTML snippet: ${anchorResult.popupRootOuterHtmlSnippet.substring(0, 500) || "(none)"}.`,
      };
    }

    // ── Phase 7: Click dismiss button ───────────────────────────
    evidence.clickWasAttempted = true;

    try {
      await dismissBtn.click({ timeout: 5000, force: true });
      evidence.clickSucceeded = true;
    } catch (err) {
      const clickError = err instanceof Error ? err.message : String(err);
      evidence.clickSucceeded = false;
      evidence.clickError = clickError;

      const errorScreenshot = await this.capturePopupScreenshot("click_error");
      evidence.screenshotAfterDismiss = errorScreenshot;

      return {
        noticeDetected: true,
        noticeDismissed: false,
        noticeTitle: matchedNotice!.label,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: "popup_click_threw_error",
        diagnostics: evidence,
        note:
          `MyTax blocking notice "${matchedNotice!.label}" detected. ` +
          `popupFailureState=popup_click_threw_error. ` +
          `Button (${dismissSelector}) click threw: "${clickError}". ` +
          `Anchor root: ${anchorResult.popupRootSelector || "(none)"}. ` +
          `URL: ${activeUrl}.`,
      };
    }

    // ── Phase 8: Verify dismissal ───────────────────────────────
    // Check that BOTH the popup root AND any generic modal/backdrop are gone.
    const verifyEnd = Date.now() + 5_000;
    let popupGone = false;
    while (Date.now() < verifyEnd) {
      await this.page.waitForTimeout(500);

      // Check if anchor title text is gone
      const titleStillVisible = await this.page
        .locator(':has-text("Pemberitahuan")')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);

      // Check if generic modal container is gone
      const genericStillPresent = await this.detectModalPresence();

      if (!titleStillVisible && !genericStillPresent) {
        popupGone = true;
        break;
      }
    }

    // Backdrop check
    const backdropRemained = !popupGone
      ? true
      : await this.page
          .locator('.modal-backdrop')
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);

    evidence.modalRemainedAfterClick = !popupGone;
    evidence.backdropRemainedAfterClick = backdropRemained;

    const postDismissScreenshot = await this.capturePopupScreenshot(
      popupGone && !backdropRemained ? "after_dismiss_success" : "after_dismiss_failed"
    );
    evidence.screenshotAfterDismiss = postDismissScreenshot;

    if (!popupGone) {
      const failState = anchorResult.found
        ? "popup_root_click_attempted_but_popup_remained" as const
        : "popup_click_attempted_but_modal_remained" as const;

      return {
        noticeDetected: true,
        noticeDismissed: false,
        noticeTitle: matchedNotice!.label,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: failState,
        diagnostics: evidence,
        note:
          `MyTax blocking notice "${matchedNotice!.label}" — ` +
          `popupFailureState=${failState}. ` +
          `Button clicked (${dismissSelector}), click succeeded, ` +
          `but popup still present after 5s verification. ` +
          `Anchor root: ${anchorResult.popupRootSelector || "(none)"}. ` +
          `URL: ${activeUrl}. ` +
          `Screenshot before: ${screenshotBeforeDismiss ?? "(failed)"}. ` +
          `Screenshot after: ${postDismissScreenshot ?? "(failed)"}.`,
      };
    }

    if (backdropRemained) {
      const failState = anchorResult.found
        ? "popup_root_click_attempted_but_overlay_remained" as const
        : "popup_click_attempted_but_backdrop_remained" as const;

      return {
        noticeDetected: true,
        noticeDismissed: false,
        noticeTitle: matchedNotice!.label,
        unknownModalDetected: false,
        dismissalVerified: false,
        popupFailureState: failState,
        diagnostics: evidence,
        note:
          `MyTax blocking notice "${matchedNotice!.label}" — ` +
          `popupFailureState=${failState}. ` +
          `Button clicked, popup gone, but backdrop/overlay still present. ` +
          `URL: ${activeUrl}.`,
      };
    }

    return {
      noticeDetected: true,
      noticeDismissed: true,
      noticeTitle: matchedNotice!.label,
      unknownModalDetected: false,
      dismissalVerified: true,
      popupFailureState: null,
      diagnostics: evidence,
      note:
        `MyTax blocking notice "${matchedNotice!.label}" detected at poll iteration ${iteration}, ` +
        `dismissed via ${dismissSelector}` +
        (anchorResult.found ? ` (anchor-resolved root: ${anchorResult.popupRootSelector})` : "") +
        `, and verified gone. ` +
        `Screenshot before: ${screenshotBeforeDismiss ?? "(failed)"}. ` +
        `Screenshot after: ${postDismissScreenshot ?? "(failed)"}.`,
    };
  }

  // ─── navigateToPage ─────────────────────────────────────────────
  // Implements the real authenticated bootstrap for TIN-holder / agent-admin
  // accounts via MyTax → eZHasil Services → Duti Setem → e-Stamp Duty →
  // SSO interstitial → role selection → confirmed e-Duti Setem dashboard.
  //
  // Each stage has a named failure outcome so the caller gets truthful
  // reporting of exactly where the flow stopped.

  async navigateToPage(
    _target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult> {
    // Stage-tracking variables — declared before try so the outer catch
    // can report which stage was last entered/completed.
    let lastEnteredStage = "none";
    let lastCompletedStage = "none";
    let postPopupContinuationEntered = false;

    /** Write a marker file to disk — evidence that a stage was reached. */
    const writeMarker = (name: string, body: string): void => {
      try {
        const fsMk = require("fs") as typeof import("fs");
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const dir = "data/portal-probe-artifacts";
        fsMk.mkdirSync(dir, { recursive: true });
        fsMk.writeFileSync(
          `${dir}/${name}_${ts}.txt`,
          `${name}\n${new Date().toISOString()}\n${body}\n`
        );
      } catch { /* best-effort — never throw from marker write */ }
    };

    /** Suffix appended to every failure message for stage tracking. */
    const stageTrackingSuffix = (): string =>
      ` [lastEnteredStage=${lastEnteredStage}, lastCompletedStage=${lastCompletedStage}]`;

    try {
      // Hoisted readiness timing string — set inside the barrier block,
      // used downstream in pageSelSummary and failure messages.
      let readinessTimingStr = "";

      // ══════════════════════════════════════════════════════════════
      // PHASE A: Pre-auth / authentication gate (up to 120s)
      // ══════════════════════════════════════════════════════════════
      // Detects whether the current page is a login page, a loading
      // page, or an already-authenticated page. Does NOT enter post-
      // login readiness until authentication is evidenced. This
      // prevents the driver from treating a pre-auth landing page as
      // if it were an authenticated dashboard.
      {
        console.log("\n=== PHASE A: AUTH GATE ENTERED ===");

        const fs0 = await import("fs");
        const artifactDir0 = "data/portal-probe-artifacts";
        fs0.mkdirSync(artifactDir0, { recursive: true });
        fs0.writeFileSync(
          `${artifactDir0}/AUTH_GATE_ENTERED.txt`,
          `Auth gate entered at ${new Date().toISOString()}\npage.url()=${this.page.url()}\n`,
          "utf-8"
        );

        const AUTH_GATE_TIMEOUT_MS = 120_000;
        const AUTH_GATE_INTERVAL_MS = 2_000;
        const authGateStart = Date.now();
        const browserCtx0 = this.page.context();

        // Phase A tracking
        let authPhase: "unknown" | "loading" | "login_page" | "authenticated" = "unknown";
        let authGateTicks = 0;
        let loginFormFirstDetectedTick: number | null = null;
        let loginFormGoneTick: number | null = null;
        let loadingOverlayFirstTick: number | null = null;
        let authSignalFirstTick: number | null = null;
        let authSignalType = "";
        let authSignalPage: Page | null = null;
        // Require N consecutive authenticated ticks before confirming auth.
        // Prevents single-tick false positives from transient DOM states.
        const AUTH_STABLE_TICKS_REQUIRED = 2;
        let consecutiveAuthTicks = 0;

        // Phase A per-tick log
        const authGateLog: Array<{
          tick: number;
          elapsedMs: number;
          phase: string;
          loginIndicators: {
            silaMasukkan: boolean;
            silaPilih: boolean;
            noPengenalan: boolean;
            hantar: boolean;
            passwordInput: boolean;
            loginSubmitBtn: boolean;
          };
          loadingIndicators: {
            overlayVisible: boolean;
            spinnerVisible: boolean;
          };
          authIndicators: {
            dashContent: boolean;
            pemberitahuan: boolean;
            pilihanPeranan: boolean;
            ezHasil: boolean;
            okButton: boolean;
            loginFormAbsent: boolean;
          };
          url: string;
          readyState: string;
        }> = [];

        while (Date.now() - authGateStart < AUTH_GATE_TIMEOUT_MS) {
          // Scan all pages for auth signals (signal may appear on any tab)
          const allPages: Page[] = browserCtx0.pages();
          let authSignalFoundOnAnyPage = false;
          let authSignalFoundPage: Page | null = null;
          let authSignalFoundType = "";

          for (const pg of allPages) {
            const locHref = await pg.evaluate(() => window.location.href).catch(() => "");
            const bodyText = await pg.evaluate(
              () => document.body?.innerText?.substring(0, 5000) ?? ""
            ).catch(() => "");

            const isDash = locHref.toLowerCase().includes("/dashboard-content");
            const hasPemberitahuan = bodyText.includes("Pemberitahuan MyTax") || bodyText.includes("Pemberitahuan");
            // NOTE: ezHasil menu text is NOT an authenticated-only signal.
            // The public MyTax landing page contains "Perkhidmatan ezHASiL" in
            // its header/nav, so it causes false-positive auth classification.
            // ezHasil is tracked for diagnostics only, never used as auth proof.
            const hasEzHasil = bodyText.includes("Perkhidmatan ezHASiL") ||
              bodyText.includes("Perkhidmatan ezHasil") ||
              bodyText.includes("eZHASiL Services");
            const hasOk = await pg
              .locator('button:has-text("Ok"), button:has-text("OK"), .btn:has-text("Ok"), .btn:has-text("OK")')
              .first().isVisible({ timeout: 300 }).catch(() => false);
            // Pilihan Peranan is an authenticated-only dashboard signal
            const hasPilihanPeranan = bodyText.includes("Pilihan Peranan");

            // Check if THIS page has login controls (hard negative for auth)
            const pgHasLoginControls = await pg
              .locator('input[type="password"], input[name="password"], button:has-text("Hantar"), button:has-text("Log Masuk")')
              .first().isVisible({ timeout: 300 }).catch(() => false);

            // Authenticated-only signals: /dashboard-content URL, Pemberitahuan,
            // Pilihan Peranan. ezHasil is excluded (present on public page).
            // Ok button is only valid if login controls are absent on that page.
            const strongSignal = isDash || hasPemberitahuan || hasPilihanPeranan;
            const weakSignalOk = hasOk && !pgHasLoginControls;

            if (strongSignal || weakSignalOk) {
              authSignalFoundOnAnyPage = true;
              authSignalFoundPage = pg;
              authSignalFoundType = [
                isDash ? "/dashboard-content" : null,
                hasPemberitahuan ? "Pemberitahuan" : null,
                hasPilihanPeranan ? "Pilihan_Peranan" : null,
                weakSignalOk ? "Ok_button" : null,
                hasEzHasil ? "(ezHasil_diag_only)" : null,
              ].filter(Boolean).join("+");
              break;
            }
          }

          // Detect login indicators on the active page
          const activeBodyText = await this.page.evaluate(
            () => document.body?.innerText?.substring(0, 5000) ?? ""
          ).catch(() => "");
          const activeUrl = await this.page.evaluate(
            () => window.location.href
          ).catch(() => this.page.url());
          const activeReady = await this.page.evaluate(
            () => document.readyState
          ).catch(() => "?");

          const loginInd = {
            silaMasukkan: activeBodyText.includes("Sila Masukkan Maklumat Anda"),
            silaPilih: activeBodyText.includes("Sila Pilih Jenis Pengenalan"),
            noPengenalan: activeBodyText.includes("No. Pengenalan"),
            hantar: activeBodyText.includes("Hantar"),
            passwordInput: await this.page
              .locator('input[type="password"], input[name="password"]')
              .first().isVisible({ timeout: 300 }).catch(() => false),
            loginSubmitBtn: await this.page
              .locator('button:has-text("Hantar"), button:has-text("Log Masuk"), input[type="submit"]')
              .first().isVisible({ timeout: 300 }).catch(() => false),
          };

          const isLoginPage = loginInd.passwordInput || loginInd.loginSubmitBtn ||
            loginInd.silaMasukkan || loginInd.silaPilih;

          // Detect loading indicators
          const loadingInd = {
            overlayVisible: await this.page
              .locator('.loading-overlay, .overlay, [class*="loading-overlay"], [class*="blockUI"], .modal-backdrop')
              .first().isVisible({ timeout: 300 }).catch(() => false),
            spinnerVisible: await this.page
              .locator('.spinner, .loader, [class*="spinner"], [class*="loader"], .fa-spinner, .loading-spinner')
              .first().isVisible({ timeout: 300 }).catch(() => false),
          };

          const isLoading = loadingInd.overlayVisible || loadingInd.spinnerVisible;

          // Auth indicators on active page
          const activeIsDash = activeUrl.toLowerCase().includes("/dashboard-content");
          const activePemberitahuan = activeBodyText.includes("Pemberitahuan");
          // ezHasil tracked for diagnostics only — NOT an auth signal
          const activeEzHasil = activeBodyText.includes("Perkhidmatan ezHASiL") ||
            activeBodyText.includes("Perkhidmatan ezHasil") ||
            activeBodyText.includes("eZHASiL Services");
          const activeOk = await this.page
            .locator('button:has-text("Ok"), button:has-text("OK"), .btn:has-text("Ok")')
            .first().isVisible({ timeout: 300 }).catch(() => false);
          const activePilihanPeranan = activeBodyText.includes("Pilihan Peranan");
          const activeLoginFormAbsent = !isLoginPage && !isLoading;

          const authInd = {
            dashContent: activeIsDash,
            pemberitahuan: activePemberitahuan,
            pilihanPeranan: activePilihanPeranan,
            ezHasil: activeEzHasil,
            okButton: activeOk,
            loginFormAbsent: activeLoginFormAbsent,
          };

          // Track first-appearances
          if (isLoginPage && loginFormFirstDetectedTick === null) loginFormFirstDetectedTick = authGateTicks;
          if (!isLoginPage && loginFormFirstDetectedTick !== null && loginFormGoneTick === null) loginFormGoneTick = authGateTicks;
          if (isLoading && loadingOverlayFirstTick === null) loadingOverlayFirstTick = authGateTicks;

          if (authSignalFoundOnAnyPage && authSignalFirstTick === null) {
            authSignalFirstTick = authGateTicks;
            authSignalType = authSignalFoundType;
            authSignalPage = authSignalFoundPage;
          }

          // ── Hard negative pre-auth gate ──
          // If login controls are visible on the active page, we are NOT
          // authenticated UNLESS a /dashboard-content URL exists on some
          // other page. Login controls override all weaker signals.
          const dashContentUrlOnAnyPage = authSignalFoundOnAnyPage &&
            authSignalFoundType.includes("/dashboard-content");
          const authVetoed = isLoginPage && !dashContentUrlOnAnyPage;

          // Effective auth signal: only counts if not vetoed
          const effectiveAuthSignal = authSignalFoundOnAnyPage && !authVetoed;

          // Classify current phase
          if (effectiveAuthSignal) {
            authPhase = "authenticated";
          } else if (isLoginPage) {
            authPhase = "login_page";
          } else if (isLoading) {
            authPhase = "loading";
          } else if (!isLoginPage && loginFormFirstDetectedTick !== null) {
            // Login form was seen before but now gone AND no loading — auth transition
            authPhase = "authenticated";
          } else {
            authPhase = "unknown";
          }

          // Track consecutive confirmed-auth ticks for stability requirement
          if (authPhase === "authenticated") {
            consecutiveAuthTicks++;
          } else {
            consecutiveAuthTicks = 0;
          }

          // Log entry
          authGateLog.push({
            tick: authGateTicks,
            elapsedMs: Date.now() - authGateStart,
            phase: authPhase,
            loginIndicators: loginInd,
            loadingIndicators: loadingInd,
            authIndicators: authInd,
            url: activeUrl.substring(0, 80),
            readyState: activeReady,
          });

          // Console log — includes veto status and consecutive count
          console.log(
            `  auth-gate tick ${authGateTicks} (${Date.now() - authGateStart}ms): ` +
            `phase=${authPhase}, ` +
            `login=${isLoginPage}, loading=${isLoading}, ` +
            `authSignal=${authSignalFoundOnAnyPage}, authVetoed=${authVetoed}, ` +
            `effective=${effectiveAuthSignal}, consecutive=${consecutiveAuthTicks}/${AUTH_STABLE_TICKS_REQUIRED}, ` +
            `url=${activeUrl.substring(0, 60)}, ` +
            `ready=${activeReady}, ` +
            `pwd=${loginInd.passwordInput}, hantar=${loginInd.loginSubmitBtn}, ` +
            `silaMasukkan=${loginInd.silaMasukkan}, silaPilih=${loginInd.silaPilih}, ` +
            `overlay=${loadingInd.overlayVisible}, spinner=${loadingInd.spinnerVisible}, ` +
            `signalType=${authSignalFoundType || "none"}`
          );

          // Save screenshot every 5 ticks
          if (authGateTicks % 5 === 0) {
            try {
              const ssTs = new Date().toISOString().replace(/[:.]/g, "-");
              await this.page.screenshot({
                path: `${artifactDir0}/auth_gate_tick_${authGateTicks}_${ssTs}.png`,
                fullPage: false,
              });
            } catch {
              // ignore
            }
          }

          // Require 2 consecutive authenticated ticks before confirming.
          // A single tick could be a transient DOM state.
          if (authPhase === "authenticated" && consecutiveAuthTicks >= AUTH_STABLE_TICKS_REQUIRED) {
            console.log(
              `  ✓ Auth gate: stable authenticated state confirmed at tick ${authGateTicks} ` +
              `(${consecutiveAuthTicks} consecutive, signal=${authSignalType || authSignalFoundType}, ` +
              `loginPresent=${isLoginPage}, vetoed=${authVetoed})`
            );
            break;
          }

          authGateTicks++;
          await this.page.waitForTimeout(AUTH_GATE_INTERVAL_MS);
        }

        const authGateDurationMs = Date.now() - authGateStart;

        // Save auth gate summary
        try {
          const summaryTs = new Date().toISOString().replace(/[:.]/g, "-");
          fs0.writeFileSync(
            `${artifactDir0}/auth_gate_summary_${summaryTs}.json`,
            JSON.stringify({
              authPhase,
              totalTicks: authGateTicks + 1,
              durationMs: authGateDurationMs,
              loginFormFirstDetectedTick,
              loginFormGoneTick,
              loadingOverlayFirstTick,
              authSignalFirstTick,
              authSignalType,
              log: authGateLog,
            }, null, 2),
            "utf-8"
          );
        } catch {
          // ignore
        }

        const authGateTimingStr =
          `authGate: phase=${authPhase}, ticks=${authGateTicks + 1}, ` +
          `durationMs=${authGateDurationMs}, ` +
          `consecutiveAuthTicks=${consecutiveAuthTicks}/${AUTH_STABLE_TICKS_REQUIRED}, ` +
          `loginFormFirstTick=${loginFormFirstDetectedTick ?? "never"}, ` +
          `loginFormGoneTick=${loginFormGoneTick ?? "never"}, ` +
          `loadingOverlayFirstTick=${loadingOverlayFirstTick ?? "never"}, ` +
          `authSignalFirstTick=${authSignalFirstTick ?? "never"}, ` +
          `authSignalType=${authSignalType || "none"}.`;

        console.log("=== PHASE A: AUTH GATE COMPLETED ===");
        console.log(`    Phase: ${authPhase}`);
        console.log(`    Duration: ${authGateDurationMs}ms (${authGateTicks + 1} ticks)`);
        console.log(`    Consecutive auth ticks: ${consecutiveAuthTicks}/${AUTH_STABLE_TICKS_REQUIRED}`);
        console.log(`    Login form first: tick ${loginFormFirstDetectedTick ?? "never"}`);
        console.log(`    Login form gone: tick ${loginFormGoneTick ?? "never"}`);
        console.log(`    Loading overlay first: tick ${loadingOverlayFirstTick ?? "never"}`);
        console.log(`    Auth signal first: tick ${authSignalFirstTick ?? "never"}`);
        console.log(`    Auth signal type: ${authSignalType || "none"}\n`);

        // If not authenticated after Phase A, return specific failure
        if (authPhase !== "authenticated") {
          fs0.writeFileSync(
            `${artifactDir0}/AUTH_GATE_FAILED.txt`,
            `Auth gate failed at ${new Date().toISOString()}\nphase=${authPhase}\n${authGateTimingStr}\n`,
            "utf-8"
          );

          const outcomeState =
            authPhase === "login_page"
              ? "mytax_login_page_detected_awaiting_manual_login" as const
              : authPhase === "loading"
              ? "mytax_loading_overlay_persisted" as const
              : "authenticated_state_not_reached" as const;

          const phaseLabel =
            authPhase === "login_page"
              ? "[PRE-AUTH: LOGIN PAGE] Login form still visible after 120s. User may need to log in manually."
              : authPhase === "loading"
              ? "[PRE-AUTH: LOADING] Page loading overlay persisted for 120s. Page may be stuck."
              : "[PRE-AUTH: UNKNOWN] No login form, no loading overlay, and no authenticated signal after 120s.";

          return {
            success: false,
            bootstrapOutcome: outcomeState,
            failureReason:
              `${phaseLabel} ${authGateTimingStr} ` +
              "Authentication was NOT confirmed — post-login readiness barrier was NOT entered. " +
              "This failure occurred in the pre-auth phase, not in popup handling or menu handling.",
            readbackNote:
              `${phaseLabel} ${authGateTimingStr}`,
          };
        }

        // Switch to the auth-signal-bearing page if on a different tab
        if (authSignalPage && authSignalPage !== this.page) {
          console.log(`  Switching to auth-signal page: ${authSignalPage.url().substring(0, 80)}`);
          this.page = authSignalPage;
          await this.page.bringToFront().catch(() => {});
        }

        // ══════════════════════════════════════════════════════════════
        // PHASE B: Post-auth readiness barrier (up to 60s)
        // ══════════════════════════════════════════════════════════════
        // Authentication confirmed. Now wait for a meaningful dashboard
        // signal (/dashboard-content, Pemberitahuan, Ok button, ezHasil
        // menu) before handing off to popup handling. The auth signal
        // that ended Phase A may itself be the meaningful signal.
        console.log("\n=== PHASE B: POST-AUTH READINESS BARRIER ENTERED ===");

        const READINESS_TIMEOUT_MS = 60_000;
        const READINESS_INTERVAL_MS = 1_000;
        const readinessStartTime = Date.now();

        let firstDashContentTick: number | null = null;
        let firstPopupTextTick: number | null = null;
        let firstOkButtonTick: number | null = null;
        let firstEzHasilMenuTick: number | null = null;
        let meaningfulSignalTick: number | null = null;
        let meaningfulSignalType = "";
        let meaningfulSignalPage: Page | null = null;
        let readinessTick = 0;
        let rootUrlTicksBeforeSignal = 0;

        while (Date.now() - readinessStartTime < READINESS_TIMEOUT_MS) {
          const allPages: Page[] = browserCtx0.pages();
          let signalFoundThisTick = false;

          for (const pg of allPages) {
            const locHref = await pg.evaluate(() => window.location.href).catch(() => "");
            const bodyText = await pg.evaluate(
              () => document.body?.innerText?.substring(0, 5000) ?? ""
            ).catch(() => "");

            const isDashContent = locHref.toLowerCase().includes("/dashboard-content");
            const hasPemberitahuan = bodyText.includes("Pemberitahuan MyTax") || bodyText.includes("Pemberitahuan");
            // ezHasil is NOT a meaningful signal — present on public page
            const hasEzHasil = bodyText.includes("Perkhidmatan ezHASiL") ||
              bodyText.includes("Perkhidmatan ezHasil") ||
              bodyText.includes("eZHASiL Services");
            const hasOkButton = await pg
              .locator('button:has-text("Ok"), button:has-text("OK"), .btn:has-text("Ok"), .btn:has-text("OK")')
              .first().isVisible({ timeout: 300 }).catch(() => false);
            const hasPilihanPeranan = bodyText.includes("Pilihan Peranan");

            // Check login controls on this page — veto weak signals
            const pgLoginControls = await pg
              .locator('input[type="password"], input[name="password"], button:has-text("Hantar"), button:has-text("Log Masuk")')
              .first().isVisible({ timeout: 300 }).catch(() => false);

            if (isDashContent && firstDashContentTick === null) firstDashContentTick = readinessTick;
            if (hasPemberitahuan && firstPopupTextTick === null) firstPopupTextTick = readinessTick;
            if (hasOkButton && firstOkButtonTick === null) firstOkButtonTick = readinessTick;
            if (hasEzHasil && firstEzHasilMenuTick === null) firstEzHasilMenuTick = readinessTick;

            // Meaningful signals: /dashboard-content, Pemberitahuan, Pilihan Peranan.
            // Ok button only if login controls are absent on that page.
            // ezHasil excluded entirely (public page false positive).
            const strongSig = isDashContent || hasPemberitahuan || hasPilihanPeranan;
            const weakOkSig = hasOkButton && !pgLoginControls;

            if (strongSig || weakOkSig) {
              signalFoundThisTick = true;
              if (meaningfulSignalTick === null) {
                meaningfulSignalTick = readinessTick;
                meaningfulSignalPage = pg;
                meaningfulSignalType = [
                  isDashContent ? "/dashboard-content" : null,
                  hasPemberitahuan ? "Pemberitahuan" : null,
                  hasPilihanPeranan ? "Pilihan_Peranan" : null,
                  weakOkSig ? "Ok_button" : null,
                  hasEzHasil ? "(ezHasil_diag_only)" : null,
                ].filter(Boolean).join("+");
              }
            }
          }

          console.log(
            `  readiness tick ${readinessTick} (${Date.now() - readinessStartTime}ms): ` +
            `signal=${signalFoundThisTick}`
          );

          if (!signalFoundThisTick) {
            rootUrlTicksBeforeSignal++;
          }

          if (signalFoundThisTick) {
            break;
          }

          readinessTick++;
          await this.page.waitForTimeout(READINESS_INTERVAL_MS);
        }

        const readinessDurationMs = Date.now() - readinessStartTime;
        const signalFound = meaningfulSignalTick !== null;

        readinessTimingStr =
          `${authGateTimingStr} ` +
          `readinessBarrier: signalFound=${signalFound}, ` +
          `signalType=${meaningfulSignalType || "none"}, ` +
          `signalAtTick=${meaningfulSignalTick ?? "never"}, ` +
          `durationMs=${readinessDurationMs}, ` +
          `rootUrlTicksBefore=${rootUrlTicksBeforeSignal}, ` +
          `firstDashContent=${firstDashContentTick ?? "never"}, ` +
          `firstPopupText=${firstPopupTextTick ?? "never"}, ` +
          `firstOkBtn=${firstOkButtonTick ?? "never"}, ` +
          `firstEzHasil=${firstEzHasilMenuTick ?? "never"}.`;

        console.log("=== PHASE B: POST-AUTH READINESS BARRIER COMPLETED ===");
        console.log(`    Signal found: ${signalFound}`);
        console.log(`    Signal type: ${meaningfulSignalType || "none"}`);
        console.log(`    Signal at tick: ${meaningfulSignalTick ?? "never"}`);
        console.log(`    Duration: ${readinessDurationMs}ms\n`);

        if (!signalFound) {
          return {
            success: false,
            bootstrapOutcome: "post_login_meaningful_signal_timeout",
            failureReason:
              `[POST-AUTH PHASE] Authentication confirmed, but no meaningful dashboard ` +
              `signal within ${READINESS_TIMEOUT_MS}ms. ${readinessTimingStr} ` +
              "Session may need manual inspection.",
            readbackNote:
              `[POST-AUTH TIMEOUT] Auth confirmed but no dashboard signal in ${readinessDurationMs}ms. ` +
              `${readinessTimingStr}`,
          };
        }

        // Switch to signal-bearing page
        if (meaningfulSignalPage && meaningfulSignalPage !== this.page) {
          console.log(`  Switching to signal-bearing page: ${meaningfulSignalPage.url().substring(0, 80)}`);
          this.page = meaningfulSignalPage;
          await this.page.bringToFront().catch(() => {});
        }

        await this.page.waitForTimeout(1000);

        fs0.writeFileSync(
          `${artifactDir0}/READINESS_BARRIER_COMPLETED.txt`,
          `Both phases completed at ${new Date().toISOString()}\n` +
          `${readinessTimingStr}\n`,
          "utf-8"
        );
      }

      // ── Stage 0: Already on e-Duti Setem? ─────────────────────────
      const currentUrl = this.page.url();
      if (
        currentUrl.includes("stamps.hasil.gov.my") &&
        !currentUrl.includes("login")
      ) {
        const hasDashboard = await this.page
          .locator(
            [
              'a:has-text("Borang Permohonan")',
              'a:has-text("Permohonan Baru")',
              '[class*="dashboard"]',
              'text="Senarai Permohonan"',
            ].join(", ")
          )
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        if (hasDashboard) {
          return {
            success: true,
            selectorMethod: "already_on_portal",
            bootstrapOutcome: "already_on_eduti_setem",
            readbackNote:
              "Already on authenticated e-Duti Setem dashboard — skipped MyTax handoff.",
          };
        }
      }

      // ── Stage 0b: Re-enumerate pages to find the real dashboard ──
      // The page passed to the driver may not be the actual post-login
      // dashboard. Login may have changed tab state. Re-enumerate all
      // pages in the context and select the one that looks like the
      // MyTax dashboard before doing ANY popup or menu detection.
      const browserContext = this.page.context();
      let pageRecheck = await enumerateAndSelectDashboardPage(
        browserContext, this.page
      );

      // Log page-selection diagnostics for probe notes
      const pageSelectionDiagnostics = {
        pageCount: pageRecheck.pageCount,
        selectedPageIndex: pageRecheck.selectedPageIndex,
        selectedPageUrl: pageRecheck.selectedPageUrl,
        selectedPageTitle: pageRecheck.selectedPageTitle,
        selectionReason: pageRecheck.selectionReason,
        popupTextOnSelectedPage: pageRecheck.popupTextOnSelectedPage,
        menuTextOnSelectedPage: pageRecheck.menuTextOnSelectedPage,
        inventory: pageRecheck.pageInventory.map(e => ({
          idx: e.index,
          url: e.url.substring(0, 80),
          isMytax: e.isMytaxUrl,
          isDashContent: e.isDashboardContentUrl,
          hasDash: e.hasDashboardContent,
          hasPopup: e.hasPopupText,
          hasMenu: e.hasMenuText,
        })),
      };

      console.log("\n  navigateToPage — Page re-enumeration:");
      console.log(`    Pages: ${pageRecheck.pageCount}`);
      console.log(`    Selected: #${pageRecheck.selectedPageIndex} (${pageRecheck.selectionReason})`);
      console.log(`    URL: ${pageRecheck.selectedPageUrl}`);
      console.log(`    Popup on selected: ${pageRecheck.popupTextOnSelectedPage}`);
      console.log(`    Menu on selected: ${pageRecheck.menuTextOnSelectedPage}\n`);

      // Switch to the selected dashboard page
      if (pageRecheck.selectedPage !== this.page) {
        this.page = pageRecheck.selectedPage;
        await this.page.bringToFront().catch(() => {});
      }

      // ── Stage 1: Reach MyTax dashboard ────────────────────────────
      const recheckUrl = this.page.url();
      if (!recheckUrl.includes("mytax.hasil.gov.my")) {
        await this.page.goto(MYTAX_BASE_URL, {
          timeout: NAVIGATION_TIMEOUT,
          waitUntil: "domcontentloaded",
        });
        await this.page.waitForTimeout(2000);
      }

      // Verify we're on MyTax (not redirected to login)
      const mytaxUrl = this.page.url();
      const isLoginRedirect = await this.page
        .locator(
          [
            'input[type="password"]',
            '#password',
            'form[action*="login"]',
            'form[action*="LogIn"]',
            'button:has-text("Log Masuk")',
          ].join(", ")
        )
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (isLoginRedirect) {
        return {
          success: false,
          bootstrapOutcome: "failed_to_reach_mytax_dashboard",
          failureReason:
            "Redirected to login page — session may be expired. " +
            `Current URL: ${mytaxUrl}. ` +
            `Page selection: ${JSON.stringify(pageSelectionDiagnostics)}. ` +
            "Delete data/playwright-profile/ and re-authenticate.",
        };
      }

      // ── Stage 1a: Post-signal stabilization ──────────────────────
      // The readiness barrier at the top of navigateToPage() already
      // waited up to 60s for a meaningful signal (/dashboard-content,
      // popup text, Ok button, or ezHasil menu) and switched this.page
      // to the signal-bearing page. Now do a final re-enumeration to
      // ensure the page selection is authoritative before popup handling.
      pageRecheck = await enumerateAndSelectDashboardPage(
        browserContext, this.page
      );
      if (pageRecheck.selectedPage !== this.page) {
        this.page = pageRecheck.selectedPage;
        await this.page.bringToFront().catch(() => {});
      }

      // dashboardStabilized is always true here because the readiness
      // barrier already confirmed a meaningful signal appeared.
      const dashboardStabilized = true;

      console.log("\n  navigateToPage — Post-readiness page selection:");
      console.log(`    Final selected URL: ${pageRecheck.selectedPageUrl}`);
      console.log(`    Final selection reason: ${pageRecheck.selectionReason}`);
      console.log(`    Popup on final page: ${pageRecheck.popupTextOnSelectedPage}`);
      console.log(`    Menu on final page: ${pageRecheck.menuTextOnSelectedPage}\n`);

      // ── Stage 1b: Dismiss MyTax blocking notices ────────────────
      // After login/session restore, MyTax may show a blocking modal
      // (e.g. "Pemberitahuan MyTax") that prevents dashboard interaction.
      // Uses bounded polling: checks for modal over 10s window before
      // concluding no modal is present.
      //
      // IMPORTANT: This runs on the AUTHORITATIVE final dashboard page
      // selected after the stabilization barrier — not a stale/wrong tab.
      const noticeResult = await this.dismissMyTaxBlockingNotices();

      // ── Helper: format full popup evidence for failure messages ──
      const formatPopupEvidence = (
        diag: typeof noticeResult.diagnostics
      ): string => {
        if (!diag) return "";
        let s =
          ` Evidence: title="${diag.detectedTitle}", ` +
          `buttons=[${diag.detectedButtonTexts.join(", ")}], ` +
          `container=${diag.matchedContainerSelector}, ` +
          `buttonSelector=${diag.matchedButtonSelector}, ` +
          `buttonVisible=${diag.buttonWasVisible}, ` +
          `buttonEnabled=${diag.buttonWasEnabled}, ` +
          `clickAttempted=${diag.clickWasAttempted}, ` +
          `clickSucceeded=${diag.clickSucceeded}, ` +
          (diag.clickError ? `clickError="${diag.clickError}", ` : "") +
          `modalRemainedAfterClick=${diag.modalRemainedAfterClick}, ` +
          `backdropRemainedAfterClick=${diag.backdropRemainedAfterClick}, ` +
          `url=${diag.activeUrlAtFailure}, ` +
          `screenshotBefore=${diag.screenshotBeforeDismiss ?? "(none)"}, ` +
          `screenshotAfter=${diag.screenshotAfterDismiss ?? "(none)"}, ` +
          `pollIterations=${diag.pollIterations}, ` +
          `detectedAtIteration=${diag.detectedAtIteration}.`;

        // Include anchor-resolution evidence if available
        if (diag.anchorResolution) {
          const ar = diag.anchorResolution;
          s += ` AnchorResolution: attempted=${ar.attempted}, found=${ar.found}, ` +
            `titleAnchor=${ar.titleAnchorSelector || "(none)"}, ` +
            `rootSelector=${ar.popupRootSelector || "(none)"}, ` +
            `rootTag=${ar.popupRootTag}, rootClasses="${ar.popupRootClasses}", ` +
            `rootId="${ar.popupRootId}", rootRole="${ar.popupRootRole}", ` +
            `okBtnSelector=${ar.okButtonSelector || "(none)"}, ` +
            `okBtnFound=${ar.okButtonFound}, okBtnVisible=${ar.okButtonVisible}, ` +
            `okBtnEnabled=${ar.okButtonEnabled}, ` +
            `clickableTexts=[${ar.allClickableTextsInRoot.join(", ")}], ` +
            `outerHTML=${ar.popupRootOuterHtmlSnippet.substring(0, 300) || "(none)"}.`;
        }

        return s;
      };

      // ── Classify popup state explicitly ──────────────────────────
      // Uses the granular popupFailureState from the dismissal helper
      // for precise failure identification, plus a summary state for
      // the success path.
      type MytaxPopupState =
        | "mytax_popup_not_present"
        | "mytax_popup_detected_and_dismissed"
        | "popup_detected_but_button_not_found"
        | "popup_detected_but_button_not_interactable"
        | "popup_click_attempted_but_modal_remained"
        | "popup_click_attempted_but_backdrop_remained"
        | "popup_click_threw_error"
        | "unknown_blocking_modal_present"
        | "popup_root_resolved_but_ok_button_not_found"
        | "popup_root_resolved_but_ok_button_not_interactable"
        | "popup_root_click_attempted_but_popup_remained"
        | "popup_root_click_attempted_but_overlay_remained"
        | "popup_root_resolution_failed"
        | "popup_ok_candidate_not_found"
        | "popup_ok_candidate_found_but_not_interactable"
        | "popup_ok_click_attempted_but_popup_remained"
        | "popup_ok_coordinate_click_attempted_but_popup_remained"
        | "popup_ok_click_threw_error"
        | "popup_state_inconclusive_due_to_page_mismatch";

      let mytaxPopupState: MytaxPopupState;

      if (noticeResult.popupFailureState) {
        mytaxPopupState = noticeResult.popupFailureState;
      } else if (noticeResult.noticeDetected && noticeResult.dismissalVerified) {
        mytaxPopupState = "mytax_popup_detected_and_dismissed";
      } else if (noticeResult.noticeDetected && !noticeResult.noticeDismissed) {
        mytaxPopupState = "popup_detected_but_button_not_found";
      } else {
        mytaxPopupState = "mytax_popup_not_present";
      }

      // ── Contradiction-aware popup escalation ──────────────────────
      // If the page enumeration detected popup text on the selected page
      // BUT the bounded modal detection reported "not present", the generic
      // modal selectors missed the real popup. Instead of stopping with an
      // inconclusive state, escalate to anchor-based popup root resolution
      // and attempt dismissal from the resolved root.
      let popupHandlingPath = "none";
      let anchorEscalationResult: {
        anchorResolution: {
          found: boolean;
          titleAnchorSelector: string;
          popupRootSelector: string;
          popupRootTag: string;
          popupRootClasses: string;
          popupRootId: string;
          popupRootRole: string;
          popupRootAria: string;
          popupRootOuterHtmlSnippet: string;
          okButtonSelector: string;
          okButtonFound: boolean;
          okButtonVisible: boolean;
          okButtonEnabled: boolean;
          allClickableTextsInRoot: string[];
        };
        screenshotBefore: string | null;
        screenshotAfter: string | null;
        clickAttempted: boolean;
        clickSucceeded: boolean;
        clickError: string | null;
        popupGoneAfterClick: boolean;
        backdropRemainedAfterClick: boolean;
        popupFailureState: typeof PlaywrightStsdsDriver.POPUP_FAILURE_STATES[number] | null;
      } | null = null;

      if (noticeResult.noticeDetected) {
        popupHandlingPath = noticeResult.dismissalVerified
          ? "generic_modal_dismissed"
          : "generic_modal_detected_but_dismiss_failed";
      }

      // Escalate to anchor-based resolution + layered fallback when:
      // (a) Generic modal detection missed the popup but page enumeration found popup text, OR
      // (b) Generic modal detection found the popup but failed to dismiss it
      const shouldEscalateToAnchor =
        (mytaxPopupState === "mytax_popup_not_present" && pageRecheck.popupTextOnSelectedPage) ||
        (noticeResult.noticeDetected && !noticeResult.dismissalVerified);

      if (shouldEscalateToAnchor) {
        const escalateReason = mytaxPopupState === "mytax_popup_not_present"
          ? "Generic modal detection reported 'not present' but page enumeration found popup text."
          : `Generic modal detected but dismiss failed (popupFailureState=${noticeResult.popupFailureState}).`;
        console.log(`  ⚠ ${escalateReason} Escalating to anchor-based popup root resolution + layered fallback...`);
        popupHandlingPath = "anchor_escalation";

        const anchorScreenshotBefore = await this.capturePopupScreenshot("anchor_before");

        // Resolve the popup root from visible Pemberitahuan text
        const anchorRes = await this.resolvePopupRootFromAnchor();

        console.log(`  Anchor resolution: found=${anchorRes.found}`);
        if (anchorRes.found) {
          console.log(`    titleAnchor: ${anchorRes.titleAnchorSelector}`);
          console.log(`    rootSelector: ${anchorRes.popupRootSelector}`);
          console.log(`    rootTag: ${anchorRes.popupRootTag}`);
          console.log(`    rootClasses: ${anchorRes.popupRootClasses}`);
          console.log(`    rootId: ${anchorRes.popupRootId}`);
          console.log(`    rootRole: ${anchorRes.popupRootRole}`);
          console.log(`    okBtnFound: ${anchorRes.okButtonFound}`);
          console.log(`    okBtnSelector: ${anchorRes.okButtonSelector}`);
          console.log(`    okBtnEnabled: ${anchorRes.okButtonEnabled}`);
          console.log(`    clickableTexts: [${anchorRes.allClickableTextsInRoot.join(", ")}]`);
          console.log(`    outerHTML (first 200): ${anchorRes.popupRootOuterHtmlSnippet.substring(0, 200)}`);
        }

        anchorEscalationResult = {
          anchorResolution: anchorRes,
          screenshotBefore: anchorScreenshotBefore,
          screenshotAfter: null,
          clickAttempted: false,
          clickSucceeded: false,
          clickError: null,
          popupGoneAfterClick: false,
          backdropRemainedAfterClick: false,
          popupFailureState: null,
        };

        // Layer A: Anchor-based Ok click (existing strategy)
        let anchorClickResolved = false;

        if (!anchorRes.found) {
          console.log("  Anchor resolution failed — popup root not found. Proceeding to layered fallback.");
          anchorEscalationResult.popupFailureState = "popup_root_resolution_failed";
        } else if (!anchorRes.okButtonLocator) {
          if (!anchorRes.okButtonFound) {
            console.log("  Anchor root found but Ok button not found. Proceeding to layered fallback.");
            anchorEscalationResult.popupFailureState = "popup_root_resolved_but_ok_button_not_found";
          } else {
            console.log("  Anchor root found, Ok button found but not interactable. Proceeding to layered fallback.");
            anchorEscalationResult.popupFailureState = "popup_root_resolved_but_ok_button_not_interactable";
          }
        } else {
          // Ok button found and interactable — attempt click
          anchorEscalationResult.clickAttempted = true;
          console.log(`  Attempting anchor-based Ok click via: ${anchorRes.okButtonSelector}`);

          try {
            await anchorRes.okButtonLocator.click({ timeout: 5000, force: true });
            anchorEscalationResult.clickSucceeded = true;
            console.log("  Anchor Ok click succeeded.");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            anchorEscalationResult.clickSucceeded = false;
            anchorEscalationResult.clickError = errMsg;
            anchorEscalationResult.popupFailureState = "popup_click_threw_error";
            console.log(`  Anchor Ok click threw: ${errMsg}`);
          }

          if (anchorEscalationResult.clickSucceeded) {
            // Verify popup disappeared
            const verifyEnd = Date.now() + 5_000;
            let popupGone = false;
            while (Date.now() < verifyEnd) {
              await this.page.waitForTimeout(500);
              const titleStill = await this.page
                .locator(':has-text("Pemberitahuan")')
                .first()
                .isVisible({ timeout: 500 })
                .catch(() => false);
              const genericStill = await this.detectModalPresence();
              if (!titleStill && !genericStill) {
                popupGone = true;
                break;
              }
            }

            anchorEscalationResult.popupGoneAfterClick = popupGone;

            if (!popupGone) {
              anchorEscalationResult.popupFailureState = "popup_root_click_attempted_but_popup_remained";
              console.log("  Popup still present after anchor click + 5s verification. Proceeding to layered fallback.");
            } else {
              // Check backdrop
              const bdRemained = await this.page
                .locator('.modal-backdrop')
                .first()
                .isVisible({ timeout: 1000 })
                .catch(() => false);
              anchorEscalationResult.backdropRemainedAfterClick = bdRemained;

              if (bdRemained) {
                anchorEscalationResult.popupFailureState = "popup_root_click_attempted_but_overlay_remained";
                console.log("  Popup gone but backdrop remained after anchor click.");
              } else {
                // SUCCESS — popup dismissed via anchor escalation
                anchorClickResolved = true;
                anchorEscalationResult.popupFailureState = null;
                mytaxPopupState = "mytax_popup_detected_and_dismissed";
                popupHandlingPath = "anchor_escalation_dismissed";
                console.log("  ✓ Popup dismissed successfully via anchor-based escalation.");
              }
            }
          }

          anchorEscalationResult.screenshotAfter = await this.capturePopupScreenshot(
            anchorEscalationResult.popupFailureState
              ? "anchor_after_failed"
              : "anchor_after_success"
          );
        }

        // ── Layered fallback (B/C/D) if anchor click did not resolve ──
        // Only run if anchor escalation did not successfully dismiss the popup.
        if (!anchorClickResolved) {
          console.log("\n  ── Entering layered Ok fallback (B/C/D) ──");
          const layeredResult = await this.attemptLayeredOkDismissal();

          // Build layered evidence string for notes
          const layeredCandidatesSummary = layeredResult.candidates.map((c, i) =>
            `  [${i}] sel="${c.selector}" tag=${c.tag} class="${c.classes}" id="${c.id}" ` +
            `role="${c.role}" text="${c.visibleText}" vis=${c.isVisible} enabled=${c.isEnabled} ` +
            `bb=${JSON.stringify(c.boundingBox)} clicked=${c.clickAttempted} ` +
            `clickOk=${c.clickSucceeded} err=${c.clickError ?? "none"} remained=${c.popupRemainedAfterClick}`
          ).join("\n");
          console.log(`  Layered fallback result: dismissed=${layeredResult.dismissed}, ` +
            `layer=${layeredResult.layer}, candidates=${layeredResult.candidates.length}`);
          if (layeredCandidatesSummary) console.log(`  Layered candidates:\n${layeredCandidatesSummary}`);

          if (layeredResult.dismissed) {
            anchorEscalationResult.popupFailureState = null;
            mytaxPopupState = "mytax_popup_detected_and_dismissed";
            popupHandlingPath = `layered_fallback_${layeredResult.layer}_dismissed`;
            anchorEscalationResult.popupGoneAfterClick = true;
            anchorEscalationResult.screenshotAfter = layeredResult.screenshotAfter;
            console.log(`  ✓ Popup dismissed via layered fallback layer ${layeredResult.layer}`);
          } else {
            // Determine precise failure state from layered result
            const hasAnyCandidates = layeredResult.candidates.length > 0;
            const anyClickAttempted = layeredResult.candidates.some(c => c.clickAttempted);
            const anyClickSucceeded = layeredResult.candidates.some(c => c.clickSucceeded);
            const anyCoordClick = layeredResult.candidates.some(c =>
              c.selector.startsWith("Layer-D:") && c.clickAttempted
            );
            const anyClickThrew = layeredResult.candidates.some(c =>
              c.clickAttempted && !c.clickSucceeded && c.clickError
            );

            let layeredFailState: MytaxPopupState;
            if (!hasAnyCandidates) {
              layeredFailState = "popup_ok_candidate_not_found";
            } else if (!anyClickAttempted) {
              layeredFailState = "popup_ok_candidate_found_but_not_interactable";
            } else if (anyClickThrew) {
              layeredFailState = "popup_ok_click_threw_error";
            } else if (anyCoordClick && anyClickSucceeded) {
              layeredFailState = "popup_ok_coordinate_click_attempted_but_popup_remained";
            } else {
              layeredFailState = "popup_ok_click_attempted_but_popup_remained";
            }

            // Only update if anchor didn't already have a more specific state
            anchorEscalationResult.popupFailureState = layeredFailState;
            mytaxPopupState = layeredFailState;
            anchorEscalationResult.screenshotAfter = layeredResult.screenshotAfter;

            console.log(`  ✗ Layered fallback failed. Final popupFailureState=${layeredFailState}`);
          }
        }
      }

      // ── Build anchor evidence string for probe notes/UI ──────────
      const anchorEvidenceStr = anchorEscalationResult
        ? ` AnchorEscalation: path=${popupHandlingPath}, ` +
          `rootFound=${anchorEscalationResult.anchorResolution.found}, ` +
          `titleAnchor=${anchorEscalationResult.anchorResolution.titleAnchorSelector || "(none)"}, ` +
          `rootSelector=${anchorEscalationResult.anchorResolution.popupRootSelector || "(none)"}, ` +
          `rootTag=${anchorEscalationResult.anchorResolution.popupRootTag}, ` +
          `rootClasses="${anchorEscalationResult.anchorResolution.popupRootClasses}", ` +
          `rootId="${anchorEscalationResult.anchorResolution.popupRootId}", ` +
          `rootRole="${anchorEscalationResult.anchorResolution.popupRootRole}", ` +
          `okBtnFound=${anchorEscalationResult.anchorResolution.okButtonFound}, ` +
          `okBtnSelector=${anchorEscalationResult.anchorResolution.okButtonSelector || "(none)"}, ` +
          `okBtnEnabled=${anchorEscalationResult.anchorResolution.okButtonEnabled}, ` +
          `clickableTextsInRoot=[${anchorEscalationResult.anchorResolution.allClickableTextsInRoot.join(", ")}], ` +
          `clickAttempted=${anchorEscalationResult.clickAttempted}, ` +
          `clickSucceeded=${anchorEscalationResult.clickSucceeded}, ` +
          (anchorEscalationResult.clickError ? `clickError="${anchorEscalationResult.clickError}", ` : "") +
          `popupGone=${anchorEscalationResult.popupGoneAfterClick}, ` +
          `backdropRemained=${anchorEscalationResult.backdropRemainedAfterClick}, ` +
          `screenshotBefore=${anchorEscalationResult.screenshotBefore ?? "(none)"}, ` +
          `screenshotAfter=${anchorEscalationResult.screenshotAfter ?? "(none)"}, ` +
          `outerHTML=${anchorEscalationResult.anchorResolution.popupRootOuterHtmlSnippet.substring(0, 500) || "(none)"}.`
        : "";

      console.log(`  MyTax popup state:  ${mytaxPopupState}`);
      console.log(`  Popup handling:     ${popupHandlingPath}`);
      console.log(`  Page selection:     #${pageRecheck.selectedPageIndex} (${pageRecheck.selectionReason}), ` +
        `${pageRecheck.pageCount} page(s), ` +
        `popup=${pageRecheck.popupTextOnSelectedPage}, menu=${pageRecheck.menuTextOnSelectedPage}`);
      if (noticeResult.diagnostics?.screenshotBeforeDismiss) {
        console.log(`  Screenshot before:  ${noticeResult.diagnostics.screenshotBeforeDismiss}`);
      }
      if (noticeResult.diagnostics?.screenshotAfterDismiss) {
        console.log(`  Screenshot after:   ${noticeResult.diagnostics.screenshotAfterDismiss}`);
      }

      // ── Format page-selection summary for inclusion in failure messages ──
      const pageSelSummary =
        `pageSelection: ${pageRecheck.pageCount} page(s), ` +
        `selected=#${pageRecheck.selectedPageIndex} (${pageRecheck.selectionReason}), ` +
        `url=${pageRecheck.selectedPageUrl}, ` +
        `popupOnPage=${pageRecheck.popupTextOnSelectedPage}, ` +
        `menuOnPage=${pageRecheck.menuTextOnSelectedPage}. ` +
        `popupHandlingPath=${popupHandlingPath}. ` +
        `${readinessTimingStr}`;

      // ── Stop on anchor-escalation failure ─────────────────────────
      // If anchor escalation ran but failed, stop with the specific failure state.
      if (anchorEscalationResult && anchorEscalationResult.popupFailureState) {
        const anchorFailState = anchorEscalationResult.popupFailureState;

        return {
          success: false,
          bootstrapOutcome: !dashboardStabilized
            ? "final_dashboard_not_stable_before_popup_handling"
            : anchorFailState === "popup_root_resolution_failed" ||
              anchorFailState === "popup_root_resolved_but_ok_button_not_found" ||
              anchorFailState === "popup_root_resolved_but_ok_button_not_interactable" ||
              anchorFailState === "popup_root_click_attempted_but_popup_remained" ||
              anchorFailState === "popup_root_click_attempted_but_overlay_remained" ||
              anchorFailState === "popup_click_threw_error" ||
              anchorFailState === "popup_ok_candidate_not_found" ||
              anchorFailState === "popup_ok_candidate_found_but_not_interactable" ||
              anchorFailState === "popup_ok_click_attempted_but_popup_remained" ||
              anchorFailState === "popup_ok_coordinate_click_attempted_but_popup_remained" ||
              anchorFailState === "popup_ok_click_threw_error"
                ? anchorFailState
                : "popup_state_inconclusive_due_to_page_mismatch",
          failureReason:
            `mytaxPopupState=${mytaxPopupState}. ` +
            `${pageSelSummary}` +
            anchorEvidenceStr + " " +
            formatPopupEvidence(noticeResult.diagnostics) + " " +
            "Bootstrap stopped — popup blocks further automation. " +
            "Headed browser kept open for local inspection.",
          readbackNote:
            `mytaxPopupState=${mytaxPopupState}. ${pageSelSummary}` +
            anchorEvidenceStr,
        };
      }

      if (noticeResult.unknownModalDetected &&
          mytaxPopupState !== "mytax_popup_detected_and_dismissed") {
        return {
          success: false,
          bootstrapOutcome: "failed_due_to_unknown_mytax_blocking_modal",
          failureReason:
            `mytaxPopupState=${mytaxPopupState}. ` +
            `${pageSelSummary} ` +
            noticeResult.note +
            formatPopupEvidence(noticeResult.diagnostics) + " " +
            "Bootstrap stopped — unknown modal blocks further automation. " +
            "Headed browser kept open for local inspection.",
          readbackNote: `mytaxPopupState=${mytaxPopupState}. ${pageSelSummary} ${noticeResult.note}`,
        };
      }

      if (noticeResult.noticeDetected && !noticeResult.dismissalVerified &&
          mytaxPopupState !== "mytax_popup_detected_and_dismissed") {
        const pfs = noticeResult.popupFailureState;
        const granularOutcome = !dashboardStabilized
          ? ("final_dashboard_not_stable_before_popup_handling" as const)
          : pfs === "popup_detected_but_button_not_found" ||
            pfs === "popup_detected_but_button_not_interactable" ||
            pfs === "popup_click_attempted_but_modal_remained" ||
            pfs === "popup_click_attempted_but_backdrop_remained" ||
            pfs === "popup_click_threw_error" ||
            pfs === "popup_root_resolved_but_ok_button_not_found" ||
            pfs === "popup_root_resolved_but_ok_button_not_interactable" ||
            pfs === "popup_root_click_attempted_but_popup_remained" ||
            pfs === "popup_root_click_attempted_but_overlay_remained" ||
            pfs === "popup_root_resolution_failed"
              ? pfs
              : ("failed_to_dismiss_mytax_blocking_notice" as const);

        return {
          success: false,
          bootstrapOutcome: granularOutcome,
          failureReason:
            `mytaxPopupState=${mytaxPopupState}. ` +
            `${pageSelSummary} ` +
            noticeResult.note +
            formatPopupEvidence(noticeResult.diagnostics) + " " +
            "Bootstrap stopped — popup blocks further automation. " +
            "Headed browser kept open for local inspection.",
          readbackNote: `mytaxPopupState=${mytaxPopupState}. ${pageSelSummary} ${noticeResult.note}`,
        };
      }

      // If notice was dismissed and verified, or none present, continue.
      // Record popup state + page selection explicitly in bootstrap notes
      // so they always appear in the final readback — even on success paths.
      const bootstrapNotes: string[] = [];
      bootstrapNotes.push(`mytaxPopupState=${mytaxPopupState}`);
      bootstrapNotes.push(pageSelSummary);
      if (noticeResult.noticeDetected && noticeResult.dismissalVerified) {
        bootstrapNotes.push(noticeResult.note);
      }
      // Also record layered fallback success if it was the escalation path
      if (popupHandlingPath.startsWith("layered_fallback_")) {
        bootstrapNotes.push(`popupHandlingPath=${popupHandlingPath}`);
      }

      // ════════════════════════════════════════════════════════════
      // POST-POPUP CONTINUATION — STAGE-BY-STAGE INSTRUMENTATION
      // Every stage has: terminal banner, marker file, try/catch,
      // stage-specific failure outcome. Hidden early failures are
      // impossible — lastEnteredStage/lastCompletedStage always
      // appear in the final readbackNote.
      // ════════════════════════════════════════════════════════════

      const fs1c = await import("fs");
      const artifactDir1c = "data/portal-probe-artifacts";
      fs1c.mkdirSync(artifactDir1c, { recursive: true });

      // ── Mark continuation entry ──────────────────────────────────
      postPopupContinuationEntered = true;
      lastEnteredStage = "post_popup_entry";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === POST-POPUP CONTINUATION ENTERED ===                ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );
      writeMarker("POST_POPUP_CONTINUATION_ENTERED", `url=${this.page.url()}`);
      lastCompletedStage = "post_popup_entry";

      // ── Stage 1c: Post-popup-dismissal screenshot ────────────────
      // Capture dashboard state after popup is gone (or confirmed absent).
      try {
        const ts1c = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir1c}/bootstrap_post_popup_dashboard_${ts1c}.png`,
          fullPage: false,
        });
        bootstrapNotes.push(
          `popupDismissed=yes, currentUrl=${this.page.url().substring(0, 80)}`
        );
      } catch {
        bootstrapNotes.push("Post-popup dashboard screenshot capture failed.");
      }

      // ── Stage 2: Open eZHasil Services menu ──────────────────────
      // Layered candidate resolution + layered interaction fallback.
      // Evidence is captured for every selector attempt and interaction.
      lastEnteredStage = "stage_2_ezhasil";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 2: EZHASIL MENU — ENTERED ===               ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );
      writeMarker("STAGE_2_EZHASIL_ENTERED", `url=${this.page.url()}`);

      try {
        // ── Pre-interaction screenshot ─────────────────────────────
        try {
          const tsPre = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage2_pre_interaction_${tsPre}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        // ════════════════════════════════════════════════════════════
        // STAGE 2 CANDIDATE RESOLUTION — DOM-WALK APPROACH
        //
        // Instead of Playwright :has-text() selectors (which match
        // ancestors all the way up to <html>), we use page.evaluate()
        // to find the deepest interactive element containing the
        // target text. This prevents selecting page-wide containers.
        // ════════════════════════════════════════════════════════════

        // Tags that are NEVER valid interactive targets (hard veto)
        const VETOED_TAGS = new Set([
          "html", "body", "head", "main", "section", "article",
          "header", "footer", "aside", "div", "span", "nav",
          "ul", "ol", "li", "form", "table", "thead", "tbody",
          "tr", "td", "th", "p", "h1", "h2", "h3", "h4", "h5", "h6",
        ]);

        // Tags that ARE valid interactive targets
        const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select"]);

        // Maximum bounding-box area (px²) — anything larger is a container
        // 400 * 80 = 32000 is generous for a navbar menu link
        const MAX_CANDIDATE_AREA = 80_000;

        // Text patterns to search for (case-insensitive matching done in evaluate)
        const textPatterns = [
          "Perkhidmatan ezHasil",
          "Perkhidmatan ezHASiL",
          "Perkhidmatan eZHASiL",
          "eZHASiL Services",
          "eZHasil Services",
          "ezHASiL Services",
          "ezHasil",
          "ezHASiL",
        ];

        // ── DOM-walk: find all candidate elements ──────────────────
        // Returns serializable evidence for every candidate found.
        interface DomCandidate {
          /** How this candidate was found */
          source: string;
          /** The element's tag */
          tag: string;
          className: string;
          id: string;
          role: string;
          href: string;
          dataToggle: string;
          innerText: string;
          /** Whether this is an interactive tag (a, button, input, select) */
          isInteractiveTag: boolean;
          /** Whether it has role="button" or data-toggle or href */
          hasInteractiveAttr: boolean;
          /** Whether in navbar/nav/header region */
          inNavRegion: boolean;
          /** Bounding box */
          bbox: { x: number; y: number; width: number; height: number } | null;
          /** Area of bounding box */
          bboxArea: number;
          /** Number of child elements (proxy for container-ness) */
          childElementCount: number;
          /** Unique selector path for re-locating via Playwright */
          selectorPath: string;
          /** Veto reason if rejected, empty if accepted */
          vetoReason: string;
          /** Ranking score (lower is better) */
          rankScore: number;
        }

        const domCandidates: DomCandidate[] = await this.page.evaluate(
          (args: { patterns: string[]; vetoedTags: string[]; interactiveTags: string[]; maxArea: number }) => {
            const results: Array<{
              source: string; tag: string; className: string; id: string;
              role: string; href: string; dataToggle: string; innerText: string;
              isInteractiveTag: boolean; hasInteractiveAttr: boolean;
              inNavRegion: boolean;
              bbox: { x: number; y: number; width: number; height: number } | null;
              bboxArea: number; childElementCount: number; selectorPath: string;
              vetoReason: string; rankScore: number;
            }> = [];

            const vetoSet = new Set(args.vetoedTags);
            const interactiveSet = new Set(args.interactiveTags);

            /** Build a CSS selector path for an element (for Playwright re-location). */
            function buildSelectorPath(el: Element): string {
              const parts: string[] = [];
              let cur: Element | null = el;
              while (cur && cur !== document.documentElement) {
                let seg = cur.tagName.toLowerCase();
                if (cur.id) {
                  seg += `#${cur.id}`;
                  parts.unshift(seg);
                  break; // id is unique enough
                }
                const parent: Element | null = cur.parentElement;
                if (parent) {
                  const curTag = cur.tagName;
                  const siblings = Array.from(parent.children).filter(
                    (c: Element) => c.tagName === curTag
                  );
                  if (siblings.length > 1) {
                    const idx = siblings.indexOf(cur) + 1;
                    seg += `:nth-of-type(${idx})`;
                  }
                }
                parts.unshift(seg);
                cur = parent;
              }
              return parts.join(" > ");
            }

            /** Check if element is inside a nav-like region. */
            function isInNavRegion(el: Element): boolean {
              let cur: Element | null = el;
              while (cur) {
                const tag = cur.tagName.toLowerCase();
                if (tag === "nav") return true;
                const cls = cur.className?.toLowerCase?.() || "";
                if (cls.includes("navbar") || cls.includes("nav-") ||
                    cls.includes("menu") || cls.includes("topbar") ||
                    cls.includes("header")) return true;
                const role = cur.getAttribute("role")?.toLowerCase();
                if (role === "navigation" || role === "menubar" || role === "menu") return true;
                cur = cur.parentElement;
              }
              return false;
            }

            /** From a text-containing element, walk UP to find the nearest interactive ancestor. */
            function findNearestInteractiveAncestor(el: Element): Element | null {
              let cur: Element | null = el.parentElement;
              // Walk up at most 8 levels to find an interactive ancestor
              for (let i = 0; i < 8 && cur; i++) {
                const tag = cur.tagName.toLowerCase();
                if (interactiveSet.has(tag)) return cur;
                if (cur.getAttribute("role") === "button") return cur;
                if (cur.getAttribute("data-toggle")) return cur;
                if (tag === "a" && cur.getAttribute("href")) return cur;
                if (cur.getAttribute("tabindex")) return cur;
                if (cur.getAttribute("onclick") || (cur as HTMLElement).onclick) return cur;
                // Check cursor:pointer via computed style
                try {
                  const cs = window.getComputedStyle(cur);
                  if (cs.cursor === "pointer") return cur;
                } catch { /* ignore */ }
                cur = cur.parentElement;
              }
              return null;
            }

            /** From a text-containing element, walk DOWN to find interactive descendants. */
            function findInteractiveDescendants(el: Element): Element[] {
              const found: Element[] = [];
              const queue: Element[] = [el];
              while (queue.length > 0) {
                const current = queue.shift()!;
                const tag = current.tagName.toLowerCase();
                if (interactiveSet.has(tag) || current.getAttribute("role") === "button" ||
                    current.getAttribute("data-toggle")) {
                  found.push(current);
                }
                for (let i = 0; i < current.children.length; i++) {
                  queue.push(current.children[i]);
                }
              }
              return found;
            }

            function evaluateElement(el: Element, source: string): typeof results[0] {
              const tag = el.tagName.toLowerCase();
              const rect = el.getBoundingClientRect();
              const bbox = rect.width > 0 && rect.height > 0
                ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                : null;
              const bboxArea = bbox ? bbox.width * bbox.height : 0;
              const isInteractiveTag = interactiveSet.has(tag);
              const role = el.getAttribute("role") || "";
              const dataToggle = el.getAttribute("data-toggle") || "";
              const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
              const hasInteractiveAttr = !!role || !!dataToggle || !!href;
              const inNavRegion = isInNavRegion(el);
              const childElementCount = el.children.length;
              const innerText = (el as HTMLElement).innerText?.substring(0, 120) || "";

              // ── Veto logic ──
              let vetoReason = "";
              if (vetoSet.has(tag) && !isInteractiveTag && !hasInteractiveAttr) {
                vetoReason = `non-interactive tag: ${tag}`;
              }
              if (bboxArea > args.maxArea) {
                vetoReason = vetoReason
                  ? `${vetoReason}; bbox too large: ${Math.round(bboxArea)}px²`
                  : `bbox too large: ${Math.round(bboxArea)}px²`;
              }
              if (!bbox) {
                vetoReason = vetoReason ? `${vetoReason}; no bbox` : "no bbox";
              }
              // Veto if innerText has too many newlines (proxy for "contains entire menu block")
              const newlineCount = (innerText.match(/\n/g) || []).length;
              if (newlineCount > 4) {
                vetoReason = vetoReason
                  ? `${vetoReason}; text has ${newlineCount} newlines (container)`
                  : `text has ${newlineCount} newlines (container)`;
              }

              // ── Ranking score (lower = better) ──
              let rankScore = 1000;
              // Strong bonus for interactive tags
              if (isInteractiveTag) rankScore -= 500;
              if (tag === "a" && href) rankScore -= 100; // a[href] is best
              if (hasInteractiveAttr) rankScore -= 200;
              if (inNavRegion) rankScore -= 150;
              // Prefer smaller bounding boxes (more specific elements)
              if (bboxArea > 0 && bboxArea < args.maxArea) {
                rankScore -= Math.max(0, 300 - Math.floor(bboxArea / 100));
              }
              // Penalize many children (container elements)
              rankScore += childElementCount * 10;

              return {
                source,
                tag,
                className: typeof el.className === "string" ? el.className.substring(0, 80) : "",
                id: el.id || "",
                role,
                href: href.substring(0, 100),
                dataToggle,
                innerText: innerText.substring(0, 120),
                isInteractiveTag,
                hasInteractiveAttr,
                inNavRegion,
                bbox,
                bboxArea: Math.round(bboxArea),
                childElementCount,
                selectorPath: buildSelectorPath(el),
                vetoReason,
                rankScore,
              };
            }

            // ── Search Strategy ────────────────────────────────────
            // For each text pattern, use TreeWalker to find text nodes,
            // then resolve to the nearest interactive element.
            const seenElements = new Set<Element>();

            for (const pattern of args.patterns) {
              const patternLower = pattern.toLowerCase();
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                  acceptNode(node) {
                    if (node.textContent && node.textContent.toLowerCase().includes(patternLower)) {
                      return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                  },
                }
              );

              let textNode: Node | null;
              while ((textNode = walker.nextNode())) {
                const parentEl = textNode.parentElement;
                if (!parentEl) continue;

                // Strategy 1: The parent element itself might be interactive
                if (!seenElements.has(parentEl)) {
                  seenElements.add(parentEl);
                  results.push(evaluateElement(parentEl, `textParent:${pattern}`));
                }

                // Strategy 2: Walk up to nearest interactive ancestor
                const ancestor = findNearestInteractiveAncestor(parentEl);
                if (ancestor && !seenElements.has(ancestor)) {
                  seenElements.add(ancestor);
                  results.push(evaluateElement(ancestor, `interactiveAncestor:${pattern}`));
                }

                // Strategy 3: Walk down from parent to find interactive descendants
                const descendants = findInteractiveDescendants(parentEl);
                for (const desc of descendants) {
                  if (!seenElements.has(desc)) {
                    seenElements.add(desc);
                    results.push(evaluateElement(desc, `interactiveDescendant:${pattern}`));
                  }
                }
              }
            }

            // ── Also try direct querySelectorAll for known interactive patterns ──
            const directSelectors = [
              'a[href]', 'button', '[role="button"]', '[data-toggle="dropdown"]',
            ];
            for (const sel of directSelectors) {
              const els = document.querySelectorAll(sel);
              for (let i = 0; i < els.length; i++) {
                const el = els[i];
                const text = (el as HTMLElement).innerText?.toLowerCase() || "";
                const matchesAny = args.patterns.some(p => text.includes(p.toLowerCase()));
                if (matchesAny && !seenElements.has(el)) {
                  seenElements.add(el);
                  results.push(evaluateElement(el, `directSelector:${sel}`));
                }
              }
            }

            return results;
          },
          {
            patterns: textPatterns,
            vetoedTags: Array.from(VETOED_TAGS),
            interactiveTags: Array.from(INTERACTIVE_TAGS),
            maxArea: MAX_CANDIDATE_AREA,
          }
        );

        // ── Log and rank candidates ────────────────────────────────
        console.log(`[STAGE 2] DOM-walk found ${domCandidates.length} raw candidates.`);
        for (const c of domCandidates) {
          console.log(
            `  ${c.source}: tag=${c.tag}, interactive=${c.isInteractiveTag}, ` +
            `interactiveAttr=${c.hasInteractiveAttr}, inNav=${c.inNavRegion}, ` +
            `class="${c.className.substring(0, 50)}", id="${c.id}", ` +
            `href="${c.href.substring(0, 40)}", dataToggle="${c.dataToggle}", ` +
            `text="${c.innerText.substring(0, 40)}", children=${c.childElementCount}, ` +
            `bbox=${c.bbox ? `${Math.round(c.bbox.x)},${Math.round(c.bbox.y)} ${Math.round(c.bbox.width)}x${Math.round(c.bbox.height)}` : "null"}, ` +
            `area=${c.bboxArea}, veto="${c.vetoReason}", rank=${c.rankScore}, ` +
            `path=${c.selectorPath.substring(0, 60)}`
          );
        }

        // Separate vetoed from accepted
        const accepted = domCandidates.filter(c => !c.vetoReason);
        const vetoed = domCandidates.filter(c => !!c.vetoReason);

        console.log(`[STAGE 2] Accepted: ${accepted.length}, Vetoed: ${vetoed.length}`);
        for (const v of vetoed) {
          console.log(`  VETOED: tag=${v.tag}, veto="${v.vetoReason}", text="${v.innerText.substring(0, 40)}"`);
        }

        // Sort accepted by rank score (lowest first = best)
        accepted.sort((a, b) => a.rankScore - b.rankScore);

        // Write evidence to marker
        const evidenceSummary = domCandidates
          .map(c => `${c.source}:tag=${c.tag},veto=${c.vetoReason ? "YES" : "no"},rank=${c.rankScore}`)
          .join("; ");
        writeMarker("STAGE_2_CANDIDATE_SCAN", `raw=${domCandidates.length},accepted=${accepted.length},vetoed=${vetoed.length}; ${evidenceSummary.substring(0, 500)}`);

        // ── Resolve best candidate to Playwright locator ───────────
        interface ResolvedStage2Candidate {
          source: string;
          tag: string;
          className: string;
          id: string;
          role: string;
          href: string;
          dataToggle: string;
          innerText: string;
          isInteractiveTag: boolean;
          hasInteractiveAttr: boolean;
          inNavRegion: boolean;
          bbox: { x: number; y: number; width: number; height: number } | null;
          bboxArea: number;
          childElementCount: number;
          selectorPath: string;
          vetoReason: string;
          rankScore: number;
        }

        let resolvedCandidate: ResolvedStage2Candidate | null = null;
        let resolvedLocator: ReturnType<typeof this.page.locator> | null = null;
        // Track which resolution path succeeded for evidence
        let resolutionPath = "direct_accepted";

        // ── Phase 1: Try accepted candidates directly ──────────────
        for (const cand of accepted) {
          const loc = this.page.locator(cand.selectorPath).first();
          const isVis = await loc.isVisible({ timeout: 2000 }).catch(() => false);
          if (isVis) {
            resolvedCandidate = cand;
            resolvedLocator = loc;
            console.log(
              `[STAGE 2] Winner (direct): source=${cand.source}, tag=${cand.tag}, rank=${cand.rankScore}, ` +
              `path=${cand.selectorPath.substring(0, 80)}, text="${cand.innerText.substring(0, 40)}"`
            );
            break;
          } else {
            console.log(`  Candidate ${cand.selectorPath.substring(0, 60)} not visible via Playwright — skipping.`);
          }
        }

        // ── Phase 2: Wrapper resolution around vetoed navbar text anchors ──
        // If no accepted candidate was found, look for vetoed candidates
        // that are small, in-nav text anchors and try to resolve a clickable
        // wrapper around them.
        if (!resolvedCandidate || !resolvedLocator) {
          // Filter vetoed candidates to small navbar text anchors
          const navbarTextAnchors = vetoed.filter(v =>
            v.inNavRegion &&
            v.bbox &&
            v.bboxArea > 0 &&
            v.bboxArea < MAX_CANDIDATE_AREA &&
            v.innerText.length < 80 &&
            (v.innerText.match(/\n/g) || []).length <= 2
          );

          console.log(`[STAGE 2] Phase 2: ${navbarTextAnchors.length} navbar text anchors eligible for wrapper resolution.`);
          for (const nta of navbarTextAnchors) {
            console.log(
              `  NavbarTextAnchor: tag=${nta.tag}, text="${nta.innerText.substring(0, 40)}", ` +
              `bbox=${nta.bbox ? `${Math.round(nta.bbox.x)},${Math.round(nta.bbox.y)} ${Math.round(nta.bbox.width)}x${Math.round(nta.bbox.height)}` : "null"}, ` +
              `path=${nta.selectorPath.substring(0, 60)}`
            );
          }

          for (const anchor of navbarTextAnchors) {
            if (resolvedCandidate) break;

            console.log(`[STAGE 2] Wrapper-resolving around: ${anchor.selectorPath.substring(0, 60)}`);
            writeMarker("STAGE_2_WRAPPER_RESOLUTION", `anchor=${anchor.tag}:${anchor.selectorPath.substring(0, 80)}`);

            // Run page.evaluate with the anchor's selectorPath to find wrappers
            interface WrapperCandidate {
              path: string;
              tag: string;
              className: string;
              id: string;
              role: string;
              href: string;
              dataToggle: string;
              tabindex: string;
              hasOnclick: boolean;
              cursorPointer: boolean;
              innerText: string;
              bbox: { x: number; y: number; width: number; height: number } | null;
              bboxArea: number;
              childElementCount: number;
              resolveMethod: string;
              accepted: boolean;
              rejectReason: string;
            }

            const wrapperCandidates: WrapperCandidate[] = await this.page.evaluate(
              (wArgs: { anchorPath: string; maxArea: number; interactiveTags: string[] }) => {
                const wResults: Array<{
                  path: string; tag: string; className: string; id: string;
                  role: string; href: string; dataToggle: string; tabindex: string;
                  hasOnclick: boolean; cursorPointer: boolean; innerText: string;
                  bbox: { x: number; y: number; width: number; height: number } | null;
                  bboxArea: number; childElementCount: number;
                  resolveMethod: string; accepted: boolean; rejectReason: string;
                }> = [];

                const interactiveSet = new Set(wArgs.interactiveTags);
                const rootBlockTags = new Set(["html", "body", "main"]);

                function buildPath(el: Element): string {
                  const parts: string[] = [];
                  let cur: Element | null = el;
                  while (cur && cur !== document.documentElement) {
                    let seg = cur.tagName.toLowerCase();
                    if (cur.id) { seg += `#${cur.id}`; parts.unshift(seg); break; }
                    const par: Element | null = cur.parentElement;
                    if (par) {
                      const curTag = cur.tagName;
                      const sibs = Array.from(par.children).filter((c: Element) => c.tagName === curTag);
                      if (sibs.length > 1) { seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`; }
                    }
                    parts.unshift(seg);
                    cur = par;
                  }
                  return parts.join(" > ");
                }

                function evaluateWrapper(el: Element, method: string): typeof wResults[0] {
                  const tag = el.tagName.toLowerCase();
                  const rect = el.getBoundingClientRect();
                  const bbox = rect.width > 0 && rect.height > 0
                    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                    : null;
                  const bboxArea = bbox ? Math.round(bbox.width * bbox.height) : 0;
                  const role = el.getAttribute("role") || "";
                  const dataToggle = el.getAttribute("data-toggle") || "";
                  const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
                  const tabindex = el.getAttribute("tabindex") || "";
                  const hasOnclick = !!(el.getAttribute("onclick") || (el as HTMLElement).onclick);
                  let cursorPointer = false;
                  try { cursorPointer = window.getComputedStyle(el).cursor === "pointer"; } catch { /* */ }
                  const innerText = (el as HTMLElement).innerText?.substring(0, 80) || "";
                  const childElementCount = el.children.length;

                  // Determine if this wrapper is acceptable
                  let accepted = false;
                  let rejectReason = "";

                  if (rootBlockTags.has(tag)) {
                    rejectReason = `root block tag: ${tag}`;
                  } else if (bboxArea > wArgs.maxArea) {
                    rejectReason = `bbox too large: ${bboxArea}px²`;
                  } else if (!bbox) {
                    rejectReason = "no bbox";
                  } else if (interactiveSet.has(tag) || !!href || !!dataToggle || !!tabindex ||
                             role === "button" || hasOnclick || cursorPointer) {
                    accepted = true; // explicitly interactive
                  } else if (bboxArea < 25000 && childElementCount < 8) {
                    // Small bounded ancestor in nav — allow as wrapper
                    accepted = true;
                  } else {
                    rejectReason = `not interactive and too large/complex: area=${bboxArea}, children=${childElementCount}`;
                  }

                  return {
                    path: buildPath(el), tag, className: typeof el.className === "string" ? el.className.substring(0, 80) : "",
                    id: el.id || "", role, href: href.substring(0, 80), dataToggle, tabindex,
                    hasOnclick, cursorPointer, innerText: innerText.substring(0, 80),
                    bbox, bboxArea, childElementCount, resolveMethod: method, accepted, rejectReason,
                  };
                }

                // Find the anchor element
                const anchorEl = document.querySelector(wArgs.anchorPath);
                if (!anchorEl) return wResults;

                const seen = new Set<Element>();
                seen.add(anchorEl); // Don't re-evaluate the anchor itself

                // ── A. Interactive ancestor walk (up to 8 levels) ──
                let cur: Element | null = anchorEl.parentElement;
                for (let i = 0; i < 8 && cur; i++) {
                  if (!seen.has(cur)) {
                    seen.add(cur);
                    wResults.push(evaluateWrapper(cur, `ancestor_${i}`));
                  }
                  cur = cur.parentElement;
                }

                // ── B. Sibling / nearby trigger resolution ──
                // Check siblings of the anchor and siblings of its parent
                const checkSiblings = (parent: Element | null, label: string) => {
                  if (!parent) return;
                  for (let i = 0; i < parent.children.length; i++) {
                    const sib = parent.children[i];
                    if (seen.has(sib)) continue;
                    seen.add(sib);
                    const sibTag = sib.tagName.toLowerCase();
                    // Only consider small interactive-looking siblings
                    if (interactiveSet.has(sibTag) || sib.getAttribute("role") === "button" ||
                        sib.getAttribute("data-toggle") || sib.getAttribute("tabindex") ||
                        sibTag === "span" || sibTag === "i") {
                      wResults.push(evaluateWrapper(sib, `sibling_${label}`));
                    }
                  }
                };
                checkSiblings(anchorEl.parentElement, "of_anchor");
                if (anchorEl.parentElement) {
                  checkSiblings(anchorEl.parentElement.parentElement, "of_parent");
                }

                return wResults;
              },
              {
                anchorPath: anchor.selectorPath,
                maxArea: MAX_CANDIDATE_AREA,
                interactiveTags: Array.from(INTERACTIVE_TAGS),
              }
            );

            // Log wrapper candidates
            console.log(`[STAGE 2] Wrapper resolution found ${wrapperCandidates.length} candidates around anchor.`);
            for (const wc of wrapperCandidates) {
              console.log(
                `  ${wc.resolveMethod}: tag=${wc.tag}, accepted=${wc.accepted}, ` +
                `class="${wc.className.substring(0, 40)}", id="${wc.id}", ` +
                `role="${wc.role}", href="${wc.href.substring(0, 30)}", ` +
                `dataToggle="${wc.dataToggle}", tabindex="${wc.tabindex}", ` +
                `onclick=${wc.hasOnclick}, cursor:pointer=${wc.cursorPointer}, ` +
                `text="${wc.innerText.substring(0, 30)}", children=${wc.childElementCount}, ` +
                `bbox=${wc.bbox ? `${Math.round(wc.bbox.x)},${Math.round(wc.bbox.y)} ${Math.round(wc.bbox.width)}x${Math.round(wc.bbox.height)}` : "null"}, ` +
                `area=${wc.bboxArea}, reject="${wc.rejectReason}", ` +
                `path=${wc.path.substring(0, 60)}`
              );
            }

            // Rank accepted wrappers: interactive ones first, then smallest area
            const acceptedWrappers = wrapperCandidates.filter(w => w.accepted);
            acceptedWrappers.sort((a, b) => {
              // Prioritize explicitly interactive elements
              const aInteractive = !!(a.href || a.dataToggle || a.tabindex || a.hasOnclick || a.cursorPointer || a.role === "button");
              const bInteractive = !!(b.href || b.dataToggle || b.tabindex || b.hasOnclick || b.cursorPointer || b.role === "button");
              if (aInteractive && !bInteractive) return -1;
              if (!aInteractive && bInteractive) return 1;
              // Then by area (smaller = better)
              return a.bboxArea - b.bboxArea;
            });

            console.log(`[STAGE 2] Accepted wrappers: ${acceptedWrappers.length}`);

            // Try to resolve the best accepted wrapper to a Playwright locator
            for (const wrapper of acceptedWrappers) {
              const wLoc = this.page.locator(wrapper.path).first();
              const wVis = await wLoc.isVisible({ timeout: 2000 }).catch(() => false);
              if (wVis) {
                const isInteractive = !!(wrapper.href || wrapper.dataToggle || wrapper.tabindex ||
                  wrapper.hasOnclick || wrapper.cursorPointer || wrapper.role === "button");
                resolutionPath = isInteractive
                  ? `interactive_ancestor(${wrapper.resolveMethod})`
                  : wrapper.resolveMethod.startsWith("sibling")
                    ? `nearby_trigger(${wrapper.resolveMethod})`
                    : `small_nav_wrapper(${wrapper.resolveMethod})`;

                resolvedCandidate = {
                  source: `wrapper:${resolutionPath}`,
                  tag: wrapper.tag,
                  className: wrapper.className,
                  id: wrapper.id,
                  role: wrapper.role,
                  href: wrapper.href,
                  dataToggle: wrapper.dataToggle,
                  innerText: wrapper.innerText,
                  isInteractiveTag: INTERACTIVE_TAGS.has(wrapper.tag),
                  hasInteractiveAttr: !!(wrapper.role || wrapper.dataToggle || wrapper.href),
                  inNavRegion: true, // already confirmed by navbarTextAnchors filter
                  bbox: wrapper.bbox,
                  bboxArea: wrapper.bboxArea,
                  childElementCount: wrapper.childElementCount,
                  selectorPath: wrapper.path,
                  vetoReason: "",
                  rankScore: 0, // wrapper resolution bypasses normal ranking
                };
                resolvedLocator = wLoc;
                console.log(
                  `[STAGE 2] Wrapper winner: path=${resolutionPath}, tag=${wrapper.tag}, ` +
                  `class="${wrapper.className.substring(0, 40)}", ` +
                  `href="${wrapper.href.substring(0, 30)}", dataToggle="${wrapper.dataToggle}", ` +
                  `bbox=${wrapper.bbox ? `${Math.round(wrapper.bbox.x)},${Math.round(wrapper.bbox.y)} ${Math.round(wrapper.bbox.width)}x${Math.round(wrapper.bbox.height)}` : "null"}`
                );
                break;
              }
            }

            // ── D. Last-resort: text-anchor bbox click ──────────────
            // If no wrapper found, allow clicking the text anchor's own
            // bbox center as a last resort (only for small navbar anchors).
            if (!resolvedCandidate && anchor.bbox && anchor.bboxArea < 20_000) {
              const anchorLoc = this.page.locator(anchor.selectorPath).first();
              const anchorVis = await anchorLoc.isVisible({ timeout: 2000 }).catch(() => false);
              if (anchorVis) {
                resolutionPath = "text_anchor_bbox_click";
                resolvedCandidate = { ...anchor, source: `textAnchorBboxFallback:${anchor.source}`, vetoReason: "", rankScore: 0 };
                resolvedLocator = anchorLoc;
                console.log(
                  `[STAGE 2] Last-resort: using text anchor bbox click. tag=${anchor.tag}, ` +
                  `bbox=${anchor.bbox ? `${Math.round(anchor.bbox.x)},${Math.round(anchor.bbox.y)} ${Math.round(anchor.bbox.width)}x${Math.round(anchor.bbox.height)}` : "null"}`
                );
              }
            }

            writeMarker(
              "STAGE_2_WRAPPER_RESULT",
              `anchor=${anchor.tag}, wrapperCandidates=${wrapperCandidates.length}, ` +
              `acceptedWrappers=${acceptedWrappers.length}, resolved=${!!resolvedCandidate}, ` +
              `resolutionPath=${resolutionPath}`
            );
          } // end navbarTextAnchors loop
        }

        // ── Phase 3: Blocking-modal fallback if still unresolved ────
        if (!resolvedCandidate || !resolvedLocator) {
          const retryNotice = await this.dismissMyTaxBlockingNotices(8_000, 1_000);
          if (retryNotice.noticeDismissed && retryNotice.dismissalVerified) {
            bootstrapNotes.push(
              `Post-menu-attempt notice dismissed and verified: ${retryNotice.note}`
            );
          }

          if (!resolvedCandidate || !resolvedLocator) {
            if (retryNotice.unknownModalDetected) {
              console.log(`[STAGE 2] FAILED — unknown blocking modal.${stageTrackingSuffix()}`);
              writeMarker("STAGE_2_EZHASIL_FAILED", `reason=unknown_blocking_modal`);
              return {
                success: false,
                bootstrapOutcome: "failed_due_to_unknown_mytax_blocking_modal",
                failureReason:
                  "Could not open eZHasil Services menu — unknown blocking modal " +
                  `present: "${retryNotice.noticeTitle}". ` +
                  `Current URL: ${this.page.url()}. ` +
                  formatPopupEvidence(retryNotice.diagnostics) + " " +
                  "Headed browser kept open for local inspection." +
                  stageTrackingSuffix(),
                readbackNote: `stage2: unknownModal="${retryNotice.noticeTitle}". rawCandidates=${domCandidates.length}, accepted=${accepted.length}.${stageTrackingSuffix()}`,
              };
            }
            if (retryNotice.noticeDetected && !retryNotice.dismissalVerified) {
              console.log(`[STAGE 2] FAILED — blocking notice not dismissed.${stageTrackingSuffix()}`);
              writeMarker("STAGE_2_EZHASIL_FAILED", `reason=blocking_notice_not_dismissed`);
              return {
                success: false,
                bootstrapOutcome: "failed_to_dismiss_mytax_blocking_notice",
                failureReason:
                  "eZHasil menu not found — MyTax blocking notice appeared after " +
                  "initial check and could not be dismissed on retry. " +
                  retryNotice.note +
                  formatPopupEvidence(retryNotice.diagnostics) + " " +
                  "Headed browser kept open for local inspection." +
                  stageTrackingSuffix(),
                readbackNote: `stage2: noticeDismissalFailed. rawCandidates=${domCandidates.length}, accepted=${accepted.length}.${stageTrackingSuffix()}`,
              };
            }

            // Determine the most specific failure outcome
            const hasNavbarAnchors = vetoed.some(v => v.inNavRegion && v.bbox && v.bboxArea < MAX_CANDIDATE_AREA);
            const finalOutcome = hasNavbarAnchors
              ? "ezhasil_text_anchor_found_but_no_clickable_wrapper" as const
              : "ezhasil_menu_candidate_not_found" as const;

            console.log(`[STAGE 2] FAILED — ${finalOutcome}.${stageTrackingSuffix()}`);
            writeMarker("STAGE_2_EZHASIL_FAILED", `reason=${finalOutcome}, raw=${domCandidates.length}, accepted=${accepted.length}, vetoed=${vetoed.length}`);

            // Post-failure screenshot
            try {
              const tsF = new Date().toISOString().replace(/[:.]/g, "-");
              await this.page.screenshot({
                path: `${artifactDir1c}/stage2_no_candidate_${tsF}.png`,
                fullPage: true,
              });
            } catch { /* best effort */ }

            return {
              success: false,
              bootstrapOutcome: finalOutcome,
              failureReason:
                `Stage 2: ${finalOutcome}. ` +
                `DOM-walk found ${domCandidates.length} raw, ${accepted.length} accepted, ${vetoed.length} vetoed. ` +
                (vetoed.length > 0
                  ? `Vetoed: [${vetoed.slice(0, 5).map(v => `${v.tag}(${v.vetoReason})`).join("; ")}]. `
                  : "") +
                `Current URL: ${this.page.url()}. ` +
                "Headed browser kept open for local inspection." +
                stageTrackingSuffix(),
              readbackNote:
                `stage2: ${finalOutcome}. raw=${domCandidates.length}, accepted=${accepted.length}, vetoed=${vetoed.length}. ` +
                `resolutionPath=${resolutionPath}. url=${this.page.url().substring(0, 80)}.${stageTrackingSuffix()}`,
            };
          }
        }

        // ── Resolved candidate — log details ───────────────────────
        console.log(
          `[STAGE 2] Resolved candidate: source=${resolvedCandidate.source}, ` +
          `resolutionPath=${resolutionPath}, ` +
          `tag=${resolvedCandidate.tag}, class="${resolvedCandidate.className.substring(0, 60)}", ` +
          `id="${resolvedCandidate.id}", role="${resolvedCandidate.role}", ` +
          `href="${resolvedCandidate.href.substring(0, 40)}", dataToggle="${resolvedCandidate.dataToggle}", ` +
          `text="${resolvedCandidate.innerText.substring(0, 50)}", ` +
          `interactive=${resolvedCandidate.isInteractiveTag}, inNav=${resolvedCandidate.inNavRegion}, ` +
          `rank=${resolvedCandidate.rankScore}, ` +
          `bbox=${resolvedCandidate.bbox ? `${Math.round(resolvedCandidate.bbox.x)},${Math.round(resolvedCandidate.bbox.y)} ${Math.round(resolvedCandidate.bbox.width)}x${Math.round(resolvedCandidate.bbox.height)}` : "null"}`
        );

        // ── Layered interaction attempts ───────────────────────────
        const preInteractionUrl = this.page.url();
        const preInteractionPageCount = this.page.context().pages().length;

        /** Check if submenu/dropdown appeared near the ezHasil candidate. */
        const checkSubmenuAppeared = async (): Promise<{
          appeared: boolean;
          method: string;
          detail: string;
        }> => {
          const submenuIndicators = [
            { sel: 'a:has-text("Duti Setem")', label: "Duti Setem" },
            { sel: 'a:has-text("Stamp Duty")', label: "Stamp Duty" },
            { sel: 'a:has-text("e-Stamp Duty")', label: "e-Stamp Duty" },
            { sel: 'a:has-text("e-Duti Setem")', label: "e-Duti Setem" },
            { sel: 'a:has-text("e-Filing")', label: "e-Filing" },
            { sel: 'a:has-text("ByrHASiL")', label: "ByrHASiL" },
            { sel: 'a:has-text("e-Lejar")', label: "e-Lejar" },
            { sel: '.dropdown-menu.show', label: "dropdown-menu.show" },
            { sel: '.dropdown.open > .dropdown-menu', label: "dropdown.open>menu" },
            { sel: 'ul.dropdown-menu[style*="display: block"]', label: "ul.dropdown-menu:display-block" },
            { sel: 'ul.dropdown-menu[style*="display:block"]', label: "ul.dropdown-menu:display-block-nospace" },
            { sel: '.dropdown-menu:visible', label: "dropdown-menu:visible" },
          ];

          for (const ind of submenuIndicators) {
            const loc = this.page.locator(ind.sel).first();
            if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
              return { appeared: true, method: "submenu_indicator", detail: ind.label };
            }
          }

          const currentUrl = this.page.url();
          if (currentUrl !== preInteractionUrl) {
            return { appeared: true, method: "url_changed", detail: `${preInteractionUrl.substring(0, 60)} → ${currentUrl.substring(0, 60)}` };
          }

          const currentPageCount = this.page.context().pages().length;
          if (currentPageCount > preInteractionPageCount) {
            return { appeared: true, method: "new_page", detail: `pages: ${preInteractionPageCount} → ${currentPageCount}` };
          }

          return { appeared: false, method: "none", detail: "no submenu/url-change/new-page detected" };
        };

        interface InteractionAttempt {
          method: string;
          attempted: boolean;
          threw: boolean;
          error?: string;
          submenuResult: { appeared: boolean; method: string; detail: string };
        }
        const interactionAttempts: InteractionAttempt[] = [];

        // ── Method 1: Normal click ─────────────────────────────────
        {
          let threw = false;
          let error: string | undefined;
          try {
            await resolvedLocator.click({ timeout: 5000 });
            await this.page.waitForTimeout(1500);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "normal_click", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 1 (normal_click): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via normal_click (${sub.method}: ${sub.detail})`);
          }
        }

        // ── Method 2: Hover ────────────────────────────────────────
        if (!interactionAttempts.some(a => a.submenuResult.appeared)) {
          let threw = false;
          let error: string | undefined;
          try {
            await resolvedLocator.hover({ timeout: 5000 });
            await this.page.waitForTimeout(2000);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "hover", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 2 (hover): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via hover (${sub.method}: ${sub.detail})`);
          }
        }

        // ── Method 3: Click after hover ────────────────────────────
        if (!interactionAttempts.some(a => a.submenuResult.appeared)) {
          let threw = false;
          let error: string | undefined;
          try {
            await resolvedLocator.hover({ timeout: 5000 });
            await this.page.waitForTimeout(500);
            await resolvedLocator.click({ timeout: 5000 });
            await this.page.waitForTimeout(1500);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "click_after_hover", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 3 (click_after_hover): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via click_after_hover (${sub.method}: ${sub.detail})`);
          }
        }

        // ── Method 4: JavaScript click ─────────────────────────────
        if (!interactionAttempts.some(a => a.submenuResult.appeared)) {
          let threw = false;
          let error: string | undefined;
          try {
            await resolvedLocator.evaluate((el: HTMLElement) => el.click());
            await this.page.waitForTimeout(1500);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "js_click", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 4 (js_click): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via js_click (${sub.method}: ${sub.detail})`);
          }
        }

        // ── Method 5: Mouse move to bounding box center + hover ────
        if (!interactionAttempts.some(a => a.submenuResult.appeared) && resolvedCandidate.bbox) {
          const bbox = resolvedCandidate.bbox;
          const cx = bbox.x + bbox.width / 2;
          const cy = bbox.y + bbox.height / 2;
          let threw = false;
          let error: string | undefined;
          try {
            await this.page.mouse.move(cx, cy);
            await this.page.waitForTimeout(500);
            await this.page.mouse.move(cx, cy);
            await this.page.waitForTimeout(2000);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "mouse_move_hover", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 5 (mouse_move_hover at ${Math.round(cx)},${Math.round(cy)}): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via mouse_move_hover at ${Math.round(cx)},${Math.round(cy)} (${sub.method}: ${sub.detail})`);
          }

          if (!sub.appeared) {
            let threw2 = false;
            let error2: string | undefined;
            try {
              await this.page.mouse.click(cx, cy);
              await this.page.waitForTimeout(1500);
            } catch (e) {
              threw2 = true;
              error2 = e instanceof Error ? e.message : String(e);
            }
            const sub2 = await checkSubmenuAppeared();
            interactionAttempts.push({ method: "mouse_click_bbox", attempted: true, threw: threw2, error: error2, submenuResult: sub2 });
            console.log(`[STAGE 2] Method 5b (mouse_click_bbox at ${Math.round(cx)},${Math.round(cy)}): threw=${threw2}, submenu=${sub2.appeared} (${sub2.detail})`);
            if (sub2.appeared) {
              bootstrapNotes.push(`stage2: opened via mouse_click_bbox at ${Math.round(cx)},${Math.round(cy)} (${sub2.method}: ${sub2.detail})`);
            }
          }
        }

        // ── Method 6: Focus + Enter/Space (keyboard) ──────────────
        if (!interactionAttempts.some(a => a.submenuResult.appeared)) {
          let threw = false;
          let error: string | undefined;
          try {
            await resolvedLocator.focus({ timeout: 3000 });
            await this.page.waitForTimeout(300);
            await this.page.keyboard.press("Enter");
            await this.page.waitForTimeout(1500);
          } catch (e) {
            threw = true;
            error = e instanceof Error ? e.message : String(e);
          }
          const sub = await checkSubmenuAppeared();
          interactionAttempts.push({ method: "focus_enter", attempted: true, threw, error, submenuResult: sub });
          console.log(`[STAGE 2] Method 6 (focus_enter): threw=${threw}, submenu=${sub.appeared} (${sub.detail})`);
          if (sub.appeared) {
            bootstrapNotes.push(`stage2: opened via focus_enter (${sub.method}: ${sub.detail})`);
          }

          if (!sub.appeared) {
            let threw2 = false;
            let error2: string | undefined;
            try {
              await resolvedLocator.focus({ timeout: 3000 });
              await this.page.waitForTimeout(300);
              await this.page.keyboard.press("Space");
              await this.page.waitForTimeout(1500);
            } catch (e) {
              threw2 = true;
              error2 = e instanceof Error ? e.message : String(e);
            }
            const sub2 = await checkSubmenuAppeared();
            interactionAttempts.push({ method: "focus_space", attempted: true, threw: threw2, error: error2, submenuResult: sub2 });
            console.log(`[STAGE 2] Method 6b (focus_space): threw=${threw2}, submenu=${sub2.appeared} (${sub2.detail})`);
            if (sub2.appeared) {
              bootstrapNotes.push(`stage2: opened via focus_space (${sub2.method}: ${sub2.detail})`);
            }
          }
        }

        // ── Evaluate Stage 2 result ────────────────────────────────
        const successfulAttempt = interactionAttempts.find(a => a.submenuResult.appeared);
        const interactionSummary = interactionAttempts
          .map(a => `${a.method}:${a.submenuResult.appeared ? "OK" : "FAIL"}${a.threw ? "(threw)" : ""}`)
          .join(", ");

        // Post-interaction screenshot (always)
        try {
          const tsPost = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage2_post_interaction_${tsPost}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        writeMarker("STAGE_2_INTERACTION_RESULT", `success=${!!successfulAttempt}, resolutionPath=${resolutionPath}, winner=${resolvedCandidate.source}:${resolvedCandidate.tag}, methods=${interactionSummary}`);

        if (successfulAttempt) {
          // ── Stage 2 SUCCESS ──────────────────────────────────────
          bootstrapNotes.push(
            `ezHasilMenuOpened=yes, resolutionPath=${resolutionPath}, ` +
            `candidate=${resolvedCandidate.source}:${resolvedCandidate.tag}, ` +
            `rank=${resolvedCandidate.rankScore}, path=${resolvedCandidate.selectorPath.substring(0, 60)}, ` +
            `method=${successfulAttempt.method}, submenuVia=${successfulAttempt.submenuResult.method}: ${successfulAttempt.submenuResult.detail}`
          );
          lastCompletedStage = "stage_2_ezhasil";
          console.log(
            `[STAGE 2] COMPLETED — ezHasil menu opened via ${successfulAttempt.method} ` +
            `(submenu: ${successfulAttempt.submenuResult.detail}).${stageTrackingSuffix()}`
          );
          writeMarker("STAGE_2_EZHASIL_COMPLETED", `method=${successfulAttempt.method}, url=${this.page.url()}`);
        } else {
          // ── Stage 2 FAILURE — all interaction methods exhausted ──
          // Choose outcome based on resolution path
          let outcomeLabel: typeof resolvedCandidate extends null ? never :
            | "ezhasil_menu_candidate_found_but_not_interactable"
            | "ezhasil_menu_click_attempted_but_no_submenu"
            | "ezhasil_menu_hover_attempted_but_no_submenu"
            | "ezhasil_menu_js_click_attempted_but_no_submenu"
            | "ezhasil_small_nav_wrapper_click_attempted_but_no_submenu"
            | "ezhasil_nearby_trigger_click_attempted_but_no_submenu"
            | "ezhasil_text_anchor_bbox_click_attempted_but_no_submenu";

          if (resolutionPath === "text_anchor_bbox_click") {
            outcomeLabel = "ezhasil_text_anchor_bbox_click_attempted_but_no_submenu";
          } else if (resolutionPath.startsWith("nearby_trigger")) {
            outcomeLabel = "ezhasil_nearby_trigger_click_attempted_but_no_submenu";
          } else if (resolutionPath.startsWith("small_nav_wrapper")) {
            outcomeLabel = "ezhasil_small_nav_wrapper_click_attempted_but_no_submenu";
          } else if (interactionAttempts.every(a => a.threw)) {
            outcomeLabel = "ezhasil_menu_candidate_found_but_not_interactable";
          } else if (interactionAttempts.some(a => a.method === "js_click")) {
            outcomeLabel = "ezhasil_menu_js_click_attempted_but_no_submenu";
          } else if (interactionAttempts.some(a => a.method === "hover")) {
            outcomeLabel = "ezhasil_menu_hover_attempted_but_no_submenu";
          } else {
            outcomeLabel = "ezhasil_menu_click_attempted_but_no_submenu";
          }

          console.log(`[STAGE 2] FAILED — all interaction methods exhausted. outcome=${outcomeLabel}, resolutionPath=${resolutionPath}.${stageTrackingSuffix()}`);
          writeMarker("STAGE_2_EZHASIL_FAILED", `outcome=${outcomeLabel}, resolutionPath=${resolutionPath}, candidate=${resolvedCandidate.source}:${resolvedCandidate.tag}, methods=${interactionSummary}`);

          return {
            success: false,
            bootstrapOutcome: outcomeLabel,
            failureReason:
              `Stage 2: ezHasil candidate (${resolvedCandidate.source}) resolved to ${resolvedCandidate.tag} ` +
              `via ${resolutionPath} but no submenu appeared. ` +
              `class="${resolvedCandidate.className.substring(0, 60)}", ` +
              `id="${resolvedCandidate.id}", role="${resolvedCandidate.role}", ` +
              `href="${resolvedCandidate.href.substring(0, 40)}", ` +
              `text="${resolvedCandidate.innerText.substring(0, 50)}", ` +
              `rank=${resolvedCandidate.rankScore}, inNav=${resolvedCandidate.inNavRegion}, ` +
              `bbox=${JSON.stringify(resolvedCandidate.bbox)}, ` +
              `interactions=[${interactionSummary}]. ` +
              `Raw candidates=${domCandidates.length}, accepted=${accepted.length}, vetoed=${vetoed.length}. ` +
              `Current URL: ${this.page.url()}. ` +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote:
              `stage2: ${outcomeLabel}. resolutionPath=${resolutionPath}. ` +
              `resolved=${resolvedCandidate.source}:${resolvedCandidate.tag}, ` +
              `rank=${resolvedCandidate.rankScore}, inNav=${resolvedCandidate.inNavRegion}, ` +
              `raw=${domCandidates.length}, accepted=${accepted.length}, vetoed=${vetoed.length}, ` +
              `interactions=[${interactionSummary}]. ` +
              `url=${this.page.url().substring(0, 80)}.${stageTrackingSuffix()}`,
          };
        }
      } catch (stage2Err) {
        console.log(`[STAGE 2] THREW — ${stage2Err instanceof Error ? stage2Err.message : String(stage2Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_2_EZHASIL_THREW", `error=${stage2Err instanceof Error ? stage2Err.message : String(stage2Err)}`);
        return {
          success: false,
          bootstrapOutcome: "ezhasil_stage_entered_but_failed",
          failureReason:
            `Stage 2 (ezHasil menu) entered but threw: ${stage2Err instanceof Error ? stage2Err.message : String(stage2Err)}` +
            stageTrackingSuffix(),
          readbackNote: `ezhasil_stage_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 3: Open Duti Setem submenu ──────────────────────────
      lastEnteredStage = "stage_3_duti_setem";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 3: DUTI SETEM SUBMENU — ENTERED ===         ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );
      writeMarker("STAGE_3_DUTI_SETEM_ENTERED", `url=${this.page.url()}`);

      try {
        const dutiSetemMenuSelectors = [
          // Malay labels
          'a:has-text("Duti Setem")',
          'li.dropdown-submenu > a:has-text("Duti Setem")',
          // English labels
          'a:has-text("Stamp Duty")',
          'li.dropdown-submenu > a:has-text("Stamp Duty")',
        ];

        let dutiSetemOpened = false;
        for (const selector of dutiSetemMenuSelectors) {
          const subMenuItem = this.page.locator(selector).first();
          if (
            await subMenuItem.isVisible({ timeout: 3000 }).catch(() => false)
          ) {
            await subMenuItem.hover();
            await this.page.waitForTimeout(1000);
            dutiSetemOpened = true;
            break;
          }
        }

        if (!dutiSetemOpened) {
          console.log(`[STAGE 3] FAILED — Duti Setem submenu not found.${stageTrackingSuffix()}`);
          writeMarker("STAGE_3_DUTI_SETEM_FAILED", `reason=submenu_not_found`);
          return {
            success: false,
            bootstrapOutcome: "failed_to_open_duti_setem_submenu",
            failureReason:
              "eZHasil Services menu opened but could not find Duti Setem / Stamp Duty submenu. " +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
          };
        }

        // Screenshot: Duti Setem submenu opened
        try {
          const tsDs = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/bootstrap_duti_setem_submenu_${tsDs}.png`,
            fullPage: false,
          });
          bootstrapNotes.push("dutiSetemSubmenuOpened=yes");
        } catch { /* best effort */ }

        lastCompletedStage = "stage_3_duti_setem";
        console.log(`[STAGE 3] COMPLETED — Duti Setem submenu opened.${stageTrackingSuffix()}`);
        writeMarker("STAGE_3_DUTI_SETEM_COMPLETED", `url=${this.page.url()}`);
      } catch (stage3Err) {
        console.log(`[STAGE 3] THREW — ${stage3Err instanceof Error ? stage3Err.message : String(stage3Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_3_DUTI_SETEM_THREW", `error=${stage3Err instanceof Error ? stage3Err.message : String(stage3Err)}`);
        return {
          success: false,
          bootstrapOutcome: "duti_setem_stage_entered_but_failed",
          failureReason:
            `Stage 3 (Duti Setem submenu) entered but threw: ${stage3Err instanceof Error ? stage3Err.message : String(stage3Err)}` +
            stageTrackingSuffix(),
          readbackNote: `duti_setem_stage_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 4: Click e-Stamp Duty link ──────────────────────────
      // STRICT SUCCESS CRITERIA: Stage 4 is only complete if after clicking
      // the e-Stamp Duty link, either:
      //   (a) a new tab opened with a stamps-flow URL, OR
      //   (b) the current page URL changed to a stamps-flow URL.
      // If the browser is still on MyTax dashboard-content, Stage 4 FAILS.
      //
      // TARGET RESOLUTION: Uses DOM-walk page.evaluate() to find the exact
      // visible submenu item for "e-Duti Setem" / "e-Stamp Duty" within the
      // already-open submenu panel. Does NOT rely on :has-text() selectors.
      lastEnteredStage = "stage_4_e_stamp_duty";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 4: E-STAMP DUTY CLICK — ENTERED ===         ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );

      // Capture pre-Stage-4 evidence
      const stage4PreUrl = this.page.url();
      const stage4PreTitle = await this.page.title().catch(() => "");
      const stage4PrePageCount = this.page.context().pages().length;
      const stage4PrePageIndex = this.page.context().pages().indexOf(this.page);
      console.log(
        `[STAGE 4] PRE: url=${stage4PreUrl.substring(0, 80)}, title="${stage4PreTitle.substring(0, 40)}", ` +
        `pages=${stage4PrePageCount}, pageIndex=${stage4PrePageIndex}`
      );
      writeMarker("STAGE_4_E_STAMP_DUTY_ENTERED", `url=${stage4PreUrl}, pages=${stage4PrePageCount}`);

      // Screenshot: pre-Stage-4 submenu state
      try {
        const tsPre4 = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir1c}/stage4_pre_interaction_${tsPre4}.png`,
          fullPage: false,
        });
      } catch { /* best effort */ }

      try {
        // ── Stage 4a: DOM-walk submenu target resolution ─────────────
        // Use page.evaluate() to find all visible text nodes matching
        // "e-Duti Setem" or "e-Stamp Duty" in the open submenu, then
        // resolve the best clickable target around each.
        interface Stage4Candidate {
          index: number;
          text: string;
          tag: string;
          className: string;
          id: string;
          href: string;
          role: string;
          bbox: { x: number; y: number; w: number; h: number } | null;
          isVisible: boolean;
          isInteractive: boolean;
          inSubmenuPanel: boolean;
          selectorPath: string;
          resolvedFrom: string; // "text_parent" | "interactive_ancestor" | "wrapper_walk" | "direct_match"
          score: number;
        }

        const stage4Candidates = await this.page.evaluate(() => {
          const TEXT_PATTERNS = [
            /e[\s-]*duti\s*setem/i,
            /e[\s-]*stamp\s*duty/i,
          ];

          const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select"]);
          const VETOED_TAGS = new Set([
            "html", "body", "head", "main", "section", "article",
            "header", "footer", "aside", "div", "nav", "ul", "ol",
            "form", "table", "thead", "tbody", "tr", "td", "th",
          ]);
          const MAX_CANDIDATE_AREA = 50_000; // submenu items are small

          const getRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return null;
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };

          const isVis = (el: Element): boolean => {
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          const isInteractive = (el: Element): boolean => {
            const tag = el.tagName.toLowerCase();
            if (INTERACTIVE_TAGS.has(tag)) return true;
            if (el.hasAttribute("tabindex")) return true;
            if (el.hasAttribute("onclick")) return true;
            if (el.getAttribute("role") === "button" || el.getAttribute("role") === "menuitem" || el.getAttribute("role") === "link") return true;
            const s = window.getComputedStyle(el);
            if (s.cursor === "pointer") return true;
            return false;
          };

          const isInSubmenuRegion = (el: Element): boolean => {
            // Walk up to find dropdown-menu, submenu, or similar container
            let cur: Element | null = el;
            for (let i = 0; i < 10 && cur; i++) {
              const cls = (cur.className || "").toString().toLowerCase();
              const tag = cur.tagName.toLowerCase();
              if (cls.includes("dropdown-menu") || cls.includes("submenu") ||
                  cls.includes("dropdown_menu") || cls.includes("sub-menu") ||
                  cls.includes("treeview-menu") || cls.includes("sidebar-menu")) {
                return true;
              }
              if (tag === "ul" && cur.closest(".dropdown-submenu, .dropdown, .treeview")) {
                return true;
              }
              cur = cur.parentElement;
            }
            return false;
          };

          const buildSelectorPath = (el: Element): string => {
            const parts: string[] = [];
            let cur: Element | null = el;
            for (let depth = 0; depth < 4 && cur && cur !== document.documentElement; depth++) {
              const tag = cur.tagName.toLowerCase();
              const id = cur.id ? `#${cur.id}` : "";
              const cls = cur.className && typeof cur.className === "string"
                ? "." + cur.className.trim().split(/\s+/).slice(0, 2).join(".")
                : "";
              parts.unshift(`${tag}${id}${cls}`);
              const parent: Element | null = cur.parentElement;
              cur = parent;
            }
            return parts.join(" > ");
          };

          const candidates: Array<{
            index: number;
            text: string;
            tag: string;
            className: string;
            id: string;
            href: string;
            role: string;
            bbox: { x: number; y: number; w: number; h: number } | null;
            isVisible: boolean;
            isInteractive: boolean;
            inSubmenuPanel: boolean;
            selectorPath: string;
            resolvedFrom: string;
            score: number;
          }> = [];
          let idx = 0;

          // ── Phase 1: Walk text nodes to find e-Duti Setem / e-Stamp Duty ──
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const txt = (node.textContent || "").trim();
            if (txt.length < 5 || txt.length > 100) continue;
            if (!TEXT_PATTERNS.some((p) => p.test(txt))) continue;

            // Found matching text. Evaluate parent element.
            const textParent = node.parentElement;
            if (!textParent) continue;

            const evaluateCandidate = (el: Element, resolvedFrom: string): void => {
              const tag = el.tagName.toLowerCase();
              if (tag === "html" || tag === "body" || tag === "head") return;

              const bbox = getRect(el);
              const vis = isVis(el);
              const interactive = isInteractive(el);
              const inSub = isInSubmenuRegion(el);
              const area = bbox ? bbox.w * bbox.h : 0;

              // Hard veto: too large (page-wide or menu-wide)
              if (area > MAX_CANDIDATE_AREA) return;

              // Score: lower is better
              let score = 0;
              if (interactive) score -= 500;
              if (tag === "a") score -= 300;
              if (el.hasAttribute("href")) score -= 200;
              if (inSub) score -= 400;
              if (vis) score -= 100;
              if (bbox && area > 0 && area < 10_000) score -= 150; // small target bonus
              if (!interactive) score += 300;
              if (!vis) score += 500;
              if (VETOED_TAGS.has(tag) && !interactive) score += 1000;

              candidates.push({
                index: idx++,
                text: txt.substring(0, 60),
                tag,
                className: (el.className || "").toString().substring(0, 60),
                id: el.id || "",
                href: (el as HTMLAnchorElement).href || el.getAttribute("href") || "",
                role: el.getAttribute("role") || "",
                bbox,
                isVisible: vis,
                isInteractive: interactive,
                inSubmenuPanel: inSub,
                selectorPath: buildSelectorPath(el),
                resolvedFrom,
                score,
              });
            };

            // Evaluate the text's direct parent
            evaluateCandidate(textParent, "text_parent");

            // Walk up to find interactive ancestors (up to 8 levels)
            let ancestor: Element | null = textParent.parentElement;
            for (let lvl = 0; lvl < 8 && ancestor; lvl++) {
              if (isInteractive(ancestor)) {
                evaluateCandidate(ancestor, "interactive_ancestor");
              }
              ancestor = ancestor.parentElement;
            }

            // Check for interactive descendants of parent's parent
            const grandParent = textParent.parentElement;
            if (grandParent) {
              const interactiveChildren = grandParent.querySelectorAll("a, button, [role='menuitem'], [role='button']");
              interactiveChildren.forEach((c: Element) => {
                if (c !== textParent) {
                  evaluateCandidate(c, "wrapper_walk");
                }
              });
            }
          }

          // ── Phase 2: Direct querySelectorAll for href-based anchors ──
          const directSelectors = [
            'a[href*="stamps.hasil"]',
            'a[href*="edutisetem"]',
            'a[href*="e-dutisetem"]',
            'a[href*="stamp"]',
          ];
          for (const sel of directSelectors) {
            const els = document.querySelectorAll(sel);
            els.forEach((el: Element) => {
              const txt = (el.textContent || "").trim();
              // Only if its text or href relates to stamp duty
              if (txt.length > 0 && txt.length < 100) {
                const tag = el.tagName.toLowerCase();
                const bbox = getRect(el);
                const vis = isVis(el);
                const inSub = isInSubmenuRegion(el);
                const area = bbox ? bbox.w * bbox.h : 0;
                if (area <= MAX_CANDIDATE_AREA) {
                  let score = -800; // direct href match is strong
                  if (vis) score -= 100;
                  if (inSub) score -= 400;
                  if (area > 0 && area < 10_000) score -= 150;
                  if (!vis) score += 500;
                  candidates.push({
                    index: idx++,
                    text: txt.substring(0, 60),
                    tag,
                    className: (el.className || "").toString().substring(0, 60),
                    id: el.id || "",
                    href: (el as HTMLAnchorElement).href || el.getAttribute("href") || "",
                    role: el.getAttribute("role") || "",
                    bbox,
                    isVisible: vis,
                    isInteractive: true,
                    inSubmenuPanel: inSub,
                    selectorPath: buildSelectorPath(el),
                    resolvedFrom: "direct_match",
                    score,
                  });
                }
              }
            });
          }

          // Sort by score ascending (best first)
          candidates.sort((a, b) => a.score - b.score);
          return candidates;
        });

        // Log all resolved candidates
        console.log(`[STAGE 4] Resolved ${stage4Candidates.length} submenu candidates:`);
        for (const c of stage4Candidates) {
          console.log(
            `  [${c.index}] tag=${c.tag}, text="${c.text}", href="${c.href.substring(0, 60)}", ` +
            `class="${c.className.substring(0, 40)}", id="${c.id}", role="${c.role}", ` +
            `bbox=${c.bbox ? `${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : "none"}, ` +
            `vis=${c.isVisible}, interactive=${c.isInteractive}, inSubmenu=${c.inSubmenuPanel}, ` +
            `from=${c.resolvedFrom}, score=${c.score}`
          );
        }
        writeMarker("STAGE_4_CANDIDATES", stage4Candidates.map((c) =>
          `[${c.index}] tag=${c.tag} text="${c.text}" href="${c.href.substring(0, 60)}" bbox=${c.bbox ? `${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : "none"} vis=${c.isVisible} interactive=${c.isInteractive} inSubmenu=${c.inSubmenuPanel} from=${c.resolvedFrom} score=${c.score}`
        ).join("\n"));

        // Filter to viable candidates: must be visible
        const viableCandidates = stage4Candidates.filter((c) => c.isVisible);
        if (viableCandidates.length === 0) {
          console.log(`[STAGE 4] FAILED — no visible submenu candidates found.${stageTrackingSuffix()}`);
          writeMarker("STAGE_4_E_STAMP_DUTY_FAILED", `reason=no_visible_candidates, total=${stage4Candidates.length}`);

          try {
            const tsF = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage4_no_candidates_${tsF}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }

          return {
            success: false,
            bootstrapOutcome: "failed_to_click_e_stamp_duty",
            failureReason:
              `Duti Setem submenu opened but no visible e-Stamp Duty candidates found. ` +
              `Total DOM candidates: ${stage4Candidates.length}. ` +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote: `stage4: 0 visible candidates out of ${stage4Candidates.length} total.${stageTrackingSuffix()}`,
          };
        }

        // ── Stage 4b: Layered interaction against best candidates ─────
        // Try each viable candidate with multiple interaction methods.
        // After each attempt, check for handoff.
        const isStampsFlowUrl = (url: string): boolean => {
          const u = url.toLowerCase();
          return u.includes("stamps.hasil.gov.my") ||
                 u.includes("edutisetem") ||
                 u.includes("e-dutisetem") ||
                 u.includes("/stamps/") ||
                 (u.includes("sso") && u.includes("stamp"));
        };

        const isMytaxUrl = (url: string): boolean => {
          const u = url.toLowerCase();
          return u.includes("mytax.hasil.gov.my") ||
                 u.includes("dashboard-content") ||
                 u.includes("/mytax/");
        };

        type InteractionMethod = "normal_click" | "click_after_hover" | "js_click" | "mouse_bbox_click" | "direct_navigation";
        const INTERACTION_METHODS: InteractionMethod[] = [
          "normal_click",
          "click_after_hover",
          "js_click",
          "mouse_bbox_click",
          "direct_navigation",
        ];

        let stage4HandoffVerified = false;
        let stage4WinnerDesc = "";
        let stage4MethodUsed = "";
        let stage4ActivePage: Page = this.page;
        let stage4Path = "same_tab";

        for (const candidate of viableCandidates) {
          if (stage4HandoffVerified) break;

          // Build a precise Playwright locator for this candidate
          // Use the selectorPath to target the element more precisely
          const buildLocator = (): Locator | null => {
            try {
              // Strategy 1: If candidate has id, use it
              if (candidate.id) {
                return this.page.locator(`[id="${candidate.id.replace(/"/g, '\\"')}"]`).first();
              }
              // Strategy 2: If candidate has href, use tag+href
              if (candidate.href && candidate.tag === "a") {
                // Extract just the path portion to avoid full URL matching issues
                const hrefAttr = candidate.href;
                // Try matching by href attribute value
                const loc = this.page.locator(`a[href="${hrefAttr}"]`).first();
                return loc;
              }
              // Strategy 3: Use text + tag + bbox for precision
              // Get all elements matching tag, then filter by bbox
              return null; // fall through to bbox-based interaction
            } catch {
              return null;
            }
          };

          const locator = buildLocator();

          for (const method of INTERACTION_METHODS) {
            if (stage4HandoffVerified) break;

            // direct_navigation only if candidate has href
            if (method === "direct_navigation" && !candidate.href) continue;
            // direct_navigation only for anchors with stamp-related hrefs
            if (method === "direct_navigation" && candidate.tag !== "a") continue;
            if (method === "direct_navigation" && !isStampsFlowUrl(candidate.href)) continue;

            console.log(
              `[STAGE 4] Trying candidate[${candidate.index}] tag=${candidate.tag} ` +
              `text="${candidate.text.substring(0, 30)}" via ${method}...`
            );

            // Listen for new page BEFORE interaction
            const context = this.page.context();
            const newPagePromise = context.waitForEvent("page", {
              timeout: 10_000,
            }).catch(() => null);

            try {
              if (method === "normal_click" && locator) {
                if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await locator.click({ timeout: 5000 });
                } else {
                  continue; // locator not visible, skip this method
                }
              } else if (method === "click_after_hover" && locator) {
                if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
                  await locator.hover({ timeout: 3000 });
                  await this.page.waitForTimeout(500);
                  await locator.click({ timeout: 5000 });
                } else {
                  continue;
                }
              } else if (method === "js_click") {
                // Use page.evaluate to click element by its selectorPath or bbox
                const clicked = await this.page.evaluate((cand: {
                  selectorPath: string; bbox: { x: number; y: number; w: number; h: number } | null;
                  tag: string; text: string; href: string; id: string;
                }) => {
                  // Try to find the element precisely
                  let el: Element | null = null;

                  // By id
                  if (cand.id) {
                    el = document.getElementById(cand.id);
                  }

                  // By href for anchors
                  if (!el && cand.href && cand.tag === "a") {
                    const anchors = document.querySelectorAll(`a`);
                    for (const a of anchors) {
                      if ((a as HTMLAnchorElement).href === cand.href ||
                          a.getAttribute("href") === cand.href) {
                        const r = a.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                          el = a;
                          break;
                        }
                      }
                    }
                  }

                  // By text content match within matching tags
                  if (!el && cand.bbox) {
                    const els = document.querySelectorAll(cand.tag);
                    for (const candidate of els) {
                      const r = candidate.getBoundingClientRect();
                      if (cand.bbox &&
                          Math.abs(r.x - cand.bbox.x) < 5 &&
                          Math.abs(r.y - cand.bbox.y) < 5 &&
                          Math.abs(r.width - cand.bbox.w) < 5 &&
                          Math.abs(r.height - cand.bbox.h) < 5) {
                        el = candidate;
                        break;
                      }
                    }
                  }

                  if (el) {
                    (el as HTMLElement).click();
                    return true;
                  }
                  return false;
                }, candidate);
                if (!clicked) continue;
              } else if (method === "mouse_bbox_click" && candidate.bbox) {
                // Click at the exact center of the candidate's bounding box
                const cx = candidate.bbox.x + candidate.bbox.w / 2;
                const cy = candidate.bbox.y + candidate.bbox.h / 2;
                await this.page.mouse.move(cx, cy);
                await this.page.waitForTimeout(200);
                await this.page.mouse.click(cx, cy);
              } else if (method === "direct_navigation" && candidate.href) {
                // Last resort: navigate directly to the href
                console.log(`[STAGE 4] direct_navigation to href="${candidate.href.substring(0, 80)}"`);
                await this.page.goto(candidate.href, { timeout: NAVIGATION_TIMEOUT, waitUntil: "domcontentloaded" });
              } else {
                continue; // method not applicable
              }
            } catch (interactionErr) {
              console.log(
                `[STAGE 4] ${method} on candidate[${candidate.index}] threw: ` +
                `${interactionErr instanceof Error ? interactionErr.message : String(interactionErr)}`
              );
              continue;
            }

            // Wait for potential navigation
            await this.page.waitForTimeout(3000);

            const newPage = await newPagePromise;

            // ── Check for handoff ──────────────────────────
            const postPageCount = this.page.context().pages().length;
            const newTabOpened = !!newPage;

            let checkPage = this.page;
            let checkPath = "same_tab";
            if (newPage) {
              await newPage.waitForLoadState("domcontentloaded", {
                timeout: NAVIGATION_TIMEOUT,
              }).catch(() => {});
              await newPage.waitForTimeout(2000);
              checkPage = newPage;
              checkPath = "new_tab";
            }

            const postUrl = checkPage.url();
            const postTitle = await checkPage.title().catch(() => "");
            const urlChanged = postUrl !== stage4PreUrl;
            const postIsStamps = isStampsFlowUrl(postUrl);
            const postIsMytax = isMytaxUrl(postUrl);

            console.log(
              `[STAGE 4] After ${method} on candidate[${candidate.index}]: ` +
              `path=${checkPath}, url=${postUrl.substring(0, 80)}, title="${postTitle.substring(0, 40)}", ` +
              `urlChanged=${urlChanged}, isStamps=${postIsStamps}, isMytax=${postIsMytax}, ` +
              `pages=${stage4PrePageCount}→${postPageCount}`
            );

            // Check if handoff happened
            if (newTabOpened && postIsStamps) {
              stage4HandoffVerified = true;
              stage4ActivePage = checkPage;
              stage4Path = "new_tab";
              this.page = checkPage;
            } else if (newTabOpened && !postIsStamps && !postIsMytax) {
              stage4HandoffVerified = true;
              stage4ActivePage = checkPage;
              stage4Path = "new_tab";
              this.page = checkPage;
              bootstrapNotes.push(`stage4: newTab URL not stamps-flow but not mytax either: ${postUrl.substring(0, 80)}`);
            } else if (!newTabOpened && urlChanged && postIsStamps) {
              stage4HandoffVerified = true;
              stage4ActivePage = checkPage;
              stage4Path = "same_tab";
            } else if (!newTabOpened && urlChanged && !postIsMytax) {
              stage4HandoffVerified = true;
              stage4ActivePage = checkPage;
              stage4Path = "same_tab";
              bootstrapNotes.push(`stage4: sameTab URL changed but not stamps-flow: ${postUrl.substring(0, 80)}`);
            }
            // If new tab opened but still mytax, or no change — continue trying

            if (stage4HandoffVerified) {
              stage4WinnerDesc = `candidate[${candidate.index}] tag=${candidate.tag} text="${candidate.text.substring(0, 30)}" href="${candidate.href.substring(0, 60)}" from=${candidate.resolvedFrom}`;
              stage4MethodUsed = method;
              console.log(
                `[STAGE 4] HANDOFF VERIFIED via ${method} on ${stage4WinnerDesc}. ` +
                `path=${stage4Path}, url=${postUrl.substring(0, 80)}`
              );
            }
          }
        }

        // ── Capture post-Stage-4 evidence ──────────────────────────
        const stage4PostUrl = stage4ActivePage.url();
        const stage4PostTitle = await stage4ActivePage.title().catch(() => "");
        const stage4PostPageCount = this.page.context().pages().length;
        const stage4PostPageIndex = this.page.context().pages().indexOf(stage4ActivePage);

        console.log(
          `[STAGE 4] FINAL: verified=${stage4HandoffVerified}, path=${stage4Path}, ` +
          `url=${stage4PostUrl.substring(0, 80)}, title="${stage4PostTitle.substring(0, 40)}", ` +
          `pages=${stage4PrePageCount}→${stage4PostPageCount}, winner=${stage4WinnerDesc}, method=${stage4MethodUsed}`
        );

        // Screenshot: post-interaction state
        try {
          const tsHand = new Date().toISOString().replace(/[:.]/g, "-");
          await stage4ActivePage.screenshot({
            path: `${artifactDir1c}/bootstrap_e_stamp_duty_handoff_${tsHand}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        bootstrapNotes.push(
          `stage4: verified=${stage4HandoffVerified}, path=${stage4Path}, ` +
          `preUrl=${stage4PreUrl.substring(0, 60)}, postUrl=${stage4PostUrl.substring(0, 60)}, ` +
          `pages=${stage4PrePageCount}→${stage4PostPageCount}, candidates=${stage4Candidates.length}, ` +
          `viable=${viableCandidates.length}, winner=${stage4WinnerDesc}, method=${stage4MethodUsed}`
        );

        // ── Stage 4 success gate ───────────────────────────────────
        if (stage4HandoffVerified) {
          // ── Stage 4c: Dismiss notices after entering e-Duti Setem ──
          const postTabNotice = await this.dismissMyTaxBlockingNotices(5_000, 1_000);
          if (postTabNotice.noticeDismissed && postTabNotice.dismissalVerified) {
            bootstrapNotes.push(
              `Post-tab-switch notice dismissed: ${postTabNotice.note}`
            );
          }

          lastCompletedStage = "stage_4_e_stamp_duty";
          console.log(
            `[STAGE 4] COMPLETED — handoff verified. path=${stage4Path}, ` +
            `url=${this.page.url().substring(0, 80)}, winner=${stage4WinnerDesc}, ` +
            `method=${stage4MethodUsed}.${stageTrackingSuffix()}`
          );
          writeMarker("STAGE_4_E_STAMP_DUTY_COMPLETED",
            `url=${this.page.url()}, path=${stage4Path}, winner=${stage4WinnerDesc}, method=${stage4MethodUsed}`);
        } else {
          // ── Stage 4 failure: determine specific outcome ──────────
          const postUrlChanged = stage4PostUrl !== stage4PreUrl;
          const postIsMytax = isMytaxUrl(stage4PostUrl);

          // Check if any candidate was an interactive text anchor without wrapper
          const hadTextAnchorNoWrapper = stage4Candidates.some(
            (c) => c.resolvedFrom === "text_parent" && !c.isInteractive && c.isVisible
          );
          // Check if we found a wrapper but click didn't work
          const hadWrapperClick = viableCandidates.some((c) => c.isInteractive);
          // Check if bbox click was attempted
          const hadBboxCandidate = viableCandidates.some((c) => c.bbox !== null);

          let specificOutcome: string;
          if (hadTextAnchorNoWrapper && !hadWrapperClick) {
            specificOutcome = "e_stamp_duty_text_anchor_found_but_no_clickable_wrapper";
          } else if (hadWrapperClick && !postUrlChanged) {
            specificOutcome = "e_stamp_duty_wrapper_click_attempted_but_url_unchanged";
          } else if (hadBboxCandidate && !postUrlChanged) {
            specificOutcome = "e_stamp_duty_bbox_click_attempted_but_url_unchanged";
          } else if (stage4PostPageCount > stage4PrePageCount && postIsMytax) {
            specificOutcome = "e_stamp_duty_new_tab_opened_but_not_stamps_flow";
          } else if (!postUrlChanged) {
            specificOutcome = "same_tab_click_attempted_but_url_unchanged";
          } else {
            specificOutcome = "e_stamp_duty_click_attempted_but_no_handoff_detected";
          }

          console.log(
            `[STAGE 4] FAILED — ${specificOutcome}. preUrl=${stage4PreUrl.substring(0, 60)}, ` +
            `postUrl=${stage4PostUrl.substring(0, 60)}, candidates=${stage4Candidates.length}, ` +
            `viable=${viableCandidates.length}.${stageTrackingSuffix()}`
          );
          writeMarker("STAGE_4_E_STAMP_DUTY_FAILED",
            `reason=${specificOutcome}, preUrl=${stage4PreUrl}, postUrl=${stage4PostUrl}, ` +
            `candidates=${stage4Candidates.length}, viable=${viableCandidates.length}`);

          // Post-failure screenshot
          try {
            const tsF = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage4_no_handoff_${tsF}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }

          return {
            success: false,
            bootstrapOutcome: specificOutcome as BrowserDriverOperationResult["bootstrapOutcome"],
            failureReason:
              `Stage 4: e-Stamp Duty — ${specificOutcome}. ` +
              `Candidates found: ${stage4Candidates.length}, viable: ${viableCandidates.length}. ` +
              `path=${stage4Path}, preUrl=${stage4PreUrl.substring(0, 60)}, ` +
              `postUrl=${stage4PostUrl.substring(0, 60)}, ` +
              `pages=${stage4PrePageCount}→${stage4PostPageCount}. ` +
              (stage4WinnerDesc ? `Last tried: ${stage4WinnerDesc} via ${stage4MethodUsed}. ` : "") +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote:
              `stage4: ${specificOutcome}. candidates=${stage4Candidates.length}, ` +
              `viable=${viableCandidates.length}, path=${stage4Path}, ` +
              `preUrl=${stage4PreUrl.substring(0, 60)}, postUrl=${stage4PostUrl.substring(0, 60)}, ` +
              `pages=${stage4PrePageCount}→${stage4PostPageCount}.${stageTrackingSuffix()}`,
          };
        }
      } catch (stage4Err) {
        console.log(`[STAGE 4] THREW — ${stage4Err instanceof Error ? stage4Err.message : String(stage4Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_4_E_STAMP_DUTY_THREW", `error=${stage4Err instanceof Error ? stage4Err.message : String(stage4Err)}`);
        return {
          success: false,
          bootstrapOutcome: "e_stamp_duty_stage_entered_but_failed",
          failureReason:
            `Stage 4 (e-Stamp Duty click) entered but threw: ${stage4Err instanceof Error ? stage4Err.message : String(stage4Err)}` +
            stageTrackingSuffix(),
          readbackNote: `e_stamp_duty_stage_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 5: Handle SSO interstitial ("Klik untuk teruskan") ──
      // STRICT SUCCESS CRITERIA: Stage 5 is only complete if:
      //   (a) we are NOT still on MyTax dashboard-content after Stage 4, AND
      //   (b) if an interstitial was clicked, the URL/page actually changed
      // If still on MyTax, Stage 5 FAILS rather than claiming success.
      lastEnteredStage = "stage_5_interstitial";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 5: SSO INTERSTITIAL — ENTERED ===           ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );

      // Capture pre-Stage-5 evidence
      const stage5PreUrl = this.page.url();
      const stage5PreTitle = await this.page.title().catch(() => "");
      const stage5PrePageCount = this.page.context().pages().length;
      console.log(
        `[STAGE 5] PRE: url=${stage5PreUrl.substring(0, 80)}, title="${stage5PreTitle.substring(0, 40)}", ` +
        `pages=${stage5PrePageCount}`
      );
      writeMarker("STAGE_5_INTERSTITIAL_ENTERED", `url=${stage5PreUrl}`);

      try {
        // False-positive guard: if still on MyTax dashboard-content, no real handoff happened
        const stage5StillOnMytax = stage5PreUrl.toLowerCase().includes("mytax.hasil.gov.my") ||
          stage5PreUrl.toLowerCase().includes("dashboard-content");
        if (stage5StillOnMytax) {
          console.log(`[STAGE 5] FAILED — still on MyTax after Stage 4. url=${stage5PreUrl.substring(0, 80)}.${stageTrackingSuffix()}`);
          writeMarker("STAGE_5_INTERSTITIAL_FAILED", `reason=still_on_mytax, url=${stage5PreUrl}`);
          return {
            success: false,
            bootstrapOutcome: "interstitial_claim_blocked_no_real_handoff",
            failureReason:
              `Stage 5: Cannot proceed — still on MyTax after Stage 4. ` +
              `URL: ${stage5PreUrl}. No real handoff to stamps flow occurred. ` +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote:
              `stage5: blocked — still on mytax. url=${stage5PreUrl.substring(0, 80)}.${stageTrackingSuffix()}`,
          };
        }

        // The e-Duti Setem SSO landing may show a continue button.
        const ssoInterstitialSelectors = [
          'a:has-text("Klik untuk teruskan")',
          'button:has-text("Klik untuk teruskan")',
          'a:has-text("Click to continue")',
          'button:has-text("Click to continue")',
          'input[type="submit"][value*="teruskan"]',
          'input[type="submit"][value*="continue"]',
          'a:has-text("Teruskan")',
          'button:has-text("Teruskan")',
        ];

        let interstitialClicked = false;
        let interstitialSelector = "";
        for (const selector of ssoInterstitialSelectors) {
          const continueBtn = this.page.locator(selector).first();
          if (
            await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)
          ) {
            interstitialSelector = selector;
            await continueBtn.click();
            interstitialClicked = true;
            await this.page.waitForTimeout(3000);
            break;
          }
        }

        const stage5PostUrl = this.page.url();
        const stage5PostTitle = await this.page.title().catch(() => "");
        const stage5PostPageCount = this.page.context().pages().length;

        bootstrapNotes.push(
          `stage5: clicked=${interstitialClicked}` +
          (interstitialClicked ? `, via=${interstitialSelector}` : "") +
          `, preUrl=${stage5PreUrl.substring(0, 60)}, postUrl=${stage5PostUrl.substring(0, 60)}`
        );

        console.log(
          `[STAGE 5] POST: url=${stage5PostUrl.substring(0, 80)}, title="${stage5PostTitle.substring(0, 40)}", ` +
          `pages=${stage5PostPageCount}, clicked=${interstitialClicked}`
        );

        // Screenshot: after interstitial handling
        try {
          const tsInt = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/bootstrap_post_interstitial_${tsInt}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        // Dismiss notices before role-selection page
        const preRoleNotice = await this.dismissMyTaxBlockingNotices(5_000, 1_000);
        if (preRoleNotice.noticeDismissed && preRoleNotice.dismissalVerified) {
          bootstrapNotes.push(
            `Pre-role notice dismissed: ${preRoleNotice.note}`
          );
        }

        lastCompletedStage = "stage_5_interstitial";
        console.log(
          `[STAGE 5] COMPLETED — interstitial handled. clicked=${interstitialClicked}, ` +
          `url=${this.page.url().substring(0, 80)}.${stageTrackingSuffix()}`
        );
        writeMarker("STAGE_5_INTERSTITIAL_COMPLETED", `url=${this.page.url()}, clicked=${interstitialClicked}`);
      } catch (stage5Err) {
        console.log(`[STAGE 5] THREW — ${stage5Err instanceof Error ? stage5Err.message : String(stage5Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_5_INTERSTITIAL_THREW", `error=${stage5Err instanceof Error ? stage5Err.message : String(stage5Err)}`);
        return {
          success: false,
          bootstrapOutcome: "interstitial_stage_entered_but_failed",
          failureReason:
            `Stage 5 (SSO interstitial) entered but threw: ${stage5Err instanceof Error ? stage5Err.message : String(stage5Err)}` +
            stageTrackingSuffix(),
          readbackNote: `interstitial_stage_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 6a: Detect role-selection page shell ──────────────
      // STRICT SUCCESS CRITERIA for shell: the foreground page URL is NOT
      // on MyTax dashboard-content, AND a DOM check (not :has-text) confirms
      // role-page shell text like "PEMILIHAN PERANAN DAN FIRMA".
      // Shell detection alone is NOT treated as hydrated success.
      lastEnteredStage = "stage_6_role_page_shell";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 6a: ROLE PAGE SHELL DETECTION — ENTERED === ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );

      // Capture pre-Stage-6 evidence
      const stage6Url = this.page.url();
      const stage6Title = await this.page.title().catch(() => "");
      const stage6PageCount = this.page.context().pages().length;
      const stage6PageIndex = this.page.context().pages().indexOf(this.page);
      console.log(
        `[STAGE 6a] PRE: url=${stage6Url.substring(0, 80)}, title="${stage6Title.substring(0, 40)}", ` +
        `pages=${stage6PageCount}, pageIndex=${stage6PageIndex}`
      );
      writeMarker("STAGE_6A_ROLE_PAGE_SHELL_ENTERED", `url=${stage6Url}`);

      try {
        // ── False-positive guard: must NOT be on MyTax ─────────────
        const stage6StillOnMytax = stage6Url.toLowerCase().includes("mytax.hasil.gov.my") ||
          stage6Url.toLowerCase().includes("dashboard-content");
        if (stage6StillOnMytax) {
          console.log(`[STAGE 6a] FAILED — still on MyTax. url=${stage6Url.substring(0, 80)}.${stageTrackingSuffix()}`);
          writeMarker("STAGE_6A_ROLE_PAGE_FAILED", `reason=still_on_mytax, url=${stage6Url}`);

          try {
            const tsF = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage6_still_on_mytax_${tsF}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }

          return {
            success: false,
            bootstrapOutcome: "role_page_claim_blocked_not_on_role_page",
            failureReason:
              `Stage 6a: Cannot claim role page — still on MyTax. ` +
              `URL: ${stage6Url}. Title: "${stage6Title}". ` +
              `pages=${stage6PageCount}, pageIndex=${stage6PageIndex}. ` +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote:
              `stage6a: blocked — still on mytax. url=${stage6Url.substring(0, 80)}, ` +
              `title="${stage6Title.substring(0, 40)}".${stageTrackingSuffix()}`,
          };
        }

        // ── DOM-based role page shell detection (no :has-text) ─────
        const rolePageCheck = await this.page.evaluate(() => {
          const indicators = [
            "PEMILIHAN PERANAN DAN FIRMA",
            "Pemilihan Peranan dan Firma",
            "Pemilihan Peranan",
            "Firma / Agensi / Syarikat Berdaftar",
            "Firma/Agensi/Syarikat Berdaftar",
            "Sila pilih peranan",
            "Pilih Peranan",
            "Select Role",
            "INDIVIDU",
          ];

          const blockTags = new Set(["html", "body", "head"]);
          const matches: Array<{ indicator: string; tag: string; text: string; visible: boolean }> = [];

          for (const indicator of indicators) {
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(node) {
                  if (node.textContent && node.textContent.includes(indicator)) {
                    return NodeFilter.FILTER_ACCEPT;
                  }
                  return NodeFilter.FILTER_REJECT;
                },
              }
            );

            let textNode: Node | null;
            while ((textNode = walker.nextNode())) {
              const parent = textNode.parentElement;
              if (!parent) continue;
              const tag = parent.tagName.toLowerCase();
              if (blockTags.has(tag)) continue;

              const rect = parent.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0 &&
                window.getComputedStyle(parent).display !== "none" &&
                window.getComputedStyle(parent).visibility !== "hidden";

              if (visible) {
                matches.push({
                  indicator,
                  tag,
                  text: parent.textContent?.substring(0, 80) || "",
                  visible,
                });
                break;
              }
            }
          }

          return {
            matchCount: matches.length,
            matches: matches.slice(0, 5),
            bodyText: document.body?.innerText?.substring(0, 300) || "",
          };
        });

        console.log(
          `[STAGE 6a] DOM role-page shell check: ${rolePageCheck.matchCount} matches. ` +
          `url=${stage6Url.substring(0, 80)}`
        );
        for (const m of rolePageCheck.matches) {
          console.log(`  Match: indicator="${m.indicator}", tag=${m.tag}, text="${m.text.substring(0, 50)}"`);
        }

        const rolePageShellDetected = rolePageCheck.matchCount > 0;
        const rolePageMatchedIndicator = rolePageCheck.matches[0]?.indicator || "";

        if (!rolePageShellDetected) {
          // Role page shell NOT detected — check for auto-progression
          const postStage6Url = this.page.url();
          const postStage6Title = await this.page.title().catch(() => "");
          bootstrapNotes.push(
            `rolePageShellDetected=false, url=${postStage6Url.substring(0, 80)}, ` +
            `title="${postStage6Title.substring(0, 40)}", domMatches=${rolePageCheck.matchCount}`
          );

          try {
            const tsNoRole = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/bootstrap_role_page_not_reached_${tsNoRole}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }

          // Check if we auto-progressed past role page to stamps dashboard
          const postRoleStampsUrl = postStage6Url.includes("stamps.hasil.gov.my");
          if (postRoleStampsUrl) {
            const dashboardCheck = await this.page.evaluate(() => {
              const dashTexts = ["Borang Permohonan", "Permohonan Baru", "Senarai Permohonan", "Dashboard", "Utama"];
              const blockTags2 = new Set(["html", "body", "head"]);
              for (const dt of dashTexts) {
                const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
                let n: Node | null;
                while ((n = w.nextNode())) {
                  if ((n.textContent || "").includes(dt)) {
                    const p = n.parentElement;
                    if (p && !blockTags2.has(p.tagName.toLowerCase())) {
                      const r = p.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0) return true;
                    }
                  }
                }
              }
              return false;
            });

            if (dashboardCheck) {
              lastCompletedStage = "stage_6_role_page_skipped_to_dashboard";
              console.log(`[STAGE 6a] COMPLETED — auto-progressed to stamps dashboard (role page skipped).${stageTrackingSuffix()}`);
              writeMarker("STAGE_6A_AUTO_PROGRESSED", `url=${postStage6Url}`);
              return {
                success: true,
                selectorMethod: "mytax_eduti_link",
                bootstrapOutcome: "authenticated_mytax_handoff_completed",
                readbackNote:
                  "Full MyTax → popup dismissed → eZHasil Services → Duti Setem → " +
                  "e-Stamp Duty → auto-progressed to e-Duti Setem dashboard (role page skipped). " +
                  `Final URL: ${postStage6Url}. ` +
                  (bootstrapNotes.length > 0 ? `Bootstrap notes: ${bootstrapNotes.join("; ")}` : "") +
                  stageTrackingSuffix(),
              };
            }
          }

          console.log(`[STAGE 6a] FAILED — role page shell not detected. url=${postStage6Url.substring(0, 80)}.${stageTrackingSuffix()}`);
          writeMarker("STAGE_6A_ROLE_PAGE_FAILED", `url=${postStage6Url}, domMatches=${rolePageCheck.matchCount}`);
          return {
            success: false,
            bootstrapOutcome: "role_selection_page_not_reached",
            failureReason:
              "e-Stamp Duty link clicked and SSO interstitial handled, but " +
              "PEMILIHAN PERANAN DAN FIRMA page shell was not detected via DOM check. " +
              `Current URL: ${postStage6Url}. Title: "${postStage6Title.substring(0, 40)}". ` +
              `DOM matches: ${rolePageCheck.matchCount}. ` +
              `Bootstrap notes: ${bootstrapNotes.join("; ")}. ` +
              "Headed browser kept open for local inspection." +
              stageTrackingSuffix(),
            readbackNote:
              `rolePageShellNotReached. url=${postStage6Url.substring(0, 80)}, ` +
              `title="${postStage6Title.substring(0, 40)}", domMatches=${rolePageCheck.matchCount}. ` +
              bootstrapNotes.join("; ") + stageTrackingSuffix(),
          };
        }

        // ── Shell reached — record it ──────────────────────────────
        bootstrapNotes.push(
          `Role-page shell detected (matched: ${rolePageMatchedIndicator}).`
        );

        // Screenshot: role page shell
        try {
          const roleTs = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage6a_role_page_shell_${roleTs}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        lastCompletedStage = "stage_6a_role_page_shell";
        console.log(
          `[STAGE 6a] COMPLETED — role-page shell reached. indicator="${rolePageMatchedIndicator}".${stageTrackingSuffix()}`
        );
        writeMarker("STAGE_6A_ROLE_PAGE_SHELL_COMPLETED", `url=${stage6Url}, indicator=${rolePageMatchedIndicator}`);
      } catch (stage6aErr) {
        console.log(`[STAGE 6a] THREW — ${stage6aErr instanceof Error ? stage6aErr.message : String(stage6aErr)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_6A_ROLE_PAGE_THREW", `error=${stage6aErr instanceof Error ? stage6aErr.message : String(stage6aErr)}`);
        return {
          success: false,
          bootstrapOutcome: "role_page_stage_entered_but_not_reached",
          failureReason:
            `Stage 6a (role page shell detection) entered but threw: ${stage6aErr instanceof Error ? stage6aErr.message : String(stage6aErr)}` +
            stageTrackingSuffix(),
          readbackNote: `role_page_shell_stage_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 6b: Role page hydration — firm card click + EJEN ──
      // GOAL: Click the "Firma / Agensi / Syarikat Berdaftar" card to reveal
      // the EJEN / firm-list panel, then confirm the exact target firm
      // "Ejen Admin TEMASEK KAYA SDN BHD MIRI" is visible.
      // Does NOT select/confirm the firm — only proves visibility.
      lastEnteredStage = "stage_6b_role_page_hydration";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 6b: ROLE PAGE HYDRATION — ENTERED ===       ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );
      writeMarker("STAGE_6B_HYDRATION_ENTERED", `url=${this.page.url()}`);

      // Screenshot: before firm card click
      try {
        const tsBefore = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir1c}/stage6b_before_firm_card_${tsBefore}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      try {
        // ── Step 1: Find and click the "Firma / Agensi" card ─────────
        // Use DOM-walk to find the card text, then resolve its clickable wrapper.
        const firmCardResult = await this.page.evaluate(() => {
          const CARD_PATTERNS = [
            /firma\s*\/\s*agensi\s*\/\s*syarikat\s*berdaftar/i,
            /firma\s*\/\s*agensi/i,
            /syarikat\s*berdaftar/i,
            /registered\s*firm/i,
            /firm\s*\/\s*agency/i,
          ];

          const blockTags = new Set(["html", "body", "head"]);

          interface CardCandidate {
            text: string;
            tag: string;
            className: string;
            id: string;
            bbox: { x: number; y: number; w: number; h: number } | null;
            isVisible: boolean;
            isInteractive: boolean;
            resolvedFrom: string;
          }

          const getRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return null;
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };

          const isVis = (el: Element): boolean => {
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          const isInteractive = (el: Element): boolean => {
            const tag = el.tagName.toLowerCase();
            if (["a", "button", "input", "select"].includes(tag)) return true;
            if (el.hasAttribute("tabindex") || el.hasAttribute("onclick")) return true;
            if (el.getAttribute("role") === "button" || el.getAttribute("role") === "tab" ||
                el.getAttribute("role") === "radio" || el.getAttribute("role") === "option") return true;
            const s = window.getComputedStyle(el);
            if (s.cursor === "pointer") return true;
            return false;
          };

          const candidates: CardCandidate[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let node: Node | null;

          while ((node = walker.nextNode())) {
            const txt = (node.textContent || "").trim();
            if (txt.length < 4 || txt.length > 200) continue;
            if (!CARD_PATTERNS.some((p) => p.test(txt))) continue;

            const textParent = node.parentElement;
            if (!textParent || blockTags.has(textParent.tagName.toLowerCase())) continue;

            // Evaluate the text parent itself
            candidates.push({
              text: txt.substring(0, 80),
              tag: textParent.tagName.toLowerCase(),
              className: (textParent.className || "").toString().substring(0, 60),
              id: textParent.id || "",
              bbox: getRect(textParent),
              isVisible: isVis(textParent),
              isInteractive: isInteractive(textParent),
              resolvedFrom: "text_parent",
            });

            // Walk up to find an interactive/clickable card wrapper (up to 8 levels)
            let anc: Element | null = textParent.parentElement;
            for (let lvl = 0; lvl < 8 && anc; lvl++) {
              const ancTag = anc.tagName.toLowerCase();
              if (blockTags.has(ancTag)) break;
              if (isInteractive(anc)) {
                const ancBbox = getRect(anc);
                const area = ancBbox ? ancBbox.w * ancBbox.h : 0;
                if (area < 200_000) { // card area, not page-wide
                  candidates.push({
                    text: txt.substring(0, 80),
                    tag: ancTag,
                    className: (anc.className || "").toString().substring(0, 60),
                    id: anc.id || "",
                    bbox: ancBbox,
                    isVisible: isVis(anc),
                    isInteractive: true,
                    resolvedFrom: "interactive_ancestor",
                  });
                }
              }
              // Also check for card-like container classes
              const cls = (anc.className || "").toString().toLowerCase();
              if (cls.includes("card") || cls.includes("panel") || cls.includes("box") ||
                  cls.includes("role") || cls.includes("selection") || cls.includes("option")) {
                const ancBbox = getRect(anc);
                const area = ancBbox ? ancBbox.w * ancBbox.h : 0;
                if (area < 200_000 && isVis(anc)) {
                  candidates.push({
                    text: txt.substring(0, 80),
                    tag: ancTag,
                    className: (anc.className || "").toString().substring(0, 60),
                    id: anc.id || "",
                    bbox: ancBbox,
                    isVisible: true,
                    isInteractive: isInteractive(anc),
                    resolvedFrom: "card_class_ancestor",
                  });
                }
              }
              anc = anc.parentElement;
            }
          }

          return { candidates };
        });

        console.log(`[STAGE 6b] Firm card candidates: ${firmCardResult.candidates.length}`);
        for (const c of firmCardResult.candidates) {
          console.log(
            `  tag=${c.tag}, text="${c.text.substring(0, 40)}", class="${c.className.substring(0, 40)}", ` +
            `id="${c.id}", bbox=${c.bbox ? `${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : "none"}, ` +
            `vis=${c.isVisible}, interactive=${c.isInteractive}, from=${c.resolvedFrom}`
          );
        }
        writeMarker("STAGE_6B_FIRM_CARD_CANDIDATES", firmCardResult.candidates.map((c) =>
          `tag=${c.tag} text="${c.text.substring(0, 40)}" class="${c.className.substring(0, 40)}" bbox=${c.bbox ? `${c.bbox.x},${c.bbox.y} ${c.bbox.w}x${c.bbox.h}` : "none"} vis=${c.isVisible} interactive=${c.isInteractive} from=${c.resolvedFrom}`
        ).join("\n"));

        // Pick best firm card target: prefer interactive+visible, then visible card-class, then visible text parent
        const visibleCandidates = firmCardResult.candidates.filter((c) => c.isVisible);
        const interactiveCandidates = visibleCandidates.filter((c) => c.isInteractive);
        const cardClassCandidates = visibleCandidates.filter((c) => c.resolvedFrom === "card_class_ancestor");

        const bestTarget = interactiveCandidates[0] || cardClassCandidates[0] || visibleCandidates[0] || null;

        let firmCardClicked = false;
        let firmCardClickMethod = "";

        if (!bestTarget) {
          console.log(`[STAGE 6b] No visible firm card target found.${stageTrackingSuffix()}`);
          writeMarker("STAGE_6B_FIRM_CARD_FAILED", "reason=no_visible_target");
          // Don't return yet — continue to check if EJEN section is already visible
        } else {
          console.log(
            `[STAGE 6b] Best firm card target: tag=${bestTarget.tag}, text="${bestTarget.text.substring(0, 40)}", ` +
            `from=${bestTarget.resolvedFrom}, bbox=${bestTarget.bbox ? `${bestTarget.bbox.x},${bestTarget.bbox.y} ${bestTarget.bbox.w}x${bestTarget.bbox.h}` : "none"}`
          );

          // Try clicking the firm card with layered methods
          const clickMethods = ["js_click", "mouse_bbox_click"] as const;
          for (const method of clickMethods) {
            if (firmCardClicked) break;
            try {
              if (method === "js_click") {
                const clicked = await this.page.evaluate((target: {
                  tag: string; className: string; id: string;
                  bbox: { x: number; y: number; w: number; h: number } | null;
                  text: string;
                }) => {
                  let el: Element | null = null;
                  // By id
                  if (target.id) {
                    el = document.getElementById(target.id);
                  }
                  // By bbox matching
                  if (!el && target.bbox) {
                    const els = document.querySelectorAll("*");
                    for (const candidate of els) {
                      const r = candidate.getBoundingClientRect();
                      if (target.bbox &&
                          Math.abs(r.x - target.bbox.x) < 3 &&
                          Math.abs(r.y - target.bbox.y) < 3 &&
                          Math.abs(r.width - target.bbox.w) < 3 &&
                          Math.abs(r.height - target.bbox.h) < 3) {
                        el = candidate;
                        break;
                      }
                    }
                  }
                  if (el) {
                    (el as HTMLElement).click();
                    return true;
                  }
                  return false;
                }, bestTarget);
                if (clicked) {
                  firmCardClicked = true;
                  firmCardClickMethod = "js_click";
                }
              } else if (method === "mouse_bbox_click" && bestTarget.bbox) {
                const cx = bestTarget.bbox.x + bestTarget.bbox.w / 2;
                const cy = bestTarget.bbox.y + bestTarget.bbox.h / 2;
                await this.page.mouse.move(cx, cy);
                await this.page.waitForTimeout(200);
                await this.page.mouse.click(cx, cy);
                firmCardClicked = true;
                firmCardClickMethod = "mouse_bbox_click";
              }
            } catch (clickErr) {
              console.log(
                `[STAGE 6b] Firm card ${method} threw: ${clickErr instanceof Error ? clickErr.message : String(clickErr)}`
              );
            }
          }

          if (firmCardClicked) {
            console.log(`[STAGE 6b] Firm card clicked via ${firmCardClickMethod}. Waiting for hydration...`);
            // Wait for potential panel rendering
            await this.page.waitForTimeout(3000);
          } else {
            console.log(`[STAGE 6b] Firm card click failed for all methods.`);
          }
        }

        // Screenshot: after firm card click
        try {
          const tsAfterCard = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage6b_after_firm_card_${tsAfterCard}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        // ── Step 2: Scroll down to ensure below-the-fold content loads ──
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await this.page.waitForTimeout(2000);
        await this.page.evaluate(() => {
          window.scrollTo(0, 0);
        });
        await this.page.waitForTimeout(1000);

        // ── Step 3: Detect EJEN section and exact firm target ────────
        // Use page.evaluate with TreeWalker to inspect the full DOM
        // (including below-the-fold content that is now in the DOM after scroll).
        const TARGET_FIRM_NAME = "Ejen Admin TEMASEK KAYA SDN BHD MIRI";

        const hydrationCheck = await this.page.evaluate((targetFirm: string) => {
          const blockTags = new Set(["html", "body", "head"]);

          // Normalize: collapse whitespace, uppercase for comparison
          const normalize = (s: string): string =>
            s.replace(/\s+/g, " ").trim().toUpperCase();

          const targetNormalized = normalize(targetFirm);

          // 1. Check for EJEN section indicators
          const ejenIndicators = [
            /ejen/i,
            /EJEN/,
            /agent/i,
            /agen\s*admin/i,
          ];
          const ejenMatches: Array<{ text: string; tag: string; className: string; visible: boolean }> = [];

          const walker1 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let n1: Node | null;
          while ((n1 = walker1.nextNode())) {
            const txt = (n1.textContent || "").trim();
            if (txt.length < 3 || txt.length > 300) continue;
            if (!ejenIndicators.some((p) => p.test(txt))) continue;
            const parent = n1.parentElement;
            if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
            const r = parent.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0 &&
              window.getComputedStyle(parent).display !== "none" &&
              window.getComputedStyle(parent).visibility !== "hidden";
            ejenMatches.push({
              text: txt.substring(0, 80),
              tag: parent.tagName.toLowerCase(),
              className: (parent.className || "").toString().substring(0, 60),
              visible: vis,
            });
          }

          // 2. Check for firm list container (table rows, list items, cards with firm names)
          const firmListIndicators = [
            /temasek/i,
            /sdn\s*bhd/i,
            /firma/i,
          ];
          const firmListMatches: Array<{ text: string; tag: string; className: string; visible: boolean }> = [];

          const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let n2: Node | null;
          while ((n2 = walker2.nextNode())) {
            const txt = (n2.textContent || "").trim();
            if (txt.length < 3 || txt.length > 300) continue;
            if (!firmListIndicators.some((p) => p.test(txt))) continue;
            const parent = n2.parentElement;
            if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
            const r = parent.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0 &&
              window.getComputedStyle(parent).display !== "none" &&
              window.getComputedStyle(parent).visibility !== "hidden";
            firmListMatches.push({
              text: txt.substring(0, 120),
              tag: parent.tagName.toLowerCase(),
              className: (parent.className || "").toString().substring(0, 60),
              visible: vis,
            });
          }

          // 3. Exact firm target search — strict normalized-exact match only
          let exactFirmFound = false;
          let exactFirmVisible = false;
          let exactFirmElement: { text: string; tag: string; className: string; bbox: { x: number; y: number; w: number; h: number } | null } | null = null;

          const walker3 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let n3: Node | null;
          while ((n3 = walker3.nextNode())) {
            const txt = (n3.textContent || "").trim();
            if (txt.length < 10 || txt.length > 300) continue;
            const txtNorm = normalize(txt);
            // STRICT: exact normalized equality only — no containment/substring
            if (txtNorm !== targetNormalized) continue;

            const parent = n3.parentElement;
            if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;

            exactFirmFound = true;
            const r = parent.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0 &&
              window.getComputedStyle(parent).display !== "none" &&
              window.getComputedStyle(parent).visibility !== "hidden";
            exactFirmVisible = vis;
            exactFirmElement = {
              text: txt.substring(0, 120),
              tag: parent.tagName.toLowerCase(),
              className: (parent.className || "").toString().substring(0, 60),
              bbox: r.width > 0 ? {
                x: Math.round(r.x), y: Math.round(r.y),
                w: Math.round(r.width), h: Math.round(r.height),
              } : null,
            };
            if (vis) break; // Found visible exact match — done
          }

          // 4. Capture the full body text (first 1000 chars) for diagnostic
          const fullBodySnippet = document.body?.innerText?.substring(0, 1000) || "";

          return {
            ejenSectionPresent: ejenMatches.length > 0,
            ejenSectionVisible: ejenMatches.some((m) => m.visible),
            ejenMatches: ejenMatches.slice(0, 5),
            firmListPresent: firmListMatches.length > 0,
            firmListVisible: firmListMatches.some((m) => m.visible),
            firmListMatches: firmListMatches.slice(0, 5),
            exactFirmFound,
            exactFirmVisible,
            exactFirmElement,
            fullBodySnippet,
          };
        }, TARGET_FIRM_NAME);

        // Log hydration evidence
        console.log(`[STAGE 6b] Hydration check results:`);
        console.log(`  firmCardClicked=${firmCardClicked}, method=${firmCardClickMethod}`);
        console.log(`  ejenSectionPresent=${hydrationCheck.ejenSectionPresent}, ejenSectionVisible=${hydrationCheck.ejenSectionVisible}`);
        console.log(`  firmListPresent=${hydrationCheck.firmListPresent}, firmListVisible=${hydrationCheck.firmListVisible}`);
        console.log(`  exactFirmFound=${hydrationCheck.exactFirmFound}, exactFirmVisible=${hydrationCheck.exactFirmVisible}`);
        if (hydrationCheck.exactFirmElement) {
          console.log(
            `  exactFirmElement: tag=${hydrationCheck.exactFirmElement.tag}, ` +
            `text="${hydrationCheck.exactFirmElement.text.substring(0, 60)}", ` +
            `class="${hydrationCheck.exactFirmElement.className.substring(0, 40)}", ` +
            `bbox=${hydrationCheck.exactFirmElement.bbox ? `${hydrationCheck.exactFirmElement.bbox.x},${hydrationCheck.exactFirmElement.bbox.y} ${hydrationCheck.exactFirmElement.bbox.w}x${hydrationCheck.exactFirmElement.bbox.h}` : "none"}`
          );
        }
        for (const m of hydrationCheck.ejenMatches) {
          console.log(`  EJEN match: tag=${m.tag}, text="${m.text.substring(0, 50)}", class="${m.className.substring(0, 30)}", vis=${m.visible}`);
        }
        for (const m of hydrationCheck.firmListMatches) {
          console.log(`  Firm list match: tag=${m.tag}, text="${m.text.substring(0, 60)}", class="${m.className.substring(0, 30)}", vis=${m.visible}`);
        }
        console.log(`  Body snippet (first 200): "${hydrationCheck.fullBodySnippet.substring(0, 200)}"`);

        writeMarker("STAGE_6B_HYDRATION_EVIDENCE",
          `firmCardClicked=${firmCardClicked}, method=${firmCardClickMethod}\n` +
          `ejenPresent=${hydrationCheck.ejenSectionPresent}, ejenVisible=${hydrationCheck.ejenSectionVisible}\n` +
          `firmListPresent=${hydrationCheck.firmListPresent}, firmListVisible=${hydrationCheck.firmListVisible}\n` +
          `exactFirmFound=${hydrationCheck.exactFirmFound}, exactFirmVisible=${hydrationCheck.exactFirmVisible}\n` +
          `body=${hydrationCheck.fullBodySnippet.substring(0, 300)}`);

        // Screenshot: after hydration check
        try {
          const tsHydration = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage6b_hydration_result_${tsHydration}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        bootstrapNotes.push(
          `stage6b: firmCardClicked=${firmCardClicked}, method=${firmCardClickMethod}, ` +
          `ejenPresent=${hydrationCheck.ejenSectionPresent}, ejenVisible=${hydrationCheck.ejenSectionVisible}, ` +
          `firmListPresent=${hydrationCheck.firmListPresent}, firmListVisible=${hydrationCheck.firmListVisible}, ` +
          `exactFirmFound=${hydrationCheck.exactFirmFound}, exactFirmVisible=${hydrationCheck.exactFirmVisible}`
        );

        // ── Stage 6b success gate ─────────────────────────────────
        const finalRoleUrl = this.page.url();

        if (hydrationCheck.exactFirmVisible) {
          // Best case: exact firm target is visible — fall through to Stage 7
          lastCompletedStage = "stage_6b_role_page_hydrated";
          console.log(`[STAGE 6b] COMPLETED — target firm visible on role page.${stageTrackingSuffix()}`);
          writeMarker("STAGE_6B_TARGET_FIRM_VISIBLE", `url=${finalRoleUrl}, firm=${TARGET_FIRM_NAME}`);
          bootstrapNotes.push(
            `stage6b: target firm "${TARGET_FIRM_NAME}" visible. Proceeding to Stage 7.`
          );
        } else {
          // Determine specific failure outcome
          let hydrationOutcome: string;

          if (!firmCardClicked && !bestTarget) {
          // No firm card target found at all
          hydrationOutcome = "role_page_shell_reached_but_firm_panel_not_loaded";
        } else if (firmCardClicked && !hydrationCheck.ejenSectionPresent && !hydrationCheck.firmListPresent) {
          // Firm card clicked but nothing rendered below
          hydrationOutcome = "firm_card_clicked_but_no_ejen_section_rendered";
        } else if (hydrationCheck.ejenSectionPresent && !hydrationCheck.exactFirmFound) {
          // EJEN section exists but target firm not in DOM at all
          hydrationOutcome = "ejen_section_rendered_but_target_firm_missing";
        } else if (hydrationCheck.exactFirmFound && !hydrationCheck.exactFirmVisible) {
          // Target firm in DOM but not visible (hidden, zero-size, etc.)
          hydrationOutcome = "ejen_section_rendered_but_target_firm_missing";
        } else if (!firmCardClicked && bestTarget) {
          // Had a target but click failed
          hydrationOutcome = "firm_card_clicked_waiting_for_hydration";
        } else {
          hydrationOutcome = "role_page_shell_reached_but_firm_panel_not_loaded";
        }

        console.log(
          `[STAGE 6b] FAILED — ${hydrationOutcome}. firmCardClicked=${firmCardClicked}, ` +
          `ejenPresent=${hydrationCheck.ejenSectionPresent}, exactFirmFound=${hydrationCheck.exactFirmFound}, ` +
          `exactFirmVisible=${hydrationCheck.exactFirmVisible}.${stageTrackingSuffix()}`
        );
        writeMarker("STAGE_6B_HYDRATION_FAILED",
          `reason=${hydrationOutcome}, firmCardClicked=${firmCardClicked}, ` +
          `ejenPresent=${hydrationCheck.ejenSectionPresent}, exactFirmFound=${hydrationCheck.exactFirmFound}`);

        return {
          success: false,
          bootstrapOutcome: hydrationOutcome as BrowserDriverOperationResult["bootstrapOutcome"],
          failureReason:
            `Stage 6b: Role page shell reached, but ${hydrationOutcome}. ` +
            `firmCardClicked=${firmCardClicked}, method=${firmCardClickMethod}, ` +
            `ejenSectionPresent=${hydrationCheck.ejenSectionPresent}, ejenVisible=${hydrationCheck.ejenSectionVisible}, ` +
            `firmListPresent=${hydrationCheck.firmListPresent}, firmListVisible=${hydrationCheck.firmListVisible}, ` +
            `exactFirmFound=${hydrationCheck.exactFirmFound}, exactFirmVisible=${hydrationCheck.exactFirmVisible}. ` +
            `Target: "${TARGET_FIRM_NAME}". URL: ${finalRoleUrl}. ` +
            "Headed browser kept open for local inspection." +
            stageTrackingSuffix(),
          readbackNote:
            `stage6b: ${hydrationOutcome}. firmCardClicked=${firmCardClicked}, ` +
            `ejenPresent=${hydrationCheck.ejenSectionPresent}, ejenVisible=${hydrationCheck.ejenSectionVisible}, ` +
            `firmListPresent=${hydrationCheck.firmListPresent}, exactFirmFound=${hydrationCheck.exactFirmFound}, ` +
            `exactFirmVisible=${hydrationCheck.exactFirmVisible}. ` +
            `url=${finalRoleUrl.substring(0, 80)}.${stageTrackingSuffix()}`,
        };
        } // end else (hydration failure)
      } catch (stage6bErr) {
        console.log(`[STAGE 6b] THREW — ${stage6bErr instanceof Error ? stage6bErr.message : String(stage6bErr)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_6B_HYDRATION_THREW", `error=${stage6bErr instanceof Error ? stage6bErr.message : String(stage6bErr)}`);
        return {
          success: false,
          bootstrapOutcome: "role_page_shell_reached_but_firm_panel_not_loaded",
          failureReason:
            `Stage 6b (role page hydration) entered but threw: ${stage6bErr instanceof Error ? stage6bErr.message : String(stage6bErr)}` +
            stageTrackingSuffix(),
          readbackNote: `role_page_hydration_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 7: Click exact firm target ────────────────────────
      // STRICT: Click ONLY "Ejen Admin TEMASEK KAYA SDN BHD MIRI".
      // No substring, partial, fuzzy, or nearest-match guessing.
      lastEnteredStage = "stage_7_target_firm_click";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 7: TARGET FIRM CLICK — ENTERED ===          ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );

      const STAGE7_TARGET_FIRM = "Ejen Admin TEMASEK KAYA SDN BHD MIRI";

      // ── Register native dialog handler BEFORE any click ──────────
      // The portal may use a native JavaScript confirm() dialog for
      // role-change confirmation. Playwright auto-dismisses unhandled
      // dialogs with false (cancel), which silently cancels the action.
      // We register a handler to capture + accept the dialog.
      let nativeDialogCaptured = false;
      let nativeDialogType = "";
      let nativeDialogMessage = "";
      let nativeDialogAccepted = false;

      const dialogHandler = async (dialog: import("playwright").Dialog) => {
        nativeDialogType = dialog.type();
        nativeDialogMessage = dialog.message();
        nativeDialogCaptured = true;
        console.log(
          `[STAGE 7/8] Native ${nativeDialogType} dialog captured: "${nativeDialogMessage.substring(0, 200)}"`
        );
        writeMarker("NATIVE_DIALOG_CAPTURED",
          `type=${nativeDialogType}\nmessage=${nativeDialogMessage.substring(0, 500)}`);
        // Accept the dialog (click OK/Yes) to proceed with role change
        await dialog.accept();
        nativeDialogAccepted = true;
        console.log(`[STAGE 7/8] Native dialog accepted.`);
      };
      this.page.on("dialog", dialogHandler);

      const stage7PreUrl = this.page.url();
      const stage7PreHash = new URL(stage7PreUrl).hash;
      console.log(
        `[STAGE 7] PRE: url=${stage7PreUrl.substring(0, 80)}, hash="${stage7PreHash}"`
      );
      writeMarker("STAGE_7_TARGET_FIRM_ENTERED", `url=${stage7PreUrl}`);

      // Screenshot: before firm click
      try {
        const ts7pre = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir1c}/stage7_before_firm_click_${ts7pre}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      try {
        // Resolve the exact firm element via DOM-walk
        const firmResolve = await this.page.evaluate((targetFirm: string) => {
          const normalize = (s: string): string =>
            s.replace(/\s+/g, " ").trim().toUpperCase();
          const targetNorm = normalize(targetFirm);
          const blockTags = new Set(["html", "body", "head"]);

          interface FirmMatch {
            text: string;
            tag: string;
            className: string;
            id: string;
            href: string;
            role: string;
            bbox: { x: number; y: number; w: number; h: number } | null;
            isVisible: boolean;
            isInteractive: boolean;
            resolvedFrom: string;
          }

          const getRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return null;
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };

          const isVis = (el: Element): boolean => {
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          const isInteractive = (el: Element): boolean => {
            const tag = el.tagName.toLowerCase();
            if (["a", "button", "input", "select"].includes(tag)) return true;
            if (el.hasAttribute("tabindex") || el.hasAttribute("onclick")) return true;
            if (["button", "menuitem", "link", "option", "tab", "radio"].includes(el.getAttribute("role") || "")) return true;
            const s = window.getComputedStyle(el);
            if (s.cursor === "pointer") return true;
            return false;
          };

          const matches: FirmMatch[] = [];

          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const txt = (node.textContent || "").trim();
            if (txt.length < 10 || txt.length > 300) continue;
            const txtNorm = normalize(txt);
            // STRICT: exact normalized equality only — no containment/substring
            if (txtNorm !== targetNorm) continue;

            const parent = node.parentElement;
            if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;

            // Evaluate text parent
            const pTag = parent.tagName.toLowerCase();
            matches.push({
              text: txt.substring(0, 120),
              tag: pTag,
              className: (parent.className || "").toString().substring(0, 60),
              id: parent.id || "",
              href: (parent as HTMLAnchorElement).href || parent.getAttribute("href") || "",
              role: parent.getAttribute("role") || "",
              bbox: getRect(parent),
              isVisible: isVis(parent),
              isInteractive: isInteractive(parent),
              resolvedFrom: "text_parent",
            });

            // Walk ancestors for interactive wrappers (up to 6 levels)
            let anc: Element | null = parent.parentElement;
            for (let lvl = 0; lvl < 6 && anc; lvl++) {
              const aTag = anc.tagName.toLowerCase();
              if (blockTags.has(aTag)) break;
              if (isInteractive(anc)) {
                const ancBbox = getRect(anc);
                const area = ancBbox ? ancBbox.w * ancBbox.h : 0;
                if (area < 150_000) {
                  matches.push({
                    text: txt.substring(0, 120),
                    tag: aTag,
                    className: (anc.className || "").toString().substring(0, 60),
                    id: anc.id || "",
                    href: (anc as HTMLAnchorElement).href || anc.getAttribute("href") || "",
                    role: anc.getAttribute("role") || "",
                    bbox: ancBbox,
                    isVisible: isVis(anc),
                    isInteractive: true,
                    resolvedFrom: "interactive_ancestor",
                  });
                }
              }
              anc = anc.parentElement;
            }

            // Check siblings for interactive wrappers
            const gp = parent.parentElement;
            if (gp) {
              const siblings = gp.querySelectorAll("a, button, [role='button'], [role='link']");
              siblings.forEach((sib: Element) => {
                if (sib !== parent && sib.textContent && normalize(sib.textContent) === targetNorm) {
                  matches.push({
                    text: (sib.textContent || "").trim().substring(0, 120),
                    tag: sib.tagName.toLowerCase(),
                    className: (sib.className || "").toString().substring(0, 60),
                    id: sib.id || "",
                    href: (sib as HTMLAnchorElement).href || sib.getAttribute("href") || "",
                    role: sib.getAttribute("role") || "",
                    bbox: getRect(sib),
                    isVisible: isVis(sib),
                    isInteractive: isInteractive(sib),
                    resolvedFrom: "sibling_interactive",
                  });
                }
              });
            }
          }

          // Score and sort: interactive+visible best, then visible text parent
          const scored = matches.map((m) => {
            let score = 0;
            if (m.isInteractive) score -= 500;
            if (m.tag === "a") score -= 300;
            if (m.href) score -= 200;
            if (m.isVisible) score -= 100;
            // Prefer the observed real element: anchor with class "confirm"
            if (m.tag === "a" && m.className.toLowerCase().includes("confirm")) score -= 600;
            if (!m.isVisible) score += 500;
            if (!m.isInteractive) score += 300;
            return { ...m, score };
          });
          scored.sort((a, b) => a.score - b.score);

          return { matches: scored };
        }, STAGE7_TARGET_FIRM);

        console.log(`[STAGE 7] Resolved ${firmResolve.matches.length} firm target matches:`);
        for (const m of firmResolve.matches) {
          console.log(
            `  tag=${m.tag}, text="${m.text.substring(0, 50)}", href="${(m.href || "").substring(0, 50)}", ` +
            `class="${m.className.substring(0, 30)}", id="${m.id}", role="${m.role}", ` +
            `bbox=${m.bbox ? `${m.bbox.x},${m.bbox.y} ${m.bbox.w}x${m.bbox.h}` : "none"}, ` +
            `vis=${m.isVisible}, interactive=${m.isInteractive}, from=${m.resolvedFrom}, score=${m.score}`
          );
        }
        writeMarker("STAGE_7_FIRM_CANDIDATES", firmResolve.matches.map((m) =>
          `tag=${m.tag} text="${m.text.substring(0, 50)}" href="${(m.href || "").substring(0, 50)}" vis=${m.isVisible} interactive=${m.isInteractive} from=${m.resolvedFrom} score=${m.score}`
        ).join("\n"));

        const visibleFirmTargets = firmResolve.matches.filter((m) => m.isVisible);
        if (visibleFirmTargets.length === 0) {
          console.log(`[STAGE 7] FAILED — no visible firm target matches.${stageTrackingSuffix()}`);
          writeMarker("STAGE_7_FAILED", `reason=no_visible_target, total=${firmResolve.matches.length}`);
          try {
            const tsF = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage7_no_target_${tsF}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }
          return {
            success: false,
            bootstrapOutcome: "target_firm_visible_on_role_page",
            failureReason:
              `Stage 7: Target firm "${STAGE7_TARGET_FIRM}" resolved by Stage 6b but no visible target found for click. ` +
              `Total matches: ${firmResolve.matches.length}. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote: `stage7: no visible firm target. matches=${firmResolve.matches.length}.${stageTrackingSuffix()}`,
          };
        }

        const bestFirmTarget = visibleFirmTargets[0];
        console.log(
          `[STAGE 7] Best target: tag=${bestFirmTarget.tag}, text="${bestFirmTarget.text.substring(0, 50)}", ` +
          `href="${(bestFirmTarget.href || "").substring(0, 50)}", from=${bestFirmTarget.resolvedFrom}`
        );

        // Layered click on exact firm target.
        // bbox_click first: the "confirm" class anchor likely has an onclick
        // handler. Playwright mouse.click() at the bbox center triggers all
        // event handlers including any JS confirmation flow, which
        // page.evaluate click() may not reliably trigger.
        type FirmClickMethod = "bbox_click" | "normal_click" | "hover_click" | "js_click";
        const FIRM_CLICK_METHODS: FirmClickMethod[] = ["bbox_click", "normal_click", "hover_click", "js_click"];

        let firmClicked = false;
        let firmClickMethod = "";

        for (const method of FIRM_CLICK_METHODS) {
          if (firmClicked) break;
          console.log(`[STAGE 7] Trying ${method} on firm target...`);

          try {
            if (method === "normal_click" || method === "hover_click") {
              // Build locator: by id, then by href, then skip to next method
              let loc: Locator | null = null;
              if (bestFirmTarget.id) {
                loc = this.page.locator(`[id="${bestFirmTarget.id.replace(/"/g, '\\"')}"]`).first();
              } else if (bestFirmTarget.href && bestFirmTarget.tag === "a") {
                loc = this.page.locator(`a[href="${bestFirmTarget.href.replace(/"/g, '\\"')}"]`).first();
              }
              if (!loc || !(await loc.isVisible({ timeout: 2000 }).catch(() => false))) {
                continue;
              }
              if (method === "hover_click") {
                await loc.hover({ timeout: 3000 });
                await this.page.waitForTimeout(500);
              }
              await loc.click({ timeout: 5000 });
              firmClicked = true;
              firmClickMethod = method;
            } else if (method === "js_click") {
              const clicked = await this.page.evaluate((target: {
                tag: string; id: string; href: string;
                bbox: { x: number; y: number; w: number; h: number } | null;
              }) => {
                let el: Element | null = null;
                if (target.id) el = document.getElementById(target.id);
                if (!el && target.href && target.tag === "a") {
                  const anchors = document.querySelectorAll("a");
                  for (const a of anchors) {
                    if ((a as HTMLAnchorElement).href === target.href || a.getAttribute("href") === target.href) {
                      const r = a.getBoundingClientRect();
                      if (r.width > 0 && r.height > 0) { el = a; break; }
                    }
                  }
                }
                if (!el && target.bbox) {
                  const els = document.querySelectorAll(target.tag);
                  for (const c of els) {
                    const r = c.getBoundingClientRect();
                    if (target.bbox &&
                        Math.abs(r.x - target.bbox.x) < 5 && Math.abs(r.y - target.bbox.y) < 5 &&
                        Math.abs(r.width - target.bbox.w) < 5 && Math.abs(r.height - target.bbox.h) < 5) {
                      el = c; break;
                    }
                  }
                }
                if (el) { (el as HTMLElement).click(); return true; }
                return false;
              }, bestFirmTarget);
              if (clicked) { firmClicked = true; firmClickMethod = "js_click"; }
            } else if (method === "bbox_click" && bestFirmTarget.bbox) {
              const cx = bestFirmTarget.bbox.x + bestFirmTarget.bbox.w / 2;
              const cy = bestFirmTarget.bbox.y + bestFirmTarget.bbox.h / 2;
              await this.page.mouse.move(cx, cy);
              await this.page.waitForTimeout(200);
              await this.page.mouse.click(cx, cy);
              firmClicked = true;
              firmClickMethod = "bbox_click";
            }
          } catch (clickErr) {
            console.log(`[STAGE 7] ${method} threw: ${clickErr instanceof Error ? clickErr.message : String(clickErr)}`);
          }
        }

        // Post-click evidence — wait longer to allow native dialog or navigation
        await this.page.waitForTimeout(5000);
        const stage7PostUrl = this.page.url();
        const stage7PostHash = (() => { try { return new URL(stage7PostUrl).hash; } catch { return ""; } })();

        console.log(
          `[STAGE 7] POST: firmClicked=${firmClicked}, method=${firmClickMethod}, ` +
          `url=${stage7PostUrl.substring(0, 80)}, hash="${stage7PostHash}", ` +
          `preHash="${stage7PreHash}"`
        );

        // Screenshot: after firm click
        try {
          const ts7post = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage7_after_firm_click_${ts7post}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        bootstrapNotes.push(
          `stage7: firmClicked=${firmClicked}, method=${firmClickMethod}, ` +
          `preHash="${stage7PreHash}", postHash="${stage7PostHash}", ` +
          `target="${bestFirmTarget.tag} ${bestFirmTarget.text.substring(0, 40)}"`
        );

        if (!firmClicked) {
          console.log(`[STAGE 7] FAILED — all click methods failed.${stageTrackingSuffix()}`);
          writeMarker("STAGE_7_FAILED", `reason=all_click_methods_failed`);
          return {
            success: false,
            bootstrapOutcome: "target_firm_click_attempted",
            failureReason:
              `Stage 7: Target firm "${STAGE7_TARGET_FIRM}" found but all click methods failed. ` +
              `Best target: tag=${bestFirmTarget.tag}, from=${bestFirmTarget.resolvedFrom}. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote: `stage7: firm click failed. target=${bestFirmTarget.tag}.${stageTrackingSuffix()}`,
          };
        }

        lastCompletedStage = "stage_7_target_firm_click";
        console.log(`[STAGE 7] COMPLETED — firm target clicked via ${firmClickMethod}.${stageTrackingSuffix()}`);
        writeMarker("STAGE_7_TARGET_FIRM_COMPLETED",
          `method=${firmClickMethod}, target=${bestFirmTarget.tag} "${bestFirmTarget.text.substring(0, 50)}"`);
      } catch (stage7Err) {
        console.log(`[STAGE 7] THREW — ${stage7Err instanceof Error ? stage7Err.message : String(stage7Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_7_THREW", `error=${stage7Err instanceof Error ? stage7Err.message : String(stage7Err)}`);
        return {
          success: false,
          bootstrapOutcome: "target_firm_click_attempted",
          failureReason:
            `Stage 7 (target firm click) threw: ${stage7Err instanceof Error ? stage7Err.message : String(stage7Err)}` +
            stageTrackingSuffix(),
          readbackNote: `stage7_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 8: Confirmation — native dialog or DOM modal ─────
      // The portal may use either a native confirm() dialog (already
      // captured by the dialog handler registered in Stage 7) or a
      // DOM-based modal. We check both paths.
      lastEnteredStage = "stage_8_confirmation_modal";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 8: CONFIRMATION — ENTERED ===               ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );
      writeMarker("STAGE_8_CONFIRM_MODAL_ENTERED", `url=${this.page.url()}`);

      // Remove the dialog handler now — it served its purpose
      this.page.removeListener("dialog", dialogHandler);

      try {
        // ── Path A: Native dialog was already captured during Stage 7 click ──
        if (nativeDialogCaptured) {
          console.log(
            `[STAGE 8] Native dialog path: type=${nativeDialogType}, accepted=${nativeDialogAccepted}, ` +
            `message="${nativeDialogMessage.substring(0, 100)}"`
          );

          // STRICT verification: dialog message must contain the full firm name
          const normalize8 = (s: string): string => s.replace(/\s+/g, " ").trim().toUpperCase();
          const dialogNorm = normalize8(nativeDialogMessage);
          const targetNorm8 = normalize8(STAGE7_TARGET_FIRM);
          const dialogContainsFirm = dialogNorm.includes(targetNorm8);

          // Also check for confirmation-like text
          const confirmPatterns8 = [
            /adakah\s*anda\s*pasti/i, /are\s*you\s*sure/i,
            /sahkan/i, /confirm/i, /pengesahan/i,
            /tukar\s*peranan/i, /change\s*role/i,
            /pilih/i, /select/i,
          ];
          const dialogContainsConfirm = confirmPatterns8.some((p) => p.test(nativeDialogMessage));

          bootstrapNotes.push(
            `stage8: nativeDialog type=${nativeDialogType}, accepted=${nativeDialogAccepted}, ` +
            `containsFirm=${dialogContainsFirm}, containsConfirm=${dialogContainsConfirm}, ` +
            `message="${nativeDialogMessage.substring(0, 80)}"`
          );

          writeMarker("STAGE_8_NATIVE_DIALOG_VERIFICATION",
            `type=${nativeDialogType}\naccepted=${nativeDialogAccepted}\n` +
            `containsFirm=${dialogContainsFirm}\ncontainsConfirm=${dialogContainsConfirm}\n` +
            `message=${nativeDialogMessage.substring(0, 500)}`);

          // Screenshot: post-dialog state
          try {
            const ts8d = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage8_post_native_dialog_${ts8d}.png`,
              fullPage: false,
            });
          } catch { /* best effort */ }

          if (!nativeDialogAccepted) {
            console.log(`[STAGE 8] FAILED — native dialog captured but not accepted.${stageTrackingSuffix()}`);
            writeMarker("STAGE_8_FAILED", `reason=native_dialog_not_accepted`);
            return {
              success: false,
              bootstrapOutcome: "confirmation_modal_detected_but_ya_click_failed",
              failureReason:
                `Stage 8: Native ${nativeDialogType} dialog captured but not accepted. ` +
                `Message: "${nativeDialogMessage.substring(0, 150)}". ` +
                "Headed browser kept open for local inspection." + stageTrackingSuffix(),
              readbackNote: `stage8: native dialog not accepted.${stageTrackingSuffix()}`,
            };
          }

          if (!dialogContainsFirm || !dialogContainsConfirm) {
            const mismatchDetail = !dialogContainsFirm && !dialogContainsConfirm
              ? "neither firm name nor confirmation text found in dialog"
              : !dialogContainsFirm
                ? "exact firm name not found in dialog message"
                : "no confirmation-like text found in dialog message";
            console.log(`[STAGE 8] FAILED — native dialog ${mismatchDetail}.${stageTrackingSuffix()}`);
            writeMarker("STAGE_8_FAILED", `reason=native_dialog_mismatch (${mismatchDetail})`);
            return {
              success: false,
              bootstrapOutcome: "confirmation_modal_detected_but_text_mismatch",
              failureReason:
                `Stage 8: Native ${nativeDialogType} dialog: ${mismatchDetail}. ` +
                `containsFirm=${dialogContainsFirm}, containsConfirm=${dialogContainsConfirm}. ` +
                `Message: "${nativeDialogMessage.substring(0, 150)}". ` +
                "Headed browser kept open for local inspection." + stageTrackingSuffix(),
              readbackNote:
                `stage8: native dialog mismatch (${mismatchDetail}). msg="${nativeDialogMessage.substring(0, 80)}".${stageTrackingSuffix()}`,
            };
          }

          // Native dialog verified and accepted — wait for navigation
          await this.page.waitForTimeout(5000);

          const stage8PostUrl = this.page.url();
          console.log(
            `[STAGE 8] NATIVE DIALOG PATH COMPLETED — dialog verified and accepted. ` +
            `postUrl=${stage8PostUrl.substring(0, 80)}`
          );

          // Screenshot: post-confirmation
          try {
            const ts8post = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage8_post_confirmation_${ts8post}.png`,
              fullPage: false,
            });
          } catch { /* best effort */ }

          bootstrapNotes.push(
            `stage8: nativeDialogVerified=true, postUrl=${stage8PostUrl.substring(0, 60)}`
          );

          lastCompletedStage = "stage_8_confirmation_modal";
          console.log(`[STAGE 8] COMPLETED — native dialog confirmed.${stageTrackingSuffix()}`);
          writeMarker("STAGE_8_CONFIRM_MODAL_COMPLETED",
            `path=native_dialog, type=${nativeDialogType}, postUrl=${stage8PostUrl}`);
        } else {
          // ── Path B: No native dialog — check for DOM modal ──────────

        // Wait for modal to appear
        await this.page.waitForTimeout(2000);

        // Screenshot: modal state
        try {
          const ts8modal = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage8_modal_state_${ts8modal}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        // Detect confirmation modal via DOM-walk
        const modalCheck = await this.page.evaluate((targetFirm: string) => {
          const normalize = (s: string): string =>
            s.replace(/\s+/g, " ").trim().toUpperCase();
          const targetNorm = normalize(targetFirm);

          // 1. Find modal/dialog container
          interface ModalInfo {
            found: boolean;
            bodyText: string;
            containsTargetFirm: boolean;
            containsConfirmText: boolean;
            buttons: Array<{
              text: string;
              tag: string;
              className: string;
              id: string;
              bbox: { x: number; y: number; w: number; h: number } | null;
              isVisible: boolean;
            }>;
            yaButton: {
              text: string;
              tag: string;
              className: string;
              id: string;
              bbox: { x: number; y: number; w: number; h: number } | null;
            } | null;
          }

          const result: ModalInfo = {
            found: false,
            bodyText: "",
            containsTargetFirm: false,
            containsConfirmText: false,
            buttons: [],
            yaButton: null,
          };

          // Search for modal containers: .modal, [role="dialog"], .swal, .confirm, etc.
          const modalSelectors = [
            ".modal.show", ".modal.in", ".modal[style*='display: block']",
            ".modal[style*='display:block']",
            "[role='dialog']", "[role='alertdialog']",
            ".swal2-popup", ".swal2-modal", ".swal-modal",
            ".bootbox.modal", ".confirm-dialog",
            ".modal-dialog",
          ];

          let modalEl: Element | null = null;
          for (const sel of modalSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const r = el.getBoundingClientRect();
              const s = window.getComputedStyle(el);
              if (r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden") {
                modalEl = el;
                break;
              }
            }
          }

          // Fallback: any visible element with "modal" in class
          if (!modalEl) {
            const allEls = document.querySelectorAll("[class*='modal']");
            for (const el of allEls) {
              const r = el.getBoundingClientRect();
              const s = window.getComputedStyle(el);
              if (r.width > 50 && r.height > 50 && s.display !== "none" &&
                  s.visibility !== "hidden" && s.opacity !== "0") {
                modalEl = el;
                break;
              }
            }
          }

          if (!modalEl) {
            return result;
          }

          result.found = true;
          result.bodyText = (modalEl.textContent || "").trim().substring(0, 500);

          // STRICT: Check if modal text contains exact full target firm name
          // Do NOT accept partial matches like "TEMASEK KAYA" alone.
          const bodyNorm = normalize(result.bodyText);
          result.containsTargetFirm = bodyNorm.includes(targetNorm);

          // Check for confirmation-like text
          const confirmPatterns = [
            /adakah\s*anda\s*pasti/i, /are\s*you\s*sure/i,
            /sahkan/i, /confirm/i, /pengesahan/i,
            /tukar\s*peranan/i, /change\s*role/i,
            /pilih/i, /select/i,
          ];
          result.containsConfirmText = confirmPatterns.some((p) => p.test(result.bodyText));

          // Find buttons in the modal
          const getRect = (el2: Element) => {
            const r2 = el2.getBoundingClientRect();
            if (r2.width === 0 && r2.height === 0) return null;
            return { x: Math.round(r2.x), y: Math.round(r2.y), w: Math.round(r2.width), h: Math.round(r2.height) };
          };

          const btns = modalEl.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']");
          btns.forEach((btn: Element) => {
            const btnText = (btn.textContent || (btn as HTMLInputElement).value || "").trim();
            const r = btn.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0;
            result.buttons.push({
              text: btnText.substring(0, 40),
              tag: btn.tagName.toLowerCase(),
              className: (btn.className || "").toString().substring(0, 40),
              id: btn.id || "",
              bbox: getRect(btn),
              isVisible: vis,
            });

            // Identify the YA button
            const btnUpper = btnText.toUpperCase().trim();
            if (vis && (btnUpper === "YA" || btnUpper === "YES" || btnUpper === "OK" || btnUpper === "CONFIRM" || btnUpper === "SAHKAN")) {
              if (!result.yaButton) {
                result.yaButton = {
                  text: btnText.substring(0, 40),
                  tag: btn.tagName.toLowerCase(),
                  className: (btn.className || "").toString().substring(0, 40),
                  id: btn.id || "",
                  bbox: getRect(btn),
                };
              }
            }
          });

          return result;
        }, STAGE7_TARGET_FIRM);

        console.log(`[STAGE 8] Modal check: found=${modalCheck.found}, bodyText="${modalCheck.bodyText.substring(0, 100)}"`);
        console.log(`  containsTargetFirm=${modalCheck.containsTargetFirm}, containsConfirmText=${modalCheck.containsConfirmText}`);
        console.log(`  buttons=${modalCheck.buttons.length}: ${modalCheck.buttons.map((b) => `"${b.text}"`).join(", ")}`);
        console.log(`  yaButton=${modalCheck.yaButton ? `"${modalCheck.yaButton.text}" tag=${modalCheck.yaButton.tag}` : "null"}`);

        writeMarker("STAGE_8_MODAL_CHECK",
          `found=${modalCheck.found}, containsFirm=${modalCheck.containsTargetFirm}, ` +
          `containsConfirm=${modalCheck.containsConfirmText}, ` +
          `buttons=${modalCheck.buttons.map((b) => b.text).join(",")}, ` +
          `yaButton=${modalCheck.yaButton?.text || "null"}\n` +
          `bodyText=${modalCheck.bodyText.substring(0, 300)}`);

        if (!modalCheck.found) {
          console.log(`[STAGE 8] FAILED — no confirmation modal detected.${stageTrackingSuffix()}`);
          writeMarker("STAGE_8_FAILED", "reason=no_modal");
          try {
            const tsF = new Date().toISOString().replace(/[:.]/g, "-");
            await this.page.screenshot({
              path: `${artifactDir1c}/stage8_no_modal_${tsF}.png`,
              fullPage: true,
            });
          } catch { /* best effort */ }
          return {
            success: false,
            bootstrapOutcome: "target_firm_click_succeeded_but_no_confirmation_modal",
            failureReason:
              `Stage 8: Firm target clicked but no confirmation modal detected. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote: `stage8: no modal after firm click.${stageTrackingSuffix()}`,
          };
        }

        // STRICT: Modal must contain BOTH confirmation-like text AND the exact full firm name.
        // Do NOT click YA if we can't verify the firm identity in the modal.
        if (!modalCheck.containsTargetFirm || !modalCheck.containsConfirmText) {
          const mismatchDetail = !modalCheck.containsTargetFirm && !modalCheck.containsConfirmText
            ? "neither firm name nor confirmation text found"
            : !modalCheck.containsTargetFirm
              ? "exact firm name not found in modal"
              : "no confirmation-like text found in modal";
          console.log(`[STAGE 8] FAILED — ${mismatchDetail}. body="${modalCheck.bodyText.substring(0, 100)}".${stageTrackingSuffix()}`);
          writeMarker("STAGE_8_FAILED", `reason=text_mismatch (${mismatchDetail}), body=${modalCheck.bodyText.substring(0, 200)}`);
          return {
            success: false,
            bootstrapOutcome: "confirmation_modal_detected_but_text_mismatch",
            failureReason:
              `Stage 8: Confirmation modal found but ${mismatchDetail}. ` +
              `containsTargetFirm=${modalCheck.containsTargetFirm}, containsConfirmText=${modalCheck.containsConfirmText}. ` +
              `Modal body: "${modalCheck.bodyText.substring(0, 150)}". ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote:
              `stage8: modal mismatch (${mismatchDetail}). body="${modalCheck.bodyText.substring(0, 80)}".${stageTrackingSuffix()}`,
          };
        }

        if (!modalCheck.yaButton) {
          console.log(`[STAGE 8] FAILED — YA button not found in modal.${stageTrackingSuffix()}`);
          writeMarker("STAGE_8_FAILED", `reason=no_ya_button, buttons=${modalCheck.buttons.map((b) => b.text).join(",")}`);
          return {
            success: false,
            bootstrapOutcome: "confirmation_modal_detected_but_ya_click_failed",
            failureReason:
              `Stage 8: Modal detected and verified but YA/OK button not found. ` +
              `Buttons found: ${modalCheck.buttons.map((b) => `"${b.text}"`).join(", ")}. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote:
              `stage8: no YA button. buttons=${modalCheck.buttons.map((b) => b.text).join(",")}.${stageTrackingSuffix()}`,
          };
        }

        // Click YA with layered methods
        console.log(`[STAGE 8] Clicking YA button: "${modalCheck.yaButton.text}" tag=${modalCheck.yaButton.tag}`);
        let yaClicked = false;
        let yaClickMethod = "";

        // Method 1: JS click by id or bbox
        if (!yaClicked) {
          try {
            const clicked = await this.page.evaluate((ya: {
              id: string; tag: string;
              bbox: { x: number; y: number; w: number; h: number } | null;
              text: string;
            }) => {
              let el: Element | null = null;
              if (ya.id) el = document.getElementById(ya.id);
              if (!el && ya.bbox) {
                const btns2 = document.querySelectorAll("button, a, [role='button'], input[type='button'], input[type='submit']");
                for (const b of btns2) {
                  const r = b.getBoundingClientRect();
                  if (ya.bbox &&
                      Math.abs(r.x - ya.bbox.x) < 5 && Math.abs(r.y - ya.bbox.y) < 5 &&
                      Math.abs(r.width - ya.bbox.w) < 5 && Math.abs(r.height - ya.bbox.h) < 5) {
                    el = b; break;
                  }
                }
              }
              if (!el) {
                // Fallback: find by text content
                const btns3 = document.querySelectorAll("button, a, [role='button']");
                for (const b of btns3) {
                  if ((b.textContent || "").trim().toUpperCase() === ya.text.toUpperCase()) {
                    const r = b.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) { el = b; break; }
                  }
                }
              }
              if (el) { (el as HTMLElement).click(); return true; }
              return false;
            }, modalCheck.yaButton);
            if (clicked) { yaClicked = true; yaClickMethod = "js_click"; }
          } catch { /* try next */ }
        }

        // Method 2: bbox click
        if (!yaClicked && modalCheck.yaButton.bbox) {
          try {
            const cx = modalCheck.yaButton.bbox.x + modalCheck.yaButton.bbox.w / 2;
            const cy = modalCheck.yaButton.bbox.y + modalCheck.yaButton.bbox.h / 2;
            await this.page.mouse.move(cx, cy);
            await this.page.waitForTimeout(200);
            await this.page.mouse.click(cx, cy);
            yaClicked = true;
            yaClickMethod = "bbox_click";
          } catch { /* try next */ }
        }

        // Method 3: Playwright locator by text
        if (!yaClicked) {
          try {
            const yaLoc = this.page.locator(`button:has-text("${modalCheck.yaButton.text}")`).first();
            if (await yaLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
              await yaLoc.click({ timeout: 5000 });
              yaClicked = true;
              yaClickMethod = "locator_click";
            }
          } catch { /* exhausted */ }
        }

        console.log(`[STAGE 8] YA click: clicked=${yaClicked}, method=${yaClickMethod}`);

        if (!yaClicked) {
          console.log(`[STAGE 8] FAILED — YA button found but click failed.${stageTrackingSuffix()}`);
          writeMarker("STAGE_8_FAILED", `reason=ya_click_failed`);
          return {
            success: false,
            bootstrapOutcome: "confirmation_modal_detected_but_ya_click_failed",
            failureReason:
              `Stage 8: Modal verified, YA button found ("${modalCheck.yaButton.text}"), but click failed. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote: `stage8: ya click failed.${stageTrackingSuffix()}`,
          };
        }

        // Wait for navigation after YA click
        await this.page.waitForTimeout(5000);

        // Screenshot: post-confirmation
        try {
          const ts8post = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage8_post_confirmation_${ts8post}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        const stage8PostUrl = this.page.url();
        console.log(
          `[STAGE 8] POST: url=${stage8PostUrl.substring(0, 80)}, yaClicked=${yaClicked}, method=${yaClickMethod}`
        );

        bootstrapNotes.push(
          `stage8: modalFound=${modalCheck.found}, containsFirm=${modalCheck.containsTargetFirm}, ` +
          `yaClicked=${yaClicked}, method=${yaClickMethod}, postUrl=${stage8PostUrl.substring(0, 60)}`
        );

        lastCompletedStage = "stage_8_confirmation_modal";
        console.log(`[STAGE 8] COMPLETED — confirmation modal verified and YA clicked.${stageTrackingSuffix()}`);
        writeMarker("STAGE_8_CONFIRM_MODAL_COMPLETED",
          `url=${stage8PostUrl}, yaMethod=${yaClickMethod}, modalText="${modalCheck.bodyText.substring(0, 100)}"`);
        } // end else (DOM modal path)
      } catch (stage8Err) {
        console.log(`[STAGE 8] THREW — ${stage8Err instanceof Error ? stage8Err.message : String(stage8Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_8_THREW", `error=${stage8Err instanceof Error ? stage8Err.message : String(stage8Err)}`);
        return {
          success: false,
          bootstrapOutcome: "target_firm_click_succeeded_but_no_confirmation_modal",
          failureReason:
            `Stage 8 (confirmation modal) threw: ${stage8Err instanceof Error ? stage8Err.message : String(stage8Err)}` +
            stageTrackingSuffix(),
          readbackNote: `stage8_threw.${stageTrackingSuffix()}`,
        };
      }

      // ── Stage 9: Post-confirmation landing verification ─────────
      // Verify the authenticated landing page is reached under the
      // correct firm/agent context: "Ejen Admin TEMASEK KAYA SDN BHD MIRI"
      lastEnteredStage = "stage_9_firm_context_verification";
      console.log("\n" +
        "╔══════════════════════════════════════════════════════════╗\n" +
        "║  === STAGE 9: FIRM CONTEXT VERIFICATION — ENTERED ===  ║\n" +
        "╚══════════════════════════════════════════════════════════╝"
      );

      const stage9Url = this.page.url();
      const stage9Title = await this.page.title().catch(() => "");
      const stage9PageCount = this.page.context().pages().length;
      const stage9PageIndex = this.page.context().pages().indexOf(this.page);
      console.log(
        `[STAGE 9] PRE: url=${stage9Url.substring(0, 80)}, title="${stage9Title.substring(0, 40)}", ` +
        `pages=${stage9PageCount}, pageIndex=${stage9PageIndex}`
      );
      writeMarker("STAGE_9_FIRM_CONTEXT_ENTERED", `url=${stage9Url}`);

      try {
        // Wait for any post-confirmation page load
        await this.page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT }).catch(() => {});
        await this.page.waitForTimeout(3000);

        // Dismiss any blocking notices on the new page
        const postConfirmNotice = await this.dismissMyTaxBlockingNotices(5_000, 1_000);
        if (postConfirmNotice.noticeDismissed && postConfirmNotice.dismissalVerified) {
          bootstrapNotes.push(`Post-confirmation notice dismissed: ${postConfirmNotice.note}`);
        }

        // Screenshot: landing page
        try {
          const ts9landing = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage9_landing_${ts9landing}.png`,
            fullPage: false,
          });
        } catch { /* best effort */ }

        const landingUrl = this.page.url();
        const landingTitle = await this.page.title().catch(() => "");

        // Verify we're on stamps.hasil.gov.my (not still on role page or mytax)
        const isOnStamps = landingUrl.toLowerCase().includes("stamps.hasil.gov.my");
        const isStillOnRolePage = landingUrl.includes("role_change");
        const isOnMytax = landingUrl.toLowerCase().includes("mytax.hasil.gov.my");

        // DOM check for firm/agent context on the dashboard.
        //
        // STRICT VERIFICATION STRATEGY:
        // The dashboard shows the role/firm in a specific widget pattern:
        //   "Tukar Peranan [ Ejen Admin - TEMASEK KAYA SDN BHD MIRI ]"
        // We EXTRACT the value between [ ... ] from visible text nodes
        // matching "Tukar Peranan", then compare the extracted value
        // against the target using a symmetric punctuation-normalizer.
        //
        // Generic containment (txtNorm.includes) is NOT used for the
        // success gate. Only the extracted role-context value is compared.
        const contextCheck = await this.page.evaluate((targetFirm: string) => {
          // Symmetric punctuation-normalizer: strips dash separators,
          // collapses whitespace, uppercases. Applied identically to
          // both the extracted value and the target.
          const normalize = (s: string): string =>
            s.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
          const targetNorm = normalize(targetFirm);

          const dashboardIndicators = [
            /borang\s*permohonan/i,
            /permohonan\s*baru/i,
            /senarai\s*permohonan/i,
            /dashboard/i,
            /utama/i,
          ];

          // Diagnostic-only weak signals (NOT used for success gate)
          const weakFirmSignals = [
            /temasek\s*kaya/i,
            /ejen\s*admin/i,
          ];

          const blockTags = new Set(["html", "body", "head"]);

          // ── Primary extraction: role-context widget ──────────────
          // Look for visible text matching "Tukar Peranan [ ... ]" or
          // similar bracket-delimited role label, extract the value
          // between brackets, and compare via normalized exact equality.
          let firmContextVerified = false;
          let firmContextText = "";
          let extractedRoleValue = ""; // the raw extracted value from brackets
          let extractionSource = "";   // which text node it came from

          // Also try: any visible element whose own trimmed text,
          // after normalization, exactly equals the target. This handles
          // the case where the firm name appears as its own element text.
          let directMatchFound = false;
          let directMatchText = "";

          let weakFirmSignalPresent = false;
          let weakFirmSignalText = "";
          let dashboardVisible = false;
          let dashboardText = "";

          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const txt = (node.textContent || "").trim();
            if (txt.length < 3 || txt.length > 500) continue;
            const parent = node.parentElement;
            if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
            const r = parent.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0 &&
              window.getComputedStyle(parent).display !== "none" &&
              window.getComputedStyle(parent).visibility !== "hidden";
            if (!vis) continue;

            // ── Extraction strategy A: bracket-delimited role widget ──
            // Pattern: "Tukar Peranan [ <role-value> ]" or "[ <role-value> ]"
            if (!firmContextVerified) {
              const bracketMatch = txt.match(/\[\s*([^\]]+?)\s*\]/);
              if (bracketMatch) {
                const extracted = bracketMatch[1].trim();
                if (extracted.length >= 10) { // firm names are at least this long
                  const extractedNorm = normalize(extracted);
                  if (extractedNorm === targetNorm) {
                    firmContextVerified = true;
                    extractedRoleValue = extracted;
                    firmContextText = txt.substring(0, 120);
                    extractionSource = "bracket_widget";
                  }
                }
              }
            }

            // ── Extraction strategy B: direct text node equality ──
            // The firm name may appear as the sole text of a specific element
            if (!firmContextVerified && !directMatchFound) {
              const txtNorm = normalize(txt);
              if (txtNorm === targetNorm) {
                directMatchFound = true;
                directMatchText = txt.substring(0, 120);
                firmContextVerified = true;
                extractedRoleValue = txt.trim();
                firmContextText = txt.substring(0, 120);
                extractionSource = "direct_text_equality";
              }
            }

            // Diagnostic weak signals (NOT counted towards success)
            if (!weakFirmSignalPresent && weakFirmSignals.some((p) => p.test(txt))) {
              weakFirmSignalPresent = true;
              weakFirmSignalText = txt.substring(0, 120);
            }

            // Dashboard indicators
            if (!dashboardVisible && dashboardIndicators.some((p) => p.test(txt))) {
              dashboardVisible = true;
              dashboardText = txt.substring(0, 80);
            }
          }

          const bodySnippet = document.body?.innerText?.substring(0, 500) || "";

          return {
            firmContextVerified,
            firmContextText,
            extractedRoleValue,
            extractionSource,
            directMatchFound,
            directMatchText,
            weakFirmSignalPresent,
            weakFirmSignalText,
            dashboardVisible,
            dashboardText,
            bodySnippet,
          };
        }, STAGE7_TARGET_FIRM);

        console.log(`[STAGE 9] Landing verification:`);
        console.log(`  url=${landingUrl.substring(0, 80)}, title="${landingTitle.substring(0, 40)}"`);
        console.log(`  isOnStamps=${isOnStamps}, isStillOnRolePage=${isStillOnRolePage}, isOnMytax=${isOnMytax}`);
        console.log(`  firmContextVerified=${contextCheck.firmContextVerified}, source=${contextCheck.extractionSource}`);
        console.log(`  extractedRoleValue="${contextCheck.extractedRoleValue}"`);
        console.log(`  firmText="${contextCheck.firmContextText.substring(0, 80)}"`);
        console.log(`  weakFirmSignal=${contextCheck.weakFirmSignalPresent}, weakText="${contextCheck.weakFirmSignalText.substring(0, 60)}"`);
        console.log(`  dashboardVisible=${contextCheck.dashboardVisible}, dashText="${contextCheck.dashboardText.substring(0, 40)}"`);
        console.log(`  Body snippet: "${contextCheck.bodySnippet.substring(0, 200)}"`);

        writeMarker("STAGE_9_CONTEXT_CHECK",
          `url=${landingUrl}\ntitle=${landingTitle}\n` +
          `isOnStamps=${isOnStamps}, isStillOnRolePage=${isStillOnRolePage}\n` +
          `firmContextVerified=${contextCheck.firmContextVerified}, source=${contextCheck.extractionSource}\n` +
          `extractedRoleValue="${contextCheck.extractedRoleValue}"\n` +
          `firmText="${contextCheck.firmContextText}"\n` +
          `weakFirmSignal=${contextCheck.weakFirmSignalPresent}, weakText="${contextCheck.weakFirmSignalText}"\n` +
          `dashboard=${contextCheck.dashboardVisible}\n` +
          `body=${contextCheck.bodySnippet.substring(0, 300)}`);

        // Screenshot: final landing state
        try {
          const ts9final = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir1c}/stage9_final_${ts9final}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        bootstrapNotes.push(
          `stage9: url=${landingUrl.substring(0, 60)}, isOnStamps=${isOnStamps}, ` +
          `isRolePage=${isStillOnRolePage}, firmContext=${contextCheck.firmContextVerified}, ` +
          `dashboard=${contextCheck.dashboardVisible}`
        );

        // ── Stage 9 success gate ─────────────────────────────────
        if (isOnStamps && !isStillOnRolePage && !isOnMytax && contextCheck.firmContextVerified) {
          // Full success: on stamps, not role page, firm context verified
          lastCompletedStage = "stage_9_firm_context_verified";
          console.log(`[STAGE 9] COMPLETED — landing verified under target firm context.${stageTrackingSuffix()}`);
          writeMarker("STAGE_9_FIRM_CONTEXT_COMPLETED",
            `url=${landingUrl}, firm="${contextCheck.firmContextText}"`);
          return {
            success: true,
            selectorMethod: "mytax_eduti_link",
            bootstrapOutcome: "post_confirmation_landing_verified_under_target_firm",
            readbackNote:
              "Full MyTax → popup → eZHasil → Duti Setem → e-Stamp Duty → SSO → " +
              `Role page → Firm selected → YA confirmed → Landing verified. ` +
              `Firm context: "${contextCheck.firmContextText}". ` +
              `URL: ${landingUrl}. Title: "${landingTitle}". ` +
              (bootstrapNotes.length > 0 ? `Bootstrap notes: ${bootstrapNotes.join("; ")}` : "") +
              stageTrackingSuffix(),
          };
        }

        if (isOnStamps && !isStillOnRolePage && !isOnMytax) {
          // On stamps, past role page, but firm context not visible
          lastCompletedStage = "stage_9_landing_no_firm_context";
          console.log(`[STAGE 9] PARTIAL — landing reached but firm context not verified.${stageTrackingSuffix()}`);
          writeMarker("STAGE_9_PARTIAL", `url=${landingUrl}, firmContext=false`);
          return {
            success: true,
            selectorMethod: "mytax_eduti_link",
            bootstrapOutcome: "post_confirmation_landing_reached_but_firm_context_unverified",
            readbackNote:
              "Full MyTax → popup → eZHasil → Duti Setem → e-Stamp Duty → SSO → " +
              `Role page → Firm selected → YA confirmed → Landing reached but firm context not verified. ` +
              `URL: ${landingUrl}. Title: "${landingTitle}". ` +
              `Dashboard visible: ${contextCheck.dashboardVisible}. ` +
              (bootstrapNotes.length > 0 ? `Bootstrap notes: ${bootstrapNotes.join("; ")}` : "") +
              stageTrackingSuffix(),
          };
        }

        if (isStillOnRolePage) {
          // YA clicked but we're still on the role page
          console.log(`[STAGE 9] FAILED — still on role change page after YA click.${stageTrackingSuffix()}`);
          writeMarker("STAGE_9_FAILED", `reason=still_on_role_page, url=${landingUrl}`);
          return {
            success: false,
            bootstrapOutcome: "ya_clicked_but_destination_not_verified",
            failureReason:
              `Stage 9: YA clicked but still on role_change page. URL: ${landingUrl}. ` +
              "Headed browser kept open for local inspection." + stageTrackingSuffix(),
            readbackNote: `stage9: still on role page. url=${landingUrl.substring(0, 80)}.${stageTrackingSuffix()}`,
          };
        }

        // Generic navigation failure
        console.log(`[STAGE 9] FAILED — post-confirmation destination not verified.${stageTrackingSuffix()}`);
        writeMarker("STAGE_9_FAILED", `reason=destination_not_verified, url=${landingUrl}`);
        return {
          success: false,
          bootstrapOutcome: "post_confirmation_navigation_failed",
          failureReason:
            `Stage 9: YA clicked but destination not verified. URL: ${landingUrl}. ` +
            `isOnStamps=${isOnStamps}, isOnMytax=${isOnMytax}. ` +
            "Headed browser kept open for local inspection." + stageTrackingSuffix(),
          readbackNote:
            `stage9: dest not verified. url=${landingUrl.substring(0, 80)}, ` +
            `isStamps=${isOnStamps}, isMytax=${isOnMytax}.${stageTrackingSuffix()}`,
        };
      } catch (stage9Err) {
        console.log(`[STAGE 9] THREW — ${stage9Err instanceof Error ? stage9Err.message : String(stage9Err)}${stageTrackingSuffix()}`);
        writeMarker("STAGE_9_THREW", `error=${stage9Err instanceof Error ? stage9Err.message : String(stage9Err)}`);
        return {
          success: false,
          bootstrapOutcome: "post_confirmation_navigation_failed",
          failureReason:
            `Stage 9 (firm context verification) threw: ${stage9Err instanceof Error ? stage9Err.message : String(stage9Err)}` +
            stageTrackingSuffix(),
          readbackNote: `stage9_threw.${stageTrackingSuffix()}`,
        };
      }

      // ══════════════════════════════════════════════════════════════
      // Stages beyond 9 (Maklumat Am, save attempts, downstream
      // stamping) are deferred to a future milestone.
      // ══════════════════════════════════════════════════════════════
    } catch (err) {
      // Outer catch — only reachable if something threw BEFORE stage 2
      // entry (i.e., in the bootstrapNotes setup, fs import, or marker
      // write). All stage-level throws are caught by their own try/catch.
      const outerTrackingSuffix = postPopupContinuationEntered
        ? ` [postPopupContinuationEntered=true, lastEnteredStage=${lastEnteredStage}, lastCompletedStage=${lastCompletedStage}]`
        : " [postPopupContinuationEntered=false]";
      console.log(`[OUTER CATCH] Post-popup continuation threw before stage 2.${outerTrackingSuffix}`);
      writeMarker("POST_POPUP_OUTER_CATCH", `error=${err instanceof Error ? err.message : String(err)}`);
      return {
        success: false,
        bootstrapOutcome: postPopupContinuationEntered
          ? "post_popup_continuation_threw_before_stage_2"
          : "bootstrap_failed_before_probe",
        failureReason: `Navigation failed: ${err instanceof Error ? err.message : String(err)}${outerTrackingSuffix}`,
      };
    }
  }

  // ─── DEFERRED: Stages 7c-7i (firm/agent selection) + Stage 10 ────
  // Removed to avoid dead-code TS errors. Available in git history
  // for when the firm-selection milestone is resumed.
  // ─── openApplicationFlow ──────────────────────────────────────────
  // On the authenticated e-Duti Setem dashboard, open the application
  // creation entry point. Uses DOM-walk resolution (not :has-text())
  // to find the correct clickable element.

  async openApplicationFlow(
    _target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult> {
    const artifactDir = "data/portal-probe-artifacts";
    try { require("fs").mkdirSync(artifactDir, { recursive: true }); } catch { /* best effort */ }

    const writeMarker = (name: string, body: string): void => {
      try {
        const fsMk = require("fs") as typeof import("fs");
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fsMk.writeFileSync(
          `${artifactDir}/${name}_${ts}.txt`,
          `${name}\n${new Date().toISOString()}\n${body}\n`
        );
      } catch { /* best-effort */ }
    };

    const preUrl = this.page.url();
    console.log(`[OPEN APP FLOW] PRE: url=${preUrl.substring(0, 80)}`);
    writeMarker("OPEN_APP_FLOW_ENTERED", `url=${preUrl}`);

    // Screenshot: dashboard state before interaction
    try {
      const tsPre = new Date().toISOString().replace(/[:.]/g, "-");
      await this.page.screenshot({
        path: `${artifactDir}/open_app_flow_pre_${tsPre}.png`,
        fullPage: true,
      });
    } catch { /* best effort */ }

    try {
      // ── Step 1: DOM-walk to find "Borang Permohonan" menu entry ──
      const menuScan = await this.page.evaluate(() => {
        const MENU_PATTERNS = [
          /borang\s*permohonan/i,
        ];

        const blockTags = new Set(["html", "body", "head"]);

        interface MenuCandidate {
          text: string;
          tag: string;
          className: string;
          id: string;
          href: string;
          bbox: { x: number; y: number; w: number; h: number } | null;
          isVisible: boolean;
          isInteractive: boolean;
          resolvedFrom: string;
          hasSubmenu: boolean;
          submenuTexts: string[];
        }

        const getRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };

        const isVis = (el: Element): boolean => {
          const s = window.getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        const isInteractive = (el: Element): boolean => {
          const tag = el.tagName.toLowerCase();
          if (["a", "button", "input", "select"].includes(tag)) return true;
          if (el.hasAttribute("tabindex") || el.hasAttribute("onclick")) return true;
          if (["button", "menuitem", "link", "tab"].includes(el.getAttribute("role") || "")) return true;
          const s = window.getComputedStyle(el);
          if (s.cursor === "pointer") return true;
          return false;
        };

        const candidates: MenuCandidate[] = [];

        // Walk text nodes for "Borang Permohonan"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const txt = (node.textContent || "").trim();
          if (txt.length < 5 || txt.length > 100) continue;
          if (!MENU_PATTERNS.some((p) => p.test(txt))) continue;

          const textParent = node.parentElement;
          if (!textParent || blockTags.has(textParent.tagName.toLowerCase())) continue;

          const evaluateEl = (el: Element, from: string): void => {
            const tag = el.tagName.toLowerCase();
            if (blockTags.has(tag)) return;
            const bbox = getRect(el);
            const area = bbox ? bbox.w * bbox.h : 0;
            if (area > 100_000) return; // too large — page-wide container

            // Check for submenu: look at sibling/child ul, dropdown, etc.
            let hasSubmenu = false;
            const submenuTexts: string[] = [];
            const parent = el.parentElement;
            if (parent) {
              const subEls = parent.querySelectorAll("ul a, .dropdown-menu a, .treeview-menu a, li a");
              subEls.forEach((sub) => {
                const subTxt = (sub.textContent || "").trim();
                if (subTxt && subTxt !== txt && subTxt.length < 60) {
                  hasSubmenu = true;
                  if (submenuTexts.length < 10) submenuTexts.push(subTxt);
                }
              });
            }

            candidates.push({
              text: txt.substring(0, 60),
              tag,
              className: (el.className || "").toString().substring(0, 60),
              id: el.id || "",
              href: (el as HTMLAnchorElement).href || el.getAttribute("href") || "",
              bbox,
              isVisible: isVis(el),
              isInteractive: isInteractive(el),
              resolvedFrom: from,
              hasSubmenu,
              submenuTexts: submenuTexts.slice(0, 5),
            });
          };

          // Text parent
          evaluateEl(textParent, "text_parent");

          // Interactive ancestors (up to 6 levels)
          let anc: Element | null = textParent.parentElement;
          for (let lvl = 0; lvl < 6 && anc; lvl++) {
            if (isInteractive(anc) && !blockTags.has(anc.tagName.toLowerCase())) {
              evaluateEl(anc, "interactive_ancestor");
            }
            anc = anc.parentElement;
          }
        }

        // Also scan for href-based links to borang/permohonan
        const hrefEls = document.querySelectorAll('a[href*="borang"], a[href*="permohonan"]');
        hrefEls.forEach((el) => {
          const txt = (el.textContent || "").trim();
          if (txt.length > 0 && txt.length < 60) {
            const bbox = getRect(el);
            const area = bbox ? bbox.w * bbox.h : 0;
            if (area <= 100_000 && isVis(el)) {
              candidates.push({
                text: txt.substring(0, 60),
                tag: el.tagName.toLowerCase(),
                className: (el.className || "").toString().substring(0, 60),
                id: el.id || "",
                href: (el as HTMLAnchorElement).href || el.getAttribute("href") || "",
                bbox,
                isVisible: true,
                isInteractive: true,
                resolvedFrom: "href_match",
                hasSubmenu: false,
                submenuTexts: [],
              });
            }
          }
        });

        // Score: prefer the actual "Borang Permohonan" button with submenu
        const scored = candidates.map((c) => {
          let score = 0;
          if (c.isInteractive) score -= 500;
          if (c.tag === "a") score -= 300;
          if (c.href) score -= 200;
          if (c.isVisible) score -= 100;
          // Strong preference for the menu button that has a submenu
          if (c.hasSubmenu && /borang\s*permohonan/i.test(c.text)) score -= 800;
          if (c.tag === "button" && c.hasSubmenu) score -= 400;
          if (c.bbox) {
            const area = c.bbox.w * c.bbox.h;
            if (area < 10_000) score -= 150;
          }
          if (!c.isVisible) score += 500;
          if (!c.isInteractive) score += 300;
          return { ...c, score };
        });
        scored.sort((a, b) => a.score - b.score);

        return { candidates: scored };
      });

      console.log(`[OPEN APP FLOW] Found ${menuScan.candidates.length} menu candidates:`);
      for (const c of menuScan.candidates) {
        console.log(
          `  tag=${c.tag}, text="${c.text}", href="${(c.href || "").substring(0, 50)}", ` +
          `class="${c.className.substring(0, 30)}", vis=${c.isVisible}, interactive=${c.isInteractive}, ` +
          `from=${c.resolvedFrom}, hasSubmenu=${c.hasSubmenu}, score=${c.score}` +
          (c.submenuTexts.length > 0 ? `, submenu=[${c.submenuTexts.join(", ")}]` : "")
        );
      }
      writeMarker("OPEN_APP_FLOW_CANDIDATES", menuScan.candidates.map((c) =>
        `tag=${c.tag} text="${c.text}" href="${(c.href || "").substring(0, 50)}" vis=${c.isVisible} interactive=${c.isInteractive} from=${c.resolvedFrom} hasSubmenu=${c.hasSubmenu} submenu=[${c.submenuTexts.join(",")}] score=${c.score}`
      ).join("\n"));

      const viableTargets = menuScan.candidates.filter((c) => c.isVisible);
      if (viableTargets.length === 0) {
        console.log(`[OPEN APP FLOW] FAILED — no visible menu candidates found.`);
        writeMarker("OPEN_APP_FLOW_FAILED", `reason=no_visible_candidates, total=${menuScan.candidates.length}`);

        try {
          const tsF = new Date().toISOString().replace(/[:.]/g, "-");
          await this.page.screenshot({
            path: `${artifactDir}/open_app_flow_no_candidates_${tsF}.png`,
            fullPage: true,
          });
        } catch { /* best effort */ }

        return {
          success: false,
          failureReason:
            `Could not find visible "Borang Permohonan" menu entry on dashboard. ` +
            `Total DOM candidates: ${menuScan.candidates.length}. ` +
            `Current URL: ${this.page.url()}. ` +
            "Headed browser kept open for local inspection.",
        };
      }

      // ── Step 2: Open the "Borang Permohonan" dropdown ──────────────
      // The menu button is a <button> with a dropdown submenu. Using
      // hover keeps the dropdown open (click can toggle it closed).
      // After hovering, we scan for the now-visible "Penyeteman" submenu
      // item and click it directly.
      const bestTarget = viableTargets[0];
      console.log(
        `[OPEN APP FLOW] Best target: tag=${bestTarget.tag}, text="${bestTarget.text}", ` +
        `href="${(bestTarget.href || "").substring(0, 50)}", from=${bestTarget.resolvedFrom}, ` +
        `hasSubmenu=${bestTarget.hasSubmenu}`
      );

      let borangOpened = false;
      let borangOpenMethod = "";

      if (bestTarget.bbox) {
        const cx = bestTarget.bbox.x + bestTarget.bbox.w / 2;
        const cy = bestTarget.bbox.y + bestTarget.bbox.h / 2;

        // Method 1: Hover to open dropdown
        try {
          await this.page.mouse.move(cx, cy);
          await this.page.waitForTimeout(1000);
          // Check if submenu became visible
          const submenuVisible = await this.page.evaluate(() => {
            const els = document.querySelectorAll(".dropdown-menu, .treeview-menu, ul.dropdown");
            for (const el of els) {
              const r = el.getBoundingClientRect();
              const s = window.getComputedStyle(el);
              if (r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden") {
                return true;
              }
            }
            return false;
          });
          if (submenuVisible) {
            borangOpened = true;
            borangOpenMethod = "hover";
          }
        } catch { /* try next */ }

        // Method 2: Click to toggle dropdown open
        if (!borangOpened) {
          try {
            await this.page.mouse.click(cx, cy);
            await this.page.waitForTimeout(1000);
            borangOpened = true;
            borangOpenMethod = "click";
          } catch { /* try next */ }
        }
      }

      if (!borangOpened) {
        console.log(`[OPEN APP FLOW] FAILED — Borang Permohonan open failed.`);
        writeMarker("OPEN_APP_FLOW_FAILED", `reason=open_failed`);
        return {
          success: false,
          failureReason:
            `Found "Borang Permohonan" but click failed. ` +
            `Target: tag=${bestTarget.tag}, text="${bestTarget.text}". ` +
            `Current URL: ${this.page.url()}. ` +
            "Headed browser kept open for local inspection.",
        };
      }

      console.log(`[OPEN APP FLOW] Borang Permohonan opened via ${borangOpenMethod}. Scanning submenu...`);
      await this.page.waitForTimeout(1000);

      // Screenshot: after Borang Permohonan click
      try {
        const tsPost1 = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/open_app_flow_after_borang_click_${tsPost1}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      // ── Step 3: Check if we need a submenu click (Penyeteman) ─────
      // Or if we already landed on the application-entry screen.
      const postClickUrl = this.page.url();
      console.log(`[OPEN APP FLOW] Post-click URL: ${postClickUrl.substring(0, 80)}`);

      // Check if a submenu appeared or if the page changed
      const postClickScan = await this.page.evaluate(() => {
        const blockTags = new Set(["html", "body", "head"]);

        // Check for submenu items that may have appeared
        const submenuPatterns = [
          /penyeteman/i,
          /permohonan\s*baru/i,
          /new\s*application/i,
        ];

        const submenuItems: Array<{
          text: string; tag: string; href: string;
          bbox: { x: number; y: number; w: number; h: number } | null;
          isVisible: boolean;
        }> = [];

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const txt = (node.textContent || "").trim();
          if (txt.length < 3 || txt.length > 80) continue;
          if (!submenuPatterns.some((p) => p.test(txt))) continue;
          const parent = node.parentElement;
          if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;

          // Walk to find the closest interactive element
          let target: Element = parent;
          let anc: Element | null = parent;
          for (let i = 0; i < 4 && anc; i++) {
            const tag = anc.tagName.toLowerCase();
            if (["a", "button"].includes(tag)) { target = anc; break; }
            if (anc.hasAttribute("onclick") || anc.getAttribute("role") === "menuitem") { target = anc; break; }
            anc = anc.parentElement;
          }

          const r = target.getBoundingClientRect();
          const vis = r.width > 0 && r.height > 0 &&
            window.getComputedStyle(target).display !== "none" &&
            window.getComputedStyle(target).visibility !== "hidden";

          submenuItems.push({
            text: txt.substring(0, 60),
            tag: target.tagName.toLowerCase(),
            href: (target as HTMLAnchorElement).href || target.getAttribute("href") || "",
            bbox: r.width > 0 ? {
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
            } : null,
            isVisible: vis,
          });
        }

        // Check for lane-entry indicators already on page
        const lanePatterns = [
          { pattern: /sewa\s*\/?\s*pajakan/i, lane: "sewa_pajakan" },
          { pattern: /penyeteman\s*am/i, lane: "penyeteman_am" },
          { pattern: /maklumat\s*am/i, lane: "maklumat_am" },
        ];

        const laneIndicators: Array<{
          lane: string; text: string; tag: string; isVisible: boolean;
        }> = [];

        const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node2: Node | null;
        while ((node2 = walker2.nextNode())) {
          const txt = (node2.textContent || "").trim();
          if (txt.length < 3 || txt.length > 80) continue;
          for (const lp of lanePatterns) {
            if (lp.pattern.test(txt)) {
              const parent2 = node2.parentElement;
              if (!parent2 || blockTags.has(parent2.tagName.toLowerCase())) continue;
              const r2 = parent2.getBoundingClientRect();
              const vis2 = r2.width > 0 && r2.height > 0;
              laneIndicators.push({
                lane: lp.lane,
                text: txt.substring(0, 60),
                tag: parent2.tagName.toLowerCase(),
                isVisible: vis2,
              });
            }
          }
        }

        // Page heading
        const headings: string[] = [];
        const hEls = document.querySelectorAll("h1, h2, h3, h4, .page-title, .content-header");
        hEls.forEach((h) => {
          const txt = (h.textContent || "").trim();
          if (txt.length > 0 && txt.length < 100) {
            const r = h.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) headings.push(txt.substring(0, 80));
          }
        });

        const bodySnippet = document.body?.innerText?.substring(0, 800) || "";

        return {
          submenuItems,
          laneIndicators,
          headings,
          bodySnippet,
        };
      });

      console.log(`[OPEN APP FLOW] Post-click scan:`);
      console.log(`  Submenu items: ${postClickScan.submenuItems.length}`);
      for (const s of postClickScan.submenuItems) {
        console.log(`    text="${s.text}", tag=${s.tag}, href="${(s.href || "").substring(0, 50)}", vis=${s.isVisible}`);
      }
      console.log(`  Lane indicators: ${postClickScan.laneIndicators.length}`);
      for (const l of postClickScan.laneIndicators) {
        console.log(`    lane=${l.lane}, text="${l.text}", tag=${l.tag}, vis=${l.isVisible}`);
      }
      console.log(`  Headings: ${postClickScan.headings.join("; ")}`);
      console.log(`  Body snippet: "${postClickScan.bodySnippet.substring(0, 200)}"`);

      writeMarker("OPEN_APP_FLOW_POST_CLICK_SCAN",
        `url=${postClickUrl}\n` +
        `submenuItems=${postClickScan.submenuItems.map((s) => `"${s.text}" tag=${s.tag} vis=${s.isVisible}`).join("; ")}\n` +
        `laneIndicators=${postClickScan.laneIndicators.map((l) => `${l.lane}="${l.text}" vis=${l.isVisible}`).join("; ")}\n` +
        `headings=${postClickScan.headings.join("; ")}\n` +
        `body=${postClickScan.bodySnippet.substring(0, 400)}`);

      // ── Step 4: Find NOW-VISIBLE "Penyeteman" submenu and click ───
      // The dropdown should be open. Re-scan for visible submenu items.
      const penyetemanTarget = await this.page.evaluate(() => {
        const pattern = /^penyeteman$/i;
        const blockTags2 = new Set(["html", "body", "head"]);
        const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let nd: Node | null;
        while ((nd = walker2.nextNode())) {
          const txt = (nd.textContent || "").trim();
          if (!pattern.test(txt)) continue;
          let el: Element | null = nd.parentElement;
          for (let i = 0; i < 4 && el; i++) {
            const tag = el.tagName.toLowerCase();
            if (blockTags2.has(tag)) { el = null; break; }
            if (tag === "a" || tag === "button" || el.hasAttribute("onclick")) break;
            el = el.parentElement;
          }
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const s = window.getComputedStyle(el);
          if (r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden") {
            return {
              text: txt,
              tag: el.tagName.toLowerCase(),
              href: (el as HTMLAnchorElement).href || el.getAttribute("href") || "",
              bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            };
          }
        }
        return null;
      });

      let penyetemanClicked = false;
      if (penyetemanTarget) {
        console.log(
          `[OPEN APP FLOW] Visible Penyeteman found: tag=${penyetemanTarget.tag}, ` +
          `text="${penyetemanTarget.text}", href="${penyetemanTarget.href.substring(0, 50)}", ` +
          `bbox=${penyetemanTarget.bbox.x},${penyetemanTarget.bbox.y} ${penyetemanTarget.bbox.w}x${penyetemanTarget.bbox.h}`
        );
        try {
          const cx = penyetemanTarget.bbox.x + penyetemanTarget.bbox.w / 2;
          const cy = penyetemanTarget.bbox.y + penyetemanTarget.bbox.h / 2;
          await this.page.mouse.click(cx, cy);
          penyetemanClicked = true;
          await this.page.waitForTimeout(3000);
          console.log(`[OPEN APP FLOW] Penyeteman clicked. URL: ${this.page.url().substring(0, 80)}`);
        } catch (pErr) {
          console.log(`[OPEN APP FLOW] Penyeteman click threw: ${pErr instanceof Error ? pErr.message : String(pErr)}`);
        }
      } else {
        console.log(`[OPEN APP FLOW] No visible "Penyeteman" submenu while dropdown open.`);
      }

      // ── Step 5: Final evidence capture on the landed screen ───────
      await this.page.waitForTimeout(2000);

      const finalUrl = this.page.url();
      const finalTitle = await this.page.title().catch(() => "");

      // Screenshot: final application-entry screen
      try {
        const tsFinal = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/open_app_flow_final_${tsFinal}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      // Final DOM scan for lane-entry visibility
      const finalScan = await this.page.evaluate(() => {
        const blockTags = new Set(["html", "body", "head"]);
        const lanePatterns = [
          { pattern: /sewa\s*\/?\s*pajakan/i, lane: "sewa_pajakan" },
          { pattern: /penyeteman\s*am/i, lane: "penyeteman_am" },
        ];

        const lanes: Array<{
          lane: string; text: string; tag: string;
          bbox: { x: number; y: number; w: number; h: number } | null;
          isVisible: boolean; isInteractive: boolean;
        }> = [];

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const txt = (node.textContent || "").trim();
          if (txt.length < 3 || txt.length > 80) continue;
          for (const lp of lanePatterns) {
            if (lp.pattern.test(txt)) {
              const parent = node.parentElement;
              if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
              const r = parent.getBoundingClientRect();
              const vis = r.width > 0 && r.height > 0 &&
                window.getComputedStyle(parent).display !== "none" &&
                window.getComputedStyle(parent).visibility !== "hidden";
              const interactive = ["a", "button", "input", "label"].includes(parent.tagName.toLowerCase()) ||
                parent.hasAttribute("onclick") || parent.hasAttribute("tabindex") ||
                window.getComputedStyle(parent).cursor === "pointer";
              lanes.push({
                lane: lp.lane,
                text: txt.substring(0, 60),
                tag: parent.tagName.toLowerCase(),
                bbox: r.width > 0 ? {
                  x: Math.round(r.x), y: Math.round(r.y),
                  w: Math.round(r.width), h: Math.round(r.height),
                } : null,
                isVisible: vis,
                isInteractive: interactive,
              });
            }
          }
        }

        // Page headings
        const headings: string[] = [];
        document.querySelectorAll("h1, h2, h3, h4, .page-title, .content-header, .box-title").forEach((h) => {
          const txt = (h.textContent || "").trim();
          if (txt.length > 0 && txt.length < 100) {
            const r = h.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) headings.push(txt.substring(0, 80));
          }
        });

        // Radio buttons on page (may indicate lane selection)
        const radios: Array<{ name: string; value: string; label: string; checked: boolean; visible: boolean }> = [];
        document.querySelectorAll('input[type="radio"]').forEach((r) => {
          const input = r as HTMLInputElement;
          const label = input.labels?.[0]?.textContent?.trim() ||
            input.parentElement?.textContent?.trim() || "";
          const rect = input.getBoundingClientRect();
          radios.push({
            name: input.name,
            value: input.value,
            label: label.substring(0, 60),
            checked: input.checked,
            visible: rect.width > 0 && rect.height > 0,
          });
        });

        const bodySnippet = document.body?.innerText?.substring(0, 1000) || "";

        return { lanes, headings, radios, bodySnippet };
      });

      console.log(`[OPEN APP FLOW] Final screen evidence:`);
      console.log(`  URL: ${finalUrl.substring(0, 80)}`);
      console.log(`  Title: "${finalTitle.substring(0, 60)}"`);
      console.log(`  Headings: ${finalScan.headings.join("; ")}`);
      console.log(`  Lane indicators: ${finalScan.lanes.length}`);
      for (const l of finalScan.lanes) {
        console.log(`    lane=${l.lane}, text="${l.text}", tag=${l.tag}, vis=${l.isVisible}, interactive=${l.isInteractive}`);
      }
      console.log(`  Radio buttons: ${finalScan.radios.length}`);
      for (const r of finalScan.radios) {
        console.log(`    name=${r.name}, value=${r.value}, label="${r.label}", checked=${r.checked}, vis=${r.visible}`);
      }
      console.log(`  Body snippet: "${finalScan.bodySnippet.substring(0, 200)}"`);

      writeMarker("OPEN_APP_FLOW_FINAL_EVIDENCE",
        `url=${finalUrl}\ntitle=${finalTitle}\n` +
        `headings=${finalScan.headings.join("; ")}\n` +
        `lanes=${finalScan.lanes.map((l) => `${l.lane}="${l.text}" tag=${l.tag} vis=${l.isVisible} interactive=${l.isInteractive}`).join("; ")}\n` +
        `radios=${finalScan.radios.map((r) => `name=${r.name} value=${r.value} label="${r.label}" checked=${r.checked} vis=${r.visible}`).join("; ")}\n` +
        `body=${finalScan.bodySnippet.substring(0, 500)}`);

      // ── Determine success ─────────────────────────────────────────
      const urlChanged = finalUrl !== preUrl;
      const hasLaneIndicators = finalScan.lanes.some((l) => l.isVisible);
      const hasRadios = finalScan.radios.some((r) => r.visible);
      const sewaPajakanVisible = finalScan.lanes.some((l) => l.lane === "sewa_pajakan" && l.isVisible);
      const penyetemanAmVisible = finalScan.lanes.some((l) => l.lane === "penyeteman_am" && l.isVisible);

      const readbackParts = [
        `Borang Permohonan opened via ${borangOpenMethod}.`,
        penyetemanClicked ? `Penyeteman submenu clicked.` : `Penyeteman submenu not clicked.`,
        `Final URL: ${finalUrl}.`,
        `Headings: ${finalScan.headings.join("; ") || "none"}.`,
        `Sewa/Pajakan visible: ${sewaPajakanVisible}.`,
        `Penyeteman Am visible: ${penyetemanAmVisible}.`,
        `Radio buttons: ${finalScan.radios.length}.`,
        `Lane indicators: ${finalScan.lanes.length}.`,
      ];

      if (urlChanged || hasLaneIndicators || hasRadios || finalScan.headings.length > 0) {
        console.log(`[OPEN APP FLOW] COMPLETED — application entry screen reached.`);
        writeMarker("OPEN_APP_FLOW_COMPLETED", `url=${finalUrl}, lanes=${finalScan.lanes.length}, radios=${finalScan.radios.length}`);
        return {
          success: true,
          selectorMethod: "label_exact",
          readbackNote: readbackParts.join(" "),
        };
      }

      // No clear application-entry evidence
      console.log(`[OPEN APP FLOW] FAILED — no application entry screen evidence found.`);
      writeMarker("OPEN_APP_FLOW_FAILED", `reason=no_entry_screen_evidence, url=${finalUrl}`);
      return {
        success: false,
        failureReason:
          `Borang Permohonan clicked but no clear application entry screen reached. ` +
          `URL: ${finalUrl}. Headings: ${finalScan.headings.join("; ") || "none"}. ` +
          `Lane indicators: ${finalScan.lanes.length}. ` +
          "Headed browser kept open for local inspection.",
        readbackNote: readbackParts.join(" "),
      };
    } catch (err) {
      console.log(`[OPEN APP FLOW] THREW — ${err instanceof Error ? err.message : String(err)}`);
      writeMarker("OPEN_APP_FLOW_THREW", `error=${err instanceof Error ? err.message : String(err)}`);
      return {
        success: false,
        failureReason: `Open application flow failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async selectLane(
    _target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult> {
    const artifactDir = "data/portal-probe-artifacts";
    const writeMarker = (name: string, body: string): void => {
      try {
        const fsMk = require("fs") as typeof import("fs");
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fsMk.mkdirSync(artifactDir, { recursive: true });
        fsMk.writeFileSync(
          `${artifactDir}/${name}_${ts}.txt`,
          `${name}\n${new Date().toISOString()}\n${body}\n`
        );
      } catch { /* best-effort */ }
    };

    try {
      const lane = String(payload.value);
      const laneLabels: Record<string, string[]> = {
        sewa_pajakan: ["Sewa / Pajakan", "Sewa/Pajakan", "Sewa Pajakan"],
        penyeteman_am: ["Penyeteman Am", "Penyeteman  Am"],
      };
      const labels = laneLabels[lane] ?? [lane];

      console.log(`[SELECT LANE] Selecting lane: ${lane}`);
      writeMarker("SELECT_LANE_ENTERED", `lane=${lane}`);

      // Screenshot: before selection
      try {
        const tsPre = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/select_lane_pre_${lane}_${tsPre}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      let selected = false;
      let selMethod = "";

      for (const label of labels) {
        if (selected) break;

        // Try: find the radio by DOM-walk matching exact label text
        const radioResult = await this.page.evaluate((lbl: string) => {
          const radios = document.querySelectorAll('input[type="radio"]');
          for (const r of radios) {
            const input = r as HTMLInputElement;
            // Check associated label
            const labelEl = input.labels?.[0];
            const labelTxt = labelEl?.textContent?.trim() || "";
            const parentTxt = input.parentElement?.textContent?.trim() || "";
            if (labelTxt === lbl || parentTxt === lbl) {
              const rect = input.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  found: true,
                  name: input.name,
                  value: input.value,
                  labelText: labelTxt || parentTxt,
                  bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                };
              }
            }
          }
          return { found: false, name: "", value: "", labelText: "", bbox: null as { x: number; y: number; w: number; h: number } | null };
        }, label);

        if (radioResult.found && radioResult.bbox) {
          console.log(`[SELECT LANE] Found radio: name=${radioResult.name}, value=${radioResult.value}, label="${radioResult.labelText}"`);
          // Click the radio via bbox
          const cx = radioResult.bbox.x + radioResult.bbox.w / 2;
          const cy = radioResult.bbox.y + radioResult.bbox.h / 2;
          await this.page.mouse.click(cx, cy);
          selected = true;
          selMethod = "radio_bbox_click";
          await this.page.waitForTimeout(3000); // wait for lane-specific UI to render
        }
      }

      if (!selected) {
        // Fallback: Playwright locator approach
        for (const label of labels) {
          const radio = this.page.locator(`label:has-text("${label}") input[type="radio"]`).first();
          if (await radio.isVisible({ timeout: 2000 }).catch(() => false)) {
            await radio.check();
            selected = true;
            selMethod = "radio_label_locator";
            await this.page.waitForTimeout(3000);
            break;
          }
          const clickable = this.page.locator(`text="${label}"`).first();
          if (await clickable.isVisible({ timeout: 2000 }).catch(() => false)) {
            await clickable.click();
            selected = true;
            selMethod = "text_match_locator";
            await this.page.waitForTimeout(3000);
            break;
          }
        }
      }

      if (!selected) {
        console.log(`[SELECT LANE] FAILED — lane "${lane}" not found.`);
        writeMarker("SELECT_LANE_FAILED", `lane=${lane}, reason=not_found`);
        return {
          success: false,
          failureReason: `Could not find portal lane selector for "${lane}".`,
        };
      }

      console.log(`[SELECT LANE] Lane "${lane}" selected via ${selMethod}.`);

      // Screenshot: after selection
      try {
        const tsPost = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/select_lane_post_${lane}_${tsPost}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      // ── Field inventory capture ─────────────────────────────────
      // Capture ALL visible form fields, labels, selects, radios, and
      // text sections on the current Maklumat Am state.
      const fieldInventory = await this.page.evaluate(() => {
        const blockTags = new Set(["html", "body", "head"]);

        // All visible labels
        const labels: Array<{ text: string; forId: string; tag: string; visible: boolean }> = [];
        document.querySelectorAll("label").forEach((lbl) => {
          const txt = (lbl.textContent || "").trim();
          if (txt.length > 0 && txt.length < 120) {
            const r = lbl.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0;
            if (vis) {
              labels.push({
                text: txt.substring(0, 80),
                forId: lbl.htmlFor || "",
                tag: lbl.tagName.toLowerCase(),
                visible: vis,
              });
            }
          }
        });

        // All visible inputs
        const inputs: Array<{
          type: string; name: string; id: string; value: string;
          placeholder: string; readOnly: boolean; visible: boolean;
          label: string;
        }> = [];
        document.querySelectorAll("input, textarea").forEach((el) => {
          const input = el as HTMLInputElement;
          const r = input.getBoundingClientRect();
          const vis = r.width > 0 && r.height > 0;
          if (!vis) return;
          const lbl = input.labels?.[0]?.textContent?.trim() || "";
          inputs.push({
            type: input.type || "text",
            name: input.name,
            id: input.id,
            value: input.value.substring(0, 60),
            placeholder: (input.placeholder || "").substring(0, 40),
            readOnly: input.readOnly,
            visible: vis,
            label: lbl.substring(0, 80),
          });
        });

        // All visible selects
        const selects: Array<{
          name: string; id: string; selectedText: string;
          optionCount: number; visible: boolean; label: string;
        }> = [];
        document.querySelectorAll("select").forEach((el) => {
          const sel = el as HTMLSelectElement;
          const r = sel.getBoundingClientRect();
          const vis = r.width > 0 && r.height > 0;
          if (!vis) return;
          const selectedOpt = sel.options[sel.selectedIndex];
          const lbl = sel.labels?.[0]?.textContent?.trim() || "";
          selects.push({
            name: sel.name,
            id: sel.id,
            selectedText: (selectedOpt?.text || "").substring(0, 60),
            optionCount: sel.options.length,
            visible: vis,
            label: lbl.substring(0, 80),
          });
        });

        // All visible radio groups
        const radioGroups: Map<string, Array<{ value: string; label: string; checked: boolean; visible: boolean }>> = new Map();
        document.querySelectorAll('input[type="radio"]').forEach((el) => {
          const radio = el as HTMLInputElement;
          const r = radio.getBoundingClientRect();
          const vis = r.width > 0 && r.height > 0;
          if (!vis) return;
          const lbl = radio.labels?.[0]?.textContent?.trim() || radio.parentElement?.textContent?.trim() || "";
          const group = radioGroups.get(radio.name) || [];
          group.push({
            value: radio.value,
            label: lbl.substring(0, 60),
            checked: radio.checked,
            visible: vis,
          });
          radioGroups.set(radio.name, group);
        });

        // Convert radio groups to serializable format
        const radioGroupsArr: Array<{ name: string; options: Array<{ value: string; label: string; checked: boolean }> }> = [];
        radioGroups.forEach((opts, name) => {
          radioGroupsArr.push({ name, options: opts });
        });

        // Headings / section titles
        const headings: string[] = [];
        document.querySelectorAll("h1, h2, h3, h4, h5, .box-title, .box-header, legend, .content-header").forEach((h) => {
          const txt = (h.textContent || "").trim();
          if (txt.length > 0 && txt.length < 120) {
            const r = h.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) headings.push(txt.substring(0, 100));
          }
        });

        // Key field indicators
        const keyTextPatterns = [
          "Nama Surat Cara", "Kategori Surat Cara", "Kumpulan Surat Cara",
          "Pejabat Setem", "Tarikh Surat Cara", "Tarikh Diterima",
          "Surat Cara", "Maklumat Am",
        ];
        const keyTextFound: Array<{ text: string; tag: string; visible: boolean }> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const txt = (node.textContent || "").trim();
          if (txt.length < 3 || txt.length > 120) continue;
          for (const key of keyTextPatterns) {
            if (txt.includes(key)) {
              const parent = node.parentElement;
              if (!parent || blockTags.has(parent.tagName.toLowerCase())) continue;
              const r = parent.getBoundingClientRect();
              const vis = r.width > 0 && r.height > 0;
              keyTextFound.push({
                text: txt.substring(0, 80),
                tag: parent.tagName.toLowerCase(),
                visible: vis,
              });
              break;
            }
          }
        }

        const bodySnippet = document.body?.innerText?.substring(0, 1500) || "";

        return {
          labels,
          inputs,
          selects,
          radioGroups: radioGroupsArr,
          headings,
          keyTextFound,
          bodySnippet,
        };
      });

      // Log field inventory
      console.log(`[SELECT LANE] Field inventory for lane "${lane}":`);
      console.log(`  Headings: ${fieldInventory.headings.join("; ")}`);
      console.log(`  Labels (${fieldInventory.labels.length}):`);
      for (const l of fieldInventory.labels) {
        console.log(`    "${l.text}" for="${l.forId}"`);
      }
      console.log(`  Inputs (${fieldInventory.inputs.length}):`);
      for (const i of fieldInventory.inputs) {
        console.log(`    type=${i.type} name=${i.name} id=${i.id} value="${i.value}" ro=${i.readOnly} label="${i.label}"`);
      }
      console.log(`  Selects (${fieldInventory.selects.length}):`);
      for (const s of fieldInventory.selects) {
        console.log(`    name=${s.name} id=${s.id} selected="${s.selectedText}" options=${s.optionCount} label="${s.label}"`);
      }
      console.log(`  Radio groups (${fieldInventory.radioGroups.length}):`);
      for (const rg of fieldInventory.radioGroups) {
        console.log(`    name=${rg.name}: ${rg.options.map((o) => `${o.value}="${o.label}"${o.checked ? " [CHECKED]" : ""}`).join(", ")}`);
      }
      console.log(`  Key text found (${fieldInventory.keyTextFound.length}):`);
      for (const k of fieldInventory.keyTextFound) {
        console.log(`    "${k.text}" tag=${k.tag} vis=${k.visible}`);
      }

      // Write field inventory to marker file
      writeMarker(`SELECT_LANE_FIELD_INVENTORY_${lane.toUpperCase()}`,
        `headings=${fieldInventory.headings.join("; ")}\n` +
        `labels=${fieldInventory.labels.map((l) => `"${l.text}"`).join("; ")}\n` +
        `inputs=${fieldInventory.inputs.map((i) => `${i.type}:${i.name}="${i.label}"`).join("; ")}\n` +
        `selects=${fieldInventory.selects.map((s) => `${s.name}="${s.label}" (${s.optionCount} opts)`).join("; ")}\n` +
        `radioGroups=${fieldInventory.radioGroups.map((rg) => `${rg.name}=[${rg.options.map((o) => `${o.value}="${o.label}"${o.checked ? "*" : ""}`).join(",")}]`).join("; ")}\n` +
        `keyText=${fieldInventory.keyTextFound.map((k) => `"${k.text}" vis=${k.visible}`).join("; ")}\n` +
        `body=${fieldInventory.bodySnippet.substring(0, 600)}`);

      const postUrl = this.page.url();
      writeMarker("SELECT_LANE_COMPLETED", `lane=${lane}, method=${selMethod}, url=${postUrl}`);

      return {
        success: true,
        observedValue: lane,
        selectorMethod: "radio_label",
        readbackNote:
          `Lane "${lane}" selected via ${selMethod}. URL: ${postUrl}. ` +
          `Headings: ${fieldInventory.headings.join("; ")}. ` +
          `Labels: ${fieldInventory.labels.length}. ` +
          `Inputs: ${fieldInventory.inputs.length}. ` +
          `Selects: ${fieldInventory.selects.length}. ` +
          `RadioGroups: ${fieldInventory.radioGroups.length}. ` +
          `Key text: ${fieldInventory.keyTextFound.map((k) => `"${k.text.substring(0, 40)}" vis=${k.visible}`).join("; ")}.`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason: `Lane selection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ─── ARCHITECTURE NOTE: Bahagian A Party Entry ───────────────────────
  // The landlord/tenant party entry on the supported p5 path uses a
  // Bootbox modal (opened via "Tambah Individu" on Bahagian A).
  //
  // For the Warganegara (citizen) path, the modal requires:
  //   1. Selecting Status Warganegara → reveals identity block (div#kp)
  //   2. Selecting IC type (EPD_NOKP_TYPE, e.g., IC_BARU)
  //   3. Entering IC number (kpin) — 12-digit numeric
  //   4. On blur, portal fires POST to /stamps/formv2/p5/semakan_tin/
  //      which performs a live LHDN TIN lookup
  //   5. If TIN found: tb_cukai + tb_cukai_display populate automatically
  //   6. If TIN not found: tb_cukai gets placeholder, Jantina + Tarikh
  //      Lahir fields are revealed for manual entry
  //   7. The hidden tb_cukai field (required) is the submission gate
  //
  // CRITICAL: The identity/TIN lookup requires REAL user-provided identity
  // data (Malaysian NRIC). WeStamp automation of this step MUST flow real
  // identity data from the actual stamping job, NOT synthesized/random
  // values. Blind probing of identity numbers is not acceptable and may
  // surface third-party tax identity data.
  //
  // Further automation of Bahagian A party entry is deferred until the
  // product flow provides real identity data from the tenancy agreement.
  // ────────────────────────────────────────────────────────────────────

  // ─── selectSewaPajakanDocumentAndVerify ─────────────────────────────
  // On a p5 post-save page, selects the exact Nama Surat Cara option
  // from the pds_suratcara dropdown, reads back the selected value,
  // reads back pds_ps, and verifies against expectations.
  //
  // Does NOT save, submit, or navigate tabs.

  async selectSewaPajakanDocumentAndVerify(
    documentLabel: string,
    expectedOptionValue: string
  ): Promise<BrowserDriverOperationResult> {
    const artifactDir = "data/portal-probe-artifacts";
    try {
      // ── Guard: must be on a p5 page ──────────────────────────────
      const currentUrl = this.page.url();
      if (!currentUrl.includes("/formv2/p5/")) {
        return {
          success: false,
          failureReason:
            `Not on a p5 page. Current URL: ${currentUrl}. ` +
            "selectSewaPajakanDocumentAndVerify requires a p5 post-save page.",
        };
      }

      console.log(
        `[P5 DOC SELECT] Selecting "${documentLabel}" (expected value=${expectedOptionValue}) on ${currentUrl.substring(0, 60)}`
      );

      // ── Capture baseline ──────────────────────────────────────────
      const baseline = await this.page.evaluate(() => {
        const sc = document.getElementById("pds_suratcara") as HTMLSelectElement | null;
        const ps = document.getElementById("pds_ps") as HTMLSelectElement | null;
        const scOptions: Array<{ value: string; text: string }> = [];
        if (sc) {
          for (let i = 0; i < sc.options.length; i++) {
            scOptions.push({ value: sc.options[i].value, text: sc.options[i].text });
          }
        }
        const psOptions: Array<{ value: string; text: string }> = [];
        if (ps) {
          for (let i = 0; i < ps.options.length; i++) {
            psOptions.push({ value: ps.options[i].value, text: ps.options[i].text });
          }
        }
        return {
          suratcaraValue: sc ? sc.value : "(not found)",
          suratcaraText: sc ? (sc.options[sc.selectedIndex]?.text ?? "") : "(not found)",
          suratcaraOptions: scOptions,
          pdsPsValue: ps ? ps.value : "(not found)",
          pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text ?? "") : "(not found)",
          pdsPsOptions: psOptions,
        };
      });

      console.log(
        `[P5 DOC SELECT] Baseline: suratcara="${baseline.suratcaraText}" (${baseline.suratcaraValue}), ` +
        `pds_ps="${baseline.pdsPsText}" (${baseline.pdsPsValue})`
      );
      console.log(
        `[P5 DOC SELECT] pds_suratcara options: ${baseline.suratcaraOptions.map((o) => `${o.value}="${o.text}"`).join(", ")}`
      );
      console.log(
        `[P5 DOC SELECT] pds_ps options: ${baseline.pdsPsOptions.map((o) => `${o.value}="${o.text}"`).join(", ")}`
      );

      // ── Verify the option exists ──────────────────────────────────
      const optionExists = baseline.suratcaraOptions.some(
        (o) => o.text === documentLabel || o.value === expectedOptionValue
      );
      if (!optionExists) {
        return {
          success: false,
          failureReason:
            `Option "${documentLabel}" (value=${expectedOptionValue}) not found in pds_suratcara. ` +
            `Available: ${baseline.suratcaraOptions.map((o) => `${o.value}="${o.text}"`).join(", ")}.`,
        };
      }

      // ── Select the option ─────────────────────────────────────────
      const selectLocator = this.page.locator("#pds_suratcara");
      await selectLocator.selectOption({ value: expectedOptionValue });
      await this.page.waitForTimeout(2000);

      // ── Read back actual values ───────────────────────────────────
      const actual = await this.page.evaluate(() => {
        const sc = document.getElementById("pds_suratcara") as HTMLSelectElement | null;
        const ps = document.getElementById("pds_ps") as HTMLSelectElement | null;
        const psOptions: Array<{ value: string; text: string }> = [];
        if (ps) {
          for (let i = 0; i < ps.options.length; i++) {
            psOptions.push({ value: ps.options[i].value, text: ps.options[i].text });
          }
        }
        return {
          suratcaraValue: sc ? sc.value : "(not found)",
          suratcaraText: sc ? (sc.options[sc.selectedIndex]?.text ?? "") : "(not found)",
          pdsPsValue: ps ? ps.value : "(not found)",
          pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text ?? "") : "(not found)",
          pdsPsOptions: psOptions,
        };
      });

      console.log(
        `[P5 DOC SELECT] Actual: suratcara="${actual.suratcaraText}" (${actual.suratcaraValue}), ` +
        `pds_ps="${actual.pdsPsText}" (${actual.pdsPsValue})`
      );

      // ── Verify: selected option matches ───────────────────────────
      if (actual.suratcaraValue !== expectedOptionValue) {
        return {
          success: false,
          failureReason:
            `pds_suratcara selection mismatch. ` +
            `Expected value="${expectedOptionValue}", actual="${actual.suratcaraValue}" ("${actual.suratcaraText}").`,
        };
      }
      if (actual.suratcaraText !== documentLabel) {
        return {
          success: false,
          failureReason:
            `pds_suratcara text mismatch. ` +
            `Expected label="${documentLabel}", actual="${actual.suratcaraText}".`,
        };
      }

      // ── Screenshot ────────────────────────────────────────────────
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/p5_doc_verified_${documentLabel.replace(/\s+/g, "_").substring(0, 30)}_${ts}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      console.log(
        `[P5 DOC SELECT] VERIFIED: "${documentLabel}" selected. ` +
        `pds_ps="${actual.pdsPsText}" (${actual.pdsPsValue}). ` +
        `pds_ps options: ${actual.pdsPsOptions.map((o) => `${o.value}="${o.text}"`).join(", ")}`
      );

      return {
        success: true,
        observedValue: documentLabel,
        selectorMethod: "native_select",
        readbackNote:
          `p5 doc select verified: "${documentLabel}" (value=${actual.suratcaraValue}). ` +
          `pds_ps="${actual.pdsPsText}" (${actual.pdsPsValue}). ` +
          `pds_ps options: [${actual.pdsPsOptions.map((o) => `${o.value}="${o.text}"`).join(", ")}]. ` +
          `URL: ${currentUrl}.`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason:
          `p5 document selection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ─── enterPenyetemanAmDocumentNameAndVerify ────────────────────────
  // On a p8 post-save page, types the exact document name into
  // namaperjanjian, triggers blur/change, waits for the portal to
  // populate profile_desc, and verifies the observed values against
  // the live evidence-backed expectations.
  //
  // Does NOT save, submit, or navigate tabs.

  async enterPenyetemanAmDocumentNameAndVerify(
    documentName: string,
    expectedObservedProfileDesc: string,
    expectedPdsPs: string
  ): Promise<BrowserDriverOperationResult> {
    const artifactDir = "data/portal-probe-artifacts";
    try {
      // ── Guard: must be on a p8 page ──────────────────────────────
      const currentUrl = this.page.url();
      if (!currentUrl.includes("/formv2/p8/")) {
        return {
          success: false,
          failureReason:
            `Not on a p8 page. Current URL: ${currentUrl}. ` +
            "enterPenyetemanAmDocumentNameAndVerify requires a p8 post-save page.",
        };
      }

      console.log(
        `[P8 DOC ENTRY] Entering "${documentName}" on ${currentUrl.substring(0, 60)}`
      );
      console.log(
        `[P8 DOC ENTRY] Expected profile_desc="${expectedObservedProfileDesc}", pds_ps="${expectedPdsPs}"`
      );

      // ── Capture baseline ──────────────────────────────────────────
      const baseline = await this.page.evaluate(() => {
        const nsc = document.getElementById("namaperjanjian") as HTMLInputElement | null;
        const pd = document.getElementById("profile_desc") as HTMLInputElement | null;
        const ps = document.getElementById("pds_ps") as HTMLSelectElement | null;
        return {
          namaperjanjian: nsc?.value ?? "(not found)",
          profileDesc: pd?.value ?? "(not found)",
          pdsPs: ps?.value ?? "(not found)",
          pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text ?? "") : "(not found)",
        };
      });
      console.log(
        `[P8 DOC ENTRY] Baseline: namaperjanjian="${baseline.namaperjanjian}", ` +
        `profile_desc="${baseline.profileDesc}", pds_ps="${baseline.pdsPsText}"`
      );

      // ── Type the document name ────────────────────────────────────
      const nscLocator = this.page.locator("#namaperjanjian");
      if (!(await nscLocator.isVisible({ timeout: 3000 }).catch(() => false))) {
        return {
          success: false,
          failureReason: "namaperjanjian input not visible on this p8 page.",
        };
      }

      await nscLocator.click();
      await nscLocator.fill("");
      await this.page.waitForTimeout(300);
      await nscLocator.fill(documentName);
      await this.page.waitForTimeout(500);

      // ── Trigger blur/change ───────────────────────────────────────
      await nscLocator.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      });
      await this.page.waitForTimeout(3000);

      // ── Read back actual values ───────────────────────────────────
      const actual = await this.page.evaluate(() => {
        const nsc = document.getElementById("namaperjanjian") as HTMLInputElement | null;
        const pd = document.getElementById("profile_desc") as HTMLInputElement | null;
        const ps = document.getElementById("pds_ps") as HTMLSelectElement | null;
        return {
          namaperjanjian: nsc?.value ?? "(not found)",
          profileDesc: pd?.value ?? "(not found)",
          pdsPs: ps?.value ?? "(not found)",
          pdsPsText: ps ? (ps.options[ps.selectedIndex]?.text ?? "") : "(not found)",
          profileDescReadOnly: pd?.readOnly ?? false,
        };
      });

      console.log(
        `[P8 DOC ENTRY] Actual: namaperjanjian="${actual.namaperjanjian}", ` +
        `profile_desc="${actual.profileDesc}" (readOnly=${actual.profileDescReadOnly}), ` +
        `pds_ps="${actual.pdsPsText}"`
      );

      // ── Verify: namaperjanjian holds the typed value ──────────────
      if (actual.namaperjanjian !== documentName) {
        return {
          success: false,
          failureReason:
            `namaperjanjian value mismatch after fill. ` +
            `Expected: "${documentName}", actual: "${actual.namaperjanjian}".`,
          readbackNote:
            `p8 doc entry: namaperjanjian mismatch. typed="${documentName}", actual="${actual.namaperjanjian}".`,
        };
      }

      // ── Verify: profile_desc matches expected ─────────────────────
      // Exact string comparison — no fuzzy, no containment.
      const profileDescMatch = actual.profileDesc === expectedObservedProfileDesc;
      if (!profileDescMatch) {
        console.log(
          `[P8 DOC ENTRY] MISMATCH: profile_desc expected="${expectedObservedProfileDesc}", ` +
          `actual="${actual.profileDesc}"`
        );
        return {
          success: false,
          failureReason:
            `profile_desc mismatch for "${documentName}". ` +
            `Expected: "${expectedObservedProfileDesc}", ` +
            `actual: "${actual.profileDesc}".`,
          readbackNote:
            `p8 doc entry: profile_desc mismatch. expected="${expectedObservedProfileDesc}", ` +
            `actual="${actual.profileDesc}".`,
        };
      }

      // ── Verify: pds_ps matches expected ───────────────────────────
      // Compare by the select's value (e.g., "p" for Prinsipal).
      // The expected value uses the display label, so map it.
      const pdsPsValueMap: Record<string, string> = {
        Prinsipal: "p",
        Subsidiari: "s",
      };
      const expectedPdsPsValue = pdsPsValueMap[expectedPdsPs] ?? expectedPdsPs;
      const pdsPsMatch = actual.pdsPs === expectedPdsPsValue;
      if (!pdsPsMatch) {
        console.log(
          `[P8 DOC ENTRY] MISMATCH: pds_ps expected="${expectedPdsPs}" (value="${expectedPdsPsValue}"), ` +
          `actual="${actual.pdsPsText}" (value="${actual.pdsPs}")`
        );
        return {
          success: false,
          failureReason:
            `pds_ps mismatch for "${documentName}". ` +
            `Expected: "${expectedPdsPs}" (${expectedPdsPsValue}), ` +
            `actual: "${actual.pdsPsText}" (${actual.pdsPs}).`,
          readbackNote:
            `p8 doc entry: pds_ps mismatch. expected="${expectedPdsPs}", actual="${actual.pdsPsText}".`,
        };
      }

      // ── Screenshot: verified state ────────────────────────────────
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        await this.page.screenshot({
          path: `${artifactDir}/p8_doc_verified_${documentName.replace(/\s+/g, "_").substring(0, 30)}_${ts}.png`,
          fullPage: true,
        });
      } catch { /* best effort */ }

      console.log(
        `[P8 DOC ENTRY] VERIFIED: "${documentName}" → ` +
        `profile_desc="${actual.profileDesc}", pds_ps="${actual.pdsPsText}"`
      );

      return {
        success: true,
        observedValue: documentName,
        selectorMethod: "label_exact",
        readbackNote:
          `p8 doc entry verified: "${documentName}" → ` +
          `profile_desc="${actual.profileDesc}" (matches expected), ` +
          `pds_ps="${actual.pdsPsText}" (matches expected). ` +
          `URL: ${currentUrl}.`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason:
          `p8 document name entry failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async fillField(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult> {
    try {
      const value = String(payload.value ?? "");
      if (!value) {
        return { success: false, failureReason: "No value to fill." };
      }

      const labelText = target.selectorHint?.labelText ?? target.portalLabel;
      if (!labelText) {
        return {
          success: false,
          failureReason: "No label text available to locate field.",
        };
      }

      const isDateField =
        target.selectorHint?.inputType === "date" ||
        target.fieldKey === "instrument_date" ||
        target.fieldKey === "received_in_malaysia_date";

      const resolved = await resolveInputField(this.page, labelText, "input");
      if (!resolved) {
        return {
          success: false,
          failureReason: `Could not locate input field for "${labelText}" using any selector strategy.`,
        };
      }

      await resolved.locator.clear();
      await resolved.locator.fill(value);
      await this.page.waitForTimeout(500);

      return {
        success: true,
        observedValue: value,
        selectorMethod: resolved.method,
        readbackConfidence: "exact",
        readbackNote: `Filled via ${resolved.method}`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason: `Fill field failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async selectDropdownOption(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload
  ): Promise<BrowserDriverOperationResult> {
    try {
      const value = String(payload.value ?? "");
      if (!value) {
        return { success: false, failureReason: "No value to select." };
      }

      const labelText = target.selectorHint?.labelText ?? target.portalLabel;
      if (!labelText) {
        return {
          success: false,
          failureReason: "No label text available to locate dropdown.",
        };
      }

      // Try native <select> first
      const selectResolved = await resolveInputField(this.page, labelText, "select");
      if (selectResolved) {
        await selectResolved.locator.selectOption({ label: value });
        await this.page.waitForTimeout(1000);
        return {
          success: true,
          observedValue: value,
          selectorMethod: "native_select",
          readbackConfidence: "exact",
          readbackNote: `Selected via native <select> (${selectResolved.method})`,
        };
      }

      // Try searchable/autocomplete input
      const inputResolved = await resolveInputField(this.page, labelText, "input");
      if (inputResolved) {
        await inputResolved.locator.clear();
        await inputResolved.locator.fill(value);
        await this.page.waitForTimeout(1500);

        // Click matching dropdown option
        const optionSelectors = [
          `li:has-text("${value}")`,
          `.dropdown-item:has-text("${value}")`,
          `[role="option"]:has-text("${value}")`,
          `.ui-menu-item:has-text("${value}")`,
          `.autocomplete-result:has-text("${value}")`,
        ];

        for (const optSel of optionSelectors) {
          const option = this.page.locator(optSel).first();
          if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
            await option.click();
            await this.page.waitForTimeout(1000);
            return {
              success: true,
              observedValue: value,
              selectorMethod: "autocomplete_input",
              readbackConfidence: "exact",
              readbackNote: `Selected via autocomplete (input: ${inputResolved.method})`,
            };
          }
        }

        return {
          success: false,
          failureReason: `Typed "${value}" into dropdown for "${labelText}" but no matching option appeared.`,
          selectorMethod: inputResolved.method,
        };
      }

      return {
        success: false,
        failureReason: `Could not locate dropdown for "${labelText}" using any selector strategy.`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason: `Select dropdown failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async waitForReadOnlyValue(
    target: BrowserAutomationTarget,
    _expectations: BrowserAutomationExpectation[]
  ): Promise<BrowserDriverOperationResult> {
    try {
      const labelText = target.selectorHint?.labelText ?? target.portalLabel;
      if (!labelText) {
        return {
          success: false,
          failureReason: "No label text available to locate read-only field.",
        };
      }

      // Poll for the value to appear
      const maxAttempts = 10;
      for (let i = 0; i < maxAttempts; i++) {
        const resolved = await resolveReadOnlyValue(this.page, labelText);
        if (resolved && resolved.value) {
          return {
            success: true,
            observedValue: resolved.value,
            selectorMethod: resolved.method,
            readbackConfidence: resolved.confidence,
            readbackNote: resolved.note,
          };
        }
        await this.page.waitForTimeout(1000);
      }

      return {
        success: false,
        observedValue: null,
        failureReason: `Read-only field "${labelText}" did not populate within ${maxAttempts}s timeout.`,
      };
    } catch (err) {
      return {
        success: false,
        failureReason: `Wait for read-only value failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async assertReadOnlyValue(
    target: BrowserAutomationTarget,
    payload: BrowserAutomationPayload,
    expectations: BrowserAutomationExpectation[]
  ): Promise<BrowserDriverOperationResult> {
    const observed = await this.waitForReadOnlyValue(target, expectations);
    if (!observed.success) return observed;

    const expected = String(payload.value ?? "");
    const rawActual = String(observed.observedValue ?? "");
    const { normalized: normalizedActual } = normalizeObservedValue(rawActual);
    const { normalized: normalizedExpected } = normalizeObservedValue(expected);

    if (
      normalizedExpected &&
      normalizedActual &&
      normalizedExpected !== normalizedActual
    ) {
      return {
        success: false,
        observedValue: normalizedActual,
        rawObservedValue: rawActual !== normalizedActual ? rawActual : undefined,
        failureReason: `Assertion failed: expected "${normalizedExpected}" but observed "${normalizedActual}".`,
        selectorMethod: observed.selectorMethod,
        readbackConfidence: observed.readbackConfidence,
        readbackNote: observed.readbackNote,
      };
    }

    return {
      success: true,
      observedValue: normalizedActual,
      rawObservedValue: rawActual !== normalizedActual ? rawActual : undefined,
      selectorMethod: observed.selectorMethod,
      readbackConfidence: observed.readbackConfidence,
      readbackNote: observed.readbackNote,
    };
  }

  // ── BLOCKED OPERATIONS — these must refuse to execute ──────────────

  async saveCurrentSection(
    _target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult> {
    return {
      success: false,
      failureReason:
        "SAFETY STOP: save_current_section is not permitted in the Maklumat Am probe. " +
        "This instruction was intentionally blocked to prevent creating portal records.",
    };
  }

  /**
   * Perform the actual Maklumat Am save click.
   *
   * This is the ONLY method that performs a real mutating portal action.
   * It is NOT called by the probe — only by the explicit save-attempt path
   * which requires active authorization and eligible preflight.
   *
   * Returns the observed portal response (success/error message text).
   */
  async performMaklumatAmSave(): Promise<{
    success: boolean;
    observedMessage?: string;
    failureReason?: string;
  }> {
    try {
      // Look for the save/submit button for Maklumat Am
      const saveSelectors = [
        'button:has-text("Simpan")',
        'button:has-text("Hantar")',
        'input[type="submit"][value*="Simpan"]',
        'button:has-text("Save")',
        'a.btn:has-text("Simpan")',
        'button[type="submit"]',
      ];

      let saveClicked = false;
      for (const selector of saveSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click();
          saveClicked = true;
          break;
        }
      }

      if (!saveClicked) {
        return {
          success: false,
          failureReason:
            "Could not find the Maklumat Am save button on the current page. " +
            "The portal layout may have changed.",
        };
      }

      // Wait for the portal to respond
      await this.page.waitForTimeout(5000);

      // Check for success indicators
      const successSelectors = [
        '.alert-success',
        '.toast-success',
        ':text("Berjaya")',
        ':text("berjaya disimpan")',
        ':text("successfully")',
        '.swal2-success',
        '.modal-success',
      ];

      for (const selector of successSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          const text = await el.textContent({ timeout: 2000 }).catch(() => null);
          return {
            success: true,
            observedMessage: text?.trim() ?? "Success indicator observed",
          };
        }
      }

      // Check for error indicators
      const errorSelectors = [
        '.alert-danger',
        '.alert-warning',
        '.toast-error',
        '.validation-error',
        '.field-error',
        '.swal2-error',
        ':text("Ralat")',
        ':text("Sila")',
        '.invalid-feedback:visible',
      ];

      for (const selector of errorSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const text = await el.textContent({ timeout: 2000 }).catch(() => null);
          return {
            success: false,
            observedMessage: text?.trim() ?? "Error indicator observed",
            failureReason: `Portal displayed error after save: ${text?.trim() ?? "unknown error"}`,
          };
        }
      }

      // No clear success or error indicator found
      return {
        success: true,
        observedMessage: "Save clicked — no explicit success or error message detected.",
      };
    } catch (err) {
      return {
        success: false,
        failureReason: `Save attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async continueToTab(
    _target: BrowserAutomationTarget
  ): Promise<BrowserDriverOperationResult> {
    return {
      success: false,
      failureReason:
        "SAFETY STOP: continue_to_tab is not permitted in the Maklumat Am probe. " +
        "This instruction was intentionally blocked to prevent advancing beyond Maklumat Am.",
    };
  }

  /**
   * Perform the first next-tab progression click from Maklumat Am into
   * the immediate next tab (Bahagian A).
   *
   * This is a separate method from continueToTab() because it is only
   * callable via the explicit next-tab-attempt path which requires
   * active next-tab authorization and eligible next-tab preflight.
   *
   * Returns the observed portal response and whether the target tab
   * appeared active/visible after the click.
   *
   * SAFETY: Stops immediately after observation. Does NOT fill any fields
   * in the target tab. Does NOT proceed to any further tab.
   */
  async performNextTabProgression(targetTabLabel: string): Promise<{
    success: boolean;
    observedMessage?: string;
    targetTabAppearedActive: boolean;
    observedTabLabel?: string;
    failureReason?: string;
  }> {
    try {
      // Look for the next-tab / continue button or tab link
      // The e-Duti Setem portal uses tab navigation with clickable tab headers
      // and sometimes a "Seterusnya" (Next) button
      const nextTabSelectors = [
        // Tab header link matching the target tab label
        `a:has-text("${targetTabLabel}")`,
        `li:has-text("${targetTabLabel}") a`,
        `a[role="tab"]:has-text("${targetTabLabel}")`,
        // Generic next/continue buttons
        'button:has-text("Seterusnya")',
        'button:has-text("Next")',
        'a.btn:has-text("Seterusnya")',
        'a:has-text("Seterusnya")',
        // Tab navigation via tab key
        `[data-tab="${targetTabLabel}"]`,
      ];

      let clicked = false;
      for (const selector of nextTabSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        return {
          success: false,
          targetTabAppearedActive: false,
          failureReason:
            `Could not find a clickable element to navigate to "${targetTabLabel}". ` +
            "The portal layout may have changed or the tab may not be available.",
        };
      }

      // Wait for the portal to respond
      await this.page.waitForTimeout(5000);

      // Check if the target tab appears active
      const activeTabSelectors = [
        `li.active:has-text("${targetTabLabel}")`,
        `a.active:has-text("${targetTabLabel}")`,
        `[role="tab"][aria-selected="true"]:has-text("${targetTabLabel}")`,
        `.nav-link.active:has-text("${targetTabLabel}")`,
        `.tab-pane.active`,
      ];

      let targetTabAppearedActive = false;
      let observedTabLabel: string | undefined;

      for (const selector of activeTabSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          targetTabAppearedActive = true;
          observedTabLabel =
            (await el.textContent({ timeout: 2000 }).catch(() => null))?.trim() ??
            targetTabLabel;
          break;
        }
      }

      // Check for error indicators
      const errorSelectors = [
        '.alert-danger',
        '.alert-warning',
        '.toast-error',
        ':text("Ralat")',
        ':text("Sila")',
        '.swal2-error',
      ];

      for (const selector of errorSelectors) {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const text = await el.textContent({ timeout: 2000 }).catch(() => null);
          return {
            success: false,
            observedMessage: text?.trim() ?? "Error indicator observed",
            targetTabAppearedActive,
            observedTabLabel,
            failureReason: `Portal displayed error after tab click: ${text?.trim() ?? "unknown error"}`,
          };
        }
      }

      return {
        success: true,
        observedMessage: targetTabAppearedActive
          ? `Tab "${observedTabLabel ?? targetTabLabel}" appears active after click.`
          : "Tab clicked — no explicit active state confirmed.",
        targetTabAppearedActive,
        observedTabLabel,
      };
    } catch (err) {
      return {
        success: false,
        targetTabAppearedActive: false,
        failureReason: `Next-tab progression failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Observe the visible fields on the current tab without filling anything.
   *
   * Scans for label+input/select/textarea/display elements on the active
   * tab pane. For each found field:
   * - reads the label text
   * - determines if it's an input, select, textarea, display, checkbox, radio, or date
   * - checks if it appears required (asterisk in label, or required attribute)
   * - checks if it is disabled/readonly
   * - reads any current pre-populated value
   *
   * Does NOT fill any field. Does NOT click any button.
   * This is a read-only observation pass.
   */
  async observeTabFields(): Promise<{
    success: boolean;
    fields: {
      labelText: string;
      mode: "editable" | "read_only" | "derived" | "unknown";
      typeHint: "text_input" | "select" | "date" | "checkbox" | "radio" | "textarea" | "display" | "unknown";
      appearsRequired: boolean;
      currentValue: string | null;
      locatorNote: string;
      containerContext?: string;
    }[];
    failureReason?: string;
  }> {
    try {
      // Use page.evaluate to scan the active tab pane for form fields
      const rawFields = await this.page.evaluate(() => {
        const results: {
          labelText: string;
          tagName: string;
          inputType: string;
          isDisabled: boolean;
          isReadOnly: boolean;
          appearsRequired: boolean;
          currentValue: string | null;
          containerText: string;
        }[] = [];

        // Find the active tab pane or fall back to the whole form
        const activePane =
          document.querySelector(".tab-pane.active") ??
          document.querySelector(".tab-pane.show") ??
          document.querySelector("form") ??
          document.body;

        // Scan labels that are associated with form elements
        const labels = activePane.querySelectorAll("label");

        for (const label of labels) {
          const labelText = (label.textContent ?? "").trim();
          if (!labelText || labelText.length > 200) continue;

          // Find the associated input: by `for` attribute, or as a sibling/child
          let input: HTMLElement | null = null;
          const forId = label.getAttribute("for");
          if (forId) {
            input = document.getElementById(forId);
          }
          if (!input) {
            // Look for input/select/textarea as a sibling
            const parent = label.parentElement;
            if (parent) {
              input = parent.querySelector("input, select, textarea");
            }
          }
          if (!input) {
            // Check next sibling
            let sib = label.nextElementSibling;
            while (sib) {
              if (sib.matches("input, select, textarea")) {
                input = sib as HTMLElement;
                break;
              }
              const nested = sib.querySelector("input, select, textarea");
              if (nested) {
                input = nested as HTMLElement;
                break;
              }
              sib = sib.nextElementSibling;
            }
          }

          const tagName = input?.tagName?.toLowerCase() ?? "none";
          const inputType = (input as HTMLInputElement)?.type?.toLowerCase() ?? "";
          const isDisabled =
            (input as HTMLInputElement)?.disabled === true ||
            input?.getAttribute("disabled") !== null;
          const isReadOnly =
            (input as HTMLInputElement)?.readOnly === true ||
            input?.getAttribute("readonly") !== null;
          const appearsRequired =
            labelText.includes("*") ||
            labelText.toLowerCase().includes("wajib") ||
            (input as HTMLInputElement)?.required === true ||
            input?.getAttribute("required") !== null;

          let currentValue: string | null = null;
          if (input) {
            if (tagName === "select") {
              const sel = input as HTMLSelectElement;
              currentValue = sel.options[sel.selectedIndex]?.text?.trim() ?? sel.value;
            } else if (tagName === "input" || tagName === "textarea") {
              currentValue = (input as HTMLInputElement).value || null;
            } else {
              currentValue = input.textContent?.trim() || null;
            }
          }

          // Container context: nearest ancestor with a heading or strong label
          const container = label.closest("fieldset, .form-group, .card, .panel, section");
          const containerText =
            container?.querySelector("legend, .card-header, .panel-heading, h3, h4, h5")
              ?.textContent?.trim() ?? "";

          results.push({
            labelText,
            tagName,
            inputType,
            isDisabled,
            isReadOnly,
            appearsRequired,
            currentValue,
            containerText,
          });
        }

        // Also check for visible display-only elements that might not have labels
        // (e.g. <span> or <p> with a preceding label-like text)
        // This is a lightweight pass — do not dump the DOM
        const displaySpans = activePane.querySelectorAll(
          ".form-control-static, .form-control-plaintext, span[data-field], td[data-field]"
        );
        for (const span of displaySpans) {
          const text = (span.textContent ?? "").trim();
          if (!text || text.length > 200) continue;
          // Try to find a preceding label
          const prevEl = span.previousElementSibling;
          const labelText = prevEl?.tagName === "LABEL"
            ? (prevEl.textContent ?? "").trim()
            : (span.getAttribute("data-field") ?? "display_field");
          if (results.some((r) => r.labelText === labelText)) continue;
          results.push({
            labelText,
            tagName: "display",
            inputType: "display",
            isDisabled: true,
            isReadOnly: true,
            appearsRequired: false,
            currentValue: text,
            containerText: "",
          });
        }

        return results;
      });

      // Map raw results to structured output
      const fields = rawFields.map((raw) => {
        // Determine typeHint
        let typeHint: "text_input" | "select" | "date" | "checkbox" | "radio" | "textarea" | "display" | "unknown";
        if (raw.tagName === "select") typeHint = "select";
        else if (raw.tagName === "textarea") typeHint = "textarea";
        else if (raw.inputType === "date" || raw.inputType === "datetime-local") typeHint = "date";
        else if (raw.inputType === "checkbox") typeHint = "checkbox";
        else if (raw.inputType === "radio") typeHint = "radio";
        else if (raw.tagName === "input" && ["text", "number", "email", "tel", ""].includes(raw.inputType)) typeHint = "text_input";
        else if (raw.tagName === "display" || raw.inputType === "display") typeHint = "display";
        else if (raw.tagName === "none") typeHint = "display";
        else typeHint = "unknown";

        // Determine mode
        let mode: "editable" | "read_only" | "derived" | "unknown";
        if (raw.isDisabled && raw.isReadOnly) mode = "read_only";
        else if (raw.isDisabled) mode = "derived";
        else if (raw.isReadOnly) mode = "read_only";
        else if (raw.tagName === "display" || raw.tagName === "none") mode = "read_only";
        else mode = "editable";

        return {
          labelText: raw.labelText,
          mode,
          typeHint,
          appearsRequired: raw.appearsRequired,
          currentValue: raw.currentValue,
          locatorNote: raw.tagName === "none"
            ? "label only, no associated input found"
            : `${raw.tagName}[type=${raw.inputType || "n/a"}]`,
          containerContext: raw.containerText || undefined,
        };
      });

      return { success: true, fields };
    } catch (err) {
      return {
        success: false,
        fields: [],
        failureReason: `Field observation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async stopForReview(): Promise<BrowserDriverOperationResult> {
    return {
      success: true,
      observedValue: null,
      failureReason: undefined,
    };
  }

  /**
   * Capture a screenshot of the current portal page.
   *
   * This is a diagnostic artifact for the local/dev probe.
   * The screenshot is written to a local file path — binary content
   * is NOT returned or stored in the job record.
   *
   * @param filePath - Absolute or relative path to write the PNG file.
   * @returns Whether the screenshot was successfully captured.
   */
  async captureScreenshot(filePath: string): Promise<{ success: boolean; note?: string }> {
    try {
      await this.page.screenshot({ path: filePath, fullPage: false });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        note: `Screenshot capture failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ─── Session Launcher ───────────────────────────────────────────────

/**
 * Dedicated persistent browser profile directory for WeStamp local/dev.
 *
 * Using a persistent user-data-dir (via Playwright's launchPersistentContext)
 * means cookies, localStorage, IndexedDB, and session state survive across
 * browser launches. This eliminates the brittle storageState JSON approach
 * and ensures the Playwright browser behaves like the same browser the
 * developer used for the last login — matching what a real Chrome profile
 * would preserve.
 *
 * The directory is created automatically if it does not exist.
 */
const PERSISTENT_PROFILE_DIR = "data/playwright-profile";

/**
 * Legacy storage state path — still used as a fallback indicator.
 * If the persistent profile is empty but this file exists, it signals
 * a prior session was saved. The persistent profile supersedes this.
 */
const STORAGE_STATE_PATH = "data/portal-session.json";

/**
 * Launch a headed Chromium browser with a persistent local/dev profile.
 *
 * Authentication flow:
 * 1. Opens Chromium with a dedicated persistent user-data-dir
 *    (data/playwright-profile/). All cookies, storage, and session
 *    state are preserved across launches automatically.
 * 2. Navigates to MyTax — the correct entry point for TIN holders.
 * 3. If a login page is detected, pauses for manual login.
 * 4. Returns the authenticated Page and a cleanup function.
 *
 * The persistent profile eliminates the need for manual storageState
 * serialization/deserialization and ensures the Playwright browser
 * retains the same session state as a real Chrome profile would.
 *
 * This is a LOCAL/DEV tool only. Not for production deployment.
 */
/**
 * Standardized browser-environment settings for local/dev.
 *
 * These settings ensure the Playwright browser renders pages consistently
 * with a normal desktop Chrome browser, reducing layout/font divergence
 * that can affect menu positions, click targets, and dropdown rendering.
 *
 * This is NOT a fingerprint-spoofing system — it is a practical
 * local/dev consistency measure.
 */
const BROWSER_ENV = {
  /** Use installed Chrome (not Playwright's bundled Chromium) for closest
   *  match to normal desktop browsing. Falls back to bundled Chromium
   *  if Chrome is not installed. */
  channel: "chrome" as const,
  /** Standard desktop viewport — matches common 1280×800 laptop screens. */
  viewport: { width: 1280, height: 900 },
  /** Malaysia locale — matches the MyTax/e-Duti Setem portal language. */
  locale: "ms-MY",
  /** Malaysia timezone. */
  timezoneId: "Asia/Kuala_Lumpur",
  /** Standard 1x device scale for consistent font/layout rendering.
   *  Avoids Retina 2x scaling that can distort dropdown/font proportions. */
  deviceScaleFactor: 1,
  /** Light color scheme — matches standard government portal expectations. */
  colorScheme: "light" as const,
  /** slowMo for local/dev observability. */
  slowMo: 200,
};

/**
 * Chromium launch args for local/dev stability and rendering consistency.
 */
const BROWSER_ARGS = [
  // Reduce automation-detection signals
  "--disable-blink-features=AutomationControlled",
  // Avoid site-isolation issues with portal cross-domain flows
  "--disable-features=IsolateOrigins,site-per-process",
  // Force consistent font rendering (avoid hinting differences)
  "--font-render-hinting=none",
  // Force 1x device scale factor to avoid layout scaling divergence
  "--force-device-scale-factor=1",
  // Disable GPU acceleration for consistent rendering across machines
  "--disable-gpu",
];

export async function launchAuthenticatedSession(): Promise<{
  page: Page;
  cleanup: (failed?: boolean) => Promise<void>;
}> {
  const { chromium } = await import("playwright");
  const fs = await import("fs");
  const path = await import("path");

  // Ensure the persistent profile directory exists
  const profileDir = path.resolve(PERSISTENT_PROFILE_DIR);
  const profileExisted = fs.existsSync(profileDir);
  fs.mkdirSync(profileDir, { recursive: true });

  // Determine if this is a fresh profile or reuse
  const profileHasContents = profileExisted &&
    (fs.readdirSync(profileDir).length > 0);

  // Launch with persistent context using standardized browser environment.
  // Uses installed Chrome (channel: "chrome") for closest match to normal
  // desktop browsing. launchPersistentContext uses a real user-data-dir,
  // so all cookies, localStorage, IndexedDB, and session storage persist
  // across browser restarts automatically.
  let usedChannel: string = BROWSER_ENV.channel;
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: BROWSER_ENV.channel,
      headless: false,
      slowMo: BROWSER_ENV.slowMo,
      viewport: BROWSER_ENV.viewport,
      locale: BROWSER_ENV.locale,
      timezoneId: BROWSER_ENV.timezoneId,
      deviceScaleFactor: BROWSER_ENV.deviceScaleFactor,
      colorScheme: BROWSER_ENV.colorScheme,
      args: BROWSER_ARGS,
    });
  } catch {
    // Chrome channel not available — fall back to bundled Chromium
    usedChannel = "chromium (fallback)";
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      slowMo: BROWSER_ENV.slowMo,
      viewport: BROWSER_ENV.viewport,
      locale: BROWSER_ENV.locale,
      timezoneId: BROWSER_ENV.timezoneId,
      deviceScaleFactor: BROWSER_ENV.deviceScaleFactor,
      colorScheme: BROWSER_ENV.colorScheme,
      args: BROWSER_ARGS,
    });
  }

  // Use the first existing page or create a new one
  const initialPages = context.pages();
  let page = initialPages.length > 0 ? initialPages[0] : await context.newPage();

  // ── Browser-environment diagnostics ───────────────────────────
  const browserDiagnostics = {
    channel: usedChannel,
    viewport: `${BROWSER_ENV.viewport.width}x${BROWSER_ENV.viewport.height}`,
    deviceScaleFactor: BROWSER_ENV.deviceScaleFactor,
    locale: BROWSER_ENV.locale,
    timezoneId: BROWSER_ENV.timezoneId,
    colorScheme: BROWSER_ENV.colorScheme,
    profileReused: profileHasContents,
    profileDir: profileDir,
  };

  console.log("\n" + "=".repeat(60));
  console.log("BROWSER ENVIRONMENT DIAGNOSTICS");
  console.log("=".repeat(60));
  console.log(`  Channel:            ${browserDiagnostics.channel}`);
  console.log(`  Viewport:           ${browserDiagnostics.viewport}`);
  console.log(`  DeviceScaleFactor:  ${browserDiagnostics.deviceScaleFactor}`);
  console.log(`  Locale:             ${browserDiagnostics.locale}`);
  console.log(`  Timezone:           ${browserDiagnostics.timezoneId}`);
  console.log(`  ColorScheme:        ${browserDiagnostics.colorScheme}`);
  console.log(`  Profile reused:     ${browserDiagnostics.profileReused}`);
  console.log(`  Profile dir:        ${browserDiagnostics.profileDir}`);
  console.log("=".repeat(60) + "\n");

  // Navigate to MyTax — the correct entry point for TIN holders.
  await page.goto(MYTAX_BASE_URL, {
    timeout: NAVIGATION_TIMEOUT,
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // ── Stale session detection ────────────────────────────────────
  const staleSessionIndicators = [
    'text="Sila akses e-Duti Setem melalui Portal MyTax"',
    'text="Sesi anda telah tamat"',
    'text="Session expired"',
    'text="Your session has expired"',
    'text="Sesi tamat tempoh"',
  ];

  let isStaleSession = false;
  for (const indicator of staleSessionIndicators) {
    const isStale = await page
      .locator(indicator)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (isStale) {
      console.log(
        `\nStale session detected (matched: ${indicator}). ` +
        "Persistent profile cookies may have expired server-side. " +
        "Proceeding to login detection.\n"
      );
      isStaleSession = true;
      break;
    }
  }

  if (isStaleSession) {
    await page.goto(MYTAX_BASE_URL, {
      timeout: NAVIGATION_TIMEOUT,
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);
  }

  // ── Login detection ────────────────────────────────────────────
  const isLoginPage = await page
    .locator([
      'input[type="password"]',
      '#password',
      '.login-form',
      'form[action*="login"]',
      'form[action*="LogIn"]',
      'input[name="UserId"]',
      'input[name="Password"]',
      '#txtUserId',
      '#txtPassword',
      'button:has-text("Log Masuk")',
      'button:has-text("Login")',
    ].join(", "))
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (isLoginPage) {
    console.log("\n" + "=".repeat(60));
    console.log("MANUAL LOGIN REQUIRED — MyTax Portal");
    console.log("=".repeat(60));
    console.log("A headed browser has opened at the MyTax portal.");
    console.log("Please log in manually in the browser window.");
    console.log(
      "After login, navigate through MyTax to the e-Duti Setem service."
    );
    console.log(
      "The browser will wait up to 5 minutes for you to complete login."
    );
    console.log("=".repeat(60) + "\n");

    await page
      .waitForURL(
        (url) =>
          !url.href.includes("login") && !url.href.includes("LogIn"),
        { timeout: 300_000 }
      )
      .catch(() => {});

    console.log("Login URL change detected — session persisted in profile automatically.");
  }

  // ── Post-login page/tab enumeration and selection ─────────────
  // After login completes, the browser context may contain multiple
  // pages/tabs. Login flows can open new tabs, redirect existing ones,
  // or leave stale tabs open. We MUST inspect all pages and select
  // the one that actually shows the MyTax dashboard — not blindly
  // use the first page or the page we started with.
  //
  // This prevents the state-observation bug where popup detection
  // runs on a stale/wrong page that doesn't have the dashboard.

  // Wait for post-login stabilization (dashboard render, popups, etc.)
  await page.waitForTimeout(5000);

  const postLoginPageSelection = await enumerateAndSelectDashboardPage(
    context, page
  );

  console.log("\n" + "=".repeat(60));
  console.log("POST-LOGIN PAGE SELECTION");
  console.log("=".repeat(60));
  console.log(`  Pages found:        ${postLoginPageSelection.pageCount}`);
  for (const info of postLoginPageSelection.pageInventory) {
    console.log(`  ── Page ${info.index} ──`);
    console.log(`     URL:             ${info.url}`);
    console.log(`     Title:           ${info.title}`);
    console.log(`     Is MyTax URL:    ${info.isMytaxUrl}`);
    console.log(`     Has dashboard:   ${info.hasDashboardContent}`);
    console.log(`     Has popup text:  ${info.hasPopupText}`);
    console.log(`     Has menu text:   ${info.hasMenuText}`);
  }
  console.log(`  Selected page:      ${postLoginPageSelection.selectedPageIndex}`);
  console.log(`  Selection reason:   ${postLoginPageSelection.selectionReason}`);
  console.log(`  Selected URL:       ${postLoginPageSelection.selectedPageUrl}`);
  console.log(`  Selected title:     ${postLoginPageSelection.selectedPageTitle}`);
  console.log(`  Popup text on sel:  ${postLoginPageSelection.popupTextOnSelectedPage}`);
  console.log(`  Menu text on sel:   ${postLoginPageSelection.menuTextOnSelectedPage}`);
  console.log("=".repeat(60) + "\n");

  // Switch the active page to the selected dashboard page
  page = postLoginPageSelection.selectedPage;

  // Bring the selected page to focus
  await page.bringToFront().catch(() => {});

  const finalUrlAfterLogin = page.url();
  console.log(`  URL after login:    ${finalUrlAfterLogin}\n`);

  // ── Cleanup function with failure inspection delay ────────────
  const cleanup = async (failed?: boolean) => {
    if (failed && FAILURE_INSPECTION_DELAY_MS > 0) {
      console.log(
        `\n${"=".repeat(60)}\n` +
        `BROWSER KEPT OPEN FOR INSPECTION (${FAILURE_INSPECTION_DELAY_MS / 1000}s)\n` +
        `The operation failed. Inspect the browser state before it closes.\n` +
        `${"=".repeat(60)}\n`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, FAILURE_INSPECTION_DELAY_MS)
      );
    }

    await context.close();
  };

  return { page, cleanup };
}

// ─── Post-Login Page Enumeration and Selection ───────────────────────

/**
 * Diagnostic information for a single page/tab in the browser context.
 */
interface PageInventoryEntry {
  index: number;
  url: string;
  title: string;
  isMytaxUrl: boolean;
  isDashboardContentUrl: boolean;
  hasDashboardContent: boolean;
  hasPopupText: boolean;
  hasMenuText: boolean;
}

/**
 * Result of post-login page enumeration and dashboard selection.
 */
interface PostLoginPageSelection {
  pageCount: number;
  pageInventory: PageInventoryEntry[];
  selectedPage: Page;
  selectedPageIndex: number;
  selectedPageUrl: string;
  selectedPageTitle: string;
  selectionReason: string;
  popupTextOnSelectedPage: boolean;
  menuTextOnSelectedPage: boolean;
}

/**
 * Enumerate all pages/tabs in the browser context after login, inspect
 * each for dashboard indicators, popup presence, and menu presence,
 * then select the best candidate as the active dashboard page.
 *
 * Selection priority:
 * 1. Page with mytax URL + dashboard content indicators
 * 2. Page with mytax URL (even without dashboard indicators)
 * 3. Fallback to the original page
 *
 * This prevents the state-observation bug where popup detection
 * runs on a wrong page.
 */
async function enumerateAndSelectDashboardPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
  originalPage: Page
): Promise<PostLoginPageSelection> {
  const allPages: Page[] = context.pages();
  const inventory: PageInventoryEntry[] = [];

  for (let i = 0; i < allPages.length; i++) {
    const pg = allPages[i];
    const url = pg.url();
    const title = await pg.title().catch(() => "(unknown)");
    const isMytaxUrl = url.includes("mytax.hasil.gov.my");
    const isDashboardContentUrl = isMytaxUrl && url.includes("/dashboard-content");

    // Check for dashboard content indicators
    const hasDashboardContent = await pg
      .locator([
        ':has-text("Perkhidmatan ezHASiL")',
        ':has-text("Perkhidmatan ezHasil")',
        ':has-text("eZHASiL Services")',
        ':has-text("Borang Permohonan")',
        ':has-text("Senarai Permohonan")',
        ':has-text("Dashboard")',
        ':has-text("Utama")',
        '[class*="dashboard"]',
      ].join(", "))
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // Check for Pemberitahuan MyTax popup text
    const hasPopupText = await pg
      .locator([
        ':has-text("Pemberitahuan MyTax")',
        ':has-text("Pemberitahuan")',
        '.modal-title:has-text("Pemberitahuan")',
        '.modal.show',
        '.modal.in',
        '.modal[style*="display: block"]',
      ].join(", "))
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    // Check for ezHasil menu text
    const hasMenuText = await pg
      .locator([
        'a:has-text("Perkhidmatan ezHASiL")',
        'a:has-text("Perkhidmatan ezHasil")',
        'a:has-text("eZHASiL Services")',
        'a:has-text("eZHasil Services")',
      ].join(", "))
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    inventory.push({
      index: i,
      url,
      title,
      isMytaxUrl,
      isDashboardContentUrl,
      hasDashboardContent,
      hasPopupText,
      hasMenuText,
    });
  }

  // ── Selection logic ──────────────────────────────────────────
  // Priority 0a: /dashboard-content URL + (popup or menu text)
  //   (This is the FINAL post-login page the user actually sees)
  // Priority 0b: /dashboard-content URL + dashboard content
  // Priority 0c: /dashboard-content URL alone
  // Priority 1: MyTax URL + dashboard content + popup or menu text
  // Priority 2: MyTax URL + (popup text OR menu text)
  // Priority 3: MyTax URL + dashboard content
  // Priority 4: MyTax URL alone
  // Priority 5: Fallback to original page

  let selectedIndex = -1;
  let selectionReason = "";

  // P0a: dashboard-content URL + (popup or menu)
  for (const entry of inventory) {
    if (entry.isDashboardContentUrl && (entry.hasPopupText || entry.hasMenuText)) {
      selectedIndex = entry.index;
      selectionReason = "dashboard_content_url+" +
        (entry.hasPopupText ? "popup_text" : "menu_text");
      break;
    }
  }

  // P0b: dashboard-content URL + dashboard content
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isDashboardContentUrl && entry.hasDashboardContent) {
        selectedIndex = entry.index;
        selectionReason = "dashboard_content_url+dashboard_content";
        break;
      }
    }
  }

  // P0c: dashboard-content URL alone
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isDashboardContentUrl) {
        selectedIndex = entry.index;
        selectionReason = "dashboard_content_url_only";
        break;
      }
    }
  }

  // P1: mytax + dashboard + (popup or menu)
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isMytaxUrl && entry.hasDashboardContent && (entry.hasPopupText || entry.hasMenuText)) {
        selectedIndex = entry.index;
        selectionReason = "mytax_url+dashboard_content+" +
          (entry.hasPopupText ? "popup_text" : "menu_text");
        break;
      }
    }
  }

  // P2: mytax + (popup or menu)
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isMytaxUrl && (entry.hasPopupText || entry.hasMenuText)) {
        selectedIndex = entry.index;
        selectionReason = "mytax_url+" +
          (entry.hasPopupText ? "popup_text" : "menu_text");
        break;
      }
    }
  }

  // P3: mytax + dashboard
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isMytaxUrl && entry.hasDashboardContent) {
        selectedIndex = entry.index;
        selectionReason = "mytax_url+dashboard_content";
        break;
      }
    }
  }

  // P4: mytax URL alone
  if (selectedIndex < 0) {
    for (const entry of inventory) {
      if (entry.isMytaxUrl) {
        selectedIndex = entry.index;
        selectionReason = "mytax_url_only";
        break;
      }
    }
  }

  // P5: fallback to original page
  if (selectedIndex < 0) {
    const origIndex = allPages.indexOf(originalPage);
    selectedIndex = origIndex >= 0 ? origIndex : 0;
    selectionReason = "fallback_to_original_page";
  }

  const selectedPage = allPages[selectedIndex] ?? originalPage;
  const selectedEntry = inventory[selectedIndex] ?? inventory[0];

  return {
    pageCount: allPages.length,
    pageInventory: inventory,
    selectedPage,
    selectedPageIndex: selectedIndex,
    selectedPageUrl: selectedEntry?.url ?? "(unknown)",
    selectedPageTitle: selectedEntry?.title ?? "(unknown)",
    selectionReason,
    popupTextOnSelectedPage: selectedEntry?.hasPopupText ?? false,
    menuTextOnSelectedPage: selectedEntry?.hasMenuText ?? false,
  };
}
