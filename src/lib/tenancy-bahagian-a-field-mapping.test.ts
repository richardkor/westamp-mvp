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

  test("warga is observed with three documented option codes", () => {
    const warga = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.portalFieldKey === "warga"
    );
    expect(warga).toBeDefined();
    expect(warga!.selectorCertainty).toBe("observed");
    expect(warga!.optionValuesCertainty).toBe("observed");
    expect(warga!.optionValues).toEqual([
      { code: "1", label: "Citizen" },
      { code: "2", label: "Non-citizen" },
      { code: "3", label: "Permanent Resident" },
    ]);
  });

  test("USER_SEX is observed selector but option codes still unknown", () => {
    const gender = BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.portalFieldKey === "USER_SEX"
    );
    expect(gender).toBeDefined();
    expect(gender!.selectorCertainty).toBe("observed");
    expect(gender!.optionValuesCertainty).toBe("unknown");
    expect(gender!.optionValues).toBeNull();
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
  test("no entry invents a selector — every entry's `selector` is null until live diagnosis", () => {
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    for (const e of all) {
      expect(e.selector).toBeNull();
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

  test("at the B8 evidence level, NO entry is yet executable (selectors not observed)", () => {
    // This is intentionally strict — until the modal-diagnosis
    // milestone documents live selectors, no Bahagian A field
    // should be marked executable. If a future milestone documents
    // selectors, this test will fail and prompt the developer to
    // intentionally relax it.
    const all: BahagianAFieldMappingEntry[] = [
      ...BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries,
      ...BAHAGIAN_A_COMPANY_SSM_REGISTRY.entries,
    ];
    const executableEntries = all.filter((e) => e.executable);
    expect(executableEntries).toEqual([]);
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
