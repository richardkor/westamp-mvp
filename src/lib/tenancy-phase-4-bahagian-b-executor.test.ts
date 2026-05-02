/**
 * WeStamp — Tenancy Phase 4 Bahagian B Fixed-Rent Executor · tests
 */

import {
  buildPhase4BahagianBPayload,
  evaluatePhase4BahagianBPreflight,
  executePhase4BahagianBSave,
  formatRentNumeric,
  isoDateToDdMmYyyy,
  PHASE_4_BAHAGIAN_B_HEADING_MATCH,
  PHASE_4_BAHAGIAN_B_REASON_LABELS,
  PHASE_4_PDS_JENIS_FIXED_RENT_CODE,
  PHASE_4_PDS_JENIS_SELECTOR,
  PHASE_4_RENT_ADD_TRIGGER_TEXT_PATTERN,
  PHASE_4_RENT_MODAL_SELECTORS,
  PHASE_4_SECTION_SAVE_SELECTOR,
  PHASE_4_TAB_ANCHOR_TEXT,
  type Phase4BahagianBExecutionResult,
  type Phase4BahagianBPayload,
} from "./tenancy-phase-4-bahagian-b-executor";
import type {
  Phase3LocatorLike,
  Phase3PageLike,
  Phase3SelectOptionTarget,
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

function buildJob(overrides: Partial<StampingJob> = {}): StampingJob {
  return {
    id: "job-b12-test",
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

function jobAtTenantSavedStage(): StampingJob {
  const base = buildJob();
  const session: TenancyRunSessionState = {
    ...approvedSession(base),
    currentRunStage: "phase_3_tenant_individual_saved",
  };
  return { ...base, supervisedRunSession: session };
}

// ─── Mock page ─────────────────────────────────────────────────────

interface MockSelectorConfig {
  count: number;
  selectOptionThrows?: boolean;
  clickThrows?: boolean;
  fillThrows?: boolean;
  pressThrows?: boolean;
  visible?: boolean;
}

interface MockPageOptions {
  preUrl: string;
  postUrl?: string;
  selectors: Record<string, MockSelectorConfig>;
  preRentRowCount?: number;
  /**
   * Row count to return AFTER the rent-modal save click. Defaults
   * to preRentRowCount + 1 (success).
   */
  rentRowCountAfterRentModalSave?: number;
  tabAnchorClickThrows?: boolean;
  rentTriggerClickThrows?: boolean;
  countRowsThrows?: boolean;
  waitForLoadStateThrows?: boolean;
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
  const initialRows = options.preRentRowCount ?? 0;
  const afterRows =
    options.rentRowCountAfterRentModalSave !== undefined
      ? options.rentRowCountAfterRentModalSave
      : initialRows + 1;
  let rentSaveClicked = false;
  let sectionSaved = false;

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
      return sectionSaved
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
          if (selector === PHASE_4_RENT_MODAL_SELECTORS.saveButton) {
            rentSaveClicked = true;
          }
          if (selector === PHASE_4_SECTION_SAVE_SELECTOR) {
            sectionSaved = true;
          }
          void opts;
        },
        async fill(value) {
          if (cfg.fillThrows) throw new Error("fill failed");
          fillCalls.push({ selector, value });
        },
        async isVisible() {
          return cfg.visible !== undefined ? cfg.visible : true;
        },
        async inputValue() { return ""; },
        async press(key) {
          if (cfg.pressThrows) throw new Error("press failed");
          pressCalls.push({ selector, key });
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
      if (options.rentTriggerClickThrows) {
        throw new Error("rent trigger click failed");
      }
    },
    async countTableRowsInRoleSection(args) {
      countRowsCalls.push({ roleHeadingMatch: args.roleHeadingMatch });
      if (options.countRowsThrows) throw new Error("count failed");
      return rentSaveClicked ? afterRows : initialRows;
    },
  };
}

const HAPPY_PAYLOAD: Phase4BahagianBPayload = {
  pdsJenisCode: "1103",
  rentStartDateDdMmYyyy: "01/01/2026",
  rentEndDateDdMmYyyy: "01/01/2027",
  monthlyRentValue: "1000",
};

function happyMockPage(): MockPage {
  return makeMockPage({
    preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    postUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    preRentRowCount: 0,
    selectors: {
      [PHASE_4_PDS_JENIS_SELECTOR]: { count: 1 },
      [PHASE_4_RENT_MODAL_SELECTORS.saveButton]: { count: 1 },
      [PHASE_4_RENT_MODAL_SELECTORS.startDate]: { count: 1 },
      [PHASE_4_RENT_MODAL_SELECTORS.endDate]: { count: 1 },
      [PHASE_4_RENT_MODAL_SELECTORS.monthlyRent]: { count: 1 },
      [PHASE_4_SECTION_SAVE_SELECTOR]: { count: 1 },
    },
  });
}

// ─── Preflight tests ───────────────────────────────────────────────

describe("Phase 4 Bahagian B · preflight", () => {
  test("refuses non-tenancy job → unsupported_lane", () => {
    const j = buildJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    expect(evaluatePhase4BahagianBPreflight(j)).toEqual({
      ok: false,
      refusalReason: "unsupported_lane",
    });
  });

  test("refuses if missing supervisedRunSession", () => {
    expect(evaluatePhase4BahagianBPreflight(buildJob())).toEqual({
      ok: false,
      refusalReason: "supervised_session_missing",
    });
  });

  test("refuses if Maklumat Am NOT yet saved", () => {
    const base = buildJob();
    expect(
      evaluatePhase4BahagianBPreflight({
        ...base,
        supervisedRunSession: approvedSession(base),
      })
    ).toEqual({
      ok: false,
      refusalReason: "maklumat_am_not_saved",
    });
  });

  test("refuses if landlord row not saved (only Maklumat Am saved)", () => {
    const base = buildJob();
    const session: TenancyRunSessionState = {
      ...approvedSession(base),
      currentRunStage: "phase_2_maklumat_am_saved",
    };
    expect(
      evaluatePhase4BahagianBPreflight({ ...base, supervisedRunSession: session })
    ).toEqual({
      ok: false,
      refusalReason: "bahagian_a_not_complete",
    });
  });

  test("refuses if tenant row not saved (only landlord saved)", () => {
    const base = buildJob();
    const session: TenancyRunSessionState = {
      ...approvedSession(base),
      currentRunStage: "phase_3_landlord_individual_saved",
    };
    expect(
      evaluatePhase4BahagianBPreflight({ ...base, supervisedRunSession: session })
    ).toEqual({
      ok: false,
      refusalReason: "bahagian_a_not_complete",
    });
  });

  test("passes when both Bahagian A rows saved", () => {
    expect(evaluatePhase4BahagianBPreflight(jobAtTenantSavedStage())).toEqual({
      ok: true,
    });
  });

  test("idempotently passes when Bahagian B already saved", () => {
    const job = jobAtTenantSavedStage();
    const session: TenancyRunSessionState = {
      ...job.supervisedRunSession!,
      currentRunStage: "phase_4_bahagian_b_fixed_rent_saved",
    };
    expect(
      evaluatePhase4BahagianBPreflight({ ...job, supervisedRunSession: session })
    ).toEqual({ ok: true });
  });

  test("refuses if portalDescriptionType is amendment → unsupported_amendment", () => {
    const job = jobAtTenantSavedStage();
    job.tenancyPortalDetails!.instrument!.portalDescriptionType =
      "amendment_to_original_tenancy";
    const r = evaluatePhase4BahagianBPreflight(job);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([
        "readiness_not_ready",
        "unsupported_amendment",
      ]).toContain(r.refusalReason);
    }
  });

  test("refuses if portalDescriptionType is variable → unsupported_rent_type", () => {
    const job = jobAtTenantSavedStage();
    job.tenancyPortalDetails!.instrument!.portalDescriptionType =
      "variable_rent_during_tenancy";
    const r = evaluatePhase4BahagianBPreflight(job);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([
        "readiness_not_ready",
        "unsupported_rent_type",
      ]).toContain(r.refusalReason);
    }
  });

  test("refuses if rent schedule has more than one period → unsupported_multi_period", () => {
    const job = jobAtTenantSavedStage();
    job.tenancyPortalDetails!.instrument!.rentSchedule = [
      ...job.tenancyPortalDetails!.instrument!.rentSchedule,
      {
        startDate: "2027-02-01",
        endDate: "2028-01-01",
        monthlyRent: 1100,
        durationMonths: 12,
      },
    ];
    const r = evaluatePhase4BahagianBPreflight(job);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([
        "readiness_not_ready",
        "unsupported_multi_period",
      ]).toContain(r.refusalReason);
    }
  });
});

// ─── Payload builder ───────────────────────────────────────────────

describe("Phase 4 Bahagian B · payload builder", () => {
  test("builds payload from a fixed-rent single-period job", () => {
    const r = buildPhase4BahagianBPayload(buildJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.pdsJenisCode).toBe("1103");
      expect(r.payload.rentStartDateDdMmYyyy).toBe("01/01/2026");
      expect(r.payload.rentEndDateDdMmYyyy).toBe("01/01/2027");
      expect(r.payload.monthlyRentValue).toBe("1000");
    }
  });

  test("isoDateToDdMmYyyy converts ISO strings to dd/mm/yyyy", () => {
    expect(isoDateToDdMmYyyy("2026-01-01")).toBe("01/01/2026");
    expect(isoDateToDdMmYyyy("2027-12-31")).toBe("31/12/2027");
    expect(isoDateToDdMmYyyy("not-a-date")).toBeNull();
    expect(isoDateToDdMmYyyy("2026-13-01")).toBeNull();
  });

  test("formatRentNumeric renders integers without decimals", () => {
    expect(formatRentNumeric(1000)).toBe("1000");
    expect(formatRentNumeric(1500.5)).toBe("1500.50");
    expect(formatRentNumeric(0)).toBe("");
    expect(formatRentNumeric(-5)).toBe("");
  });

  test("refuses if rent schedule has more than one period", () => {
    const job = buildJob();
    job.tenancyPortalDetails!.instrument!.rentSchedule = [
      ...job.tenancyPortalDetails!.instrument!.rentSchedule,
      {
        startDate: "2027-02-01",
        endDate: "2028-01-01",
        monthlyRent: 1100,
        durationMonths: 12,
      },
    ];
    const r = buildPhase4BahagianBPayload(job);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusalReason).toBe("unsupported_multi_period");
  });
});

// ─── Executor success path ─────────────────────────────────────────

describe("Phase 4 Bahagian B · executor success path", () => {
  test("opens Bahagian B tab, selects pds_jenis 1103, fills rent modal, clicks two saves", async () => {
    const mock = happyMockPage();
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.preRentRowCount).toBe(0);
    expect(r.postRentRowCount).toBe(1);
    expect(r.fieldsWritten?.pdsJenisCode).toBe("1103");

    // Tab anchor clicked once with "Bahagian B".
    expect(mock.tabAnchorCalls).toEqual([PHASE_4_TAB_ANCHOR_TEXT]);
    // Role-scoped anchor clicked exactly once with the Bahagian B legend match.
    expect(mock.roleScopedAnchorCalls).toEqual([
      {
        roleHeadingMatch: PHASE_4_BAHAGIAN_B_HEADING_MATCH,
        anchorText: PHASE_4_RENT_ADD_TRIGGER_TEXT_PATTERN,
      },
    ]);
    // selectOption fired for pds_jenis with value "1103".
    const jenisCall = mock.selectOptionCalls.find(
      (c) => c.selector === PHASE_4_PDS_JENIS_SELECTOR
    );
    expect(jenisCall).toBeDefined();
    expect(jenisCall!.target).toEqual({ value: "1103" });
    // Rent-modal fields filled.
    const fillSelectors = mock.fillCalls.map((c) => c.selector);
    expect(fillSelectors).toContain(PHASE_4_RENT_MODAL_SELECTORS.startDate);
    expect(fillSelectors).toContain(PHASE_4_RENT_MODAL_SELECTORS.endDate);
    expect(fillSelectors).toContain(PHASE_4_RENT_MODAL_SELECTORS.monthlyRent);
    // Both saves clicked exactly once each.
    const rentSaveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_4_RENT_MODAL_SELECTORS.saveButton
    );
    const sectionSaveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_4_SECTION_SAVE_SELECTOR
    );
    expect(rentSaveClicks).toHaveLength(1);
    expect(sectionSaveClicks).toHaveLength(1);
  });

  test("never touches Bahagian A landlord/tenant triggers nor C/Lampiran/Perakuan/Hantar selectors", async () => {
    const mock = happyMockPage();
    await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    // No role-scoped LANDLORD/TENANT anchor clicks.
    for (const call of mock.roleScopedAnchorCalls) {
      expect(call.roleHeadingMatch).not.toMatch(
        /LANDLORD|PEMBERI SEWA|TUAN TANAH|TENANT|PENYEWA/i
      );
    }
    // Forbidden substrings must not appear anywhere.
    const FORBIDDEN = [
      "tambah_individu",
      "tambah_syarikat",
      "input#tb_nama",
      "input#tb_alamat_1",
      "input#tb_telno",
      "select#warga",
      "select#negeri1",
      "input#kpin",
      "lampiran",
      "table-lampiran",
      "pds_akuan",
      "pre_hantar",
      "pdsL01_button_hantar",
      // Bahagian C selectors (not yet documented but reserved).
      "pds_harta",
      "pds_lot",
      "pds_mukim",
      "pds_daerah",
      "pds_luas",
      // B7 page-level Maklumat Am save button — must NOT be clicked.
      "input#pdsL01_button_simpan",
    ];
    const flat = [
      ...mock.locatorCalls,
      ...mock.fillCalls.map((c) => c.selector),
      ...mock.selectOptionCalls.map((c) => c.selector),
      ...mock.clickCalls,
      ...mock.roleScopedAnchorCalls.map((c) => c.roleHeadingMatch),
      ...mock.roleScopedAnchorCalls.map((c) => c.anchorText),
    ].join(" | ");
    for (const needle of FORBIDDEN) {
      expect({ needle, found: flat.includes(needle) }).toEqual({
        needle,
        found: false,
      });
    }
  });

  test("source code does not introduce requestSubmit() or form#penjual", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "tenancy-phase-4-bahagian-b-executor.ts"),
      "utf8"
    );
    expect(src.includes("requestSubmit")).toBe(false);
  });
});

// ─── Failure paths ─────────────────────────────────────────────────

describe("Phase 4 Bahagian B · executor failure paths", () => {
  test("refuses if not on p5 form", async () => {
    const mock = makeMockPage({
      preUrl: "https://mytax.hasil.gov.my/dashboard",
      selectors: {},
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(mock.tabAnchorCalls).toHaveLength(0);
  });

  test("refuses if Bahagian B tab anchor click throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {},
      tabAnchorClickThrows: true,
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("bahagian_b_not_accessible");
  });

  test("refuses if rent-add trigger click throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      preRentRowCount: 0,
      rentTriggerClickThrows: true,
      selectors: {
        [PHASE_4_PDS_JENIS_SELECTOR]: { count: 1 },
      },
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("rent_modal_open_failed");
    expect(r.failedFieldKey).toBe("rent_add_trigger");
  });

  test("fails with rent_row_not_added when row count doesn't climb", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      preRentRowCount: 0,
      rentRowCountAfterRentModalSave: 0,
      selectors: {
        [PHASE_4_PDS_JENIS_SELECTOR]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.saveButton]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.startDate]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.endDate]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.monthlyRent]: { count: 1 },
        [PHASE_4_SECTION_SAVE_SELECTOR]: { count: 1 },
      },
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      postClickStabilizationMs: 0,
    });
    expect(r.refusalReason).toBe("rent_row_not_added");
    expect(r.failedFieldKey).toBe("rent_row_count");
    // Section Simpan was NOT clicked because rent row didn't commit.
    expect(mock.clickCalls).not.toContain(PHASE_4_SECTION_SAVE_SELECTOR);
  });

  test("fails with save_button_missing when section save selector doesn't resolve", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      preRentRowCount: 0,
      selectors: {
        [PHASE_4_PDS_JENIS_SELECTOR]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.saveButton]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.startDate]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.endDate]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.monthlyRent]: { count: 1 },
        [PHASE_4_SECTION_SAVE_SELECTOR]: { count: 0 },
      },
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      postClickStabilizationMs: 0,
    });
    expect(r.refusalReason).toBe("save_button_missing");
    expect(r.failedFieldKey).toBe("section_save_button");
  });

  test("fails with fill_failed when start-date fill throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      preRentRowCount: 0,
      selectors: {
        [PHASE_4_PDS_JENIS_SELECTOR]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.saveButton]: { count: 1 },
        [PHASE_4_RENT_MODAL_SELECTORS.startDate]: {
          count: 1,
          fillThrows: true,
        },
      },
    });
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("fill_failed");
    expect(r.failedFieldKey).toBe("rent_modal_start_date");
    // Rent-modal save NOT clicked.
    expect(mock.clickCalls).not.toContain(PHASE_4_RENT_MODAL_SELECTORS.saveButton);
  });
});

// ─── Sensitive-data invariant ──────────────────────────────────────

describe("Phase 4 Bahagian B · sensitive-data invariant", () => {
  test("result on success is sensitive-data-free for portal identifiers", async () => {
    const mock = happyMockPage();
    const r = await executePhase4BahagianBSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const ser = JSON.stringify(r);
    expect(ser).not.toMatch(/https?:\/\//i);
    expect(ser).not.toMatch(/\/stamps\//);
    expect(ser).not.toMatch(/href=/i);
    expect(ser).not.toMatch(/lhdnmsstoken/i);
    expect(ser).not.toContain("Test Landlord");
    expect(ser).not.toContain("Test Tenant");
    expect(ser).not.toContain("900101015555");
    expect(ser).not.toContain("950505055555");
  });

  test("forbidden wording does not appear in any reason label", () => {
    const all = Object.values(PHASE_4_BAHAGIAN_B_REASON_LABELS).join(" ");
    expect(all).not.toMatch(/\bsubmitted\b/i);
    expect(all).not.toMatch(/\bsent to LHDN\b/i);
    // The brief allows the word "Hantar" as a no-Hantar disclaimer
    // BUT we don't include it in any label here — confirm absence.
    expect(all).not.toMatch(/\bHantar\b/i);
    expect(all).not.toMatch(/\bpaid\b/i);
    expect(all).not.toMatch(/certificate retrieved/i);
  });
});

// ─── Result type sanity ────────────────────────────────────────────

describe("Phase 4 Bahagian B · result type sanity", () => {
  test("Phase4BahagianBExecutionResult shape is what the route persists", () => {
    const r: Phase4BahagianBExecutionResult = {
      status: "saved",
      reason: "Bahagian B fixed-rent data saved.",
      attemptedAt: "2026-05-01T00:00:00Z",
      savedAt: "2026-05-01T00:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRentRowCount: 0,
      postRentRowCount: 1,
      fieldsWritten: {
        pdsJenisCode: "1103",
        rentStartDateDdMmYyyy: "01/01/2026",
        rentEndDateDdMmYyyy: "01/01/2027",
        monthlyRentValue: "1000",
      },
    };
    expect(r.status).toBe("saved");
    expect(r.fieldsWritten?.pdsJenisCode).toBe("1103");
  });
});
