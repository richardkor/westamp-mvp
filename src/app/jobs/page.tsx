/**
 * /jobs — Stamping Jobs Operator Inbox
 *
 * Server Component that loads all stamping jobs from the store and
 * passes a serialised, lightweight shape to the client-side queue UI
 * for filtering, sorting, and searching.
 *
 * Gated behind operator middleware (see `src/middleware.ts`) — not
 * publicly reachable. This page is the operator's primary inbox:
 * find new uploads, open jobs that need action, track fulfilment
 * across the three pilot lanes (tenancy, employment contract,
 * statutory declaration). It is not a dashboard, not analytics, not
 * a management report.
 */

import { listJobs } from "../../lib/stamping-store";
import {
  DOCUMENT_CATEGORY_LABELS,
  STAMPING_JOB_STATUS_LABELS,
} from "../../lib/stamping-types";
import type { StampingJob } from "../../lib/stamping-types";
import { evaluateFulfilmentIntegrity } from "../../lib/fulfilment-integrity";
import { JobsQueueClient } from "./jobs-queue-client";
import type { NominalDutyState } from "../../lib/nominal-duty-lifecycle";

/**
 * Force dynamic rendering on every request.
 *
 * Without this, Next.js 15 statically prerenders this Server Component
 * at build time because `listJobs()` is a plain async call (not a
 * `fetch`), and the framework cannot infer that the underlying data
 * changes per-request. The build-time call captures an empty (or
 * stale) job list into the static HTML, and that snapshot is then
 * served on every subsequent request — so newly uploaded jobs never
 * appear in the hosted operator inbox.
 *
 * `force-dynamic` opts the page out of the static cache so each
 * request re-executes the component and re-queries the live job
 * store. Cookie-based operator gating runs in middleware, which is
 * orthogonal to this directive.
 */
export const dynamic = "force-dynamic";

/**
 * Lightweight shape passed to the client — avoids serialising the full
 * StampingJob across the server/client boundary. Only fields the
 * queue UI needs are included.
 */
export interface JobListItem {
  id: string;
  originalFileName: string;
  documentCategory: string;
  categoryLabel: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  fulfilmentState: {
    adjudicationNumber: string | null;
    paymentStatus: string;
    certificateStatus: string;
    lastFulfilmentUpdateAt: string;
    paymentMarkedAt: string | null;
    certificateRetrievedAt: string | null;
    certificateStoragePath: string | null;
    delivered: boolean;
  } | null;
  /**
   * Internal nominal-duty lifecycle state for registry categories
   * (Employment Contract, Statutory Declaration). Null for tenancy,
   * for "Other / Not Sure", and for nominal-duty jobs the operator
   * has not yet touched (the backend default is `received`, but the
   * persisted field is only set after an explicit operator write).
   */
  nominalDutyState: NominalDutyState | null;
  /** ISO timestamp of the most recent nominal-duty state write. */
  nominalDutyStateUpdatedAt: string | null;
  /** Number of fulfilment integrity anomalies detected (0 = healthy). */
  integrityAnomalyCount: number;
  /** Anomaly messages derived from fulfilment integrity evaluation. */
  integrityAnomalies: string[];
  /**
   * Soft-archive marker. ISO timestamp when the job was archived, or
   * null for active jobs. Presence of this value is the sole source
   * of truth for "archived" — the underlying record and uploaded
   * source PDF are preserved unchanged.
   */
  archivedAt: string | null;
  /**
   * Optional short operator note recorded at archive time. Null on
   * active jobs and on archived jobs that were archived without a
   * reason.
   */
  archivedReason: string | null;
}

function toListItem(job: StampingJob): JobListItem {
  const integrity = evaluateFulfilmentIntegrity(
    job.fulfilmentState
      ? {
          paymentStatus: job.fulfilmentState.paymentStatus,
          certificateStatus: job.fulfilmentState.certificateStatus,
          adjudicationNumber: job.fulfilmentState.adjudicationNumber,
          certificateStoragePath: job.fulfilmentState.certificateStoragePath,
        }
      : null
  );
  return {
    id: job.id,
    originalFileName: job.originalFileName,
    documentCategory: job.documentCategory,
    categoryLabel:
      DOCUMENT_CATEGORY_LABELS[job.documentCategory] ?? job.documentCategory,
    status: job.status,
    statusLabel: STAMPING_JOB_STATUS_LABELS[job.status] ?? job.status,
    createdAt: job.createdAt,
    fulfilmentState: job.fulfilmentState
      ? {
          adjudicationNumber: job.fulfilmentState.adjudicationNumber,
          paymentStatus: job.fulfilmentState.paymentStatus,
          certificateStatus: job.fulfilmentState.certificateStatus,
          lastFulfilmentUpdateAt: job.fulfilmentState.lastFulfilmentUpdateAt,
          paymentMarkedAt: job.fulfilmentState.paymentMarkedAt,
          certificateRetrievedAt: job.fulfilmentState.certificateRetrievedAt,
          certificateStoragePath: job.fulfilmentState.certificateStoragePath,
          delivered: job.fulfilmentState.delivered ?? false,
        }
      : null,
    nominalDutyState: job.nominalDutyState ?? null,
    nominalDutyStateUpdatedAt: job.nominalDutyStateUpdatedAt ?? null,
    integrityAnomalyCount: integrity.anomalies.length,
    integrityAnomalies: integrity.anomalies,
    archivedAt: job.archivedAt ?? null,
    archivedReason: job.archivedReason ?? null,
  };
}

export default async function JobsPage() {
  const jobs = await listJobs();
  const items: JobListItem[] = jobs.map(toListItem);

  return (
    <main>
      <a href="/" className="back-link">
        &larr; Home
      </a>
      <h1>Stamping Jobs</h1>
      <p className="jobs-intro">
        Operator inbox. Find new uploads, open jobs that need action,
        and track fulfilment across the pilot lanes. Internal view only.
      </p>
      <JobsQueueClient items={items} />
    </main>
  );
}
