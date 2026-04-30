/**
 * WeStamp — Tenancy Bahagian A Executor Draft · tests
 *
 * Covers Milestone B9 Part C + relevant Part E requirements.
 */

import {
  BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING,
  BAHAGIAN_A_MODAL_CLOSE_SELECTOR,
  BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9,
  BAHAGIAN_A_MODAL_TRIGGERS,
  BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS,
  buildBahagianAExecutorDraftBundle,
  buildBahagianAExecutorDraftPlan,
  type BahagianAExecutorDraftPlan,
} from "./tenancy-bahagian-a-executor-draft";
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

function buildJob(parties: TenancyPortalParty[]): StampingJob {
  return {
    id: "job-b9-test",
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
      parties,
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
      },
      maklumatAm: {
        dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
        instrumentRelationship: "principal",
      },
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Bahagian A · executor draft · plan structure", () => {
  test("complete landlord party → plan emits planned steps and ends without saving", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]), {
      role: "landlord",
    });
    expect(plan.role).toBe("landlord");
    expect(plan.partyType).toBe("individual");
    expect(plan.endsWithoutSaving).toBe(true);
    expect(plan.warning).toBe(BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING);
    // Plan ends with a `close_modal_without_saving` step.
    expect(plan.steps[plan.steps.length - 1].kind).toBe(
      "close_modal_without_saving"
    );
  });

  test("plan starts with navigate_to_bahagian_a_tab then open_party_modal", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    expect(plan.steps[0].kind).toBe("navigate_to_bahagian_a_tab");
    expect(plan.steps[1].kind).toBe("open_party_modal");
  });

  test("plan includes a planned_save step that is permanently planned_only", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const savedStep = plan.steps.find((s) => s.kind === "planned_save");
    expect(savedStep).toBeDefined();
    expect(savedStep!.executableState).toBe("planned_only");
    expect(savedStep!.selector).toBe(
      BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9
    );
  });

  test("plan includes a verify_row_count_after_save step that is permanently planned_only", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const verifyStep = plan.steps.find(
      (s) => s.kind === "verify_row_count_after_save"
    );
    expect(verifyStep).toBeDefined();
    expect(verifyStep!.executableState).toBe("planned_only");
  });

  test("close-without-saving step uses the bootbox close button selector", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const closeStep = plan.steps.find(
      (s) => s.kind === "close_modal_without_saving"
    );
    expect(closeStep).toBeDefined();
    expect(closeStep!.selector).toBe(BAHAGIAN_A_MODAL_CLOSE_SELECTOR);
  });
});

describe("Bahagian A · executor draft · field-by-field steps", () => {
  test("complete landlord party produces ready_for_next_execution_milestone status", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    expect(plan.status).toBe("ready_for_next_execution_milestone");
  });

  test("citizenshipCategory step writes select#warga with the live B9 portal code", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const step = plan.steps.find(
      (s) => s.internalKey === "citizenshipCategory"
    );
    expect(step).toBeDefined();
    expect(step!.kind).toBe("select_value");
    expect(step!.selector).toBe("select#warga");
    expect(step!.portalCode).toBe("1"); // citizen
  });

  test("nricSubType step writes the EPD_NOKP_TYPE radio group with portal id `IC_BARU`", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const step = plan.steps.find((s) => s.internalKey === "nricSubType");
    expect(step).toBeDefined();
    expect(step!.kind).toBe("pick_radio");
    expect(step!.selector).toBe('input[name="EPD_NOKP_TYPE"]');
    expect(step!.portalCode).toBe("IC_BARU");
  });

  test("gender step writes the USER_SEX radio with portal id `USER_SEX-1` for male", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const step = plan.steps.find((s) => s.internalKey === "gender");
    expect(step).toBeDefined();
    expect(step!.portalCode).toBe("USER_SEX-1");
  });

  test("gender step writes USER_SEX-2 for female (tenant)", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([tenant()]), {
      role: "tenant",
    });
    const step = plan.steps.find((s) => s.internalKey === "gender");
    expect(step!.portalCode).toBe("USER_SEX-2");
  });

  test("nameAsPerInstrument step writes input#tb_nama with the captured name (operator-only debug)", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const step = plan.steps.find(
      (s) => s.internalKey === "nameAsPerInstrument"
    );
    expect(step!.kind).toBe("fill_text");
    expect(step!.selector).toBe("input#tb_nama");
    expect(step!.plannedValue).toBe("Test Landlord");
  });

  test("missing gender → that step is blocked_missing_party_data", () => {
    const ll = landlord();
    delete ll.gender;
    const plan = buildBahagianAExecutorDraftPlan(buildJob([ll]));
    const step = plan.steps.find((s) => s.internalKey === "gender");
    expect(step!.executableState).toBe("blocked_missing_party_data");
    expect(step!.missingPartyFields).toEqual(["gender"]);
    expect(plan.status).toBe("blocked_missing_party_data");
  });

  test("missing identityNumber → that step is blocked_missing_party_data", () => {
    const ll = landlord();
    delete ll.identityNumber;
    const plan = buildBahagianAExecutorDraftPlan(buildJob([ll]));
    const step = plan.steps.find((s) => s.internalKey === "identityNumber");
    expect(step!.executableState).toBe("blocked_missing_party_data");
    expect(plan.status).toBe("blocked_missing_party_data");
  });

  test("no party for the requested role → plan has a verify-step block", () => {
    // Only landlord captured; ask for tenant plan.
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]), {
      role: "tenant",
    });
    expect(plan.status).toBe("blocked_missing_party_data");
    const block = plan.steps.find(
      (s) =>
        s.kind === "verify_required_modal_field_present" &&
        s.executableState === "blocked_missing_party_data"
    );
    expect(block).toBeDefined();
  });
});

describe("Bahagian A · executor draft · landlord vs tenant distinction", () => {
  test("landlord plan uses the landlord trigger anchor", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord(), tenant()]), {
      role: "landlord",
    });
    expect(plan.trigger.role).toBe("landlord");
    expect(plan.trigger.partyType).toBe("individual");
    expect(plan.trigger.textObserved).toBe("Individu");
    expect(plan.trigger.certainty).toBe("observed");
  });

  test("tenant plan uses the tenant trigger anchor", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord(), tenant()]), {
      role: "tenant",
    });
    expect(plan.trigger.role).toBe("tenant");
    expect(plan.trigger.partyType).toBe("individual");
    expect(plan.trigger.certainty).toBe("observed");
  });

  test("modal title differs between landlord and tenant (live B9 evidence)", () => {
    const landPlan = buildBahagianAExecutorDraftPlan(
      buildJob([landlord(), tenant()]),
      { role: "landlord" }
    );
    const tenPlan = buildBahagianAExecutorDraftPlan(
      buildJob([landlord(), tenant()]),
      { role: "tenant" }
    );
    expect(landPlan.modalTitleObserved).toContain("Landlord");
    expect(tenPlan.modalTitleObserved).toContain("Tenant");
    expect(landPlan.modalTitleObserved).not.toBe(tenPlan.modalTitleObserved);
  });
});

describe("Bahagian A · executor draft · bundle helper", () => {
  test("bundle returns both landlord + tenant plans", () => {
    const bundle = buildBahagianAExecutorDraftBundle(
      buildJob([landlord(), tenant()])
    );
    expect(bundle.landlord.role).toBe("landlord");
    expect(bundle.tenant.role).toBe("tenant");
    expect(bundle.bundleStatus).toBe("ready_for_next_execution_milestone");
  });

  test("bundle escalates to blocked when one role is incomplete", () => {
    const ll = landlord();
    delete ll.identityNumber;
    const bundle = buildBahagianAExecutorDraftBundle(buildJob([ll, tenant()]));
    expect(bundle.bundleStatus).toBe("blocked_missing_party_data");
  });

  test("partyPlanOverallStatus comes from the existing party plan helper", () => {
    const bundle = buildBahagianAExecutorDraftBundle(
      buildJob([landlord(), tenant()])
    );
    expect(bundle.partyPlanOverallStatus).toBe("ready_for_modal_mapping");
  });
});

describe("Bahagian A · executor draft · save boundary (B9 strict)", () => {
  test("the planned_save step's selector matches the documented constant", () => {
    expect(BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9).toBe(
      "input.btn"
    );
  });

  test("no test path invokes a click on the modal save selector", () => {
    // Static assertion: the planned_save step exists in the plan
    // but its `executableState` is `planned_only` — meaning even
    // a hypothetical executor that walked steps would skip it. We
    // also verify the step's selector matches the no-click constant.
    const plan: BahagianAExecutorDraftPlan = buildBahagianAExecutorDraftPlan(
      buildJob([landlord()])
    );
    const saveStep = plan.steps.find((s) => s.kind === "planned_save");
    expect(saveStep!.executableState).toBe("planned_only");
    expect(saveStep!.selector).toBe(
      BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9
    );
    // The aggregate plan status NEVER becomes `planned_only` —
    // that label is reserved for the single save step.
    expect(plan.status).not.toBe("planned_only");
  });

  test("warning string explicitly disclaims execution", () => {
    expect(BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING).toMatch(
      /never clicked/i
    );
    expect(BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING).toMatch(/planned_only/);
  });

  test("plan serialization does not contain saved-row implications", () => {
    const plan = buildBahagianAExecutorDraftPlan(buildJob([landlord()]));
    const serialised = JSON.stringify(plan);
    // Allow `planned_save` (step kind, deliberate) but reject any
    // verb implying the save HAS happened.
    expect(serialised).not.toMatch(/\bsaved\b/i);
    expect(serialised).not.toMatch(/\bsubmitted\b/i);
    expect(serialised).not.toMatch(/\bcommitted\b/i);
    expect(serialised).not.toMatch(/\bHantar\b/i);
    expect(serialised).not.toMatch(/\bpaid\b/i);
    expect(serialised).not.toMatch(/certificate retrieved/i);
  });
});

describe("Bahagian A · executor draft · trigger registry", () => {
  test("six triggers exist (2 roles × 3 party types)", () => {
    expect(BAHAGIAN_A_MODAL_TRIGGERS).toHaveLength(6);
    const pairs = new Set(
      BAHAGIAN_A_MODAL_TRIGGERS.map((t) => `${t.role}/${t.partyType}`)
    );
    expect(pairs.size).toBe(6);
    expect(pairs.has("landlord/individual")).toBe(true);
    expect(pairs.has("landlord/company_ssm")).toBe(true);
    expect(pairs.has("landlord/company_non_ssm")).toBe(true);
    expect(pairs.has("tenant/individual")).toBe(true);
    expect(pairs.has("tenant/company_ssm")).toBe(true);
    expect(pairs.has("tenant/company_non_ssm")).toBe(true);
  });

  test("every trigger has certainty=`observed` after the B9 capture", () => {
    for (const t of BAHAGIAN_A_MODAL_TRIGGERS) {
      expect(t.certainty).toBe("observed");
    }
  });

  test("triggers carry a text-scoped resolution algorithm (anchors lack id/class)", () => {
    for (const t of BAHAGIAN_A_MODAL_TRIGGERS) {
      expect(t.selectorAlgorithm.length).toBeGreaterThan(0);
      // Algorithm references `fieldset` AND a heading regex —
      // anchors are role-scoped by walking up to the role fieldset
      // first.
      expect(t.selectorAlgorithm).toMatch(/fieldset/i);
    }
  });
});

describe("Bahagian A · observed-but-unmapped fields registry", () => {
  test("DSD_APPLY_DATE (date of birth) is documented", () => {
    const dob = BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS.find(
      (f) => f.portalFieldKey === "DSD_APPLY_DATE"
    );
    expect(dob).toBeDefined();
    expect(dob!.selector).toBe("input#DSD_APPLY_DATE");
    expect(dob!.reason).toMatch(/Date of birth/i);
  });

  test("passport / negara1 / tb_alamat_3 / tb_email are also documented", () => {
    const keys = BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS.map(
      (f) => f.portalFieldKey
    );
    expect(keys).toContain("passportin");
    expect(keys).toContain("negara1");
    expect(keys).toContain("tb_alamat_3");
    expect(keys).toContain("tb_email");
  });

  test("each unmapped field carries a non-empty reason explaining the gap", () => {
    for (const f of BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS) {
      expect(f.selector.length).toBeGreaterThan(0);
      expect(f.reason.length).toBeGreaterThan(0);
    }
  });
});
