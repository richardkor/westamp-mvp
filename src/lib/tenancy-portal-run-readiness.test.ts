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
    // Enum-mismatch (state/country canonical) still there
    expect(codes).toContain("pds_harta_state_no_canonical_mapping");
    expect(codes).toContain("pds_harta_country_no_canonical_mapping");
    // pds_salinan also still there
    expect(codes).toContain("pds_salinan_no_canonical_mapping");
    // But land-registry blockers are gone
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
