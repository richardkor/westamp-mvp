/**
 * /api/intake/[id]
 *
 * GET  — Returns a single stamping intake record by ID.
 * PATCH — Saves stamping details for a tenancy-agreement record.
 *         Validates inputs, calculates duty via existing calculator,
 *         stores the result, and advances status to "intake_reviewed".
 *
 * Only tenancy-agreement records can have stamping details saved.
 * Other categories return 400 on PATCH.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../lib/stamping-store";
import { StampingDetails, FieldProvenance, FieldSource } from "../../../../lib/stamping-types";
import { calculateTenancyDuty } from "../../../../lib/duty-calculator";
import { createEvent, appendEvent } from "../../../../lib/stamping-workflow";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  return Response.json(job);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Only tenancy agreements are supported for stamping details
  if (job.documentCategory !== "tenancy_agreement") {
    return Response.json(
      { error: "Stamping details are only supported for tenancy agreements." },
      { status: 400 }
    );
  }

  // Only allow details to be saved when status is "uploaded"
  if (job.status !== "uploaded") {
    return Response.json(
      { error: "Stamping details have already been saved for this record." },
      { status: 400 }
    );
  }

  // ── Parse and validate inputs ────────────────────────────────────

  let body: {
    monthlyRent?: unknown;
    leaseMonths?: unknown;
    duplicateCopies?: unknown;
    structureFlags?: unknown;
    fieldProvenance?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const monthlyRent = Number(body.monthlyRent);
  const leaseMonths = Number(body.leaseMonths);
  const duplicateCopies = Number(body.duplicateCopies);

  // Parse optional structure flags (all boolean, default false)
  const rawFlags = (typeof body.structureFlags === "object" && body.structureFlags !== null)
    ? body.structureFlags as Record<string, unknown>
    : {};
  const structureFlags = {
    hasPremiumOrFine: rawFlags.hasPremiumOrFine === true,
    hasVariableRent: rawFlags.hasVariableRent === true,
    isMixedUse: rawFlags.isMixedUse === true,
    isPeriodicOrIndefinite: rawFlags.isPeriodicOrIndefinite === true,
    hasBundledCharges: rawFlags.hasBundledCharges === true,
    hasUnusualConsideration: rawFlags.hasUnusualConsideration === true,
  };

  // Parse optional field provenance (only when extraction results exist)
  const VALID_FIELD_SOURCES: FieldSource[] = [
    "user_entered",
    "extracted_applied",
    "extracted_applied_then_edited",
  ];
  let fieldProvenance: FieldProvenance | undefined;
  if (typeof body.fieldProvenance === "object" && body.fieldProvenance !== null) {
    const rawProv = body.fieldProvenance as Record<string, unknown>;
    const rentSource = VALID_FIELD_SOURCES.includes(rawProv.monthlyRent as FieldSource)
      ? (rawProv.monthlyRent as FieldSource)
      : "user_entered";
    const leaseSource = VALID_FIELD_SOURCES.includes(rawProv.leaseMonths as FieldSource)
      ? (rawProv.leaseMonths as FieldSource)
      : "user_entered";
    fieldProvenance = { monthlyRent: rentSource, leaseMonths: leaseSource };
  }

  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return Response.json(
      { error: "Monthly rent must be a positive number." },
      { status: 400 }
    );
  }

  if (
    !Number.isInteger(leaseMonths) ||
    leaseMonths <= 0
  ) {
    return Response.json(
      { error: "Lease duration must be a positive whole number of months." },
      { status: 400 }
    );
  }

  if (
    !Number.isInteger(duplicateCopies) ||
    duplicateCopies < 0
  ) {
    return Response.json(
      { error: "Duplicate copies must be 0 or a positive whole number." },
      { status: 400 }
    );
  }

  // ── Calculate duty using existing calculator ─────────────────────

  const result = calculateTenancyDuty({
    monthlyRent,
    leaseMonths,
    duplicateCopies,
    ...structureFlags,
  });

  if (result.status === "error") {
    return Response.json(
      { error: `Duty calculation error: ${result.reason}` },
      { status: 400 }
    );
  }

  // Check if any structure flags are set (regardless of calculator result)
  const hasAnyFlag = Object.values(structureFlags).some(Boolean);

  // ── Determine if extraction suggestions were applied ─────────────────
  // True when any field provenance indicates values came from extraction.
  const extractionWasApplied =
    fieldProvenance?.monthlyRent === "extracted_applied" ||
    fieldProvenance?.monthlyRent === "extracted_applied_then_edited" ||
    fieldProvenance?.leaseMonths === "extracted_applied" ||
    fieldProvenance?.leaseMonths === "extracted_applied_then_edited";

  // ── Manual review: persist details but route to manual_review_required ──

  if (result.status === "manual_review") {
    const stampingDetails: StampingDetails = {
      monthlyRent,
      leaseMonths,
      duplicateCopies,
      calculatedDuty: {
        baseDuty: 0,
        duplicateCopyTotal: 0,
        totalDuty: 0,
        rateTierLabel: "N/A — manual review required",
      },
      structureFlags: hasAnyFlag ? structureFlags : undefined,
      manualReviewReason: result.reason,
      fieldProvenance,
    };

    // Log extraction application event before the status-change event
    const reviewEvent = createEvent("moved_to_manual_review", result.reason);

    let events = job.events;
    if (extractionWasApplied) {
      events = appendEvent(events, createEvent(
        "extraction_suggestions_applied",
        `Extraction suggestions applied: rent=${fieldProvenance!.monthlyRent}, lease=${fieldProvenance!.leaseMonths}`
      ));
    }
    events = appendEvent(events, reviewEvent);

    const updated = await updateJobOrConflict(id, {
      stampingDetails,
      status: "manual_review_required",
      notes: result.reason,
      events,
    });

    if (updated instanceof Response) return updated;

    return Response.json(updated);
  }

  // ── Standard path: save stamping details and advance to intake_reviewed ──

  const stampingDetails: StampingDetails = {
    monthlyRent,
    leaseMonths,
    duplicateCopies,
    calculatedDuty: {
      baseDuty: result.baseDuty,
      duplicateCopyTotal: result.duplicateCopyTotal,
      totalDuty: result.totalDuty,
      rateTierLabel: result.rateTierLabel,
    },
    structureFlags: hasAnyFlag ? structureFlags : undefined,
    fieldProvenance,
  };

  const savedEvent = createEvent(
    "stamping_details_saved",
    `Stamping details saved. Duty: RM ${result.totalDuty.toFixed(2)}`
  );

  let events = job.events;
  if (extractionWasApplied) {
    events = appendEvent(events, createEvent(
      "extraction_suggestions_applied",
      `Extraction suggestions applied: rent=${fieldProvenance!.monthlyRent}, lease=${fieldProvenance!.leaseMonths}`
    ));
  }
  events = appendEvent(events, savedEvent);

  const updated = await updateJobOrConflict(id, {
    stampingDetails,
    status: "intake_reviewed",
    events,
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
