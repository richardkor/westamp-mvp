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

interface PublicReceipt {
  id: string;
  originalFileName: string;
  documentCategory: string;
  categoryLabel: string;
  createdAt: string;
  publicStatus: string;
  certificateReady: boolean;
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
      <h1>Submission Received</h1>
      <p className="receipt-intro">
        WeStamp has received your document for stamping.
      </p>
      <p className="receipt-secondary">
        You can use this page to track the current high-level status of your
        submission.
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

      {/* Save receipt link */}
      <div style={{ marginTop: "20px", fontSize: "14px", color: "#555" }}>
        <p style={{ margin: "0 0 8px" }}>
          Save this link to check your submission status or download your
          certificate later.
        </p>
        {copyStatus === "fallback" ? (
          <input
            type="text"
            readOnly
            value={receiptUrl}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: "13px",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              color: "#333",
              background: "#f9fafb",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <button
            onClick={handleCopyLink}
            style={{
              padding: "6px 14px",
              fontSize: "13px",
              background: copyStatus === "copied" ? "#16a34a" : "#1a56db",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {copyStatus === "copied" ? "Link copied" : "Copy receipt link"}
          </button>
        )}
      </div>

      {/* Certificate download — shown only when truly ready */}
      {receipt.certificateReady && token ? (
        <div className="receipt-card" style={{ marginTop: "24px" }}>
          <p style={{ margin: "0 0 12px", fontWeight: 500 }}>
            Your stamped certificate is ready.
          </p>
          <a
            href={`/api/receipt/${receipt.id}/certificate?token=${encodeURIComponent(token)}`}
            download
            style={{
              display: "inline-block",
              padding: "10px 20px",
              background: "#16a34a",
              color: "#fff",
              borderRadius: "6px",
              textDecoration: "none",
              fontWeight: 500,
              fontSize: "14px",
            }}
          >
            Download Certificate
          </a>
        </div>
      ) : receipt.publicStatus === "Completed" ? (
        <div className="receipt-card" style={{ marginTop: "24px" }}>
          <p style={{ margin: 0, color: "#666", fontSize: "14px" }}>
            Your certificate is not available for download yet.
          </p>
        </div>
      ) : null}
    </main>
  );
}
