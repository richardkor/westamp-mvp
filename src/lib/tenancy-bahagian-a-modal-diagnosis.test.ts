/**
 * WeStamp — Tenancy Bahagian A Modal Diagnosis · tests
 *
 * Covers Milestone B8 Part 3 (data shapes only — the live driver
 * is operator-only and does not ship in the executable bundle).
 */

import {
  BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS,
  findForbiddenSubstringsInDiagnosisResult,
  makeNotAttemptedDiagnosisResult,
  type BahagianAModalDiagnosisResult,
  type BahagianAModalSnapshot,
  type BahagianATableSnapshot,
} from "./tenancy-bahagian-a-modal-diagnosis";

// ─── Stable wording / shape ────────────────────────────────────────

describe("Bahagian A · modal diagnosis · wording map", () => {
  test("every status has a non-empty next-operator-action string", () => {
    for (const status of [
      "not_attempted",
      "browser_unreachable",
      "p5_form_not_detected",
      "table_only_inspected",
      "modal_inspected",
    ] as const) {
      const text = BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS[status];
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe("Bahagian A · modal diagnosis · not-attempted stub", () => {
  test("makeNotAttemptedDiagnosisResult returns a diagnosable shape", () => {
    const stub = makeNotAttemptedDiagnosisResult("2026-04-30T00:00:00Z");
    expect(stub.status).toBe("not_attempted");
    expect(stub.diagnosedAt).toBe("2026-04-30T00:00:00Z");
    expect(stub.table).toBeNull();
    expect(stub.modal).toBeNull();
    expect(stub.nextOperatorAction).toBe(
      BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS.not_attempted
    );
  });
});

// ─── Type-shape sanity (compile-time + runtime) ────────────────────

describe("Bahagian A · modal diagnosis · result types accommodate observed labels and selectors", () => {
  test("table_only_inspected result can carry headers + button observations", () => {
    const table: BahagianATableSnapshot = {
      present: true,
      rowCount: 0,
      headers: [
        "Bil.",
        "Nama",
        "No. Pengenalan",
        "Peranan",
        "Tindakan",
      ],
      buttons: [
        {
          internalKey: "tambah_individu",
          labelObserved: "Tambah Individu",
          selectorObserved: "button#btn_tambah_individu",
          visible: true,
          disabled: false,
        },
        {
          internalKey: "tambah_syarikat_ssm",
          labelObserved: "Tambah Syarikat (SSM)",
          selectorObserved: "button#btn_tambah_syarikat_ssm",
          visible: true,
          disabled: false,
        },
      ],
    };
    const result: BahagianAModalDiagnosisResult = {
      status: "table_only_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table,
      modal: null,
      nextOperatorAction:
        BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS.table_only_inspected,
    };
    expect(result.table?.headers).toHaveLength(5);
    expect(result.table?.buttons).toHaveLength(2);
    expect(result.table?.buttons[0].internalKey).toBe("tambah_individu");
  });

  test("modal_inspected result can carry observed labels / selectors / option codes", () => {
    const modal: BahagianAModalSnapshot = {
      opened: true,
      titleObserved: "Tambah Pihak (Individu)",
      fieldCount: 4,
      fields: [
        {
          selectorObserved: 'select[name="warga"]',
          fieldKind: "select",
          nameAttr: "warga",
          idAttr: "warga",
          labelObserved: "Warga",
          disabled: false,
          hidden: false,
          readonly: false,
          options: [
            { code: "1", label: "Citizen" },
            { code: "2", label: "Non-citizen" },
            { code: "3", label: "Permanent Resident" },
          ],
          selectedValueCategory: "empty",
        },
        {
          selectorObserved: 'select[name="USER_SEX"]',
          fieldKind: "select",
          nameAttr: "USER_SEX",
          idAttr: "USER_SEX",
          labelObserved: "Jantina",
          disabled: false,
          hidden: false,
          readonly: false,
          options: [
            { code: "M", label: "Lelaki" },
            { code: "F", label: "Perempuan" },
          ],
          selectedValueCategory: "empty",
        },
      ],
    };
    const result: BahagianAModalDiagnosisResult = {
      status: "modal_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: null,
      modal,
      nextOperatorAction:
        BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS.modal_inspected,
    };
    expect(result.modal?.opened).toBe(true);
    expect(result.modal?.fields).toHaveLength(2);
    expect(result.modal?.fields[0].nameAttr).toBe("warga");
    expect(result.modal?.fields[0].options).toHaveLength(3);
    expect(result.modal?.fields[1].selectedValueCategory).toBe("empty");
  });
});

// ─── Sensitive-data invariant ──────────────────────────────────────

describe("Bahagian A · modal diagnosis · sensitive-data invariant", () => {
  test("a clean modal_inspected result with portal labels and option codes is sensitive-data-free", () => {
    const result: BahagianAModalDiagnosisResult = {
      status: "modal_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: null,
      modal: {
        opened: true,
        titleObserved: "Tambah Pihak (Individu)",
        fieldCount: 1,
        fields: [
          {
            selectorObserved: 'select[name="warga"]',
            fieldKind: "select",
            nameAttr: "warga",
            idAttr: "warga",
            labelObserved: "Warga",
            disabled: false,
            hidden: false,
            readonly: false,
            options: [
              { code: "1", label: "Citizen" },
              { code: "2", label: "Non-citizen" },
              { code: "3", label: "Permanent Resident" },
            ],
            selectedValueCategory: "empty",
          },
        ],
      },
      nextOperatorAction:
        BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS.modal_inspected,
    };
    expect(findForbiddenSubstringsInDiagnosisResult(result)).toEqual([]);
  });

  test("the invariant catches IC-shaped strings if they accidentally appear", () => {
    const result: BahagianAModalDiagnosisResult = {
      status: "modal_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: null,
      modal: {
        opened: true,
        titleObserved: null,
        fieldCount: 1,
        fields: [
          {
            selectorObserved: 'input[name="leak"]',
            fieldKind: "input_text",
            nameAttr: "leak",
            idAttr: null,
            labelObserved: "900101015555",
            disabled: false,
            hidden: false,
            readonly: false,
            options: null,
            selectedValueCategory: null,
          },
        ],
      },
      nextOperatorAction: "ok",
    };
    const hits = findForbiddenSubstringsInDiagnosisResult(result);
    expect(hits).toContain("12-digit IC");
  });

  test("the invariant catches http URLs", () => {
    const result: BahagianAModalDiagnosisResult = {
      status: "table_only_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: {
        present: true,
        rowCount: 0,
        headers: ["See https://leak.example for details"],
        buttons: [],
      },
      modal: null,
      nextOperatorAction: "ok",
    };
    expect(findForbiddenSubstringsInDiagnosisResult(result)).toContain(
      "http URL"
    );
  });

  test("the invariant catches lhdnmsstoken substrings", () => {
    const result: BahagianAModalDiagnosisResult = {
      status: "table_only_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: {
        present: true,
        rowCount: 0,
        headers: ["lhdnmsstoken=abc"],
        buttons: [],
      },
      modal: null,
      nextOperatorAction: "ok",
    };
    expect(findForbiddenSubstringsInDiagnosisResult(result)).toContain(
      "lhdnmsstoken"
    );
  });

  test("the invariant DOES allow the literal word 'token' inside portal vocabulary as long as not in token-keyword pattern", () => {
    // The rule is narrow on purpose — 'token' alone (without
    // 'authorization' / 'bearer' / 'lhdnmsstoken' / 'cookie')
    // does NOT trigger. Portal labels may legitimately use the
    // word in local contexts.
    const result: BahagianAModalDiagnosisResult = {
      status: "modal_inspected",
      diagnosedAt: "2026-04-30T00:00:00Z",
      table: null,
      modal: {
        opened: true,
        titleObserved: "Set Token Pengenalan",
        fieldCount: 0,
        fields: [],
      },
      nextOperatorAction: "ok",
    };
    expect(findForbiddenSubstringsInDiagnosisResult(result)).toEqual([]);
  });
});

// ─── B8 boundary: no execution affordances introduced ──────────────

describe("Bahagian A · modal diagnosis · execution boundary", () => {
  test("no diagnosis status implies a row was saved or any portal action was taken", () => {
    for (const status of [
      "not_attempted",
      "browser_unreachable",
      "p5_form_not_detected",
      "table_only_inspected",
      "modal_inspected",
    ] as const) {
      const text = BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS[status];
      expect(text).not.toMatch(/\bsaved\b/i);
      expect(text).not.toMatch(/\bsubmitted\b/i);
      expect(text).not.toMatch(/\bcommitted\b/i);
      expect(text).not.toMatch(/\bHantar\b/i);
      expect(text).not.toMatch(/\bpaid\b/i);
      expect(text).not.toMatch(/certificate retrieved/i);
    }
  });
});
