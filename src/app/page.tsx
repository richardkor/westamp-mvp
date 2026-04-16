"use client";

import { useState } from "react";
import {
  calculateTenancyDuty,
  DutyCalculatorResult,
  DutyResultOk,
} from "../lib/duty-calculator";
import { buildWhatsAppUrl, homePageMessage } from "../lib/whatsapp";

/**
 * Home page — Tenancy Stamp Duty Calculator.
 *
 * All form inputs are held as strings. Values are only parsed when the
 * user clicks Calculate. Empty or malformed inputs produce friendly
 * validation messages — no silent coercion, no crashes.
 */
export default function HomePage() {
  // ─── Form state (strings, not numbers) ───────────────────────────
  const [monthlyRentStr, setMonthlyRentStr] = useState("");
  const [leaseMonthsStr, setLeaseMonthsStr] = useState("");
  const [duplicateCopiesStr, setDuplicateCopiesStr] = useState("0");

  // ─── Validation error messages (per field) ───────────────────────
  const [fieldErrors, setFieldErrors] = useState<{
    monthlyRent?: string;
    leaseMonths?: string;
    duplicateCopies?: string;
  }>({});

  // ─── Calculator result ───────────────────────────────────────────
  const [result, setResult] = useState<DutyCalculatorResult | null>(null);

  // ─── Handle Calculate ────────────────────────────────────────────
  function handleCalculate() {
    // Clear previous results and errors
    setResult(null);
    const errors: typeof fieldErrors = {};

    // Parse monthly rent
    const monthlyRentTrimmed = monthlyRentStr.trim();
    if (monthlyRentTrimmed === "") {
      errors.monthlyRent = "Please enter the monthly rent.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(monthlyRentTrimmed)) {
      errors.monthlyRent =
        "Enter a valid amount in Ringgit (e.g. 1500 or 1500.50). Maximum 2 decimal places.";
    }

    // Parse lease months
    const leaseMonthsTrimmed = leaseMonthsStr.trim();
    if (leaseMonthsTrimmed === "") {
      errors.leaseMonths = "Please enter the lease duration in months.";
    } else if (!/^\d+$/.test(leaseMonthsTrimmed)) {
      errors.leaseMonths = "Enter a whole number of months (e.g. 12, 24, 36).";
    } else if (parseInt(leaseMonthsTrimmed, 10) === 0) {
      errors.leaseMonths = "Lease duration must be at least 1 month.";
    }

    // Parse duplicate copies
    const duplicateCopiesTrimmed = duplicateCopiesStr.trim();
    if (duplicateCopiesTrimmed === "") {
      errors.duplicateCopies = "Please enter the number of duplicate copies (or 0).";
    } else if (!/^\d+$/.test(duplicateCopiesTrimmed)) {
      errors.duplicateCopies = "Enter a whole number (0 or more).";
    }

    setFieldErrors(errors);

    // If any field-level errors, stop here
    if (Object.keys(errors).length > 0) {
      return;
    }

    // All fields validated as parseable — convert and call calculator
    const monthlyRent = parseFloat(monthlyRentTrimmed);
    const leaseMonths = parseInt(leaseMonthsTrimmed, 10);
    const duplicateCopies = parseInt(duplicateCopiesTrimmed, 10);

    const calcResult = calculateTenancyDuty({
      monthlyRent,
      leaseMonths,
      duplicateCopies,
    });

    setResult(calcResult);
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <main>
      <h1>WeStamp — Stamp Duty Calculator</h1>
      <p className="subtitle">
        Residential tenancy agreements · Item 49(a), as amended / currently
        applied
      </p>

      {/* Monthly Rent */}
      <div className="form-group">
        <label htmlFor="monthlyRent">
          Monthly Rent{" "}
          <span className="label-hint">(RM, e.g. 1500 or 1500.50)</span>
        </label>
        <input
          id="monthlyRent"
          type="text"
          inputMode="decimal"
          value={monthlyRentStr}
          onChange={(e) => setMonthlyRentStr(e.target.value)}
          placeholder="e.g. 1500"
          className={fieldErrors.monthlyRent ? "input-error" : ""}
        />
        {fieldErrors.monthlyRent && (
          <p className="field-error">{fieldErrors.monthlyRent}</p>
        )}
      </div>

      {/* Lease Months */}
      <div className="form-group">
        <label htmlFor="leaseMonths">
          Lease Duration{" "}
          <span className="label-hint">(months, e.g. 12)</span>
        </label>
        <input
          id="leaseMonths"
          type="text"
          inputMode="numeric"
          value={leaseMonthsStr}
          onChange={(e) => setLeaseMonthsStr(e.target.value)}
          placeholder="e.g. 12"
          className={fieldErrors.leaseMonths ? "input-error" : ""}
        />
        {fieldErrors.leaseMonths && (
          <p className="field-error">{fieldErrors.leaseMonths}</p>
        )}
      </div>

      {/* Duplicate Copies */}
      <div className="form-group">
        <label htmlFor="duplicateCopies">
          Duplicate Copies{" "}
          <span className="label-hint">(0 if none — RM10 flat per copy)</span>
        </label>
        <input
          id="duplicateCopies"
          type="text"
          inputMode="numeric"
          value={duplicateCopiesStr}
          onChange={(e) => setDuplicateCopiesStr(e.target.value)}
          placeholder="0"
          className={fieldErrors.duplicateCopies ? "input-error" : ""}
        />
        {fieldErrors.duplicateCopies && (
          <p className="field-error">{fieldErrors.duplicateCopies}</p>
        )}
      </div>

      {/* Calculate Button */}
      <button type="button" onClick={handleCalculate}>
        Calculate Stamp Duty
      </button>

      {/* ─── Product Lanes ────────────────────────────────────────── */}
      <div className="lane-cards">
        <a href="/generate" className="lane-card">
          <p className="lane-card-heading">Generate Tenancy Agreement</p>
          <p className="lane-card-body">
            Fill in your tenancy details, preview, and download a standard residential tenancy agreement.
          </p>
          <span className="lane-card-action">Get started &rarr;</span>
        </a>

        <a href="/upload" className="lane-card">
          <p className="lane-card-heading">Upload Signed Document for Stamping</p>
          <p className="lane-card-body">
            Already have a signed tenancy agreement or other document? Upload it for LHDN stamping.
          </p>
          <span className="lane-card-action">Upload document &rarr;</span>
        </a>

        <div className="lane-card lane-card-lawyer">
          <p className="lane-card-heading">Need a Custom Agreement?</p>
          <p className="lane-card-body">
            WeStamp generates standard fixed-term residential tenancy agreements. If you need
            non-standard terms, a customised agreement, or legal advice, you may choose to speak
            directly to a lawyer.
          </p>
          <a
            className="cta-lawyer-btn"
            href={buildWhatsAppUrl(homePageMessage())}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 Speak to a Lawyer on WhatsApp
          </a>
          <p className="cta-lawyer-disclosure">
            This connects you to an independent Malaysian advocate &amp; solicitor. WeStamp is a
            self-serve software platform and does not provide legal advice or legal services.
          </p>
        </div>
      </div>

      {/* ─── Results ──────────────────────────────────────────────── */}
      {result && result.status === "ok" && (
        <ResultBreakdown result={result} />
      )}

      {result && result.status === "error" && (
        <div className="result-section result-error">
          <p className="result-title">Error</p>
          <p className="result-reason">{result.reason}</p>
        </div>
      )}

      {result && result.status === "manual_review" && (
        <div className="result-section result-manual-review">
          <p className="result-title">Manual Review Required</p>
          <p className="result-reason">{result.reason}</p>
          <p className="result-reason">
            This tenancy structure cannot be auto-calculated. It will be
            reviewed by the WeStamp team.
          </p>
        </div>
      )}
    </main>
  );
}

// ─── Breakdown Component ─────────────────────────────────────────────

/** Formats a number as RM with 2 decimal places (e.g. "RM 1,500.00") */
function formatRM(amount: number): string {
  return `RM ${amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ResultBreakdown({ result }: { result: DutyResultOk }) {
  return (
    <div className="result-section result-ok">
      <p className="result-title">Stamp Duty Breakdown</p>
      <table className="breakdown-table">
        <tbody>
          <tr>
            <td>Monthly Rent</td>
            <td>{formatRM(result.monthlyRent)}</td>
          </tr>
          <tr>
            <td>Annual Rent</td>
            <td>{formatRM(result.annualRent)}</td>
          </tr>
          <tr>
            <td>Lease Duration</td>
            <td>{result.leaseMonths} months</td>
          </tr>
          <tr>
            <td>Rate Tier</td>
            <td>{result.rateTierLabel}</td>
          </tr>
          <tr>
            <td>Chargeable Units</td>
            <td>{result.units} × RM{result.ratePerUnit}</td>
          </tr>
          <tr>
            <td>Base Duty</td>
            <td>{formatRM(result.baseDuty)}</td>
          </tr>
          <tr>
            <td>Duplicate Copy Fee (RM10 per copy)</td>
            <td>
              {result.duplicateCopies} × {formatRM(result.duplicateCopyFeePerCopy)} ={" "}
              {formatRM(result.duplicateCopyTotal)}
            </td>
          </tr>
          <tr className="total-row">
            <td>Total Stamp Duty</td>
            <td>{formatRM(result.totalDuty)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
