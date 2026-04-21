/**
 * POST /api/intake/[id]/confirm-tenancy
 *
 * Operator review endpoint for tenancy extraction results.
 *
 * Accepts operator-confirmed or corrected values for the three extracted
 * tenancy fields (monthly rent, lease months, agreement date) and persists
 * them on the job as `confirmedTenancyInputs` — a layer distinct from
 * extractionResult, stampingDetails, portalDraft, and submissionPayload.
 *
 * Records a `tenancy_inputs_confirmed` event.
 *
 * This endpoint performs NO live portal interaction, NO payment action,
 * and NO certificate retrieval. It is an internal persistence action only.
 *
 * Operator-gated by middleware (`/api/intake/:path*`).
 * Tenancy-agreement jobs only.
 *
 * Request JSON (all three fields optional; null = not confirmed):
 *   {
 *     confirmedMonthlyRent: number | null,
 *     confirmedLeaseMonths: number | null,
 *     confirmedAgreementDate: string | null   // YYYY-MM-DD
 *   }
 *
 * The review state is derived server-side by comparing each submitted
 * value against the corresponding extraction suggestion:
 *   - same value  → "extraction_confirmed"
 *   - different   → "operator_override"
 *   - no suggestion but value provided → "operator_entered"
 * Overall reviewStatus is "reviewed_confirmed" if every submitted value
 * matched its suggestion, otherwise "reviewed_overridden".
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  ConfirmedTenancyInputs,
  ConfirmedTenancyInputSource,
} from "../../../../../lib/stamping-types";

// ─── Request validation ──────────────────────────────────────────────

interface ConfirmTenancyRequestBody {
  confirmedMonthlyRent?: number | null;
  confirmedLeaseMonths?: number | null;
  confirmedAgreementDate?: string | null;
}

/** Accepts nullish or finite positive number within sensible bounds. */
function validateRent(v: unknown): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { ok: false, reason: "confirmedMonthlyRent must be a finite number or null." };
  }
  if (v <= 0 || v > 1_000_000) {
    return { ok: false, reason: "confirmedMonthlyRent must be > 0 and <= 1,000,000." };
  }
  return { ok: true, value: v };
}

function validateLeaseMonths(v: unknown): { ok: true; value: number | null } | { ok: false; reason: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { ok: false, reason: "confirmedLeaseMonths must be an integer or null." };
  }
  if (v <= 0 || v > 600) {
    return { ok: false, reason: "confirmedLeaseMonths must be > 0 and <= 600." };
  }
  return { ok: true, value: v };
}

function validateDate(v: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") {
    return { ok: false, reason: "confirmedAgreementDate must be a YYYY-MM-DD string or null." };
  }
  // Strict YYYY-MM-DD shape + calendar validity
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return { ok: false, reason: "confirmedAgreementDate must be in YYYY-MM-DD format." };
  }
  const [, yStr, moStr, dStr] = m;
  const y = parseInt(yStr, 10);
  const mo = parseInt(moStr, 10);
  const d = parseInt(dStr, 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return { ok: false, reason: "confirmedAgreementDate is not a valid calendar date." };
  }
  return { ok: true, value: v };
}

// ─── Provenance derivation ───────────────────────────────────────────

/**
 * Classify a single submitted value relative to the matching extraction
 * suggestion. Returns null when the operator did not supply a value
 * (no confirmation for that field).
 */
function deriveSource<T>(
  submitted: T | null,
  suggested: T | null | undefined,
): ConfirmedTenancyInputSource | null {
  if (submitted === null) return null;
  if (suggested === null || suggested === undefined) return "operator_entered";
  return submitted === suggested ? "extraction_confirmed" : "operator_override";
}

// ─── Route handler ──────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (job.documentCategory !== "tenancy_agreement") {
    return Response.json(
      { error: "Input review is only supported for tenancy-agreement documents." },
      { status: 400 },
    );
  }

  let body: ConfirmTenancyRequestBody;
  try {
    body = (await request.json()) as ConfirmTenancyRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Validate each field
  const rentCheck = validateRent(body.confirmedMonthlyRent);
  if (!rentCheck.ok) {
    return Response.json({ error: rentCheck.reason }, { status: 400 });
  }
  const leaseCheck = validateLeaseMonths(body.confirmedLeaseMonths);
  if (!leaseCheck.ok) {
    return Response.json({ error: leaseCheck.reason }, { status: 400 });
  }
  const dateCheck = validateDate(body.confirmedAgreementDate);
  if (!dateCheck.ok) {
    return Response.json({ error: dateCheck.reason }, { status: 400 });
  }

  const rent = rentCheck.value;
  const lease = leaseCheck.value;
  const date = dateCheck.value;

  // Require at least one confirmed value — reject a no-op submission so
  // the event log stays meaningful.
  if (rent === null && lease === null && date === null) {
    return Response.json(
      { error: "At least one field must be confirmed or overridden." },
      { status: 400 },
    );
  }

  // Derive per-field provenance against the current extraction suggestions.
  const suggested = {
    rent: job.extractionResult?.suggestedMonthlyRent?.value ?? null,
    lease: job.extractionResult?.suggestedLeaseMonths?.value ?? null,
    date: job.extractionResult?.suggestedAgreementDate?.value ?? null,
  };

  const rentSource = deriveSource(rent, suggested.rent);
  const leaseSource = deriveSource(lease, suggested.lease);
  const dateSource = deriveSource(date, suggested.date);

  // Overall review status: confirmed iff every submitted value was an
  // unchanged extraction confirmation; otherwise overridden.
  const sources = [rentSource, leaseSource, dateSource].filter(
    (s): s is ConfirmedTenancyInputSource => s !== null,
  );
  const hasAnyDeviation = sources.some(
    (s) => s === "operator_override" || s === "operator_entered",
  );
  const reviewStatus: ConfirmedTenancyInputs["reviewStatus"] = hasAnyDeviation
    ? "reviewed_overridden"
    : "reviewed_confirmed";

  const confirmedTenancyInputs: ConfirmedTenancyInputs = {
    confirmedAt: new Date().toISOString(),
    reviewStatus,
    confirmedMonthlyRent: rent,
    confirmedLeaseMonths: lease,
    confirmedAgreementDate: date,
    confirmedBySource: {
      monthlyRent: rentSource,
      leaseMonths: leaseSource,
      agreementDate: dateSource,
    },
  };

  // Compose the event note — surfaces what actually happened without
  // leaking the concrete values (they live in the persisted record).
  const parts: string[] = [];
  if (rentSource) parts.push(`rent:${rentSource}`);
  if (leaseSource) parts.push(`months:${leaseSource}`);
  if (dateSource) parts.push(`date:${dateSource}`);
  const note = `Tenancy inputs ${reviewStatus} (${parts.join(", ")}).`;

  const event = createEvent("tenancy_inputs_confirmed", note);

  const updated = await updateJobOrConflict(id, {
    confirmedTenancyInputs,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
