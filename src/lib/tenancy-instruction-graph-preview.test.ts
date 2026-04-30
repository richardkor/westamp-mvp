/**
 * WeStamp — Tenancy Instruction Graph Preview · view-model tests
 *
 * Covers Milestone B1: the operator-side `Instruction Graph Preview`
 * adapter that turns the offline instruction graph into stable,
 * sensitive-data-free, render-ready strings.
 *
 * Test coverage maps directly to the brief's TEST REQUIREMENTS:
 *   1. ready graph view-model can render without exposing sensitive values;
 *   2. blocked graph view-model shows blocked wording and safe action text;
 *   3. phase names and mutation levels are shown;
 *   4. operator gates are shown (the canonical 5);
 *   5. no execution affordance is added (no "Run" / "Execute" button text);
 *   6. no portal-action wording is used.
 */

import {
  buildInstructionGraphPreviewViewModel,
  PREVIEW_AUTHORIZATION_CAVEAT,
  PREVIEW_BANNER_BLOCKED,
  PREVIEW_BANNER_READY,
  PREVIEW_BLOCKED_STATUS_LABEL,
  PREVIEW_FINAL_HANTAR_CAVEAT,
  PREVIEW_FUTURE_EXECUTION_LABEL,
  PREVIEW_HEADING,
  PREVIEW_HELPER_TEXT,
  PREVIEW_PLANNED_ONLY_LABEL,
  type InstructionGraphPreviewViewModel,
} from "./tenancy-instruction-graph-preview";
import {
  buildTenancyInstructionGraph,
  type TenancyInstructionGraphJobInput,
} from "./tenancy-instruction-graph";
import type { TenancyPortalParty } from "./stamping-types";

// ─── Fixture builder (mirrors B-impl Phase 0 ε-4c happy path) ─────

function buildReadyJob(): TenancyInstructionGraphJobInput {
  const landlord: TenancyPortalParty = {
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
  const tenant: TenancyPortalParty = {
    ...landlord,
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    mobile: "0129876543",
    gender: "female",
  };
  return {
    tenancyPortalDetails: {
      updatedAt: new Date().toISOString(),
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
    storagePath: "uploads/test/sample.pdf",
    originalFileName: "sample.pdf",
    mimeType: "application/pdf",
    documentCategory: "tenancy_agreement",
    stampingDetails: undefined,
  };
}

function buildReadyViewModel(): InstructionGraphPreviewViewModel {
  const graph = buildTenancyInstructionGraph({
    job: buildReadyJob(),
    jobId: "preview-test-ready",
  });
  return buildInstructionGraphPreviewViewModel(graph);
}

function buildBlockedViewModel(): InstructionGraphPreviewViewModel {
  const job = buildReadyJob();
  // Force a portal-field-mapping gap (multi_pass_unsupported) by
  // switching to amendment.
  job.tenancyPortalDetails!.instrument!.portalDescriptionType =
    "amendment_to_original_tenancy";
  const graph = buildTenancyInstructionGraph({
    job,
    jobId: "preview-test-blocked",
  });
  return buildInstructionGraphPreviewViewModel(graph);
}

// ─── Test 1 · Ready view-model is sensitive-data-free ──────────────

describe("Preview · ready view-model", () => {
  test("returns ready banner + standing helper text + caveat constants", () => {
    const vm = buildReadyViewModel();
    expect(vm.heading).toBe(PREVIEW_HEADING);
    expect(vm.helperText).toBe(PREVIEW_HELPER_TEXT);
    expect(vm.banner).toEqual({
      text: PREVIEW_BANNER_READY,
      tone: "ready",
    });
    expect(vm.futureExecutionLabel).toBe(PREVIEW_FUTURE_EXECUTION_LABEL);
    expect(vm.finalHantarCaveat).toBe(PREVIEW_FINAL_HANTAR_CAVEAT);
    expect(vm.authorizationCaveat).toBe(PREVIEW_AUTHORIZATION_CAVEAT);
    expect(vm.supportedPathLabel).toBe(
      "Fixed-rent residential (Kediaman) tenancy"
    );
    expect(vm.laneLabel).toBe("Sewa / Pajakan");
    expect(vm.blockedSummary).toBeNull();
    expect(vm.graphId).toMatch(/^wsg_[0-9a-f]{8}$/);
  });

  test("contains nine phase rows in canonical order", () => {
    const vm = buildReadyViewModel();
    expect(vm.phases).toHaveLength(9);
    const ids = vm.phases.map((p) => p.phaseId);
    expect(ids).toEqual([
      "phase_0_preflight",
      "phase_1_session_positioning",
      "phase_2_maklumat_am_draft",
      "phase_3_bahagian_a_parties",
      "phase_4_bahagian_b_rent",
      "phase_5_bahagian_c_property",
      "phase_6_lampiran_upload",
      "phase_7_rumusan_readback",
      "phase_8_perakuan_hantar",
    ]);
  });
});

// ─── Test 2 · Phase names + mutation levels rendered ───────────────

describe("Preview · phase rows", () => {
  test("each phase row carries name, mutation level, exec status, step count, gate flag", () => {
    const vm = buildReadyViewModel();
    for (const row of vm.phases) {
      expect(typeof row.phaseName).toBe("string");
      expect(row.phaseName).toMatch(/^Phase \d ·/);
      expect(typeof row.mutationLevelLabel).toBe("string");
      expect(row.mutationLevelLabel.length).toBeGreaterThan(0);
      expect(row.executionStatusLabel).toBe(PREVIEW_PLANNED_ONLY_LABEL);
      expect(typeof row.stepCount).toBe("number");
      expect(row.stepCount).toBeGreaterThan(0);
      expect(typeof row.hasOperatorGate).toBe("boolean");
    }
  });

  test("Phase 0 mutation level is 'Read only', Phase 2 is 'Server save', Phase 6 is 'Upload', Phase 8 is 'Final submit'", () => {
    const vm = buildReadyViewModel();
    const byId = new Map(vm.phases.map((p) => [p.phaseId, p]));
    expect(byId.get("phase_0_preflight")?.mutationLevelLabel).toBe(
      "Read only"
    );
    expect(byId.get("phase_2_maklumat_am_draft")?.mutationLevelLabel).toBe(
      "Server save"
    );
    expect(byId.get("phase_6_lampiran_upload")?.mutationLevelLabel).toBe(
      "Upload"
    );
    expect(byId.get("phase_8_perakuan_hantar")?.mutationLevelLabel).toBe(
      "Final submit"
    );
  });

  test("phases known to contain or require operator gates have hasOperatorGate=true", () => {
    const vm = buildReadyViewModel();
    const byId = new Map(vm.phases.map((p) => [p.phaseId, p]));
    expect(byId.get("phase_0_preflight")?.hasOperatorGate).toBe(true);
    expect(byId.get("phase_2_maklumat_am_draft")?.hasOperatorGate).toBe(true);
    expect(byId.get("phase_6_lampiran_upload")?.hasOperatorGate).toBe(true);
    expect(byId.get("phase_8_perakuan_hantar")?.hasOperatorGate).toBe(true);
    // Phases 3, 4, 5, 7 contain no operator gate.
    expect(byId.get("phase_3_bahagian_a_parties")?.hasOperatorGate).toBe(
      false
    );
    expect(byId.get("phase_4_bahagian_b_rent")?.hasOperatorGate).toBe(false);
    expect(byId.get("phase_5_bahagian_c_property")?.hasOperatorGate).toBe(
      false
    );
    expect(byId.get("phase_7_rumusan_readback")?.hasOperatorGate).toBe(false);
  });
});

// ─── Test 3 · Operator gate concise list (canonical 5) ─────────────

describe("Preview · operator gate concise list", () => {
  test("ready view-model lists the brief's five canonical gates verbatim", () => {
    const vm = buildReadyViewModel();
    const labels = vm.operatorGates.map((g) => g.label);
    expect(labels).toEqual([
      "before first portal mutation",
      "before upload",
      "before declaration",
      "before pre-Hantar",
      "before final Hantar",
    ]);
  });

  test("each gate carries the phase name it appears in", () => {
    const vm = buildReadyViewModel();
    expect(vm.operatorGates[0].phaseName).toMatch(
      /^Phase 0 · Offline preflight$/
    );
    expect(vm.operatorGates[1].phaseName).toMatch(
      /^Phase 6 · Lampiran upload$/
    );
    expect(vm.operatorGates[2].phaseName).toMatch(
      /^Phase 8 · Perakuan and final Hantar gates$/
    );
    expect(vm.operatorGates[3].phaseName).toMatch(
      /^Phase 8 · Perakuan and final Hantar gates$/
    );
    expect(vm.operatorGates[4].phaseName).toMatch(
      /^Phase 8 · Perakuan and final Hantar gates$/
    );
  });

  test("blocked view-model has zero operator gates", () => {
    const vm = buildBlockedViewModel();
    expect(vm.operatorGates).toEqual([]);
  });
});

// ─── Test 4 · Blocked view-model wording ───────────────────────────

describe("Preview · blocked view-model", () => {
  test("uses approved blocked wording and safe action text", () => {
    const vm = buildBlockedViewModel();
    expect(vm.banner).toEqual({
      text: PREVIEW_BANNER_BLOCKED,
      tone: "blocked",
    });
    expect(vm.phases).toEqual([]);
    expect(vm.blockedSummary).not.toBeNull();
    // Safe-action text is exactly the constant from the graph builder.
    expect(vm.blockedSummary?.safeActionText).toBe(
      "Resolve readiness blockers before building a supervised portal run graph."
    );
  });

  test("aggregates blocker reasons by category with stable codes", () => {
    const vm = buildBlockedViewModel();
    const groups = vm.blockedSummary?.groups ?? [];
    expect(groups.length).toBeGreaterThan(0);
    // Amendment forces a `portal_field_mapping_gap` category with the
    // stable `pds_jenis_1105_unsupported` code.
    const fmg = groups.find((g) => g.category === "portal_field_mapping_gap");
    expect(fmg).toBeDefined();
    expect(fmg?.count).toBeGreaterThanOrEqual(1);
    expect(fmg?.representativeCodes.length).toBeGreaterThan(0);
    expect(fmg?.representativeCodes.length).toBeLessThanOrEqual(3);
    expect(fmg?.representativeCodes).toContain("pds_jenis_1105_unsupported");
    expect(fmg?.categoryLabel).toBe("Portal field-mapping gap");
  });

  test("missing storage path produces a readiness_blocker category", () => {
    const job = buildReadyJob();
    job.storagePath = "";
    const graph = buildTenancyInstructionGraph({ job });
    const vm = buildInstructionGraphPreviewViewModel(graph);
    expect(vm.banner.tone).toBe("blocked");
    const groups = vm.blockedSummary?.groups ?? [];
    expect(groups.some((g) => g.category === "readiness_blocker")).toBe(true);
  });
});

// ─── Test 5 · Sensitive-data invariant ─────────────────────────────

describe("Preview · sensitive-data invariant", () => {
  /**
   * Forbidden patterns mirror the graph builder's invariant test.
   * The view-model is supposed to be even safer than the graph
   * (it's the rendered surface) so the forbidden set is identical.
   */
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "literal landlord IC", pattern: /900101015555/ },
    { name: "literal tenant IC", pattern: /950505055555/ },
    { name: "literal landlord name", pattern: /Test Landlord/i },
    { name: "literal tenant name", pattern: /Test Tenant/i },
    { name: "literal landlord mobile", pattern: /0123456789/ },
    { name: "literal tenant mobile", pattern: /0129876543/ },
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

  test("ready view-model JSON is free of sensitive values", () => {
    const vm = buildReadyViewModel();
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched in preview JSON: ${m?.[0]}`
        );
      }
    }
  });

  test("blocked view-model JSON is free of sensitive values", () => {
    const vm = buildBlockedViewModel();
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched in blocked preview JSON: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 6 · Forbidden wording invariant ──────────────────────────

describe("Preview · forbidden wording invariant", () => {
  /**
   * The B1 brief enumerates wording that MUST NOT appear in this
   * milestone (because it would suggest the graph has run / been
   * submitted / been sent). Matched as case-insensitive substrings.
   *
   * Note "submitted" is a substring of "submission"; we intentionally
   * use "submission" in `PREVIEW_AUTHORIZATION_CAVEAT` as a word that
   * NEGATES the action ("does not authorize ... final submission").
   * To keep the invariant precise we test for "submitted" (past
   * participle) only — that's the verb form that implies the action
   * happened, which is what the brief forbids.
   */
  const FORBIDDEN_WORDING: RegExp[] = [
    /\bautomated\b/i,
    /\bsubmitted\b/i,
    /\bsent to LHDN\b/i,
    /\bexecuted\b/i,
    /\bcompleted\b/i,
    /\bportal run started\b/i,
  ];

  test("ready view-model contains none of the forbidden wording", () => {
    const vm = buildReadyViewModel();
    const serialized = JSON.stringify(vm);
    for (const pattern of FORBIDDEN_WORDING) {
      expect({ pattern: pattern.source, hit: pattern.test(serialized) })
        .toEqual({ pattern: pattern.source, hit: false });
    }
  });

  test("blocked view-model contains none of the forbidden wording", () => {
    const vm = buildBlockedViewModel();
    const serialized = JSON.stringify(vm);
    for (const pattern of FORBIDDEN_WORDING) {
      expect({ pattern: pattern.source, hit: pattern.test(serialized) })
        .toEqual({ pattern: pattern.source, hit: false });
    }
  });

  test("no execution-affordance wording (Run / Execute / Submit / Send) appears", () => {
    // Captures any imperative button label the panel would suggest
    // an action surface. The view-model is metadata only; even
    // "Execute" should not appear (the future-execution caveat uses
    // "Execution", which is a noun — also must not appear in any
    // affordance role; we just check absence here).
    const vm = buildReadyViewModel();
    const serialized = JSON.stringify(vm);
    expect(/\bRun (graph|now|portal)\b/i.test(serialized)).toBe(false);
    expect(/\bExecute (graph|now|phase)\b/i.test(serialized)).toBe(false);
    expect(/\bSubmit (now|graph)\b/i.test(serialized)).toBe(false);
    expect(/\bSend to LHDN\b/i.test(serialized)).toBe(false);
    expect(/\bStart portal run\b/i.test(serialized)).toBe(false);
  });
});

// ─── Test 7 · Standing constants and approved wording ──────────────

describe("Preview · approved wording constants", () => {
  test("approved B1 wording strings match exactly", () => {
    expect(PREVIEW_HEADING).toBe("Instruction Graph Preview");
    expect(PREVIEW_HELPER_TEXT).toBe(
      "This is a planned, non-executing graph for a future supervised portal run. No e-Duti Setem action has been taken."
    );
    expect(PREVIEW_BANNER_READY).toBe("Graph ready for supervised-run planning");
    expect(PREVIEW_BANNER_BLOCKED).toBe("Graph blocked by readiness issues");
    expect(PREVIEW_PLANNED_ONLY_LABEL).toBe("Planned only");
    expect(PREVIEW_BLOCKED_STATUS_LABEL).toBe("Blocked");
    expect(PREVIEW_FUTURE_EXECUTION_LABEL).toBe(
      "Execution not implemented in this milestone"
    );
  });
});
