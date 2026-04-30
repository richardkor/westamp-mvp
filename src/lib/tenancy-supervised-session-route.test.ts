/**
 * WeStamp — Tenancy Supervised Session · API route helper tests
 *
 * Covers Milestone B4 (server side): the `handleCdpInspectRequest`
 * helper that the `POST /api/operator/cdp-inspect` route delegates
 * to.
 *
 * The middleware-level operator-authentication gate is exercised by
 * the existing middleware tests / by the running application; these
 * tests focus on the validation, sanitization, and error-translation
 * logic the route helper enforces.
 *
 * Tests use a stub `inspector` so no real Playwright / Chrome is
 * touched. The stub is a fixture-only function; the underlying B3
 * read-only contract is tested in
 * `tenancy-supervised-session-shell.test.ts`.
 *
 * Test coverage maps to the brief's TEST REQUIREMENTS:
 *   1. unauthorized request is rejected (covered by middleware
 *      registration; route helper relies on the middleware gate);
 *   2. authorized request returns sanitized session report;
 *   3. CDP unreachable returns safe `cdp_unreachable` state;
 *   4. API response contains no raw URL / href / cookies / tokens.
 */

import {
  DEFAULT_CDP_ENDPOINT,
  DEFAULT_CDP_TIMEOUT_MS,
  ERROR_INSPECTOR_FAILED,
  ERROR_INVALID_BODY,
  ERROR_INVALID_TARGET_PHASE,
  handleCdpInspectRequest,
  resolveCdpEndpoint,
  type CdpInspectResponse,
} from "./tenancy-supervised-session-route";
import type {
  SupervisedSessionReport,
  inspectOperatorChromeSessionViaCdp,
} from "./tenancy-supervised-session-shell";
import { ABSENT_MARKERS } from "./tenancy-supervised-session-shell";
import type { TenancyInstructionPhaseId } from "./tenancy-instruction-graph";

// ─── Stub inspector ───────────────────────────────────────────────

type Inspector = typeof inspectOperatorChromeSessionViaCdp;
type InspectorOpts = Parameters<Inspector>[0];

function makeInspectorStub(
  result: SupervisedSessionReport
): { fn: Inspector; calls: InspectorOpts[] } {
  const calls: InspectorOpts[] = [];
  const fn: Inspector = async (opts) => {
    calls.push(opts);
    return result;
  };
  return { fn, calls };
}

function makeReachableP5Report(
  overrides: Partial<SupervisedSessionReport> = {}
): SupervisedSessionReport {
  return {
    status: "sewa_pajakan_p5_form",
    reachable: true,
    candidatePageCount: 1,
    selectedPageKind: "sewa_pajakan_p5_form",
    pageKind: "sewa_pajakan_p5_form",
    pathKind: "sewa_pajakan_p5_form",
    safeMarkers: { ...ABSENT_MARKERS, pdsSuratcaraPresent: true },
    graphPhaseCompatibility: "compatible",
    recommendedOperatorAction: "Ready for read-only phase-position verification.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
    ...overrides,
  };
}

function makeUnreachableReport(): SupervisedSessionReport {
  return {
    status: "cdp_unreachable",
    reachable: false,
    candidatePageCount: 0,
    selectedPageKind: "unknown",
    pageKind: "unknown",
    pathKind: "other",
    safeMarkers: { ...ABSENT_MARKERS },
    graphPhaseCompatibility: "unknown",
    recommendedOperatorAction:
      "Launch Chrome with remote debugging enabled.",
    reason: "CDP endpoint is not reachable.",
  };
}

// ─── Test 1 · resolveCdpEndpoint ──────────────────────────────────

describe("Route helper · resolveCdpEndpoint", () => {
  test("falls back to the default when the env value is undefined", () => {
    expect(resolveCdpEndpoint(undefined)).toBe(DEFAULT_CDP_ENDPOINT);
  });

  test("falls back to the default when the env value is empty / whitespace", () => {
    expect(resolveCdpEndpoint("")).toBe(DEFAULT_CDP_ENDPOINT);
    expect(resolveCdpEndpoint("   ")).toBe(DEFAULT_CDP_ENDPOINT);
  });

  test("uses the trimmed env value when supplied", () => {
    expect(resolveCdpEndpoint("  http://10.0.0.5:9222 ")).toBe(
      "http://10.0.0.5:9222"
    );
  });
});

// ─── Test 2 · Body validation ─────────────────────────────────────

describe("Route helper · body validation", () => {
  test.each([
    { name: "null body", body: null },
    { name: "string body", body: "hello" },
    { name: "number body", body: 42 },
    { name: "array body", body: [1, 2, 3] },
    { name: "undefined body", body: undefined },
  ])("rejects $name with ERROR_INVALID_BODY", async ({ body }) => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body,
      inspector: fn,
    });
    expect(res).toEqual({ ok: false, error: ERROR_INVALID_BODY });
    // Inspector must NOT be called when body validation fails.
    expect(calls).toHaveLength(0);
  });

  test("accepts an empty object body without invoking the inspector with a target phase", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body: {},
      inspector: fn,
    });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].targetPhaseId).toBeUndefined();
  });

  test("rejects a non-string targetPhaseId", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body: { targetPhaseId: 42 },
      inspector: fn,
    });
    expect(res).toEqual({
      ok: false,
      error: ERROR_INVALID_TARGET_PHASE,
    });
    expect(calls).toHaveLength(0);
  });

  test("rejects an unknown phase id string", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body: { targetPhaseId: "phase_99_attack_drones" },
      inspector: fn,
    });
    expect(res).toEqual({
      ok: false,
      error: ERROR_INVALID_TARGET_PHASE,
    });
    expect(calls).toHaveLength(0);
  });

  test("treats a null targetPhaseId the same as omitted (accepted, undefined)", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body: { targetPhaseId: null },
      inspector: fn,
    });
    expect(res.ok).toBe(true);
    expect(calls[0].targetPhaseId).toBeUndefined();
  });

  test.each<TenancyInstructionPhaseId>([
    "phase_0_preflight",
    "phase_1_session_positioning",
    "phase_2_maklumat_am_draft",
    "phase_3_bahagian_a_parties",
    "phase_4_bahagian_b_rent",
    "phase_5_bahagian_c_property",
    "phase_6_lampiran_upload",
    "phase_7_rumusan_readback",
    "phase_8_perakuan_hantar",
  ])("forwards canonical phase id %s to the inspector", async (id) => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    const res = await handleCdpInspectRequest({
      body: { targetPhaseId: id },
      inspector: fn,
    });
    expect(res.ok).toBe(true);
    expect(calls[0].targetPhaseId).toBe(id);
  });
});

// ─── Test 3 · Endpoint resolution ─────────────────────────────────

describe("Route helper · endpoint resolution", () => {
  test("uses the default CDP endpoint when env is unset", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    await handleCdpInspectRequest({ body: {}, inspector: fn });
    expect(calls[0].cdpEndpoint).toBe(DEFAULT_CDP_ENDPOINT);
  });

  test("uses the env override when supplied", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    await handleCdpInspectRequest({
      body: {},
      inspector: fn,
      envCdpEndpoint: "http://10.0.0.5:9222",
    });
    expect(calls[0].cdpEndpoint).toBe("http://10.0.0.5:9222");
  });

  test("uses the default timeout when none is supplied", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    await handleCdpInspectRequest({ body: {}, inspector: fn });
    expect(calls[0].timeoutMs).toBe(DEFAULT_CDP_TIMEOUT_MS);
  });

  test("uses the supplied timeout when supplied and positive", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    await handleCdpInspectRequest({
      body: {},
      inspector: fn,
      timeoutMs: 500,
    });
    expect(calls[0].timeoutMs).toBe(500);
  });

  test("falls back to the default timeout for non-positive values", async () => {
    const { fn, calls } = makeInspectorStub(makeReachableP5Report());
    await handleCdpInspectRequest({
      body: {},
      inspector: fn,
      timeoutMs: 0,
    });
    expect(calls[0].timeoutMs).toBe(DEFAULT_CDP_TIMEOUT_MS);
  });
});

// ─── Test 4 · Authorized → sanitized success ──────────────────────

describe("Route helper · authorized success path", () => {
  test("returns the sanitized session report verbatim on success", async () => {
    const fixture = makeReachableP5Report({
      candidatePageCount: 3,
    });
    const { fn } = makeInspectorStub(fixture);
    const res = (await handleCdpInspectRequest({
      body: { targetPhaseId: "phase_2_maklumat_am_draft" },
      inspector: fn,
    })) as Extract<CdpInspectResponse, { ok: true }>;
    expect(res.ok).toBe(true);
    expect(res.report).toBe(fixture);
    expect(res.report.candidatePageCount).toBe(3);
  });

  test("CDP unreachable surfaces as ok=true with cdp_unreachable status", async () => {
    const fixture = makeUnreachableReport();
    const { fn } = makeInspectorStub(fixture);
    const res = (await handleCdpInspectRequest({
      body: {},
      inspector: fn,
    })) as Extract<CdpInspectResponse, { ok: true }>;
    expect(res.ok).toBe(true);
    expect(res.report.status).toBe("cdp_unreachable");
    expect(res.report.reachable).toBe(false);
    expect(res.report.recommendedOperatorAction).toMatch(/Chrome/);
  });
});

// ─── Test 5 · Inspector throw handling ────────────────────────────

describe("Route helper · inspector failure path", () => {
  test("translates an unexpected throw into the safe error wording", async () => {
    const fn: Inspector = async () => {
      throw new Error(
        "Playwright crashed at https://stamps.hasil.gov.my/secret-token"
      );
    };
    const res = await handleCdpInspectRequest({
      body: {},
      inspector: fn,
    });
    expect(res).toEqual({
      ok: false,
      error: ERROR_INSPECTOR_FAILED,
    });
    // The raw error message must NOT leak into the response.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/Playwright/);
    expect(serialized).not.toMatch(/secret-token/);
    expect(serialized).not.toMatch(/https?:\/\//i);
  });
});

// ─── Test 6 · Response sensitive-data invariant ───────────────────

describe("Route helper · response sensitive-data invariant", () => {
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
  ];

  const SCENARIOS: {
    label: string;
    fixture: SupervisedSessionReport;
  }[] = [
    { label: "p5 form", fixture: makeReachableP5Report() },
    { label: "unreachable", fixture: makeUnreachableReport() },
    {
      label: "role_change",
      fixture: makeReachableP5Report({
        status: "stamps_role_change",
        pageKind: "stamps_role_change",
        selectedPageKind: "stamps_role_change",
        pathKind: "stamps_role_change",
        recommendedOperatorAction: "Complete firm selection manually.",
        reason: "Operator session is on the e-Duti Setem role-change page.",
      }),
    },
  ];

  test.each(SCENARIOS)(
    "$label scenario produces a sensitive-data-free response",
    async ({ fixture }) => {
      const { fn } = makeInspectorStub(fixture);
      const res = await handleCdpInspectRequest({
        body: {},
        inspector: fn,
      });
      const serialized = JSON.stringify(res);
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(serialized)) {
          const m = serialized.match(pattern);
          throw new Error(
            `Forbidden pattern "${name}" matched in response: ${m?.[0]}`
          );
        }
      }
    }
  );
});

// ─── Test 7 · Error response sensitive-data invariant ─────────────

describe("Route helper · error responses are also sanitized", () => {
  test("invalid-body error response carries no portal data", async () => {
    const res = await handleCdpInspectRequest({ body: null });
    const serialized = JSON.stringify(res);
    expect(/https?:\/\//i.test(serialized)).toBe(false);
    expect(/\/stamps\//.test(serialized)).toBe(false);
    expect(/href=/i.test(serialized)).toBe(false);
    expect(/cookie/i.test(serialized)).toBe(false);
    expect(/token/i.test(serialized)).toBe(false);
  });

  test("invalid-phase error response carries no portal data", async () => {
    const res = await handleCdpInspectRequest({
      body: { targetPhaseId: "phase_99" },
    });
    const serialized = JSON.stringify(res);
    expect(serialized).toContain(ERROR_INVALID_TARGET_PHASE);
    expect(/https?:\/\//i.test(serialized)).toBe(false);
    expect(/\/stamps\//.test(serialized)).toBe(false);
  });

  test("inspector-failed error response carries no portal data", async () => {
    const fn: Inspector = async () => {
      throw new Error("https://stamps.hasil.gov.my/some/leak?token=xyz");
    };
    const res = await handleCdpInspectRequest({ body: {}, inspector: fn });
    const serialized = JSON.stringify(res);
    expect(serialized).toContain(ERROR_INSPECTOR_FAILED);
    expect(/https?:\/\//i.test(serialized)).toBe(false);
    expect(/leak/i.test(serialized)).toBe(false);
    expect(/xyz/.test(serialized)).toBe(false);
  });
});
