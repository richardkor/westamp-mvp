/**
 * WeStamp — STSDS Portal Assertion Registry + Evaluator
 *
 * Defines which portal fields matter for assertion in the known lanes,
 * builds mock snapshots from internal draft state, and evaluates
 * expected-vs-observed assertions deterministically.
 *
 * This is an internal comparison layer:
 * - Registry declares assertions grounded in existing portal schema
 * - Mock snapshot builder produces snapshots from portal draft data
 * - Evaluator compares expected (from draft/routing) vs observed (from snapshot)
 * - Mismatch severities are modelled honestly per field
 *
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT import Playwright/Puppeteer.
 * Does NOT advance job status.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalLane,
  PortalAssertion,
  PortalAssertionRegistry,
  PortalAssertionResult,
  PortalAssertionEvaluation,
  PortalAssertionEvaluationStatus,
  PortalMismatchReason,
  PortalStateSnapshot,
  PortalStateTabSnapshot,
  PortalStateFieldValue,
} from "./stsds-types";
import { PORTAL_FIELD_KEYS } from "./stsds-portal-schema";

// ─── Assertion Registry ─────────────────────────────────────────────

/**
 * Assertions for penyeteman_am lane.
 * Grounded in existing portal schema fields only.
 */
const PENYETEMAN_AM_ASSERTIONS: PortalAssertion[] = [
  {
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION,
    tab: "dashboard",
    description: "Selected portal lane must match routing suggestion",
    severity: "blocking",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME,
    tab: "maklumat_am",
    description: "Selected Nama Surat Cara must match intended document name",
    severity: "blocking",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
    tab: "maklumat_am",
    description: "Derived document group must match expected value when known",
    severity: "blocking",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY,
    tab: "maklumat_am",
    description: "Editable instrument category should match observed value",
    severity: "advisory",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
    tab: "maklumat_am",
    description: "Stamp office selection must match intended value",
    severity: "blocking",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.INSTRUMENT_DATE,
    tab: "maklumat_am",
    description: "Instrument date must match intended value",
    severity: "blocking",
    lane: "penyeteman_am",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE,
    tab: "rumusan_pengiraan",
    description: "Total payable duty as computed by portal",
    severity: "advisory",
    lane: "penyeteman_am",
    comparisonType: "numeric",
  },
];

/**
 * Assertions for sewa_pajakan lane.
 * Grounded in existing portal schema fields only.
 */
const SEWA_PAJAKAN_ASSERTIONS: PortalAssertion[] = [
  {
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION,
    tab: "dashboard",
    description: "Selected portal lane must match routing suggestion",
    severity: "blocking",
    lane: "sewa_pajakan",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
    tab: "maklumat_am",
    description: "Stamp office selection must match intended value",
    severity: "blocking",
    lane: "sewa_pajakan",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.INSTRUMENT_DATE,
    tab: "maklumat_am",
    description: "Instrument date must match intended value",
    severity: "blocking",
    lane: "sewa_pajakan",
    comparisonType: "exact",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.DUTY_PAYABLE,
    tab: "rumusan_pengiraan",
    description: "Payable duty as computed by portal",
    severity: "advisory",
    lane: "sewa_pajakan",
    comparisonType: "numeric",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.DUTY_DUPLICATE_COPY,
    tab: "rumusan_pengiraan",
    description: "Duplicate copy duty as computed by portal",
    severity: "advisory",
    lane: "sewa_pajakan",
    comparisonType: "numeric",
  },
  {
    fieldKey: PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE,
    tab: "rumusan_pengiraan",
    description: "Total payable duty as computed by portal",
    severity: "advisory",
    lane: "sewa_pajakan",
    comparisonType: "numeric",
  },
];

/**
 * Get the assertion registry for a lane.
 */
export function getAssertionRegistry(lane: PortalLane): PortalAssertionRegistry {
  return {
    lane,
    assertions:
      lane === "penyeteman_am"
        ? PENYETEMAN_AM_ASSERTIONS
        : SEWA_PAJAKAN_ASSERTIONS,
  };
}

// ─── Expected Value Resolution ──────────────────────────────────────

/**
 * Resolve the expected value for a field key from the job's internal state.
 * Returns null if the expected value cannot be determined.
 */
function resolveExpectedValue(
  fieldKey: string,
  job: StampingJob
): string | number | null {
  const lane = job.routingSuggestion?.suggestedLane;
  if (!lane) return null;

  const draft = job.portalDraft;
  const routing = job.routingSuggestion;

  switch (fieldKey) {
    case PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION:
      return lane;

    case PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME:
      return draft?.maklumatAmPenyetemanAm?.portalDocumentName ?? routing?.suggestedPortalDocumentName ?? null;

    case PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP:
      return draft?.maklumatAmPenyetemanAm?.expectedDerivedDocumentGroup ?? routing?.expectedDerivedDocumentGroup ?? null;

    case PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY:
      return draft?.maklumatAmPenyetemanAm?.editableInstrumentCategory ?? routing?.observedEditableInstrumentCategory ?? null;

    case PORTAL_FIELD_KEYS.STAMP_OFFICE: {
      const am = lane === "sewa_pajakan"
        ? draft?.maklumatAmSewaPajakan
        : draft?.maklumatAmPenyetemanAm;
      return am?.stampOffice ?? null;
    }

    case PORTAL_FIELD_KEYS.INSTRUMENT_DATE: {
      const am = lane === "sewa_pajakan"
        ? draft?.maklumatAmSewaPajakan
        : draft?.maklumatAmPenyetemanAm;
      return am?.instrumentDate ?? null;
    }

    case PORTAL_FIELD_KEYS.DUTY_PAYABLE:
      return draft?.dutySummary?.payableDuty ?? null;

    case PORTAL_FIELD_KEYS.DUTY_DUPLICATE_COPY:
      return draft?.dutySummary?.duplicateCopyAmount ?? null;

    case PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE:
      return draft?.dutySummary?.totalPayable ?? null;

    default:
      return null;
  }
}

// ─── Mock Snapshot Builder ──────────────────────────────────────────

/**
 * Build a mock portal-state snapshot from the current job's internal
 * draft and routing state.
 *
 * This produces a snapshot where the "observed" values are exactly
 * what WeStamp's draft contains — simulating a portal that accepted
 * all values as entered. Real snapshots from a browser driver would
 * potentially differ.
 *
 * Returns null if no routing suggestion or portal draft exists.
 */
export function buildMockSnapshot(job: StampingJob): PortalStateSnapshot | null {
  if (!job.routingSuggestion) return null;
  if (!job.portalDraft) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const now = new Date().toISOString();

  const registry = getAssertionRegistry(lane);
  const allFields: PortalStateFieldValue[] = [];
  const tabMap = new Map<string, PortalStateFieldValue[]>();

  for (const assertion of registry.assertions) {
    const value = resolveExpectedValue(assertion.fieldKey, job);
    const field: PortalStateFieldValue = {
      fieldKey: assertion.fieldKey,
      observedValue: value,
      tab: assertion.tab,
    };
    allFields.push(field);

    if (!tabMap.has(assertion.tab)) {
      tabMap.set(assertion.tab, []);
    }
    tabMap.get(assertion.tab)!.push(field);
  }

  const tabs: PortalStateTabSnapshot[] = [];
  for (const [tabKey, fields] of tabMap) {
    tabs.push({
      tabKey,
      tabLabel: tabKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      fields,
    });
  }

  return {
    lane,
    capturedAt: now,
    source: "mock_from_draft",
    tabs,
    allFields,
  };
}

// ─── Assertion Evaluator ────────────────────────────────────────────

/**
 * Compare two values using the specified comparison type.
 */
function compareValues(
  expected: string | number | null,
  observed: string | number | null,
  comparisonType: "exact" | "numeric" | "present"
): { match: boolean; reason?: PortalMismatchReason } {
  // present check: just verify observed is non-null/non-empty
  if (comparisonType === "present") {
    if (observed === null || observed === undefined || String(observed).trim() === "") {
      return { match: false, reason: "value_missing" };
    }
    return { match: true };
  }

  // Both null → match
  if (expected === null && observed === null) {
    return { match: true };
  }

  // Expected exists but observed missing
  if (expected !== null && (observed === null || String(observed).trim() === "")) {
    return { match: false, reason: "value_missing" };
  }

  // Expected missing but observed has value
  if ((expected === null || String(expected).trim() === "") && observed !== null && String(observed).trim() !== "") {
    return { match: false, reason: "unexpected_value" };
  }

  // Numeric comparison
  if (comparisonType === "numeric") {
    const expNum = typeof expected === "number" ? expected : parseFloat(String(expected));
    const obsNum = typeof observed === "number" ? observed : parseFloat(String(observed));
    if (isNaN(expNum) || isNaN(obsNum)) {
      return { match: false, reason: "value_mismatch" };
    }
    return expNum === obsNum ? { match: true } : { match: false, reason: "value_mismatch" };
  }

  // Exact comparison (trimmed)
  const expStr = String(expected).trim();
  const obsStr = String(observed).trim();
  return expStr === obsStr ? { match: true } : { match: false, reason: "value_mismatch" };
}

/**
 * Evaluate portal assertions for a job against a snapshot.
 *
 * Pure function — consumes current job state and a portal-state snapshot,
 * consults the assertion registry, returns structured results.
 * Never touches the live portal.
 *
 * @param job - The stamping job with expected values
 * @param snapshot - The portal-state snapshot with observed values
 * @returns A PortalAssertionEvaluation, or null if inputs are insufficient
 */
export function evaluatePortalAssertions(
  job: StampingJob,
  snapshot: PortalStateSnapshot
): PortalAssertionEvaluation | null {
  if (!job.routingSuggestion) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const registry = getAssertionRegistry(lane);
  const now = new Date().toISOString();

  const results: PortalAssertionResult[] = [];
  const blockingMismatches: string[] = [];
  const advisoryMismatches: string[] = [];

  for (const assertion of registry.assertions) {
    const expected = resolveExpectedValue(assertion.fieldKey, job);
    const snapshotField = snapshot.allFields.find(
      (f) => f.fieldKey === assertion.fieldKey
    );
    const observed = snapshotField?.observedValue ?? null;

    // If expected is null, skip assertion — we cannot assert without an expected value
    if (expected === null) {
      results.push({
        fieldKey: assertion.fieldKey,
        description: assertion.description,
        severity: assertion.severity,
        outcome: "skipped",
        expectedValue: null,
        observedValue: observed,
        note: "No expected value available from job data",
      });
      continue;
    }

    // If field was not in snapshot at all
    if (!snapshotField) {
      results.push({
        fieldKey: assertion.fieldKey,
        description: assertion.description,
        severity: assertion.severity,
        outcome: "mismatch",
        expectedValue: expected,
        observedValue: null,
        mismatchReason: "not_observable",
        note: "Field not present in portal snapshot",
      });
      if (assertion.severity === "blocking") {
        blockingMismatches.push(`${assertion.description} — field not observable`);
      } else if (assertion.severity === "advisory") {
        advisoryMismatches.push(`${assertion.description} — field not observable`);
      }
      continue;
    }

    // Compare
    const { match, reason } = compareValues(expected, observed, assertion.comparisonType);

    if (match) {
      results.push({
        fieldKey: assertion.fieldKey,
        description: assertion.description,
        severity: assertion.severity,
        outcome: "match",
        expectedValue: expected,
        observedValue: observed,
      });
    } else {
      results.push({
        fieldKey: assertion.fieldKey,
        description: assertion.description,
        severity: assertion.severity,
        outcome: "mismatch",
        expectedValue: expected,
        observedValue: observed,
        mismatchReason: reason,
        note: `Expected "${expected}" but observed "${observed}"`,
      });
      if (assertion.severity === "blocking") {
        blockingMismatches.push(
          `${assertion.description} — expected "${expected}", observed "${observed}"`
        );
      } else if (assertion.severity === "advisory") {
        advisoryMismatches.push(
          `${assertion.description} — expected "${expected}", observed "${observed}"`
        );
      }
    }
  }

  // Summary
  const matchCount = results.filter((r) => r.outcome === "match").length;
  const mismatchCount = results.filter((r) => r.outcome === "mismatch").length;
  const skippedCount = results.filter((r) => r.outcome === "skipped").length;
  const blockingMismatchCount = results.filter(
    (r) => r.outcome === "mismatch" && r.severity === "blocking"
  ).length;
  const advisoryMismatchCount = results.filter(
    (r) => r.outcome === "mismatch" && r.severity === "advisory"
  ).length;
  const informationalMismatchCount = results.filter(
    (r) => r.outcome === "mismatch" && r.severity === "informational"
  ).length;

  // Resolve overall status
  let status: PortalAssertionEvaluationStatus;
  if (blockingMismatchCount > 0) {
    status = "blocking_mismatches";
  } else if (advisoryMismatchCount > 0) {
    status = "advisory_mismatches";
  } else {
    status = "ready_for_internal_review";
  }

  return {
    status,
    lane,
    evaluatedAt: now,
    snapshot,
    results,
    summary: {
      totalAssertions: results.length,
      matchCount,
      mismatchCount,
      skippedCount,
      blockingMismatchCount,
      advisoryMismatchCount,
      informationalMismatchCount,
    },
    blockingMismatches,
    advisoryMismatches,
  };
}
