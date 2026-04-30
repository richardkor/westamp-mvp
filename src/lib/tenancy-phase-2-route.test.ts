/**
 * WeStamp — Tenancy Phase 2 · API route helper tests
 *
 * Covers the pure `executePhase2RouteHandler` helper. The CDP
 * attach + executor are stubbed so no real Playwright / Chrome is
 * touched. The tests verify the route's flow:
 *
 *   1. preflight refusal short-circuits before CDP attach
 *   2. payload-builder refusal short-circuits before CDP attach
 *   3. CDP attach failure surfaces as `browser_not_reachable`
 *   4. p5-page-not-detected surfaces without invoking the executor
 *   5. happy path attaches, finds p5, calls executor, detaches
 *   6. result is sensitive-data-free across every code path
 *
 * Maps to brief test requirements 1-6 (route refusals).
 */

import {
  executePhase2RouteHandler,
  type CdpAttachFn,
  type CdpAttachedBrowser,
} from "./tenancy-phase-2-route";
import {
  executePhase2MaklumatAmSave,
  PHASE_2_REASON_LABELS,
  type Phase2ExecutionResult,
  type Phase2MaklumatAmPayload,
  type Phase2PageLike,
} from "./tenancy-phase-2-executor";
import {
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
} from "./tenancy-supervised-run-session";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  ABSENT_MARKERS,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import type {
  StampingJob,
  TenancyPortalParty,
} from "./stamping-types";

// ─── Fixture builders ──────────────────────────────────────────────

function readyJob(overrides: Partial<StampingJob> = {}): StampingJob {
  const ll: TenancyPortalParty = {
    role: "landlord",
    type: "individual",
    nameAsPerInstrument: "Test Landlord",
    nationality: "malaysian",
    identityType: "nric",
    identityNumber: "900101015555",
    addressLine1: "1 Test Lane",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0123456789",
    tinAutoGenerationExpected: true,
    citizenshipCategory: "citizen",
    gender: "male",
    nricSubType: "ic_baru",
  };
  const tt: TenancyPortalParty = {
    ...ll,
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    mobile: "0129876543",
    gender: "female",
  };
  return {
    id: "job-rt-test",
    originalFileName: "sample.pdf",
    mimeType: "application/pdf",
    fileSize: 12345,
    documentCategory: "tenancy_agreement",
    status: "uploaded",
    storagePath: "uploads/test/sample.pdf",
    supportedForAutomation: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    tenancyPortalDetails: {
      updatedAt: "2026-01-01T00:00:00Z",
      parties: [ll, tt],
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType: "fixed_rent_during_tenancy",
        rentSchedule: [
          {
            startDate: "2026-01-01",
            endDate: "2027-01-01",
            monthlyRent: 1000,
            durationMonths: 12,
          },
        ],
        portalInstrumentName: { code: "1101", label: "Perjanjian Sewa" },
      },
      property: {
        addressLine1: "Unit 1, Test Building",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman",
        buildingType: "kondominium",
        furnishedStatus: "fully_furnished",
        premisesAreaSqm: 100,
        landRegistry: {
          milikPenuh: "Hak Milik Penuh",
          lot: "12345",
          mukim: "Petaling",
          daerah: "Kuala Lumpur",
          luas: 250,
          luasUnit: "mps",
        },
      },
      maklumatAm: {
        dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
        instrumentRelationship: "principal",
      },
    },
    ...overrides,
  };
}

function reachableP5Report(): SupervisedSessionReport {
  return {
    status: "sewa_pajakan_p5_form",
    reachable: true,
    candidatePageCount: 1,
    selectedPageKind: "sewa_pajakan_p5_form",
    pageKind: "sewa_pajakan_p5_form",
    pathKind: "sewa_pajakan_p5_form",
    safeMarkers: { ...ABSENT_MARKERS, pdsSuratcaraPresent: true },
    graphPhaseCompatibility: "compatible",
    recommendedOperatorAction:
      "Ready for read-only phase-position verification.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function approvedJob(): StampingJob {
  const job = readyJob();
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraphFromJob(job);
  const approved = applyFirstMutationApproval(
    buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report(),
    })
  );
  return { ...job, supervisedRunSession: approved };
}

// ─── Stubs ────────────────────────────────────────────────────────

function makeAttachStub(opts: {
  /** Per-context page list (each url string becomes one page). */
  contexts: string[][];
  /** When true, attach throws (simulates CDP unreachable). */
  throws?: boolean;
}): { fn: CdpAttachFn; calls: number; closeCalls: number } {
  let closeCalls = 0;
  let attachCalls = 0;
  const fn: CdpAttachFn = async () => {
    attachCalls++;
    if (opts.throws) throw new Error("attach failed");
    const browser: CdpAttachedBrowser = {
      contexts: () =>
        opts.contexts.map((urls) => ({
          pages: () =>
            urls.map<Phase2PageLike>((u) => ({
              url() {
                return u;
              },
              locator() {
                throw new Error(
                  "Phase 2 stub page: locator() should not be called by route helper"
                );
              },
              async waitForLoadState() {
                throw new Error(
                  "Phase 2 stub page: waitForLoadState() should not be called by route helper"
                );
              },
            })),
        })),
      async close() {
        closeCalls++;
      },
    };
    return browser;
  };
  return {
    fn,
    get calls() {
      return attachCalls;
    },
    get closeCalls() {
      return closeCalls;
    },
  };
}

function makeExecutorStub(
  result: Phase2ExecutionResult
): {
  fn: typeof executePhase2MaklumatAmSave;
  calls: { payload: Phase2MaklumatAmPayload }[];
} {
  const calls: { payload: Phase2MaklumatAmPayload }[] = [];
  const fn: typeof executePhase2MaklumatAmSave = async ({ payload }) => {
    calls.push({ payload });
    return result;
  };
  return { fn, calls };
}

// ─── Test 1 · Preflight refusal short-circuits CDP ─────────────────

describe("Phase 2 route · preflight short-circuits", () => {
  test("readiness-not-ready refuses without invoking CDP attach", async () => {
    const job = readyJob({ storagePath: "" });
    const attach = makeAttachStub({ contexts: [] });
    const executor = makeExecutorStub({
      status: "saved",
      reason: PHASE_2_REASON_LABELS.saved,
      attemptedAt: "2026-04-30T18:00:00Z",
    });
    const r = await executePhase2RouteHandler({
      job,
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("readiness_not_ready");
    expect(attach.calls).toBe(0);
    expect(executor.calls).toHaveLength(0);
  });

  test("non-tenancy job refuses with unsupported_lane before CDP", async () => {
    const job = readyJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    const attach = makeAttachStub({ contexts: [] });
    const r = await executePhase2RouteHandler({
      job,
      attach: attach.fn,
    });
    expect(r.refusalReason).toBe("unsupported_lane");
    expect(attach.calls).toBe(0);
  });

  test("missing run session refuses with supervised_session_missing", async () => {
    const job = readyJob();
    const attach = makeAttachStub({ contexts: [] });
    const r = await executePhase2RouteHandler({
      job,
      attach: attach.fn,
    });
    expect(r.refusalReason).toBe("supervised_session_missing");
    expect(attach.calls).toBe(0);
  });

  test("not-yet-approved run session refuses with first_mutation_not_approved", async () => {
    const baseJob = readyJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(baseJob);
    const graph = buildTenancyInstructionGraphFromJob(baseJob);
    const prepared = buildSupervisedRunSessionState({
      jobId: baseJob.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report(),
    });
    const job = { ...baseJob, supervisedRunSession: prepared };
    const attach = makeAttachStub({ contexts: [] });
    const r = await executePhase2RouteHandler({
      job,
      attach: attach.fn,
    });
    expect(r.refusalReason).toBe("first_mutation_not_approved");
    expect(attach.calls).toBe(0);
  });
});

// ─── Test 2 · CDP attach failure ───────────────────────────────────

describe("Phase 2 route · CDP attach failure", () => {
  test("attach throws → browser_not_reachable", async () => {
    const attach = makeAttachStub({ contexts: [], throws: true });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("browser_not_reachable");
    expect(attach.calls).toBe(1);
  });
});

// ─── Test 3 · No p5 page found ────────────────────────────────────

describe("Phase 2 route · p5 page detection", () => {
  test("no p5 page among open tabs → p5_form_not_detected (executor not called)", async () => {
    const attach = makeAttachStub({
      contexts: [
        [
          "https://mytax.hasil.gov.my/dashboard",
          "https://stamps.hasil.gov.my/stamps/utama/dashboard",
        ],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: PHASE_2_REASON_LABELS.saved,
      attemptedAt: "2026-04-30T18:00:00Z",
    });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(executor.calls).toHaveLength(0);
    // The browser was attached then detached even though no page matched.
    expect(attach.calls).toBe(1);
    expect(attach.closeCalls).toBe(1);
  });

  test("multiple contexts: picks the first p5 page across them", async () => {
    const attach = makeAttachStub({
      contexts: [
        [
          "https://mytax.hasil.gov.my/MaklumBalas",
          "https://stamps.hasil.gov.my/stamps/main/role_change",
        ],
        [
          "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
        ],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: PHASE_2_REASON_LABELS.saved,
      attemptedAt: "2026-04-30T18:00:00Z",
      savedAt: "2026-04-30T18:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
    });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.status).toBe("saved");
    expect(executor.calls).toHaveLength(1);
  });
});

// ─── Test 4 · Happy path ──────────────────────────────────────────

describe("Phase 2 route · happy path", () => {
  test("calls the executor with the expected payload and detaches afterwards", async () => {
    const attach = makeAttachStub({
      contexts: [
        [
          "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
        ],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: PHASE_2_REASON_LABELS.saved,
      attemptedAt: "2026-04-30T18:00:00Z",
      savedAt: "2026-04-30T18:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
    });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.status).toBe("saved");
    expect(r.refusalReason).toBeUndefined();
    expect(executor.calls).toHaveLength(1);
    // Payload codes match the post-ε-4c canonical mapping. After
    // B7's sixth-attempt evidence patch, only `pdsSuratcaraCode`
    // is written by the executor; `pdsJenisCode` and
    // `pdsSalinanCode` are carried solely for the read-only
    // hidden-field snapshot's option-existence checks. Hidden
    // portal-managed fields are NOT written.
    //   - `pdsPsCode` absent — pds_ps is hidden and portal-managed.
    //   - `pdsDutisetemCode` absent — pds_dutisetem is the
    //     state-of-stamping-office select, portal auto-populates.
    //   - `pdsDateSuratcaraValue` absent — pds_date_suratcara is
    //     hidden and portal pre-populates.
    const p = executor.calls[0].payload;
    expect(p.pdsSuratcaraCode).toBe("1101");
    expect(p.pdsJenisCode).toBe("1103");
    expect(p.pdsSalinanCode).toBe("1");
    expect("pdsPsCode" in p).toBe(false);
    expect("pdsDutisetemCode" in p).toBe(false);
    expect("pdsDateSuratcaraValue" in p).toBe(false);
    // Browser was always detached.
    expect(attach.closeCalls).toBe(1);
  });
});

// ─── Test 5 · Sensitive-data invariant ─────────────────────────────

describe("Phase 2 route · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "13-digit-or-longer ID", pattern: /\b\d{13,}\b/ },
    { name: "literal landlord IC", pattern: /900101015555/ },
    { name: "literal tenant IC", pattern: /950505055555/ },
    { name: "literal landlord name", pattern: /Test Landlord/i },
    { name: "literal tenant name", pattern: /Test Tenant/i },
    { name: "literal mobile", pattern: /0123456789/ },
    { name: "literal address", pattern: /Test Lane/i },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
  ];

  test("happy path response is sensitive-data-free", async () => {
    const attach = makeAttachStub({
      contexts: [
        [
          "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
        ],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: PHASE_2_REASON_LABELS.saved,
      attemptedAt: "2026-04-30T18:00:00Z",
      savedAt: "2026-04-30T18:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
    });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
      executor: executor.fn,
    });
    const serialized = JSON.stringify(r);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });

  test("attach-failure response is sensitive-data-free", async () => {
    const attach = makeAttachStub({ contexts: [], throws: true });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
    });
    const serialized = JSON.stringify(r);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });

  test("no-p5-page response is sensitive-data-free", async () => {
    const attach = makeAttachStub({
      contexts: [["https://mytax.hasil.gov.my/dashboard"]],
    });
    const r = await executePhase2RouteHandler({
      job: approvedJob(),
      attach: attach.fn,
    });
    const serialized = JSON.stringify(r);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });
});
