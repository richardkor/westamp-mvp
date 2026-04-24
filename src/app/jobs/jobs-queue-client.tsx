"use client";

/**
 * JobsQueueClient — Client Component for the stamping jobs queue.
 *
 * Operator inbox UI. Renders the jobs table with three orthogonal
 * controls:
 *   1. Pipeline chips — what needs doing next (new / needs user /
 *      awaiting payment / waiting for certificate / ready to deliver /
 *      completed / integrity issues).
 *   2. Lane chips — which document category (tenancy / employment
 *      contract / statutory declaration / other).
 *   3. Text search — matches filename or job id (case-insensitive).
 *
 * The "pipeline state" is derived at render time from each job's
 * `fulfilmentState` and `nominalDutyState`. Nothing is persisted
 * separately; this is purely a presentation-layer bucketisation for
 * the operator.
 *
 * Sort order: newest-first by `createdAt`, tiebreak on id for
 * stability. The primary sort is deliberately time-based because the
 * top operator question is "what's new?" — the pipeline chip is how
 * the operator narrows to "what needs action?".
 *
 * URL sync: `?queue=<pipeline>`, `?lane=<category>`, `?q=<search>`.
 * Invalid values are ignored and fall back to defaults.
 */

import { useState, useEffect } from "react";
import type { JobListItem } from "./page";
import { NOMINAL_DUTY_STATE_LABELS } from "../../lib/nominal-duty-lifecycle";
import { DOCUMENT_CATEGORY_LABELS } from "../../lib/stamping-types";

// ─── Pipeline state derivation ──────────────────────────────────────

/**
 * Coarse operator-facing pipeline bucket for a job. Derived, not
 * stored. Priority is important: `needs_user` and `ready_to_deliver`
 * outrank mid-flow states because the operator needs to see them.
 */
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

  // Delivered — fully done from the operator's inbox POV.
  if (fs?.delivered) return "completed";

  // Nominal-duty job that the operator has attested is externally
  // stamped. Leaves the inbox as completed even if no fulfilmentState
  // exists (not every nominal-duty job will have one recorded).
  if (nd === "completed") return "completed";

  // Needs-user bucket: the operator has reached out (or marked the
  // job as stuck) and needs a reply from the user before anything
  // else can happen. This outranks any fulfilment progress because
  // nothing else will move until the user is back.
  if (nd === "awaiting_user" || nd === "cannot_proceed") {
    return "needs_user";
  }

  // Fulfilment-lifecycle buckets.
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

  // Truly untouched: no fulfilment recorded and the operator has not
  // written any nominal-duty state yet. This is the "new upload"
  // bucket that operators most want to find fast.
  if (!fs && nd === null) return "new";

  // Operator has started something (nominal-duty under_review or
  // external_portal_in_progress, or partial fulfilment state) but the
  // job is not in one of the named actionable buckets above.
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

// ─── Sort: newest first ─────────────────────────────────────────────

function sortJobs(items: JobListItem[]): JobListItem[] {
  return [...items].sort((a, b) => {
    const diff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (diff !== 0) return diff;
    // Stable tiebreak on id so the order doesn't shuffle between
    // renders when two jobs share a timestamp.
    return a.id.localeCompare(b.id);
  });
}

// ─── Next action derivation ─────────────────────────────────────────

/**
 * Short action phrase for the "Next Action" cell. Pairs with a link
 * fragment (see `deriveNextActionFragment`) so the operator lands at
 * the relevant panel on the detail page.
 */
function deriveNextAction(item: JobListItem, state: PipelineState): string {
  if (state === "new") return "Open";
  if (state === "needs_user") return "Follow up";
  if (state === "awaiting_payment") {
    // Adjudication isn't recorded yet — that's the precondition for
    // "Mark payment done", so surface the real first step.
    if (!item.fulfilmentState?.adjudicationNumber) return "Record adjudication";
    return "Mark payment done";
  }
  if (state === "waiting_for_certificate") return "Upload certificate";
  if (state === "ready_to_deliver") return "Mark delivered";
  if (state === "completed") return "View lifecycle";
  return "Open";
}

/**
 * Hash fragment to append to the detail-page link. Fulfilment-lifecycle
 * states deep-link to that panel; other states (new, needs_user, idle)
 * open the page top so the operator sees the whole job.
 */
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

/**
 * Returns the ISO timestamp from which to measure waiting age, or
 * null if no age should be shown for this state.
 */
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
      // Age since the operator marked the job as needing user input.
      return item.nominalDutyStateUpdatedAt;
    case "new":
      // Age since upload, so an "aged new" job stands out.
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

// ─── Search matching ────────────────────────────────────────────────

function matchesSearch(item: JobListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.originalFileName.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q)
  );
}

// ─── Component ──────────────────────────────────────────────────────

export function JobsQueueClient({ items }: { items: JobListItem[] }) {
  // Initialise pipeline filter from URL query param ?queue=...
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilterKey>(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("queue");
    return param && VALID_PIPELINE_KEYS.has(param)
      ? (param as PipelineFilterKey)
      : "all";
  });

  // Initialise lane filter from URL query param ?lane=...
  const [laneFilter, setLaneFilter] = useState<LaneFilterKey>(() => {
    if (typeof window === "undefined") return "all";
    const param = new URLSearchParams(window.location.search).get("lane");
    return param && VALID_LANE_KEYS.has(param) ? (param as LaneFilterKey) : "all";
  });

  // Initialise search query from URL query param ?q=...
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });

  // Sync all three filter controls back to the URL without full
  // navigation. Keeps links in the address bar meaningful and makes
  // browser back/forward reflect filter state.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (pipelineFilter === "all") url.searchParams.delete("queue");
    else url.searchParams.set("queue", pipelineFilter);
    if (laneFilter === "all") url.searchParams.delete("lane");
    else url.searchParams.set("lane", laneFilter);
    if (searchQuery.trim() === "") url.searchParams.delete("q");
    else url.searchParams.set("q", searchQuery.trim());
    window.history.replaceState({}, "", url.toString());
  }, [pipelineFilter, laneFilter, searchQuery]);

  // Apply lane filter first so pipeline counts reflect the selected
  // lane. The operator's mental model is typically "I'm in the
  // tenancy lane — what's new / needs user / etc. in that lane?".
  const laneFiltered =
    laneFilter === "all"
      ? items
      : items.filter((item) => item.documentCategory === laneFilter);

  // Compute pipeline counts over the lane-filtered subset.
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

  // Compute lane counts over the full item list (before any filter)
  // so the lane chip counts always show the true totals regardless of
  // which pipeline chip is active.
  const laneCounts: Record<string, number> = {};
  for (const item of items) {
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

  // Build the return URL for queue context on detail-page links.
  // Preserves pipeline + lane + search so "back to queue" feels right.
  const returnUrl = (() => {
    const url = new URL("/jobs", "http://placeholder");
    if (pipelineFilter !== "all") url.searchParams.set("queue", pipelineFilter);
    if (laneFilter !== "all") url.searchParams.set("lane", laneFilter);
    if (searchQuery.trim() !== "") url.searchParams.set("q", searchQuery.trim());
    return url.pathname + (url.search ? url.search : "");
  })();

  const anyFilterActive =
    pipelineFilter !== "all" || laneFilter !== "all" || searchQuery.trim() !== "";

  return (
    <>
      {/* Pipeline chips — what needs doing next */}
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

      {/* Lane chips — which document category */}
      <div className="filter-chips">
        {LANE_FILTER_OPTIONS.map((opt) => {
          const count =
            opt.key === "all" ? items.length : (laneCounts[opt.key] ?? 0);
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

      {/* Jobs table */}
      {sorted.length === 0 ? (
        <p className="jobs-empty">
          {items.length === 0
            ? "No jobs yet. Uploads will appear here as they arrive."
            : anyFilterActive
              ? "No jobs match the current filters."
              : "No jobs to show."}
        </p>
      ) : (
        <div className="jobs-table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>Status</th>
                <th>Handling</th>
                <th>Pipeline</th>
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
                const state = derivePipelineState(item);
                const fragment = deriveNextActionFragment(state);
                const detailHref = `/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}${fragment}`;
                const integrityHref = `/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}#fulfilment-integrity`;
                return (
                  <tr key={item.id}>
                    <td>
                      <a
                        href={`/upload/${item.id}?fromQueue=${encodeURIComponent(returnUrl)}`}
                        className="jobs-file-link"
                      >
                        {truncateFileName(item.originalFileName)}
                      </a>
                    </td>
                    <td>{item.categoryLabel}</td>
                    <td>
                      <span
                        className={`intake-status-badge intake-status-${item.status}`}
                      >
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="jobs-handling-cell">
                      {item.nominalDutyState ? (
                        <span className="jobs-handling-text">
                          {NOMINAL_DUTY_STATE_LABELS[item.nominalDutyState]}
                        </span>
                      ) : (
                        <span className="jobs-no-fulfilment">—</span>
                      )}
                    </td>
                    <td>
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
                    </td>
                    <td className="jobs-waiting-age">
                      {(() => {
                        const since = deriveWaitingSince(item, state);
                        if (since) return formatAge(since);
                        if (
                          state === "completed" &&
                          item.fulfilmentState?.certificateRetrievedAt
                        ) {
                          return formatDate(
                            item.fulfilmentState.certificateRetrievedAt
                          );
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
                    </td>
                    <td>
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
                    </td>
                    <td className="jobs-integrity-summary">
                      {item.integrityAnomalyCount > 0 ? (
                        <>
                          <span className="jobs-integrity-text">
                            {item.integrityAnomalies[0]}
                          </span>
                          {item.integrityAnomalyCount > 1 && (
                            <span className="jobs-integrity-more">
                              {" "}
                              +{item.integrityAnomalyCount - 1} more
                            </span>
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
