/**
 * WeStamp — Tenancy Bahagian A · Modal Diagnosis Result Types (Milestone B8)
 *
 * Pure data-shape module describing the result of an operator-
 * assisted, read-only diagnosis of the Bahagian A table + the
 * "Tambah" party-add modal. No Playwright runtime here — the live
 * diagnosis driver is a separate operator-only script (it does not
 * ship in the executable bundle for B8).
 *
 * Why a types module at all
 * ─────────────────────────
 * The diagnosis output has to be predictable so the operator UI
 * (and the future B-impl Phase 3 executor) can consume it without
 * caring how it was produced. Keeping the shape here:
 *   - lets tests assert the shape without booting Playwright;
 *   - keeps the module portable between server / browser bundles
 *     (no Playwright import → no `'net'` resolve failure);
 *   - documents what counts as a complete vs incomplete diagnosis.
 *
 * Sensitive-data policy
 * ─────────────────────
 * Per the "moving faster" working-style update:
 *   - Operator-only diagnostic output MAY include actual portal
 *     labels, observed `<option value>` codes, and observed
 *     `<input name>` / `<select name>` attribute values.
 *   - Operator-only diagnostic output MUST NOT include party PII
 *     (raw IC numbers, full party names typed into the modal,
 *     etc.) — those live in the job record and never need to be
 *     re-echoed by a diagnostic.
 *   - Operator-only diagnostic output MUST NOT include cookies,
 *     tokens, lhdnmsstoken, raw URLs, query strings, or hrefs.
 */

// ─── Outer status enum ─────────────────────────────────────────────

/** Top-level diagnosis status. */
export type BahagianAModalDiagnosisStatus =
  /** No diagnosis has been performed for this job yet. */
  | "not_attempted"
  /** Browser/CDP not reachable — diagnosis aborted before contact. */
  | "browser_unreachable"
  /** No Sewa/Pajakan p5 form was found in the live tabs. */
  | "p5_form_not_detected"
  /**
   * The Bahagian A table was inspected but the Tambah modal was
   * not open at diagnosis time. The operator must manually open
   * the modal before a fuller diagnosis can run.
   */
  | "table_only_inspected"
  /**
   * The Tambah modal was open and its fields were observed. This
   * is the most complete diagnosis level B8 supports.
   */
  | "modal_inspected";

// ─── Table-level snapshot ──────────────────────────────────────────

/**
 * Categorised record of an `<button>` / `<input type="button">`
 * observed near the Bahagian A table (typically the Tambah trigger
 * for individual / SSM / non-SSM parties).
 */
export interface BahagianATableButtonObservation {
  /**
   * Stable internal key the executor will use later
   * (`tambah_individu` / `tambah_syarikat_ssm` /
   * `tambah_syarikat_bukan_ssm`). When the diagnostic could not
   * map the observed button to a known internal key, this carries
   * `null`.
   */
  internalKey:
    | "tambah_individu"
    | "tambah_syarikat_ssm"
    | "tambah_syarikat_bukan_ssm"
    | null;
  /** Operator-facing label exactly as observed. */
  labelObserved: string | null;
  /** Concrete CSS selector that resolves the button uniquely. */
  selectorObserved: string | null;
  /** Whether the button was visible at diagnosis time. */
  visible: boolean;
  /** Whether the button was disabled at diagnosis time. */
  disabled: boolean;
}

/** Snapshot of the Bahagian A table itself. */
export interface BahagianATableSnapshot {
  /** True iff the table element resolved on the live page. */
  present: boolean;
  /** Live row count, or null if the table couldn't be parsed. */
  rowCount: number | null;
  /**
   * Header labels in left-to-right order, exactly as observed.
   * Empty array when no header row exists. Capped at 16 entries to
   * bound diagnostic size.
   */
  headers: string[];
  /**
   * Observed Tambah-style buttons. Empty when no party-add button
   * was found. Capped at 8 entries.
   */
  buttons: BahagianATableButtonObservation[];
}

// ─── Modal-level snapshot ──────────────────────────────────────────

/** Tag of an observed modal control. */
export type BahagianAModalFieldKind =
  | "input_text"
  | "input_other"
  | "select"
  | "textarea"
  | "checkbox"
  | "radio"
  | "button"
  | "other";

/**
 * Categorical descriptor of a select element's currently-selected
 * value, mirroring the Phase 2 executor's `Phase2SelectedValueCategory`
 * enum so the operator UI can reuse the same vocabulary.
 *   - `empty`         — `value === ""`
 *   - `code_like`     — value matches `[A-Za-z0-9_-]+`
 *   - `non_canonical` — value contains characters outside the
 *                       canonical-code charset
 */
export type BahagianAModalSelectedValueCategory =
  | "empty"
  | "code_like"
  | "non_canonical";

/**
 * One observed modal field. We carry portal field NAMES, ids,
 * label TEXT, and observed option codes — these are non-PII
 * portal-vocabulary identifiers and safe to log per the working-
 * style update.
 */
export interface BahagianAModalFieldObservation {
  /** Concrete CSS selector that resolves this field uniquely. */
  selectorObserved: string;
  fieldKind: BahagianAModalFieldKind;
  /** `<input name="..."> / <select name="...">` attribute, when set. */
  nameAttr: string | null;
  /** `id` attribute, when set. */
  idAttr: string | null;
  /** Operator-facing label observed adjacent to the field. */
  labelObserved: string | null;
  /** `disabled` attribute. */
  disabled: boolean;
  /** Hidden — true when the element is not visible on the form. */
  hidden: boolean;
  /** `readonly` attribute. */
  readonly: boolean;
  /**
   * For select-type fields: the full observed `<option>` list.
   * `null` for non-select fields. Capped at 32 options to bound
   * diagnostic size.
   */
  options: { code: string; label: string | null }[] | null;
  /**
   * For select-type fields: category of currently-selected value.
   * `null` for non-selects.
   */
  selectedValueCategory: BahagianAModalSelectedValueCategory | null;
}

/** Snapshot of the Tambah modal contents. */
export interface BahagianAModalSnapshot {
  /** True when the modal was open at diagnosis time. */
  opened: boolean;
  /** Operator-facing modal title, when observable. */
  titleObserved: string | null;
  /**
   * Total number of form-control elements inside the modal scope.
   * Useful for noticing when the modal contains many more fields
   * than we've mapped.
   */
  fieldCount: number;
  /** All observed fields. Capped at 64 to bound diagnostic size. */
  fields: BahagianAModalFieldObservation[];
}

// ─── Top-level result ─────────────────────────────────────────────

/**
 * Composite result of one diagnosis attempt. Every field is
 * optional except `status` and `diagnosedAt`, so partial diagnoses
 * (table only, browser unreachable, etc.) round-trip cleanly.
 */
export interface BahagianAModalDiagnosisResult {
  status: BahagianAModalDiagnosisStatus;
  /** ISO 8601 timestamp of the diagnosis attempt. */
  diagnosedAt: string;
  /** Snapshot of the Bahagian A table, when reached. */
  table: BahagianATableSnapshot | null;
  /** Snapshot of the Tambah modal, when reached. */
  modal: BahagianAModalSnapshot | null;
  /**
   * Stable, plain-English next operator action. Drawn from a closed
   * map keyed by `status`.
   */
  nextOperatorAction: string;
  /** Free-text developer note. Optional. */
  developerNote?: string;
}

// ─── Stable next-action wording ────────────────────────────────────

export const BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS: Record<
  BahagianAModalDiagnosisStatus,
  string
> = {
  not_attempted:
    "No Bahagian A diagnosis has run yet. Open the supervised run console and trigger an inspection.",
  browser_unreachable:
    "Operator's Chrome is not reachable on the configured CDP endpoint. Start Chrome with --remote-debugging-port=9222 and retry.",
  p5_form_not_detected:
    "No Sewa/Pajakan p5 form is open. Navigate the operator's Chrome to the test draft and retry.",
  table_only_inspected:
    "Manually open one of the Tambah modals (Tambah Individu / Tambah Syarikat SSM / Tambah Syarikat Bukan SSM), then retry the diagnosis.",
  modal_inspected:
    "Modal field map captured. Review the observed selectors / options before authorising a future Bahagian A execution milestone.",
};

/**
 * Build a fresh "not yet attempted" diagnosis stub. Used as the
 * initial value for any module that wants to render the next-
 * operator-action wording before the first inspection runs.
 */
export function makeNotAttemptedDiagnosisResult(
  diagnosedAt: string
): BahagianAModalDiagnosisResult {
  return {
    status: "not_attempted",
    diagnosedAt,
    table: null,
    modal: null,
    nextOperatorAction:
      BAHAGIAN_A_NEXT_OPERATOR_ACTION_BY_STATUS.not_attempted,
  };
}

/**
 * Sanity-check a `BahagianAModalDiagnosisResult` to confirm it
 * carries no obvious sensitive substrings. Returns the list of
 * forbidden patterns that matched (empty when clean). Used by
 * tests; safe to call at runtime too.
 *
 * Forbidden patterns are deliberately narrow — portal labels and
 * `<option value>` codes are LEGITIMATE diagnostic content per the
 * working-style update. We block only PII-shaped strings (long
 * digit runs, IC-shaped strings, http URLs, cookie/token keywords).
 */
export function findForbiddenSubstringsInDiagnosisResult(
  result: BahagianAModalDiagnosisResult
): string[] {
  const serialised = JSON.stringify(result);
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "13-digit-or-longer ID", pattern: /\b\d{13,}\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /\bcookie\b/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "auth token keyword", pattern: /\b(authorization|bearer)\b/i },
  ];
  const hits: string[] = [];
  for (const f of FORBIDDEN) {
    if (f.pattern.test(serialised)) hits.push(f.name);
  }
  return hits;
}
