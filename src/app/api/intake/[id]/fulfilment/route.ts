/**
 * POST /api/intake/[id]/fulfilment
 *
 * Updates the internal stamping fulfilment state (adjudication number,
 * payment status, certificate status).
 *
 * This is internal operational tracking only. It does NOT make payments,
 * retrieve certificates, or interact with any external system.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  StampingFulfilmentState,
  PaymentStatus,
  CertificateStatus,
} from "../../../../../lib/stamping-types";

interface FulfilmentUpdateBody {
  action:
    | "record_adjudication"
    | "mark_awaiting_payment"
    | "mark_payment_done"
    | "mark_waiting_certificate"
    | "mark_delivered";
  adjudicationNumber?: string;
  paymentMethod?: string;
  paymentNote?: string;
  paymentReference?: string;
}

function isValidBody(body: unknown): body is FulfilmentUpdateBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const validActions = [
    "record_adjudication",
    "mark_awaiting_payment",
    "mark_payment_done",
    "mark_waiting_certificate",
    "mark_delivered",
  ];
  return typeof b.action === "string" && validActions.includes(b.action);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  let body: FulfilmentUpdateBody;
  try {
    const raw = await request.json();
    if (!isValidBody(raw)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = raw;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

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

  let eventType: string;
  let eventNote: string;

  // ── Transition guards ────────────────────────────────────────────
  // These enforce truthful lifecycle progression at the backend level.
  // The UI should also hide invalid actions, but backend rules are
  // the authoritative guard.

  switch (body.action) {
    case "record_adjudication": {
      const adjNum = body.adjudicationNumber?.trim();
      if (!adjNum) {
        return Response.json(
          { error: "Adjudication number is required." },
          { status: 400 }
        );
      }
      // Guard: cannot re-record if payment already marked done
      if (existing.paymentStatus === "payment_marked_done") {
        return Response.json(
          { error: "Cannot change adjudication number after payment has been marked done." },
          { status: 409 }
        );
      }
      existing.adjudicationNumber = adjNum;
      existing.paymentStatus = "awaiting_payment" as PaymentStatus;
      eventType = "adjudication_number_recorded";
      eventNote = `Adjudication number recorded: ${adjNum}. Status: awaiting payment.`;
      break;
    }

    case "mark_awaiting_payment": {
      // Guard: adjudication number must exist
      if (!existing.adjudicationNumber) {
        return Response.json(
          { error: "Cannot mark awaiting payment without an adjudication number." },
          { status: 409 }
        );
      }
      existing.paymentStatus = "awaiting_payment" as PaymentStatus;
      eventType = "payment_marked_awaiting";
      eventNote = "Payment status set to awaiting payment.";
      break;
    }

    case "mark_payment_done": {
      // Guard: must be in awaiting_payment state
      if (existing.paymentStatus !== "awaiting_payment") {
        return Response.json(
          { error: "Cannot mark payment done unless payment is currently awaiting." },
          { status: 409 }
        );
      }
      existing.paymentStatus = "payment_marked_done" as PaymentStatus;
      existing.paymentMarkedAt = now;
      existing.paymentMethod = body.paymentMethod?.trim() || null;
      existing.paymentNote = body.paymentNote?.trim() || null;
      existing.paymentReference = body.paymentReference?.trim() || null;
      existing.certificateStatus = "waiting_for_certificate" as CertificateStatus;
      eventType = "payment_marked_done";
      eventNote = `Payment marked done${existing.paymentMethod ? ` (${existing.paymentMethod})` : ""}. Certificate status: waiting.`;
      break;
    }

    case "mark_waiting_certificate": {
      // Guard: payment must already be done
      if (existing.paymentStatus !== "payment_marked_done") {
        return Response.json(
          { error: "Cannot set certificate to waiting unless payment has been marked done." },
          { status: 409 }
        );
      }
      existing.certificateStatus = "waiting_for_certificate" as CertificateStatus;
      eventType = "certificate_marked_waiting";
      eventNote = "Certificate status set to waiting for certificate.";
      break;
    }

    // NOTE: mark_certificate_retrieved has been removed.
    // The only path to certificate_retrieved is via certificate-upload,
    // which requires an actual PDF file. This ensures certificate_retrieved
    // is never a hollow state without an attached file.

    case "mark_delivered": {
      // Guard: certificate must be retrieved with an actual file attached
      if (
        existing.certificateStatus !== "certificate_retrieved" ||
        !existing.certificateStoragePath
      ) {
        return Response.json(
          { error: "Cannot mark delivered unless a certificate file has been uploaded and stored." },
          { status: 409 }
        );
      }
      // Guard: cannot deliver twice
      if (existing.delivered) {
        return Response.json(
          { error: "This job has already been marked as delivered." },
          { status: 409 }
        );
      }
      existing.delivered = true;
      existing.deliveredAt = now;
      eventType = "delivered";
      eventNote = "Job internally marked as delivered.";
      break;
    }

    default:
      return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  existing.lastFulfilmentUpdateAt = now;

  const event = createEvent(eventType as Parameters<typeof createEvent>[0], eventNote);

  const updated = await updateJobOrConflict(id, {
    fulfilmentState: existing,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
