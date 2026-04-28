/**
 * WeStamp — Tenancy Portal Run Readiness · Field-Mapping Safety Blockers
 *
 * Tests the four field-mapping safety-blocker categories added by the
 * 2026-04-28 supervised-correction milestone:
 *   A) multi_pass_unsupported   — pds_jenis 1104/1105 + multi-period schedule
 *   B) land_registry_not_modelled — pds_mp / lot / mukim / daerah / luas / luasunit
 *   C) portal_enum_mismatch     — pds_salinan / state / country / harta_cat / furnished
 *   D) party_model_not_modelled — gender / 3-way citizenship / NRIC sub-type / SSM rep
 *
 * The tests deliberately use the smallest-possible input shape that
 * exercises each blocker. They do NOT verify the full text of every
 * reason — only the stable `code` per blocker, plus a small set of
 * spot-checks for category coverage and verdict.
 */

import {
  evaluateTenancyPortalFieldMappingGaps,
  evaluateTenancyPortalRunReadiness,
  groupTenancyPortalFieldMappingGaps,
  TENANCY_PORTAL_FIELD_MAPPING_GAPS_EXPLANATION,
  TENANCY_PORTAL_FIELD_MAPPING_GAPS_HEADER,
  type TenancyPortalFieldMappingGapCategory,
  type TenancyPortalRunReadinessJobInput,
} from "./tenancy-portal-run-readiness";
import type {
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalParty,
  TenancyPortalPropertyType,
} from "./stamping-types";

// ─── Helpers ──────────────────────────────────────────────────────

function makeIndividualLandlord(
  overrides: Partial<TenancyPortalParty> = {}
): TenancyPortalParty {
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
    ...overrides,
  };
}

function makeIndividualTenant(
  overrides: Partial<TenancyPortalParty> = {}
): TenancyPortalParty {
  return {
    role: "tenant",
    type: "individual",
    nameAsPerInstrument: "Test Tenant",
    nationality: "malaysian",
    identityType: "nric",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0129876543",
    ...overrides,
  };
}

function makeJob(
  details: Partial<TenancyPortalDetails> & {
    instrument?: TenancyPortalDetails["instrument"];
    property?: TenancyPortalDetails["property"];
  }
): TenancyPortalRunReadinessJobInput {
  const tpd: TenancyPortalDetails = {
    updatedAt: new Date().toISOString(),
    parties: details.parties ?? [
      makeIndividualLandlord(),
      makeIndividualTenant(),
    ],
    instrument: details.instrument,
    property: details.property,
  };
  return {
    tenancyPortalDetails: tpd,
    storagePath: "uploads/test/sample.pdf",
    originalFileName: "sample.pdf",
    mimeType: "application/pdf",
    documentCategory: "tenancy_agreement",
    stampingDetails: undefined,
  };
}

function gapCodes(
  job: TenancyPortalRunReadinessJobInput
): string[] {
  return evaluateTenancyPortalFieldMappingGaps(job).map((g) => g.code);
}

// ─── Category A: multi-pass unsupported ─────────────────────────

describe("Field-mapping gaps · A · multi-pass unsupported", () => {
  test("pds_jenis = variable_rent_during_tenancy (1104) is blocked", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "variable_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2026-06-30", monthlyRent: 1000 },
          { startDate: "2026-07-01", endDate: "2026-12-31", monthlyRent: 1200 },
        ],
      },
    });
    const codes = gapCodes(job);
    expect(codes).toContain("pds_jenis_1104_unsupported");
    expect(codes).toContain("rent_schedule_multiple_periods");
  });

  test("pds_jenis = amendment_to_original_tenancy (1105) is blocked", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "amendment_to_original_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    const codes = gapCodes(job);
    expect(codes).toContain("pds_jenis_1105_unsupported");
  });

  test("multi-period rent schedule is blocked even with fixed-rent description", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2026-06-30", monthlyRent: 1000 },
          { startDate: "2026-07-01", endDate: "2026-12-31", monthlyRent: 1000 },
        ],
      },
    });
    const codes = gapCodes(job);
    expect(codes).toContain("rent_schedule_multiple_periods");
  });
});

// ─── Category B: land-registry not modelled ─────────────────────

describe("Field-mapping gaps · B · land registry", () => {
  test("All six land-registry codes fire when property block is captured", () => {
    const job = makeJob({
      property: {
        addressLine1: "Unit 1, Test Street",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "kondominium" as TenancyPortalBuildingType,
        premisesAreaSqm: 100,
      },
    });
    const codes = gapCodes(job);
    expect(codes).toEqual(
      expect.arrayContaining([
        "pds_mp_milik_penuh_not_modelled",
        "pds_lot_not_modelled",
        "pds_mukim_not_modelled",
        "pds_daerah_not_modelled",
        "pds_luas_not_modelled",
        "pds_luasunit_not_modelled",
      ])
    );
  });

  test("Land-registry blockers do NOT fire when property block is absent", () => {
    const job = makeJob({});
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_lot_not_modelled");
  });
});

// ─── Category C: portal enum mismatch ───────────────────────────

describe("Field-mapping gaps · C · portal enum mismatch", () => {
  test("pds_salinan canonical-mapping blocker fires when instrument is captured", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 2,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    expect(gapCodes(job)).toContain("pds_salinan_no_canonical_mapping");
  });

  test("pds_harta_state and pds_harta_country blockers fire when property is captured", () => {
    const job = makeJob({
      property: {
        addressLine1: "Unit 1, Test Street",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "kondominium" as TenancyPortalBuildingType,
        premisesAreaSqm: 100,
      },
    });
    const codes = gapCodes(job);
    expect(codes).toContain("pds_harta_state_no_canonical_mapping");
    expect(codes).toContain("pds_harta_country_no_canonical_mapping");
  });

  test("perdagangan / perindustrian property types are flagged as unsupported", () => {
    const job = makeJob({
      property: {
        addressLine1: "Lot A",
        postcode: "12345",
        city: "Petaling Jaya",
        state: "Selangor",
        country: "Malaysia",
        propertyType: "perdagangan" as TenancyPortalPropertyType,
        premisesAreaSqm: 500,
      },
    });
    expect(gapCodes(job)).toContain(
      "pds_harta_cat_propertyType_unsupported"
    );
  });

  test("kediaman + studio is blocked (no portal equivalent)", () => {
    const job = makeJob({
      property: {
        addressLine1: "Studio 5",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "studio" as TenancyPortalBuildingType,
        premisesAreaSqm: 30,
      },
    });
    expect(gapCodes(job)).toContain(
      "building_type_studio_no_portal_equivalent"
    );
  });

  test("kediaman + lain_lain is blocked", () => {
    const job = makeJob({
      property: {
        addressLine1: "Other 5",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "lain_lain" as TenancyPortalBuildingType,
        premisesAreaSqm: 30,
      },
    });
    expect(gapCodes(job)).toContain(
      "building_type_lain_lain_no_portal_equivalent"
    );
  });

  test("kediaman + apartment is blocked (ambiguous mapping)", () => {
    const job = makeJob({
      property: {
        addressLine1: "Apt 5",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "apartment" as TenancyPortalBuildingType,
        premisesAreaSqm: 60,
      },
    });
    expect(gapCodes(job)).toContain(
      "building_type_apartment_no_portal_equivalent"
    );
  });

  test("partially_furnished is blocked (no portal equivalent)", () => {
    const job = makeJob({
      property: {
        addressLine1: "Unit 1",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "kondominium" as TenancyPortalBuildingType,
        furnishedStatus: "partially_furnished" as TenancyPortalFurnishedStatus,
        premisesAreaSqm: 60,
      },
    });
    expect(gapCodes(job)).toContain(
      "furnished_status_partially_furnished_unsupported"
    );
  });
});

// ─── Category D: party model not modelled ───────────────────────

describe("Field-mapping gaps · D · party model not modelled", () => {
  test("Every party gets a gender + citizenship-3way blocker", () => {
    const job = makeJob({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
    });
    const codes = gapCodes(job);
    expect(codes).toContain("party_0_gender_not_modelled");
    expect(codes).toContain("party_1_gender_not_modelled");
    expect(codes).toContain("party_0_citizenship_3way_not_modelled");
    expect(codes).toContain("party_1_citizenship_3way_not_modelled");
  });

  test("NRIC sub-type blocker fires only on NRIC-using individuals", () => {
    const job = makeJob({
      parties: [
        makeIndividualLandlord({ identityType: "nric" }),
        makeIndividualTenant({
          identityType: "passport",
          nationality: "non_malaysian",
          identityNumber: "P1234567",
        }),
      ],
    });
    const codes = gapCodes(job);
    expect(codes).toContain("party_0_nric_subtype_not_modelled");
    expect(codes).not.toContain("party_1_nric_subtype_not_modelled");
  });

  test("SSM rep-identity blocker fires only on company_ssm parties", () => {
    const job = makeJob({
      parties: [
        {
          ...makeIndividualLandlord(),
          type: "company_ssm",
          identityType: "company_registration",
          identityNumber: "201901000001",
          nationality: undefined,
        },
        makeIndividualTenant(),
      ],
    });
    const codes = gapCodes(job);
    expect(codes).toContain("party_0_ssm_rep_identity_not_modelled");
    expect(codes).not.toContain("party_1_ssm_rep_identity_not_modelled");
  });

  test("SSM rep-identity blocker does NOT fire on company_non_ssm parties", () => {
    const job = makeJob({
      parties: [
        {
          ...makeIndividualLandlord(),
          type: "company_non_ssm",
          identityType: "company_registration",
          identityNumber: "BR-12345",
          nationality: undefined,
        },
        makeIndividualTenant(),
      ],
    });
    const codes = gapCodes(job);
    expect(codes).not.toContain("party_0_ssm_rep_identity_not_modelled");
  });
});

// ─── End-to-end: verdict + report shape ─────────────────────────

describe("evaluateTenancyPortalRunReadiness · field-mapping integration", () => {
  test("Verdict is `blocked` whenever any field-mapping gap exists", () => {
    const job = makeJob({});
    const report = evaluateTenancyPortalRunReadiness(job);
    // At minimum the per-party D-category blockers fire on every job
    // that has parties — guaranteed by makeJob default.
    expect(report.portalFieldMappingGaps.length).toBeGreaterThan(0);
    expect(report.verdict).toBe("blocked");
  });

  test("Field-mapping gaps are also added to the top-level blockingReasons", () => {
    const job = makeJob({});
    const report = evaluateTenancyPortalRunReadiness(job);
    const firstGapReason = report.portalFieldMappingGaps[0]?.reason;
    expect(firstGapReason).toBeDefined();
    expect(report.blockingReasons).toContain(firstGapReason);
  });

  test("Recommended-action wording mentions the field-mapping gaps when they exist", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "amendment_to_original_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    const report = evaluateTenancyPortalRunReadiness(job);
    expect(report.nextRecommendedAction.toLowerCase()).toMatch(
      /multi-pass|do not run|field-mapping gaps/
    );
  });

  test("UI wording constants match the approved phrasing", () => {
    expect(TENANCY_PORTAL_FIELD_MAPPING_GAPS_HEADER).toBe(
      "Portal field mapping gaps discovered"
    );
    expect(TENANCY_PORTAL_FIELD_MAPPING_GAPS_EXPLANATION).toContain(
      "must not proceed to live portal execution"
    );
  });

  test("groupTenancyPortalFieldMappingGaps preserves canonical category order", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "variable_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2026-06-30", monthlyRent: 1000 },
          { startDate: "2026-07-01", endDate: "2026-12-31", monthlyRent: 1200 },
        ],
      },
      property: {
        addressLine1: "Unit 1",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "studio" as TenancyPortalBuildingType,
        premisesAreaSqm: 30,
      },
    });
    const report = evaluateTenancyPortalRunReadiness(job);
    const grouped = groupTenancyPortalFieldMappingGaps(
      report.portalFieldMappingGaps
    );
    const cats = grouped.map((g) => g.category);
    // Canonical order: multi_pass · land_registry · enum_mismatch · party_model
    const expected: TenancyPortalFieldMappingGapCategory[] = [
      "multi_pass_unsupported",
      "land_registry_not_modelled",
      "portal_enum_mismatch",
      "party_model_not_modelled",
    ];
    // Filter expected to those actually present (some may be missing
    // depending on inputs), then check order.
    const expectedPresent = expected.filter((c) => cats.includes(c));
    expect(cats).toEqual(expectedPresent);
  });
});
