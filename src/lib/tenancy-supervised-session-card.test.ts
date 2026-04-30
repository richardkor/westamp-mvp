/**
 * WeStamp — Tenancy Supervised Session · card view-model tests
 *
 * Covers Milestone B4 (UI side): the
 * `buildBrowserSessionStatusCardViewModel` helper that powers the
 * operator's `Browser Session Status` card.
 *
 * Test coverage maps to the brief's TEST REQUIREMENTS:
 *   5. UI view-model shows approved wording;
 *   6. UI does not contain forbidden execution wording;
 *   7. `Check Browser Session` is non-mutating wording;
 *   8. marker summary uses booleans/counts only.
 *
 * Plus the standing invariant test set: sensitive-data + lifecycle.
 */

import {
  buildBrowserSessionStatusCardViewModel,
  CARD_BUTTON_LABEL,
  CARD_BUTTON_LOADING_LABEL,
  CARD_ERROR_FALLBACK,
  CARD_HEADING,
  CARD_HELPER_TEXT,
  CARD_INITIAL_STATUS,
  CARD_NON_EXECUTION_NOTE,
  PHASE_COMPATIBILITY_LABELS,
  STATUS_CHROME_NOT_REACHABLE,
  STATUS_CHROME_REACHABLE,
  STATUS_MYTAX_DETECTED,
  STATUS_PAGE_NOT_RECOGNISED,
  STATUS_P5_DETECTED,
  STATUS_ROLE_CHANGE_DETECTED,
  STATUS_STAMPS_DASHBOARD_DETECTED,
  type BrowserSessionStatusCardViewModel,
} from "./tenancy-supervised-session-card";
import {
  ABSENT_MARKERS,
  type SupervisedSessionReport,
  type SupervisedSessionStatus,
} from "./tenancy-supervised-session-shell";

// ─── Fixture helpers ──────────────────────────────────────────────

function reportFor(
  status: SupervisedSessionStatus,
  overrides: Partial<SupervisedSessionReport> = {}
): SupervisedSessionReport {
  const base: SupervisedSessionReport = {
    status,
    reachable: status !== "cdp_unreachable",
    candidatePageCount:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? 0
        : 1,
    selectedPageKind:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? "unknown"
        : status === "unknown_page"
          ? "unknown"
          : status,
    pageKind:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? "unknown"
        : status === "unknown_page"
          ? "unknown"
          : status,
    pathKind:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? "other"
        : status === "unknown_page"
          ? "other"
          : status,
    safeMarkers: { ...ABSENT_MARKERS },
    graphPhaseCompatibility: "unknown",
    recommendedOperatorAction: "Ready for read-only phase-position verification.",
    reason: "test fixture",
  };
  return { ...base, ...overrides };
}

// ─── Test 1 · Lifecycle states ────────────────────────────────────

describe("Card view-model · lifecycle states", () => {
  test("idle state shows the initial status and a non-disabled button", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "idle" });
    expect(vm.state).toBe("idle");
    expect(vm.statusText).toBe(CARD_INITIAL_STATUS);
    expect(vm.pageKindLabel).toBe(CARD_INITIAL_STATUS);
    expect(vm.candidatePageCount).toBe(0);
    expect(vm.phaseCompatibilityLabel).toBe(
      PHASE_COMPATIBILITY_LABELS.unknown
    );
    expect(vm.markerSummary.presentCount).toBe(0);
    expect(vm.markerSummary.totalCount).toBe(16);
    expect(vm.recommendedOperatorAction).toBe("");
    expect(vm.errorMessage).toBeNull();
    expect(vm.buttonDisabled).toBe(false);
  });

  test("loading state shows the loading label and disables the button", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "loading" });
    expect(vm.state).toBe("loading");
    expect(vm.statusText).toBe(CARD_BUTTON_LOADING_LABEL);
    expect(vm.buttonDisabled).toBe(true);
  });

  test("error state with a custom message preserves it", () => {
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "error",
      errorMessage: "Network down — please retry.",
    });
    expect(vm.state).toBe("error");
    expect(vm.errorMessage).toBe("Network down — please retry.");
    expect(vm.buttonDisabled).toBe(false);
  });

  test("error state without a message uses the safe fallback", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "error" });
    expect(vm.errorMessage).toBe(CARD_ERROR_FALLBACK);
  });

  test("ready state without a report degrades to the error fallback (defensive)", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "ready" });
    expect(vm.state).toBe("error");
    expect(vm.errorMessage).toBe(CARD_ERROR_FALLBACK);
  });
});

// ─── Test 2 · Approved status text per page kind ──────────────────

describe("Card view-model · approved status badges", () => {
  type Case = {
    status: SupervisedSessionStatus;
    expected: string;
  };
  const CASES: Case[] = [
    { status: "cdp_unreachable", expected: STATUS_CHROME_NOT_REACHABLE },
    { status: "chrome_reachable_no_pages", expected: STATUS_CHROME_REACHABLE },
    { status: "mytax_dashboard", expected: STATUS_MYTAX_DETECTED },
    { status: "stamps_role_change", expected: STATUS_ROLE_CHANGE_DETECTED },
    {
      status: "stamps_dashboard",
      expected: STATUS_STAMPS_DASHBOARD_DETECTED,
    },
    { status: "sewa_pajakan_p5_form", expected: STATUS_P5_DETECTED },
    { status: "unknown_page", expected: STATUS_PAGE_NOT_RECOGNISED },
  ];

  test.each(CASES)("%# %s → %s", ({ status, expected }) => {
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: reportFor(status),
    });
    expect(vm.statusText).toBe(expected);
  });
});

// ─── Test 3 · Phase compatibility labels ──────────────────────────

describe("Card view-model · phase compatibility labels", () => {
  test.each([
    { compat: "compatible", label: "Compatible" },
    { compat: "incompatible", label: "Incompatible" },
    { compat: "unknown", label: "Not yet known" },
  ] as const)(
    "%# %s → %s",
    ({ compat, label }) => {
      const vm = buildBrowserSessionStatusCardViewModel({
        state: "ready",
        report: reportFor("sewa_pajakan_p5_form", {
          graphPhaseCompatibility: compat,
        }),
      });
      expect(vm.phaseCompatibilityLabel).toBe(label);
    }
  );
});

// ─── Test 4 · Marker summary uses booleans/counts only ────────────

describe("Card view-model · marker summary", () => {
  test("counts P5 selects + tabs correctly when all markers are true", () => {
    const allTrue: SupervisedSessionReport = reportFor("sewa_pajakan_p5_form", {
      safeMarkers: {
        pdsSuratcaraPresent: true,
        pdsJenisPresent: true,
        pdsSalinanPresent: true,
        pdsHartaStatePresent: true,
        pdsHartaCountryPresent: true,
        pdsHartaTypePresent: true,
        pdsHartaPerabotPresent: true,
        pdsLuasUnitPresent: true,
        pdsAlamat1Present: true,
        hasMaklumatAmTab: true,
        hasBahagianATab: true,
        hasBahagianBTab: true,
        hasBahagianCTab: true,
        hasLampiranTab: true,
        hasRumusanTab: true,
        hasPerakuanTab: true,
      },
    });
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: allTrue,
    });
    expect(vm.markerSummary.presentCount).toBe(16);
    expect(vm.markerSummary.totalCount).toBe(16);
    expect(vm.markerSummary.p5SelectsPresent).toBe(9);
    expect(vm.markerSummary.p5SelectsTotal).toBe(9);
    expect(vm.markerSummary.tabsPresent).toBe(7);
    expect(vm.markerSummary.tabsTotal).toBe(7);
  });

  test("counts only the true markers when a partial subset is set", () => {
    const partial: SupervisedSessionReport = reportFor(
      "sewa_pajakan_p5_form",
      {
        safeMarkers: {
          ...ABSENT_MARKERS,
          pdsJenisPresent: true,
          pdsSuratcaraPresent: true,
          hasMaklumatAmTab: true,
        },
      }
    );
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: partial,
    });
    expect(vm.markerSummary.p5SelectsPresent).toBe(2);
    expect(vm.markerSummary.tabsPresent).toBe(1);
    expect(vm.markerSummary.presentCount).toBe(3);
  });

  test("flags object contains only booleans", () => {
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: reportFor("sewa_pajakan_p5_form", {
        safeMarkers: {
          ...ABSENT_MARKERS,
          pdsJenisPresent: true,
          hasBahagianBTab: true,
        },
      }),
    });
    for (const [key, value] of Object.entries(vm.markerSummary.flags)) {
      expect({ key, type: typeof value }).toEqual({
        key,
        type: "boolean",
      });
    }
  });
});

// ─── Test 5 · Approved wording constants ──────────────────────────

describe("Card view-model · approved wording constants", () => {
  test("each B4 constant matches the brief verbatim", () => {
    expect(CARD_HEADING).toBe("Browser Session Status");
    expect(CARD_HELPER_TEXT).toBe(
      "Checks whether the operator's existing Chrome session is positioned for the planned supervised run. Read-only inspection only."
    );
    expect(CARD_BUTTON_LABEL).toBe("Check Browser Session");
    expect(CARD_NON_EXECUTION_NOTE).toBe(
      "Read-only inspection only. No portal action has been taken."
    );
    expect(CARD_INITIAL_STATUS).toBe("Not checked yet");
    expect(STATUS_CHROME_NOT_REACHABLE).toBe("Chrome not reachable");
    expect(STATUS_CHROME_REACHABLE).toBe("Chrome reachable");
    expect(STATUS_P5_DETECTED).toBe("Sewa/Pajakan p5 form detected");
    expect(STATUS_ROLE_CHANGE_DETECTED).toBe("Role-change page detected");
    expect(STATUS_STAMPS_DASHBOARD_DETECTED).toBe(
      "e-Duti Setem dashboard detected"
    );
    expect(STATUS_MYTAX_DETECTED).toBe("MyTax dashboard detected");
    expect(STATUS_PAGE_NOT_RECOGNISED).toBe("Page not recognised");
  });
});

// ─── Test 6 · Forbidden wording invariant ─────────────────────────

describe("Card view-model · forbidden wording invariant", () => {
  const FORBIDDEN_WORDING: { pattern: RegExp; label: string }[] = [
    { pattern: /\bstarted run\b/i, label: "started run" },
    { pattern: /\bexecuting\b/i, label: "executing" },
    { pattern: /\bsubmitted\b/i, label: "submitted" },
    { pattern: /\bsent to LHDN\b/i, label: "sent to LHDN" },
    { pattern: /\bpaid\b/i, label: "paid" },
    { pattern: /\bcertificate retrieved\b/i, label: "certificate retrieved" },
    {
      pattern: /\bportal action completed\b/i,
      label: "portal action completed",
    },
  ];

  const STATES: BrowserSessionStatusCardViewModel[] = [
    buildBrowserSessionStatusCardViewModel({ state: "idle" }),
    buildBrowserSessionStatusCardViewModel({ state: "loading" }),
    buildBrowserSessionStatusCardViewModel({
      state: "error",
      errorMessage: "Network failure.",
    }),
    buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: reportFor("sewa_pajakan_p5_form"),
    }),
    buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: reportFor("cdp_unreachable"),
    }),
  ];

  test.each(STATES)("%# state contains no forbidden wording", (vm) => {
    const serialized = JSON.stringify(vm);
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched in card view-model: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 7 · Button label is non-mutating ────────────────────────

describe("Card view-model · button label", () => {
  test("button label is exactly the approved Check Browser Session", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "idle" });
    expect(vm.buttonLabel).toBe("Check Browser Session");
  });

  test("button label contains no portal-mutation imperatives", () => {
    const vm = buildBrowserSessionStatusCardViewModel({ state: "idle" });
    const FORBIDDEN: RegExp[] = [
      /\bStart\b/,
      /\bExecute\b/i,
      /\bSubmit\b/i,
      /\bSend\b/i,
      /\bPay\b/i,
      /\bUpload to portal\b/i,
      /\bHantar\b/i,
    ];
    for (const pattern of FORBIDDEN) {
      expect({
        pattern: pattern.source,
        hit: pattern.test(vm.buttonLabel),
      }).toEqual({ pattern: pattern.source, hit: false });
    }
  });
});

// ─── Test 8 · Sensitive-data invariant ────────────────────────────

describe("Card view-model · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
  ];

  test.each([
    { label: "idle", state: "idle" as const },
    { label: "loading", state: "loading" as const },
    {
      label: "error",
      state: "error" as const,
      errorMessage: "Network down — please retry.",
    },
  ])("$label state JSON is sensitive-data-free", ({ state, errorMessage }) => {
    const vm = buildBrowserSessionStatusCardViewModel({
      state,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    });
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched: ${m?.[0]}`
        );
      }
    }
  });

  test("ready state with full markers JSON is sensitive-data-free", () => {
    const vm = buildBrowserSessionStatusCardViewModel({
      state: "ready",
      report: reportFor("sewa_pajakan_p5_form", {
        safeMarkers: {
          pdsSuratcaraPresent: true,
          pdsJenisPresent: true,
          pdsSalinanPresent: true,
          pdsHartaStatePresent: true,
          pdsHartaCountryPresent: true,
          pdsHartaTypePresent: true,
          pdsHartaPerabotPresent: true,
          pdsLuasUnitPresent: true,
          pdsAlamat1Present: true,
          hasMaklumatAmTab: true,
          hasBahagianATab: true,
          hasBahagianBTab: true,
          hasBahagianCTab: true,
          hasLampiranTab: true,
          hasRumusanTab: true,
          hasPerakuanTab: true,
        },
      }),
    });
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });
});
