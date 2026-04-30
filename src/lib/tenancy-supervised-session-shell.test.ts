/**
 * WeStamp — Tenancy Supervised Browser Session Shell · tests
 *
 * Covers Milestone B3: the read-only operator-side session shell.
 *
 * Tests target the pure classification + sanitization helper plus
 * the URL-boundary path classifier. The CDP attach wrapper is NOT
 * tested here — testing it would require running a real Chrome,
 * which violates the read-only / no-portal-contact boundary of
 * this milestone.
 *
 * Test coverage maps directly to the brief's TEST REQUIREMENTS:
 *   1. CDP unreachable → cdp_unreachable + safe operator action;
 *   2. MyTax dashboard URL/path → mytax_dashboard, no raw URL;
 *   3. role_change path → stamps_role_change;
 *   4. stamps dashboard path → stamps_dashboard;
 *   5. p5 path → sewa_pajakan_p5_form;
 *   6. unknown page → unknown_page;
 *   7. marker booleans never include values;
 *   8. graph phase compatibility is correct per page/phase combo;
 *   9. serialized result is sensitive-data-free;
 *  10. no mutation verbs/wording in recommended actions.
 */

import {
  ABSENT_MARKERS,
  buildSupervisedSessionReport,
  classifySupervisedSessionPath,
  OPERATOR_ACTION_COMPLETE_FIRM_SELECTION,
  OPERATOR_ACTION_LAUNCH_CHROME,
  OPERATOR_ACTION_NAVIGATE_MANUALLY,
  OPERATOR_ACTION_OPEN_P5_FORM,
  OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD,
  OPERATOR_ACTION_READY_FOR_VERIFICATION,
  type SanitizedPageDescriptor,
  type SupervisedSessionPageKind,
  type SupervisedSessionPathKind,
  type SupervisedSessionReport,
  type SupervisedSessionSafeMarkers,
} from "./tenancy-supervised-session-shell";
import type { TenancyInstructionPhaseId } from "./tenancy-instruction-graph";

// ─── Fixture helpers ──────────────────────────────────────────────

function descriptor(
  pathKind: SupervisedSessionPathKind,
  markersOverrides: Partial<SupervisedSessionSafeMarkers> = {}
): SanitizedPageDescriptor {
  return {
    pathKind,
    safeMarkers: { ...ABSENT_MARKERS, ...markersOverrides },
  };
}

function fullP5Markers(): Partial<SupervisedSessionSafeMarkers> {
  return {
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
  };
}

// ─── Test 1 · CDP unreachable ─────────────────────────────────────

describe("Session shell · CDP unreachable", () => {
  test("returns cdp_unreachable with the launch-Chrome action", () => {
    const r = buildSupervisedSessionReport({ reachable: false, pages: [] });
    expect(r.status).toBe("cdp_unreachable");
    expect(r.reachable).toBe(false);
    expect(r.candidatePageCount).toBe(0);
    expect(r.selectedPageKind).toBe("unknown");
    expect(r.pageKind).toBe("unknown");
    expect(r.pathKind).toBe("other");
    expect(r.safeMarkers).toEqual(ABSENT_MARKERS);
    expect(r.recommendedOperatorAction).toBe(OPERATOR_ACTION_LAUNCH_CHROME);
    expect(r.graphPhaseCompatibility).toBe("unknown");
    expect(r.reason).toMatch(/CDP/);
  });

  test("Chrome reachable but no pages → chrome_reachable_no_pages", () => {
    const r = buildSupervisedSessionReport({ reachable: true, pages: [] });
    expect(r.status).toBe("chrome_reachable_no_pages");
    expect(r.reachable).toBe(true);
    expect(r.candidatePageCount).toBe(0);
    expect(r.selectedPageKind).toBe("unknown");
    expect(r.recommendedOperatorAction).toBe(
      OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD
    );
  });
});

// ─── Test 2-6 · Path classification ───────────────────────────────

describe("Session shell · path classification", () => {
  const CASES: { url: string; expected: SupervisedSessionPathKind }[] = [
    {
      url: "https://mytax.hasil.gov.my/",
      expected: "mytax_dashboard",
    },
    {
      url: "https://mytax.hasil.gov.my/dashboard",
      expected: "mytax_dashboard",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/main/role_change",
      expected: "stamps_role_change",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/main/role_change/legal_firm/12/34/56/789",
      expected: "stamps_role_change",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/utama/dashboard",
      expected: "stamps_dashboard",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/utama/dashboard/foo",
      expected: "stamps_dashboard",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/9876543210123",
      expected: "sewa_pajakan_p5_form",
    },
    {
      url: "https://stamps.hasil.gov.my/stamps/formv2/p5/create",
      expected: "sewa_pajakan_p5_form",
    },
    {
      url: "https://example.com/",
      expected: "other",
    },
    {
      url: "/stamps/main/role_change",
      expected: "stamps_role_change",
    },
    {
      url: "/stamps/utama/dashboard/x",
      expected: "stamps_dashboard",
    },
    {
      url: "/stamps/formv2/p5/edit/id/123",
      expected: "sewa_pajakan_p5_form",
    },
    {
      url: "",
      expected: "other",
    },
  ];

  test.each(CASES)("%# classifies %s → %s", ({ url, expected }) => {
    expect(classifySupervisedSessionPath(url)).toBe(expected);
  });

  test("MyTax classification surfaces the correct status without leaking the URL", () => {
    const url = "https://mytax.hasil.gov.my/some/path?token=abc#hash";
    const pathKind = classifySupervisedSessionPath(url);
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor(pathKind)],
    });
    expect(r.status).toBe("mytax_dashboard");
    // The URL must not appear anywhere in the serialized report.
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/some\/path/);
    expect(serialized).not.toMatch(/token=abc/);
    expect(serialized).not.toMatch(/#hash/);
    expect(serialized).not.toMatch(/mytax\.hasil/);
  });

  test("role_change page selection returns the correct status + action", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("stamps_role_change")],
    });
    expect(r.status).toBe("stamps_role_change");
    expect(r.recommendedOperatorAction).toBe(
      OPERATOR_ACTION_COMPLETE_FIRM_SELECTION
    );
  });

  test("stamps_dashboard page selection returns the correct status", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("stamps_dashboard")],
    });
    expect(r.status).toBe("stamps_dashboard");
  });

  test("sewa_pajakan_p5_form page selection returns the correct status + action", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("sewa_pajakan_p5_form", fullP5Markers())],
    });
    expect(r.status).toBe("sewa_pajakan_p5_form");
    expect(r.recommendedOperatorAction).toBe(
      OPERATOR_ACTION_READY_FOR_VERIFICATION
    );
  });

  test("unknown page → unknown_page status", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("other")],
    });
    expect(r.status).toBe("unknown_page");
    expect(r.pageKind).toBe("unknown");
    expect(r.recommendedOperatorAction).toBe(
      OPERATOR_ACTION_NAVIGATE_MANUALLY
    );
  });
});

// ─── Test 7 · Marker booleans only ────────────────────────────────

describe("Session shell · marker booleans", () => {
  test("safeMarkers values are all booleans, never strings or numbers", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("sewa_pajakan_p5_form", fullP5Markers())],
    });
    for (const [key, value] of Object.entries(r.safeMarkers)) {
      expect({ key, type: typeof value }).toEqual({
        key,
        type: "boolean",
      });
    }
  });

  test("absent markers default to all-false on unreachable / no pages", () => {
    expect(
      buildSupervisedSessionReport({ reachable: false, pages: [] }).safeMarkers
    ).toEqual(ABSENT_MARKERS);
    expect(
      buildSupervisedSessionReport({ reachable: true, pages: [] }).safeMarkers
    ).toEqual(ABSENT_MARKERS);
  });

  test("partial p5 markers preserve per-marker booleans without leaking values", () => {
    const partial: Partial<SupervisedSessionSafeMarkers> = {
      pdsSuratcaraPresent: true,
      pdsJenisPresent: true,
    };
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("sewa_pajakan_p5_form", partial)],
    });
    expect(r.safeMarkers.pdsSuratcaraPresent).toBe(true);
    expect(r.safeMarkers.pdsJenisPresent).toBe(true);
    expect(r.safeMarkers.pdsSalinanPresent).toBe(false);
    expect(r.safeMarkers.pdsHartaPerabotPresent).toBe(false);
  });
});

// ─── Test 8 · Graph phase compatibility ───────────────────────────

describe("Session shell · graph phase compatibility", () => {
  type Case = {
    label: string;
    pathKind: SupervisedSessionPathKind;
    targetPhaseId?: TenancyInstructionPhaseId;
    expected: "compatible" | "incompatible" | "unknown";
  };

  const CASES: Case[] = [
    // Phase 0 — offline; always compatible (regardless of page kind).
    {
      label: "phase_0 + role_change → compatible",
      pathKind: "stamps_role_change",
      targetPhaseId: "phase_0_preflight",
      expected: "compatible",
    },
    {
      label: "phase_0 + p5 form → compatible",
      pathKind: "sewa_pajakan_p5_form",
      targetPhaseId: "phase_0_preflight",
      expected: "compatible",
    },
    {
      label: "phase_0 + unknown page → compatible",
      pathKind: "other",
      targetPhaseId: "phase_0_preflight",
      expected: "compatible",
    },
    // Phase 1 — session positioning.
    {
      label: "phase_1 + role_change → compatible",
      pathKind: "stamps_role_change",
      targetPhaseId: "phase_1_session_positioning",
      expected: "compatible",
    },
    {
      label: "phase_1 + stamps_dashboard → compatible",
      pathKind: "stamps_dashboard",
      targetPhaseId: "phase_1_session_positioning",
      expected: "compatible",
    },
    {
      label: "phase_1 + p5 form → incompatible",
      pathKind: "sewa_pajakan_p5_form",
      targetPhaseId: "phase_1_session_positioning",
      expected: "incompatible",
    },
    {
      label: "phase_1 + mytax → incompatible",
      pathKind: "mytax_dashboard",
      targetPhaseId: "phase_1_session_positioning",
      expected: "incompatible",
    },
    {
      label: "phase_1 + unknown → unknown",
      pathKind: "other",
      targetPhaseId: "phase_1_session_positioning",
      expected: "unknown",
    },
    // Phase 2 — first portal mutation; requires p5.
    {
      label: "phase_2 + p5 form → compatible",
      pathKind: "sewa_pajakan_p5_form",
      targetPhaseId: "phase_2_maklumat_am_draft",
      expected: "compatible",
    },
    {
      label: "phase_2 + dashboard → incompatible",
      pathKind: "stamps_dashboard",
      targetPhaseId: "phase_2_maklumat_am_draft",
      expected: "incompatible",
    },
    {
      label: "phase_5 + p5 form → compatible",
      pathKind: "sewa_pajakan_p5_form",
      targetPhaseId: "phase_5_bahagian_c_property",
      expected: "compatible",
    },
    {
      label: "phase_8 + p5 form → compatible",
      pathKind: "sewa_pajakan_p5_form",
      targetPhaseId: "phase_8_perakuan_hantar",
      expected: "compatible",
    },
    {
      label: "phase_8 + role_change → incompatible",
      pathKind: "stamps_role_change",
      targetPhaseId: "phase_8_perakuan_hantar",
      expected: "incompatible",
    },
    // No targetPhaseId.
    {
      label: "no phase target + p5 form → unknown",
      pathKind: "sewa_pajakan_p5_form",
      expected: "unknown",
    },
  ];

  test.each(CASES)("$label", ({ pathKind, targetPhaseId, expected }) => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor(pathKind)],
      ...(targetPhaseId !== undefined ? { targetPhaseId } : {}),
    });
    expect(r.graphPhaseCompatibility).toBe(expected);
  });

  test("compatibility is `unknown` when CDP is unreachable, regardless of phase", () => {
    const r = buildSupervisedSessionReport({
      reachable: false,
      pages: [],
      targetPhaseId: "phase_2_maklumat_am_draft",
    });
    expect(r.graphPhaseCompatibility).toBe("unknown");
  });

  test("stamps_dashboard + phase_1 yields the verification-ready action", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("stamps_dashboard")],
      targetPhaseId: "phase_1_session_positioning",
    });
    expect(r.recommendedOperatorAction).toBe(
      OPERATOR_ACTION_READY_FOR_VERIFICATION
    );
  });

  test("stamps_dashboard + phase_2+ yields the open-p5 action", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("stamps_dashboard")],
      targetPhaseId: "phase_2_maklumat_am_draft",
    });
    expect(r.recommendedOperatorAction).toBe(OPERATOR_ACTION_OPEN_P5_FORM);
  });
});

// ─── Test 9 · Sensitive-data invariant ────────────────────────────

describe("Session shell · sensitive-data invariant", () => {
  // The forbidden patterns mirror the graph-builder / preview-helper
  // invariant tests, so the session report is held to the same bar.
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
    { name: "query string", pattern: /\?[a-z0-9]+=/i },
    { name: "uri hash", pattern: /#[a-z0-9]/i },
    { name: "literal mukim", pattern: /\bPetaling\b/ },
  ];

  const SCENARIOS: {
    label: string;
    input: Parameters<typeof buildSupervisedSessionReport>[0];
  }[] = [
    {
      label: "cdp_unreachable",
      input: { reachable: false, pages: [] },
    },
    {
      label: "no_pages",
      input: { reachable: true, pages: [] },
    },
    {
      label: "mytax_dashboard",
      input: { reachable: true, pages: [descriptor("mytax_dashboard")] },
    },
    {
      label: "stamps_role_change",
      input: { reachable: true, pages: [descriptor("stamps_role_change")] },
    },
    {
      label: "stamps_dashboard",
      input: { reachable: true, pages: [descriptor("stamps_dashboard")] },
    },
    {
      label: "sewa_pajakan_p5_form (full markers)",
      input: {
        reachable: true,
        pages: [descriptor("sewa_pajakan_p5_form", fullP5Markers())],
      },
    },
    {
      label: "unknown_page",
      input: { reachable: true, pages: [descriptor("other")] },
    },
    {
      label: "p5_form + phase_5 target",
      input: {
        reachable: true,
        pages: [descriptor("sewa_pajakan_p5_form", fullP5Markers())],
        targetPhaseId: "phase_5_bahagian_c_property",
      },
    },
  ];

  test.each(SCENARIOS)("$label produces a sensitive-data-free report", ({ input }) => {
    const r: SupervisedSessionReport = buildSupervisedSessionReport(input);
    const serialized = JSON.stringify(r);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched in session report: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 10 · No mutation verbs in recommended actions ───────────

describe("Session shell · no mutation wording", () => {
  const FORBIDDEN_WORDING: RegExp[] = [
    /\bStart automation\b/i,
    /\bSubmit\b/i,
    /\bExecute\b/i,
    /\bSend to LHDN\b/i,
    /\bPortal run started\b/i,
    /\bautomated submission\b/i,
    /\bsubmitted\b/i,
    /\bsent\b/i,
    /\bpaid\b/i,
    /\bcertificate retrieved\b/i,
    /\bclick\b/i,
    /\bfill\b/i,
    /\bupload to portal\b/i,
    /\bhantar\b/i,
  ];

  const ALL_PAGE_KINDS: SupervisedSessionPathKind[] = [
    "mytax_dashboard",
    "stamps_role_change",
    "stamps_dashboard",
    "sewa_pajakan_p5_form",
    "other",
  ];

  test.each(ALL_PAGE_KINDS)(
    "recommended action for %s contains no mutation wording",
    (pathKind) => {
      const r = buildSupervisedSessionReport({
        reachable: true,
        pages: [descriptor(pathKind)],
      });
      for (const pattern of FORBIDDEN_WORDING) {
        expect({
          pattern: pattern.source,
          action: r.recommendedOperatorAction,
          hit: pattern.test(r.recommendedOperatorAction),
        }).toEqual({
          pattern: pattern.source,
          action: r.recommendedOperatorAction,
          hit: false,
        });
      }
    }
  );

  test("the cdp_unreachable action is the approved launch sentence", () => {
    const r = buildSupervisedSessionReport({ reachable: false, pages: [] });
    expect(r.recommendedOperatorAction).toBe(OPERATOR_ACTION_LAUNCH_CHROME);
    for (const pattern of FORBIDDEN_WORDING) {
      expect(pattern.test(r.recommendedOperatorAction)).toBe(false);
    }
  });
});

// ─── Test 11 · Most-relevant page selection ───────────────────────

describe("Session shell · page priority selection", () => {
  test("p5 form wins over dashboard when both are open", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [
        descriptor("stamps_dashboard"),
        descriptor("sewa_pajakan_p5_form", { pdsJenisPresent: true }),
      ],
    });
    expect(r.selectedPageKind).toBe("sewa_pajakan_p5_form");
    expect(r.candidatePageCount).toBe(2);
    expect(r.safeMarkers.pdsJenisPresent).toBe(true);
  });

  test("role_change wins over mytax when both are open", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [
        descriptor("mytax_dashboard"),
        descriptor("stamps_role_change"),
      ],
    });
    expect(r.selectedPageKind).toBe("stamps_role_change");
  });

  test("only-other pages classify the report as unknown_page", () => {
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor("other"), descriptor("other")],
    });
    expect(r.status).toBe("unknown_page");
    expect(r.candidatePageCount).toBe(2);
  });
});

// ─── Test 12 · Approved-action constants ──────────────────────────

describe("Session shell · approved-action constants", () => {
  test("each operator-action constant matches the brief verbatim", () => {
    expect(OPERATOR_ACTION_LAUNCH_CHROME).toBe(
      "Launch Chrome with remote debugging enabled."
    );
    expect(OPERATOR_ACTION_OPEN_STAMPS_DASHBOARD).toBe(
      "Open the e-Duti Setem dashboard."
    );
    expect(OPERATOR_ACTION_COMPLETE_FIRM_SELECTION).toBe(
      "Complete firm selection manually."
    );
    expect(OPERATOR_ACTION_OPEN_P5_FORM).toBe(
      "Open the Sewa/Pajakan p5 form."
    );
    expect(OPERATOR_ACTION_READY_FOR_VERIFICATION).toBe(
      "Ready for read-only phase-position verification."
    );
    expect(OPERATOR_ACTION_NAVIGATE_MANUALLY).toBe(
      "Page not recognised. Navigate manually to the Sewa/Pajakan p5 form."
    );
  });

  test("ABSENT_MARKERS is fully all-false", () => {
    for (const [, v] of Object.entries(ABSENT_MARKERS)) {
      expect(v).toBe(false);
    }
  });
});

// ─── Test 13 · pageKind alias mirrors selectedPageKind ────────────

describe("Session shell · page-kind alias", () => {
  test.each<SupervisedSessionPageKind>([
    "mytax_dashboard",
    "stamps_role_change",
    "stamps_dashboard",
    "sewa_pajakan_p5_form",
    "unknown",
  ])("pageKind === selectedPageKind for %s", (expected) => {
    const pathKind: SupervisedSessionPathKind =
      expected === "unknown" ? "other" : expected;
    const r = buildSupervisedSessionReport({
      reachable: true,
      pages: [descriptor(pathKind)],
    });
    expect(r.pageKind).toBe(expected);
    expect(r.selectedPageKind).toBe(expected);
    expect(r.pageKind).toBe(r.selectedPageKind);
  });
});
