/**
 * /jobs — Stamping Jobs Queue
 *
 * Server Component that loads all stamping jobs from the store
 * and passes them to the client-side queue UI for filtering.
 *
 * This is a minimal internal operational queue — not a dashboard.
 * It lets an operator quickly identify jobs by fulfilment status:
 * awaiting payment, waiting for certificate, or certificate retrieved.
 */

import { listJobs } from "../../lib/stamping-store";
import { DOCUMENT_CATEGORY_LABELS, STAMPING_JOB_STATUS_LABELS } from "../../lib/stamping-types";
import type { StampingJob } from "../../lib/stamping-types";
import { evaluateFulfilmentIntegrity } from "../../lib/fulfilment-integrity";
import { JobsQueueClient } from "./jobs-queue-client";

/** Lightweight shape passed to the client — avoids serialising the full StampingJob. */
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
  /** Number of fulfilment integrity anomalies detected (0 = healthy). */
  integrityAnomalyCount: number;
  /** Anomaly messages derived from fulfilment integrity evaluation. */
  integrityAnomalies: string[];
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
    categoryLabel: DOCUMENT_CATEGORY_LABELS[job.documentCategory] ?? job.documentCategory,
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
    integrityAnomalyCount: integrity.anomalies.length,
    integrityAnomalies: integrity.anomalies,
  };
}

export default async function JobsPage() {
  const jobs = await listJobs();
  const items: JobListItem[] = jobs.map(toListItem);

  return (
    <main>
      <a href="/upload" className="back-link">
        &larr; Upload Document
      </a>
      <h1>Stamping Jobs</h1>
      <p className="jobs-intro">
        Internal operational queue for stamping fulfilment tracking.
      </p>
      <JobsQueueClient items={items} />
    </main>
  );
}
