/**
 * WeStamp — Tenancy Stamp Duty Calculator Tests
 *
 * Tests the duty calculation logic against known-correct scenarios.
 * Core test cases were provided by the founder and verified manually.
 */

import { calculateTenancyDuty, DutyResultOk } from "./duty-calculator";

// ─── Helper ──────────────────────────────────────────────────────────

/** Asserts the result is status "ok" and returns the typed result. */
function expectOk(result: ReturnType<typeof calculateTenancyDuty>): DutyResultOk {
  if (result.status !== "ok") {
    throw new Error(
      `Expected status "ok" but got "${result.status}": ${result.reason}`
    );
  }
  return result;
}

// ─── Core Calculation Tests ──────────────────────────────────────────

describe("Tenancy stamp duty calculator", () => {
  test("Test 1: RM1,000/month, 12 months, 0 duplicates → RM48", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 12, duplicateCopies: 0 })
    );

    expect(r.monthlyRent).toBe(1000);
    expect(r.monthlyRentSen).toBe(100_000);
    expect(r.annualRent).toBe(12000);
    expect(r.annualRentSen).toBe(1_200_000);
    expect(r.units).toBe(48); // 1200000 / 25000 = 48 exact
    expect(r.ratePerUnit).toBe(1);
    expect(r.baseDuty).toBe(48);
    expect(r.totalDuty).toBe(48);
  });

  test("Test 2: RM1,500/month, 24 months, 0 duplicates → RM216", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1500, leaseMonths: 24, duplicateCopies: 0 })
    );

    expect(r.annualRent).toBe(18000);
    expect(r.annualRentSen).toBe(1_800_000);
    expect(r.units).toBe(72); // 1800000 / 25000 = 72 exact
    expect(r.ratePerUnit).toBe(3);
    expect(r.baseDuty).toBe(216);
    expect(r.totalDuty).toBe(216);
  });

  test("Test 3: RM3,888/month, 32 months, 0 duplicates → RM561", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 3888, leaseMonths: 32, duplicateCopies: 0 })
    );

    expect(r.annualRent).toBe(46656);
    expect(r.annualRentSen).toBe(4_665_600);
    // ceil(4665600 / 25000) = ceil(186.624) = 187
    expect(r.units).toBe(187);
    expect(r.ratePerUnit).toBe(3);
    expect(r.baseDuty).toBe(561);
    expect(r.totalDuty).toBe(561);
  });

  test("Test 4: RM200/month, 12 months, 0 duplicates → RM10", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 200, leaseMonths: 12, duplicateCopies: 0 })
    );

    expect(r.annualRent).toBe(2400);
    expect(r.annualRentSen).toBe(240_000);
    // ceil(240000 / 25000) = ceil(9.6) = 10
    expect(r.units).toBe(10);
    expect(r.ratePerUnit).toBe(1);
    expect(r.baseDuty).toBe(10);
    expect(r.totalDuty).toBe(10);
  });

  test("Test 5: RM250/month, 12 months, 0 duplicates → RM12", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 250, leaseMonths: 12, duplicateCopies: 0 })
    );

    expect(r.annualRent).toBe(3000);
    expect(r.annualRentSen).toBe(300_000);
    expect(r.units).toBe(12); // 300000 / 25000 = 12 exact
    expect(r.ratePerUnit).toBe(1);
    expect(r.baseDuty).toBe(12);
    expect(r.totalDuty).toBe(12);
  });

  test("Test 6: RM1,000/month, 12 months, 2 duplicates → RM68", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 12, duplicateCopies: 2 })
    );

    expect(r.baseDuty).toBe(48);
    // Flat RM10 per duplicate copy (Stamp Act s.12)
    expect(r.duplicateCopyFeePerCopy).toBe(10);
    expect(r.duplicateCopyTotal).toBe(20);
    expect(r.totalDuty).toBe(68);
  });

  test("Test 7: RM50/month, 12 months, 2 duplicates → RM23 (flat RM10 per duplicate copy)", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 50, leaseMonths: 12, duplicateCopies: 2 })
    );

    expect(r.annualRent).toBe(600);
    expect(r.annualRentSen).toBe(60_000);
    // ceil(60000 / 25000) = ceil(2.4) = 3
    expect(r.units).toBe(3);
    expect(r.ratePerUnit).toBe(1);
    expect(r.baseDuty).toBe(3);
    // Flat RM10 per duplicate copy (Stamp Act s.12)
    expect(r.duplicateCopyFeePerCopy).toBe(10);
    expect(r.duplicateCopyTotal).toBe(20);
    expect(r.totalDuty).toBe(23);
  });
});

// ─── Decimal Rent Test (Sen Precision) ───────────────────────────────

describe("Decimal rent handling", () => {
  test("RM1,234.56/month, 12 months, 0 duplicates → correct sen conversion", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1234.56, leaseMonths: 12, duplicateCopies: 0 })
    );

    expect(r.monthlyRent).toBe(1234.56);
    expect(r.monthlyRentSen).toBe(123_456);
    expect(r.annualRentSen).toBe(1_481_472); // 123456 * 12
    expect(r.annualRent).toBe(14814.72);     // 1481472 / 100
    // ceil(1481472 / 25000) = ceil(59.25888) = 60
    expect(r.units).toBe(60);
    expect(r.ratePerUnit).toBe(1);
    expect(r.baseDuty).toBe(60);
    expect(r.totalDuty).toBe(60);
  });
});

// ─── Rate Tier Boundary Tests ────────────────────────────────────────

describe("Rate tier boundaries", () => {
  test("12 months uses RM1 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 12, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(1);
  });

  test("13 months uses RM3 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 13, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(3);
  });

  test("36 months uses RM3 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 36, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(3);
  });

  test("37 months uses RM5 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 37, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(5);
  });

  test("60 months uses RM5 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 60, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(5);
  });

  test("61 months uses RM7 rate", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1000, leaseMonths: 61, duplicateCopies: 0 })
    );
    expect(r.ratePerUnit).toBe(7);
  });
});

// ─── Output Completeness ─────────────────────────────────────────────

describe("Output includes all required fields", () => {
  test("All fields are present and correctly typed", () => {
    const r = expectOk(
      calculateTenancyDuty({ monthlyRent: 1500, leaseMonths: 24, duplicateCopies: 1 })
    );

    expect(r.status).toBe("ok");
    expect(typeof r.monthlyRent).toBe("number");
    expect(typeof r.monthlyRentSen).toBe("number");
    expect(typeof r.annualRent).toBe("number");
    expect(typeof r.annualRentSen).toBe("number");
    expect(typeof r.leaseMonths).toBe("number");
    expect(typeof r.units).toBe("number");
    expect(typeof r.ratePerUnit).toBe("number");
    expect(typeof r.rateTierLabel).toBe("string");
    expect(typeof r.baseDuty).toBe("number");
    expect(typeof r.duplicateCopies).toBe("number");
    expect(typeof r.duplicateCopyFeePerCopy).toBe("number");
    expect(typeof r.duplicateCopyTotal).toBe("number");
    expect(typeof r.totalDuty).toBe("number");
  });
});

// ─── Invalid Input → Error ───────────────────────────────────────────

describe("Invalid primitive input returns status error", () => {
  test("Negative monthly rent", () => {
    const result = calculateTenancyDuty({
      monthlyRent: -500,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Zero monthly rent", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 0,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Non-integer lease months", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1000,
      leaseMonths: 12.5,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Negative lease months", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1000,
      leaseMonths: -6,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Negative duplicate copies", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1000,
      leaseMonths: 12,
      duplicateCopies: -1,
    });
    expect(result.status).toBe("error");
  });

  test("NaN monthly rent", () => {
    const result = calculateTenancyDuty({
      monthlyRent: NaN,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Infinity lease months", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1000,
      leaseMonths: Infinity,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
  });

  test("Non-integer duplicate copies", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1000,
      leaseMonths: 12,
      duplicateCopies: 1.5,
    });
    expect(result.status).toBe("error");
  });
});

// ─── Money Precision ─────────────────────────────────────────────────

describe("Monthly rent decimal place validation", () => {
  test("RM1234.56 (2 decimal places) is valid", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1234.56,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("ok");
  });

  test("RM1234.5 (1 decimal place) is valid", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1234.5,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("ok");
  });

  test("RM1234 (0 decimal places) is valid", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1234,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("ok");
  });

  test("RM1234.567 (3 decimal places) is rejected", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 1234.567,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toContain("decimal places");
    }
  });

  test("RM0.001 (3 decimal places) is rejected", () => {
    const result = calculateTenancyDuty({
      monthlyRent: 0.001,
      leaseMonths: 12,
      duplicateCopies: 0,
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.reason).toContain("decimal places");
    }
  });
});

// ─── Unsupported Structure → Manual Review ───────────────────────────

describe("Unsupported tenancy structure flags return manual_review", () => {
  const validBase = { monthlyRent: 1000, leaseMonths: 12, duplicateCopies: 0 };

  test("hasPremiumOrFine triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, hasPremiumOrFine: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("premium or fine");
    }
  });

  test("hasVariableRent triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, hasVariableRent: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("variable");
    }
  });

  test("isMixedUse triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, isMixedUse: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("mixed-use");
    }
  });

  test("isPeriodicOrIndefinite triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, isPeriodicOrIndefinite: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("periodic");
    }
  });

  test("hasBundledCharges triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, hasBundledCharges: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("bundled");
    }
  });

  test("hasUnusualConsideration triggers manual review", () => {
    const result = calculateTenancyDuty({ ...validBase, hasUnusualConsideration: true });
    expect(result.status).toBe("manual_review");
    if (result.status === "manual_review") {
      expect(result.reason).toContain("unusual");
    }
  });

  test("Flags set to false do NOT trigger manual review", () => {
    const result = calculateTenancyDuty({
      ...validBase,
      hasPremiumOrFine: false,
      hasVariableRent: false,
      isMixedUse: false,
      isPeriodicOrIndefinite: false,
      hasBundledCharges: false,
      hasUnusualConsideration: false,
    });
    expect(result.status).toBe("ok");
  });

  test("Flags omitted entirely do NOT trigger manual review", () => {
    const result = calculateTenancyDuty(validBase);
    expect(result.status).toBe("ok");
  });
});
