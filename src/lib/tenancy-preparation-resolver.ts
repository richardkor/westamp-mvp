/**
 * WeStamp — Tenancy Preparation Value Resolver
 *
 * Single canonical helper that resolves the tenancy preparation values
 * (instrumentDate, monthlyRent, leaseMonths) used by the internal
 * sewa_pajakan advisory stack (portal draft, execution preview,
 * assertions, and anywhere else these three fields are needed).
 *
 * Precedence rules — intentionally narrow and truthful:
 *
 *   instrumentDate:
 *     1. confirmedTenancyInputs.confirmedAgreementDate
 *     2. extractionResult.suggestedAgreementDate.value
 *     3. null
 *
 *   monthlyRent:
 *     1. stampingDetails.monthlyRent
 *     2. confirmedTenancyInputs.confirmedMonthlyRent
 *     3. null
 *       (raw extraction suggestions are NEVER used directly here;
 *        they must be promoted through confirmation or entered as
 *        stampingDetails)
 *
 *   leaseMonths:
 *     1. stampingDetails.leaseMonths
 *     2. confirmedTenancyInputs.confirmedLeaseMonths
 *     3. null
 *       (same rule as monthlyRent — raw extraction never used directly)
 *
 * Per-field provenance is exposed so downstream outputs remain auditable.
 *
 * Advisory-only. Does NOT mutate the job, does NOT interact with the
 * live portal, does NOT perform any calculation.
 */

import type { StampingJob } from "./stamping-types";

/**
 * Provenance tag for each resolved tenancy preparation field.
 *
 * - "stamping_details"     — value came from the operator-entered
 *                            Stamping Details form (duty-calculator input)
 * - "confirmed_input"      — value came from operator-confirmed tenancy
 *                            inputs (confirmedTenancyInputs)
 * - "extraction_suggestion"— value came from the raw PDF extraction
 *                            suggestion. Only ever used for instrumentDate;
 *                            never used for monthlyRent or leaseMonths.
 * - "none"                 — no value available from any permitted source
 */
export type ResolvedTenancyFieldSource =
  | "stamping_details"
  | "confirmed_input"
  | "extraction_suggestion"
  | "none";

/**
 * Resolved tenancy preparation values with per-field provenance.
 *
 * This is the single source of truth consumed by the internal
 * sewa_pajakan advisory stack.
 */
export interface ResolvedTenancyPreparationValues {
  /** Resolved instrument/agreement date (YYYY-MM-DD), or null. */
  instrumentDate: string | null;
  /** Resolved monthly rent in RM, or null. */
  monthlyRent: number | null;
  /** Resolved lease duration in months, or null. */
  leaseMonths: number | null;
  /** Where each resolved value came from. */
  sources: {
    instrumentDate: ResolvedTenancyFieldSource;
    monthlyRent: ResolvedTenancyFieldSource;
    leaseMonths: ResolvedTenancyFieldSource;
  };
  /**
   * Whether stampingDetails is currently outranking a present confirmed
   * value for rent / lease months. Useful for truthful UI summaries that
   * want to show "stampingDetails is overriding confirmed here" rather
   * than silently hiding the confirmed value.
   */
  stampingDetailsOverridesConfirmed: {
    monthlyRent: boolean;
    leaseMonths: boolean;
  };
}

/**
 * Resolve tenancy preparation values for a job.
 *
 * Returns null for any non-tenancy job — this helper is intentionally
 * tenancy-only. Non-tenancy categories are unchanged by this layer.
 *
 * @param job - The stamping job to resolve values for.
 * @returns Resolved values with provenance, or null if not a tenancy job.
 */
export function resolveConfirmedTenancyPreparationValues(
  job: StampingJob
): ResolvedTenancyPreparationValues | null {
  if (job.documentCategory !== "tenancy_agreement") {
    return null;
  }

  const confirmed = job.confirmedTenancyInputs;
  const stampingDetails = job.stampingDetails;
  const extraction = job.extractionResult;

  // ── instrumentDate: confirmed → extraction → null ─────────────────
  let instrumentDate: string | null = null;
  let instrumentDateSource: ResolvedTenancyFieldSource = "none";
  if (confirmed?.confirmedAgreementDate) {
    instrumentDate = confirmed.confirmedAgreementDate;
    instrumentDateSource = "confirmed_input";
  } else if (extraction?.suggestedAgreementDate?.value) {
    instrumentDate = extraction.suggestedAgreementDate.value;
    instrumentDateSource = "extraction_suggestion";
  }

  // ── monthlyRent: stampingDetails → confirmed → null ───────────────
  // Raw extraction suggestions are never used directly for monthlyRent.
  let monthlyRent: number | null = null;
  let monthlyRentSource: ResolvedTenancyFieldSource = "none";
  const confirmedRentPresent =
    confirmed?.confirmedMonthlyRent !== undefined &&
    confirmed?.confirmedMonthlyRent !== null;
  if (
    stampingDetails &&
    typeof stampingDetails.monthlyRent === "number" &&
    Number.isFinite(stampingDetails.monthlyRent)
  ) {
    monthlyRent = stampingDetails.monthlyRent;
    monthlyRentSource = "stamping_details";
  } else if (confirmedRentPresent) {
    monthlyRent = confirmed!.confirmedMonthlyRent;
    monthlyRentSource = "confirmed_input";
  }

  // ── leaseMonths: stampingDetails → confirmed → null ───────────────
  // Raw extraction suggestions are never used directly for leaseMonths.
  let leaseMonths: number | null = null;
  let leaseMonthsSource: ResolvedTenancyFieldSource = "none";
  const confirmedMonthsPresent =
    confirmed?.confirmedLeaseMonths !== undefined &&
    confirmed?.confirmedLeaseMonths !== null;
  if (
    stampingDetails &&
    typeof stampingDetails.leaseMonths === "number" &&
    Number.isFinite(stampingDetails.leaseMonths)
  ) {
    leaseMonths = stampingDetails.leaseMonths;
    leaseMonthsSource = "stamping_details";
  } else if (confirmedMonthsPresent) {
    leaseMonths = confirmed!.confirmedLeaseMonths;
    leaseMonthsSource = "confirmed_input";
  }

  // ── Override flags (truthful UI clarification) ────────────────────
  const stampingDetailsOverridesConfirmed = {
    monthlyRent:
      monthlyRentSource === "stamping_details" && confirmedRentPresent,
    leaseMonths:
      leaseMonthsSource === "stamping_details" && confirmedMonthsPresent,
  };

  return {
    instrumentDate,
    monthlyRent,
    leaseMonths,
    sources: {
      instrumentDate: instrumentDateSource,
      monthlyRent: monthlyRentSource,
      leaseMonths: leaseMonthsSource,
    },
    stampingDetailsOverridesConfirmed,
  };
}
