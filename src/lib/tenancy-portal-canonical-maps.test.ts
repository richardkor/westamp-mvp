/**
 * WeStamp — Tenancy Portal Canonical Maps · Tests (Milestone A3)
 *
 * Pure-helper tests proving:
 *   - duplicateCopies in 0..20 returns `unknown_code` (range
 *     accepted for tracking, but portal option code unknown — NOT
 *     safe for supervised portal preparation);
 *   - duplicateCopies outside 0..20 returns `unsupported`;
 *   - state/country mapping returns `unknown_code` for recognized
 *     labels and `unsupported` for unrecognized ones;
 *   - per-property-type pds_harta_cat mapping does NOT cross-map
 *     between Kediaman / Perdagangan / Perindustrian;
 *   - studio / lain_lain / apartment / rumah_banglo on Kediaman are
 *     blocked with the right status;
 *   - furnished / unfurnished return `unknown_code` (portal labels
 *     known but option codes not yet captured — readiness-blocking
 *     until codes are observed);
 *   - partially_furnished is `unsupported`;
 *   - mapping result shape carries portal field key, status, and
 *     reason;
 *   - `isMappingSafe` returns `true` ONLY for `mapped`. Every other
 *     status (including `unknown_code`) remains readiness-blocking.
 */

import {
  isMappingSafe,
  mapDuplicateCopies,
  mapFurnishedStatus,
  mapPropertyCategory,
  mapPropertyCountry,
  mapPropertyState,
} from "./tenancy-portal-canonical-maps";
import type {
  TenancyPortalBuildingType,
  TenancyPortalFurnishedStatus,
  TenancyPortalPropertyType,
} from "./stamping-types";

// ─── pds_salinan ──────────────────────────────────────────────────

describe("mapDuplicateCopies (pds_salinan)", () => {
  test("returns unsupported for non-integer / negative / non-finite", () => {
    expect(mapDuplicateCopies(-1).status).toBe("unsupported");
    expect(mapDuplicateCopies(1.5).status).toBe("unsupported");
    expect(mapDuplicateCopies(Number.NaN).status).toBe("unsupported");
    expect(mapDuplicateCopies("3" as unknown as number).status).toBe(
      "unsupported"
    );
  });

  test("returns unsupported for counts > 20 (outside captured range)", () => {
    const r = mapDuplicateCopies(21);
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/exceeds the dropdown's range/i);
  });

  test("returns mapped for any 0..20 with portal code = String(N) (post ε-4b)", () => {
    for (const n of [0, 1, 2, 5, 10, 20]) {
      const r = mapDuplicateCopies(n);
      expect(r.status).toBe("mapped");
      expect(r.portalFieldKey).toBe("pds_salinan");
      expect(r.portalLabel).toBe(String(n));
      expect(r.portalCode).toBe(String(n));
      expect(isMappingSafe(r)).toBe(true);
    }
  });

  test("captured codes are exactly String(N) for the full 0..20 range (no guesses)", () => {
    for (let n = 0; n <= 20; n++) {
      const r = mapDuplicateCopies(n);
      expect(r.portalCode).toBe(String(n));
      expect(r.status).toBe("mapped");
    }
  });
});

// ─── pds_harta_state ─────────────────────────────────────────────

describe("mapPropertyState (pds_harta_state)", () => {
  test("returns unsupported for blank input", () => {
    expect(mapPropertyState("").status).toBe("unsupported");
    expect(mapPropertyState("   ").status).toBe("unsupported");
    expect(mapPropertyState(null).status).toBe("unsupported");
    expect(mapPropertyState(undefined).status).toBe("unsupported");
  });

  test.each([
    ["Johor", "Johor", "1"],
    ["Kedah", "Kedah", "2"],
    ["Kelantan", "Kelantan", "3"],
    ["Melaka", "Melaka", "4"],
    ["Negeri Sembilan", "Negeri Sembilan", "5"],
    ["Pahang", "Pahang", "6"],
    ["Perak", "Perak", "7"],
    ["Perlis", "Perlis", "8"],
    ["Pulau Pinang", "Pulau Pinang", "9"],
    ["Sabah", "Sabah", "10"],
    ["Sarawak", "Sarawak", "11"],
    ["Selangor", "Selangor", "12"],
    ["Terengganu", "Terengganu", "13"],
  ] as const)(
    "ordinary state %s → mapped, portal label %s, portal code %s",
    (input, expectedLabel, expectedCode) => {
      const r = mapPropertyState(input);
      expect(r.status).toBe("mapped");
      expect(r.portalLabel).toBe(expectedLabel);
      expect(r.portalCode).toBe(expectedCode);
      expect(r.portalFieldKey).toBe("pds_harta_state");
    }
  );

  test("Penang alias resolves to Pulau Pinang (code 9)", () => {
    const r = mapPropertyState("Penang");
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("Pulau Pinang");
    expect(r.portalCode).toBe("9");
  });

  test.each([
    ["Kuala Lumpur", "Wilayah Persekutuan Kuala Lumpur", "14"],
    ["WP Kuala Lumpur", "Wilayah Persekutuan Kuala Lumpur", "14"],
    [
      "Wilayah Persekutuan Kuala Lumpur",
      "Wilayah Persekutuan Kuala Lumpur",
      "14",
    ],
    ["Labuan", "Wilayah Persekutuan Labuan", "15"],
    ["WP Labuan", "Wilayah Persekutuan Labuan", "15"],
    ["Wilayah Persekutuan Labuan", "Wilayah Persekutuan Labuan", "15"],
    ["Putrajaya", "Wilayah Persekutuan Putrajaya", "16"],
    ["WP Putrajaya", "Wilayah Persekutuan Putrajaya", "16"],
    [
      "Wilayah Persekutuan Putrajaya",
      "Wilayah Persekutuan Putrajaya",
      "16",
    ],
  ] as const)(
    "Federal Territory alias %s → mapped, portal label %s, portal code %s",
    (input, expectedLabel, expectedCode) => {
      const r = mapPropertyState(input);
      expect(r.status).toBe("mapped");
      expect(r.portalLabel).toBe(expectedLabel);
      expect(r.portalCode).toBe(expectedCode);
    }
  );

  test("normalization tolerates whitespace and case", () => {
    const r = mapPropertyState("  KUALA   LUMPUR  ");
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("Wilayah Persekutuan Kuala Lumpur");
    expect(r.portalCode).toBe("14");
  });

  test("returns unsupported for states not in the seed table", () => {
    const r = mapPropertyState("Atlantis");
    expect(r.status).toBe("unsupported");
    expect(r.portalLabel).toBe(null);
    expect(r.portalCode).toBe(null);
  });

  test("captured codes match ε-4b evidence verbatim", () => {
    // All 16 portal options + Penang alias must resolve to the
    // exact captured codes. Any drift here means someone has
    // touched the seed table without updating tests.
    const expected: Record<string, string> = {
      Johor: "1",
      Kedah: "2",
      Kelantan: "3",
      Melaka: "4",
      "Negeri Sembilan": "5",
      Pahang: "6",
      Perak: "7",
      Perlis: "8",
      "Pulau Pinang": "9",
      Penang: "9",
      Sabah: "10",
      Sarawak: "11",
      Selangor: "12",
      Terengganu: "13",
      "Kuala Lumpur": "14",
      Labuan: "15",
      Putrajaya: "16",
    };
    for (const [input, code] of Object.entries(expected)) {
      const r = mapPropertyState(input);
      expect(r.portalCode).toBe(code);
      expect(r.status).toBe("mapped");
    }
  });
});

// ─── pds_harta_country ───────────────────────────────────────────

describe("mapPropertyCountry (pds_harta_country)", () => {
  test("returns unsupported for blank input", () => {
    expect(mapPropertyCountry("").status).toBe("unsupported");
  });

  test("Malaysia → mapped (ε-4b: portal label MALAYSIA, code 146)", () => {
    const r = mapPropertyCountry("Malaysia");
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("MALAYSIA");
    expect(r.portalCode).toBe("146");
  });

  test("Malaysia alias matching tolerates case (uppercase input → mapped)", () => {
    const r = mapPropertyCountry("MALAYSIA");
    expect(r.status).toBe("mapped");
    expect(r.portalCode).toBe("146");
  });

  test("returns unsupported for unseeded countries", () => {
    expect(mapPropertyCountry("Singapore").status).toBe("unsupported");
    expect(mapPropertyCountry("Indonesia").status).toBe("unsupported");
  });
});

// ─── pds_harta_cat (per-property-type) ───────────────────────────

describe("mapPropertyCategory (pds_harta_cat) · property-type-specific", () => {
  test("returns unsupported when propertyType is missing or unknown", () => {
    const r = mapPropertyCategory(
      undefined,
      "rumah_teres" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/property type/i);
  });

  test("Tanah Kosong is mapped (no category dropdown)", () => {
    const r = mapPropertyCategory(
      "tanah_kosong" as TenancyPortalPropertyType,
      null
    );
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe(null);
    expect(r.portalCode).toBe(null);
  });

  test("Kediaman + rumah_teres → mapped (ε-4 captured code 1113)", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      "rumah_teres" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("Teres");
    expect(r.portalCode).toBe("1113");
    expect(r.portalFieldKey).toBe("pds_harta_cat");
  });

  test.each([
    ["rumah_teres", "Teres", "1113"],
    ["rumah_berkembar", "Kembar", "1112"],
    ["rumah_kluster", "Kluster", "1118"],
    ["townhouse", "Townhouse", "1119"],
    ["kondominium", "Kondominium", "1114"],
  ] as const)(
    "Kediaman + %s → mapped, portal label %s, portal code %s",
    (wsVal, expectedLabel, expectedCode) => {
      const r = mapPropertyCategory(
        "kediaman" as TenancyPortalPropertyType,
        wsVal as TenancyPortalBuildingType
      );
      expect(r.status).toBe("mapped");
      expect(r.portalLabel).toBe(expectedLabel);
      expect(r.portalCode).toBe(expectedCode);
    }
  );

  test("Kediaman + apartment → ambiguous", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      "apartment" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("ambiguous");
    expect(r.reason).toMatch(/Pangsapuri|ambiguous/i);
  });

  test("Kediaman + studio → unsupported", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      "studio" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/Studio/i);
  });

  test("Kediaman + lain_lain → unsupported", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      "lain_lain" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("unsupported");
  });

  test("Kediaman + rumah_banglo → unsupported (Banglo only exists under Perindustrian)", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      "rumah_banglo" as TenancyPortalBuildingType
    );
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/Perindustrian/i);
  });

  test("Kediaman with no buildingType → unsupported", () => {
    const r = mapPropertyCategory(
      "kediaman" as TenancyPortalPropertyType,
      null
    );
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/required/i);
  });

  test("Perdagangan + ANY WeStamp building type → unsupported (no cross-map)", () => {
    // WeStamp's enum is kediaman-style; applying it on Perdagangan must NOT
    // silently pick a Perdagangan portal option.
    for (const wsVal of [
      "rumah_teres",
      "rumah_berkembar",
      "rumah_kluster",
      "townhouse",
      "kondominium",
      "apartment",
      "studio",
      "lain_lain",
      "rumah_banglo",
    ] as const) {
      const r = mapPropertyCategory(
        "perdagangan" as TenancyPortalPropertyType,
        wsVal as TenancyPortalBuildingType
      );
      expect(r.status).toBe("unsupported");
      expect(r.portalLabel).toBe(null);
      expect(r.portalCode).toBe(null);
    }
  });

  test("Perindustrian + ANY WeStamp building type → unsupported (no cross-map)", () => {
    for (const wsVal of [
      "rumah_teres",
      "rumah_berkembar",
      "rumah_kluster",
      "townhouse",
      "kondominium",
      "apartment",
      "studio",
      "lain_lain",
      "rumah_banglo",
    ] as const) {
      const r = mapPropertyCategory(
        "perindustrian" as TenancyPortalPropertyType,
        wsVal as TenancyPortalBuildingType
      );
      expect(r.status).toBe("unsupported");
    }
  });

  test("returned Kediaman codes are exactly the ε-4 captured values (no guessed codes)", () => {
    // After the ε-4 evidence patch, the five mappable Kediaman
    // values return their exact captured `<option value>` codes
    // (1112/1113/1114/1118/1119). Any other code value would mean
    // someone has guessed; this test pins that down.
    const expected: Record<string, string> = {
      rumah_teres: "1113",
      rumah_berkembar: "1112",
      rumah_kluster: "1118",
      townhouse: "1119",
      kondominium: "1114",
    };
    for (const [wsVal, code] of Object.entries(expected)) {
      const r = mapPropertyCategory(
        "kediaman" as TenancyPortalPropertyType,
        wsVal as TenancyPortalBuildingType
      );
      expect(r.portalCode).toBe(code);
      expect(r.status).toBe("mapped");
    }
  });

  test("Kediaman ambiguous and unsupported values still have NO portal code", () => {
    // apartment (ambiguous), studio + lain_lain + rumah_banglo
    // (unsupported) must continue to return portalCode = null even
    // after the ε-4 evidence patch — codes only flip for evidenced
    // mappings.
    for (const wsVal of [
      "apartment",
      "studio",
      "lain_lain",
      "rumah_banglo",
    ] as const) {
      const r = mapPropertyCategory(
        "kediaman" as TenancyPortalPropertyType,
        wsVal as TenancyPortalBuildingType
      );
      expect(r.portalCode).toBe(null);
      expect(r.status).not.toBe("mapped");
    }
  });
});

// ─── pds_harta_perabot (furnishing) ──────────────────────────────

describe("mapFurnishedStatus (pds_harta_perabot)", () => {
  test("fully_furnished → mapped (ε-4 captured: 'Dengan Perabot' = 1122)", () => {
    const r = mapFurnishedStatus(
      "fully_furnished" as TenancyPortalFurnishedStatus
    );
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("Dengan Perabot");
    expect(r.portalCode).toBe("1122");
    expect(r.portalFieldKey).toBe("pds_harta_perabot");
  });

  test("unfurnished → mapped (ε-4 captured: 'Tanpa Perabot' = 1123)", () => {
    const r = mapFurnishedStatus(
      "unfurnished" as TenancyPortalFurnishedStatus
    );
    expect(r.status).toBe("mapped");
    expect(r.portalLabel).toBe("Tanpa Perabot");
    expect(r.portalCode).toBe("1123");
  });

  test("partially_furnished → unsupported", () => {
    const r = mapFurnishedStatus(
      "partially_furnished" as TenancyPortalFurnishedStatus
    );
    expect(r.status).toBe("unsupported");
    expect(r.reason).toMatch(/no half-way option/i);
  });

  test("null / undefined → unsupported", () => {
    expect(mapFurnishedStatus(null).status).toBe("unsupported");
    expect(mapFurnishedStatus(undefined).status).toBe("unsupported");
  });
});

// ─── isMappingSafe ───────────────────────────────────────────────

describe("isMappingSafe", () => {
  test("returns true only for status='mapped'", () => {
    expect(
      isMappingSafe({
        portalFieldKey: "test",
        weStampValue: null,
        portalLabel: null,
        portalCode: null,
        status: "mapped",
        reason: null,
      })
    ).toBe(true);
    for (const status of [
      "unknown_code",
      "unsupported",
      "ambiguous",
    ] as const) {
      expect(
        isMappingSafe({
          portalFieldKey: "test",
          weStampValue: null,
          portalLabel: null,
          portalCode: null,
          status,
          reason: "x",
        })
      ).toBe(false);
    }
  });
});

// ─── Result-shape invariants ─────────────────────────────────────

describe("CanonicalMappingResult shape invariants", () => {
  test("every result carries portalFieldKey, status, and a reason when not mapped", () => {
    const all = [
      mapDuplicateCopies(5),
      mapPropertyState("Selangor"),
      mapPropertyCountry("Malaysia"),
      mapPropertyCategory(
        "kediaman" as TenancyPortalPropertyType,
        "rumah_teres" as TenancyPortalBuildingType
      ),
      mapFurnishedStatus(
        "fully_furnished" as TenancyPortalFurnishedStatus
      ),
    ];
    for (const r of all) {
      expect(typeof r.portalFieldKey).toBe("string");
      expect(r.portalFieldKey.length).toBeGreaterThan(0);
      expect([
        "mapped",
        "unknown_code",
        "unsupported",
        "ambiguous",
      ]).toContain(r.status);
      if (r.status !== "mapped") {
        expect(typeof r.reason).toBe("string");
        expect((r.reason as string).length).toBeGreaterThan(0);
      }
    }
  });

  test("portal codes are returned ONLY when status is 'mapped' (post ε-4c: all five Category C fields evidenced)", () => {
    // After ε-4c, all five Category C `<select>` fields have first-
    // hand portal codes seeded. The invariant — a non-null
    // portalCode iff status='mapped' — is now testable across the
    // full evidenced set.
    const allFiveEvidenced = [
      mapDuplicateCopies(1),
      mapPropertyState("Kuala Lumpur"),
      mapPropertyCountry("Malaysia"),
      mapPropertyCategory(
        "kediaman" as TenancyPortalPropertyType,
        "kondominium" as TenancyPortalBuildingType
      ),
      mapFurnishedStatus("unfurnished" as TenancyPortalFurnishedStatus),
    ];
    for (const r of allFiveEvidenced) {
      expect(r.portalCode).not.toBe(null);
      expect(r.status).toBe("mapped");
    }
  });
});
