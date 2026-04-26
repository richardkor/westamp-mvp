"use client";

/**
 * /receipt/[id] — Public Submission Receipt
 *
 * Safe public-facing receipt page for stamping submissions.
 * Requires an unguessable receipt token via ?token= query param.
 *
 * Shows only minimal public-safe information:
 * - Submission reference
 * - File name
 * - Category
 * - Submission date
 * - High-level public status
 *
 * Does NOT expose any internal STSDS state, fulfilment controls,
 * event history, payment references, or operator tooling.
 */

import { useState, useEffect } from "react";
import { isNominalDutyCategory } from "../../../lib/nominal-duty-registry";

/**
 * Public-safe progress step received from the receipt API. Mirrors
 * `PublicTimelineStep` in `src/lib/public-timeline.ts`. Only public
 * copy travels here — no internal status enums, no nominal-duty
 * vocabulary, no portal jargon.
 */
interface PublicTimelineStep {
  key:
    | "received"
    | "under_review"
    | "awaiting_confirmation"
    | "awaiting_payment"
    | "stamping_in_progress"
    | "completed";
  label: string;
  state: "done" | "current" | "upcoming";
  description?: string;
}

interface PublicReceipt {
  id: string;
  originalFileName: string;
  documentCategory: string;
  categoryLabel: string;
  createdAt: string;
  publicStatus: string;
  certificateReady: boolean;
  timeline: PublicTimelineStep[];
}

const STATUS_COLORS: Record<string, string> = {
  Received: "#1a56db",
  "Awaiting Payment": "#e65100",
  "In Progress": "#7c3aed",
  "Under Review": "#b45309",
  Completed: "#16a34a",
};

export default function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "fallback">("idle");

  // Resolve async params
  useEffect(() => {
    params.then((p) => setJobId(p.id));
  }, [params]);

  // Fetch receipt
  useEffect(() => {
    if (!jobId) return;
    const urlToken = new URLSearchParams(window.location.search).get("token");
    if (!urlToken) {
      setDenied(true);
      setLoading(false);
      return;
    }
    setToken(urlToken);

    fetch(`/api/receipt/${jobId}?token=${encodeURIComponent(urlToken)}`)
      .then((res) => {
        if (!res.ok) {
          setDenied(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setReceipt(data as PublicReceipt);
      })
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) {
    return (
      <main>
        <p style={{ color: "#666", padding: "40px 0" }}>Loading...</p>
      </main>
    );
  }

  if (denied) {
    return (
      <main>
        <h1>Access Denied</h1>
        <p style={{ color: "#666" }}>
          This receipt link is invalid. Please check your submission
          confirmation for the correct link.
        </p>
      </main>
    );
  }

  if (!receipt) return null;

  const statusColor = STATUS_COLORS[receipt.publicStatus] ?? "#666";

  const receiptUrl =
    typeof window !== "undefined"
      ? window.location.href
      : "";

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 3000);
    } catch {
      setCopyStatus("fallback");
    }
  }

  return (
    <main>
      <a href="/" className="back-link">
        &larr; Back to Home
      </a>
      <span className="receipt-page-eyebrow">WeStamp · Submission Receipt</span>
      <h1 className="receipt-page-heading">Submission received</h1>
      <p className="receipt-intro">
        WeStamp has received your document for stamping.
      </p>
      <p className="receipt-secondary">
        Use this page to track the current high-level status of your
        submission. You can save the link and return at any time.
      </p>

      <div className="receipt-card">
        <div className="receipt-row">
          <span className="receipt-label">Submission Reference</span>
          <span className="receipt-value receipt-ref">{receipt.id}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">File</span>
          <span className="receipt-value">{receipt.originalFileName}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Category</span>
          <span className="receipt-value">{receipt.categoryLabel}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Submitted</span>
          <span className="receipt-value">
            {new Date(receipt.createdAt).toLocaleString("en-MY", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Status</span>
          <span className="receipt-value">
            <span
              className="receipt-status-badge"
              style={{ background: statusColor + "18", color: statusColor }}
            >
              {receipt.publicStatus}
            </span>
          </span>
        </div>
      </div>

      {/* ── Public progress timeline ─────────────────────────────────
          Same shape across every category. Each step's state is
          derived in `src/lib/public-timeline.ts` from sanitised
          inputs only — no internal status enums, nominal-duty
          terminology, or portal jargon ever reach this page. Steps
          that don't apply yet are shown neutrally as "upcoming"
          rather than removed, so the timeline looks consistent
          across Tenancy, Employment Contract, Statutory Declaration,
          and Other / Not Sure submissions. */}
      {receipt.timeline && receipt.timeline.length > 0 && (
        <div className="receipt-timeline-wrap" aria-label="Submission progress">
          <h2 className="receipt-timeline-heading">Progress</h2>
          <ol className="receipt-timeline">
            {receipt.timeline.map((step) => {
              const stateClass = `receipt-timeline-step receipt-timeline-${step.state}`;
              const ariaCurrent =
                step.state === "current" ? "step" : undefined;
              return (
                <li
                  key={step.key}
                  className={stateClass}
                  aria-current={ariaCurrent}
                >
                  <span className="receipt-timeline-marker" aria-hidden="true">
                    {step.state === "done" ? "✓" : step.state === "current" ? "●" : "○"}
                  </span>
                  <span className="receipt-timeline-body">
                    <span className="receipt-timeline-label">{step.label}</span>
                    {step.description && (
                      <span className="receipt-timeline-desc">
                        {step.description}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {/* Footnote intentionally removed.
              A previous version showed a static "Document details
              review: not yet requested. User confirmation: not yet
              required." line below the timeline. That copy could
              contradict the timeline, which legitimately shows
              "Awaiting your confirmation" as `current` when the
              operator has marked the job as awaiting_user (or
              cannot_proceed). The timeline is now the single source
              of truth for this step on the public page. A future
              user-confirmation flow will plug into the existing
              "Awaiting your confirmation" step without changing this
              page's shape. */}
        </div>
      )}

      {/* What happens next — calm, public-facing progress framing.
          Keeps backend mechanics out of sight; surfaces a soft
          turnaround guidance without promising instant stamping.
          Suppressed once the job is delivered.

          The turnaround bullet is lane-aware: tenancy submissions run
          through the automated sewa_pajakan lane and typically update
          within a couple of hours, so the "~2 hours" line is roughly
          accurate for them. Nominal-duty categories (e.g. Employment
          Contract, Statutory Declaration) are reviewed and carried
          through e-Duti Setem manually by an operator, so the same
          "~2 hours" line over-promises and quietly creates false
          "something is broken" friction when legitimate manual review
          takes longer. For those categories we show a calmer, more
          honest line — without exposing internal lifecycle state
          names, operator jargon, or anything that would imply live
          portal submission / payment / stamping. */}
      {receipt.publicStatus !== "Completed" && (
        <div className="receipt-next-card">
          <p className="receipt-next-card-title">What happens next</p>
          <ul>
            <li>Your document has been received.</li>
            <li>
              WeStamp will process your submission and update this
              page as it progresses.
            </li>
            {isNominalDutyCategory(receipt.documentCategory) ? (
              <li>
                This document type is reviewed by our team, so updates
                may take longer than for simpler submissions.
              </li>
            ) : (
              <li>Most submissions are updated within around 2 hours.</li>
            )}
            <li>
              We may contact you if any details need to be confirmed.
            </li>
            <li>
              You can return to this page anytime to check the latest
              status.
            </li>
          </ul>
        </div>
      )}

      {/* Save receipt link */}
      <div className="receipt-save-card">
        <p className="receipt-save-card-title">
          Save this link to check your submission status or download
          your certificate later.
        </p>
        {copyStatus === "fallback" ? (
          <input
            type="text"
            readOnly
            value={receiptUrl}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="receipt-copy-fallback-input"
          />
        ) : (
          <button
            onClick={handleCopyLink}
            className={`receipt-copy-btn${copyStatus === "copied" ? " receipt-copy-btn-copied" : ""}`}
          >
            {copyStatus === "copied" ? "Link copied" : "Copy receipt link"}
          </button>
        )}
      </div>

      {/* Certificate download — shown only when truly ready */}
      {receipt.certificateReady && token ? (
        <div className="receipt-cert-card">
          <p className="receipt-cert-card-title">
            Your stamped certificate is ready.
          </p>
          <a
            href={`/api/receipt/${receipt.id}/certificate?token=${encodeURIComponent(token)}`}
            download
            className="receipt-cert-download-btn"
          >
            Download Certificate
          </a>
        </div>
      ) : receipt.publicStatus === "Completed" ? (
        <div className="receipt-cert-pending">
          Your certificate is not available for download yet.
        </div>
      ) : null}
    </main>
  );
}
