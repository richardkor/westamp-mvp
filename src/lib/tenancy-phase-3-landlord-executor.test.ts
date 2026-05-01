/**
 * WeStamp — Tenancy Phase 3 Landlord-Individual Executor · tests
 *
 * Covers Milestone B10 — the SECOND mutation milestone.
 */

import {
  buildPhase3LandlordPayload,
  collectMissingLandlordFields,
  deriveDobFromIcBaru,
  evaluatePhase3LandlordPreflight,
  executePhase3LandlordIndividualSave,
  PHASE_3_LANDLORD_HEADING_MATCH,
  PHASE_3_LANDLORD_REASON_LABELS,
  PHASE_3_LANDLORD_TRIGGER_TEXT,
  PHASE_3_MODAL_FIELD_SELECTORS,
  PHASE_3_MODAL_SAVE_SELECTOR,
  PHASE_3_TAB_ANCHOR_TEXT,
  type Phase3LandlordExecutionResult,
  type Phase3LandlordPayload,
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
    recommendedOperatorAction: "Ready for Phase 3.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function buildJob(
  overrides: Partial<StampingJob> = {}
): StampingJob {
  return {
    id: "job-b10-test",
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

function jobWithMaklumatAmSaved(): StampingJob {
  // Build approved state, then bump stage to phase_2_maklumat_am_saved.
  const base = buildJob();
  const readinessReport = evaluateTenancyPortalRunReadiness(base);
  const graph = buildTenancyInstructionGraphFromJob(base);
  const approved = applyFirstMutationApproval(
    buildSupervisedRunSessionState({
      jobId: base.id,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report(),
    })
  );
  const bumped: TenancyRunSessionState = {
    ...approved,
    currentRunStage: "phase_2_maklumat_am_saved",
  };
  return { ...base, supervisedRunSession: bumped };
}

// ─── Mock Phase3PageLike ───────────────────────────────────────────

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
  /** Initial landlord row count returned by countTableRowsInRoleSection. */
  landlordRowCount?: number;
  /** Row count returned AFTER the modal Simpan click. Defaults to preCount + 1 (success). */
  landlordRowCountAfterSave?: number;
  /** Whether the tab anchor click throws. */
  tabAnchorClickThrows?: boolean;
  /** Whether the role-scoped trigger click throws. */
  triggerClickThrows?: boolean;
  /** Whether countTableRows throws. */
  countRowsThrows?: boolean;
  /** Whether waitForLoadState throws. */
  waitForLoadStateThrows?: boolean;
  /**
   * Identity-resolution behaviour after the kpin Tab keypress.
   * Default = "tin_resolved" (the resolved-IC happy path):
   * `tb_cukai` becomes non-empty, gender stays hidden.
   *   - "tin_resolved":    tb_cukai value = portal-resolved TIN.
   *   - "manual_fallback": tb_cukai stays empty; gender radios
   *                        become visible.
   *   - "neither":         tb_cukai stays empty AND gender stays
   *                        hidden (cascade silently failed).
   */
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
  const initialRows = options.landlordRowCount ?? 0;
  const afterRows =
    options.landlordRowCountAfterSave !== undefined
      ? options.landlordRowCountAfterSave
      : initialRows + 1;
  let saveClicked = false;
  // Track whether the kpin Tab keypress has been recorded — this
  // is the trigger that fires the portal's identity cascade.
  let kpinTabPressed = false;
  const identityResolutionMode =
    options.identityResolutionMode ?? "tin_resolved";

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
        async count() {
          return cfg.count;
        },
        async selectOption(target) {
          if (cfg.selectOptionThrows) throw new Error("selectOption failed");
          selectOptionCalls.push({ selector, target });
        },
        async click(opts) {
          if (cfg.clickThrows) throw new Error("click failed");
          clickCalls.push(selector);
          if (selector === PHASE_3_MODAL_SAVE_SELECTOR) {
            saveClicked = true;
          }
          void opts;
        },
        async fill(value) {
          if (cfg.fillThrows) throw new Error("fill failed");
          fillCalls.push({ selector, value });
        },
        async isVisible() {
          if (cfg.visible !== undefined) return cfg.visible;
          // Gender radio visibility depends on the resolution mode:
          //   - manual_fallback → visible AFTER Tab (invalid IC)
          //   - tin_resolved    → never visible (resolved IC)
          //   - neither         → never visible (cascade failed)
          if (
            selector === "input#USER_SEX-1" ||
            selector === "input#USER_SEX-2"
          ) {
            return (
              kpinTabPressed && identityResolutionMode === "manual_fallback"
            );
          }
          return true;
        },
        async inputValue() {
          if (cfg.inputValue !== undefined) return cfg.inputValue;
          // tb_cukai is populated AFTER Tab on the resolved path,
          // simulating the portal's TIN auto-resolve.
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
      if (options.waitForLoadStateThrows) {
        throw new Error("networkidle timed out");
      }
    },
    async clickTabAnchor(args) {
      tabAnchorCalls.push(args.text);
      if (options.tabAnchorClickThrows) {
        throw new Error("tab anchor click failed");
      }
    },
    async clickRoleScopedAnchor(args) {
      roleScopedAnchorCalls.push({
        roleHeadingMatch: args.roleHeadingMatch,
        anchorText: args.anchorText,
      });
      if (options.triggerClickThrows) {
        throw new Error("role-scoped anchor click failed");
      }
    },
    async countTableRowsInRoleSection(args) {
      countRowsCalls.push({ roleHeadingMatch: args.roleHeadingMatch });
      if (options.countRowsThrows) throw new Error("count failed");
      return saveClicked ? afterRows : initialRows;
    },
  };
}

const HAPPY_PAYLOAD: Phase3LandlordPayload = {
  party: landlord(),
  citizenshipPortalCode: "1",
  nricSubTypeRadioId: "IC_BARU",
  genderRadioId: "USER_SEX-1",
  // Retained for the future invalid-IC fallback path; the
  // resolved-IC path does NOT fill DOB.
  dateOfBirthDdMmYyyy: "01/01/1990",
  statePortalCode: "14",
  countryLabel: "MALAYSIA",
  telephoneValue: "0123456789",
  telephoneFallbackUsed: false,
  addressLine1Value: "1 Test Lane",
  addressLine1FallbackUsed: false,
  addressLine2Value: "Block A",
  addressLine2FallbackUsed: false,
  postcodeValue: "50000",
};

function happyMockPage(): MockPage {
  return makeMockPage({
    preUrl:
      "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    postUrl:
      "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    landlordRowCount: 0,
    // Default = resolved-IC happy path: tb_cukai populates after
    // kpin Tab, gender stays hidden, executor skips gender + DOB.
    identityResolutionMode: "tin_resolved",
    selectors: {
      [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
      "input#IC_BARU": { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: { count: 1 },
      // Gender + DOB selectors are present in DOM (count: 1) but
      // the resolved-IC path never queries them for click/fill —
      // the mock's `isVisible` returns false for gender on the
      // resolved path, and the executor skips them.
      "input#USER_SEX-1": { count: 1 },
      [PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth]: { count: 1 },
      // tb_cukai (hidden TIN) — populated by the mock's inputValue
      // override after kpin Tab on the resolved path.
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

// ─── Tests ─────────────────────────────────────────────────────────

describe("Phase 3 landlord · preflight", () => {
  test("refuses non-tenancy job → unsupported_lane", () => {
    const j = buildJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    expect(evaluatePhase3LandlordPreflight(j)).toEqual({
      ok: false,
      refusalReason: "unsupported_lane",
    });
  });

  test("refuses missing supervisedRunSession → supervised_session_missing", () => {
    expect(
      evaluatePhase3LandlordPreflight(buildJob())
    ).toEqual({
      ok: false,
      refusalReason: "supervised_session_missing",
    });
  });

  test("refuses if Maklumat Am NOT yet saved → maklumat_am_not_saved", () => {
    // Approved but Phase 2 not yet executed.
    const base = buildJob();
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
    expect(
      evaluatePhase3LandlordPreflight({ ...base, supervisedRunSession: session })
    ).toEqual({
      ok: false,
      refusalReason: "maklumat_am_not_saved",
    });
  });

  test("refuses when the landlord party is converted to SSM", () => {
    // Replacing the individual landlord with an SSM-typed party
    // surfaces a refusal — either through the model-level
    // readiness gate (because the SSM data isn't fully captured)
    // OR through the B10 `landlord_individual_party_missing`
    // check. Both are valid refusal points; the test asserts the
    // route refuses with a known closed-enum code.
    const job = jobWithMaklumatAmSaved();
    job.tenancyPortalDetails!.parties = job.tenancyPortalDetails!.parties.map(
      (p) => (p.role === "landlord" ? { ...p, type: "company_ssm" } : p)
    );
    const r = evaluatePhase3LandlordPreflight(job);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([
        "readiness_not_ready",
        "landlord_individual_party_missing",
      ]).toContain(r.refusalReason);
    }
  });

  test("refuses if landlord required field missing → readiness_not_ready (readiness gate fires first)", () => {
    // The readiness gate fires before the per-field B10 preflight,
    // so an individual landlord with a missing required field
    // surfaces as `readiness_not_ready`. This is intentional —
    // model-layer readiness is the canonical check. The B10
    // `required_field_missing` code is reserved for downstream
    // mapping refusals (e.g., state name that doesn't map to a
    // negeri1 code) detected by the payload builder.
    const job = jobWithMaklumatAmSaved();
    job.tenancyPortalDetails!.parties[0].gender = undefined;
    expect(evaluatePhase3LandlordPreflight(job)).toEqual({
      ok: false,
      refusalReason: "readiness_not_ready",
    });
  });

  test("passes when Maklumat Am saved and landlord complete", () => {
    const r = evaluatePhase3LandlordPreflight(jobWithMaklumatAmSaved());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.party.role).toBe("landlord");
  });
});

describe("Phase 3 landlord · payload builder", () => {
  test("builds payload with portal-canonical codes", () => {
    const r = buildPhase3LandlordPayload(landlord());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.citizenshipPortalCode).toBe("1");
      expect(r.payload.nricSubTypeRadioId).toBe("IC_BARU");
      expect(r.payload.genderRadioId).toBe("USER_SEX-1");
      expect(r.payload.dateOfBirthDdMmYyyy).toBe("01/01/1990");
      expect(r.payload.statePortalCode).toBe("14"); // KL → Wilayah Persekutuan KL
      expect(r.payload.countryLabel).toBe("MALAYSIA");
    }
  });

  test("refuses on missing citizenshipCategory → required_field_missing", () => {
    const ll = landlord();
    delete ll.citizenshipCategory;
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusalReason).toBe("required_field_missing");
      expect(r.failedFieldKey).toBe("citizenshipCategory");
    }
  });

  test("refuses if state name doesn't map to any portal code", () => {
    const ll = landlord();
    ll.state = "Atlantis";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedFieldKey).toBe("state");
  });

  test("refuses if identityType is not nric (B10 supports NRIC only)", () => {
    const ll = landlord();
    ll.identityType = "passport";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedFieldKey).toBe("nricSubType");
  });

  test("country resolves by label (uppercased)", () => {
    const ll = landlord();
    ll.country = "malaysia";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.countryLabel).toBe("MALAYSIA");
  });
});

describe("Phase 3 landlord · DOB derivation", () => {
  test("derives 1990-01-01 from IC 900101015555", () => {
    expect(deriveDobFromIcBaru("900101015555")).toBe("01/01/1990");
  });

  test("derives 2005-12-31 from IC 051231015555", () => {
    expect(deriveDobFromIcBaru("051231015555")).toBe("31/12/2005");
  });

  test("returns null for malformed IC", () => {
    expect(deriveDobFromIcBaru("abc")).toBeNull();
    expect(deriveDobFromIcBaru("99")).toBeNull();
    expect(deriveDobFromIcBaru("999999999999")).toBeNull(); // month=99 invalid
  });
});

describe("Phase 3 landlord · executor success path", () => {
  test("opens only landlord modal, fills expected fields, clicks Simpan exactly once", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(1);

    // Tab anchor clicked once with "Bahagian A".
    expect(mock.tabAnchorCalls).toEqual([PHASE_3_TAB_ANCHOR_TEXT]);
    // Role-scoped trigger clicked exactly once with the LANDLORD heading.
    expect(mock.roleScopedAnchorCalls).toEqual([
      {
        roleHeadingMatch: PHASE_3_LANDLORD_HEADING_MATCH,
        anchorText: PHASE_3_LANDLORD_TRIGGER_TEXT,
      },
    ]);
    // No tenant heading appeared.
    for (const call of mock.roleScopedAnchorCalls) {
      expect(call.roleHeadingMatch).not.toMatch(/TENANT|PENYEWA/i);
    }
    // Modal Simpan clicked exactly once.
    const saveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_3_MODAL_SAVE_SELECTOR
    );
    expect(saveClicks).toHaveLength(1);
  });

  test("resolved-IC path fills only the fields the portal still requires (no gender, no DOB)", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const fillSelectors = new Set(mock.fillCalls.map((c) => c.selector));
    // Always-filled (operator-supplied) fields.
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.name)).toBe(true);
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.identityNumber)).toBe(true);
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.addressLine1)).toBe(true);
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.postcode)).toBe(true);
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.city)).toBe(true);
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.mobile)).toBe(true);
    // Resolved-IC path: DOB is portal-managed → never filled.
    expect(fillSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth)).toBe(
      false
    );
    // selectOption fired for warga, state, country.
    const selectSelectors = new Set(
      mock.selectOptionCalls.map((c) => c.selector)
    );
    expect(selectSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.warga)).toBe(true);
    expect(selectSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.state)).toBe(true);
    expect(selectSelectors.has(PHASE_3_MODAL_FIELD_SELECTORS.country)).toBe(true);
    // Radio click for NRIC sub-type ✓; gender NEVER clicked on the
    // resolved-IC path.
    expect(mock.clickCalls).toContain("input#IC_BARU");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-2");
  });

  test("never touches Bahagian B / C / Lampiran / Perakuan / Hantar / payment selectors", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
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
      // tenant-side trigger should never be queried via the role-
      // scoped anchor click — covered by the previous test.
    ];
    const flat = [
      ...mock.locatorCalls,
      ...mock.fillCalls.map((c) => c.selector),
      ...mock.selectOptionCalls.map((c) => c.selector),
      ...mock.clickCalls,
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
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(mock.clickCalls).not.toContain("input#pdsL01_button_simpan");
    // The modal save selector is scoped to the bootbox modal.
    expect(PHASE_3_MODAL_SAVE_SELECTOR).toContain(".bootbox.modal.in");
    expect(PHASE_3_MODAL_SAVE_SELECTOR).not.toBe("input#pdsL01_button_simpan");
  });
});

describe("Phase 3 landlord · executor failure paths", () => {
  test("refuses if not on p5 form → p5_form_not_detected", async () => {
    const mock = makeMockPage({
      preUrl: "https://mytax.hasil.gov.my/dashboard",
      selectors: {},
    });
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(mock.tabAnchorCalls).toHaveLength(0);
  });

  test("refuses if Bahagian A tab anchor click throws → bahagian_a_not_accessible", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {},
      tabAnchorClickThrows: true,
    });
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("bahagian_a_not_accessible");
  });

  test("refuses if landlord trigger click throws → landlord_individual_trigger_missing", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {},
      triggerClickThrows: true,
      landlordRowCount: 0,
    });
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("landlord_individual_trigger_missing");
    expect(r.preRowCount).toBe(0);
  });

  test("fails with modal_not_opened when modal save selector doesn't resolve", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 0 }, // modal didn't open
      },
    });
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("modal_not_opened");
    expect(r.failedFieldKey).toBe("modal_open");
  });

  test("fails with row_count_not_updated when post-save count doesn't climb by 1", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
      landlordRowCountAfterSave: 0, // didn't grow
      identityResolutionMode: "tin_resolved",
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
        "input#IC_BARU": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: { count: 1 },
        "input#USER_SEX-1": { count: 1 },
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
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      postClickStabilizationMs: 0,
    });
    expect(r.refusalReason).toBe("row_count_not_updated");
    expect(r.failedFieldKey).toBe("row_count_verification");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(0);
  });

  test("fails with fill_failed when name fill throws", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
      identityResolutionMode: "tin_resolved",
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1, fillThrows: true },
      },
    });
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("fill_failed");
    expect(r.failedFieldKey).toBe("nameAsPerInstrument");
    // Save button never clicked.
    expect(mock.clickCalls).not.toContain(PHASE_3_MODAL_SAVE_SELECTOR);
  });
});

describe("Phase 3 landlord · identity-resolution-first cascade (B10 final patch)", () => {
  test("happy path presses Tab on kpin AFTER fill and proceeds without clicking gender", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    // The press call carries selector=kpin and key=Tab.
    const tabPressOnKpin = mock.pressCalls.find(
      (c) =>
        c.selector === PHASE_3_MODAL_FIELD_SELECTORS.identityNumber &&
        c.key === "Tab"
    );
    expect(tabPressOnKpin).toBeDefined();
    // Resolved-IC path → gender NEVER clicked, DOB NEVER filled.
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-2");
    expect(
      mock.fillCalls.find(
        (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth
      )
    ).toBeUndefined();
  });

  test("resolved-IC path proceeds to address/contact fields and clicks modal Simpan once", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    // Address/contact fields all filled.
    const fillSelectors = mock.fillCalls.map((c) => c.selector);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.addressLine1);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.postcode);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.city);
    expect(fillSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.mobile);
    // State + country selected.
    const selectSelectors = mock.selectOptionCalls.map((c) => c.selector);
    expect(selectSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.state);
    expect(selectSelectors).toContain(PHASE_3_MODAL_FIELD_SELECTORS.country);
    // Modal Simpan clicked exactly once.
    const saveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_3_MODAL_SAVE_SELECTOR
    );
    expect(saveClicks).toHaveLength(1);
  });

  test("Tab is the ONLY key pressed during the cascade (no force-click on hidden fields)", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    for (const c of mock.pressCalls) {
      expect(c.key).toBe("Tab");
      expect(c.selector).toBe(PHASE_3_MODAL_FIELD_SELECTORS.identityNumber);
    }
    expect(mock.pressCalls).toHaveLength(1);
  });

  test("manual_fallback path (gender visible, TIN empty) → manual_identity_fallback_required, gender NOT auto-filled", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
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
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      identityResolutionWaitMs: 500,
    });
    expect(r.refusalReason).toBe("manual_identity_fallback_required");
    expect(r.failedFieldKey).toBe("identityNumber");
    expect(r.preRowCount).toBe(0);
    // Modal Simpan NEVER clicked.
    expect(mock.clickCalls).not.toContain(PHASE_3_MODAL_SAVE_SELECTOR);
    // Gender radio NEVER clicked even though it became visible.
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
    expect(mock.clickCalls).not.toContain("input#USER_SEX-2");
    // DOB never filled.
    expect(
      mock.fillCalls.find(
        (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.dateOfBirth
      )
    ).toBeUndefined();
    // Address fields never reached.
    const fillSelectors = mock.fillCalls.map((c) => c.selector);
    expect(fillSelectors).not.toContain(
      PHASE_3_MODAL_FIELD_SELECTORS.addressLine1
    );
  });

  test("neither path (TIN empty AND gender hidden) → identity_resolution_failed BEFORE Simpan", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
      identityResolutionMode: "neither",
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
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
      identityResolutionWaitMs: 500,
    });
    expect(r.refusalReason).toBe("identity_resolution_failed");
    expect(r.failedFieldKey).toBe("identityNumber");
    expect(mock.clickCalls).not.toContain(PHASE_3_MODAL_SAVE_SELECTOR);
    expect(mock.clickCalls).not.toContain("input#USER_SEX-1");
  });

  test("if Tab keypress itself throws → identity_resolution_failed (no force-click attempted)", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      landlordRowCount: 0,
      identityResolutionMode: "tin_resolved",
      selectors: {
        [PHASE_3_MODAL_SAVE_SELECTOR]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.name]: { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.warga]: { count: 1 },
        "input#IC_BARU": { count: 1 },
        [PHASE_3_MODAL_FIELD_SELECTORS.identityNumber]: {
          count: 1,
          pressThrows: true,
        },
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
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("identity_resolution_failed");
    expect(r.failedFieldKey).toBe("identityNumber");
    expect(mock.clickCalls).not.toContain(PHASE_3_MODAL_SAVE_SELECTOR);
  });

  test("PHASE_3_LANDLORD_REASON_LABELS includes the new resolution-first codes", () => {
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.identity_resolution_failed
    ).toBeDefined();
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.identity_resolution_failed.length
    ).toBeGreaterThan(0);
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.manual_identity_fallback_required
    ).toBeDefined();
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.manual_identity_fallback_required.length
    ).toBeGreaterThan(0);
    // Wording disclaims that no row was committed.
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.manual_identity_fallback_required
    ).toMatch(/no portal row was committed/i);
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.identity_resolution_failed
    ).toMatch(/no portal row was committed/i);
  });

  test("legacy identity_cascade_failed code is still present in the reason map", () => {
    // Compatibility — the type union still includes the legacy
    // code, so the label map must too.
    expect(
      PHASE_3_LANDLORD_REASON_LABELS.identity_cascade_failed
    ).toBeDefined();
  });
});

describe("Phase 3 landlord · telephone fallback (B10 patch)", () => {
  test("payload builder sets telephoneValue from party.mobile when present", () => {
    const ll = landlord();
    ll.mobile = "0198765432";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.telephoneValue).toBe("0198765432");
      expect(r.payload.telephoneFallbackUsed).toBe(false);
    }
  });

  test("payload builder falls back to '0' when party.mobile is empty", () => {
    const ll = landlord();
    ll.mobile = "";
    // The model-layer readiness gate would normally block this
    // earlier, but the executor's payload builder must still
    // handle empty mobile gracefully — the fallback is the
    // commercial-MVP rule.
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.telephoneValue).toBe("0");
      expect(r.payload.telephoneFallbackUsed).toBe(true);
    }
  });

  test("executor fills input#tb_telno with the payload's telephoneValue", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const telnoFill = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.mobile
    );
    expect(telnoFill).toBeDefined();
    expect(telnoFill!.value).toBe(HAPPY_PAYLOAD.telephoneValue);
  });

  test("executor uses the '0' fallback verbatim when payload.telephoneValue is '0'", async () => {
    const mock = happyMockPage();
    const fallbackPayload: Phase3LandlordPayload = {
      ...HAPPY_PAYLOAD,
      telephoneValue: "0",
      telephoneFallbackUsed: true,
    };
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: fallbackPayload,
    });
    expect(r.status).toBe("saved");
    expect(r.telephoneFallbackUsed).toBe(true);
    const telnoFill = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.mobile
    );
    expect(telnoFill!.value).toBe("0");
  });

  test("saved result echoes telephoneFallbackUsed flag", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.telephoneFallbackUsed).toBe(false);
  });

  test("telephone fallback does NOT block execution (saved status still reached)", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: { ...HAPPY_PAYLOAD, telephoneValue: "0", telephoneFallbackUsed: true },
    });
    expect(r.status).toBe("saved");
    expect(r.refusalReason).toBeUndefined();
  });

  test("PHASE_3_TELEPHONE_FALLBACK_VALUE constant is the literal '0'", async () => {
    const mod = await import("./tenancy-phase-3-landlord-executor");
    expect(mod.PHASE_3_TELEPHONE_FALLBACK_VALUE).toBe("0");
  });
});

describe("Phase 3 landlord · address + postcode + state mapping (B10 patch)", () => {
  test("payload uses party.addressLine1 when non-empty (no fallback)", () => {
    const ll = landlord();
    ll.addressLine1 = "1 Captured Lane";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.addressLine1Value).toBe("1 Captured Lane");
      expect(r.payload.addressLine1FallbackUsed).toBe(false);
    }
  });

  test("payload falls back to 'no. 22' for addressLine1 when missing", () => {
    const ll = landlord();
    ll.addressLine1 = "";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.addressLine1Value).toBe("no. 22");
      expect(r.payload.addressLine1FallbackUsed).toBe(true);
    }
  });

  test("payload uses party.addressLine2 when non-empty", () => {
    const ll = landlord();
    ll.addressLine2 = "Block A";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.addressLine2Value).toBe("Block A");
      expect(r.payload.addressLine2FallbackUsed).toBe(false);
    }
  });

  test("payload falls back to 'jalan' for addressLine2 when missing", () => {
    const ll = landlord();
    delete ll.addressLine2;
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.addressLine2Value).toBe("jalan");
      expect(r.payload.addressLine2FallbackUsed).toBe(true);
    }
  });

  test("addressLine2 is ALWAYS filled (executor never skips, even on fallback)", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: { ...HAPPY_PAYLOAD, addressLine2Value: "jalan", addressLine2FallbackUsed: true },
    });
    const a2Fill = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.addressLine2
    );
    expect(a2Fill).toBeDefined();
    expect(a2Fill!.value).toBe("jalan");
  });

  test("addressLine2 fill takes the payload's value verbatim", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const a2Fill = mock.fillCalls.find(
      (c) => c.selector === PHASE_3_MODAL_FIELD_SELECTORS.addressLine2
    );
    expect(a2Fill).toBeDefined();
    expect(a2Fill!.value).toBe("Block A");
  });

  test("postcode must be exactly 5 numeric digits — payload builder refuses on 4 digits", () => {
    const ll = landlord();
    ll.postcode = "5000";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusalReason).toBe("required_field_missing");
      expect(r.failedFieldKey).toBe("postcode");
    }
  });

  test("postcode must be exactly 5 numeric digits — payload builder refuses on alphanumeric", () => {
    const ll = landlord();
    ll.postcode = "5000A";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failedFieldKey).toBe("postcode");
  });

  test("postcode 5-digit values are accepted", () => {
    const ll = landlord();
    ll.postcode = "98000";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.postcodeValue).toBe("98000");
  });

  test("Miri/Sarawak path maps to portal code '11' (Sarawak), NOT '2' (Kedah)", () => {
    const ll = landlord();
    ll.city = "Miri";
    ll.state = "Sarawak";
    ll.postcode = "98000";
    const r = buildPhase3LandlordPayload(ll);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.statePortalCode).toBe("11");
  });

  test("Selangor / KL / Putrajaya all map to their distinct portal codes (regression)", () => {
    const cases: Array<[string, string]> = [
      ["Selangor", "12"],
      ["Kuala Lumpur", "14"],
      ["Putrajaya", "16"],
      ["Kedah", "2"],
      ["Johor", "1"],
    ];
    for (const [stateName, expectedCode] of cases) {
      const ll = landlord();
      ll.state = stateName;
      const r = buildPhase3LandlordPayload(ll);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect({ state: stateName, code: r.payload.statePortalCode }).toEqual({
          state: stateName,
          code: expectedCode,
        });
      }
    }
  });

  test("normal modal click remains the submit method (B10 patch does NOT introduce requestSubmit)", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    // The Simpan click on the modal save selector still appears
    // exactly once.
    const saveClicks = mock.clickCalls.filter(
      (s) => s === PHASE_3_MODAL_SAVE_SELECTOR
    );
    expect(saveClicks).toHaveLength(1);
  });

  test("source code does not introduce requestSubmit() on form#penjual", async () => {
    // Anti-regression: B10 brief explicitly forbids requestSubmit
    // in this patch. Read the executor source and ensure the
    // string is absent.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "tenancy-phase-3-landlord-executor.ts"),
      "utf8"
    );
    expect(src.includes("requestSubmit")).toBe(false);
    expect(src.includes("form#penjual")).toBe(false);
  });

  test("no tenant/company/Bahagian B/C/Lampiran/Perakuan/Hantar selectors (regression)", async () => {
    const mock = happyMockPage();
    await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const FORBIDDEN = [
      "tambah_syarikat",
      "PENYEWA",
      "TENANT",
      "pds_balasan",
      "pds_harta",
      "pds_lot",
      "pds_mukim",
      "pds_daerah",
      "lampiran",
      "pds_akuan",
      "pre_hantar",
      "pdsL01_button_hantar",
    ];
    const flat = [
      ...mock.locatorCalls,
      ...mock.fillCalls.map((c) => c.selector),
      ...mock.selectOptionCalls.map((c) => c.selector),
      ...mock.clickCalls,
    ].join(" | ");
    for (const needle of FORBIDDEN) {
      expect({ needle, found: flat.includes(needle) }).toEqual({
        needle,
        found: false,
      });
    }
  });
});

describe("Phase 3 landlord · sensitive-data invariant", () => {
  test("result serialization on success is sensitive-data-free", async () => {
    const mock = happyMockPage();
    const r = await executePhase3LandlordIndividualSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    const ser = JSON.stringify(r);
    expect(ser).not.toMatch(/https?:\/\//i);
    expect(ser).not.toMatch(/\/stamps\//);
    expect(ser).not.toMatch(/href=/i);
    expect(ser).not.toMatch(/lhdnmsstoken/i);
    // Real party PII must not be echoed to the result.
    expect(ser).not.toContain("Test Landlord");
    expect(ser).not.toContain("900101015555");
    expect(ser).not.toContain("0123456789");
  });

  test("forbidden wording does not appear in any reason label", () => {
    const all = Object.values(PHASE_3_LANDLORD_REASON_LABELS).join(" ");
    expect(all).not.toMatch(/\bsubmitted\b/i);
    expect(all).not.toMatch(/\bsent to LHDN\b/i);
    expect(all).not.toMatch(/\bHantar\b/i);
    expect(all).not.toMatch(/\bpaid\b/i);
    expect(all).not.toMatch(/certificate retrieved/i);
  });
});

describe("Phase 3 landlord · result type sanity", () => {
  test("Phase3LandlordExecutionResult shape is what the route persists", () => {
    const r: Phase3LandlordExecutionResult = {
      status: "saved",
      reason: "Landlord-individual row saved.",
      attemptedAt: "2026-04-30T00:00:00Z",
      savedAt: "2026-04-30T00:00:01Z",
      postSavePathKind: "sewa_pajakan_p5_form",
      preRowCount: 0,
      postRowCount: 1,
    };
    expect(r.status).toBe("saved");
    expect(r.preRowCount).toBe(0);
    expect(r.postRowCount).toBe(1);
  });
});

describe("Phase 3 landlord · field mapping invariants", () => {
  test("collectMissingLandlordFields lists all required keys for an empty party", () => {
    const empty: TenancyPortalParty = {
      role: "landlord",
      type: "individual",
      nameAsPerInstrument: "",
      addressLine1: "",
      postcode: "",
      city: "",
      state: "",
      country: "",
      mobile: "",
    };
    const missing = collectMissingLandlordFields(empty);
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
