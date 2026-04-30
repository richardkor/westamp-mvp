/**
 * WeStamp — Tenancy Instruction-Graph Builder · tests
 *
 * Covers Milestone B-impl Phase 0: the offline preflight builder
 * that converts a `ready_for_supervised_run` tenancy job into a
 * non-executing, inspectable instruction graph.
 *
 * The tests verify ten invariants directly traceable to the brief:
 *   1. ready fixed-rent tenancy returns verdict ready_for_supervised_run
 *   2. graph contains Phases 0–8 in canonical order
 *   3. Phase 0 includes preflight checks AND the first operator gate
 *   4. later phases are planned-only / not executable in this milestone
 *   5. graph uses mapped canonical fields without exposing sensitive values
 *   6. blocked input returns blocked result and zero executable phases
 *   7. variable rent / amendment / multi-period input remains blocked
 *   8. no step includes IC numbers, TINs, cookies, tokens, raw hrefs,
 *      or sensitive URLs
 *   9. mutation levels are correctly assigned per phase
 *  10. final Hantar is a separate final_submit step behind an operator gate
 */

import {
  buildTenancyInstructionGraph,
  buildTenancyInstructionGraphFromJob,
  SAFE_ACTION_BLOCKED,
  SAFE_ACTION_READY,
  type TenancyInstructionGraph,
  type TenancyInstructionGraphJobInput,
  type TenancyInstructionPhaseId,
  type TenancyInstructionStep,
} from "./tenancy-instruction-graph";
import type {
  TenancyPortalParty,
  TenancyPortalDescriptionType,
} from "./stamping-types";

// ─── Fixture builder ───────────────────────────────────────────────

/**
 * Build a fully-captured fixed-rent residential tenancy fixture.
 * Identical in spirit to the ε-4c fixture in the readiness gate
 * tests — kept duplicated here on purpose so this test file is self-
 * contained and independent of any ordering / leakage between test
 * files.
 */
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

const CANONICAL_PHASE_ORDER: TenancyInstructionPhaseId[] = [
  "phase_0_preflight",
  "phase_1_session_positioning",
  "phase_2_maklumat_am_draft",
  "phase_3_bahagian_a_parties",
  "phase_4_bahagian_b_rent",
  "phase_5_bahagian_c_property",
  "phase_6_lampiran_upload",
  "phase_7_rumusan_readback",
  "phase_8_perakuan_hantar",
];

/**
 * Iterate every step of every phase. Convenience for invariants that
 * apply graph-wide (sensitive-data check, executionStatus check).
 */
function eachStep(graph: TenancyInstructionGraph): TenancyInstructionStep[] {
  return graph.phases.flatMap((p) => p.steps);
}

// ─── Test 1 · Ready fixture compiles to a ready graph ──────────────

describe("Builder · ready fixed-rent tenancy", () => {
  test("verdict is ready_for_supervised_run for the ε-4c happy-path fixture", () => {
    const job = buildReadyJob();
    const graph = buildTenancyInstructionGraph({ job, jobId: "job-test-1" });

    if (graph.verdict !== "ready_for_supervised_run") {
      throw new Error(
        `Expected ready_for_supervised_run; got blocked. Reasons: ${JSON.stringify(
          graph.blockingReasons
        )}`
      );
    }

    expect(graph.verdict).toBe("ready_for_supervised_run");
    expect(graph.lane).toBe("sewa_pajakan");
    expect(graph.supportedPath).toBe("fixed_rent_residential_kediaman");
    expect(graph.jobId).toBe("job-test-1");
    expect(graph.blockingReasons).toEqual([]);
    expect(graph.safeActionText).toBe(SAFE_ACTION_READY);
    expect(graph.compiledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(graph.graphId).toMatch(/^wsg_[0-9a-f]{8}$/);
  });

  test("graphId is deterministic for the same jobId/lane/path", () => {
    const job = buildReadyJob();
    const a = buildTenancyInstructionGraph({ job, jobId: "stable-job-id" });
    const b = buildTenancyInstructionGraph({ job, jobId: "stable-job-id" });
    expect(a.graphId).toBe(b.graphId);
  });

  test("graphId differs across distinct jobIds", () => {
    const job = buildReadyJob();
    const a = buildTenancyInstructionGraph({ job, jobId: "job-A" });
    const b = buildTenancyInstructionGraph({ job, jobId: "job-B" });
    expect(a.graphId).not.toBe(b.graphId);
  });

  test("doesNotAuthorize is always all-false", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    expect(graph.doesNotAuthorize).toEqual({
      browserExecution: false,
      portalMutation: false,
      payment: false,
      certificateRetrieval: false,
      finalSubmission: false,
    });
  });
});

// ─── Test 2 · Graph contains Phases 0–8 ────────────────────────────

describe("Builder · phase order", () => {
  test("ready graph has nine phases in canonical order", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    expect(graph.phases).toHaveLength(9);
    expect(graph.phases.map((p) => p.phaseId)).toEqual(CANONICAL_PHASE_ORDER);
  });

  test("each phase has a stable operator-facing name", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    for (const phase of graph.phases) {
      expect(typeof phase.name).toBe("string");
      expect(phase.name.length).toBeGreaterThan(0);
      expect(phase.name).toMatch(/^Phase \d ·/);
    }
  });
});

// ─── Test 3 · Phase 0 includes preflight checks + first gate ──────

describe("Builder · Phase 0 preflight", () => {
  test("Phase 0 has preflight_check steps and ends with an operator gate", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase0 = graph.phases[0];
    expect(phase0.phaseId).toBe("phase_0_preflight");

    const stepTypes = phase0.steps.map((s) => s.stepType);
    expect(stepTypes.filter((t) => t === "preflight_check").length)
      .toBeGreaterThanOrEqual(4);
    // Last step must be the operator gate guarding the first portal mutation.
    const lastStep = phase0.steps[phase0.steps.length - 1];
    expect(lastStep.stepType).toBe("operator_gate");
    expect(lastStep.isOperatorGate).toBe(true);
  });

  test("Phase 0 highestMutationLevel is read_only", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    expect(graph.phases[0].highestMutationLevel).toBe("read_only");
  });

  test("Phase 0 covers the four mandatory preflight checks", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const ids = graph.phases[0].steps.map((s) => s.stepId);
    expect(ids.some((id) => id.includes("verify_verdict"))).toBe(true);
    expect(ids.some((id) => id.includes("source_pdf_present"))).toBe(true);
    expect(
      ids.some((id) => id.includes("fixed_rent_single_period"))
    ).toBe(true);
    expect(ids.some((id) => id.includes("no_blocker_categories"))).toBe(true);
  });
});

// ─── Test 4 · Later phases are planned-only ────────────────────────

describe("Builder · later phases are planned-only", () => {
  test("every phase 1..8 has executionStatus = planned_only", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const laterPhases = graph.phases.slice(1);
    for (const phase of laterPhases) {
      expect(phase.executionStatus).toBe("planned_only");
    }
  });

  test("every step in every phase has executionStatus = planned_only", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    for (const step of eachStep(graph)) {
      expect(step.executionStatus).toBe("planned_only");
    }
  });

  test("Phase 2 requiresOperatorGateBefore (first portal mutation)", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase2 = graph.phases.find(
      (p) => p.phaseId === "phase_2_maklumat_am_draft"
    );
    expect(phase2?.requiresOperatorGateBefore).toBe(true);
  });
});

// ─── Test 5 · Mapped canonical fields without sensitive values ────

describe("Builder · canonical mapping codes", () => {
  test("Phase 2 emits the post-ε-4c canonical codes for fixed-vocabulary fields", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase2 = graph.phases.find(
      (p) => p.phaseId === "phase_2_maklumat_am_draft"
    )!;
    const byKey = new Map(
      phase2.steps
        .filter((s) => s.selectorKey)
        .map((s) => [s.selectorKey as string, s])
    );
    expect(byKey.get("pds_suratcara")?.expectedPortalCode).toBe("1101");
    expect(byKey.get("pds_jenis")?.expectedPortalCode).toBe("1103");
    expect(byKey.get("pds_dutisetem")?.expectedPortalCode).toBe("1101");
    expect(byKey.get("pds_ps")?.expectedPortalCode).toBe("p");
    expect(byKey.get("pds_salinan")?.expectedPortalCode).toBe("1");
  });

  test("Phase 5 emits the post-ε-4c canonical codes for state/country/category/perabot/luasunit", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase5 = graph.phases.find(
      (p) => p.phaseId === "phase_5_bahagian_c_property"
    )!;
    const byKey = new Map(
      phase5.steps
        .filter((s) => s.selectorKey)
        .map((s) => [s.selectorKey as string, s])
    );
    expect(byKey.get("pds_harta_state")?.expectedPortalCode).toBe("14"); // Wilayah Persekutuan KL
    expect(byKey.get("pds_harta_country")?.expectedPortalCode).toBe("146"); // Malaysia
    expect(byKey.get("pds_harta_type")?.expectedPortalCode).toBe("1107"); // Kediaman
    expect(byKey.get("pds_harta_cat_kediaman")?.expectedPortalCode).toBe(
      "1114"
    ); // kondominium
    expect(byKey.get("pds_harta_perabot")?.expectedPortalCode).toBe("1122"); // fully_furnished
    expect(byKey.get("pds_luasunit")?.expectedPortalCode).toBe("4"); // mps
  });
});

// ─── Test 6 · Blocked input returns blocked result ─────────────────

describe("Builder · blocked-job behaviour", () => {
  test("missing storage path => blocked, no executable phases", () => {
    const job = buildReadyJob();
    job.storagePath = "";
    const graph = buildTenancyInstructionGraph({ job });

    expect(graph.verdict).toBe("blocked");
    expect(graph.blockingReasons.length).toBeGreaterThan(0);
    expect(graph.safeActionText).toBe(SAFE_ACTION_BLOCKED);

    // Skeleton retains nine phases for canonical ordering, but every
    // phase has zero steps and executionStatus = blocked.
    expect(graph.phases).toHaveLength(9);
    for (const phase of graph.phases) {
      expect(phase.executionStatus).toBe("blocked");
      expect(phase.steps).toHaveLength(0);
    }
  });

  test("missing required identity fields => blocked", () => {
    const job = buildReadyJob();
    delete job.tenancyPortalDetails!.parties[0].citizenshipCategory;
    const graph = buildTenancyInstructionGraph({ job });
    expect(graph.verdict).toBe("blocked");
    expect(graph.blockingReasons.length).toBeGreaterThan(0);
  });

  test("blocked result includes structured codes for portal field-mapping gaps", () => {
    const job = buildReadyJob();
    job.tenancyPortalDetails!.property!.furnishedStatus = "partially_furnished";
    const graph = buildTenancyInstructionGraph({ job });
    expect(graph.verdict).toBe("blocked");
    expect(
      graph.blockingReasons.some(
        (r) => r.code === "furnished_status_partially_furnished_unsupported"
      )
    ).toBe(true);
  });
});

// ─── Test 7 · Variable rent / amendment / multi-period blocked ────

describe("Builder · unsupported pds_jenis / multi-period", () => {
  const variants: { name: string; descType: TenancyPortalDescriptionType }[] = [
    {
      name: "variable_rent_during_tenancy (1104)",
      descType: "variable_rent_during_tenancy",
    },
    {
      name: "amendment_to_original_tenancy (1105)",
      descType: "amendment_to_original_tenancy",
    },
  ];
  test.each(variants)("$name remains blocked", ({ descType }) => {
    const job = buildReadyJob();
    job.tenancyPortalDetails!.instrument!.portalDescriptionType = descType;
    const graph = buildTenancyInstructionGraph({ job });
    expect(graph.verdict).toBe("blocked");
    expect(graph.phases.every((p) => p.steps.length === 0)).toBe(true);
  });

  test("multi-period rent schedule remains blocked", () => {
    const job = buildReadyJob();
    job.tenancyPortalDetails!.instrument!.rentSchedule = [
      {
        startDate: "2026-01-01",
        endDate: "2026-07-01",
        monthlyRent: 1000,
        durationMonths: 6,
      },
      {
        startDate: "2026-07-01",
        endDate: "2027-01-01",
        monthlyRent: 1200,
        durationMonths: 6,
      },
    ];
    const graph = buildTenancyInstructionGraph({ job });
    expect(graph.verdict).toBe("blocked");
    expect(graph.phases.every((p) => p.steps.length === 0)).toBe(true);
  });
});

// ─── Test 8 · No sensitive data leaks into the graph ───────────────

describe("Builder · sensitive-data invariant", () => {
  /**
   * Compiled expressions for forbidden patterns. Each pattern catches
   * a specific class of sensitive value:
   *   - 12-digit IC numbers (Malaysian NRIC: digits run, 12 long)
   *   - cookies / tokens / lhdnmsstoken substrings
   *   - raw URLs (http://, https://, /stamps/, /role_change)
   *   - raw href attributes
   *   - the literal identity numbers from the fixture
   */
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

  test("every step's serialized JSON is free of sensitive values", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const serialized = JSON.stringify(graph);
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(serialized)) {
        // Surface which pattern hit, with a small excerpt for diagnosis.
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden pattern \"${name}\" matched in graph JSON: ${m?.[0]}`
        );
      }
    }
  });

  test("every step description is free of sensitive values", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    for (const step of eachStep(graph)) {
      for (const { name, pattern } of FORBIDDEN) {
        expect(
          { name, description: step.description, hit: pattern.test(step.description) }
        ).toEqual({ name, description: step.description, hit: false });
      }
    }
  });

  test("selector keys never contain raw URL or href fragments", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    for (const step of eachStep(graph)) {
      if (typeof step.selectorKey === "string") {
        expect(step.selectorKey).not.toMatch(/https?:\/\//i);
        expect(step.selectorKey).not.toMatch(/^\/stamps\//);
        expect(step.selectorKey).not.toMatch(/href=/i);
      }
    }
  });
});

// ─── Test 9 · Mutation levels are correctly assigned ───────────────

describe("Builder · mutation-level assignments", () => {
  test("Phase 0 + Phase 1 are read-only end-to-end", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase0 = graph.phases[0];
    const phase1 = graph.phases[1];
    expect(phase0.steps.every((s) => s.mutationLevel === "read_only")).toBe(
      true
    );
    expect(phase1.steps.every((s) => s.mutationLevel === "read_only")).toBe(
      true
    );
  });

  test("Phase 2 highest mutation level is server_save", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase2 = graph.phases.find(
      (p) => p.phaseId === "phase_2_maklumat_am_draft"
    )!;
    expect(phase2.highestMutationLevel).toBe("server_save");
    expect(
      phase2.steps.some((s) => s.mutationLevel === "server_save")
    ).toBe(true);
  });

  test("Phase 3 includes both local_row_commit and server_save", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase3 = graph.phases.find(
      (p) => p.phaseId === "phase_3_bahagian_a_parties"
    )!;
    expect(
      phase3.steps.some((s) => s.mutationLevel === "local_row_commit")
    ).toBe(true);
    expect(
      phase3.steps.some((s) => s.mutationLevel === "server_save")
    ).toBe(true);
  });

  test("Phase 6 uses upload at its highest level", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase6 = graph.phases.find(
      (p) => p.phaseId === "phase_6_lampiran_upload"
    )!;
    expect(phase6.highestMutationLevel).toBe("upload");
    expect(phase6.steps.some((s) => s.mutationLevel === "upload")).toBe(true);
  });

  test("Phase 8 uses declaration AND final_submit", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase8 = graph.phases.find(
      (p) => p.phaseId === "phase_8_perakuan_hantar"
    )!;
    expect(phase8.highestMutationLevel).toBe("final_submit");
    expect(
      phase8.steps.some((s) => s.mutationLevel === "declaration")
    ).toBe(true);
    expect(
      phase8.steps.some((s) => s.mutationLevel === "final_submit")
    ).toBe(true);
  });
});

// ─── Test 10 · Final Hantar is gated separately ────────────────────

describe("Builder · final Hantar gate sequence", () => {
  test("Phase 8 has three operator gates (declaration / pre_hantar / final_hantar)", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase8 = graph.phases.find(
      (p) => p.phaseId === "phase_8_perakuan_hantar"
    )!;
    const gates = phase8.steps.filter((s) => s.stepType === "operator_gate");
    expect(gates).toHaveLength(3);
    const ids = gates.map((g) => g.stepId);
    expect(ids[0]).toContain("before_declaration");
    expect(ids[1]).toContain("before_pre_hantar");
    expect(ids[2]).toContain("before_final_hantar");
  });

  test("final Hantar is a final_submit step on pdsL01_button_hantar behind the third gate", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const phase8 = graph.phases.find(
      (p) => p.phaseId === "phase_8_perakuan_hantar"
    )!;
    const finalIndex = phase8.steps.findIndex(
      (s) =>
        s.stepType === "click_button" &&
        s.selectorKey === "pdsL01_button_hantar"
    );
    expect(finalIndex).toBeGreaterThan(-1);
    const finalStep = phase8.steps[finalIndex];
    expect(finalStep.mutationLevel).toBe("final_submit");
    // The third operator gate must precede the final Hantar step.
    const gateIndex = phase8.steps.findIndex(
      (s) =>
        s.stepType === "operator_gate" && s.stepId.includes("before_final_hantar")
    );
    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(finalIndex);
  });

  test("the only final_submit steps are the final two clicks of Phase 8", () => {
    const graph = buildTenancyInstructionGraph({ job: buildReadyJob() });
    const finalSubmitSteps = eachStep(graph).filter(
      (s) => s.mutationLevel === "final_submit"
    );
    // Modal-confirm + pdsL01_button_hantar.
    expect(finalSubmitSteps).toHaveLength(2);
    expect(finalSubmitSteps[finalSubmitSteps.length - 1].selectorKey).toBe(
      "pdsL01_button_hantar"
    );
  });
});

// ─── Test 11 · Adapter from full StampingJob ───────────────────────

describe("Adapter · buildTenancyInstructionGraphFromJob", () => {
  test("Forwards job fields and surfaces jobId on the graph", () => {
    const job = buildReadyJob();
    const graph = buildTenancyInstructionGraphFromJob({
      id: "job-fixture-1",
      ...job,
    });
    expect(graph.verdict).toBe("ready_for_supervised_run");
    expect(graph.jobId).toBe("job-fixture-1");
  });
});
