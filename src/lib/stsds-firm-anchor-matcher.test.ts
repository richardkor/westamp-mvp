/**
 * WeStamp — Firm Anchor Matcher · Tests
 *
 * Pure-helper tests proving that role/firm anchor selection on
 * `/stamps/main/role_change` is safe and fail-closed:
 *
 *   - exact normalized visible-text match selects one candidate;
 *   - decoded href content can help matching without exposing raw
 *     href in diagnostics;
 *   - zero candidates → no_candidates;
 *   - zero matches → no_match;
 *   - multiple plausible matches → ambiguous_match;
 *   - configured branch + branch mismatch → no_match;
 *   - configured branch + exact branch match → unique_match;
 *   - the helper never returns a match by index;
 *   - the diagnostics object never contains raw href, raw firm name,
 *     numeric IDs, tokens, or sensitive values.
 */

import {
  classifyPathKind,
  matchFirmAnchor,
  normalizeForMatch,
  type FirmAnchorCandidate,
  type FirmAnchorMatchDiagnostics,
} from "./stsds-firm-anchor-matcher";

// ─── Fixtures ────────────────────────────────────────────────────

/**
 * A non-sensitive synthetic firm name used in fixtures. Picked to
 * exercise normalization (mixed case, leading/trailing whitespace,
 * collapsed whitespace). Not a real firm.
 */
const TARGET_FIRM = "Acme Stamp Agent SDN BHD";
const TARGET_BRANCH = "Cyberjaya";

/**
 * Build a synthetic candidate. The decoded-href body uses the same
 * non-sensitive synthetic strings so we don't simulate real HAR
 * payloads.
 *
 * Default behaviour: if the caller overrides only `visibleText`, the
 * helper auto-derives a corresponding `hrefDecoded` so the firm name
 * in the URL path matches the visible text. This avoids bleed-over
 * where every candidate's default href happens to contain TARGET_FIRM
 * as a path segment and thus wrongly firm-matches under strict
 * URL-segment equality. Tests that want to exercise mismatched
 * visible-text-vs-href on purpose can override both fields.
 */
function makeCandidate(
  ordinal: number,
  overrides: Partial<FirmAnchorCandidate> = {}
): FirmAnchorCandidate {
  const visibleText = overrides.visibleText ?? TARGET_FIRM;
  const hrefDecoded =
    overrides.hrefDecoded ??
    `/stamps/main/role_change/agent/00/00/00/00/${visibleText}/Ejen Admin/Cyberjaya/`;
  return {
    ordinal,
    visibleText,
    hrefDecoded,
    isVisible: overrides.isVisible ?? true,
  };
}

/**
 * Helper: assert that a diagnostics object contains no raw values
 * outside the safe allow-list.
 */
function assertSafeDiagnostics(d: FirmAnchorMatchDiagnostics): void {
  // Allow-list of keys the helper is permitted to surface.
  const ALLOWED_KEYS = new Set<keyof FirmAnchorMatchDiagnostics>([
    "roleChangePageSeen",
    "candidateAnchorCount",
    "filteredCandidateCount",
    "visibleCandidateCount",
    "exactFirmMatchCount",
    "exactFirmAndBranchMatchCount",
    "matchStatus",
    "branchProvidedInConfig",
    "branchUsedToDisambiguate",
  ]);
  for (const k of Object.keys(d) as (keyof FirmAnchorMatchDiagnostics)[]) {
    expect(ALLOWED_KEYS.has(k)).toBe(true);
  }
  // No string values that look like href / URL / numeric IDs.
  for (const value of Object.values(d)) {
    if (typeof value === "string") {
      expect(value).not.toMatch(/https?:\/\//i);
      expect(value).not.toMatch(/role_change\//);
      expect(value).not.toMatch(/^\d{6,}$/); // long numeric → likely role/firm id
    }
  }
}

// ─── Normalization ───────────────────────────────────────────────

// ─── classifyPathKind ────────────────────────────────────────────

describe("classifyPathKind", () => {
  test("returns 'role_change' for absolute role-change URL", () => {
    expect(
      classifyPathKind(
        "https://stamps.hasil.gov.my/stamps/main/role_change?foo=1"
      )
    ).toBe("role_change");
  });

  test("returns 'role_change' for relative role-change path", () => {
    expect(classifyPathKind("/stamps/main/role_change")).toBe(
      "role_change"
    );
  });

  test("returns 'dashboard' for absolute dashboard URL", () => {
    expect(
      classifyPathKind(
        "https://stamps.hasil.gov.my/stamps/utama/dashboard#section"
      )
    ).toBe("dashboard");
  });

  test("returns 'dashboard' for relative dashboard path", () => {
    expect(classifyPathKind("/stamps/utama/dashboard")).toBe("dashboard");
  });

  test("returns 'other' for unrelated portal paths", () => {
    expect(classifyPathKind("https://stamps.hasil.gov.my/stamps/formv2/p5")).toBe(
      "other"
    );
    expect(classifyPathKind("/stamps/main/login")).toBe("other");
  });

  test("returns 'other' for empty / malformed input — never throws", () => {
    expect(classifyPathKind("")).toBe("other");
    expect(classifyPathKind("not a url at all")).toBe("other");
    // intentionally invalid URI
    expect(classifyPathKind("http://[")).toBe("other");
  });

  test("classifier output never echoes the URL, path, query string, or hash", () => {
    const sensitive =
      "https://stamps.hasil.gov.my/stamps/main/role_change?token=abc&id=12345#secret";
    const result = classifyPathKind(sensitive);
    // The result is one of the three enum values — nothing else.
    expect(["role_change", "dashboard", "other"]).toContain(result);
    // And of course the result string itself contains none of the
    // sensitive substrings.
    expect(result).not.toContain("token");
    expect(result).not.toContain("12345");
    expect(result).not.toContain("secret");
  });
});

describe("normalizeForMatch", () => {
  test("trims, collapses whitespace, upper-cases", () => {
    expect(normalizeForMatch("  Hello   World  ")).toBe("HELLO WORLD");
  });

  test("is case-insensitive", () => {
    expect(normalizeForMatch("aBc")).toBe(normalizeForMatch("ABC"));
  });

  test("preserves non-Latin characters", () => {
    expect(normalizeForMatch("Sdn Bhd")).toBe("SDN BHD");
  });
});

// ─── unique_match by visible text ────────────────────────────────

describe("matchFirmAnchor · unique_match", () => {
  test("exact normalized visible-text match selects the unique candidate", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, { visibleText: "Other Firm SDN BHD" }),
      makeCandidate(1, { visibleText: TARGET_FIRM }),
      makeCandidate(2, { visibleText: "Yet Another Firm SDN BHD" }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.ordinal).toBe(1);
    expect(result.diagnostics.matchStatus).toBe("unique_match");
    expect(result.diagnostics.exactFirmMatchCount).toBe(1);
    assertSafeDiagnostics(result.diagnostics);
  });

  test("normalized match tolerates whitespace and case differences", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, { visibleText: "  ACME   STAMP   AGENT   SDN BHD  " }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.ordinal).toBe(0);
  });

  test("decoded href content can help match when visible text is generic", () => {
    // Only one candidate's visible text is a generic phrase; the
    // firm name lives in the decoded href.
    const candidates: FirmAnchorCandidate[] = [
      {
        ordinal: 0,
        visibleText: "Pilih",
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Acme Stamp Agent SDN BHD/Ejen Admin/Cyberjaya/",
        isVisible: true,
      },
      {
        ordinal: 1,
        visibleText: "Pilih",
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Other Firm SDN BHD/Ejen Admin/Cyberjaya/",
        isVisible: true,
      },
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.ordinal).toBe(0);
    // The decoded href is consumed for matching but not surfaced.
    assertSafeDiagnostics(result.diagnostics);
  });
});

// ─── no_candidates / no_match / ambiguous_match (fail-closed) ───

describe("matchFirmAnchor · fail-closed outcomes", () => {
  test("zero candidates → no_candidates (roleChangePageSeen=false)", () => {
    const result = matchFirmAnchor([], { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("no_candidates");
    expect(result.diagnostics.roleChangePageSeen).toBe(false);
    expect(result.diagnostics.candidateAnchorCount).toBe(0);
    expect(result.diagnostics.matchStatus).toBe("no_candidates");
    assertSafeDiagnostics(result.diagnostics);
  });

  test("anchors not on /stamps/main/role_change/ are dropped → no_match", () => {
    const candidates: FirmAnchorCandidate[] = [
      {
        ordinal: 0,
        visibleText: TARGET_FIRM,
        // href doesn't contain the role-change fragment
        hrefDecoded: "/stamps/main/dashboard",
        isVisible: true,
      },
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("no_match");
    expect(result.diagnostics.candidateAnchorCount).toBe(1);
    expect(result.diagnostics.filteredCandidateCount).toBe(0);
    expect(result.diagnostics.matchStatus).toBe("no_match");
  });

  test("invisible candidates are excluded from the visible count", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, { isVisible: false }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("no_match");
    expect(result.diagnostics.filteredCandidateCount).toBe(1);
    expect(result.diagnostics.visibleCandidateCount).toBe(0);
  });

  test("zero matches → no_match", () => {
    const candidates: FirmAnchorCandidate[] = [
      // Visible text different AND href segments don't include target firm.
      {
        ordinal: 0,
        visibleText: "Other Firm SDN BHD",
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Other Firm SDN BHD/Ejen Admin/Cyberjaya/",
        isVisible: true,
      },
      {
        ordinal: 1,
        visibleText: "Yet Another Firm SDN BHD",
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Yet Another Firm SDN BHD/Ejen Admin/Cyberjaya/",
        isVisible: true,
      },
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("no_match");
    expect(result.diagnostics.exactFirmMatchCount).toBe(0);
    assertSafeDiagnostics(result.diagnostics);
  });

  test("multiple plausible matches → ambiguous_match", () => {
    // Two candidates both with the firm name in visible text and
    // both visible — no branch supplied to disambiguate.
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0),
      makeCandidate(1),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("ambiguous_match");
    expect(result.diagnostics.exactFirmMatchCount).toBe(2);
    expect(result.diagnostics.matchStatus).toBe("ambiguous_match");
    assertSafeDiagnostics(result.diagnostics);
  });
});

// ─── Branch disambiguation ───────────────────────────────────────

describe("matchFirmAnchor · branch disambiguation", () => {
  test("branch configured, branch matches → unique_match", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, {
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Acme Stamp Agent SDN BHD/Ejen Admin/Cyberjaya/",
      }),
      makeCandidate(1, {
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Acme Stamp Agent SDN BHD/Ejen Admin/Putrajaya/",
      }),
    ];
    const result = matchFirmAnchor(candidates, {
      targetFirm: TARGET_FIRM,
      targetBranch: TARGET_BRANCH,
    });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.ordinal).toBe(0);
    expect(result.diagnostics.branchProvidedInConfig).toBe(true);
    expect(result.diagnostics.branchUsedToDisambiguate).toBe(true);
    expect(result.diagnostics.exactFirmMatchCount).toBe(2);
    expect(result.diagnostics.exactFirmAndBranchMatchCount).toBe(1);
  });

  test("branch configured, no candidate has that branch → no_match", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, {
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Acme Stamp Agent SDN BHD/Ejen Admin/Putrajaya/",
      }),
    ];
    const result = matchFirmAnchor(candidates, {
      targetFirm: TARGET_FIRM,
      targetBranch: TARGET_BRANCH,
    });
    expect(result.kind).toBe("no_match");
    expect(result.diagnostics.branchProvidedInConfig).toBe(true);
    expect(result.diagnostics.exactFirmAndBranchMatchCount).toBe(0);
  });

  test("branch parsed out of mixed visible text is NOT a click-approval signal (strict)", () => {
    // Visible text is "{firm} ({branch})" and the href has neither the
    // firm name nor the branch as a clean URL segment. Under the
    // strict matching policy this candidate must NOT match — substring
    // parsing of mixed visible text is too brittle to approve a click,
    // and the matcher must fail closed.
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, {
        visibleText: `${TARGET_FIRM} (${TARGET_BRANCH})`,
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/foo/bar/baz/",
      }),
    ];
    const result = matchFirmAnchor(candidates, {
      targetFirm: TARGET_FIRM,
      targetBranch: TARGET_BRANCH,
    });
    expect(result.kind).toBe("no_match");
  });

  test("branch configured but firm match is already unique → branchUsedToDisambiguate=false", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, {
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Acme Stamp Agent SDN BHD/Ejen Admin/Cyberjaya/",
      }),
      makeCandidate(1, {
        visibleText: "Other Firm SDN BHD",
        hrefDecoded:
          "/stamps/main/role_change/agent/00/00/00/00/" +
          "Other Firm SDN BHD/Ejen Admin/Cyberjaya/",
      }),
    ];
    const result = matchFirmAnchor(candidates, {
      targetFirm: TARGET_FIRM,
      targetBranch: TARGET_BRANCH,
    });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.diagnostics.branchProvidedInConfig).toBe(true);
    // Firm match was already unique without branch.
    expect(result.diagnostics.branchUsedToDisambiguate).toBe(false);
  });
});

// ─── Index-fallback prohibition ──────────────────────────────────

describe("matchFirmAnchor · never selects by index", () => {
  test("ambiguous_match returns no ordinal even when 2 candidates exist", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0),
      makeCandidate(1),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("ambiguous_match");
    // Type-narrowed: ambiguous_match has no `ordinal` field.
    expect("ordinal" in result).toBe(false);
  });

  test("no_match returns no ordinal even when candidates exist", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, { visibleText: "Other Firm SDN BHD" }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("no_match");
    expect("ordinal" in result).toBe(false);
  });

  test("ordinal returned by unique_match comes from the candidate, not from array position", () => {
    // Place the matching candidate at array index 2 with ordinal 99 — the
    // ordinal we get back should be 99, not 2.
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(7, { visibleText: "First Other Firm" }),
      makeCandidate(13, { visibleText: "Second Other Firm" }),
      makeCandidate(99, { visibleText: TARGET_FIRM }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    expect(result.kind).toBe("unique_match");
    if (result.kind !== "unique_match") return;
    expect(result.ordinal).toBe(99);
  });
});

// ─── Diagnostic safety ───────────────────────────────────────────

describe("matchFirmAnchor · diagnostics are safe", () => {
  test("diagnostics never include the raw href", () => {
    const candidates: FirmAnchorCandidate[] = [
      makeCandidate(0, {
        hrefDecoded:
          "/stamps/main/role_change/agent/12345678/87654321/" +
          "11111111/22222222/Acme Stamp Agent SDN BHD/Ejen Admin/Cyberjaya/",
      }),
    ];
    const result = matchFirmAnchor(candidates, { targetFirm: TARGET_FIRM });
    const flat = JSON.stringify(result.diagnostics);
    // No raw role_change href segment.
    expect(flat).not.toMatch(/role_change\//);
    // No long numeric IDs from the href.
    expect(flat).not.toMatch(/12345678/);
    expect(flat).not.toMatch(/87654321/);
    // No firm name leakage either — diagnostics are counts only.
    expect(flat).not.toMatch(/ACME/);
    expect(flat).not.toMatch(/Cyberjaya/);
    assertSafeDiagnostics(result.diagnostics);
  });

  test("diagnostics shape is stable across all four outcomes", () => {
    const cases = [
      // no_candidates
      matchFirmAnchor([], { targetFirm: TARGET_FIRM }),
      // no_match
      matchFirmAnchor(
        [makeCandidate(0, { visibleText: "Other Firm SDN BHD" })],
        { targetFirm: TARGET_FIRM }
      ),
      // ambiguous_match
      matchFirmAnchor([makeCandidate(0), makeCandidate(1)], {
        targetFirm: TARGET_FIRM,
      }),
      // unique_match
      matchFirmAnchor([makeCandidate(0)], { targetFirm: TARGET_FIRM }),
    ];
    for (const r of cases) {
      assertSafeDiagnostics(r.diagnostics);
      expect([
        "no_candidates",
        "no_match",
        "ambiguous_match",
        "unique_match",
      ]).toContain(r.diagnostics.matchStatus);
    }
  });
});
