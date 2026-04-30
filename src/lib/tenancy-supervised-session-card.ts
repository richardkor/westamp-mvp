/**
 * WeStamp — Tenancy Supervised Session · Browser Session Status Card view-model
 *
 * Pure helper that converts the four UI lifecycle states (idle,
 * loading, ready, error) into a stable, render-ready view-model
 * for the operator-side `Browser Session Status` card.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the B4 wording shown on the
 *   `Browser Session Status` card.
 * - A defensive sanitizer over the inbound `SupervisedSessionReport`
 *   — the report itself is already invariant-checked by the B3
 *   helper, but we re-derive only the safe scalars / counts here so
 *   the rendered surface cannot accidentally bypass the invariant.
 * - The component-test surface for the brief's UI test
 *   requirements (5–8): wording presence, no-execution wording,
 *   non-mutating button label, marker booleans/counts only.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute anything. The view-model is metadata only.
 * - It does NOT add any portal-mutation affordance.
 * - It does NOT touch payment, certificate retrieval, OCR, or any
 *   user-review surface.
 *
 * Forbidden wording (per the B4 brief)
 * ────────────────────────────────────
 * The view-model never emits any of:
 *   - "started run"
 *   - "executing"
 *   - "submitted"
 *   - "sent to LHDN"
 *   - "paid"
 *   - "certificate retrieved"
 *   - "portal action completed"
 * Test 6 in `tenancy-supervised-session-card.test.ts` enforces
 * this graph-wide.
 */

import type {
  GraphPhaseCompatibility,
  SupervisedSessionPageKind,
  SupervisedSessionReport,
  SupervisedSessionSafeMarkers,
  SupervisedSessionStatus,
} from "./tenancy-supervised-session-shell";

// ─── Approved B4 wording (constants) ───────────────────────────────

export const CARD_HEADING = "Browser Session Status";

export const CARD_HELPER_TEXT =
  "Checks whether the operator's existing Chrome session is positioned for the planned supervised run. Read-only inspection only.";

export const CARD_BUTTON_LABEL = "Check Browser Session";
export const CARD_BUTTON_LOADING_LABEL = "Checking…";

export const CARD_NON_EXECUTION_NOTE =
  "Read-only inspection only. No portal action has been taken.";

export const CARD_INITIAL_STATUS = "Not checked yet";

/** Approved status strings (verbatim from the brief's "Status examples"). */
export const STATUS_CHROME_NOT_REACHABLE = "Chrome not reachable";
export const STATUS_CHROME_REACHABLE = "Chrome reachable";
export const STATUS_P5_DETECTED = "Sewa/Pajakan p5 form detected";
export const STATUS_ROLE_CHANGE_DETECTED = "Role-change page detected";
export const STATUS_STAMPS_DASHBOARD_DETECTED = "e-Duti Setem dashboard detected";
export const STATUS_MYTAX_DETECTED = "MyTax dashboard detected";
export const STATUS_PAGE_NOT_RECOGNISED = "Page not recognised";

/** Phase-compatibility human labels. */
export const PHASE_COMPATIBILITY_LABELS: Record<
  GraphPhaseCompatibility,
  string
> = {
  compatible: "Compatible",
  incompatible: "Incompatible",
  unknown: "Not yet known",
};

/** Default safe error text shown when the API returns `{ ok: false }`. */
export const CARD_ERROR_FALLBACK =
  "Inspection failed. Verify Chrome is launched with remote debugging enabled.";

// ─── Public types ──────────────────────────────────────────────────

/** UI lifecycle for the card. */
export type BrowserSessionStatusCardLifecycle =
  | "idle"
  | "loading"
  | "ready"
  | "error";

/** Compact marker summary surfaced in the card. Booleans + counts only. */
export interface BrowserSessionStatusMarkerSummary {
  /** Total count of all marker flags that are `true`. */
  presentCount: number;
  /** Total marker flags WeStamp tracks (always 16 in B3). */
  totalCount: number;
  /** P5 select / input markers that are `true` (subset of presentCount). */
  p5SelectsPresent: number;
  /** Total P5 select / input markers (always 9 in B3). */
  p5SelectsTotal: number;
  /** Tab-presence markers that are `true` (subset of presentCount). */
  tabsPresent: number;
  /** Total tab-presence markers (always 7 in B3). */
  tabsTotal: number;
  /** Per-marker booleans for the operator's detail panel. Read-only. */
  flags: SupervisedSessionSafeMarkers;
}

/** Top-level view-model the React card renders. */
export interface BrowserSessionStatusCardViewModel {
  heading: string;
  helperText: string;
  buttonLabel: string;
  loadingLabel: string;
  nonExecutionNote: string;

  /** Current lifecycle state. */
  state: BrowserSessionStatusCardLifecycle;

  /** Status text for the badge — always one of the approved strings. */
  statusText: string;

  /**
   * Page-kind label (mirrors `statusText` for the four detected
   * page kinds; differs when the underlying status is reachable-
   * but-no-pages).
   */
  pageKindLabel: string;

  /** Total candidate page count from the report. Small integer. */
  candidatePageCount: number;

  /** Stable phase-compatibility label. */
  phaseCompatibilityLabel: string;

  /** Compact marker summary. */
  markerSummary: BrowserSessionStatusMarkerSummary;

  /** Operator-action sentence pulled verbatim from the report. */
  recommendedOperatorAction: string;

  /** Populated only when `state === "error"`. */
  errorMessage: string | null;

  /** Whether the button is disabled (loading or unmounted). */
  buttonDisabled: boolean;
}

/** Builder input. */
export interface BuildBrowserSessionStatusCardInput {
  state: BrowserSessionStatusCardLifecycle;
  /** Last successful report. Only consumed when `state === "ready"`. */
  report?: SupervisedSessionReport | null;
  /** Last error. Only consumed when `state === "error"`. */
  errorMessage?: string | null;
}

// ─── Internal label maps ───────────────────────────────────────────

/**
 * Map a session status to its approved badge text. The `cdp_unreachable`
 * and `chrome_reachable_no_pages` cases are not "page kinds" in the
 * brief's sense — they map to "Chrome not reachable" and "Chrome
 * reachable" respectively.
 */
const STATUS_BADGE_BY_STATUS: Record<SupervisedSessionStatus, string> = {
  cdp_unreachable: STATUS_CHROME_NOT_REACHABLE,
  chrome_reachable_no_pages: STATUS_CHROME_REACHABLE,
  mytax_dashboard: STATUS_MYTAX_DETECTED,
  stamps_role_change: STATUS_ROLE_CHANGE_DETECTED,
  stamps_dashboard: STATUS_STAMPS_DASHBOARD_DETECTED,
  sewa_pajakan_p5_form: STATUS_P5_DETECTED,
  unknown_page: STATUS_PAGE_NOT_RECOGNISED,
};

/**
 * Map a page-kind to its approved label. Different from
 * `STATUS_BADGE_BY_STATUS` because the page-kind label is the most
 * specific descriptor of WHICH page WeStamp identified.
 */
const PAGE_KIND_LABELS: Record<SupervisedSessionPageKind, string> = {
  mytax_dashboard: STATUS_MYTAX_DETECTED,
  stamps_role_change: STATUS_ROLE_CHANGE_DETECTED,
  stamps_dashboard: STATUS_STAMPS_DASHBOARD_DETECTED,
  sewa_pajakan_p5_form: STATUS_P5_DETECTED,
  unknown: STATUS_PAGE_NOT_RECOGNISED,
};

// ─── Public builder ────────────────────────────────────────────────

/**
 * Build the `Browser Session Status` view-model. Pure. Total. Free
 * of I/O. Sensitive-data-safe by construction:
 *   - Status / page-kind labels come from a closed mapping table.
 *   - Counts are integers derived from the report.
 *   - Marker flags are forwarded by reference but contain only
 *     booleans (no values, no labels).
 *   - The operator-action sentence is forwarded from the B3
 *     helper, which itself draws from a fixed vocabulary.
 *   - The error message is sanitized (clamped to the safe fallback
 *     when not provided).
 */
export function buildBrowserSessionStatusCardViewModel(
  input: BuildBrowserSessionStatusCardInput
): BrowserSessionStatusCardViewModel {
  const { state, report, errorMessage } = input;

  const baseConstants = {
    heading: CARD_HEADING,
    helperText: CARD_HELPER_TEXT,
    buttonLabel: CARD_BUTTON_LABEL,
    loadingLabel: CARD_BUTTON_LOADING_LABEL,
    nonExecutionNote: CARD_NON_EXECUTION_NOTE,
  } as const;

  if (state === "idle") {
    return {
      ...baseConstants,
      state,
      statusText: CARD_INITIAL_STATUS,
      pageKindLabel: CARD_INITIAL_STATUS,
      candidatePageCount: 0,
      phaseCompatibilityLabel: PHASE_COMPATIBILITY_LABELS.unknown,
      markerSummary: emptyMarkerSummary(),
      recommendedOperatorAction: "",
      errorMessage: null,
      buttonDisabled: false,
    };
  }

  if (state === "loading") {
    return {
      ...baseConstants,
      state,
      statusText: CARD_BUTTON_LOADING_LABEL,
      pageKindLabel: CARD_BUTTON_LOADING_LABEL,
      candidatePageCount: 0,
      phaseCompatibilityLabel: PHASE_COMPATIBILITY_LABELS.unknown,
      markerSummary: emptyMarkerSummary(),
      recommendedOperatorAction: "",
      errorMessage: null,
      buttonDisabled: true,
    };
  }

  if (state === "error") {
    return {
      ...baseConstants,
      state,
      statusText: CARD_INITIAL_STATUS,
      pageKindLabel: CARD_INITIAL_STATUS,
      candidatePageCount: 0,
      phaseCompatibilityLabel: PHASE_COMPATIBILITY_LABELS.unknown,
      markerSummary: emptyMarkerSummary(),
      recommendedOperatorAction: "",
      errorMessage:
        typeof errorMessage === "string" && errorMessage.trim().length > 0
          ? errorMessage
          : CARD_ERROR_FALLBACK,
      buttonDisabled: false,
    };
  }

  // state === "ready"
  if (!report) {
    // Defensive — reachable callers never hit this branch (a
    // "ready" state always carries a report) but if one does we
    // collapse to the safe error path rather than crash.
    return {
      ...baseConstants,
      state: "error",
      statusText: CARD_INITIAL_STATUS,
      pageKindLabel: CARD_INITIAL_STATUS,
      candidatePageCount: 0,
      phaseCompatibilityLabel: PHASE_COMPATIBILITY_LABELS.unknown,
      markerSummary: emptyMarkerSummary(),
      recommendedOperatorAction: "",
      errorMessage: CARD_ERROR_FALLBACK,
      buttonDisabled: false,
    };
  }

  const statusText = STATUS_BADGE_BY_STATUS[report.status];
  const pageKindLabel = PAGE_KIND_LABELS[report.pageKind];
  const phaseCompatibilityLabel =
    PHASE_COMPATIBILITY_LABELS[report.graphPhaseCompatibility];

  return {
    ...baseConstants,
    state,
    statusText,
    pageKindLabel,
    candidatePageCount: report.candidatePageCount,
    phaseCompatibilityLabel,
    markerSummary: summariseMarkers(report.safeMarkers),
    recommendedOperatorAction: report.recommendedOperatorAction,
    errorMessage: null,
    buttonDisabled: false,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

const P5_SELECT_KEYS = [
  "pdsSuratcaraPresent",
  "pdsJenisPresent",
  "pdsSalinanPresent",
  "pdsHartaStatePresent",
  "pdsHartaCountryPresent",
  "pdsHartaTypePresent",
  "pdsHartaPerabotPresent",
  "pdsLuasUnitPresent",
  "pdsAlamat1Present",
] as const satisfies ReadonlyArray<keyof SupervisedSessionSafeMarkers>;

const TAB_KEYS = [
  "hasMaklumatAmTab",
  "hasBahagianATab",
  "hasBahagianBTab",
  "hasBahagianCTab",
  "hasLampiranTab",
  "hasRumusanTab",
  "hasPerakuanTab",
] as const satisfies ReadonlyArray<keyof SupervisedSessionSafeMarkers>;

function summariseMarkers(
  markers: SupervisedSessionSafeMarkers
): BrowserSessionStatusMarkerSummary {
  let p5SelectsPresent = 0;
  for (const key of P5_SELECT_KEYS) {
    if (markers[key] === true) p5SelectsPresent++;
  }
  let tabsPresent = 0;
  for (const key of TAB_KEYS) {
    if (markers[key] === true) tabsPresent++;
  }
  return {
    presentCount: p5SelectsPresent + tabsPresent,
    totalCount: P5_SELECT_KEYS.length + TAB_KEYS.length,
    p5SelectsPresent,
    p5SelectsTotal: P5_SELECT_KEYS.length,
    tabsPresent,
    tabsTotal: TAB_KEYS.length,
    flags: { ...markers },
  };
}

function emptyMarkerSummary(): BrowserSessionStatusMarkerSummary {
  return {
    presentCount: 0,
    totalCount: P5_SELECT_KEYS.length + TAB_KEYS.length,
    p5SelectsPresent: 0,
    p5SelectsTotal: P5_SELECT_KEYS.length,
    tabsPresent: 0,
    tabsTotal: TAB_KEYS.length,
    flags: {
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
    },
  };
}
