/**
 * WeStamp — Tenancy Phase 3 Tenant-Individual Executor · tests
 *
 * Covers Milestone B11 — the THIRD mutation milestone.
 */

import {
  buildPhase3TenantPayload,
  collectMissingTenantFields,
  evaluatePhase3TenantPreflight,
  executePhase3TenantIndividualSave,
  PHASE_3_TENANT_HEADING_MATCH,
  PHASE_3_TENANT_REASON_LABELS,
  PHASE_3_TENANT_TRIGGER_TEXT,
  type Phase3TenantExecutionResult,
  type Phase3TenantPayload,
} from "./tenancy-phase-3-tenant-executor";
import {
  PHASE_3_MODAL_FIELD_SELECTORS,
  PHASE_3_MODAL_SAVE_SELECTOR,
  PHASE_3_TAB_ANCHOR_TEXT,
  type Phase3LocatorLike,
  type Phase3PageLike,
  type Phase3SelectOptionTarget,
} from "./tenancy-phase-3-landlord-executor";
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

// ─── Fixtures ──────────────────────────────────────────────────────

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
    mobile: "0129876543",
    gender: "female",
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

function buildJob(overrides: Partial<StampingJob> = {}): StampingJob {
  return {
    id: "job-b11-test",
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
    ...overrides,
  };
}

function approvedSession(jobBase: StampingJob): TenancyRunSessionState {
  const r = evaluateTenancyPortalRunReadiness(jobBase);
  const g = buildTenancyInstructionGraphFromJob(jobBase);
  return applyFirstMutationApproval(
    buildSupervisedRunSessionState({
      jobId: jobBase.id,
      readinessReport: r,
      instructionGraph: g,
      browserSessionReport: reachableP5Report(),
    })
  );
}

function jobWithLandlordRowSaved(): StampingJob {
  const base = buildJob();
  const session: TenancyRunSessionState = {
    ...approvedSession(base),
    currentRunStage: "phase_3_landlord_individual_saved",
  };
  return { ...base, supervisedRunSession: session };
}

function jobWithMaklumatAmSavedOnly(): StampingJob {
  const base = buildJob();
  const session: TenancyRunSessionState = {
    ...approvedSession(base),
    currentRunStage: "phase_2_maklumat_am_saved",
  };
  return { ...base, supervisedRunSession: session };
}

// ─── Mock page (mirrors landlord test mock) ────────────────────────

interface MockSelectorConfig {
  count: number;
  selectOptionThrows?: boolean;
  clickThrows?: boolean;
  fillThrows?: boolean;
  pressThrows?: boolean;
  visible?: boolean;
  inputValue?: string;
}

interface MockPageOptions {
  preUrl: string;
  postUrl?: string;
  selectors: Record<string, MockSelectorConfig>;
  tenantRowCount?: number;
  tenantRowCountAfterSave?: number;
  tabAnchorClickThrows?: boolean;
  triggerClickThrows?: boolean;
  countRowsThrows?: boolean;
  waitForLoadStateThrows?: boolean;
  identityResolutionMode?: "tin_resolved" | "manual_fallback" | "neither";
}

interface MockPage extends Phase3PageLike {
  locatorCalls: string[];
  selectOptionCalls: { selector: string; target: Phase3SelectOptionTarget }[];
  fillCalls: { selector: string; value: string }[];
  clickCalls: string[];
  pressCalls: { selector: string; key: string }[];
  tabAnchorCalls: string[];
  roleScopedAnchorCalls: { roleHeadingMatch: string; anchorText: string }[];
  countRowsCalls: { roleHeadingMatch: string }[];
}

function makeMockPage(options: MockPageOptions): MockPage {
  const locatorCalls: string[] = [];
  const selectOptionCalls: { selector: string; target: Phase3SelectOptionTarget }[] = [];
  const fillCalls: { selector: string; value: string }[] = [];
  const clickCalls: string[] = [];
  const pressCalls: { selector: string; key: string }[] = [];
  const tabAnchorCalls: string[] = [];
  const roleScopedAnchorCalls: { roleHeadingMatch: string; anchorText: string }[] = [];
  const countRowsCalls: { roleHeadingMatch: string }[] = [];
  const initialRows = options.tenantRowCount ?? 0;
  const afterRows =
    options.tenantRowCountAfterSave !== undefined
      ? options.tenantRowCountAfterSave
      : initialRows + 1;
  let saveClicked = false;
  let kpinTabPressed = false;
  const identityResolutionMode = options.identityResolutionMode ?? "tin_resolved";

  function getCfg(selector: string): MockSelectorConfig {
    const cfg = options.selectors[selector];
    if (!cfg) throw new Error(`MockPage: no config for "${selector}"`);
    return cfg;
  }

  return {
    locatorCalls,
    selectOptionCalls,
    fillCalls,
    clickCalls,
    pressCalls,
    tabAnchorCalls,
    roleScopedAnchorCalls,
    countRowsCalls,
    url(): string {
      return saveClicked
        ? options.postUrl ?? options.preUrl
        : options.preUrl;
    },
    locator(selector: string): Phase3LocatorLike {
      locatorCalls.push(selector);
      const cfg = getCfg(selector);
      return {
        async count() { return cfg.count; },
        async selectOption(target) {
          if (cfg.selectOptionThrows) throw new Error("selectOption failed");
          selectOptionCalls.push({ selector, target });
        },
        async click(opts) {
          if (cfg.clickThrows) throw new Error("click failed");
          clickCalls.push(selector);
          if (selector === PHASE_3_MODAL_SAVE_SELECTOR) saveClicked = true;
          void opts;
        },
        async fill(value) {
          if (cfg.fillThrows) throw new Error("fill failed");
          fillCalls.push({ selector, value });
        },
        async isVisible() {
          if (cfg.visible !== undefined) return cfg.visible;
          if (selector === "input#USER_SEX-1" || selector === "input#USER_SEX-2") {
            return kpinTabPressed && identityResolutionMode === "manual_fallback";
          }
          return true;
        },
        async inputValue() {
          if (cfg.inputValue !== undefined) return cfg.inputValue;
          if (
            selector === PHASE_3_MODAL_FIELD_SELECTORS.tinHidden &&
            kpinTabPressed &&
            identityResolutionMode === "tin_resolved"
          ) {
            return "OG12345A";
          }
          return "";
        },
        async press(key) {
          if (cfg.pressThrows) throw new Error("press failed");
          pressCalls.push({ selector, key });
          if (
            selector === PHASE_3_MODAL_FIELD_SELECTORS.identityNumber &&
            key === "Tab"
          ) {
            kpinTabPressed = true;
          }
        },
      };
    },
    async waitForLoadState() {
      if (options.waitForLoadStateThrows) throw new Error("networkidle timed out");
    },
    async clickTabAnchor(args) {
      tabAnchorCalls.push(args.text);
      if (options.tabAnchorClickThrows) throw new Error("tab anchor click failed");
    },
    async clickRoleScopedAnchor(args) {
      roleScopedAnchorCalls.push({
        roleHeadingMatch: args.roleHeadingMatch,
        anchorText: args.anchorText,
      });
      if (options.triggerClickThrows) throw new Error("role-scoped anchor click failed");
    },
    async countTableRowsInRoleSection(args) {
      countRowsCalls.push({ roleHeadingMatch: args.roleHeadingMatch });
      if (options.countRowsThrows) throw new Error("count failed");
      return saveClicked ? afterRows : initialRows;
    },
  };
}

const HAPPY_PAYLOAD: Phase3TenantPayload = {
  party: tenant(),
  citizenshipPortalCode: "1",
  nricSubTypeRadioId: "IC_BARU",
  genderRadioId: "USER_SEX-2",
  dateOfBirthDdMmYyyy: "05/05/1995",
  statePortalCode: "14",
  countryLabel: "MALAYSIA",
  telephoneValue: "0129876543",
  telephoneFallbackUsed: false,
  addressLine1Value: "2 Test Lane",
  addressLine1FallbackUsed: false,
  addressLine2Value: "Block B",
  addressLine2FallbackUsed: false,
  postcodeValue: "50000",
};

function happyMockPage(): MockPage {
  return makeMockPage({
    preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    postUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    tenantRowCount: 0,
    identityResolutionMode: "tin_resolved",
    selectors: {
      [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
      "input#IC_BARU": { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: { count: 1 },
      "input#USER_SEX-1": { count: 1 },
      "input#USER_SEX-2": { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.tinHidden]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.addressLine1]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.addressLine2]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.postcode]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.city]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.state]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.country]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.mobile]: { count: 1 },
    },
  });
}

// ─── Preflight tests ───────────────────────────────────────────────

describe("Phase 3 tenant · preflight", () => {
  test("refuses non-tenancy job → unsupported_lane", () => {
    const j = buildJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    expect(evaluatePhase3TenantPreflight(j)).toEqual({
      ok: false,
      refusalReason: "unsupported_lane",
    });
  });

  test("refuses missing supervisedRunSession → supervised_session_missing", () => {
    expect(evaluatePhase3TenantPreflight(buildJob())).toEqual({
      ok: false,
      refusalReason: "supervised_session_missing",
    });
  });

  test("refuses if Maklumat Am NOT yet saved → maklumat_am_not_saved", () => {
    const base = buildJob();
    const session = approvedSession(base);
    expect(
      evaluatePhase3TenantPreflight({ ...base, supervisedRunSession: session })
    ).toEqual({ ok: false, refusalReason: "maklumat_am_not_saved" });
  });

  test("refuses if landlord row NOT yet saved → landlord_row_not_saved", () => {
    expect(evaluatePhase3TenantPreflight(jobWithMaklumatAmSavedOnly())).toEqual({
      ok: false,
      refusalReason: "landlord_row_not_saved",
    });
  });

  test("passes when landlord row already saved (phase_3_landlord_individual_saved)", () => {
    const r = evaluatePhase3TenantPreflight(jobWithLandlordRowSaved());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.party.role).toBe("tenant");
  });

  test("idempotently passes when tenant row already saved (re-attempt)", () => {
    const job = jobWithLandlordRowSaved();
    const session: TenancyRunSessionState = {
      ...job.supervisedRunSession!,
      currentRunStage: "phase_3_tenant_individual_saved",
    };
    const r = evaluatePhase3TenantPreflight({
      ...job,
      supervisedRunSession: session,
    });
    expect(r.ok).toBe(true);
  });

  test("refuses if no individual tenant party exists", () => {
    const job = jobWithLandlordRowSaved();
    job.tenancyPortalDetails!.parties = job.tenancyPortalDetails!.parties.map(
      (p) => (p.role === "tenant" ? { ...p, type: "company_ssm" } : p)
    );
    const r = evaluatePhase3TenantPreflight(job);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([
        "readiness_not_ready",
        "tenant_individual_party_missing",
      ]).toContain(r.refusalReason);
    }
  });

  test("refuses if tenant required field missing → readiness gate fires first", () => {
    const job = jobWithLandlordRowSaved();
    const tenantParty = job.tenancyPortalDetails!.parties.find(
      (p) => p.role === "tenant"
    )!;
    tenantParty.gender = undefined;
    expect(evaluatePhase3TenantPreflight(job)).toEqual({
      ok: false,
      refusalReason: "readiness_not_ready",
    });
  });
});

// ─── Payload builder tests ─────────────────────────────────────────

describe("Phase 3 tenant · payload builder", () => {
  test("builds payload with portal-canonical codes", () => {
    const r = buildPhase3TenantPayload(tenant());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.citizenshipPortalCode).toBe("1");
      expect(r.payload.nricSubTypeRadioId).toBe("IC_BARU");
      expect(r.payload.genderRadioId).toBe("USER_SEX-2"); // tenant is female
      expect(r.payload.statePortalCode).toBe("14");
      expect(r.payload.countryLabel).toBe("MALAYSIA");
      expect(r.payload.telephoneValue).toBe("0129876543");
      expect(r.payload.addressLine1Value).toBe("2 Test Lane");
      expect(r.payload.addressLine2Value).toBe("Block B");
      expect(r.payload.postcodeValue).toBe("50000");
    }
  });

  test("falls back to '0' for missing telephone", () => {
    const t = tenant();
    t.mobile = "";
    const r = buildPhase3TenantPayload(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.telephoneValue).toBe("0");
      expect(r.payload.telephoneFallbackUsed).toBe(true);
    }
  });

  test("falls back to 'jalan' for missing addressLine2", () => {
    const t = tenant();
    delete t.addressLine2;
    const r = buildPhase3TenantPayload(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.addressLine2Value).toBe("jalan");
      expect(r.payload.addressLine2FallbackUsed).toBe(true);
    }
  });

  test("postcode must be exactly 5 numeric digits", () => {
    const t = tenant();
    t.postcode = "5000";
    const r = buildPhase3TenantPayload(t);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusalReason).toBe("required_field_missing");
      expect(r.failedFieldKey).toBe("postcode");
    }
  });

  test("Sarawak maps to portal code '11', not Kedah", () => {
    const t = tenant();
    t.state = "Sarawak";
    t.postcode = "98000";
    const r = buildPhase3TenantPayload(t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.statePortalCode).toBe("11");
  });
});

// ─── Executor success path ─────────────────────────────────────────

describe("Phase 3 tenant · executor success path", () => {
  test("opens only TENANT modal, fills expected fields, clicks Simpan once", async () => {
    const mock = happyMockPage();
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(1);

    // Tab anchor clicked once.
    expect(mock.tabAnchorCalls).toEqual([PHASE_3_TAB_ANCHOR_TEXT]);
    // Role-scoped trigger clicked exactly once with TENANT heading.
    expect(mock.roleScopedAnchorCalls).toEqual([
      {
        roleHeadingMatch: PHASE_3_TENANT_HEADING_MATCH,
        anchorText: PHASE_3_TENANT_TRIGGER_TEXT,
      },
    ]);
    // No landlord/company heading appeared.
    for (const call of mock.roleScopedAnchorCalls) {
      expect(call.roleHeadingMatch).not.toMatch(
        /LANDLORD|PEMBERI SEWA|TUAN TANAH/i
      );
    }
    // Modal Simpan clicked exactly once.
    const saveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_3_MODAL_SAVE_SELECTOR
    );
    expect(saveClicks).toHaveLength(1);
  });

  test("resolved-IC path skips gender + DOB", async () => {
    const mock = happyMockPage();
    await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    // Gender radio not clicked on resolved-IC path.
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-2");
    // DOB not filled.
    const dobFill = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth
    );
    expect(dobFill).toBeUndefined();
  });

  test("fills addressLine1, addressLine2, postcode, city, state, country, mobile", async () => {
    const mock = happyMockPage();
    await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const fillSelectors = mock.fillCalls.map((c) => c.selector);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.name);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.identityNumber);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.addressLine1);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.addressLine2);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.postcode);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.city);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.mobile);
    const selectSelectors = mock.selectOptionCalls.map((c) => c.selector);
    expect(selectSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.warga);
    expect(selectSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.state);
    expect(selectSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.country);
  });

  test("fills tb_telno with payload.telephoneValue (0 fallback included verbatim)", async () => {
    const mock = happyMockPage();
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: { ...HAPPY_PAYLOAD, telephoneValue: "0", telephoneFallbackUsed: true },
    });
    expect(r.status).toBe("saved");
    expect(r.telephoneFallbackUsed).toBe(true);
    const tel = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.mobile
    );
    expect(tel!.value).toBe("0");
  });

  test("never touches Bahagian B / C / Lampiran / Perakuan / Hantar selectors", async () => {
    const mock = happyMockPage();
    await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const FORBIDDEN = [
      "pds_balasan",
      "pds_harta",
      "pds_lot",
      "pds_mukim",
      "pds_daerah",
      "lampiran",
      "pds_akuan",
      "pre_hantar",
      "pdsL01_button_hantar",
      "table-lampiran",
      "tambah_syarikat",
      // The tenant flow must NOT click the LANDLORD-scoped trigger.
      "LANDLORD",
      "PEMBERI SEWA",
      "TUAN TANAH",
    ];
    const flat = [
      ...mock.locatorCalls,
      ...mock.fillCalls.map((c) => c.selector),
      ...mock.selectOptionCalls.map((c) => c.selector),
      ...mock.clickCalls,
      ...mock.roleScopedAnchorCalls.map((c) => c.roleHeadingMatch),
    ].join(" | ");
    for (const needle of FORBIDDEN) {
      expect({ needle, found: flat.includes(needle) }).toEqual({
        needle,
        found: false,
      });
    }
  });

  test("never invokes the page-level B7 save button (input#pdsL01_button_simpan)", async () => {
    const mock = happyMockPage();
    await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(mock.clickCalls).not.toContain("input#pdsL01_button_simpan");
  });

  test("source code does not introduce requestSubmit() or form#penjual", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "tenancy-phase-3-tenant-executor.ts"),
      "utf8"
    );
    expect(src.includes("requestSubmit")).toBe(false);
    expect(src.includes("form#penjual")).toBe(false);
  });
});

// ─── Failure paths ─────────────────────────────────────────────────

describe("Phase 3 tenant · executor failure paths", () => {
  test("refuses if not on p5 form", async () => {
    const mock = makeMockPage({
      preUrl: "https://mytax.hasil.gov.my/dashboard",
      selectors: {},
    });
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(mock.tabAnchorCalls).toHaveLength(0);
  });

  test("refuses if Bahagian A tab anchor click throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {},
      tabAnchorClickThrows: true,
    });
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("bahagian_a_not_accessible");
  });

  test("refuses if tenant trigger click throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {},
      triggerClickThrows: true,
      tenantRowCount: 0,
    });
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("tenant_individual_trigger_missing");
    expect(r.preRowCount).toBe(0);
  });

  test("fails with row_count_not_updated when post-save count doesn't climb", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      tenantRowCount: 0,
      tenantRowCountAfterSave: 0,
      identityResolutionMode: "tin_resolved",
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
        "input#IC_BARU": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: { count: 1 },
        "input#USER_SEX-1": { count: 1 },
        "input#USER_SEX-2": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.tinHidden]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.addressLine1]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.addressLine2]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.postcode]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.city]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.state]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.country]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.mobile]: { count: 1 },
      },
    });
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      postClickStabilizationMs: 0,
    });
    expect(r.refusalReason).toBe("row_count_not_updated");
    expect(r.failedFieldKey).toBe("row_count_verification");
  });

  test("manual_fallback path → manual_identity_fallback_required, gender NOT auto-clicked", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      tenantRowCount: 0,
      identityResolutionMode: "manual_fallback",
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
        "input#IC_BARU": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: { count: 1 },
        "input#USER_SEX-1": { count: 1 },
        "input#USER_SEX-2": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.tinHidden]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.addressLine1]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.addressLine2]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.postcode]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.city]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.state]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.country]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.mobile]: { count: 1 },
      },
    });
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      identityResolutionWaitMs: 500,
    });
    expect(r.refusalReason).toBe("manual_identity_fallback_required");
    expect(r.failedFieldKey).toBe("identityNumber");
    expect(mock.clickCalls).not.toContain(PHASE_3_MODAL_SAVE_SELECTOR);
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-2");
  });
});

// ─── Sensitive-data invariant ──────────────────────────────────────

describe("Phase 3 tenant · sensitive-data invariant", () => {
  test("result on success is sensitive-data-free", async () => {
    const mock = happyMockPage();
    const r = await executePhase3TenantIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const ser = JSON.stringify(r);
    expect(ser).not.toMatch(/https?:\/\//i);
    expect(ser).not.toMatch(/\/stamps\//);
    expect(ser).not.toMatch(/href=/i);
    expect(ser).not.toMatch(/lhdnmsstoken/i);
    expect(ser).not.toContain("Test Tenant");
    expect(ser).not.toContain("950505055555");
    expect(ser).not.toContain("0129876543");
  });

  test("forbidden wording does not appear in any reason label", () => {
    const all = Object.values(PHASE_3_TENANT_REASON_LABELS).join(" ");
    expect(all).not.toMatch(/\bsubmitted\b/i);
    expect(all).not.toMatch(/\bsent to LHDN\b/i);
    expect(all).not.toMatch(/\bHantar\b/i);
    expect(all).not.toMatch(/\bpaid\b/i);
    expect(all).not.toMatch(/certificate retrieved/i);
  });
});

// ─── collectMissingTenantFields ────────────────────────────────────

describe("Phase 3 tenant · field invariants", () => {
  test("collectMissingTenantFields lists every required key for an empty party", () => {
    const empty: TenancyPortalParty = {
      role: "tenant",
      type: "individual",
      nameAsPerInstrument: "",
      addressLine1: "",
      postcode: "",
      city: "",
      state: "",
      country: "",
      mobile: "",
    };
    const missing = collectMissingTenantFields(empty);
    expect(missing).toContain("nameAsPerInstrument");
    expect(missing).toContain("citizenshipCategory");
    expect(missing).toContain("identityType");
    expect(missing).toContain("identityNumber");
    expect(missing).toContain("gender");
    expect(missing).toContain("addressLine1");
    expect(missing).toContain("postcode");
    expect(missing).toContain("city");
    expect(missing).toContain("state");
    expect(missing).toContain("country");
    expect(missing).toContain("mobile");
  });
});

// ─── Result type sanity ────────────────────────────────────────────

describe("Phase 3 tenant · result type sanity", () => {
  test("Phase3TenantExecutionResult shape is what the route persists", () => {
    const r: Phase3TenantExecutionResult = {
      status: "saved",
      reason: "Tenant-individual row saved.",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRowCount: 0,
      postRowCount: 1,
    };
    expect(r.status).toBe("saved");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(1);
  });
});
