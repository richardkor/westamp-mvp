/**
 * WeStamp — Tenancy Supervised Run Console · view-model tests
 *
 * Covers Milestone B2: the operator-facing supervised-run console
 * adapter. The view-model is the rendered surface; these tests are
 * the contract.
 *
 * Test coverage maps directly to the brief's TEST REQUIREMENTS:
 *   1. ready job shows eligible state;
 *   2. blocked job shows not eligible state;
 *   3. preflight checklist renders expected categories;
 *   4. instruction graph summary is visible;
 *   5. operator gate count is visible;
 *   6. no execution wording is present;
 *   7. no button or UI text implies portal mutation;
 *   8. sensitive data is not rendered;
 *   9. negative/blocked job still shows blocker summary.
 */

import {
  buildSupervisedRunConsoleViewModel,
  CONSOLE_AUTHORIZATION_CAVEAT,
  CONSOLE_BANNER_BLOCKED,
  CONSOLE_BANNER_READY,
  CONSOLE_FUTURE_GATE_NOTE,
  CONSOLE_HEADING,
  CONSOLE_HELPER_TEXT,
  CONSOLE_NON_EXECUTION_NOTE,
  CONSOLE_REFRESH_ACTION_LABEL,
  type SupervisedRunConsoleViewModel,
  type PreflightChecklistItem,
  type PreflightChecklistItemId,
} from "./tenancy-supervised-run-console";
import {
  buildTenancyInstructionGraph,
  type TenancyInstructionGraphJobInput,
} from "./tenancy-instruction-graph";
import { buildInstructionGraphPreviewViewModel } from "./tenancy-instruction-graph-preview";
import { evaluateTenancyPortalRunReadiness } from "./tenancy-portal-run-readiness";
import type { TenancyPortalParty } from "./stamping-types";

// ─── Fixture builder ──────────────────────────────────────────────

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

/** Build a ready view-model end-to-end (readiness → graph → preview → console). */
function buildReadyConsole(): SupervisedRunConsoleViewModel {
  const job = buildReadyJob();
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraph({
    job,
    jobId: "console-test-ready",
    readinessReport,
  });
  const graphPreview = buildInstructionGraphPreviewViewModel(graph);
  return buildSupervisedRunConsoleViewModel({
    job,
    readinessReport,
    graph,
    graphPreview,
  });
}

/**
 * Build a blocked view-model. The mutation is parameterised so each
 * negative-path test can exercise a distinct failure mode without
 * duplicating the entire pipeline.
 */
function buildBlockedConsole(
  mutate: (job: TenancyInstructionGraphJobInput) => void
): SupervisedRunConsoleViewModel {
  const job = buildReadyJob();
  mutate(job);
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraph({
    job,
    jobId: "console-test-blocked",
    readinessReport,
  });
  const graphPreview = buildInstructionGraphPreviewViewModel(graph);
  return buildSupervisedRunConsoleViewModel({
    job,
    readinessReport,
    graph,
    graphPreview,
  });
}

// ─── Test 1 · Ready job is eligible ────────────────────────────────

describe("Console · ready job is eligible", () => {
  test("emits the approved heading + helper text + caveat constants", () => {
    const vm = buildReadyConsole();
    expect(vm.heading).toBe(CONSOLE_HEADING);
    expect(vm.helperText).toBe(CONSOLE_HELPER_TEXT);
    expect(vm.nonExecutionNote).toBe(CONSOLE_NON_EXECUTION_NOTE);
    expect(vm.futureGateNote).toBe(CONSOLE_FUTURE_GATE_NOTE);
    expect(vm.authorizationCaveat).toBe(CONSOLE_AUTHORIZATION_CAVEAT);
    expect(vm.refreshActionLabel).toBe(CONSOLE_REFRESH_ACTION_LABEL);
  });

  test("eligibility is `eligible` and banner shows the approved ready text", () => {
    const vm = buildReadyConsole();
    expect(vm.eligibility).toBe("eligible");
    expect(vm.banner).toEqual({ text: CONSOLE_BANNER_READY, tone: "ready" });
    expect(vm.eligibilityLabel).toBe(CONSOLE_BANNER_READY);
  });

  test("readiness verdict surfaces verbatim with operator-facing label", () => {
    const vm = buildReadyConsole();
    expect(vm.readinessVerdict).toBe("ready_for_supervised_run");
    expect(vm.readinessVerdictLabel).toBe("Ready for supervised portal run");
  });

  test("blockedSummary is null for a ready job", () => {
    const vm = buildReadyConsole();
    expect(vm.blockedSummary).toBeNull();
  });
});

// ─── Test 2 · Blocked job is not eligible ──────────────────────────

describe("Console · blocked job is not eligible", () => {
  test("missing storage path → not eligible", () => {
    const vm = buildBlockedConsole((job) => {
      job.storagePath = "";
    });
    expect(vm.eligibility).toBe("not_eligible");
    expect(vm.banner).toEqual({
      text: CONSOLE_BANNER_BLOCKED,
      tone: "blocked",
    });
    expect(vm.blockedSummary).not.toBeNull();
  });

  test("variable rent → not eligible with multi-pass blocker group surfaced", () => {
    const vm = buildBlockedConsole((job) => {
      job.tenancyPortalDetails!.instrument!.portalDescriptionType =
        "variable_rent_during_tenancy";
    });
    expect(vm.eligibility).toBe("not_eligible");
    const groups = vm.blockedSummary?.groups ?? [];
    expect(
      groups.some((g) => g.key.includes("multi_pass_unsupported"))
    ).toBe(true);
  });

  test("partially_furnished → not eligible with portal_enum_mismatch group", () => {
    const vm = buildBlockedConsole((job) => {
      job.tenancyPortalDetails!.property!.furnishedStatus =
        "partially_furnished";
    });
    expect(vm.eligibility).toBe("not_eligible");
    const groups = vm.blockedSummary?.groups ?? [];
    expect(
      groups.some((g) => g.key.includes("portal_enum_mismatch"))
    ).toBe(true);
  });
});

// ─── Test 3 · Preflight checklist categories ───────────────────────

describe("Console · preflight checklist", () => {
  const EXPECTED_IDS: PreflightChecklistItemId[] = [
    "source_pdf_present",
    "readiness_verdict_ready",
    "fixed_rent_single_period",
    "mapped_canonical_values",
    "party_identity_complete",
    "land_registry_complete",
    "maklumat_am_complete",
    "instruction_graph_built",
  ];

  test("ready job has every preflight item passing in canonical order", () => {
    const vm = buildReadyConsole();
    expect(vm.preflightChecklist.map((i) => i.id)).toEqual(EXPECTED_IDS);
    for (const item of vm.preflightChecklist) {
      expect(item.status).toBe("pass");
      expect(item.failReason).toBeUndefined();
      expect(typeof item.label).toBe("string");
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  test("missing storage path fails ONLY the source_pdf_present + downstream items", () => {
    const vm = buildBlockedConsole((job) => {
      job.storagePath = "";
    });
    const byId = new Map<PreflightChecklistItemId, PreflightChecklistItem>(
      vm.preflightChecklist.map((i) => [i.id, i])
    );
    expect(byId.get("source_pdf_present")?.status).toBe("fail");
    // Readiness and graph are downstream — both also fail.
    expect(byId.get("readiness_verdict_ready")?.status).toBe("fail");
    expect(byId.get("instruction_graph_built")?.status).toBe("fail");
    // The independent gap categories should still pass on a job that
    // is only missing the storage path.
    expect(byId.get("party_identity_complete")?.status).toBe("pass");
    expect(byId.get("land_registry_complete")?.status).toBe("pass");
    expect(byId.get("maklumat_am_complete")?.status).toBe("pass");
    expect(byId.get("mapped_canonical_values")?.status).toBe("pass");
    expect(byId.get("fixed_rent_single_period")?.status).toBe("pass");
  });

  test("variable-rent job fails fixed_rent_single_period + downstream", () => {
    const vm = buildBlockedConsole((job) => {
      job.tenancyPortalDetails!.instrument!.portalDescriptionType =
        "variable_rent_during_tenancy";
    });
    const byId = new Map<PreflightChecklistItemId, PreflightChecklistItem>(
      vm.preflightChecklist.map((i) => [i.id, i])
    );
    expect(byId.get("fixed_rent_single_period")?.status).toBe("fail");
    expect(byId.get("readiness_verdict_ready")?.status).toBe("fail");
    expect(byId.get("instruction_graph_built")?.status).toBe("fail");
    // Source PDF + party identity + land registry + maklumat am should
    // remain passing — the only break is the multi-pass condition.
    expect(byId.get("source_pdf_present")?.status).toBe("pass");
    expect(byId.get("party_identity_complete")?.status).toBe("pass");
    expect(byId.get("land_registry_complete")?.status).toBe("pass");
    expect(byId.get("maklumat_am_complete")?.status).toBe("pass");
  });

  test("missing party identity (no gender) fails party_identity_complete", () => {
    const vm = buildBlockedConsole((job) => {
      delete job.tenancyPortalDetails!.parties[0].gender;
    });
    const byId = new Map<PreflightChecklistItemId, PreflightChecklistItem>(
      vm.preflightChecklist.map((i) => [i.id, i])
    );
    expect(byId.get("party_identity_complete")?.status).toBe("fail");
    expect(
      byId.get("party_identity_complete")?.failReason
    ).toMatch(/party identity gap/i);
  });

  test("fail reasons never embed party identity values", () => {
    const vm = buildBlockedConsole((job) => {
      delete job.tenancyPortalDetails!.parties[0].gender;
    });
    for (const item of vm.preflightChecklist) {
      if (item.failReason) {
        expect(item.failReason).not.toMatch(/Test Landlord/i);
        expect(item.failReason).not.toMatch(/900101015555/);
      }
    }
  });
});

// ─── Test 4 · Instruction graph summary is visible ─────────────────

describe("Console · instruction graph summary", () => {
  test("ready job exposes graph verdict, supported path, lane, phase count", () => {
    const vm = buildReadyConsole();
    expect(vm.graphSummary.verdict).toBe("ready_for_supervised_run");
    expect(vm.graphSummary.verdictLabel).toBe(
      "Graph ready for supervised-run planning"
    );
    expect(vm.graphSummary.verdictTone).toBe("ready");
    expect(vm.graphSummary.supportedPathLabel).toBe(
      "Fixed-rent residential (Kediaman) tenancy"
    );
    expect(vm.graphSummary.laneLabel).toBe("Sewa / Pajakan");
    expect(vm.graphSummary.phaseCount).toBe(9);
  });

  test("blocked job carries graph verdict 'blocked' with corresponding label", () => {
    const vm = buildBlockedConsole((job) => {
      job.storagePath = "";
    });
    expect(vm.graphSummary.verdict).toBe("blocked");
    expect(vm.graphSummary.verdictLabel).toBe("Graph blocked by readiness issues");
    expect(vm.graphSummary.verdictTone).toBe("blocked");
    // Graph skeleton retains nine phase entries even when blocked.
    expect(vm.graphSummary.phaseCount).toBe(9);
  });
});

// ─── Test 5 · Operator gate count is visible ───────────────────────

describe("Console · operator gate count", () => {
  test("ready job surfaces the canonical 5 gates", () => {
    const vm = buildReadyConsole();
    expect(vm.graphSummary.operatorGateCount).toBe(5);
  });

  test("blocked job surfaces gate count = 0", () => {
    const vm = buildBlockedConsole((job) => {
      job.storagePath = "";
    });
    // Graph preview's operatorGates is empty for blocked graphs (the
    // graph is design-only metadata; we don't expose gate planning
    // for blocked jobs).
    expect(vm.graphSummary.operatorGateCount).toBe(0);
  });
});

// ─── Test 6 · Forbidden wording invariant ──────────────────────────

describe("Console · forbidden wording invariant", () => {
  /**
   * The B2 brief enumerates wording that MUST NOT appear in the
   * console surface. "sent" is a single word, so we anchor with
   * word-boundaries (matches "sent" but not "represent").
   */
  const FORBIDDEN_WORDING: { pattern: RegExp; label: string }[] = [
    { pattern: /\bautomated submission\b/i, label: "automated submission" },
    { pattern: /\bsubmitted to LHDN\b/i, label: "submitted to LHDN" },
    { pattern: /\bportal run started\b/i, label: "portal run started" },
    { pattern: /\bexecution completed\b/i, label: "execution completed" },
    { pattern: /\bsent\b/i, label: "sent" },
    { pattern: /\bpaid\b/i, label: "paid" },
    { pattern: /\bcertificate retrieved\b/i, label: "certificate retrieved" },
  ];

  test("ready view-model contains none of the forbidden wording", () => {
    const vm = buildReadyConsole();
    const serialized = JSON.stringify(vm);
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched in ready console JSON: ${m?.[0]}`
        );
      }
    }
  });

  test("blocked view-model contains none of the forbidden wording", () => {
    const vm = buildBlockedConsole((job) => {
      job.storagePath = "";
    });
    const serialized = JSON.stringify(vm);
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched in blocked console JSON: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 7 · No portal-mutation affordance ────────────────────────

describe("Console · no portal-mutation affordance", () => {
  test("the only action label is the approved Refresh Run Plan", () => {
    const vm = buildReadyConsole();
    // Only one action label is exposed by the view-model.
    expect(vm.refreshActionLabel).toBe(CONSOLE_REFRESH_ACTION_LABEL);
    // The action label must not be one of the forbidden imperatives.
    // "Run Plan" as a noun phrase is approved; we forbid only the
    // dangerous imperative verbs that imply portal mutation.
    const FORBIDDEN_IMPERATIVES: RegExp[] = [
      /\bStart portal\b/i,
      /\bSubmit\b/i,
      /\bExecute\b/i,
      /\bSend to LHDN\b/i,
      /\bPay\b/i,
      /\bUpload to portal\b/i,
      /\bHantar\b/i,
    ];
    for (const pattern of FORBIDDEN_IMPERATIVES) {
      expect({
        pattern: pattern.source,
        hit: pattern.test(vm.refreshActionLabel),
      }).toEqual({ pattern: pattern.source, hit: false });
    }
  });

  test("no field in the view-model contains a portal-mutation imperative", () => {
    const vm = buildReadyConsole();
    const serialized = JSON.stringify(vm);
    const FORBIDDEN_AFFORDANCES: RegExp[] = [
      /\bStart portal run\b/i,
      /\bSubmit (now|graph|to LHDN)\b/i,
      /\bExecute (graph|now|phase)\b/i,
      /\bSend to LHDN\b/i,
      /\bPay (now|stamp duty)\b/i,
      /\bUpload to portal\b/i,
      /\bHantar\b/i,
    ];
    for (const pattern of FORBIDDEN_AFFORDANCES) {
      expect({
        pattern: pattern.source,
        hit: pattern.test(serialized),
      }).toEqual({ pattern: pattern.source, hit: false });
    }
  });
});

// ─── Test 8 · Sensitive-data invariant ─────────────────────────────

describe("Console · sensitive-data invariant", () => {
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

  test("ready console JSON is free of sensitive values", () => {
    const vm = buildReadyConsole();
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched in console JSON: ${m?.[0]}`
        );
      }
    }
  });

  test("blocked console JSON is free of sensitive values", () => {
    const vm = buildBlockedConsole((job) => {
      delete job.tenancyPortalDetails!.parties[0].gender;
    });
    const serialized = JSON.stringify(vm);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern "${name}" matched in blocked console JSON: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 9 · Blocked job still shows blocker summary ──────────────

describe("Console · blocked summary always populated when not eligible", () => {
  const SCENARIOS: {
    name: string;
    mutate: (job: TenancyInstructionGraphJobInput) => void;
    expectedCategorySubstr: string;
  }[] = [
    {
      name: "amendment description",
      mutate: (j) => {
        j.tenancyPortalDetails!.instrument!.portalDescriptionType =
          "amendment_to_original_tenancy";
      },
      expectedCategorySubstr: "multi_pass_unsupported",
    },
    {
      name: "missing party gender",
      mutate: (j) => {
        delete j.tenancyPortalDetails!.parties[0].gender;
      },
      expectedCategorySubstr: "party_model_not_modelled",
    },
    {
      name: "missing land registry",
      mutate: (j) => {
        if (j.tenancyPortalDetails?.property) {
          delete j.tenancyPortalDetails.property.landRegistry;
        }
      },
      expectedCategorySubstr: "land_registry_not_modelled",
    },
    {
      name: "missing maklumat am",
      mutate: (j) => {
        if (j.tenancyPortalDetails) {
          delete j.tenancyPortalDetails.maklumatAm;
        }
      },
      expectedCategorySubstr: "maklumat_am_not_captured",
    },
  ];

  test.each(SCENARIOS)(
    "$name surfaces a populated blockedSummary with the matching category",
    ({ mutate, expectedCategorySubstr }) => {
      const vm = buildBlockedConsole(mutate);
      expect(vm.eligibility).toBe("not_eligible");
      expect(vm.blockedSummary).not.toBeNull();
      expect(vm.blockedSummary?.safeActionText).toBe(
        "Resolve readiness blockers before building a supervised portal run graph."
      );
      const groups = vm.blockedSummary?.groups ?? [];
      expect(groups.length).toBeGreaterThan(0);
      expect(
        groups.some((g) => g.key.includes(expectedCategorySubstr))
      ).toBe(true);
      // Each group has a stable label and a non-zero count.
      for (const g of groups) {
        expect(typeof g.label).toBe("string");
        expect(g.label.length).toBeGreaterThan(0);
        expect(g.count).toBeGreaterThan(0);
      }
    }
  );
});

// ─── Test 10 · Approved-wording constants ──────────────────────────

describe("Console · approved-wording constants", () => {
  test("each B2 string matches the brief verbatim", () => {
    expect(CONSOLE_HEADING).toBe("Supervised Run Console");
    expect(CONSOLE_HELPER_TEXT).toBe(
      "This console prepares the internal run plan for a future supervised e-Duti Setem session. It does not execute portal actions."
    );
    expect(CONSOLE_BANNER_READY).toBe("Eligible for future supervised run");
    expect(CONSOLE_BANNER_BLOCKED).toBe("Not eligible for supervised run");
    expect(CONSOLE_NON_EXECUTION_NOTE).toBe(
      "No e-Duti Setem action has been taken."
    );
    expect(CONSOLE_FUTURE_GATE_NOTE).toBe(
      "A separate operator approval milestone is required before any portal mutation."
    );
    expect(CONSOLE_REFRESH_ACTION_LABEL).toBe("Refresh Run Plan");
  });
});
