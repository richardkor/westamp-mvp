/**
 * WeStamp — Tenancy Phase 2 Maklumat Am Executor · tests
 *
 * Covers Milestone B7 — the FIRST mutation milestone. After the
 * sixth-attempt evidence diagnosis (2026-04-30), only `pds_suratcara`
 * is operator-facing on the live Sewa/Pajakan p5 surface. All other
 * Maklumat Am fields (`pds_jenis`, `pds_salinan`, `pds_date_suratcara`,
 * `pds_dutisetem`, `pds_ps`) are hidden / portal-managed and the
 * executor never writes them. Tests are structured around three
 * layers:
 *
 *   1. Pure preflight (`evaluatePhase2Preflight`) — refuses every
 *      precondition individually with the correct stable code.
 *   2. Pure payload builder (`buildPhase2MaklumatAmPayload`) —
 *      builds the payload from a job, refuses on missing field.
 *   3. Executor (`executePhase2MaklumatAmSave`) — runs a
 *      controlled save flow against a mocked Page surface. The
 *      mock records every interaction so we can assert exactly
 *      which selectors were touched (Phase 2 only) and exactly
 *      which values were written.
 *
 * No real Playwright / Chrome is touched. The Phase 2 executor's
 * structural `Phase2PageLike` / `Phase2LocatorLike` interfaces let
 * tests inject the mock without booting a browser.
 *
 * Test coverage maps to the brief's TEST REQUIREMENTS:
 *  - executor no longer requires pds_jenis/pds_salinan/pds_date_suratcara
 *    as writable selectors (count!==1 on those fields does NOT trigger
 *    selector_missing — they're snapshot-only).
 *  - executor no longer selectOption / fills any of those fields.
 *  - executor still requires pds_suratcara (selector + option).
 *  - required_option_missing fires for missing pds_suratcara option
 *    BEFORE any selectOption / click.
 *  - save selector remains `input#pdsL01_button_simpan`.
 *  - executor never uses `force: true` (the locator interface does
 *    not even expose a `force` parameter).
 *  - forbidden later-phase selectors remain absent.
 *  - hidden-field snapshot result serialization is sanitized.
 */

import {
  buildPhase2MaklumatAmPayload,
  evaluatePhase2Preflight,
  executePhase2MaklumatAmSave,
  PHASE_2_FIELD_SELECTORS,
  PHASE_2_HIDDEN_FIELD_SELECTORS,
  PHASE_2_REASON_LABELS,
  PHASE_2_SAVE_BUTTON_SELECTOR,
  type Phase2ExecutionResult,
  type Phase2HiddenFieldSnapshot,
  type Phase2LocatorLike,
  type Phase2MaklumatAmPayload,
  type Phase2PageLike,
  type Phase2RefusalReason,
} from "./tenancy-phase-2-executor";
import {
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
  type TenancyRunSessionState,
} from "./tenancy-supervised-run-session";
import {
  evaluateTenancyPortalRunReadiness,
} from "./tenancy-portal-run-readiness";
import {
  buildTenancyInstructionGraphFromJob,
} from "./tenancy-instruction-graph";
import {
  ABSENT_MARKERS,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import type {
  StampingJob,
  TenancyPortalParty,
} from "./stamping-types";

// ─── Fixture builders ──────────────────────────────────────────────

function landlord(): TenancyPortalParty {
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

function readyJob(overrides: Partial<StampingJob> = {}): StampingJob {
  const ll = landlord();
  const tenant: TenancyPortalParty = {
    ...ll,
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    mobile: "0129876543",
    gender: "female",
  };
  return {
    id: "job-b7-test",
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
      parties: [ll, tenant],
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
    recommendedOperatorAction: "Ready for read-only phase-position verification.",
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

// ─── Mock Page surface ────────────────────────────────────────────

/**
 * Per-selector configuration. `count` controls how many times the
 * locator resolves; the boolean knobs control whether interactions
 * succeed or throw. `visible` and `inputValue` configure the
 * read-only snapshot probes.
 */
interface MockSelectorConfig {
  count: number;
  selectOptionThrows?: boolean;
  clickThrows?: boolean;
  /** Read-only: `isVisible()` return value. Defaults to `true`. */
  visible?: boolean;
  /**
   * Read-only: value returned by `inputValue()`. Defaults to "".
   * Tests asserting sensitive-data invariants pass realistic
   * canonical / non-canonical values to confirm sanitization.
   */
  inputValue?: string;
  /** If true, `inputValue()` rejects. */
  inputValueThrows?: boolean;
  /** If true, `isVisible()` rejects. */
  isVisibleThrows?: boolean;
}

interface MockPageOptions {
  /** URL returned by `url()` before any interaction. */
  preUrl: string;
  /** URL returned by `url()` after the save click. */
  postUrl?: string;
  /** Per-selector counts and behavior. */
  selectors: Record<string, MockSelectorConfig>;
  /** Whether `waitForLoadState("networkidle", ...)` throws. */
  waitForLoadStateThrows?: boolean;
}

interface MockPage extends Phase2PageLike {
  /** Records every locator() call's selector, in order. */
  locatorCalls: string[];
  /** Records every selectOption() call. */
  selectOptionCalls: { selector: string; value: string }[];
  /** Records every click() call's selector. */
  clickCalls: string[];
  /** Records every waitForLoadState call. */
  waitForLoadStateCalls: string[];
  /** Records every isVisible() call's selector. */
  isVisibleCalls: string[];
  /** Records every inputValue() call's selector. */
  inputValueCalls: string[];
}

function makeMockPage(options: MockPageOptions): MockPage {
  let urlCallCount = 0;
  const locatorCalls: string[] = [];
  const selectOptionCalls: { selector: string; value: string }[] = [];
  const clickCalls: string[] = [];
  const waitForLoadStateCalls: string[] = [];
  const isVisibleCalls: string[] = [];
  const inputValueCalls: string[] = [];

  /**
   * Default config map applied as a baseline so existing tests
   * don't need to enumerate every option-existence selector or
   * every snapshot probe. Tests override the specific keys they
   * care about.
   *
   * The keys follow the exact compound selectors the executor
   * queries: `<select-selector> option[value="<expected>"]`.
   */
  const optionExistenceDefaults: Record<string, MockSelectorConfig> = {
    [`${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`]: {
      count: 1,
    },
    // Hidden-field snapshot option-existence checks. The executor
    // probes the hidden selects' options to confirm WeStamp's
    // expected portal codes exist; missing options do NOT block
    // the save attempt.
    [`${PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis} option[value="1103"]`]: {
      count: 1,
    },
    [`${PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan} option[value="1"]`]: {
      count: 1,
    },
  };

  function getCfg(selector: string): MockSelectorConfig {
    const cfg =
      options.selectors[selector] ?? optionExistenceDefaults[selector];
    if (!cfg) {
      throw new Error(`MockPage: no config for selector "${selector}"`);
    }
    return cfg;
  }

  const page: MockPage = {
    locatorCalls,
    selectOptionCalls,
    clickCalls,
    waitForLoadStateCalls,
    isVisibleCalls,
    inputValueCalls,
    url(): string {
      urlCallCount++;
      if (clickCalls.length === 0) return options.preUrl;
      return options.postUrl ?? options.preUrl;
    },
    locator(selector: string): Phase2LocatorLike {
      locatorCalls.push(selector);
      const cfg = getCfg(selector);
      const locator: Phase2LocatorLike = {
        async count() {
          return cfg.count;
        },
        async selectOption(value: string) {
          if (cfg.selectOptionThrows) throw new Error("selectOption failed");
          selectOptionCalls.push({ selector, value });
        },
        async click() {
          if (cfg.clickThrows) throw new Error("click failed");
          clickCalls.push(selector);
        },
        async isVisible() {
          isVisibleCalls.push(selector);
          if (cfg.isVisibleThrows) throw new Error("isVisible failed");
          return cfg.visible !== undefined ? cfg.visible : true;
        },
        async inputValue() {
          inputValueCalls.push(selector);
          if (cfg.inputValueThrows) throw new Error("inputValue failed");
          return cfg.inputValue !== undefined ? cfg.inputValue : "";
        },
      };
      return locator;
    },
    async waitForLoadState(state: string) {
      waitForLoadStateCalls.push(state);
      if (options.waitForLoadStateThrows) {
        throw new Error("waitForLoadState timed out");
      }
    },
  };
  void urlCallCount;
  return page;
}

/**
 * Compound option-existence selector format used by the executor's
 * Step 3 + Step 4 probes.
 */
function optSelector(fieldSelector: string, value: string): string {
  return `${fieldSelector} option[value="${value}"]`;
}

/** Build the standard "everything works" mock for the success path. */
function happyMockPage(): MockPage {
  return makeMockPage({
    preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/create",
    postUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
    selectors: {
      // Writable surface.
      [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1, visible: true },
      [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, visible: true },
      // Hidden snapshot surface — present, hidden, with portal-
      // populated values that match the canonical-token shape.
      [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: {
        count: 1,
        visible: false,
        inputValue: "",
      },
      [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: {
        count: 1,
        visible: false,
        inputValue: "1",
      },
      [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
        count: 1,
        visible: false,
        inputValue: "2026-01-01",
      },
      // Option-existence probes for both writable and snapshot
      // surfaces.
      [optSelector(PHASE_2_FIELD_SELECTORS.pds_suratcara, "1101")]: {
        count: 1,
      },
      [optSelector(PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis, "1103")]: {
        count: 1,
      },
      [optSelector(PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan, "1")]: {
        count: 1,
      },
    },
  });
}

const HAPPY_PAYLOAD: Phase2MaklumatAmPayload = {
  pdsSuratcaraCode: "1101",
  pdsJenisCode: "1103",
  pdsSalinanCode: "1",
};

// ─── Test 1 · Preflight refuses on each precondition ───────────────

describe("Phase 2 · preflight", () => {
  test("refuses non-tenancy job → unsupported_lane", () => {
    const job = readyJob({
      documentCategory: "employment_contract",
      tenancyPortalDetails: undefined,
    });
    expect(evaluatePhase2Preflight(job)).toEqual({
      ok: false,
      refusalReason: "unsupported_lane",
    });
  });

  test("refuses readiness-not-ready → readiness_not_ready", () => {
    const job = readyJob({ storagePath: "" });
    expect(evaluatePhase2Preflight(job)).toEqual({
      ok: false,
      refusalReason: "readiness_not_ready",
    });
  });

  test("refuses missing supervisedRunSession → supervised_session_missing", () => {
    const job = readyJob();
    expect(evaluatePhase2Preflight(job)).toEqual({
      ok: false,
      refusalReason: "supervised_session_missing",
    });
  });

  test("refuses run-session not approved → first_mutation_not_approved", () => {
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
    expect(evaluatePhase2Preflight(job)).toEqual({
      ok: false,
      refusalReason: "first_mutation_not_approved",
    });
  });

  test("preflight passes for an approved job", () => {
    expect(evaluatePhase2Preflight(approvedJob())).toEqual({ ok: true });
  });

  test("refuses if approval is set on a state with mismatched stage (defence in depth)", () => {
    const approved = approvedJob();
    const tampered: TenancyRunSessionState = {
      ...(approved.supervisedRunSession as TenancyRunSessionState),
      currentRunStage: "blocked",
    };
    expect(
      evaluatePhase2Preflight({ ...approved, supervisedRunSession: tampered })
    ).toEqual({ ok: false, refusalReason: "first_mutation_not_approved" });
  });
});

// ─── Test 2 · Payload builder ─────────────────────────────────────

describe("Phase 2 · payload builder", () => {
  test("builds the payload from a fully-captured job", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.pdsSuratcaraCode).toBe("1101");
      expect(r.payload.pdsJenisCode).toBe("1103");
      expect(r.payload.pdsSalinanCode).toBe("1");
    }
  });

  test("payload does NOT carry pdsDateSuratcaraValue (B7 sixth-attempt patch — pds_date_suratcara is hidden, portal-managed)", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("pdsDateSuratcaraValue" in r.payload).toBe(false);
    }
  });

  test("payload does NOT carry pdsDutisetemCode (B7 fifth-attempt patch — pds_dutisetem is portal-managed state-of-stamping-office)", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("pdsDutisetemCode" in r.payload).toBe(false);
    }
  });

  test("payload does NOT carry pdsPsCode (B7 live-evidence patch — pds_ps is portal-managed)", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("pdsPsCode" in r.payload).toBe(false);
    }
  });

  test("payload keys are exactly the three values the executor consumes", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.payload).sort()).toEqual([
        "pdsJenisCode",
        "pdsSalinanCode",
        "pdsSuratcaraCode",
      ]);
    }
  });

  test("readiness gate (preflight) still requires instrumentRelationship to be captured at the model layer", () => {
    const job = readyJob();
    delete job.tenancyPortalDetails!.maklumatAm!.instrumentRelationship;
    const r = evaluatePhase2Preflight(job);
    expect(r).toEqual({
      ok: false,
      refusalReason: "readiness_not_ready",
    });
  });

  test("refuses when description type is not fixed_rent_during_tenancy", () => {
    const job = readyJob();
    job.tenancyPortalDetails!.instrument!.portalDescriptionType =
      "amendment_to_original_tenancy";
    const r = buildPhase2MaklumatAmPayload(job);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusalReason).toBe("required_field_missing");
  });
});

// ─── Test 3 · Executor refuses if not on p5 form ──────────────────

describe("Phase 2 · executor · pre-mutation guards", () => {
  test("refuses when current page is not the p5 form", async () => {
    const mock = makeMockPage({
      preUrl: "https://mytax.hasil.gov.my/dashboard",
      selectors: {},
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("p5_form_not_detected");
    expect(mock.selectOptionCalls).toHaveLength(0);
    expect(mock.clickCalls).toHaveLength(0);
  });

  test("refuses on selector_missing for pds_suratcara without touching any field", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 0 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("selector_missing");
    expect(mock.selectOptionCalls).toHaveLength(0);
    expect(mock.clickCalls).toHaveLength(0);
  });

  test("refuses on ambiguous_selector for pds_suratcara without touching any field", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 2 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("ambiguous_selector");
    expect(mock.selectOptionCalls).toHaveLength(0);
  });

  test("refuses with save_button_missing when the save button does not resolve", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 0 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("save_button_missing");
    expect(mock.selectOptionCalls).toHaveLength(0);
  });

  test("refuses with ambiguous_selector when save button matches more than one element", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 2 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("ambiguous_selector");
    expect(mock.selectOptionCalls).toHaveLength(0);
  });

  test("does NOT trigger selector_missing when a HIDDEN Maklumat Am field is absent (snapshot-only)", async () => {
    // pds_jenis, pds_salinan, pds_date_suratcara are read-only
    // snapshot probes; absence shows up as `present: false` in
    // the snapshot but does NOT block the save attempt.
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      postUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1, visible: true },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, visible: true },
        // Hidden fields all absent — snapshot will mark each
        // `present: false`, but the save still proceeds.
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 0 },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 0 },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: { count: 0 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.hiddenFieldSnapshot?.pdsJenis.present).toBe(false);
    expect(r.hiddenFieldSnapshot?.pdsSalinan.present).toBe(false);
    expect(r.hiddenFieldSnapshot?.pdsDateSuratcara.present).toBe(false);
  });
});

// ─── Test 4 · Success path performs only Phase 2 actions ──────────

describe("Phase 2 · executor · success path (B7 sixth-attempt evidence patch)", () => {
  test("selects exactly pds_suratcara and clicks the single save button — no other writes", async () => {
    const mock = happyMockPage();
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.refusalReason).toBeUndefined();
    expect(r.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.postSavePathKind).toBe("sewa_pajakan_p5_form");

    // Exactly 1 selectOption call (pds_suratcara).
    expect(mock.selectOptionCalls).toHaveLength(1);
    expect(mock.selectOptionCalls[0]).toEqual({
      selector: PHASE_2_FIELD_SELECTORS.pds_suratcara,
      value: "1101",
    });
    // Exactly 1 click call (the Simpan Maklumat Am button).
    expect(mock.clickCalls).toHaveLength(1);
    expect(mock.clickCalls[0]).toBe(PHASE_2_SAVE_BUTTON_SELECTOR);
  });

  test("does NOT selectOption on any hidden Maklumat Am field", async () => {
    const mock = happyMockPage();
    await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    for (const call of mock.selectOptionCalls) {
      expect(call.selector).not.toMatch(/pds_jenis/);
      expect(call.selector).not.toMatch(/pds_salinan/);
      expect(call.selector).not.toMatch(/pds_date_suratcara/);
      expect(call.selector).not.toMatch(/pds_dutisetem/);
      expect(call.selector).not.toMatch(/pds_ps/);
    }
  });

  test("waits for networkidle exactly once after the save click", async () => {
    const mock = happyMockPage();
    await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(mock.waitForLoadStateCalls).toEqual(["networkidle"]);
  });

  test("captures the hidden-field snapshot BEFORE clicking save (read-only)", async () => {
    const mock = happyMockPage();
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    expect(r.hiddenFieldSnapshot).toBeDefined();
    // pds_jenis (hidden, empty)
    expect(r.hiddenFieldSnapshot!.pdsJenis.present).toBe(true);
    expect(r.hiddenFieldSnapshot!.pdsJenis.visible).toBe(false);
    expect(r.hiddenFieldSnapshot!.pdsJenis.selectedValueCategory).toBe("empty");
    expect(r.hiddenFieldSnapshot!.pdsJenis.expectedOptionExists).toBe(true);
    // pds_salinan (hidden, canonical token "1")
    expect(r.hiddenFieldSnapshot!.pdsSalinan.present).toBe(true);
    expect(r.hiddenFieldSnapshot!.pdsSalinan.visible).toBe(false);
    expect(r.hiddenFieldSnapshot!.pdsSalinan.selectedValueCategory).toBe(
      "code_like"
    );
    expect(r.hiddenFieldSnapshot!.pdsSalinan.expectedOptionExists).toBe(true);
    // pds_date_suratcara (hidden, length 10)
    expect(r.hiddenFieldSnapshot!.pdsDateSuratcara.present).toBe(true);
    expect(r.hiddenFieldSnapshot!.pdsDateSuratcara.visible).toBe(false);
    expect(r.hiddenFieldSnapshot!.pdsDateSuratcara.hasValue).toBe(true);
    expect(r.hiddenFieldSnapshot!.pdsDateSuratcara.valueLength).toBe(10);
  });

  test("does NOT touch any Bahagian A / B / C / Lampiran / Perakuan / Hantar selector", async () => {
    const mock = happyMockPage();
    await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    // The set of selectors the executor was permitted to query
    // is the closed set of writable + hidden-snapshot selectors +
    // option-existence compound selectors + save button. Anything
    // OUTSIDE this set must never appear in `locatorCalls`.
    const allowed = new Set<string>([
      PHASE_2_FIELD_SELECTORS.pds_suratcara,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan,
      PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara,
      PHASE_2_SAVE_BUTTON_SELECTOR,
      // Option-existence preflight selectors.
      `${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`,
      `${PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis} option[value="1103"]`,
      `${PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan} option[value="1"]`,
    ]);
    for (const sel of mock.locatorCalls) {
      expect({ selector: sel, allowed: allowed.has(sel) }).toEqual({
        selector: sel,
        allowed: true,
      });
    }
    const FORBIDDEN_SELECTOR_SUBSTRINGS = [
      "tambah_individu",
      "tambah_syarikat",
      "pds_alamat",
      "pds_balasan",
      "pds_harta",
      "pds_lot",
      "pds_mukim",
      "pds_daerah",
      "pds_luas",
      "lampiran",
      "pds_akuan",
      "pre_hantar",
      "pdsL01_button_hantar",
      "simpan_bahagian",
      // B7 live-evidence patches: pds_ps and pds_dutisetem are
      // NEVER touched. The executor doesn't write or even probe
      // them. pds_jenis/pds_salinan/pds_date_suratcara ARE
      // probed read-only — they live in PHASE_2_HIDDEN_FIELD_SELECTORS.
      "pds_ps",
      "pds_dutisetem",
    ];
    const flat = mock.locatorCalls.join(" ");
    for (const needle of FORBIDDEN_SELECTOR_SUBSTRINGS) {
      expect({ needle, found: flat.includes(needle) }).toEqual({
        needle,
        found: false,
      });
    }
  });
});

// ─── Test 5 · Option-value preflight ──────────────────────────────

describe("Phase 2 · executor · pds_suratcara option-value preflight", () => {
  test("missing option for pds_suratcara → required_option_missing, no selectOption / click", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
        [`${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`]: {
          count: 0,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("required_option_missing");
    expect(r.failedFieldKey).toBe("pds_suratcara");
    expect(r.expectedOptionValue).toBe("1101");
    // CRITICAL: NO portal interaction at all.
    expect(mock.selectOptionCalls).toHaveLength(0);
    expect(mock.clickCalls).toHaveLength(0);
    expect(mock.waitForLoadStateCalls).toHaveLength(0);
  });

  test("non-canonical pdsSuratcaraCode → required_option_missing without compound-selector lookup", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: { ...HAPPY_PAYLOAD, pdsSuratcaraCode: 'evil"; alert(1)//' },
    });
    expect(r.status).toBe("refused");
    expect(r.refusalReason).toBe("required_option_missing");
    expect(r.failedFieldKey).toBe("pds_suratcara");
    // The CSS-attribute injection-shaped string was never emitted
    // as a selector lookup.
    for (const sel of mock.locatorCalls) {
      expect(sel.includes("evil")).toBe(false);
    }
  });

  test("missing option preflight refuses BEFORE any selectOption ever fires", async () => {
    // Direct, behaviour-level proof of the ordering invariant: when
    // the option preflight rejects, no `selectOption` call could
    // have been emitted. Compose the minimal mock that fails the
    // option lookup and assert nothing was selectOption'd.
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
        [`${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`]: {
          count: 0,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("required_option_missing");
    expect(mock.selectOptionCalls).toHaveLength(0);
    expect(mock.clickCalls).toHaveLength(0);
    // The compound option-existence selector WAS queried (proving
    // the preflight ran), and it appears in the call list before
    // the executor returned.
    const optionLookups = mock.locatorCalls.filter((s) =>
      s.includes("option[value=")
    );
    expect(optionLookups).toContain(
      `${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`
    );
  });

  test("happy path runs the pds_suratcara option lookup AND fires selectOption exactly once", async () => {
    const mock = happyMockPage();
    await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    // The compound option-existence selector was queried.
    const optionLookups = mock.locatorCalls.filter((s) =>
      s.includes("option[value=")
    );
    expect(optionLookups).toContain(
      `${PHASE_2_FIELD_SELECTORS.pds_suratcara} option[value="1101"]`
    );
    // selectOption fired exactly once, and only on pds_suratcara.
    expect(mock.selectOptionCalls).toHaveLength(1);
    expect(mock.selectOptionCalls[0]).toEqual({
      selector: PHASE_2_FIELD_SELECTORS.pds_suratcara,
      value: "1101",
    });
  });
});

// ─── Test 6 · Failure paths ───────────────────────────────────────

describe("Phase 2 · executor · failure paths", () => {
  test("save_fill_failed when pds_suratcara selectOption throws", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: {
          count: 1,
          selectOptionThrows: true,
        },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
        // Hidden fields configured so snapshot capture works.
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("failed");
    expect(r.refusalReason).toBe("save_fill_failed");
    expect(r.failedFieldKey).toBe("pds_suratcara");
    // Save button must NOT have been clicked.
    expect(mock.clickCalls).toHaveLength(0);
    // Snapshot was captured before the failed selectOption.
    expect(r.hiddenFieldSnapshot).toBeDefined();
  });

  test("save_click_failed when click throws — selectOption count proves only one write happened", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, clickThrows: true },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("save_click_failed");
    expect(r.failedFieldKey).toBe("save_button");
    // Exactly 1 selectOption call (pds_suratcara) before the click.
    // No other selectOption / fill happened — proving the executor
    // never wrote any hidden Maklumat Am field.
    expect(mock.selectOptionCalls).toHaveLength(1);
  });

  test("save_wait_failed when networkidle wait times out", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
        },
      },
      waitForLoadStateThrows: true,
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.refusalReason).toBe("save_wait_failed");
    expect(r.failedFieldKey).toBe("post_save_verification");
    expect(mock.clickCalls).toHaveLength(1);
  });

  test("post_save_verification_failed when post-save URL is not p5", async () => {
    const mock = makeMockPage({
      preUrl: "https://stamps.hasil.gov.my/stamps/formv2/p5/create",
      postUrl: "https://stamps.hasil.gov.my/stamps/utama/dashboard",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("failed");
    expect(r.refusalReason).toBe("post_save_verification_failed");
    expect(r.postSavePathKind).toBe("stamps_dashboard");
    expect(r.failedFieldKey).toBe("post_save_verification");
  });
});

// ─── Test 7 · Hidden-field snapshot sanitization ──────────────────

describe("Phase 2 · hidden-field snapshot · sanitization", () => {
  test("snapshot fields contain no raw values, no raw labels, no URLs, no PII", async () => {
    // Configure the mock with realistic-looking values that include
    // every PII pattern the brief enumerates. The result, when
    // serialized, must still match none of those patterns.
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      postUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1, visible: true },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, visible: true },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: {
          count: 1,
          visible: false,
          // Realistic but PII-shaped value to confirm the executor
          // never echoes it into the result.
          inputValue: "https://leak.example/path?token=abc123",
        },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: {
          count: 1,
          visible: false,
          inputValue: "Test Landlord 900101015555",
        },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
          inputValue: "2026-01-01",
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.status).toBe("saved");
    const serialized = JSON.stringify(r);
    const FORBIDDEN: { name: string; pattern: RegExp }[] = [
      { name: "12-digit IC", pattern: /\b\d{12}\b/ },
      { name: "13-digit-or-longer ID", pattern: /\b\d{13,}\b/ },
      { name: "literal landlord IC", pattern: /900101015555/ },
      { name: "literal tenant IC", pattern: /950505055555/ },
      { name: "literal landlord name", pattern: /Test Landlord/i },
      { name: "literal tenant name", pattern: /Test Tenant/i },
      { name: "literal mobile", pattern: /0123456789/ },
      { name: "literal address", pattern: /Test Lane/i },
      { name: "literal mukim", pattern: /\bPetaling\b/ },
      { name: "literal lot", pattern: /\b12345\b/ },
      { name: "http URL", pattern: /https?:\/\//i },
      { name: "leading-slash portal path", pattern: /\/stamps\// },
      { name: "raw href attribute", pattern: /href=/i },
      { name: "cookie keyword", pattern: /cookie/i },
      { name: "token keyword", pattern: /token/i },
      { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
      { name: "TIN keyword", pattern: /\bTIN[: ]/ },
      { name: "uploaded path", pattern: /uploads\/test\/sample\.pdf/ },
      { name: "leak.example", pattern: /leak\.example/i },
      { name: "abc123 token", pattern: /abc123/ },
      { name: "raw 2026-01-01 date string", pattern: /2026-01-01/ },
    ];
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched: ${m?.[0]}`
        );
      }
    }
  });

  test("snapshot for hidden-but-PII-bearing select reports CATEGORY only — never the raw value", async () => {
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      postUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1, visible: true },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, visible: true },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: {
          count: 1,
          visible: false,
          inputValue: "non canonical with spaces",
        },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: {
          count: 1,
          visible: false,
          inputValue: "1",
        },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
          inputValue: "2026-01-01",
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.hiddenFieldSnapshot!.pdsJenis.selectedValueCategory).toBe(
      "non_canonical"
    );
    expect(r.hiddenFieldSnapshot!.pdsSalinan.selectedValueCategory).toBe(
      "code_like"
    );
  });

  test("snapshot caps date-input value length at 64", async () => {
    const longString = "x".repeat(200);
    const mock = makeMockPage({
      preUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      postUrl:
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      selectors: {
        [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1, visible: true },
        [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1, visible: true },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: { count: 1, visible: false },
        [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
          count: 1,
          visible: false,
          inputValue: longString,
        },
      },
    });
    const r = await executePhase2MaklumatAmSave({
      page: mock,
      payload: HAPPY_PAYLOAD,
    });
    expect(r.hiddenFieldSnapshot!.pdsDateSuratcara.valueLength).toBe(64);
    // The cap is the only number reported — never the raw string.
    expect(JSON.stringify(r)).not.toContain(longString);
  });
});

// ─── Test 8 · Sensitive-data invariant on result ──────────────────

describe("Phase 2 · result · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "13-digit-or-longer ID", pattern: /\b\d{13,}\b/ },
    { name: "literal landlord IC", pattern: /900101015555/ },
    { name: "literal tenant IC", pattern: /950505055555/ },
    { name: "literal landlord name", pattern: /Test Landlord/i },
    { name: "literal tenant name", pattern: /Test Tenant/i },
    { name: "literal mobile", pattern: /0123456789/ },
    { name: "literal address", pattern: /Test Lane/i },
    { name: "literal mukim", pattern: /\bPetaling\b/ },
    { name: "literal lot", pattern: /\b12345\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
    { name: "uploaded path", pattern: /uploads\/test\/sample\.pdf/ },
  ];

  const SCENARIOS: {
    label: string;
    build: () => Promise<Phase2ExecutionResult>;
  }[] = [
    {
      label: "saved",
      build: async () =>
        executePhase2MaklumatAmSave({
          page: happyMockPage(),
          payload: HAPPY_PAYLOAD,
        }),
    },
    {
      label: "p5 not detected",
      build: async () =>
        executePhase2MaklumatAmSave({
          page: makeMockPage({
            preUrl: "https://mytax.hasil.gov.my/dashboard",
            selectors: {},
          }),
          payload: HAPPY_PAYLOAD,
        }),
    },
    {
      label: "selector missing",
      build: async () =>
        executePhase2MaklumatAmSave({
          page: makeMockPage({
            preUrl:
              "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
            selectors: {
              [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 0 },
              [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
            },
          }),
          payload: HAPPY_PAYLOAD,
        }),
    },
    {
      label: "post-save verification failed",
      build: async () =>
        executePhase2MaklumatAmSave({
          page: makeMockPage({
            preUrl:
              "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
            postUrl: "https://stamps.hasil.gov.my/stamps/utama/dashboard",
            selectors: {
              [PHASE_2_FIELD_SELECTORS.pds_suratcara]: { count: 1 },
              [PHASE_2_SAVE_BUTTON_SELECTOR]: { count: 1 },
              [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_jenis]: {
                count: 1,
                visible: false,
              },
              [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_salinan]: {
                count: 1,
                visible: false,
              },
              [PHASE_2_HIDDEN_FIELD_SELECTORS.pds_date_suratcara]: {
                count: 1,
                visible: false,
              },
            },
          }),
          payload: HAPPY_PAYLOAD,
        }),
    },
  ];

  test.each(SCENARIOS)(
    "$label result is sensitive-data-free",
    async ({ build }) => {
      const result = await build();
      const serialized = JSON.stringify(result);
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(serialized)) {
          const m = serialized.match(pattern);
          throw new Error(
            `Forbidden pattern "${name}" matched: ${m?.[0]}`
          );
        }
      }
    }
  );
});

// ─── Test 9 · Forbidden wording in result reasons ─────────────────

describe("Phase 2 · forbidden wording", () => {
  /**
   * Per the B7 brief, the result must not overstate completion or
   * imply later-phase actions occurred.
   */
  const FORBIDDEN_WORDING: { pattern: RegExp; label: string }[] = [
    { pattern: /\bsubmitted\b/i, label: "submitted" },
    { pattern: /\bsent to LHDN\b/i, label: "sent to LHDN" },
    { pattern: /\bportal run started\b/i, label: "portal run started" },
    { pattern: /\bexecution completed\b/i, label: "execution completed" },
    { pattern: /\bpaid\b/i, label: "paid" },
    {
      pattern: /\bcertificate retrieved\b/i,
      label: "certificate retrieved",
    },
    { pattern: /\bHantar\b/i, label: "Hantar" },
  ];

  test("PHASE_2_REASON_LABELS contains none of the forbidden wording", () => {
    const allLabels = Object.values(PHASE_2_REASON_LABELS).join(" ");
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(allLabels)) {
        const m = allLabels.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched: ${m?.[0]}`
        );
      }
    }
  });

  test("approved 'saved' label does not overstate completion", () => {
    expect(PHASE_2_REASON_LABELS.saved).toBe("Maklumat Am draft saved.");
    expect(PHASE_2_REASON_LABELS.saved).not.toMatch(/submitted|completed/i);
  });
});

// ─── Test 10 · Selector & type constants (B7 sixth-attempt patch) ─

describe("Phase 2 · selector constants (B7 sixth-attempt evidence patch)", () => {
  test("save-button selector is the strict id `input#pdsL01_button_simpan`", () => {
    expect(PHASE_2_SAVE_BUTTON_SELECTOR).toBe("input#pdsL01_button_simpan");
    expect(PHASE_2_SAVE_BUTTON_SELECTOR).not.toContain(
      "pdsL01_button_simpan_hidden"
    );
    expect(PHASE_2_SAVE_BUTTON_SELECTOR).not.toMatch(/simpan_maklumat_am/i);
  });

  test("PHASE_2_FIELD_SELECTORS exposes EXACTLY pds_suratcara — no other writable field", () => {
    expect(Object.keys(PHASE_2_FIELD_SELECTORS).sort()).toEqual([
      "pds_suratcara",
    ]);
  });

  test("PHASE_2_FIELD_SELECTORS does NOT contain pds_ps / pds_dutisetem / pds_jenis / pds_salinan / pds_date_suratcara", () => {
    const k: ReadonlyArray<string> = Object.keys(PHASE_2_FIELD_SELECTORS);
    expect(k.includes("pds_ps")).toBe(false);
    expect(k.includes("pds_dutisetem")).toBe(false);
    expect(k.includes("pds_jenis")).toBe(false);
    expect(k.includes("pds_salinan")).toBe(false);
    expect(k.includes("pds_date_suratcara")).toBe(false);
  });

  test("PHASE_2_HIDDEN_FIELD_SELECTORS exposes EXACTLY pds_jenis / pds_salinan / pds_date_suratcara", () => {
    expect(Object.keys(PHASE_2_HIDDEN_FIELD_SELECTORS).sort()).toEqual([
      "pds_date_suratcara",
      "pds_jenis",
      "pds_salinan",
    ]);
  });

  test("PHASE_2_HIDDEN_FIELD_SELECTORS does NOT contain pds_ps or pds_dutisetem (those are not even probed)", () => {
    const k: ReadonlyArray<string> = Object.keys(PHASE_2_HIDDEN_FIELD_SELECTORS);
    expect(k.includes("pds_ps")).toBe(false);
    expect(k.includes("pds_dutisetem")).toBe(false);
  });
});

describe("Phase 2 · Phase2LocatorLike interface (no force-write surface)", () => {
  test("Phase2LocatorLike does NOT expose a method named `fill` (no hidden-field text fill)", () => {
    // A truthy mock locator that satisfies Phase2LocatorLike. If
    // we accidentally re-introduced `fill` to the interface, this
    // test would fail to typecheck.
    const minimal: Phase2LocatorLike = {
      count: async () => 1,
      selectOption: async () => undefined,
      click: async () => undefined,
      isVisible: async () => true,
      inputValue: async () => "",
    };
    // No `fill` property — the structural contract is enforced by
    // the type system. This runtime assertion belt-and-braces it.
    expect("fill" in minimal).toBe(false);
  });

  test("the executor never calls `selectOption` with a `force` option", async () => {
    let observedOptions: { timeout?: number; force?: unknown } | undefined;
    const customMock: Phase2PageLike = {
      url: () =>
        "https://stamps.hasil.gov.my/stamps/formv2/p5/edit/id/1234567890123",
      locator(selector: string): Phase2LocatorLike {
        return {
          async count() {
            // Numbers/booleans only — make every probe consistent.
            if (selector.includes("option[value=")) return 1;
            if (selector === PHASE_2_FIELD_SELECTORS.pds_suratcara) return 1;
            if (selector === PHASE_2_SAVE_BUTTON_SELECTOR) return 1;
            // Hidden snapshot probes (count check).
            return 1;
          },
          async selectOption(_value, options) {
            // Capture the options object the executor passed.
            observedOptions = options;
          },
          async click() {
            // no-op
          },
          async isVisible() {
            return true;
          },
          async inputValue() {
            return "";
          },
        };
      },
      async waitForLoadState() {
        // no-op
      },
    };
    await executePhase2MaklumatAmSave({
      page: customMock,
      payload: HAPPY_PAYLOAD,
    });
    expect(observedOptions).toBeDefined();
    // The executor's selectOption invocation MUST NOT carry `force`.
    expect((observedOptions as Record<string, unknown>).force).toBeUndefined();
  });
});

describe("Phase 2 · approved wording constants", () => {
  test("every refusal reason has a non-empty label", () => {
    const reasons: Phase2RefusalReason[] = [
      "job_not_found",
      "unsupported_lane",
      "readiness_not_ready",
      "instruction_graph_not_ready",
      "supervised_session_missing",
      "first_mutation_not_approved",
      "browser_not_reachable",
      "browser_not_phase_compatible",
      "p5_form_not_detected",
      "required_field_missing",
      "selector_missing",
      "ambiguous_selector",
      "save_button_missing",
      "required_option_missing",
      "save_fill_failed",
      "save_click_failed",
      "save_wait_failed",
      "save_failed",
      "post_save_verification_failed",
    ];
    for (const r of reasons) {
      expect(typeof PHASE_2_REASON_LABELS[r]).toBe("string");
      expect(PHASE_2_REASON_LABELS[r].length).toBeGreaterThan(0);
    }
  });

  test("payload code constants match the approved B7 set", () => {
    const r = buildPhase2MaklumatAmPayload(readyJob());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.pdsJenisCode).toBe("1103");
    }
  });
});

// ─── Type-level sanity (compile-time only) ────────────────────────

// If any of these references stop compiling, the executor's public
// API was changed in an incompatible way.
type _StaticAPISanityCheck = [
  Phase2HiddenFieldSnapshot["pdsJenis"]["present"],
  Phase2HiddenFieldSnapshot["pdsSalinan"]["expectedOptionExists"],
  Phase2HiddenFieldSnapshot["pdsDateSuratcara"]["valueLength"],
  Phase2MaklumatAmPayload["pdsSuratcaraCode"],
  Phase2MaklumatAmPayload["pdsJenisCode"],
  Phase2MaklumatAmPayload["pdsSalinanCode"]
];
const _sanity: _StaticAPISanityCheck = [
  true,
  true,
  0,
  "1101",
  "1103",
  "1",
];
void _sanity;
