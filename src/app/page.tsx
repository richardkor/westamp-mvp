"use client";

/**
 * WeStamp Public Homepage
 *
 * Public-facing landing page. Layout from top to bottom:
 *   1. Hero       — headline + subhead + primary/secondary CTAs +
 *                   "track your submission" hint (no user accounts).
 *   2. How it works — four-step service journey card row.
 *   3. Supported documents — Tenancy Agreement, Employment Contract,
 *                   Statutory Declaration, General Document.
 *   4. Trust strip — calm, non-overclaiming reassurance.
 *   5. Tenancy stamp duty calculator — preserved from the previous
 *                   homepage as a useful tool. Logic is byte-identical.
 *   6. Speak to a Lawyer card — preserved from the previous homepage.
 *
 * The page does NOT promise full automation, does NOT promise that
 * every document will be accepted, and does NOT claim every General
 * Document is RM10 fixed duty. It does NOT provide a user dashboard
 * (no auth yet) — submissions are tracked via the receipt link the
 * user is given after upload.
 */

import { useState } from "react";
import {
  calculateTenancyDuty,
  DutyCalculatorResult,
  DutyResultOk,
} from "../lib/duty-calculator";
import { buildWhatsAppUrl, homePageMessage } from "../lib/whatsapp";

interface HomeStep {
  num: string;
  title: string;
  body: string;
}

interface HomeCategory {
  title: string;
  body: string;
  tag: string;
}

const HOME_STEPS: HomeStep[] = [
  {
    num: "1",
    title: "Upload your document",
    body: "Send us your signed PDF and tell us what kind of document it is.",
  },
  {
    num: "2",
    title: "Review and confirm details",
    body: "We check the document and may ask you to confirm a detail before we proceed.",
  },
  {
    num: "3",
    title: "We process the stamping",
    body: "Our team handles the duty payment and certificate retrieval through e-Duti Setem.",
  },
  {
    num: "4",
    title: "Track status and download",
    body: "Use your receipt link to follow progress. When ready, download your stamped certificate.",
  },
];

const HOME_CATEGORIES: HomeCategory[] = [
  {
    title: "Tenancy Agreement",
    body: "Residential tenancy agreements. Duty is calculated from rent, lease duration, and copies.",
    tag: "Stamping support",
  },
  {
    title: "Employment Contract",
    body: "Reviewed by our team and stamped through e-Duti Setem manually.",
    tag: "Assisted handling",
  },
  {
    title: "Statutory Declaration",
    body: "Reviewed by our team and stamped through e-Duti Setem manually.",
    tag: "Assisted handling",
  },
  {
    title: "General Document",
    body: "Other documents are accepted subject to review. We confirm what's possible before proceeding.",
    tag: "Subject to review",
  },
];

/**
 * Home page — public landing + tenancy stamp duty calculator tool.
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
    <main className="page-wide home-page">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="home-hero" aria-label="WeStamp introduction">
        <span className="home-eyebrow">WeStamp · Document Stamping</span>
        <h1>Stamp your Malaysian documents online.</h1>
        <p className="home-subhead">
          Upload your signed document and we&apos;ll guide you through duty
          payment and certificate retrieval — without you having to
          learn the e-Duti Setem portal yourself.
        </p>
        <div className="home-cta-row">
          <a href="/upload" className="btn btn-primary btn-lg">
            Upload document for stamping →
          </a>
          <a href="/generate" className="btn btn-outline btn-lg">
            Generate tenancy agreement
          </a>
        </div>
        <p className="home-track">
          Already submitted a document? Open the receipt link from your
          confirmation page to check status.
        </p>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section className="home-section" aria-label="How WeStamp works">
        <h2>How it works</h2>
        <p className="home-section-lead">
          A clear four-step service journey from upload to stamped
          certificate. We don&apos;t claim full automation — most
          documents are reviewed by our team before stamping proceeds.
        </p>
        <ol className="home-steps">
          {HOME_STEPS.map((step) => (
            <li key={step.num} className="home-step">
              <span className="home-step-number" aria-hidden="true">
                {step.num}
              </span>
              <p className="home-step-title">{step.title}</p>
              <p className="home-step-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Supported documents ────────────────────────────────── */}
      <section
        className="home-section"
        aria-label="Supported document categories"
      >
        <h2>Supported documents</h2>
        <p className="home-section-lead">
          We currently support the following categories. Acceptance
          for any specific document still depends on its content —
          we&apos;ll confirm before stamping proceeds.
        </p>
        <div className="home-categories">
          {HOME_CATEGORIES.map((cat) => (
            <div key={cat.title} className="home-category">
              <p className="home-category-title">{cat.title}</p>
              <p className="home-category-body">{cat.body}</p>
              <span className="home-category-tag">{cat.tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust strip ─────────────────────────────────────────── */}
      <section className="home-section" aria-label="Trust and safety">
        <h2>What you can expect</h2>
        <ul className="home-trust-list">
          <li className="home-trust-item">
            <strong>Secure upload.</strong> Your PDF is sent directly
            to WeStamp and isn&apos;t shared publicly.
          </li>
          <li className="home-trust-item">
            <strong>Status tracking.</strong> Each submission gets its
            own receipt link with a step-by-step progress timeline.
          </li>
          <li className="home-trust-item">
            <strong>We may contact you.</strong> If a detail on your
            document needs to be confirmed, we&apos;ll reach out before
            we stamp.
          </li>
          <li className="home-trust-item">
            <strong>No surprises.</strong> Documents subject to review
            are flagged early. We don&apos;t commit to stamping
            something we haven&apos;t verified.
          </li>
        </ul>
      </section>

      {/* ── Tenancy stamp duty calculator (preserved tool) ────── */}
      <section className="home-section" aria-label="Stamp duty calculator">
        <div className="home-tool-heading">
          <h2>Tenancy stamp duty calculator</h2>
          <span className="home-tool-heading-hint">
            Item 49(a), as amended / currently applied
          </span>
        </div>
        <p className="home-section-lead">
          Estimate the duty payable on a residential tenancy agreement.
          For non-residential, mixed-use, or unusual structures, the
          result will route to manual review.
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

        {/* Results */}
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
      </section>

      {/* ── Speak to a Lawyer card (preserved) ─────────────────── */}
      <section className="home-section" aria-label="Speak to a lawyer">
        <div className="lane-card lane-card-lawyer">
          <p className="lane-card-heading">Need a Custom Agreement?</p>
          <p className="lane-card-body">
            WeStamp generates standard fixed-term residential tenancy
            agreements. If you need non-standard terms, a customised
            agreement, or legal advice, you may choose to speak directly
            to a lawyer.
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
            This connects you to an independent Malaysian advocate &amp;
            solicitor. WeStamp is a self-serve software platform and does
            not provide legal advice or legal services.
          </p>
        </div>
      </section>
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
