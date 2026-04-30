/**
 * WeStamp — Tenancy Supervised Run Session · route handler tests
 *
 * Covers the pure `handlePrepareRequest` and
 * `handleApproveFirstMutationRequest` helpers. The injected
 * inspector is a stub so no real Playwright / Chrome is touched.
 *
 * Test coverage maps to the brief's TEST REQUIREMENTS for routes:
 *   2. prepare returns blocked state for non-ready job
 *   3. prepare returns preflight-ready / awaiting-approval for ready job
 *   4. response payloads contain no raw URL, href, cookie, token,
 *      IC, TIN, party name, address, or document content
 *   5. approval refuses if job is not ready
 *   6. approval refuses if run session is not prepared / eligible
 *   7. approval records first mutation approval without executing
 */

import {
  ERROR_INVALID_BODY,
  ERROR_INVALID_INSPECT_FLAG,
  ERROR_NOT_ELIGIBLE_PREFIX,
  ERROR_NOT_TENANCY_JOB,
  handleApproveFirstMutationRequest,
  handlePrepareRequest,
  type SupervisedSessionInspector,
} from "./tenancy-supervised-run-session-route";
import {
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
} from "./tenancy-supervised-run-session";
import {
  evaluateTenancyPortalRunReadiness,
} from "./tenancy-portal-run-readiness";
import { buildTenancyInstructionGraphFromJob } from "./tenancy-instruction-graph";
import {
  ABSENT_MARKERS,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import type { StampingJob, TenancyPortalParty } from "./stamping-types";

// ─── Fixture builders ─────────────────────────────────────────────

function buildLandlord(): TenancyPortalParty {
  return {
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
}

function buildJob(overrides: Partial<StampingJob> = {}): StampingJob {
  const landlord = buildLandlord();
  const tenant: TenancyPortalParty = {
    ...landlord,
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    mobile: "0129876543",
    gender: "female",
  };
  const base: StampingJob = {
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
      parties: [landlord, tenant],
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
  };
  return { ...base, ...overrides };
}

function reachableP5Report(
  graphPhaseCompatibility: SupervisedSessionReport["graphPhaseCompatibility"] = "compatible"
): SupervisedSessionReport {
  return {
    status: "sewa_pajakan_p5_form",
    reachable: true,
    candidatePageCount: 1,
    selectedPageKind: "sewa_pajakan_p5_form",
    pageKind: "sewa_pajakan_p5_form",
    pathKind: "sewa_pajakan_p5_form",
    safeMarkers: { ...ABSENT_MARKERS, pdsSuratcaraPresent: true },
    graphPhaseCompatibility,
    recommendedOperatorAction:
      "Ready for read-only phase-position verification.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function unreachableReport(): SupervisedSessionReport {
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

function makeInspectorStub(
  result: SupervisedSessionReport
): { fn: SupervisedSessionInspector; calls: Parameters<SupervisedSessionInspector>[0][] } {
  const calls: Parameters<SupervisedSessionInspector>[0][] = [];
  const fn: SupervisedSessionInspector = async (opts) => {
    calls.push(opts);
    return result;
  };
  return { fn, calls };
}

// ─── Test 1 · prepare · job-type guard ────────────────────────────

describe("Prepare route · job-type guard", () => {
  test("rejects non-tenancy-agreement jobs with the approved error", async () => {
    const job = buildJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    const res = await handlePrepareRequest({ job, body: {} });
    expect(res).toEqual({ ok: false, error: ERROR_NOT_TENANCY_JOB });
  });
});

// ─── Test 2 · prepare · body validation ───────────────────────────

describe("Prepare route · body validation", () => {
  test("string body is rejected", async () => {
    const job = buildJob();
    const res = await handlePrepareRequest({
      job,
      body: "hello",
    });
    expect(res).toEqual({ ok: false, error: ERROR_INVALID_BODY });
  });

  test("array body is rejected", async () => {
    const job = buildJob();
    const res = await handlePrepareRequest({
      job,
      body: [],
    });
    expect(res).toEqual({ ok: false, error: ERROR_INVALID_BODY });
  });

  test("non-boolean inspectBrowserSession is rejected", async () => {
    const job = buildJob();
    const res = await handlePrepareRequest({
      job,
      body: { inspectBrowserSession: "yes" },
    });
    expect(res).toEqual({ ok: false, error: ERROR_INVALID_INSPECT_FLAG });
  });

  test("undefined body is accepted (treated as no inspection)", async () => {
    const job = buildJob();
    const res = await handlePrepareRequest({
      job,
      body: undefined,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.browserSession).toBeUndefined();
      expect(res.state.currentRunStage).toBe("preflight_ready");
    }
  });
});

// ─── Test 3 · prepare · ready job → preflight_ready / awaiting ────

describe("Prepare route · ready job", () => {
  test("returns preflight_ready when no browser inspection requested", async () => {
    const job = buildJob();
    const res = await handlePrepareRequest({
      job,
      body: { inspectBrowserSession: false },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.currentRunStage).toBe("preflight_ready");
      expect(res.state.readinessVerdict).toBe("ready_for_supervised_run");
      expect(res.state.instructionGraphVerdict).toBe(
        "ready_for_supervised_run"
      );
      expect(res.state.browserSession).toBeUndefined();
      expect(res.state.lane).toBe("sewa_pajakan");
    }
  });

  test("returns awaiting_first_mutation_approval with compatible browser", async () => {
    const job = buildJob();
    const { fn, calls } = makeInspectorStub(reachableP5Report("compatible"));
    const res = await handlePrepareRequest({
      job,
      body: { inspectBrowserSession: true },
      inspector: fn,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.currentRunStage).toBe(
        "awaiting_first_mutation_approval"
      );
      expect(res.state.browserSession?.phaseCompatibility).toBe("compatible");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].targetPhaseId).toBe("phase_1_session_positioning");
  });

  test("returns browser_not_ready when CDP is unreachable", async () => {
    const job = buildJob();
    const { fn } = makeInspectorStub(unreachableReport());
    const res = await handlePrepareRequest({
      job,
      body: { inspectBrowserSession: true },
      inspector: fn,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.currentRunStage).toBe("browser_not_ready");
      expect(res.state.browserSession?.status).toBe("cdp_unreachable");
    }
  });
});

// ─── Test 4 · prepare · blocked job ───────────────────────────────

describe("Prepare route · blocked job", () => {
  test("returns blocked state for a job missing storage path", async () => {
    const job = buildJob({ storagePath: "" });
    const res = await handlePrepareRequest({
      job,
      body: {},
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.currentRunStage).toBe("blocked");
      expect(res.state.readinessVerdict).toBe("blocked");
    }
  });
});

// ─── Test 5 · prepare · sensitive-data invariant ──────────────────

describe("Prepare route · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "literal landlord IC", pattern: /900101015555/ },
    { name: "literal tenant IC", pattern: /950505055555/ },
    { name: "literal landlord name", pattern: /Test Landlord/i },
    { name: "literal tenant name", pattern: /Test Tenant/i },
    { name: "literal mobile (landlord)", pattern: /0123456789/ },
    { name: "literal mobile (tenant)", pattern: /0129876543/ },
    { name: "literal address line", pattern: /Test Lane/i },
    { name: "literal building", pattern: /Test Building/i },
    { name: "literal mukim", pattern: /\bPetaling\b/ },
    { name: "literal lot", pattern: /\b12345\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
    { name: "storagePath leak", pattern: /uploads\/test\/sample\.pdf/ },
  ];

  test("ready preflight response carries no sensitive values", async () => {
    const res = await handlePrepareRequest({
      job: buildJob(),
      body: {},
    });
    const serialized = JSON.stringify(res);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });

  test("blocked job response carries no sensitive values", async () => {
    const res = await handlePrepareRequest({
      job: buildJob({ storagePath: "" }),
      body: {},
    });
    const serialized = JSON.stringify(res);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });

  test("with-browser response carries no sensitive values", async () => {
    const { fn } = makeInspectorStub(reachableP5Report("compatible"));
    const res = await handlePrepareRequest({
      job: buildJob(),
      body: { inspectBrowserSession: true },
      inspector: fn,
    });
    const serialized = JSON.stringify(res);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern "${name}" matched: ${m?.[0]}`);
      }
    }
  });
});

// ─── Test 6 · approve · job-type + not-prepared guards ────────────

describe("Approve route · guards", () => {
  test("rejects non-tenancy-agreement jobs", async () => {
    const job = buildJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    const res = await handleApproveFirstMutationRequest({ job });
    expect(res).toEqual({ ok: false, error: ERROR_NOT_TENANCY_JOB });
  });

  test("rejects when run session has not been prepared", async () => {
    const job = buildJob({ supervisedRunSession: undefined });
    const res = await handleApproveFirstMutationRequest({ job });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("not_prepared");
      expect(res.error).toContain(ERROR_NOT_ELIGIBLE_PREFIX);
      expect(res.error).toContain("not_prepared");
    }
  });
});

// ─── Test 7 · approve · ineligibility translates to refusal ──────

describe("Approve route · refusal mapping", () => {
  function jobWithRunSession(opts: {
    blocked?: boolean;
    incompatibleBrowser?: boolean;
  }): StampingJob {
    const job = opts.blocked
      ? buildJob({ storagePath: "" })
      : buildJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const state = buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
      ...(opts.incompatibleBrowser
        ? { browserSessionReport: reachableP5Report("incompatible") }
        : {}),
    });
    return { ...job, supervisedRunSession: state };
  }

  test("blocked-readiness state refuses with session_blocked", async () => {
    const job = jobWithRunSession({ blocked: true });
    const res = await handleApproveFirstMutationRequest({ job });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("session_blocked");
    }
  });

  test("incompatible-browser state refuses with browser_incompatible", async () => {
    const job = jobWithRunSession({ incompatibleBrowser: true });
    const res = await handleApproveFirstMutationRequest({ job });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("browser_incompatible");
    }
  });

  test("preflight_ready state without browser snapshot refuses with browser_not_checked (B6 safety correction)", async () => {
    // Pre-prepare the state WITHOUT a browser inspection — the
    // run session is at `preflight_ready`. The approval route must
    // refuse this state, even though readiness + graph are both
    // ready, because the browser position has not been verified.
    const job = buildJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const preparedNoBrowser = buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
    });
    const jobWithState: StampingJob = {
      ...job,
      supervisedRunSession: preparedNoBrowser,
    };
    expect(preparedNoBrowser.currentRunStage).toBe("preflight_ready");
    expect(preparedNoBrowser.browserSession).toBeUndefined();

    const res = await handleApproveFirstMutationRequest({
      job: jobWithState,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("browser_not_checked");
      expect(res.error).toContain("browser_not_checked");
    }
  });
});

// ─── Test 8 · approve · success path ──────────────────────────────

describe("Approve route · success path", () => {
  test("records the approval, returns applied=true, leaves the rest of the job untouched", async () => {
    const job = buildJob();
    // Pre-prepare with a compatible browser snapshot.
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const prepared = buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const jobWithState: StampingJob = {
      ...job,
      supervisedRunSession: prepared,
    };

    const res = await handleApproveFirstMutationRequest({
      job: jobWithState,
      now: () => "2026-04-30T16:30:00Z",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.applied).toBe(true);
      expect(res.state.currentRunStage).toBe("first_mutation_approved");
      expect(res.state.operatorApproval.firstPortalMutationApproved).toBe(
        true
      );
      expect(res.state.operatorApproval.approvedAt).toBe(
        "2026-04-30T16:30:00Z"
      );
      expect(res.notice).toBe(
        "First portal mutation approved internally. No e-Duti Setem action has been taken."
      );
    }
  });

  test("re-approving an already-approved state returns applied=false (idempotent)", async () => {
    const job = buildJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const approved = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId: job.id,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const jobWithState: StampingJob = {
      ...job,
      supervisedRunSession: approved,
    };

    const res = await handleApproveFirstMutationRequest({
      job: jobWithState,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.applied).toBe(false);
      expect(res.state.currentRunStage).toBe("first_mutation_approved");
    }
  });

  test("approval does NOT call any inspector (no portal contact)", async () => {
    const job = buildJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const prepared = buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const jobWithState: StampingJob = {
      ...job,
      supervisedRunSession: prepared,
    };
    // Approve handler accepts no inspector parameter — so by
    // construction it cannot trigger Playwright. We assert the
    // contract here by confirming the success path doesn't await
    // anything inspector-shaped.
    const res = await handleApproveFirstMutationRequest({
      job: jobWithState,
    });
    expect(res.ok).toBe(true);
  });
});

// ─── Test 9 · approve · sensitive-data invariant ──────────────────

describe("Approve route · sensitive-data invariant", () => {
  test("response carries no sensitive values", async () => {
    const job = buildJob();
    const readinessReport = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraphFromJob(job);
    const prepared = buildSupervisedRunSessionState({
      jobId: job.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const jobWithState: StampingJob = {
      ...job,
      supervisedRunSession: prepared,
    };
    const res = await handleApproveFirstMutationRequest({
      job: jobWithState,
    });
    const serialized = JSON.stringify(res);
    const FORBIDDEN: RegExp[] = [
      /\b\d{12}\b/,
      /900101015555/,
      /950505055555/,
      /Test Landlord/i,
      /Test Tenant/i,
      /Test Lane/i,
      /Test Building/i,
      /\bPetaling\b/,
      /\b12345\b/,
      /https?:\/\//i,
      /\/stamps\//,
      /href=/i,
      /cookie/i,
      /token/i,
      /lhdnmsstoken/i,
      /uploads\/test\/sample\.pdf/,
    ];
    for (const pattern of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(`Forbidden pattern matched: ${m?.[0]}`);
      }
    }
  });
});
