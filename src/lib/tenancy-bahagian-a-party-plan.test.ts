/**
 * WeStamp — Tenancy Bahagian A Party Entry Plan · tests
 *
 * Covers Milestone B8 Part 1.
 */

import {
  buildTenancyBahagianAPartyPlan,
  summarizeTenancyBahagianAPartyPlan,
  type TenancyBahagianAPartyPlan,
} from "./tenancy-bahagian-a-party-plan";
import type {
  StampingJob,
  TenancyPortalCompanyRepresentative,
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

function companyRep(): TenancyPortalCompanyRepresentative {
  return {
    ownerName: "Test Owner",
    citizenshipCategory: "citizen",
    identityType: "nric",
    identityNumber: "900101015555",
    nricSubType: "ic_baru",
    gender: "male",
  };
}

function ssmCompanyLandlord(): TenancyPortalParty {
  return {
    role: "landlord",
    type: "company_ssm",
    nameAsPerInstrument: "Test Sdn Bhd",
    rocOld: "123456-A",
    rocNew: "202301012345",
    businessType: { code: "1", label: "Perniagaan" },
    companyLocality: "local_company",
    companyRepresentative: companyRep(),
    addressLine1: "1 Corporate Lane",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0312345678",
  };
}

function buildJob(parties: TenancyPortalParty[]): StampingJob {
  return {
    id: "job-b8-test",
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

describe("Bahagian A · party plan · individual landlord/tenant", () => {
  test("complete individual landlord + tenant → ready_for_modal_mapping", () => {
    const job = buildJob([landlord(), tenant()]);
    const plan = buildTenancyBahagianAPartyPlan(job);
    expect(plan.lane).toBe("sewa_pajakan");
    expect(plan.phase).toBe("phase_3_bahagian_a_parties");
    expect(plan.expectedPartyCount).toBe(2);
    expect(plan.landlordCount).toBe(1);
    expect(plan.tenantCount).toBe(1);
    expect(plan.overallStatus).toBe("ready_for_modal_mapping");
    expect(plan.blockers).toEqual([]);
    expect(plan.parties).toHaveLength(2);
    expect(plan.parties[0].planStatus).toBe("ready_for_modal_mapping");
    expect(plan.parties[1].planStatus).toBe("ready_for_modal_mapping");
    expect(plan.parties[0].missingInternalFields).toEqual([]);
    expect(plan.parties[1].missingInternalFields).toEqual([]);
  });

  test("plan carries jobId verbatim", () => {
    const job = buildJob([landlord()]);
    const plan = buildTenancyBahagianAPartyPlan(job);
    expect(plan.jobId).toBe("job-b8-test");
  });

  test("partyName surfaces for operator UI but identityNumberPresent is just a bool", () => {
    const job = buildJob([landlord()]);
    const plan = buildTenancyBahagianAPartyPlan(job);
    expect(plan.parties[0].partyName).toBe("Test Landlord");
    expect(plan.parties[0].identityNumberPresent).toBe(true);
  });

  test("missing gender blocks the plan", () => {
    const ll = landlord();
    delete ll.gender;
    const plan = buildTenancyBahagianAPartyPlan(buildJob([ll]));
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.parties[0].missingInternalFields).toContain("gender");
    expect(plan.parties[0].planStatus).toBe("blocked_missing_party_data");
    expect(plan.blockers.length).toBeGreaterThan(0);
  });

  test("missing citizenshipCategory blocks the plan", () => {
    const ll = landlord();
    delete ll.citizenshipCategory;
    const plan = buildTenancyBahagianAPartyPlan(buildJob([ll]));
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.parties[0].missingInternalFields).toContain(
      "citizenshipCategory"
    );
  });

  test("missing nricSubType blocks the plan when identityType=nric", () => {
    const ll = landlord();
    delete ll.nricSubType;
    const plan = buildTenancyBahagianAPartyPlan(buildJob([ll]));
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.parties[0].missingInternalFields).toContain("nricSubType");
  });

  test("nricSubType is NOT required when identityType=passport", () => {
    const ll = landlord();
    ll.identityType = "passport";
    delete ll.nricSubType;
    const plan = buildTenancyBahagianAPartyPlan(buildJob([ll]));
    expect(plan.parties[0].missingInternalFields).not.toContain("nricSubType");
  });
});

describe("Bahagian A · party plan · SSM company representative", () => {
  test("complete SSM company → ready_for_modal_mapping", () => {
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([ssmCompanyLandlord(), tenant()])
    );
    expect(plan.overallStatus).toBe("ready_for_modal_mapping");
    expect(plan.parties[0].type).toBe("company_ssm");
    expect(plan.parties[0].planStatus).toBe("ready_for_modal_mapping");
  });

  test("SSM missing representative identity blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.companyRepresentative!.identityNumber;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.parties[0].missingInternalFields).toContain(
      "companyRepresentative.identityNumber"
    );
  });

  test("SSM missing representative citizenshipCategory blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.companyRepresentative!.citizenshipCategory;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).toContain(
      "companyRepresentative.citizenshipCategory"
    );
  });

  test("SSM missing representative gender blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.companyRepresentative!.gender;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).toContain(
      "companyRepresentative.gender"
    );
  });

  test("SSM with NEITHER rocOld nor rocNew blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.rocOld;
    delete company.rocNew;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).toContain("rocOldOrNew");
  });

  test("SSM with rocNew only is sufficient", () => {
    const company = ssmCompanyLandlord();
    delete company.rocOld;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).not.toContain("rocOldOrNew");
    expect(plan.overallStatus).toBe("ready_for_modal_mapping");
  });

  test("SSM with rocOld only is sufficient", () => {
    const company = ssmCompanyLandlord();
    delete company.rocNew;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).not.toContain("rocOldOrNew");
  });

  test("SSM missing businessType blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.businessType;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).toContain("businessType");
  });

  test("SSM missing companyLocality blocks the plan", () => {
    const company = ssmCompanyLandlord();
    delete company.companyLocality;
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([company, tenant()])
    );
    expect(plan.parties[0].missingInternalFields).toContain("companyLocality");
  });
});

describe("Bahagian A · party plan · unsupported party types", () => {
  test("company_non_ssm party is marked unsupported", () => {
    const nonSsm: TenancyPortalParty = {
      role: "landlord",
      type: "company_non_ssm",
      nameAsPerInstrument: "Test Foundation",
      addressLine1: "1 Foundation Lane",
      postcode: "50000",
      city: "Kuala Lumpur",
      state: "Kuala Lumpur",
      country: "Malaysia",
      mobile: "0312345678",
    };
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([nonSsm, tenant()])
    );
    expect(plan.overallStatus).toBe("unsupported_party_type");
    expect(plan.parties[0].planStatus).toBe("unsupported_party_type");
    expect(plan.parties[0].blockers.length).toBeGreaterThan(0);
  });
});

describe("Bahagian A · party plan · row-count expectations", () => {
  test("expectedRowCountAfter is the cumulative ordinal", () => {
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([landlord(), tenant(), tenant()])
    );
    expect(plan.parties[0].expectedRowCountAfter).toBe(1);
    expect(plan.parties[1].expectedRowCountAfter).toBe(2);
    expect(plan.parties[2].expectedRowCountAfter).toBe(3);
  });

  test("ordinals are 1-based and unique", () => {
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([landlord(), tenant()])
    );
    expect(plan.parties.map((p) => p.ordinal)).toEqual([1, 2]);
  });
});

describe("Bahagian A · party plan · empty job", () => {
  test("zero parties → blocked_missing_party_data", () => {
    const plan = buildTenancyBahagianAPartyPlan(buildJob([]));
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.expectedPartyCount).toBe(0);
    expect(plan.landlordCount).toBe(0);
    expect(plan.tenantCount).toBe(0);
    expect(plan.parties).toEqual([]);
    expect(plan.blockers.length).toBeGreaterThan(0);
  });

  test("missing tenancyPortalDetails → blocked_missing_party_data", () => {
    const job = buildJob([landlord()]);
    delete job.tenancyPortalDetails;
    const plan = buildTenancyBahagianAPartyPlan(job);
    expect(plan.overallStatus).toBe("blocked_missing_party_data");
    expect(plan.expectedPartyCount).toBe(0);
  });
});

describe("Bahagian A · party plan · plan does not imply saved rows", () => {
  test("the plan structure has no field that could be misread as 'saved'", () => {
    const plan: TenancyBahagianAPartyPlan = buildTenancyBahagianAPartyPlan(
      buildJob([landlord(), tenant()])
    );
    const serialised = JSON.stringify(plan);
    // Deliberately strict: must not contain any verb that implies
    // a portal row has already been committed.
    expect(serialised).not.toMatch(/\bsaved\b/i);
    expect(serialised).not.toMatch(/\bsubmitted\b/i);
    expect(serialised).not.toMatch(/\bcommitted\b/i);
    expect(serialised).not.toMatch(/\bcompleted\b/i);
    expect(serialised).not.toMatch(/\bHantar\b/i);
    expect(serialised).not.toMatch(/\bpaid\b/i);
  });
});

describe("Bahagian A · party plan · summary", () => {
  test("summary lines are concise and contain stable enums", () => {
    const plan = buildTenancyBahagianAPartyPlan(
      buildJob([landlord(), tenant()])
    );
    const lines = summarizeTenancyBahagianAPartyPlan(plan);
    expect(lines[0]).toContain("Job job-b8-test");
    expect(lines[0]).toContain("2 parties");
    expect(lines[0]).toContain("(1L · 1T)");
    expect(lines[0]).toContain("overall=ready_for_modal_mapping");
    expect(lines).toHaveLength(3); // header + 2 parties
    expect(lines[1]).toContain("#1 landlord/individual");
    expect(lines[1]).toContain("row-after=1");
    expect(lines[2]).toContain("#2 tenant/individual");
    expect(lines[2]).toContain("row-after=2");
  });
});
