/**
 * WeStamp — Tenancy Supervised Session · Phase-Positioning tests
 *
 * Covers Milestone B5 Part B: the multi-phase positioning summary
 * that surfaces per-phase browser-position compatibility on the
 * Browser Session Status card.
 *
 * Test coverage:
 *   1. CDP unreachable → all rows = unknown, overall = unknown
 *   2. p5 detected → all rows = compatible, overall mirrors target
 *   3. role-change detected → only Phase 1 is compatible
 *   4. e-Duti dashboard detected → only Phase 1 is compatible
 *   5. MyTax dashboard detected → all rows incompatible
 *   6. unknown page → all rows = unknown
 *   7. forbidden wording absent
 *   8. sensitive-data invariant
 *   9. approved-wording constants
 */

import {
  buildPhasePositioningSummary,
  PHASE_COMPAT_LABEL_COMPATIBLE,
  PHASE_COMPAT_LABEL_INCOMPATIBLE,
  PHASE_COMPAT_LABEL_UNKNOWN,
  PHASE_LABEL_LATER_P5,
  PHASE_LABEL_PHASE_1,
  PHASE_LABEL_PHASE_2,
  SUMMARY_COMPATIBLE,
  SUMMARY_NOT_COMPATIBLE,
  SUMMARY_UNKNOWN,
  type PhaseGroupId,
} from "./tenancy-supervised-phase-positioning";
import {
  ABSENT_MARKERS,
  type GraphPhaseCompatibility,
  type SupervisedSessionPageKind,
  type SupervisedSessionReport,
  type SupervisedSessionStatus,
} from "./tenancy-supervised-session-shell";

// ─── Fixture helpers ──────────────────────────────────────────────

function reportFor(
  status: SupervisedSessionStatus,
  graphPhaseCompatibility: GraphPhaseCompatibility = "unknown"
): SupervisedSessionReport {
  const pageKind: SupervisedSessionPageKind =
    status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
      ? "unknown"
      : status === "unknown_page"
        ? "unknown"
        : status;
  return {
    status,
    reachable: status !== "cdp_unreachable",
    candidatePageCount:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? 0
        : 1,
    selectedPageKind: pageKind,
    pageKind,
    pathKind:
      status === "cdp_unreachable" || status === "chrome_reachable_no_pages"
        ? "other"
        : status === "unknown_page"
          ? "other"
          : status,
    safeMarkers: { ...ABSENT_MARKERS },
    graphPhaseCompatibility,
    recommendedOperatorAction: "Ready for read-only phase-position verification.",
    reason: "test fixture",
  };
}

// ─── Test 1 · CDP unreachable ─────────────────────────────────────

describe("Phase positioning · CDP unreachable", () => {
  test("all rows are unknown", () => {
    const sum = buildPhasePositioningSummary(reportFor("cdp_unreachable"));
    expect(sum.rows.map((r) => r.compatibility)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(sum.overallSummary).toBe(SUMMARY_UNKNOWN);
  });
});

// ─── Test 2 · p5 detected ─────────────────────────────────────────

describe("Phase positioning · p5 detected", () => {
  test("Phase 1 incompatible (p5 is for Phase 2+); Phase 2 + later p5 compatible", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("sewa_pajakan_p5_form", "compatible")
    );
    const byId = new Map<PhaseGroupId, GraphPhaseCompatibility>(
      sum.rows.map((r) => [r.phaseGroupId, r.compatibility])
    );
    expect(byId.get("phase_1_session_positioning")).toBe("incompatible");
    expect(byId.get("phase_2_maklumat_am_draft")).toBe("compatible");
    expect(byId.get("later_p5_form_phases")).toBe("compatible");
    // overallSummary mirrors the report's primary compat (compatible).
    expect(sum.overallSummary).toBe(SUMMARY_COMPATIBLE);
  });
});

// ─── Test 3 · stamps_role_change detected ─────────────────────────

describe("Phase positioning · role-change detected", () => {
  test("Phase 1 compatible; Phase 2 + later p5 incompatible", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("stamps_role_change", "compatible")
    );
    const byId = new Map<PhaseGroupId, GraphPhaseCompatibility>(
      sum.rows.map((r) => [r.phaseGroupId, r.compatibility])
    );
    expect(byId.get("phase_1_session_positioning")).toBe("compatible");
    expect(byId.get("phase_2_maklumat_am_draft")).toBe("incompatible");
    expect(byId.get("later_p5_form_phases")).toBe("incompatible");
  });
});

// ─── Test 4 · stamps_dashboard detected ───────────────────────────

describe("Phase positioning · e-Duti dashboard detected", () => {
  test("Phase 1 compatible; Phase 2 + later p5 incompatible", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("stamps_dashboard", "compatible")
    );
    const byId = new Map<PhaseGroupId, GraphPhaseCompatibility>(
      sum.rows.map((r) => [r.phaseGroupId, r.compatibility])
    );
    expect(byId.get("phase_1_session_positioning")).toBe("compatible");
    expect(byId.get("phase_2_maklumat_am_draft")).toBe("incompatible");
    expect(byId.get("later_p5_form_phases")).toBe("incompatible");
  });
});

// ─── Test 5 · MyTax dashboard detected ────────────────────────────

describe("Phase positioning · MyTax dashboard detected", () => {
  test("all three rows are incompatible", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("mytax_dashboard", "incompatible")
    );
    expect(sum.rows.map((r) => r.compatibility)).toEqual([
      "incompatible",
      "incompatible",
      "incompatible",
    ]);
    expect(sum.overallSummary).toBe(SUMMARY_NOT_COMPATIBLE);
  });
});

// ─── Test 6 · unknown_page detected ───────────────────────────────

describe("Phase positioning · unknown page", () => {
  test("all rows are unknown when WeStamp does not recognise the page", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("unknown_page", "unknown")
    );
    expect(sum.rows.map((r) => r.compatibility)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(sum.overallSummary).toBe(SUMMARY_UNKNOWN);
  });
});

// ─── Test 7 · Row order + labels ──────────────────────────────────

describe("Phase positioning · row order + labels", () => {
  test("rows always appear in canonical order with stable labels", () => {
    const sum = buildPhasePositioningSummary(
      reportFor("sewa_pajakan_p5_form", "compatible")
    );
    expect(sum.rows.map((r) => r.phaseGroupId)).toEqual([
      "phase_1_session_positioning",
      "phase_2_maklumat_am_draft",
      "later_p5_form_phases",
    ]);
    expect(sum.rows[0].phaseLabel).toBe(PHASE_LABEL_PHASE_1);
    expect(sum.rows[1].phaseLabel).toBe(PHASE_LABEL_PHASE_2);
    expect(sum.rows[2].phaseLabel).toBe(PHASE_LABEL_LATER_P5);
  });

  test("compatibility labels match approved strings", () => {
    const compat = buildPhasePositioningSummary(
      reportFor("sewa_pajakan_p5_form", "compatible")
    );
    expect(compat.rows[1].compatibilityLabel).toBe(
      PHASE_COMPAT_LABEL_COMPATIBLE
    );
    const incompat = buildPhasePositioningSummary(
      reportFor("mytax_dashboard", "incompatible")
    );
    expect(incompat.rows[0].compatibilityLabel).toBe(
      PHASE_COMPAT_LABEL_INCOMPATIBLE
    );
    const unknown = buildPhasePositioningSummary(
      reportFor("cdp_unreachable")
    );
    expect(unknown.rows[0].compatibilityLabel).toBe(
      PHASE_COMPAT_LABEL_UNKNOWN
    );
  });
});

// ─── Test 8 · Forbidden wording invariant ─────────────────────────

describe("Phase positioning · forbidden wording", () => {
  const FORBIDDEN: RegExp[] = [
    /\bStart automation\b/i,
    /\bStart portal run\b/i,
    /\bExecute\b/i,
    /\bSubmit\b/i,
    /\bSend to LHDN\b/i,
    /\bPortal action completed\b/i,
    /\bReady to submit\b/i,
  ];

  const STATUSES: SupervisedSessionStatus[] = [
    "cdp_unreachable",
    "chrome_reachable_no_pages",
    "mytax_dashboard",
    "stamps_role_change",
    "stamps_dashboard",
    "sewa_pajakan_p5_form",
    "unknown_page",
  ];

  test.each(STATUSES)("%s contains no forbidden wording", (status) => {
    const sum = buildPhasePositioningSummary(reportFor(status));
    const serialized = JSON.stringify(sum);
    for (const pattern of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording matched: ${m?.[0]} (status=${status})`
        );
      }
    }
  });
});

// ─── Test 9 · Sensitive-data invariant ────────────────────────────

describe("Phase positioning · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "13-digit-or-longer ID", pattern: /\b\d{13,}\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
  ];
  const STATUSES: SupervisedSessionStatus[] = [
    "cdp_unreachable",
    "chrome_reachable_no_pages",
    "mytax_dashboard",
    "stamps_role_change",
    "stamps_dashboard",
    "sewa_pajakan_p5_form",
    "unknown_page",
  ];
  test.each(STATUSES)("%s produces a sensitive-data-free summary", (status) => {
    const sum = buildPhasePositioningSummary(reportFor(status));
    const serialized = JSON.stringify(sum);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched: ${m?.[0]} (status=${status})`
        );
      }
    }
  });
});

// ─── Test 10 · Approved-wording constants ─────────────────────────

describe("Phase positioning · approved-wording constants", () => {
  test("each B5 string matches the brief verbatim", () => {
    expect(PHASE_LABEL_PHASE_1).toBe("Phase 1 — session positioning");
    expect(PHASE_LABEL_PHASE_2).toBe("Phase 2 — Maklumat Am draft planning");
    expect(PHASE_LABEL_LATER_P5).toBe("Later p5 form phases");
    expect(PHASE_COMPAT_LABEL_COMPATIBLE).toBe("Compatible");
    expect(PHASE_COMPAT_LABEL_INCOMPATIBLE).toBe("Incompatible");
    expect(PHASE_COMPAT_LABEL_UNKNOWN).toBe("Not yet known");
    expect(SUMMARY_COMPATIBLE).toBe(
      "Browser position is compatible with the planned phase"
    );
    expect(SUMMARY_NOT_COMPATIBLE).toBe(
      "Browser position is not compatible with the planned phase"
    );
    expect(SUMMARY_UNKNOWN).toBe("Browser position cannot be determined yet");
  });
});
