"use client";

/**
 * JobsQueueClient — Client Component for the stamping jobs queue.
 *
 * Operator inbox UI. Each job is rendered as a stacked card so the
 * filename and key details remain readable on any operator screen
 * without horizontal scrolling. Cards expose:
 *   - filename (full, wraps), job id (short), created date
 *   - category, status badge, nominal-duty handling label
 *   - pipeline state badge, waiting age, adjudication number
 *   - integrity warning text when fulfilment anomalies exist
 *   - open / next-action link, certificate link if available
 *   - operator-only Archive / Restore button (soft archive — never
 *     deletes records or uploaded PDFs)
 *
 * Three orthogonal controls sit above the card list:
 *   1. View toggle: Active (default) vs Archived.
 *   2. Pipeline chips — what needs doing next (new / needs user /
 *      awaiting payment / waiting for certificate / ready to deliver /
 *      completed / integrity issues).
 *   3. Lane chips — which document category.
 * Plus a text search that matches filename or job id.
 *
 * Sort order: newest-first by `createdAt`, tiebreak on id for
 * stability.
 *
 * URL sync: `?queue=<pipeline>`, `?lane=<category>`, `?q=<search>`,
 * `?view=archived`. Invalid values are ignored and fall back to
 * defaults.
 */

import { useState, useEffect } from "react";
import type { JobListItem } from "./page";
import { NOMINAL_DUTY_STATE_LABELS } from "../../lib/nominal-duty-lifecycle";
import { DOCUMENT_CATEGORY_LABELS } from "../../lib/stamping-types";

// ─── Pipeline state derivation ──────────────────────────────────────

type PipelineState =
  | "new"
  | "needs_user"
  | "awaiting_payment"
  | "waiting_for_certificate"
  | "ready_to_deliver"
  | "completed"
  | "idle";

const PIPELINE_LABELS: Record<PipelineState, string> = {
  new: "New",
  needs_user: "Needs User",
  awaiting_payment: "Awaiting Payment",
  waiting_for_certificate: "Waiting for Certificate",
  ready_to_deliver: "Ready to Deliver",
  completed: "Completed",
  idle: "In Handling",
};

function derivePipelineState(item: JobListItem): PipelineState {
  const fs = item.fulfilmentState;
  const nd = item.nominalDutyState;

  if (fs?.delivered) return "completed";
  if (nd === "completed") return "completed";
  if (nd === "awaiting_user" || nd === "cannot_proceed") return "needs_user";

  if (fs) {
    if (fs.certificateStatus === "certificate_retrieved") {
      return "ready_to_deliver";
    }
    if (
      fs.paymentStatus === "payment_marked_done" &&
      fs.certificateStatus === "waiting_for_certificate"
    ) {
      return "waiting_for_certificate";
    }
    if (fs.paymentStatus === "awaiting_payment") {
      return "awaiting_payment";
    }
  }

  if (!fs && nd === null) return "new";
  return "idle";
}

// ─── Pipeline filter ────────────────────────────────────────────────

type PipelineFilterKey = "all" | PipelineState | "integrity_issues";

const PIPELINE_FILTER_OPTIONS: { key: PipelineFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "needs_user", label: "Needs User" },
  { key: "awaiting_payment", label: "Awaiting Payment" },
  { key: "waiting_for_certificate", label: "Waiting for Certificate" },
  { key: "ready_to_deliver", label: "Ready to Deliver" },
  { key: "completed", label: "Completed" },
  { key: "integrity_issues", label: "Integrity Issues" },
];

const VALID_PIPELINE_KEYS = new Set<string>(
  PIPELINE_FILTER_OPTIONS.map((o) => o.key)
);

// ─── Lane filter ────────────────────────────────────────────────────

type LaneFilterKey = "all" | keyof typeof DOCUMENT_CATEGORY_LABELS;

const LANE_FILTER_OPTIONS: { key: LaneFilterKey; label: string }[] = [
  { key: "all", label: "All Lanes" },
  { key: "tenancy_agreement", label: "Tenancy" },
  { key: "employment_contract", label: "Employment Contract" },
  { key: "statutory_declaration", label: "Statutory Declaration" },
  { key: "other", label: "Other / Not Sure" },
];

const VALID_LANE_KEYS = new Set<string>(LANE_FILTER_OPTIONS.map((o) => o.key));

// ─── View toggle ────────────────────────────────────────────────────

type ViewKey = "active" | "archived";

const VALID_VIEW_KEYS = new Set<string>(["active", "archived"]);

// ─── Sort: newest first ─────────────────────────────────────────────

function sortJobs(items: JobListItem[]): JobListItem[] {
  return [...items].sort((a, b) => {
    const diff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

// ─── Next action derivation ─────────────────────────────────────────

function deriveNextAction(item: JobListItem, state: PipelineState): string {
  if (state === "new") return "Open";
  if (state === "needs_user") return "Follow up";
  if (state === "awaiting_payment") {
    if (!item.fulfilmentState?.adjudicationNumber) return "Record adjudication";
    return "Mark payment done";
  }
  if (state === "waiting_for_certificate") return "Upload certificate";
  if (state === "ready_to_deliver") return "Mark delivered";
  if (state === "completed") return "View lifecycle";
  return "Open";
}

function deriveNextActionFragment(state: PipelineState): string {
  switch (state) {
    case "awaiting_payment":
    case "waiting_for_certificate":
    case "ready_to_deliver":
    case "completed":
      return "#fulfilment-lifecycle";
    default:
      return "";
  }
}

// ─── Ageing derivation ──────────────────────────────────────────────

function deriveWaitingSince(
  item: JobListItem,
  state: PipelineState
): string | null {
  switch (state) {
    case "awaiting_payment":
      return item.fulfilmentState?.lastFulfilmentUpdateAt ?? null;
    case "waiting_for_certificate":
      return (
        item.fulfilmentState?.paymentMarkedAt ??
        item.fulfilmentState?.lastFulfilmentUpdateAt ??
        null
      );
    case "ready_to_deliver":
      return item.fulfilmentState?.certificateRetrievedAt ?? null;
    case "needs_user":
      return item.nominalDutyStateUpdatedAt;
    case "new":
      return item.createdAt;
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

// ─── Search matching ────────────────────────────────────────────────

function matchesSearch(item: JobListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.originalFileName.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q)
  );
}

// ─── Short id ──────────────────────────────────────────────────────

function shortId(id: string): string {
  // First 8 chars of UUID — enough to disambiguate visually while
  // keeping the card header tidy. Full id is in the link target.
  return id.length > 8 ? id.slice(0, 8) : id;
}

// ─── Component ──────────────────────────────────────────────────────

export function JobsQueueClient({ items }: { items: JobListItem[] }) {
  // Initialise view from URL query param ?view=...
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "active";
    const param = new URLSearchParams(window.location.search).get("view");
    return param && VALID_VIEW_KEYS.has(param) ? (param as ViewKey) : "active";
  });

  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilterKey>(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("queue");
    return param && VALID_PIPELINE_KEYS.has(param)
      ? (param as PipelineFilterKey)
      : "all";
  });

  const [laneFilter, setLaneFilter] = useState<LaneFilterKey>(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("lane");
    return param && VALID_LANE_KEYS.has(param) ? (param as LaneFilterKey) : "all";
  });

  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });

  // Local "in-flight" markers so the operator gets immediate feedback
  // while an archive/restore POST is round-tripping. Keyed by job id.
  const [pendingArchiveIds, setPendingArchiveIds] = useState<Set<string>>(
    () => new Set()
  );

  // Sync filter controls back to the URL. `view=active` is omitted
  // because it's the default; archived is explicit.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "active") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    if (pipelineFilter === "all") url.searchParams.delete("queue");
    else url.searchParams.set("queue", pipelineFilter);
    if (laneFilter === "all") url.searchParams.delete("lane");
    else url.searchParams.set("lane", laneFilter);
    if (searchQuery.trim() === "") url.searchParams.delete("q");
    else url.searchParams.set("q", searchQuery.trim());
    window.history.replaceState({}, "", url.toString());
  }, [view, pipelineFilter, laneFilter, searchQuery]);

  // Split active vs archived BEFORE any other filter so the view
  // toggle is the strongest filter. View counts use this split.
  const activeItems = items.filter((item) => item.archivedAt === null);
  const archivedItems = items.filter((item) => item.archivedAt !== null);
  const viewItems = view === "archived" ? archivedItems : activeItems;

  // Apply lane filter next so pipeline counts reflect both view+lane.
  const laneFiltered =
    laneFilter === "all"
      ? viewItems
      : viewItems.filter((item) => item.documentCategory === laneFilter);

  // Pipeline counts over the lane-filtered view subset.
  const pipelineCounts: Record<PipelineState, number> = {
    new: 0,
    needs_user: 0,
    awaiting_payment: 0,
    waiting_for_certificate: 0,
    ready_to_deliver: 0,
    completed: 0,
    idle: 0,
  };
  let integrityIssueCount = 0;
  for (const item of laneFiltered) {
    pipelineCounts[derivePipelineState(item)]++;
    if (item.integrityAnomalyCount > 0) integrityIssueCount++;
  }

  // Lane counts over the current view (active or archived) so the
  // chip totals follow the view toggle without being skewed by other
  // filters.
  const laneCounts: Record<string, number> = {};
  for (const item of viewItems) {
    laneCounts[item.documentCategory] =
      (laneCounts[item.documentCategory] ?? 0) + 1;
  }

  // Apply pipeline filter + search to lane-filtered set.
  const filtered = laneFiltered.filter((item) => {
    if (!matchesSearch(item, searchQuery.trim())) return false;
    if (pipelineFilter === "all") return true;
    if (pipelineFilter === "integrity_issues") {
      return item.integrityAnomalyCount > 0;
    }
    return derivePipelineState(item) === pipelineFilter;
  });

  const sorted = sortJobs(filtered);

  const returnUrl = (() => {
    const url = new URL("/jobs", "http://placeholder");
    if (view !== "active") url.searchParams.set("view", view);
    if (pipelineFilter !== "all") url.searchParams.set("queue", pipelineFilter);
    if (laneFilter !== "all") url.searchParams.set("lane", laneFilter);
    if (searchQuery.trim() !== "") url.searchParams.set("q", searchQuery.trim());
    return url.pathname + (url.search ? url.search : "");
  })();

  const anyFilterActive =
    pipelineFilter !== "all" || laneFilter !== "all" || searchQuery.trim() !== "";

  // ── Archive / Restore actions ────────────────────────────────────
  // These call the operator-gated POST /api/intake/[id]/archive
  // route. The `archive` request omits the body for "archive without
  // reason"; the route also accepts an optional `{ reason }`. The
  // simple flow here always uses confirm() with no reason input —
  // the operator can refine by hitting the API directly if a reason
  // matters for audit. After a successful response, the page is
  // refreshed (location.reload) so the server component re-renders
  // with the live archived state. This is intentionally simple and
  // robust over a more elaborate optimistic-update path.
  async function archiveJob(item: JobListItem) {
    const ok = window.confirm(
      `Hide "${item.originalFileName}" from the active queue?\n\n` +
        "The job record, uploaded source PDF, fulfilment state, and " +
        "event history are preserved. You can restore it later from " +
        "the Archived view. This is not a deletion."
    );
    if (!ok) return;

    setPendingArchiveIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });

    try {
      const res = await fetch(`/api/intake/${item.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text();
        window.alert(`Could not archive job. ${text || `HTTP ${res.status}`}`);
        setPendingArchiveIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        return;
      }
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      window.alert(`Could not archive job. ${message}`);
      setPendingArchiveIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function restoreJob(item: JobListItem) {
    const ok = window.confirm(
      `Restore "${item.originalFileName}" to the active queue?`
    );
    if (!ok) return;

    setPendingArchiveIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });

    try {
      const res = await fetch(`/api/intake/${item.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        window.alert(`Could not restore job. ${text || `HTTP ${res.status}`}`);
        setPendingArchiveIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        return;
      }
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      window.alert(`Could not restore job. ${message}`);
      setPendingArchiveIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <>
      {/* View toggle: Active vs Archived */}
      <div className="jobs-view-toggle" role="tablist" aria-label="Job view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "active"}
          className={`jobs-view-tab${view === "active" ? " jobs-view-tab-active" : ""}`}
          onClick={() => setView("active")}
        >
          Active ({activeItems.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "archived"}
          className={`jobs-view-tab${view === "archived" ? " jobs-view-tab-active" : ""}`}
          onClick={() => setView("archived")}
        >
          Archived ({archivedItems.length})
        </button>
      </div>

      {/* Pipeline chips */}
      <div className="filter-chips">
        {PIPELINE_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "all"
              ? laneFiltered.length
              : opt.key === "integrity_issues"
                ? integrityIssueCount
                : pipelineCounts[opt.key as PipelineState];
          return (
            <button
              key={opt.key}
              type="button"
              className={`filter-chip${pipelineFilter === opt.key ? " filter-chip-active" : ""}`}
              onClick={() => setPipelineFilter(opt.key)}
            >
              {opt.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Lane chips */}
      <div className="filter-chips">
        {LANE_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "all"
              ? viewItems.length
              : (laneCounts[opt.key] ?? 0);
          return (
            <button
              key={opt.key}
              type="button"
              className={`filter-chip${laneFilter === opt.key ? " filter-chip-active" : ""}`}
              onClick={() => setLaneFilter(opt.key)}
            >
              {opt.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Search box */}
      <div className="jobs-search-wrap">
        <input
          type="search"
          className="jobs-search"
          placeholder="Search filename or job id…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search jobs by filename or id"
        />
      </div>

      {/* Card list */}
      {sorted.length === 0 ? (
        <p className="jobs-empty">
          {view === "archived" && archivedItems.length === 0
            ? "No archived jobs."
            : items.length === 0
              ? "No jobs yet. Uploads will appear here as they arrive."
              : anyFilterActive
                ? "No jobs match the current filters."
                : view === "archived"
                  ? "No archived jobs match the current filters."
                  : "No jobs to show."}
        </p>
      ) : (
        <div className="jobs-card-list">
          {sorted.map((item) => {
            const state = derivePipelineState(item);
            const fragment = deriveNextActionFragment(state);
            const detailHref = `/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}${fragment}`;
            const integrityHref = `/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}#fulfilment-integrity`;
            const since = deriveWaitingSince(item, state);
            const ageText = since
              ? formatAge(since)
              : state === "completed" &&
                  item.fulfilmentState?.certificateRetrievedAt
                ? formatDate(item.fulfilmentState.certificateRetrievedAt)
                : "—";
            const isPending = pendingArchiveIds.has(item.id);
            const isArchived = item.archivedAt !== null;

            return (
              <article
                key={item.id}
                className={`jobs-card${isArchived ? " jobs-card-archived" : ""}`}
              >
                {/* Header row: pipeline badge + id + created date */}
                <header className="jobs-card-header">
                  <div className="jobs-card-header-left">
                    <span
                      className={`fulfilment-badge fulfilment-badge-${state}`}
                    >
                      {PIPELINE_LABELS[state]}
                    </span>
                    {item.integrityAnomalyCount > 0 && (
                      <span
                        className="jobs-integrity-warn"
                        title={item.integrityAnomalies.join(" • ")}
                      >
                        {" "}
                        ⚠
                      </span>
                    )}
                    {isArchived && (
                      <span className="jobs-archived-badge" title={
                        item.archivedReason
                          ? `Archived: ${item.archivedReason}`
                          : "Archived"
                      }>
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="jobs-card-header-right">
                    <span className="jobs-card-id" title={item.id}>
                      #{shortId(item.id)}
                    </span>
                    <span className="jobs-card-date">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </header>

                {/* Filename — full, wraps cleanly */}
                <h2 className="jobs-card-filename">
                  <a
                    href={`/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}`}
                    className="jobs-file-link"
                  >
                    {item.originalFileName}
                  </a>
                </h2>

                {/* Detail grid: label/value pairs in two readable rows */}
                <dl className="jobs-card-details">
                  <div className="jobs-card-detail">
                    <dt>Category</dt>
                    <dd>{item.categoryLabel}</dd>
                  </div>
                  <div className="jobs-card-detail">
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`intake-status-badge intake-status-${item.status}`}
                      >
                        {item.statusLabel}
                      </span>
                    </dd>
                  </div>
                  <div className="jobs-card-detail">
                    <dt>Handling</dt>
                    <dd>
                      {item.nominalDutyState ? (
                        NOMINAL_DUTY_STATE_LABELS[item.nominalDutyState]
                      ) : (
                        <span className="jobs-no-fulfilment">—</span>
                      )}
                    </dd>
                  </div>
                  <div className="jobs-card-detail">
                    <dt>Adj. No.</dt>
                    <dd className="jobs-adj-no">
                      {item.fulfilmentState?.adjudicationNumber ?? "—"}
                    </dd>
                  </div>
                  <div className="jobs-card-detail">
                    <dt>Waiting</dt>
                    <dd className="jobs-waiting-age">{ageText}</dd>
                  </div>
                  <div className="jobs-card-detail">
                    <dt>Certificate</dt>
                    <dd>
                      {item.fulfilmentState?.certificateStoragePath ? (
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
                    </dd>
                  </div>
                </dl>

                {/* Integrity anomaly text — only shown when present */}
                {item.integrityAnomalyCount > 0 && (
                  <p className="jobs-card-integrity">
                    <strong>Integrity:</strong>{" "}
                    <span className="jobs-integrity-text">
                      {item.integrityAnomalies[0]}
                    </span>
                    {item.integrityAnomalyCount > 1 && (
                      <span className="jobs-integrity-more">
                        {" "}
                        +{item.integrityAnomalyCount - 1} more
                      </span>
                    )}
                  </p>
                )}

                {/* Archived reason — only shown for archived cards */}
                {isArchived && item.archivedReason && (
                  <p className="jobs-card-archived-reason">
                    <strong>Archive note:</strong> {item.archivedReason}
                  </p>
                )}

                {/* Action row */}
                <footer className="jobs-card-actions">
                  {item.integrityAnomalyCount > 0 ? (
                    <a
                      href={integrityHref}
                      className="jobs-next-action jobs-next-action-integrity"
                    >
                      Review issue →
                    </a>
                  ) : (
                    <a href={detailHref} className="jobs-next-action">
                      {deriveNextAction(item, state)} →
                    </a>
                  )}
                  {isArchived ? (
                    <button
                      type="button"
                      className="jobs-archive-btn jobs-archive-btn-restore"
                      onClick={() => restoreJob(item)}
                      disabled={isPending}
                      title="Restore this job to the active queue."
                    >
                      {isPending ? "Restoring…" : "Restore"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="jobs-archive-btn"
                      onClick={() => archiveJob(item)}
                      disabled={isPending}
                      title="Hide this job from the active queue. Records and uploaded PDFs are preserved."
                    >
                      {isPending ? "Archiving…" : "Archive"}
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
