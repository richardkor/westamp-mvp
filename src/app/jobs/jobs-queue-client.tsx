"use client";

/**
 * JobsQueueClient — Client Component for the stamping jobs queue.
 *
 * Handles filter chip interaction and renders the job table.
 * Receives pre-serialised job list items from the Server Component.
 *
 * Fulfilment queue categories are derived at render time from
 * each job's fulfilmentState — nothing is stored separately.
 */

import { useState, useEffect } from "react";
import type { JobListItem } from "./page";

// ─── Fulfilment queue derivation ────────────────────────────────────

type FulfilmentQueue =
  | "awaiting_payment"
  | "waiting_for_certificate"
  | "certificate_retrieved"
  | "none";

function deriveFulfilmentQueue(item: JobListItem): FulfilmentQueue {
  if (!item.fulfilmentState) return "none";
  const { paymentStatus, certificateStatus } = item.fulfilmentState;
  if (certificateStatus === "certificate_retrieved") return "certificate_retrieved";
  if (paymentStatus === "payment_marked_done" && certificateStatus === "waiting_for_certificate")
    return "waiting_for_certificate";
  if (paymentStatus === "awaiting_payment") return "awaiting_payment";
  return "none";
}

const QUEUE_LABELS: Record<FulfilmentQueue, string> = {
  awaiting_payment: "Awaiting Payment",
  waiting_for_certificate: "Waiting for Certificate",
  certificate_retrieved: "Certificate Retrieved",
  none: "—",
};

// ─── Sort: most-actionable first ────────────────────────────────────

const QUEUE_SORT_ORDER: Record<FulfilmentQueue, number> = {
  awaiting_payment: 0,
  waiting_for_certificate: 1,
  none: 2,
  certificate_retrieved: 3,
};

function sortJobs(items: JobListItem[]): JobListItem[] {
  return [...items].sort((a, b) => {
    const qa = deriveFulfilmentQueue(a);
    const qb = deriveFulfilmentQueue(b);
    const orderDiff = QUEUE_SORT_ORDER[qa] - QUEUE_SORT_ORDER[qb];
    if (orderDiff !== 0) return orderDiff;
    // Within awaiting_payment and waiting_for_certificate: longest-waiting first
    if (qa === "awaiting_payment" || qa === "waiting_for_certificate") {
      const sinceA = deriveWaitingSince(a, qa);
      const sinceB = deriveWaitingSince(b, qb);
      if (sinceA && sinceB) {
        return new Date(sinceA).getTime() - new Date(sinceB).getTime();
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    // Within none and certificate_retrieved: newest first
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// ─── Filter types ───────────────────────────────────────────────────

type FilterKey = "all" | FulfilmentQueue | "integrity_issues";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "awaiting_payment", label: "Awaiting Payment" },
  { key: "waiting_for_certificate", label: "Waiting for Certificate" },
  { key: "certificate_retrieved", label: "Certificate Retrieved" },
  { key: "integrity_issues", label: "Integrity Issues" },
];

const VALID_FILTER_KEYS = new Set<string>(FILTER_OPTIONS.map((o) => o.key));

// ─── Next action derivation ─────────────────────────────────────────

function deriveNextAction(item: JobListItem): string {
  if (!item.fulfilmentState || !item.fulfilmentState.adjudicationNumber) {
    return "Record adjudication";
  }
  const { paymentStatus, certificateStatus, delivered } = item.fulfilmentState;
  if (delivered) return "Delivered";
  if (paymentStatus === "awaiting_payment") return "Mark payment done";
  if (paymentStatus === "payment_marked_done" && certificateStatus === "waiting_for_certificate")
    return "Upload certificate";
  if (certificateStatus === "certificate_retrieved") return "View lifecycle";
  return "View lifecycle";
}

// ─── Ageing derivation ──────────────────────────────────────────────

/**
 * Returns the ISO timestamp from which to measure waiting age,
 * or null if no age should be shown.
 */
function deriveWaitingSince(item: JobListItem, queue: FulfilmentQueue): string | null {
  if (!item.fulfilmentState) return null;
  switch (queue) {
    case "awaiting_payment":
      // Age since adjudication was recorded (which set awaiting_payment)
      return item.fulfilmentState.lastFulfilmentUpdateAt;
    case "waiting_for_certificate":
      // Age since payment was marked done
      return item.fulfilmentState.paymentMarkedAt ?? item.fulfilmentState.lastFulfilmentUpdateAt;
    case "certificate_retrieved":
      // No waiting age — show completed timestamp instead
      return null;
    default:
      return null;
  }
}

function formatAge(isoSince: string): string {
  const ms = Date.now() - new Date(isoSince).getTime();
  if (ms < 0) return "Just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainMin = minutes % 60;
    return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

// ─── Date formatting ────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-MY", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Truncate filename ──────────────────────────────────────────────

function truncateFileName(name: string, maxLen: number = 32): string {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf(".");
  if (ext > 0 && name.length - ext <= 5) {
    const extStr = name.slice(ext);
    return name.slice(0, maxLen - extStr.length - 1) + "…" + extStr;
  }
  return name.slice(0, maxLen - 1) + "…";
}

// ─── Component ──────────────────────────────────────────────────────

export function JobsQueueClient({ items }: { items: JobListItem[] }) {
  // Initialise filter from URL query param ?queue=...
  const [filter, setFilter] = useState<FilterKey>(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("queue");
    return param && VALID_FILTER_KEYS.has(param) ? (param as FilterKey) : "all";
  });

  // Sync filter changes back to URL without full navigation
  useEffect(() => {
    const url = new URL(window.location.href);
    if (filter === "all") {
      url.searchParams.delete("queue");
    } else {
      url.searchParams.set("queue", filter);
    }
    window.history.replaceState({}, "", url.toString());
  }, [filter]);

  // Compute counts
  const counts: Record<FulfilmentQueue, number> = {
    awaiting_payment: 0,
    waiting_for_certificate: 0,
    certificate_retrieved: 0,
    none: 0,
  };
  let integrityIssueCount = 0;
  for (const item of items) {
    counts[deriveFulfilmentQueue(item)]++;
    if (item.integrityAnomalyCount > 0) integrityIssueCount++;
  }

  // Filter
  const filtered =
    filter === "all"
      ? items
      : filter === "integrity_issues"
        ? items.filter((item) => item.integrityAnomalyCount > 0)
        : items.filter((item) => deriveFulfilmentQueue(item) === filter);

  // Sort
  const sorted = sortJobs(filtered);

  // Build the return URL for queue context on detail-page links
  const returnQueue = filter === "all" ? "/jobs" : `/jobs?queue=${filter}`;

  return (
    <>
      {/* Filter chips */}
      <div className="filter-chips">
        {FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "all"
              ? items.length
              : opt.key === "integrity_issues"
                ? integrityIssueCount
                : counts[opt.key as FulfilmentQueue];
          return (
            <button
              key={opt.key}
              type="button"
              className={`filter-chip${filter === opt.key ? " filter-chip-active" : ""}`}
              onClick={() => setFilter(opt.key)}
            >
              {opt.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Jobs table */}
      {sorted.length === 0 ? (
        <p className="jobs-empty">No jobs match this filter.</p>
      ) : (
        <div className="jobs-table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>Status</th>
                <th>Fulfilment</th>
                <th>Waiting</th>
                <th>Adj. No.</th>
                <th>Next Action</th>
                <th>Certificate</th>
                <th>Integrity</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const queue = deriveFulfilmentQueue(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <a href={`/upload/${item.id}?fromQueue=${encodeURIComponent(returnQueue)}`} className="jobs-file-link">
                        {truncateFileName(item.originalFileName)}
                      </a>
                    </td>
                    <td>{item.categoryLabel}</td>
                    <td>
                      <span className={`intake-status-badge intake-status-${item.status}`}>
                        {item.statusLabel}
                      </span>
                    </td>
                    <td>
                      {queue !== "none" ? (
                        <span className={`fulfilment-badge fulfilment-badge-${queue}`}>
                          {QUEUE_LABELS[queue]}
                        </span>
                      ) : (
                        <span className="jobs-no-fulfilment">—</span>
                      )}
                      {item.integrityAnomalyCount > 0 && (
                        <span className="jobs-integrity-warn" title="Fulfilment integrity issue detected">
                          {" "}⚠
                        </span>
                      )}
                    </td>
                    <td className="jobs-waiting-age">
                      {(() => {
                        const since = deriveWaitingSince(item, queue);
                        if (since) return formatAge(since);
                        if (queue === "certificate_retrieved" && item.fulfilmentState?.certificateRetrievedAt) {
                          return formatDate(item.fulfilmentState.certificateRetrievedAt);
                        }
                        return "—";
                      })()}
                    </td>
                    <td className="jobs-adj-no">
                      {item.fulfilmentState?.adjudicationNumber ?? "—"}
                    </td>
                    <td>
                      {item.integrityAnomalyCount > 0 ? (
                        <a
                          href={`/upload/${item.id}?fromQueue=${encodeURIComponent(returnQueue)}#fulfilment-integrity`}
                          className="jobs-next-action jobs-next-action-integrity"
                        >
                          Review issue →
                        </a>
                      ) : (
                        <a
                          href={`/upload/${item.id}?fromQueue=${encodeURIComponent(returnQueue)}#fulfilment-lifecycle`}
                          className="jobs-next-action"
                        >
                          {deriveNextAction(item)} →
                        </a>
                      )}
                    </td>
                    <td>
                      {queue === "certificate_retrieved" && item.fulfilmentState?.certificateStoragePath ? (
                        <a
                          href={`/api/intake/${item.id}/certificate-download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="jobs-next-action"
                        >
                          View PDF
                        </a>
                      ) : (
                        <span className="jobs-no-fulfilment">—</span>
                      )}
                    </td>
                    <td className="jobs-integrity-summary">
                      {item.integrityAnomalyCount > 0 ? (
                        <>
                          <span className="jobs-integrity-text">{item.integrityAnomalies[0]}</span>
                          {item.integrityAnomalyCount > 1 && (
                            <span className="jobs-integrity-more"> +{item.integrityAnomalyCount - 1} more</span>
                          )}
                        </>
                      ) : (
                        <span className="jobs-no-fulfilment">—</span>
                      )}
                    </td>
                    <td className="jobs-date">{formatDate(item.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
