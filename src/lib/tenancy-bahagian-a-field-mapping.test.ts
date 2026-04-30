/**
 * WeStamp — Tenancy Bahagian A Field Mapping Registry · tests
 *
 * Covers Milestone B8 Part 2.
 */

import {
  BAHAGIAN_A_INDIVIDUAL_REGISTRY,
  BAHAGIAN_A_COMPANY_SSM_REGISTRY,
  getBahagianAFieldMappingRegistry,
  summarizeBahagianAFieldMapping,
  type BahagianAFieldMappingEntry,
} from "./tenancy-bahagian-a-field-mapping";

// ─── Per-registry shape sanity ─────────────────────────────────────

describe("Bahagian A · field mapping · individual registry", () => {
  test("partyType is `individual`", () => {
    expect(BAHAGIAN_A_INDIVIDUAL_REGISTRY.partyType).toBe("individual");
  });

  test("includes the four observed Bahagian A enum portal field keys", () => {
    const portalKeys = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries
      .map((e) => e.portalFieldKey)
      .filter((k): k is string => typeof k === "string");
    expect(portalKeys).toContain("warga");
    expect(portalKeys).toContain("EPD_NOKP_TYPE");
    expect(portalKeys).toContain("USER_SEX");
  });

  test("includes name / identity / address / mobile internal keys", () => {
    const internalKeys = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.map(
      (e) => e.internalKey
    );
    for (const k of [
      "nameAsPerInstrument",
      "citizenshipCategory",
      "identityType",
      "identityNumber",
      "nricSubType",
      "gender",
      "addressLine1",
      "postcode",
      "city",
      "state",
      "country",
      "mobile",
    ]) {
      expect(internalKeys).toContain(k);
    }
  });

  test("warga is observed with the live B9 option codes (Bahasa Malaysia labels)", () => {
    const warga = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "citizenshipCategory"
    );
    expect(warga).toBeDefined();
    expect(warga!.selectorCertainty).toBe("observed");
    expect(warga!.optionValuesCertainty).toBe("observed");
    expect(warga!.selector).toBe("select#warga");
    // Codes match the live B9 capture; labels are the live Bahasa
    // Malaysia strings.
    expect(warga!.optionValues).toEqual([
      { code: "1", label: "Warganegara" },
      { code: "3", label: "Penduduk Tetap" },
      { code: "2", label: "Bukan Warganegara" },
    ]);
  });

  test("USER_SEX is observed as a 2-option radio_group (B9 live evidence)", () => {
    const gender = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "gender"
    );
    expect(gender).toBeDefined();
    expect(gender!.fieldKind).toBe("radio_group");
    expect(gender!.selector).toBe('input[name="USER_SEX"]');
    expect(gender!.selectorCertainty).toBe("observed");
    expect(gender!.optionValuesCertainty).toBe("observed");
    expect(gender!.optionValues).toEqual([
      { code: "USER_SEX-1", label: "Lelaki" },
      { code: "USER_SEX-2", label: "Perempuan" },
    ]);
  });

  test("nricSubType is observed as a 4-option radio_group with portal IDs as codes", () => {
    const sub = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "nricSubType"
    );
    expect(sub).toBeDefined();
    expect(sub!.fieldKind).toBe("radio_group");
    expect(sub!.selector).toBe('input[name="EPD_NOKP_TYPE"]');
    expect(sub!.optionValues?.map((o) => o.code)).toEqual([
      "IC_BARU",
      "IC_LAMA",
      "IC_POLIS",
      "IC_ARMY",
    ]);
  });

  test("identityNumber selector is observed (#kpin) with disabled-by-default behavior noted", () => {
    const id = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "identityNumber"
    );
    expect(id).toBeDefined();
    expect(id!.selector).toBe("input#kpin");
    expect(id!.note).toMatch(/disabled by default/i);
  });

  test("address / city / postcode / mobile selectors are observed live", () => {
    const get = (key: string) =>
      BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
        (e) => e.internalKey === key
      );
    expect(get("addressLine1")!.selector).toBe("input#tb_alamat_1");
    expect(get("addressLine2")!.selector).toBe("input#tb_alamat_2");
    expect(get("city")!.selector).toBe("input#tb_city");
    expect(get("postcode")!.selector).toBe("input#tb_poskod");
    expect(get("mobile")!.selector).toBe("input#tb_telno");
  });

  test("state (negeri1) carries 17 observed options", () => {
    const state = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "state"
    );
    expect(state!.selector).toBe("select#negeri1");
    expect(state!.optionValuesCertainty).toBe("observed");
    expect(state!.optionValues).toHaveLength(17);
    // Spot-check a few key codes.
    expect(
      state!.optionValues!.find((o) => o.label === "Selangor")?.code
    ).toBe("12");
    expect(
      state!.optionValues!.find((o) => o.label === "Wilayah Persekutuan Kuala Lumpur")?.code
    ).toBe("14");
  });

  test("country (negara2) is observed but options remain partial → certainty = inferred", () => {
    const c = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "country"
    );
    expect(c!.selector).toBe("select#negara2");
    expect(c!.selectorCertainty).toBe("observed");
    expect(c!.optionValuesCertainty).toBe("inferred");
  });

  test("phone has no portal counterpart and remains unknown", () => {
    const phone = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === "phone"
    );
    expect(phone!.selector).toBeNull();
    expect(phone!.selectorCertainty).toBe("unknown");
  });

  test("every individual-registry entry carries roleScope=`shared` (B9 live evidence — both modals share the field surface)", () => {
    for (const e of BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries) {
      expect({ key: e.internalKey, scope: e.roleScope }).toEqual({
        key: e.internalKey,
        scope: "shared",
      });
    }
  });
});

describe("Bahagian A · field mapping · company SSM registry", () => {
  test("partyType is `company_ssm`", () => {
    expect(BAHAGIAN_A_COMPANY_SSM_REGISTRY.partyType).toBe("company_ssm");
  });

  test("includes the SSM-specific portal field keys", () => {
    const portalKeys = BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries
      .map((e) => e.portalFieldKey)
      .filter((k): k is string => typeof k === "string");
    expect(portalKeys).toContain("tb_roc");
    expect(portalKeys).toContain("tb_roc_new");
    expect(portalKeys).toContain("jenis_perniagaan");
    expect(portalKeys).toContain("tb_syarikat");
    expect(portalKeys).toContain("owner_name");
  });

  test("includes the representative sub-block internal keys", () => {
    const internalKeys = BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries.map(
      (e) => e.internalKey
    );
    for (const k of [
      "companyRepresentative.ownerName",
      "companyRepresentative.citizenshipCategory",
      "companyRepresentative.identityType",
      "companyRepresentative.identityNumber",
      "companyRepresentative.nricSubType",
      "companyRepresentative.gender",
    ]) {
      expect(internalKeys).toContain(k);
    }
  });

  test("jenis_perniagaan is observed but its option codes are unknown — non-executable", () => {
    const bt = BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries.find(
      (e) => e.portalFieldKey === "jenis_perniagaan"
    );
    expect(bt).toBeDefined();
    expect(bt!.selectorCertainty).toBe("observed");
    expect(bt!.optionValuesCertainty).toBe("unknown");
    expect(bt!.executable).toBe(false);
  });
});

// ─── Cross-registry invariants ─────────────────────────────────────

describe("Bahagian A · field mapping · invariants", () => {
  test("no entry invents a selector — entries either carry a live-observed selector or `null`", () => {
    // After B9 live capture, individual registry entries carry
    // concrete selectors. SSM entries remain `null` until that
    // modal is captured live. The invariant is now: every selector
    // is either a non-empty string OR strictly `null` — never a
    // zero-length string, never a guessed pattern.
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    for (const e of all) {
      if (e.selector === null) continue;
      expect(typeof e.selector).toBe("string");
      expect(e.selector.length).toBeGreaterThan(0);
    }
  });

  test("any unknown selectorCertainty implies non-executable", () => {
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    for (const e of all) {
      if (e.selectorCertainty === "unknown") {
        expect({ key: e.internalKey, executable: e.executable }).toEqual({
          key: e.internalKey,
          executable: false,
        });
      }
    }
  });

  test("any select-type entry with unknown optionValuesCertainty is non-executable", () => {
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    for (const e of all) {
      if (e.fieldKind === "select" && e.optionValuesCertainty === "unknown") {
        expect({ key: e.internalKey, executable: e.executable }).toEqual({
          key: e.internalKey,
          executable: false,
        });
      }
    }
  });

  test("B9 evidence level: individual-registry entries with both selector AND option values are executable", () => {
    // After B9 live capture, the individual registry has multiple
    // executable entries. Anti-regression bound: at least 5 entries
    // must be executable (the live capture observed 23 fields; we
    // mapped 12+ to internal keys; selects + radio_groups need
    // option codes; text inputs only need a selector).
    const indExecutable = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.filter(
      (e) => e.executable
    );
    expect(indExecutable.length).toBeGreaterThanOrEqual(5);

    // Specific spot-checks: name, citizenship, gender, state, mobile
    // are all executable (selectors + option codes captured).
    const get = (k: string) =>
      BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find((e) => e.internalKey === k);
    expect(get("nameAsPerInstrument")?.executable).toBe(true);
    expect(get("citizenshipCategory")?.executable).toBe(true);
    expect(get("gender")?.executable).toBe(true);
    expect(get("state")?.executable).toBe(true);
    expect(get("mobile")?.executable).toBe(true);
    expect(get("addressLine1")?.executable).toBe(true);
    expect(get("postcode")?.executable).toBe(true);
    expect(get("city")?.executable).toBe(true);

    // SSM registry remains non-executable (modal not captured yet).
    const ssmExecutable = BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries.filter(
      (e) => e.executable
    );
    expect(ssmExecutable).toEqual([]);
  });

  test("certainty values are drawn from the closed enum", () => {
    const allowed = new Set(["observed", "inferred", "unknown"]);
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    for (const e of all) {
      expect(allowed.has(e.selectorCertainty)).toBe(true);
      expect(allowed.has(e.optionValuesCertainty)).toBe(true);
    }
  });
});

// ─── Lookup helper ─────────────────────────────────────────────────

describe("Bahagian A · field mapping · lookup helper", () => {
  test("getBahagianAFieldMappingRegistry returns the correct registry per party type", () => {
    expect(getBahagianAFieldMappingRegistry("individual")).toBe(
      BAHAGIAN_A_INDIVIDUAL_REGISTRY
    );
    expect(getBahagianAFieldMappingRegistry("company_ssm")).toBe(
      BAHAGIAN_A_COMPANY_SSM_REGISTRY
    );
  });

  test("getBahagianAFieldMappingRegistry returns null for company_non_ssm (no registry yet)", () => {
    expect(getBahagianAFieldMappingRegistry("company_non_ssm")).toBeNull();
  });
});

// ─── Summary helper ────────────────────────────────────────────────

describe("Bahagian A · field mapping · summary helper", () => {
  test("summary counts add up to totalEntries on the individual registry", () => {
    const s = summarizeBahagianAFieldMapping(BAHAGIAN_A_INDIVIDUAL_REGISTRY);
    expect(s.partyType).toBe("individual");
    expect(s.totalEntries).toBe(BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.length);
    expect(
      s.observedSelectors + s.inferredSelectors + s.unknownSelectors
    ).toBe(s.totalEntries);
    expect(
      s.observedOptionValueLists +
        s.inferredOptionValueLists +
        s.unknownOptionValueLists
    ).toBe(s.totalEntries);
    expect(s.executableEntries).toBeGreaterThanOrEqual(0);
    expect(s.executableEntries).toBeLessThanOrEqual(s.totalEntries);
  });

  test("summary counts add up to totalEntries on the SSM registry", () => {
    const s = summarizeBahagianAFieldMapping(BAHAGIAN_A_COMPANY_SSM_REGISTRY);
    expect(s.partyType).toBe("company_ssm");
    expect(s.totalEntries).toBe(BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries.length);
    expect(
      s.observedSelectors + s.inferredSelectors + s.unknownSelectors
    ).toBe(s.totalEntries);
  });
});
