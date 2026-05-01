/**
 * WeStamp — Tenancy Phase 3 Tenant Route Helper · tests
 */

import {
  executePhase3TenantRouteHandler,
  type Phase3TenantCdpAttachFn,
  type Phase3TenantCdpAttachedBrowser,
} from "./tenancy-phase-3-tenant-route";
import type { Phase3PageLike } from "./tenancy-phase-3-landlord-executor";
import type { Phase3TenantExecutionResult } from "./tenancy-phase-3-tenant-executor";
import {
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
  type TenancyRunSessionState,
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

function landlord(): TenancyPortalParty {
  return {
    role: "landlord",
    type: "individual",
    nameAsPerInstrument: "Test Landlord",
    nationality: "malaysian",
    citizenshipCategory: "citizen",
    identityType: "nric",
    identityNumber: "900101015555",
    nricSubType: "ic_baru",
    gender: "male",
    addressLine1: "1 Test Lane",
    addressLine2: "Block A",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0123456789",
    tinAutoGenerationExpected: true,
  };
}

function tenant(): TenancyPortalParty {
  return {
    ...landlord(),
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    addressLine2: "Block B",
    gender: "female",
    mobile: "0129876543",
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
    recommendedOperatorAction: "Ready for Phase 3 tenant.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function buildBaseJob(): StampingJob {
  return {
    id: "job-route-tenant-test",
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
      parties: [landlord(), tenant()],
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
}

function jobWithLandlordRowSaved(): StampingJob {
  const base = buildBaseJob();
  const r = evaluateTenancyPortalRunReadiness(base);
  const g = buildTenancyInstructionGraphFromJob(base);
  const session: TenancyRunSessionState = {
    ...applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId: base.id,
        readinessReport: r,
        instructionGraph: g,
        browserSessionReport: reachableP5Report(),
      })
    ),
    currentRunStage: "phase_3_landlord_individual_saved",
  };
  return { ...base, supervisedRunSession: session };
}

// ─── CDP attach stub ───────────────────────────────────────────────

function makeAttachStub(opts: { contexts: string[][] }): {
  fn: Phase3TenantCdpAttachFn;
  closeCalls: number;
} {
  let closeCalls = 0;
  const fn: Phase3TenantCdpAttachFn = async () => {
    const browser: Phase3TenantCdpAttachedBrowser = {
      contexts() {
        return opts.contexts.map((urls) => ({
          pages() {
            return urls.map((url) => makeStubPage(url));
          },
        }));
      },
      close: async () => {
        closeCalls++;
      },
    };
    return browser;
  };
  return { fn, get closeCalls() { return closeCalls; } } as unknown as {
    fn: Phase3TenantCdpAttachFn;
    closeCalls: number;
  };
}

function makeStubPage(url: string): Phase3PageLike {
  return {
    url() { return url; },
    locator() {
      return {
        async count() { return 1; },
        async selectOption() {},
        async click() {},
        async fill() {},
        async isVisible() { return true; },
        async inputValue() { return ""; },
        async press() {},
      };
    },
    async waitForLoadState() {},
    async clickTabAnchor() {},
    async clickRoleScopedAnchor() {},
    async countTableRowsInRoleSection() { return 0; },
  };
}

function makeExecutorStub(result: Phase3TenantExecutionResult): {
  fn: typeof import("./tenancy-phase-3-tenant-executor").executePhase3TenantIndividualSave;
  calls: { payload: unknown }[];
} {
  const calls: { payload: unknown }[] = [];
  const fn = async (opts: { page: Phase3PageLike; payload: unknown }) => {
    calls.push({ payload: opts.payload });
    return result;
  };
  return { fn, calls };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Phase 3 tenant route · refuses on preflight failures", () => {
  test("missing supervised session → supervised_session_missing", async () => {
    const r = await executePhase3TenantRouteHandler({
      job: buildBaseJob(),
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("supervised_session_missing");
  });

  test("Maklumat Am not saved → maklumat_am_not_saved", async () => {
    const base = buildBaseJob();
    const rr = evaluateTenancyPortalRunReadiness(base);
    const g = buildTenancyInstructionGraphFromJob(base);
    const approved = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId: base.id,
        readinessReport: rr,
        instructionGraph: g,
        browserSessionReport: reachableP5Report(),
      })
    );
    const result = await executePhase3TenantRouteHandler({
      job: { ...base, supervisedRunSession: approved },
    });
    expect(result.refusalReason).toBe("maklumat_am_not_saved");
  });

  test("landlord row not saved → landlord_row_not_saved", async () => {
    const base = buildBaseJob();
    const rr = evaluateTenancyPortalRunReadiness(base);
    const g = buildTenancyInstructionGraphFromJob(base);
    const session: TenancyRunSessionState = {
      ...applyFirstMutationApproval(
        buildSupervisedRunSessionState({
          jobId: base.id,
          readinessReport: rr,
          instructionGraph: g,
          browserSessionReport: reachableP5Report(),
        })
      ),
      currentRunStage: "phase_2_maklumat_am_saved",
    };
    const result = await executePhase3TenantRouteHandler({
      job: { ...base, supervisedRunSession: session },
    });
    expect(result.refusalReason).toBe("landlord_row_not_saved");
  });

  test("no individual tenant (SSM-typed) → route refuses", async () => {
    const job = jobWithLandlordRowSaved();
    job.tenancyPortalDetails!.parties = job.tenancyPortalDetails!.parties.map(
      (p) => (p.role === "tenant" ? { ...p, type: "company_ssm" } : p)
    );
    const r = await executePhase3TenantRouteHandler({ job });
    expect(r.status).toBe("refused");
    expect([
      "readiness_not_ready",
      "tenant_individual_party_missing",
    ]).toContain(r.refusalReason);
  });

  test("model-required field missing → readiness gate refuses first", async () => {
    const job = jobWithLandlordRowSaved();
    const t = job.tenancyPortalDetails!.parties.find(
      (p) => p.role === "tenant"
    )!;
    t.mobile = "";
    const r = await executePhase3TenantRouteHandler({ job });
    expect(r.refusalReason).toBe("readiness_not_ready");
  });
});

describe("Phase 3 tenant route · CDP + executor orchestration", () => {
  test("attaches to CDP, finds the p5 page, calls the executor, detaches", async () => {
    const attach = makeAttachStub({
      contexts: [
        ["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "Tenant-individual row saved.",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRowCount: 0,
      postRowCount: 1,
    });
    const r = await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.status).toBe("saved");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(1);
    expect(executor.calls).toHaveLength(1);
    expect(attach.closeCalls).toBe(1);
  });

  test("refuses with p5_form_not_detected when no p5 page is found", async () => {
    const attach = makeAttachStub({
      contexts: [["https://mytax.hasil.gov.my/dashboard"]],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "should not be called",
      attemptedAt: "2026-05-01T00:00:00Z",
    });
    const r = await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(executor.calls).toHaveLength(0);
    expect(attach.closeCalls).toBe(1);
  });

  test("returns refused/browser_not_reachable when CDP attach throws", async () => {
    const attach: Phase3TenantCdpAttachFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach,
    });
    expect(r.refusalReason).toBe("browser_not_reachable");
  });

  test("payload carries tenant party + portal-canonical codes", async () => {
    const attach = makeAttachStub({
      contexts: [
        ["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "ok",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:02Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRowCount: 0,
      postRowCount: 1,
    });
    await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach: attach.fn,
      executor: executor.fn,
    });
    const p = executor.calls[0].payload as {
      party: TenancyPortalParty;
      citizenshipPortalCode: string;
      nricSubTypeRadioId: string;
      genderRadioId: string;
      statePortalCode: string;
      countryLabel: string;
      telephoneValue: string;
      telephoneFallbackUsed: boolean;
      addressLine2Value: string;
      postcodeValue: string;
    };
    expect(p.party.role).toBe("tenant");
    expect(p.citizenshipPortalCode).toBe("1");
    expect(p.nricSubTypeRadioId).toBe("IC_BARU");
    expect(p.genderRadioId).toBe("USER_SEX-2"); // tenant is female
    expect(p.statePortalCode).toBe("14");
    expect(p.countryLabel).toBe("MALAYSIA");
    expect(p.telephoneValue).toBe("0129876543");
    expect(p.telephoneFallbackUsed).toBe(false);
    expect(p.addressLine2Value).toBe("Block B");
    expect(p.postcodeValue).toBe("50000");
  });

  test("executor exception → failed/save_failed (defence in depth)", async () => {
    const attach = makeAttachStub({
      contexts: [
        ["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"],
      ],
    });
    const executor = (async () => {
      throw new Error("unexpected");
    }) as unknown as typeof import("./tenancy-phase-3-tenant-executor").executePhase3TenantIndividualSave;
    const r = await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach: attach.fn,
      executor,
    });
    expect(r.status).toBe("failed");
    expect(r.refusalReason).toBe("save_failed");
    expect(attach.closeCalls).toBe(1);
  });
});

describe("Phase 3 tenant route · sensitive-data invariant", () => {
  test("results never leak portal URL or party PII to JSON", async () => {
    const attach = makeAttachStub({
      contexts: [
        ["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"],
      ],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "Tenant-individual row saved.",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:02Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRowCount: 0,
      postRowCount: 1,
    });
    const r = await executePhase3TenantRouteHandler({
      job: jobWithLandlordRowSaved(),
      attach: attach.fn,
      executor: executor.fn,
    });
    const ser = JSON.stringify(r);
    expect(ser).not.toMatch(/https?:\/\//i);
    expect(ser).not.toMatch(/\/stamps\//);
    expect(ser).not.toContain("Test Tenant");
    expect(ser).not.toContain("950505055555");
  });
});
