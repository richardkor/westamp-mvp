/**
 * WeStamp — Tenancy Phase 4 Bahagian B Route Helper · tests
 */

import {
  executePhase4BahagianBRouteHandler,
  type Phase4BahagianBCdpAttachFn,
  type Phase4BahagianBCdpAttachedBrowser,
} from "./tenancy-phase-4-bahagian-b-route";
import type { Phase3PageLike } from "./tenancy-phase-3-landlord-executor";
import type { Phase4BahagianBExecutionResult } from "./tenancy-phase-4-bahagian-b-executor";
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
    recommendedOperatorAction: "Ready for Phase 4.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function buildBaseJob(): StampingJob {
  return {
    id: "job-route-b12",
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

function jobAtTenantSavedStage(): StampingJob {
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
    currentRunStage: "phase_3_tenant_individual_saved",
  };
  return { ...base, supervisedRunSession: session };
}

function makeAttachStub(opts: { contexts: string[][] }): {
  fn: Phase4BahagianBCdpAttachFn;
  closeCalls: number;
} {
  let closeCalls = 0;
  const fn: Phase4BahagianBCdpAttachFn = async () => {
    const browser: Phase4BahagianBCdpAttachedBrowser = {
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
    fn: Phase4BahagianBCdpAttachFn;
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

function makeExecutorStub(result: Phase4BahagianBExecutionResult): {
  fn: typeof import("./tenancy-phase-4-bahagian-b-executor").executePhase4BahagianBSave;
  calls: { payload: unknown }[];
} {
  const calls: { payload: unknown }[] = [];
  const fn = async (opts: { page: Phase3PageLike; payload: unknown }) => {
    calls.push({ payload: opts.payload });
    return result;
  };
  return { fn, calls };
}

describe("Phase 4 route · refuses on preflight failures", () => {
  test("missing supervised session", async () => {
    const r = await executePhase4BahagianBRouteHandler({
      job: buildBaseJob(),
    });
    expect(r.refusalReason).toBe("supervised_session_missing");
  });

  test("Maklumat Am not saved", async () => {
    const base = buildBaseJob();
    const r = evaluateTenancyPortalRunReadiness(base);
    const g = buildTenancyInstructionGraphFromJob(base);
    const session = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId: base.id,
        readinessReport: r,
        instructionGraph: g,
        browserSessionReport: reachableP5Report(),
      })
    );
    const result = await executePhase4BahagianBRouteHandler({
      job: { ...base, supervisedRunSession: session },
    });
    expect(result.refusalReason).toBe("maklumat_am_not_saved");
  });

  test("landlord row not yet saved", async () => {
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
      currentRunStage: "phase_2_maklumat_am_saved",
    };
    const result = await executePhase4BahagianBRouteHandler({
      job: { ...base, supervisedRunSession: session },
    });
    expect(result.refusalReason).toBe("bahagian_a_not_complete");
  });

  test("tenant row not yet saved", async () => {
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
    const result = await executePhase4BahagianBRouteHandler({
      job: { ...base, supervisedRunSession: session },
    });
    expect(result.refusalReason).toBe("bahagian_a_not_complete");
  });
});

describe("Phase 4 route · CDP + executor orchestration", () => {
  test("attaches, finds p5, calls executor, detaches", async () => {
    const attach = makeAttachStub({
      contexts: [["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"]],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "Bahagian B fixed-rent data saved.",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:02Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRentRowCount: 0,
      postRentRowCount: 1,
    });
    const r = await executePhase4BahagianBRouteHandler({
      job: jobAtTenantSavedStage(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.status).toBe("saved");
    expect(r.preRentRowCount).toBe(0);
    expect(r.postRentRowCount).toBe(1);
    expect(executor.calls).toHaveLength(1);
    expect(attach.closeCalls).toBe(1);
  });

  test("p5_form_not_detected when no p5 page found", async () => {
    const attach = makeAttachStub({
      contexts: [["https://mytax.hasil.gov.my/dashboard"]],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "should not be called",
      attemptedAt: "2026-05-01T00:00:00Z",
    });
    const r = await executePhase4BahagianBRouteHandler({
      job: jobAtTenantSavedStage(),
      attach: attach.fn,
      executor: executor.fn,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(executor.calls).toHaveLength(0);
  });

  test("browser_not_reachable when CDP attach throws", async () => {
    const attach: Phase4BahagianBCdpAttachFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await executePhase4BahagianBRouteHandler({
      job: jobAtTenantSavedStage(),
      attach,
    });
    expect(r.refusalReason).toBe("browser_not_reachable");
  });

  test("payload carries pdsJenisCode '1103' + dd/mm/yyyy dates + monthly rent", async () => {
    const attach = makeAttachStub({
      contexts: [["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"]],
    });
    const executor = makeExecutorStub({
      status: "saved",
      reason: "ok",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:02Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRentRowCount: 0,
      postRentRowCount: 1,
    });
    await executePhase4BahagianBRouteHandler({
      job: jobAtTenantSavedStage(),
      attach: attach.fn,
      executor: executor.fn,
    });
    const p = executor.calls[0].payload as {
      pdsJenisCode: string;
      rentStartDateDdMmYyyy: string;
      rentEndDateDdMmYyyy: string;
      monthlyRentValue: string;
    };
    expect(p.pdsJenisCode).toBe("1103");
    expect(p.rentStartDateDdMmYyyy).toBe("01/01/2026");
    expect(p.rentEndDateDdMmYyyy).toBe("01/01/2027");
    expect(p.monthlyRentValue).toBe("1000");
  });

  test("executor exception → failed/save_failed", async () => {
    const attach = makeAttachStub({
      contexts: [["https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123"]],
    });
    const executor = (async () => {
      throw new Error("unexpected");
    }) as unknown as typeof import("./tenancy-phase-4-bahagian-b-executor").executePhase4BahagianBSave;
    const r = await executePhase4BahagianBRouteHandler({
      job: jobAtTenantSavedStage(),
      attach: attach.fn,
      executor,
    });
    expect(r.status).toBe("failed");
    expect(r.refusalReason).toBe("save_failed");
  });
});
