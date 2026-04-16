/**
 * POST /api/intake/[id]/certificate-upload
 *
 * Accepts a certificate PDF file upload and attaches it to the job.
 * Stores the file locally and updates the job's fulfilmentState to
 * certificate_retrieved with the file metadata.
 *
 * This is a manual operator action. WeStamp does NOT retrieve
 * certificates automatically from any external system.
 *
 * Request: multipart/form-data
 *   file — PDF file (required)
 *
 * Response: updated StampingJob
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { blobStore } from "../../../../../lib/storage";
import type {
  StampingFulfilmentState,
  CertificateStatus,
} from "../../../../../lib/stamping-types";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // ── Parse multipart form ────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return Response.json(
      { error: "Only PDF files are accepted." },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return Response.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json(
      { error: "File exceeds the 20 MB limit." },
      { status: 400 }
    );
  }

  // ── Transition guard ─────────────────────────────────────────────────
  // Certificate upload requires payment to have been marked done first.
  const currentPaymentStatus = job.fulfilmentState?.paymentStatus;
  if (currentPaymentStatus !== "payment_marked_done") {
    return Response.json(
      { error: "Cannot upload certificate until payment has been marked done." },
      { status: 409 }
    );
  }

  // ── Store file ──────────────────────────────────────────────────────
  const storedFileName = `${id}-cert.pdf`;
  const storageKey = `uploads/certificates/${storedFileName}`;

  try {
    const bytes = await file.arrayBuffer();
    await blobStore.saveBlob(storageKey, Buffer.from(bytes));
  } catch (err) {
    console.error("Certificate file write failed:", err);
    return Response.json(
      { error: "Failed to store certificate file." },
      { status: 500 }
    );
  }

  // ── Update fulfilment state ─────────────────────────────────────────
  const now = new Date().toISOString();
  const existing: StampingFulfilmentState = job.fulfilmentState ?? {
    adjudicationNumber: null,
    paymentStatus: "not_ready",
    paymentMethod: null,
    paymentMarkedAt: null,
    paymentNote: null,
    paymentReference: null,
    certificateStatus: "not_ready",
    certificateRetrievedAt: null,
    certificateFileName: null,
    certificateStoragePath: null,
    delivered: false,
    deliveredAt: null,
    lastFulfilmentUpdateAt: now,
  };

  existing.certificateStatus = "certificate_retrieved" as CertificateStatus;
  existing.certificateRetrievedAt = now;
  existing.certificateFileName = file.name;
  existing.certificateStoragePath = `uploads/certificates/${storedFileName}`;
  existing.lastFulfilmentUpdateAt = now;

  const event = createEvent(
    "certificate_marked_retrieved" as Parameters<typeof createEvent>[0],
    `Certificate file uploaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB). Stored as ${storedFileName}.`
  );

  const updated = await updateJobOrConflict(id, {
    fulfilmentState: existing,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
