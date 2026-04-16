/**
 * WeStamp — Tenancy Stamp Duty Calculator
 *
 * Implements the current tenancy duty schedule under Stamp Act 1949,
 * First Schedule, Item 49(a), as amended / currently applied.
 *
 * This calculator only handles standard residential tenancy cases.
 * Non-standard cases return status "manual_review".
 * Invalid numeric inputs return status "error".
 *
 * All internal arithmetic uses integer SEN to avoid floating-point
 * rounding errors. RM values in the output are derived from sen values.
 */

// ─── Types ───────────────────────────────────────────────────────────

/** Flags indicating unsupported tenancy structures. All are optional. */
export interface UnsupportedStructureFlags {
  hasPremiumOrFine?: boolean;
  hasVariableRent?: boolean;
  isMixedUse?: boolean;
  isPeriodicOrIndefinite?: boolean;
  hasBundledCharges?: boolean;
  hasUnusualConsideration?: boolean;
}

/** Input to the duty calculator */
export interface DutyCalculatorInput extends UnsupportedStructureFlags {
  /** Monthly rent in RM (must be a positive number, up to 2 decimal places) */
  monthlyRent: number;

  /** Lease duration in months (must be a positive whole number) */
  leaseMonths: number;

  /** Number of duplicate copies of the agreement (0 or more) */
  duplicateCopies: number;
}

/** Successful calculation result */
export interface DutyResultOk {
  status: "ok";
  monthlyRent: number;
  monthlyRentSen: number;
  annualRent: number;
  annualRentSen: number;
  leaseMonths: number;
  units: number;
  ratePerUnit: number;
  rateTierLabel: string;
  baseDuty: number;
  duplicateCopies: number;
  duplicateCopyFeePerCopy: number;
  duplicateCopyTotal: number;
  totalDuty: number;
}

/** Manual review required — unsupported tenancy structure */
export interface DutyResultManualReview {
  status: "manual_review";
  reason: string;
}

/** Error — invalid primitive input */
export interface DutyResultError {
  status: "error";
  reason: string;
}

/** The calculator returns one of three statuses */
export type DutyCalculatorResult =
  | DutyResultOk
  | DutyResultManualReview
  | DutyResultError;

// ─── Constants ───────────────────────────────────────────────────────

/** One unit for duty calculation = RM250 = 25,000 sen */
const UNIT_SIZE_SEN = 25_000;

/** Duplicate copy fee per copy: flat RM10 (Stamp Act s.12) */
const DUPLICATE_COPY_FEE_RM = 10;

// ─── Rate Tier Logic ─────────────────────────────────────────────────

/**
 * Returns the duty rate per RM250 unit based on lease duration.
 *
 * - 12 months or less:          RM1
 * - More than 12, up to 36:     RM3
 * - More than 36, up to 60:     RM5
 * - More than 60:               RM7
 */
function getRateTier(leaseMonths: number): {
  ratePerUnit: number;
  label: string;
} {
  if (leaseMonths <= 12) {
    return { ratePerUnit: 1, label: "≤ 12 months — RM1 per RM250" };
  }
  if (leaseMonths <= 36) {
    return { ratePerUnit: 3, label: "> 12 months, ≤ 36 months — RM3 per RM250" };
  }
  if (leaseMonths <= 60) {
    return { ratePerUnit: 5, label: "> 36 months, ≤ 60 months — RM5 per RM250" };
  }
  return { ratePerUnit: 7, label: "> 60 months — RM7 per RM250" };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Converts a Ringgit amount to sen using Math.round to avoid
 * floating-point issues (e.g. 1234.56 * 100 = 123455.99999... in JS).
 */
function ringgitToSen(rm: number): number {
  return Math.round(rm * 100);
}

// ─── Input Validation ────────────────────────────────────────────────

/**
 * Validates primitive inputs. Returns an error reason string if invalid,
 * or null if all inputs are valid numbers.
 */
function validateInput(input: DutyCalculatorInput): string | null {
  if (
    typeof input.monthlyRent !== "number" ||
    !isFinite(input.monthlyRent) ||
    input.monthlyRent <= 0
  ) {
    return "Monthly rent must be a positive number.";
  }

  // Reject money values with more than 2 decimal places.
  // Multiply by 100 and check how far the result is from the nearest
  // whole number. A tolerance of 0.001 absorbs floating-point noise
  // (e.g. 1234.56 * 100 = 123455.99999...) while still catching
  // genuinely excessive precision like 1234.567.
  const rentInSen = input.monthlyRent * 100;
  if (Math.abs(rentInSen - Math.round(rentInSen)) > 0.001) {
    return "Monthly rent must not have more than 2 decimal places.";
  }

  if (
    typeof input.leaseMonths !== "number" ||
    !isFinite(input.leaseMonths) ||
    input.leaseMonths <= 0 ||
    !Number.isInteger(input.leaseMonths)
  ) {
    return "Lease duration must be a positive whole number of months.";
  }

  if (
    typeof input.duplicateCopies !== "number" ||
    !isFinite(input.duplicateCopies) ||
    input.duplicateCopies < 0 ||
    !Number.isInteger(input.duplicateCopies)
  ) {
    return "Duplicate copies must be zero or a positive whole number.";
  }

  return null;
}

// ─── Unsupported Structure Check ─────────────────────────────────────

/**
 * Checks the optional flags for unsupported tenancy structures.
 * Returns a reason string if any flag is true, or null if all clear.
 */
function checkUnsupportedStructure(
  input: UnsupportedStructureFlags
): string | null {
  if (input.hasPremiumOrFine) {
    return "Tenancy includes a premium or fine. Manual review required.";
  }
  if (input.hasVariableRent) {
    return "Rent is variable, percentage-based, or has escalation clauses. Manual review required.";
  }
  if (input.isMixedUse) {
    return "Property classification is mixed-use or ambiguous. Manual review required.";
  }
  if (input.isPeriodicOrIndefinite) {
    return "Lease term is periodic, rolling, or indefinite. Manual review required.";
  }
  if (input.hasBundledCharges) {
    return "Charges are bundled with rent (maintenance, furnishing, service charges). Manual review required.";
  }
  if (input.hasUnusualConsideration) {
    return "Tenancy includes unusual or unclear consideration. Manual review required.";
  }
  return null;
}

// ─── Main Calculator ─────────────────────────────────────────────────

/**
 * Calculates stamp duty for a standard residential tenancy agreement.
 *
 * Returns:
 * - status "ok"             — calculation succeeded, full breakdown included
 * - status "error"          — invalid primitive input (bad numbers)
 * - status "manual_review"  — unsupported tenancy structure
 */
export function calculateTenancyDuty(
  input: DutyCalculatorInput
): DutyCalculatorResult {
  // Step 0a: Validate primitive inputs → "error" if bad
  const validationError = validateInput(input);
  if (validationError) {
    return { status: "error", reason: validationError };
  }

  // Step 0b: Check unsupported structure flags → "manual_review" if flagged
  const unsupportedReason = checkUnsupportedStructure(input);
  if (unsupportedReason) {
    return { status: "manual_review", reason: unsupportedReason };
  }

  // Step 1: Convert to sen and calculate annual rent in sen
  const monthlyRentSen = ringgitToSen(input.monthlyRent);
  const annualRentSen = monthlyRentSen * 12;

  // Step 2: Chargeable units (ceiling division by 25,000 sen = RM250)
  const units = Math.ceil(annualRentSen / UNIT_SIZE_SEN);

  // Step 3: Rate tier
  const { ratePerUnit, label: rateTierLabel } = getRateTier(input.leaseMonths);

  // Step 4: Base duty (in RM — rates are already in whole RM)
  const baseDuty = units * ratePerUnit;

  // Step 5: Duplicate copy fee — flat RM10 per copy (Stamp Act s.12)
  const duplicateCopyFeePerCopy = DUPLICATE_COPY_FEE_RM;
  const duplicateCopyTotal = input.duplicateCopies * duplicateCopyFeePerCopy;

  // Step 6: Total duty
  const totalDuty = baseDuty + duplicateCopyTotal;

  // Step 7: Derive RM values from sen for output
  const annualRent = annualRentSen / 100;
  const monthlyRent = monthlyRentSen / 100;

  return {
    status: "ok",
    monthlyRent,
    monthlyRentSen,
    annualRent,
    annualRentSen,
    leaseMonths: input.leaseMonths,
    units,
    ratePerUnit,
    rateTierLabel,
    baseDuty,
    duplicateCopies: input.duplicateCopies,
    duplicateCopyFeePerCopy,
    duplicateCopyTotal,
    totalDuty,
  };
}
