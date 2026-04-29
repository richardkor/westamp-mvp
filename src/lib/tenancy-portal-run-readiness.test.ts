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
import { compileTenancyPortalPayload } from "./tenancy-portal-payload";
import { validateTenancyPortalDetailsInput } from "./tenancy-portal-requirements";
import type {
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalLandRegistry,
  TenancyPortalParty,
  TenancyPortalProperty,
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
  test("pds_salinan blocker LIFTED for any 0..20 (post ε-4c)", () => {
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
    expect(gapCodes(job)).not.toContain("pds_salinan_no_canonical_mapping");
  });

  test("pds_salinan blocker still fires for counts > 20 (out of dropdown range)", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 25,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    expect(gapCodes(job)).toContain("pds_salinan_no_canonical_mapping");
  });

  test("pds_harta_state and pds_harta_country blockers LIFTED for seeded values (post ε-4c)", () => {
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
    expect(codes).not.toContain("pds_harta_state_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_country_no_canonical_mapping");
  });

  test("pds_harta_state blocker still fires for unseeded states (post ε-4c)", () => {
    const job = makeJob({
      property: {
        addressLine1: "Unit 1, Test Street",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Atlantis",
        country: "Malaysia",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "kondominium" as TenancyPortalBuildingType,
        premisesAreaSqm: 100,
      },
    });
    expect(gapCodes(job)).toContain("pds_harta_state_no_canonical_mapping");
  });

  test("pds_harta_country blocker still fires for non-Malaysia countries (post ε-4c)", () => {
    const job = makeJob({
      property: {
        addressLine1: "Unit 1, Test Street",
        postcode: "50000",
        city: "Singapore",
        state: "Singapore",
        country: "Singapore",
        propertyType: "kediaman" as TenancyPortalPropertyType,
        buildingType: "kondominium" as TenancyPortalBuildingType,
        premisesAreaSqm: 100,
      },
    });
    expect(gapCodes(job)).toContain("pds_harta_country_no_canonical_mapping");
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
    // Canonical order: multi_pass · land_registry · maklumat_am ·
    // enum_mismatch · party_model.
    const expected: TenancyPortalFieldMappingGapCategory[] = [
      "multi_pass_unsupported",
      "land_registry_not_modelled",
      "maklumat_am_not_captured",
      "portal_enum_mismatch",
      "party_model_not_modelled",
    ];
    // Filter expected to those actually present (some may be missing
    // depending on inputs), then check order.
    const expectedPresent = expected.filter((c) => cats.includes(c));
    expect(cats).toEqual(expectedPresent);
  });
});

// ─── Milestone A1 · Bahagian C land-registry coverage ────────────────

/**
 * Helper — a complete, valid `landRegistry` sub-object the
 * milestone's per-field blockers should accept. Lives at the
 * top of the suite section so per-test variants can spread it and
 * override the one field under test.
 */
const COMPLETE_LAND_REGISTRY: TenancyPortalLandRegistry = {
  milikPenuh: "Milik Penuh sample",
  lot: "12345",
  mukim: "Petaling",
  daerah: "Kuala Lumpur",
  luas: 250,
  luasUnit: "mps",
};

/**
 * Helper — a valid `property` block with `landRegistry`. Built on
 * the existing `makeJob` shape so other unrelated blockers
 * (state/country canonical mapping, etc.) remain stable across the
 * land-registry tests.
 */
function propertyWithLandRegistry(
  landRegistryOverrides: Partial<TenancyPortalLandRegistry> | null = {}
): TenancyPortalProperty {
  const property: TenancyPortalProperty = {
    addressLine1: "Unit 1, Test Street",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    propertyType: "kediaman" as TenancyPortalPropertyType,
    buildingType: "kondominium" as TenancyPortalBuildingType,
    premisesAreaSqm: 100,
  };
  if (landRegistryOverrides !== null) {
    property.landRegistry = {
      ...COMPLETE_LAND_REGISTRY,
      ...landRegistryOverrides,
    };
  }
  return property;
}

describe("Milestone A1 · Bahagian C land-registry · readiness blockers", () => {
  test("Property block with NO landRegistry triggers all six per-field blockers", () => {
    const job = makeJob({ property: propertyWithLandRegistry(null) });
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

  test("All six land-registry blockers are LIFTED when every required field is captured and valid", () => {
    const job = makeJob({ property: propertyWithLandRegistry({}) });
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_mp_milik_penuh_not_modelled");
    expect(codes).not.toContain("pds_lot_not_modelled");
    expect(codes).not.toContain("pds_mukim_not_modelled");
    expect(codes).not.toContain("pds_daerah_not_modelled");
    expect(codes).not.toContain("pds_luas_not_modelled");
    expect(codes).not.toContain("pds_luasunit_not_modelled");
  });

  test.each([
    ["milikPenuh", "pds_mp_milik_penuh_not_modelled"],
    ["lot", "pds_lot_not_modelled"],
    ["mukim", "pds_mukim_not_modelled"],
    ["daerah", "pds_daerah_not_modelled"],
  ] as const)(
    "Blank %s field still fires %s",
    (fieldKey, expectedCode) => {
      const job = makeJob({
        property: propertyWithLandRegistry({ [fieldKey]: "" }),
      });
      expect(gapCodes(job)).toContain(expectedCode);
    }
  );

  test("Whitespace-only milikPenuh still fires the blocker", () => {
    const job = makeJob({
      property: propertyWithLandRegistry({ milikPenuh: "   " }),
    });
    expect(gapCodes(job)).toContain("pds_mp_milik_penuh_not_modelled");
  });

  test("Negative or zero pds_luas still fires the luas blocker", () => {
    const jobZero = makeJob({
      property: propertyWithLandRegistry({ luas: 0 }),
    });
    const jobNegative = makeJob({
      property: propertyWithLandRegistry({ luas: -5 }),
    });
    expect(gapCodes(jobZero)).toContain("pds_luas_not_modelled");
    expect(gapCodes(jobNegative)).toContain("pds_luas_not_modelled");
  });

  test("Invalid pds_luasunit value keeps the luasunit blocker firing", () => {
    const job = makeJob({
      property: propertyWithLandRegistry({
        // Cast through unknown so the test can exercise the runtime
        // guard against unknown unit strings — valid use of `as`
        // here, comment explains why this assertion is intentional.
        luasUnit: "square_miles" as unknown as TenancyPortalLandRegistry["luasUnit"],
      }),
    });
    expect(gapCodes(job)).toContain("pds_luasunit_not_modelled");
  });

  test("Optional pds_kegunaan does NOT block readiness when omitted", () => {
    const job = makeJob({ property: propertyWithLandRegistry({}) });
    const codes = gapCodes(job);
    // No code in the gap list should reference kegunaan.
    expect(codes.some((c) => c.includes("kegunaan"))).toBe(false);
  });

  test("Capturing pds_kegunaan does NOT add a new blocker either", () => {
    const job = makeJob({
      property: propertyWithLandRegistry({ kegunaan: "Tempat tinggal" }),
    });
    const codes = gapCodes(job);
    expect(codes.some((c) => c.includes("kegunaan"))).toBe(false);
  });

  test("pds_luas is NOT auto-derived from premisesAreaSqm — they are separate fields", () => {
    // Even when `premisesAreaSqm` is set to a healthy positive number,
    // the land-registry `luas` blocker must still fire if `landRegistry`
    // is missing or its `luas` is absent.
    const propertyWithoutLR: TenancyPortalProperty = {
      addressLine1: "Unit 1, Test Street",
      postcode: "50000",
      city: "Kuala Lumpur",
      state: "Kuala Lumpur",
      country: "Malaysia",
      propertyType: "kediaman" as TenancyPortalPropertyType,
      buildingType: "kondominium" as TenancyPortalBuildingType,
      premisesAreaSqm: 9999, // Built-up area — must NOT satisfy pds_luas
    };
    const job = makeJob({ property: propertyWithoutLR });
    expect(gapCodes(job)).toContain("pds_luas_not_modelled");
  });

  test("Unrelated blockers (multi-pass, party model, enum mismatch) remain unaffected when LR is complete", () => {
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
      property: propertyWithLandRegistry({}),
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
    // Multi-pass blocker still there (pds_jenis = 1105)
    expect(codes).toContain("pds_jenis_1105_unsupported");
    // SSM rep-identity still there
    expect(codes).toContain("party_0_ssm_rep_identity_not_modelled");
    // Enum-mismatch state/country/salinan blockers are LIFTED
    // post-ε-4c (the property fixture uses Kuala Lumpur / Malaysia
    // and the instrument has duplicateCopies=1, all of which are
    // now mapped). Multi-pass + SSM rep-identity remain.
    expect(codes).not.toContain("pds_harta_state_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_country_no_canonical_mapping");
    expect(codes).not.toContain("pds_salinan_no_canonical_mapping");
    // And land-registry blockers are still gone (LR is complete).
    expect(codes).not.toContain("pds_mp_milik_penuh_not_modelled");
    expect(codes).not.toContain("pds_luas_not_modelled");
  });
});

describe("Milestone A1 · Bahagian C land-registry · payload compiler", () => {
  test("Payload emits the correct portal field names and values when captured", () => {
    const job = makeJob({ property: propertyWithLandRegistry({}) });
    const payload = compileTenancyPortalPayload(job);
    const lr = payload.bahagianC.landRegistry;

    expect(lr.captured).toBe(true);
    expect(lr.milikPenuh.portalFieldKey).toBe("pds_mp");
    expect(lr.milikPenuh.value).toBe("Milik Penuh sample");
    expect(lr.lot.portalFieldKey).toBe("pds_lot");
    expect(lr.lot.value).toBe("12345");
    expect(lr.mukim.portalFieldKey).toBe("pds_mukim");
    expect(lr.mukim.value).toBe("Petaling");
    expect(lr.daerah.portalFieldKey).toBe("pds_daerah");
    expect(lr.daerah.value).toBe("Kuala Lumpur");
    expect(lr.luas.portalFieldKey).toBe("pds_luas");
    expect(lr.luas.value).toBe(250);
    expect(lr.luasUnit.portalFieldKey).toBe("pds_luasunit");
    expect(lr.luasUnit.unitCode).toBe("mps");
    expect(lr.luasUnit.portalCode).toBe("4");
    expect(lr.luasUnit.label).toBe("Meter Persegi (Mps)");
    expect(lr.kegunaan.portalFieldKey).toBe("pds_kegunaan");
    expect(lr.kegunaan.value).toBe(null); // optional, not supplied
  });

  test("Payload reports captured=false when any required field is missing", () => {
    const job = makeJob({
      property: propertyWithLandRegistry({ milikPenuh: "" }),
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.landRegistry.captured).toBe(false);
  });

  test("Payload preserves pds_luas as a separate value from premisesAreaSqm", () => {
    const job = makeJob({ property: propertyWithLandRegistry({ luas: 250 }) });
    const payload = compileTenancyPortalPayload(job);
    // premisesAreaSqm comes from the property fixture (100); pds_luas
    // from landRegistry (250). They must NOT be the same.
    expect(payload.bahagianC.premisesAreaSqm).toBe(100);
    expect(payload.bahagianC.landRegistry.luas.value).toBe(250);
    expect(payload.bahagianC.premisesAreaSqm).not.toBe(
      payload.bahagianC.landRegistry.luas.value
    );
  });

  test("Each portal-luasunit code maps to the correct portal numeric code", () => {
    const cases: Array<["ekar" | "hektar" | "kps" | "mps", "1" | "2" | "3" | "4"]> = [
      ["ekar", "1"],
      ["hektar", "2"],
      ["kps", "3"],
      ["mps", "4"],
    ];
    for (const [unitCode, portalCode] of cases) {
      const job = makeJob({
        property: propertyWithLandRegistry({ luasUnit: unitCode }),
      });
      const payload = compileTenancyPortalPayload(job);
      expect(payload.bahagianC.landRegistry.luasUnit.unitCode).toBe(unitCode);
      expect(payload.bahagianC.landRegistry.luasUnit.portalCode).toBe(
        portalCode
      );
    }
  });

  test("Payload emits null values without throwing when no landRegistry is captured", () => {
    const job = makeJob({ property: propertyWithLandRegistry(null) });
    const payload = compileTenancyPortalPayload(job);
    const lr = payload.bahagianC.landRegistry;
    expect(lr.captured).toBe(false);
    expect(lr.milikPenuh.value).toBe(null);
    expect(lr.lot.value).toBe(null);
    expect(lr.mukim.value).toBe(null);
    expect(lr.daerah.value).toBe(null);
    expect(lr.luas.value).toBe(null);
    expect(lr.luasUnit.unitCode).toBe(null);
    expect(lr.luasUnit.portalCode).toBe(null);
    expect(lr.luasUnit.label).toBe(null);
    expect(lr.kegunaan.value).toBe(null);
  });
});

// ─── Milestone A1 review-patch · partial land-registry persistence ───
//
// These tests prove the fix for the "partial saves silently
// discarded" bug found in the post-A1 review:
//   - the validator now accepts partial input;
//   - readiness keeps blocking until every required field is captured;
//   - the payload still reports captured: false until complete;
//   - malformed values are still rejected with a clear error.

/**
 * Helper that builds a minimum-valid `validateTenancyPortalDetailsInput`
 * input body — parties + property scaffold + the partial landRegistry
 * under test. Returns the validator result so each test can assert
 * either the success path or the error path.
 */
function validatePartialLandRegistry(
  landRegistry: Record<string, unknown> | undefined
) {
  return validateTenancyPortalDetailsInput({
    parties: [makeIndividualLandlord(), makeIndividualTenant()],
    property: {
      addressLine1: "Unit 1, Test Street",
      postcode: "50000",
      city: "Kuala Lumpur",
      state: "Kuala Lumpur",
      country: "Malaysia",
      propertyType: "kediaman",
      premisesAreaSqm: 100,
      ...(landRegistry !== undefined ? { landRegistry } : {}),
    },
  });
}

describe("Milestone A1 review-patch · partial land-registry persistence", () => {
  test("Validator accepts a sub-block with only milikPenuh + lot filled", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lr = result.value.property?.landRegistry;
    expect(lr).toBeDefined();
    expect(lr?.milikPenuh).toBe("Hak Milik Penuh");
    expect(lr?.lot).toBe("12345");
    // Missing fields are absent from the persisted shape, NOT blanks.
    expect(lr?.mukim).toBeUndefined();
    expect(lr?.daerah).toBeUndefined();
    expect(lr?.luas).toBeUndefined();
    expect(lr?.luasUnit).toBeUndefined();
    expect(lr?.kegunaan).toBeUndefined();
  });

  test("Validator silently drops blank / whitespace-only string fields rather than rejecting", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "",
      mukim: "   ",
      daerah: "Kuala Lumpur",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lr = result.value.property?.landRegistry;
    expect(lr?.milikPenuh).toBe("Hak Milik Penuh");
    expect(lr?.daerah).toBe("Kuala Lumpur");
    expect(lr?.lot).toBeUndefined(); // empty string dropped
    expect(lr?.mukim).toBeUndefined(); // whitespace dropped
  });

  test("Validator omits the entire sub-block when every field is blank / absent", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "",
      lot: "",
      mukim: "",
      daerah: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.property?.landRegistry).toBeUndefined();
  });

  test("Validator REJECTS malformed luas (negative number) even on a partial save", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      luas: -5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/luas/);
    expect(result.error).toMatch(/positive finite number/);
  });

  test("Validator REJECTS malformed luas (zero) even on a partial save", () => {
    const result = validatePartialLandRegistry({ luas: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/luas/);
  });

  test("Validator REJECTS unknown luasUnit code even on a partial save", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      luasUnit: "square_miles",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/luasUnit/);
  });

  test("Validator REJECTS non-string milikPenuh (programmer / API misuse)", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: 12345,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/milikPenuh/);
    expect(result.error).toMatch(/string when supplied/);
  });

  test("Readiness STAYS BLOCKED on a partial save (only milikPenuh + lot captured)", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Roundtrip the validated value into a job and check readiness.
    const job: TenancyPortalRunReadinessJobInput = {
      tenancyPortalDetails: result.value,
      storagePath: "uploads/test/sample.pdf",
      originalFileName: "sample.pdf",
      mimeType: "application/pdf",
      documentCategory: "tenancy_agreement",
      stampingDetails: undefined,
    };
    const codes = gapCodes(job);
    // milikPenuh + lot blockers lifted, the other four still firing.
    expect(codes).not.toContain("pds_mp_milik_penuh_not_modelled");
    expect(codes).not.toContain("pds_lot_not_modelled");
    expect(codes).toContain("pds_mukim_not_modelled");
    expect(codes).toContain("pds_daerah_not_modelled");
    expect(codes).toContain("pds_luas_not_modelled");
    expect(codes).toContain("pds_luasunit_not_modelled");
    // Verdict still blocked.
    const report = evaluateTenancyPortalRunReadiness(job);
    expect(report.verdict).toBe("blocked");
  });

  test("Payload reports captured=false on a partial save", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
      mukim: "Petaling",
      // daerah / luas / luasUnit deliberately omitted
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job: TenancyPortalRunReadinessJobInput = {
      tenancyPortalDetails: result.value,
      storagePath: "uploads/test/sample.pdf",
      originalFileName: "sample.pdf",
      mimeType: "application/pdf",
      documentCategory: "tenancy_agreement",
      stampingDetails: undefined,
    };
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.landRegistry.captured).toBe(false);
    // Captured fields surfaced; missing fields null.
    expect(payload.bahagianC.landRegistry.milikPenuh.value).toBe(
      "Hak Milik Penuh"
    );
    expect(payload.bahagianC.landRegistry.lot.value).toBe("12345");
    expect(payload.bahagianC.landRegistry.mukim.value).toBe("Petaling");
    expect(payload.bahagianC.landRegistry.daerah.value).toBe(null);
    expect(payload.bahagianC.landRegistry.luas.value).toBe(null);
    expect(payload.bahagianC.landRegistry.luasUnit.unitCode).toBe(null);
  });

  test("Round-trip: a partial save persists exactly what the operator typed", () => {
    // Step 1 — operator first save: milikPenuh only.
    const firstSave = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
    });
    expect(firstSave.ok).toBe(true);
    if (!firstSave.ok) return;
    const persistedAfterFirst = firstSave.value.property?.landRegistry;
    expect(persistedAfterFirst).toEqual({ milikPenuh: "Hak Milik Penuh" });

    // Step 2 — operator opens the form again, enters lot + mukim,
    // saves. The save body reflects all three captured fields (UI
    // re-emits the previously-saved milikPenuh from `buildInitialDraft`).
    const secondSave = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
      mukim: "Petaling",
    });
    expect(secondSave.ok).toBe(true);
    if (!secondSave.ok) return;
    const persistedAfterSecond = secondSave.value.property?.landRegistry;
    expect(persistedAfterSecond).toEqual({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
      mukim: "Petaling",
    });
  });

  test("Complete capture still validates and produces captured=true in the payload", () => {
    const result = validatePartialLandRegistry({
      milikPenuh: "Hak Milik Penuh",
      lot: "12345",
      mukim: "Petaling",
      daerah: "Kuala Lumpur",
      luas: 250,
      luasUnit: "mps",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job: TenancyPortalRunReadinessJobInput = {
      tenancyPortalDetails: result.value,
      storagePath: "uploads/test/sample.pdf",
      originalFileName: "sample.pdf",
      mimeType: "application/pdf",
      documentCategory: "tenancy_agreement",
      stampingDetails: undefined,
    };
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.landRegistry.captured).toBe(true);
    // And the land-registry blockers are gone.
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_mp_milik_penuh_not_modelled");
    expect(codes).not.toContain("pds_lot_not_modelled");
    expect(codes).not.toContain("pds_mukim_not_modelled");
    expect(codes).not.toContain("pds_daerah_not_modelled");
    expect(codes).not.toContain("pds_luas_not_modelled");
    expect(codes).not.toContain("pds_luasunit_not_modelled");
  });
});

// ─── Milestone A2 · Maklumat Am portal field capture ─────────────────

/**
 * Helper — build a job with optional Maklumat Am sub-block + an
 * optional `pds_jenis` value (passed through the instrument block so
 * the balasan-required-when-jenis rule can be exercised).
 */
function makeJobWithMaklumatAm(
  maklumatAm: TenancyPortalDetails["maklumatAm"],
  options: {
    descType?: TenancyPortalDescriptionType;
  } = {}
): TenancyPortalRunReadinessJobInput {
  const tpd: TenancyPortalDetails = {
    updatedAt: new Date().toISOString(),
    parties: [makeIndividualLandlord(), makeIndividualTenant()],
    maklumatAm,
  };
  if (options.descType) {
    tpd.instrument = {
      instrumentDate: "2026-01-01",
      duplicateCopies: 1,
      portalDescriptionType: options.descType,
      rentSchedule: [
        { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
      ],
    };
  }
  return {
    tenancyPortalDetails: tpd,
    storagePath: "uploads/test/sample.pdf",
    originalFileName: "sample.pdf",
    mimeType: "application/pdf",
    documentCategory: "tenancy_agreement",
    stampingDetails: undefined,
  };
}

describe("Milestone A2 · Maklumat Am · readiness blockers", () => {
  test("Missing pds_dutisetem fires pds_dutisetem_not_captured", () => {
    const job = makeJobWithMaklumatAm(undefined);
    expect(gapCodes(job)).toContain("pds_dutisetem_not_captured");
  });

  test("Missing pds_ps fires pds_ps_not_captured", () => {
    const job = makeJobWithMaklumatAm(undefined);
    expect(gapCodes(job)).toContain("pds_ps_not_captured");
  });

  test("Recognised pds_ps values lift the pds_ps blocker", () => {
    const principal = makeJobWithMaklumatAm({
      instrumentRelationship: "principal",
    });
    expect(gapCodes(principal)).not.toContain("pds_ps_not_captured");
    const related49e = makeJobWithMaklumatAm({
      instrumentRelationship: "related_lease_49e",
    });
    expect(gapCodes(related49e)).not.toContain("pds_ps_not_captured");
  });

  test("pds_dutisetem with non-empty code lifts the dutisetem blocker", () => {
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
    });
    expect(gapCodes(job)).not.toContain("pds_dutisetem_not_captured");
  });

  test("Partial Maklumat Am persists without falsely passing readiness", () => {
    // Operator has filled pds_dutisetem but not pds_ps yet.
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
    });
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_dutisetem_not_captured");
    expect(codes).toContain("pds_ps_not_captured");
    const report = evaluateTenancyPortalRunReadiness(job);
    expect(report.verdict).toBe("blocked");
  });

  test("pds_balasan is NOT silently derived from monthly rent / rent schedule", () => {
    // Job has a rent schedule but no balasan captured. We use
    // premium_only as the path here because that's the only pds_jenis
    // currently in PDS_JENIS_REQUIRING_BALASAN — readiness must block
    // on missing balasan explicitly, not infer from rent.
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
      { descType: "premium_only" }
    );
    const codes = gapCodes(job);
    expect(codes).toContain("pds_balasan_not_captured");
    // Confirm the reason mentions the no-auto-derive rule.
    const report = evaluateTenancyPortalRunReadiness(job);
    const reason = report.portalFieldMappingGaps.find(
      (g) => g.code === "pds_balasan_not_captured"
    )?.reason;
    expect(reason).toMatch(/auto-derive|operator must enter/i);
  });

  test("pds_balasan is NOT required for fixed_rent_during_tenancy (post A2 review patch — no hard portal evidence)", () => {
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
      { descType: "fixed_rent_during_tenancy" }
    );
    // No pds_balasan_not_captured / pds_balasan_invalid blockers
    // when balasan is absent on a fixed-rent path.
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_balasan_not_captured");
    expect(codes).not.toContain("pds_balasan_invalid");
  });

  test("Invalid pds_balasan (negative) fires pds_balasan_invalid regardless of pds_jenis", () => {
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
        balasan: -100 as unknown as number, // bypass validator path
      },
      { descType: "fixed_rent_during_tenancy" }
    );
    // Even on a fixed-rent path (where balasan is optional), a
    // supplied-but-malformed value must still block via
    // pds_balasan_invalid.
    expect(gapCodes(job)).toContain("pds_balasan_invalid");
  });

  test("pds_balasan NOT required for pds_jenis paths outside the requiring set", () => {
    // Both crop_share_only and fixed_rent_during_tenancy are outside
    // the requiring set after the A2 review patch.
    const cropShare = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
      { descType: "crop_share_only" }
    );
    expect(gapCodes(cropShare)).not.toContain("pds_balasan_not_captured");

    const fixedRent = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
      { descType: "fixed_rent_during_tenancy" }
    );
    expect(gapCodes(fixedRent)).not.toContain("pds_balasan_not_captured");
  });

  test("pds_balasan required for premium_only", () => {
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
      { descType: "premium_only" }
    );
    expect(gapCodes(job)).toContain("pds_balasan_not_captured");
  });

  test("Missing pds_remit does NOT block readiness", () => {
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
    });
    const codes = gapCodes(job);
    expect(codes.some((c) => c.includes("pds_remit"))).toBe(false);
  });

  test("Treaty / diplomatic flags default safely (omitted) and do not block", () => {
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
    });
    const codes = gapCodes(job);
    expect(codes.some((c) => c.includes("pds_perjanjian"))).toBe(false);
    expect(codes.some((c) => c.includes("treaty"))).toBe(false);
  });

  test("Treaty flags set to true also do not block readiness", () => {
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
      treatyExemption: { vienna: true },
    });
    const codes = gapCodes(job);
    expect(codes.some((c) => c.includes("pds_perjanjian"))).toBe(false);
  });

  test("Unrelated blockers remain unaffected when Maklumat Am is fully captured", () => {
    const job: TenancyPortalRunReadinessJobInput = {
      ...makeJob({}),
      tenancyPortalDetails: {
        updatedAt: new Date().toISOString(),
        parties: [makeIndividualLandlord(), makeIndividualTenant()],
        instrument: {
          instrumentDate: "2026-01-01",
          duplicateCopies: 1,
          portalDescriptionType: "amendment_to_original_tenancy",
          rentSchedule: [
            { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
          ],
        },
        maklumatAm: {
          dutyStampType: { code: "1101" },
          instrumentRelationship: "principal",
        },
      },
    };
    const codes = gapCodes(job);
    // Multi-pass blocker still there (pds_jenis = 1105)
    expect(codes).toContain("pds_jenis_1105_unsupported");
    // Party model blockers still there
    expect(codes).toContain("party_0_gender_not_modelled");
    expect(codes).toContain("party_1_citizenship_3way_not_modelled");
    // But Maklumat Am required-field blockers are gone
    expect(codes).not.toContain("pds_dutisetem_not_captured");
    expect(codes).not.toContain("pds_ps_not_captured");
  });
});

describe("Milestone A2 · Maklumat Am · payload compiler", () => {
  test("Payload emits the correct portal field names and values when captured", () => {
    // Use premium_only here because that's the pds_jenis path where
    // balasan is required (per A2 review patch — fixed_rent no longer
    // qualifies). This lets the test assert
    // requiredForCurrentJenis === true alongside the other fields.
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
        instrumentRelationship: "principal",
        balasan: 50000,
        remission: { code: "5", label: "Treaty exemption" },
        treatyExemption: { vienna: true },
      },
      { descType: "premium_only" }
    );
    const payload = compileTenancyPortalPayload(job);
    const ma = payload.maklumatAm;
    expect(ma.captured).toBe(true);
    expect(ma.dutyStampType.portalFieldKey).toBe("pds_dutisetem");
    expect(ma.dutyStampType.code).toBe("1101");
    expect(ma.dutyStampType.label).toBe("Sewa / Pajakan");
    expect(ma.instrumentRelationship.portalFieldKey).toBe("pds_ps");
    expect(ma.instrumentRelationship.unitCode).toBe("principal");
    expect(ma.instrumentRelationship.portalCode).toBe("p");
    expect(ma.instrumentRelationship.label).toBe("Prinsipal");
    expect(ma.balasan.portalFieldKey).toBe("pds_balasan");
    expect(ma.balasan.value).toBe(50000);
    expect(ma.balasan.requiredForCurrentJenis).toBe(true);
    expect(ma.remission.portalFieldKey).toBe("pds_remit");
    expect(ma.remission.code).toBe("5");
    expect(ma.remission.label).toBe("Treaty exemption");
    expect(ma.treatyExemption.portalFieldKey).toBe("pds_perjanjian");
    expect(ma.treatyExemption.vienna).toBe(true);
    expect(ma.treatyExemption.kmkt).toBe(false);
    expect(ma.treatyExemption.klnm).toBe(false);
  });

  test("Payload reports captured=false when required Maklumat Am field is missing", () => {
    const job = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      // instrumentRelationship deliberately omitted
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.maklumatAm.captured).toBe(false);
  });

  test("balasan.requiredForCurrentJenis tracks the pds_jenis path", () => {
    // After the A2 review patch, only premium_only requires balasan.
    // fixed_rent_during_tenancy and crop_share_only must report false.
    const premium = makeJobWithMaklumatAm(
      { dutyStampType: { code: "1101" }, instrumentRelationship: "principal" },
      { descType: "premium_only" }
    );
    expect(
      compileTenancyPortalPayload(premium).maklumatAm.balasan
        .requiredForCurrentJenis
    ).toBe(true);

    const fixed = makeJobWithMaklumatAm(
      { dutyStampType: { code: "1101" }, instrumentRelationship: "principal" },
      { descType: "fixed_rent_during_tenancy" }
    );
    expect(
      compileTenancyPortalPayload(fixed).maklumatAm.balasan
        .requiredForCurrentJenis
    ).toBe(false);

    const cropShare = makeJobWithMaklumatAm(
      { dutyStampType: { code: "1101" }, instrumentRelationship: "principal" },
      { descType: "crop_share_only" }
    );
    expect(
      compileTenancyPortalPayload(cropShare).maklumatAm.balasan
        .requiredForCurrentJenis
    ).toBe(false);

    const noJenis = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
    });
    expect(
      compileTenancyPortalPayload(noJenis).maklumatAm.balasan
        .requiredForCurrentJenis
    ).toBe(false);
  });

  test("pds_ps maps each enum to the portal `<option value>` correctly", () => {
    const principal = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
    });
    expect(
      compileTenancyPortalPayload(principal).maklumatAm.instrumentRelationship
        .portalCode
    ).toBe("p");
    const related = makeJobWithMaklumatAm({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "related_lease_49e",
    });
    expect(
      compileTenancyPortalPayload(related).maklumatAm.instrumentRelationship
        .portalCode
    ).toBe("s");
  });

  test("Payload emits null values without throwing when no maklumatAm captured", () => {
    const job = makeJobWithMaklumatAm(undefined);
    const payload = compileTenancyPortalPayload(job);
    const ma = payload.maklumatAm;
    expect(ma.captured).toBe(false);
    expect(ma.dutyStampType.code).toBe(null);
    expect(ma.dutyStampType.label).toBe(null);
    expect(ma.instrumentRelationship.unitCode).toBe(null);
    expect(ma.instrumentRelationship.portalCode).toBe(null);
    expect(ma.balasan.value).toBe(null);
    expect(ma.remission.code).toBe(null);
    expect(ma.treatyExemption.kmkt).toBe(false);
  });

  test("Payload preserves operator-supplied balasan value verbatim, not derived from rentSchedule", () => {
    const job = makeJobWithMaklumatAm(
      {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
        balasan: 12345.67,
      },
      { descType: "fixed_rent_during_tenancy" }
    );
    // The instrument fixture above uses monthlyRent: 1000 across one
    // year (12000 in total) — the payload's balasan must be the
    // operator-supplied 12345.67, NOT the rent total.
    const payload = compileTenancyPortalPayload(job);
    expect(payload.maklumatAm.balasan.value).toBe(12345.67);
  });
});

describe("Milestone A2 · Maklumat Am · validator partial-save", () => {
  test("Validator accepts a maklumatAm sub-block with only dutyStampType filled", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maklumatAm).toEqual({
      dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
    });
  });

  test("Validator silently drops blank dutyStampType.code rather than rejecting", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        dutyStampType: { code: "   " },
        instrumentRelationship: "principal",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Blank code dropped; instrumentRelationship kept.
    expect(result.value.maklumatAm?.dutyStampType).toBeUndefined();
    expect(result.value.maklumatAm?.instrumentRelationship).toBe("principal");
  });

  test("Validator REJECTS unknown instrumentRelationship", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: { instrumentRelationship: "made_up" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/instrumentRelationship/);
  });

  test("Validator REJECTS negative balasan", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: { balasan: -50 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/balasan/);
    expect(result.error).toMatch(/positive finite number/);
  });

  test("Validator REJECTS non-boolean treaty flag", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        treatyExemption: { kmkt: "yes" as unknown as boolean },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/treatyExemption.kmkt/);
  });

  test("Validator omits treaty sub-object when every flag is false / absent", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        dutyStampType: { code: "1101" },
        treatyExemption: { kmkt: false, klnm: false, vienna: false },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maklumatAm?.treatyExemption).toBeUndefined();
  });

  test("Validator omits the entire maklumatAm sub-block when every field is blank / absent", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        dutyStampType: { code: "" },
        treatyExemption: {},
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maklumatAm).toBeUndefined();
  });

  test("Round-trip: partial maklumatAm save persists exactly what the operator typed", () => {
    const firstSave = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: { dutyStampType: { code: "1101" } },
    });
    expect(firstSave.ok).toBe(true);
    if (!firstSave.ok) return;
    expect(firstSave.value.maklumatAm).toEqual({
      dutyStampType: { code: "1101" },
    });

    const secondSave = validateTenancyPortalDetailsInput({
      parties: [makeIndividualLandlord(), makeIndividualTenant()],
      maklumatAm: {
        dutyStampType: { code: "1101" },
        instrumentRelationship: "principal",
      },
    });
    expect(secondSave.ok).toBe(true);
    if (!secondSave.ok) return;
    expect(secondSave.value.maklumatAm).toEqual({
      dutyStampType: { code: "1101" },
      instrumentRelationship: "principal",
    });
  });
});

// ─── Milestone A3 · Portal enum / canonical mapping integration ────
//
// These tests prove the readiness gate + payload compiler use the
// new canonical-mapping helpers (`tenancy-portal-canonical-maps.ts`)
// correctly:
//   - readiness blockers continue to fire while codes remain unknown
//   - kediaman + studio / lain_lain / apartment still emit their
//     legacy per-value blocker codes
//   - perdagangan/perindustrian + any WeStamp value still emits
//     pds_harta_cat_propertyType_unsupported
//   - kediaman + a mappable WeStamp value emits the new
//     pds_harta_cat_unknown_code blocker (label known, code unknown)
//   - partially_furnished still emits its legacy blocker code
//   - payload compiler emits per-field mapping summaries

describe("Milestone A3 · readiness · canonical-mapping integration", () => {
  test("pds_salinan blocker LIFTED for duplicateCopies in 0..20 (post ε-4c)", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    expect(gapCodes(job)).not.toContain("pds_salinan_no_canonical_mapping");
  });

  test("pds_salinan blocker fires for negative or non-integer duplicateCopies (unsupported)", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: -3 as unknown as number,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    expect(gapCodes(job)).toContain("pds_salinan_no_canonical_mapping");
  });

  test("pds_harta_state blocker LIFTED for seeded states (post ε-4c)", () => {
    const job = makeJob({
      property: propertyWithLandRegistry({}),
    });
    // Seeded state Kuala Lumpur — code 14 captured.
    expect(gapCodes(job)).not.toContain("pds_harta_state_no_canonical_mapping");
  });

  test("pds_harta_state blocker fires for unseeded states (unsupported)", () => {
    // The propertyWithLandRegistry helper uses Kuala Lumpur, which IS
    // seeded. To test unseeded we override.
    const property = propertyWithLandRegistry({});
    property.state = "Atlantis";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain("pds_harta_state_no_canonical_mapping");
  });

  test("pds_harta_country blocker LIFTED for Malaysia (post ε-4c, code 146)", () => {
    const job = makeJob({ property: propertyWithLandRegistry({}) });
    expect(gapCodes(job)).not.toContain("pds_harta_country_no_canonical_mapping");
  });

  test("pds_harta_country blocker fires for unseeded country (unsupported)", () => {
    const property = propertyWithLandRegistry({});
    property.country = "Singapore";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain("pds_harta_country_no_canonical_mapping");
  });

  test("Kediaman + mappable building (kondominium) is now MAPPED — pds_harta_cat blocker lifted (post ε-4)", () => {
    // Default propertyWithLandRegistry uses kediaman + kondominium.
    // After ε-4, kondominium has its captured portal code (1114), so
    // the canonical mapping returns `mapped` and no harta_cat
    // blocker fires for this combo.
    const job = makeJob({ property: propertyWithLandRegistry({}) });
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_harta_cat_unknown_code");
    expect(codes).not.toContain("pds_harta_cat_propertyType_unsupported");
  });

  test("Kediaman + studio still emits the legacy building_type_studio_no_portal_equivalent blocker", () => {
    const property = propertyWithLandRegistry({});
    property.buildingType = "studio";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain(
      "building_type_studio_no_portal_equivalent"
    );
  });

  test("Kediaman + lain_lain still emits the legacy blocker", () => {
    const property = propertyWithLandRegistry({});
    property.buildingType = "lain_lain";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain(
      "building_type_lain_lain_no_portal_equivalent"
    );
  });

  test("Kediaman + apartment still emits the legacy blocker (ambiguous → block)", () => {
    const property = propertyWithLandRegistry({});
    property.buildingType = "apartment";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain(
      "building_type_apartment_no_portal_equivalent"
    );
  });

  test("Perdagangan + any WeStamp building emits pds_harta_cat_propertyType_unsupported", () => {
    const property = propertyWithLandRegistry({});
    property.propertyType = "perdagangan";
    const job = makeJob({ property });
    const codes = gapCodes(job);
    expect(codes).toContain("pds_harta_cat_propertyType_unsupported");
    // Cross-map prevention: NO Kediaman per-value blockers fire.
    expect(codes).not.toContain("pds_harta_cat_unknown_code");
  });

  test("Perindustrian + any WeStamp building emits pds_harta_cat_propertyType_unsupported", () => {
    const property = propertyWithLandRegistry({});
    property.propertyType = "perindustrian";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain("pds_harta_cat_propertyType_unsupported");
  });

  test("Tanah Kosong + no buildingType is mapped — no harta_cat blocker", () => {
    const property = propertyWithLandRegistry({});
    property.propertyType = "tanah_kosong";
    delete property.buildingType;
    const job = makeJob({ property });
    const codes = gapCodes(job);
    expect(codes).not.toContain("pds_harta_cat_unknown_code");
    expect(codes).not.toContain("pds_harta_cat_propertyType_unsupported");
  });

  test("furnished_status partially_furnished still emits the legacy blocker", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "partially_furnished";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain(
      "furnished_status_partially_furnished_unsupported"
    );
  });

  test("furnished_status fully_furnished is now MAPPED — pds_harta_perabot blocker lifted (post ε-4, code 1122)", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "fully_furnished";
    const job = makeJob({ property });
    expect(gapCodes(job)).not.toContain("pds_harta_perabot_unknown_code");
  });

  test("furnished_status unfurnished is now MAPPED (post ε-4, code 1123)", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "unfurnished";
    const job = makeJob({ property });
    expect(gapCodes(job)).not.toContain("pds_harta_perabot_unknown_code");
  });

  test("furnished_status partially_furnished STILL blocks (no portal equivalent)", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "partially_furnished";
    const job = makeJob({ property });
    expect(gapCodes(job)).toContain(
      "furnished_status_partially_furnished_unsupported"
    );
  });

  test("Unrelated blockers remain untouched when canonical mappings are exercised", () => {
    // Multi-pass and party-model blockers must still fire.
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
      property: propertyWithLandRegistry({}),
    });
    const codes = gapCodes(job);
    expect(codes).toContain("pds_jenis_1105_unsupported");
    expect(codes).toContain("party_0_gender_not_modelled");
  });
});

describe("Milestone A3 · payload compiler · canonical mapping summaries", () => {
  test("Payload BahagianB exposes duplicateCopiesMapping mapped to portal code (post ε-4c)", () => {
    const job = makeJob({
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "fixed_rent_during_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianB.duplicateCopiesMapping.portalFieldKey).toBe(
      "pds_salinan"
    );
    expect(payload.bahagianB.duplicateCopiesMapping.status).toBe("mapped");
    expect(payload.bahagianB.duplicateCopiesMapping.portalLabel).toBe("1");
    expect(payload.bahagianB.duplicateCopiesMapping.portalCode).toBe("1");
  });

  test("Payload BahagianC exposes state / country / category / furnished mappings", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "fully_furnished";
    const job = makeJob({ property });
    const payload = compileTenancyPortalPayload(job);

    // state and country are NOW MAPPED post-ε-4c with captured codes.
    // Operator input "Kuala Lumpur" resolves to the long portal label
    // "Wilayah Persekutuan Kuala Lumpur" with code 14.
    expect(payload.bahagianC.stateMapping.portalFieldKey).toBe(
      "pds_harta_state"
    );
    expect(payload.bahagianC.stateMapping.portalLabel).toBe(
      "Wilayah Persekutuan Kuala Lumpur"
    );
    expect(payload.bahagianC.stateMapping.portalCode).toBe("14");
    expect(payload.bahagianC.stateMapping.status).toBe("mapped");

    expect(payload.bahagianC.countryMapping.portalFieldKey).toBe(
      "pds_harta_country"
    );
    expect(payload.bahagianC.countryMapping.portalLabel).toBe("MALAYSIA");
    expect(payload.bahagianC.countryMapping.portalCode).toBe("146");
    expect(payload.bahagianC.countryMapping.status).toBe("mapped");

    // pds_harta_cat (Kediaman + kondominium) is now MAPPED with
    // captured code 1114 (post-ε-4 evidence patch).
    expect(payload.bahagianC.propertyCategoryMapping.portalFieldKey).toBe(
      "pds_harta_cat"
    );
    expect(payload.bahagianC.propertyCategoryMapping.portalLabel).toBe(
      "Kondominium"
    );
    expect(payload.bahagianC.propertyCategoryMapping.portalCode).toBe("1114");
    expect(payload.bahagianC.propertyCategoryMapping.status).toBe("mapped");

    // pds_harta_perabot is now MAPPED with captured code 1122
    // (Dengan Perabot, post-ε-4 evidence patch).
    expect(payload.bahagianC.furnishedMapping.portalFieldKey).toBe(
      "pds_harta_perabot"
    );
    expect(payload.bahagianC.furnishedMapping.portalLabel).toBe(
      "Dengan Perabot"
    );
    expect(payload.bahagianC.furnishedMapping.portalCode).toBe("1122");
    expect(payload.bahagianC.furnishedMapping.status).toBe("mapped");
  });

  test("Payload reports propertyCategoryMapping=unsupported when Perdagangan is selected", () => {
    const property = propertyWithLandRegistry({});
    property.propertyType = "perdagangan";
    const job = makeJob({ property });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.propertyCategoryMapping.status).toBe(
      "unsupported"
    );
    expect(payload.bahagianC.propertyCategoryMapping.portalLabel).toBe(null);
  });

  test("Payload reports propertyCategoryMapping=ambiguous when Kediaman + apartment", () => {
    const property = propertyWithLandRegistry({});
    property.buildingType = "apartment";
    const job = makeJob({ property });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.propertyCategoryMapping.status).toBe("ambiguous");
  });

  test("Payload reports furnishedMapping=unsupported for partially_furnished", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "partially_furnished";
    const job = makeJob({ property });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianC.furnishedMapping.status).toBe("unsupported");
    expect(payload.bahagianC.furnishedMapping.portalLabel).toBe(null);
  });

  test("Payload duplicateCopiesMapping=unsupported when no instrument captured", () => {
    const job = makeJob({});
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianB.duplicateCopiesMapping.status).toBe(
      "unsupported"
    );
  });
});

// ─── Milestone A4 · Bahagian A party identity model gaps ───────────
//
// These tests prove the per-party identity blockers fire and lift
// per actual field presence, not "always" as before A4. They cover:
//   - individual party gender / citizenship_3way / NRIC sub-type
//   - SSM company rep identity (combined blocker on missing fields)
//   - SSM business type / ROC split / company locality
//   - the citizenship-from-nationality and NRIC-subtype-from-IC
//     non-inference rules
//   - payload compiler emits new portal field names + identityComplete

/**
 * Build a complete individual party that satisfies all A4
 * individual-side blockers. Used as a "ready individual" baseline.
 */
function makeReadyIndividual(
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
    citizenshipCategory: "citizen",
    gender: "male",
    nricSubType: "ic_baru",
    ...overrides,
  };
}

/**
 * Build a complete SSM company party (company + rep + ROC + business
 * type + locality) that satisfies all A4 SSM-side blockers.
 */
function makeReadySsmCompany(
  overrides: Partial<TenancyPortalParty> = {}
): TenancyPortalParty {
  return {
    role: "landlord",
    type: "company_ssm",
    nameAsPerInstrument: "Test Co Sdn Bhd",
    identityType: "company_registration",
    identityNumber: "201901000001",
    addressLine1: "1 Co Lane",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0123456789",
    rocOld: "201901000001",
    businessType: { code: "1" },
    companyLocality: "local_company",
    companyRepresentative: {
      ownerName: "Director Director",
      citizenshipCategory: "citizen",
      identityType: "nric",
      identityNumber: "800808088888",
      nricSubType: "ic_baru",
      gender: "female",
    },
    ...overrides,
  };
}

describe("Milestone A4 · individual party identity blockers", () => {
  test("missing gender keeps party_*_gender_not_modelled blocker firing", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({ gender: undefined }),
        makeReadyIndividual({ role: "tenant" }),
      ],
    });
    expect(gapCodes(job)).toContain("party_0_gender_not_modelled");
    // Other party (1) has gender — its blocker should NOT fire.
    expect(gapCodes(job)).not.toContain("party_1_gender_not_modelled");
  });

  test("missing 3-way citizenship keeps party_*_citizenship_3way_not_modelled firing", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({ citizenshipCategory: undefined }),
        makeReadyIndividual({ role: "tenant" }),
      ],
    });
    expect(gapCodes(job)).toContain(
      "party_0_citizenship_3way_not_modelled"
    );
    expect(gapCodes(job)).not.toContain(
      "party_1_citizenship_3way_not_modelled"
    );
  });

  test("NRIC party missing nricSubType keeps party_*_nric_subtype_not_modelled firing", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({ nricSubType: undefined }),
        makeReadyIndividual({
          role: "tenant",
          identityType: "passport",
          nationality: "non_malaysian",
          identityNumber: "P1234567",
        }),
      ],
    });
    const codes = gapCodes(job);
    expect(codes).toContain("party_0_nric_subtype_not_modelled");
    // Passport party — nricSubType blocker MUST NOT fire.
    expect(codes).not.toContain("party_1_nric_subtype_not_modelled");
  });

  test("complete individual identity fields lift all individual blockers for that party", () => {
    const job = makeJob({
      parties: [makeReadyIndividual(), makeReadyIndividual({ role: "tenant" })],
    });
    const codes = gapCodes(job);
    expect(codes).not.toContain("party_0_gender_not_modelled");
    expect(codes).not.toContain("party_1_gender_not_modelled");
    expect(codes).not.toContain("party_0_citizenship_3way_not_modelled");
    expect(codes).not.toContain("party_0_nric_subtype_not_modelled");
  });

  test("citizenship is NOT inferred from nationality (Malaysian + missing citizenshipCategory still blocks)", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({
          nationality: "malaysian",
          citizenshipCategory: undefined,
        }),
        makeReadyIndividual({ role: "tenant" }),
      ],
    });
    expect(gapCodes(job)).toContain(
      "party_0_citizenship_3way_not_modelled"
    );
  });

  test("NRIC sub-type is NOT inferred from identity number format (still blocks)", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({
          // Format that "looks" like a Baru NRIC; matcher must NOT
          // promote to ic_baru on its own.
          identityNumber: "900101015555",
          nricSubType: undefined,
        }),
        makeReadyIndividual({ role: "tenant" }),
      ],
    });
    expect(gapCodes(job)).toContain("party_0_nric_subtype_not_modelled");
  });
});

describe("Milestone A4 · SSM company party blockers", () => {
  test("company_ssm with no representative captured fires combined rep-identity blocker", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({ companyRepresentative: undefined }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).toContain(
      "party_0_ssm_rep_identity_not_modelled"
    );
  });

  test("partial representative identity persists but readiness still blocks", () => {
    // Operator captures only ownerName + citizenshipCategory; the
    // rest is missing. The combined blocker still fires because
    // identity number / type / gender are not yet captured.
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          companyRepresentative: {
            ownerName: "Director Director",
            citizenshipCategory: "citizen",
          },
        }),
        makeIndividualTenant(),
      ],
    });
    const codes = gapCodes(job);
    expect(codes).toContain("party_0_ssm_rep_identity_not_modelled");
  });

  test("complete representative identity lifts the rep-identity blocker", () => {
    const job = makeJob({
      parties: [makeReadySsmCompany(), makeIndividualTenant()],
    });
    expect(gapCodes(job)).not.toContain(
      "party_0_ssm_rep_identity_not_modelled"
    );
  });

  test("company_ssm missing businessType keeps the business-type blocker firing", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({ businessType: undefined }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).toContain(
      "party_0_ssm_business_type_not_captured"
    );
  });

  test("company_ssm with both ROC fields blank keeps ROC blocker firing", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({ rocOld: undefined, rocNew: undefined }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).toContain("party_0_ssm_roc_not_captured");
  });

  test("company_ssm with rocOld lifts ROC blocker; rocOld and rocNew are stored separately", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          rocOld: "201901000001",
          rocNew: undefined,
        }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).not.toContain("party_0_ssm_roc_not_captured");
  });

  test("company_ssm with rocNew alone also lifts ROC blocker", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          rocOld: undefined,
          rocNew: "202101000999",
        }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).not.toContain("party_0_ssm_roc_not_captured");
  });

  test("company_ssm missing companyLocality keeps the locality blocker firing", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({ companyLocality: undefined }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).toContain("party_0_ssm_locality_not_captured");
  });

  test("companyLocality is NOT inferred from country (Malaysia + missing locality still blocks)", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          country: "Malaysia",
          companyLocality: undefined,
        }),
        makeIndividualTenant(),
      ],
    });
    expect(gapCodes(job)).toContain("party_0_ssm_locality_not_captured");
  });

  test("complete SSM company lifts every SSM-only blocker for that party", () => {
    const job = makeJob({
      parties: [makeReadySsmCompany(), makeIndividualTenant()],
    });
    const codes = gapCodes(job);
    expect(codes).not.toContain("party_0_ssm_rep_identity_not_modelled");
    expect(codes).not.toContain("party_0_ssm_business_type_not_captured");
    expect(codes).not.toContain("party_0_ssm_roc_not_captured");
    expect(codes).not.toContain("party_0_ssm_locality_not_captured");
  });
});

describe("Milestone A4 · payload compiler · new party fields", () => {
  test("payload exposes citizenshipCategory / nricSubType / gender per party", () => {
    const job = makeJob({
      parties: [makeReadyIndividual(), makeReadyIndividual({ role: "tenant" })],
    });
    const payload = compileTenancyPortalPayload(job);
    const party0 = payload.bahagianA.parties[0];
    expect(party0.citizenshipCategory).toBe("citizen");
    expect(party0.nricSubType).toBe("ic_baru");
    expect(party0.gender).toBe("male");
    expect(party0.identityComplete).toBe(true);
  });

  test("payload exposes SSM company entity fields and rep sub-block", () => {
    const job = makeJob({
      parties: [makeReadySsmCompany(), makeIndividualTenant()],
    });
    const payload = compileTenancyPortalPayload(job);
    const party0 = payload.bahagianA.parties[0];
    expect(party0.rocOld).toBe("201901000001");
    expect(party0.rocNew).toBe(null);
    expect(party0.businessType.code).toBe("1");
    expect(party0.companyLocality).toBe("local_company");
    expect(party0.companyRepresentative.ownerName).toBe("Director Director");
    expect(party0.companyRepresentative.citizenshipCategory).toBe("citizen");
    expect(party0.companyRepresentative.identityType).toBe("nric");
    expect(party0.companyRepresentative.nricSubType).toBe("ic_baru");
    expect(party0.companyRepresentative.gender).toBe("female");
    expect(party0.companyRepresentative.complete).toBe(true);
    expect(party0.identityComplete).toBe(true);
  });

  test("payload identityComplete=false when individual gender missing", () => {
    const job = makeJob({
      parties: [
        makeReadyIndividual({ gender: undefined }),
        makeReadyIndividual({ role: "tenant" }),
      ],
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianA.parties[0].identityComplete).toBe(false);
    expect(payload.bahagianA.parties[1].identityComplete).toBe(true);
  });

  test("payload companyRepresentative.complete=false when ownerName missing", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          companyRepresentative: {
            citizenshipCategory: "citizen",
            identityType: "nric",
            identityNumber: "800808088888",
            nricSubType: "ic_baru",
            gender: "female",
          },
        }),
        makeIndividualTenant(),
      ],
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianA.parties[0].companyRepresentative.complete).toBe(
      false
    );
    expect(payload.bahagianA.parties[0].identityComplete).toBe(false);
  });

  test("payload preserves rocOld and rocNew as separate fields", () => {
    const job = makeJob({
      parties: [
        makeReadySsmCompany({
          rocOld: "201901000001",
          rocNew: "202101000999",
        }),
        makeIndividualTenant(),
      ],
    });
    const payload = compileTenancyPortalPayload(job);
    expect(payload.bahagianA.parties[0].rocOld).toBe("201901000001");
    expect(payload.bahagianA.parties[0].rocNew).toBe("202101000999");
  });
});

describe("Milestone A4 · validator partial-save", () => {
  test("validator accepts partial new individual fields", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [
        {
          role: "landlord",
          type: "individual",
          nameAsPerInstrument: "Partial",
          addressLine1: "1 Lane",
          postcode: "50000",
          city: "KL",
          state: "KL",
          country: "Malaysia",
          mobile: "0123456789",
          gender: "male",
          // citizenshipCategory + nricSubType deliberately omitted
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.value.parties[0];
    expect(stored.gender).toBe("male");
    expect(stored.citizenshipCategory).toBeUndefined();
    expect(stored.nricSubType).toBeUndefined();
  });

  test("validator REJECTS unknown citizenshipCategory value", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [
        {
          role: "landlord",
          type: "individual",
          nameAsPerInstrument: "Test",
          addressLine1: "1 Lane",
          postcode: "50000",
          city: "KL",
          state: "KL",
          country: "Malaysia",
          mobile: "0123456789",
          citizenshipCategory: "alien",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/citizenshipCategory/);
  });

  test("validator REJECTS unknown gender value", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [
        {
          role: "landlord",
          type: "individual",
          nameAsPerInstrument: "Test",
          addressLine1: "1 Lane",
          postcode: "50000",
          city: "KL",
          state: "KL",
          country: "Malaysia",
          mobile: "0123456789",
          gender: "other",
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  test("validator REJECTS unknown nricSubType value", () => {
    const result = validateTenancyPortalDetailsInput({
      parties: [
        {
          role: "landlord",
          type: "individual",
          nameAsPerInstrument: "Test",
          addressLine1: "1 Lane",
          postcode: "50000",
          city: "KL",
          state: "KL",
          country: "Malaysia",
          mobile: "0123456789",
          nricSubType: "ic_unknown",
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  test("validator accepts SSM company with partial representative (round-trip)", () => {
    const firstSave = validateTenancyPortalDetailsInput({
      parties: [
        {
          role: "landlord",
          type: "company_ssm",
          nameAsPerInstrument: "Co",
          addressLine1: "1 Co Lane",
          postcode: "50000",
          city: "KL",
          state: "KL",
          country: "Malaysia",
          mobile: "0123456789",
          companyRepresentative: { ownerName: "Director" },
        },
      ],
    });
    expect(firstSave.ok).toBe(true);
    if (!firstSave.ok) return;
    expect(firstSave.value.parties[0].companyRepresentative).toEqual({
      ownerName: "Director",
    });
  });
});

describe("Milestone A4 · unrelated blockers untouched", () => {
  test("multi-pass blocker still fires when party model is complete (post ε-4c)", () => {
    // After ε-4c, the enum-mismatch blockers for state/country/salinan
    // are LIFTED for seeded values. The non-regression check for
    // multi-pass survival uses `pds_jenis = 1105` which still triggers
    // a multi-pass blocker independently.
    const job = makeJob({
      parties: [makeReadyIndividual(), makeReadyIndividual({ role: "tenant" })],
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType:
          "amendment_to_original_tenancy" as TenancyPortalDescriptionType,
        rentSchedule: [
          { startDate: "2026-01-01", endDate: "2027-01-01", monthlyRent: 1000 },
        ],
      },
      property: propertyWithLandRegistry({}),
    });
    const codes = gapCodes(job);
    // Multi-pass survives — pds_jenis = 1105 is structurally
    // unsupported by the single-pass compiler regardless of data.
    expect(codes).toContain("pds_jenis_1105_unsupported");
    // Post-ε-4c: enum-mismatch blockers are gone for seeded values.
    expect(codes).not.toContain("pds_salinan_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_state_no_canonical_mapping");
    // Individual party blockers are gone (party model complete).
    expect(codes).not.toContain("party_0_gender_not_modelled");
    expect(codes).not.toContain("party_0_citizenship_3way_not_modelled");
    expect(codes).not.toContain("party_0_nric_subtype_not_modelled");
  });
});

// ─── ε-4c full-evidence patch · readiness invariants ─────────────
//
// After ε-4c, all five Category C `<select>` fields have first-hand
// portal codes seeded. These tests pin down the new invariant: a
// fully-captured fixed-rent residential tenancy with seeded values
// has ZERO portal_enum_mismatch blockers. Semantic blockers (apartment
// ambiguity, studio/lain_lain unsupported, perdagangan/perindustrian
// without WeStamp enum coverage) still fire — those are model gaps,
// not evidence gaps.

describe("ε-4c full-evidence patch · invariants", () => {
  test("Zero Category C blockers fire when every operator-fillable field is captured with seeded values", () => {
    const property = propertyWithLandRegistry({});
    property.furnishedStatus = "fully_furnished";
    const job: TenancyPortalRunReadinessJobInput = {
      ...makeJob({}),
      tenancyPortalDetails: {
        updatedAt: new Date().toISOString(),
        parties: [makeIndividualLandlord(), makeIndividualTenant()],
        instrument: {
          instrumentDate: "2026-01-01",
          duplicateCopies: 1,
          portalDescriptionType: "fixed_rent_during_tenancy",
          rentSchedule: [
            {
              startDate: "2026-01-01",
              endDate: "2027-01-01",
              monthlyRent: 1000,
            },
          ],
          portalInstrumentName: { code: "1101", label: "Perjanjian Sewa" },
        },
        property,
        maklumatAm: {
          dutyStampType: { code: "1101" },
          instrumentRelationship: "principal",
        },
      },
    };
    const codes = gapCodes(job);
    // All five Category C blockers LIFTED post-ε-4c.
    expect(codes).not.toContain("pds_salinan_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_state_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_country_no_canonical_mapping");
    expect(codes).not.toContain("pds_harta_cat_unknown_code");
    expect(codes).not.toContain("pds_harta_perabot_unknown_code");
  });

  test("apartment / studio / lain_lain remain blocked after ε-4c (semantic gaps, not evidence gaps)", () => {
    for (const buildingType of ["apartment", "studio", "lain_lain"] as const) {
      const property = propertyWithLandRegistry({});
      property.buildingType = buildingType;
      const job = makeJob({ property });
      const codes = gapCodes(job);
      expect(codes).toContain(
        `building_type_${buildingType}_no_portal_equivalent`
      );
    }
  });

  test("Perdagangan and Perindustrian remain blocked after ε-4 (no WeStamp enum mapping)", () => {
    for (const propertyType of ["perdagangan", "perindustrian"] as const) {
      const property = propertyWithLandRegistry({});
      property.propertyType = propertyType;
      const job = makeJob({ property });
      expect(gapCodes(job)).toContain(
        "pds_harta_cat_propertyType_unsupported"
      );
    }
  });
});

// ─── ε-4c · End-to-end ready_for_supervised_run ──────────────────
//
// The big test: a fully-captured fixed-rent residential tenancy with
// every operator-fillable field populated using post-ε-4c-seeded
// values must reach `ready_for_supervised_run`. This is the first
// build moment where the readiness verdict can pass — historically
// the gate was unsatisfiable. Future failures of this test mean
// either an unrelated regression or a new model/data requirement
// has been added.

describe("ε-4c · End-to-end ready_for_supervised_run", () => {
  /**
   * Build a fully-captured fixed-rent residential tenancy. Every
   * field below is the minimum needed to pass the readiness gate.
   * Values are chosen for the post-ε-4c seeded happy path:
   *   - Kuala Lumpur (state code 14)
   *   - Malaysia (country code 146)
   *   - Kediaman + kondominium (harta_cat code 1114)
   *   - fully_furnished (harta_perabot code 1122)
   *   - fixed_rent_during_tenancy (single rent period, no multi-pass)
   *   - duplicateCopies = 1 (salinan code "1")
   * Both parties are individuals with full A4 identity capture.
   */
  function buildFullyCapturedFixedRentJob(): TenancyPortalRunReadinessJobInput {
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

  test("Verdict reaches ready_for_supervised_run when every operator-fillable field is captured (post ε-4c)", () => {
    const job = buildFullyCapturedFixedRentJob();
    const report = evaluateTenancyPortalRunReadiness(job);
    // If this fails, surface the actual blockers so the test failure
    // message is a real diagnosis rather than a bare boolean miss.
    if (report.verdict !== "ready_for_supervised_run") {
      throw new Error(
        "Expected ready_for_supervised_run but got blocked. " +
          `portalFieldMappingGaps=${JSON.stringify(
            report.portalFieldMappingGaps.map((g) => g.code)
          )}; ` +
          `requiredDetailsStatus=${report.requiredDetailsStatus}, ` +
          `payloadStatus=${report.payloadStatus}, ` +
          `instructionDraftStatus=${report.instructionDraftStatus}, ` +
          `sourcePdfReady=${report.sourcePdfReady}; ` +
          `top blockingReasons (first 3)=${JSON.stringify(
            report.blockingReasons.slice(0, 3)
          )}`
      );
    }
    expect(report.verdict).toBe("ready_for_supervised_run");
    expect(report.portalFieldMappingGaps).toHaveLength(0);
    expect(report.blockingReasons).toHaveLength(0);
    expect(report.requiredDetailsStatus).toBe("ready");
    expect(report.payloadStatus).toBe("ready");
    expect(report.instructionDraftStatus).toBe("ready");
    expect(report.sourcePdfReady).toBe(true);
  });

  test("Removing any one operator-required field breaks the ready verdict (regression guard)", () => {
    const baseline = buildFullyCapturedFixedRentJob();

    // 1. Remove citizenshipCategory from landlord → individual blocker fires.
    const noCitizenship = JSON.parse(
      JSON.stringify(baseline)
    ) as typeof baseline;
    delete noCitizenship.tenancyPortalDetails!.parties[0]
      .citizenshipCategory;
    expect(
      evaluateTenancyPortalRunReadiness(noCitizenship).verdict
    ).toBe("blocked");

    // 2. Remove storagePath → sourcePdfReady false.
    const noPdf = JSON.parse(JSON.stringify(baseline)) as typeof baseline;
    noPdf.storagePath = "";
    expect(evaluateTenancyPortalRunReadiness(noPdf).verdict).toBe("blocked");

    // 3. Switch state to an unseeded one → state blocker fires.
    const badState = JSON.parse(
      JSON.stringify(baseline)
    ) as typeof baseline;
    badState.tenancyPortalDetails!.property!.state = "Atlantis";
    expect(
      evaluateTenancyPortalRunReadiness(badState).verdict
    ).toBe("blocked");

    // 4. Switch propertyType to perdagangan (no WeStamp enum coverage).
    const perdagangan = JSON.parse(
      JSON.stringify(baseline)
    ) as typeof baseline;
    perdagangan.tenancyPortalDetails!.property!.propertyType = "perdagangan";
    expect(
      evaluateTenancyPortalRunReadiness(perdagangan).verdict
    ).toBe("blocked");
  });

  test("Switching pds_jenis to amendment keeps the verdict blocked even with full operator capture (multi-pass gate)", () => {
    const job = buildFullyCapturedFixedRentJob();
    job.tenancyPortalDetails!.instrument!.portalDescriptionType =
      "amendment_to_original_tenancy";
    const report = evaluateTenancyPortalRunReadiness(job);
    expect(report.verdict).toBe("blocked");
    expect(
      report.portalFieldMappingGaps.map((g) => g.code)
    ).toContain("pds_jenis_1105_unsupported");
  });
});
