/**
 * POST /api/intake/[id]/portal-draft
 *
 * Creates or updates the internal STSDS portal draft for a stamping job.
 *
 * Two modes:
 * 1. No body / empty body: auto-build draft from existing job data
 *    (routing suggestion, stamping details, extraction results).
 * 2. Body with user-edited fields: merge user edits into the draft
 *    and re-validate for readiness.
 *
 * This does NOT submit anything to the live e-Duti Setem portal.
 * This does NOT advance the job status.
 * It stores a draft-only object representing "what WeStamp intends to
 * put into the portal."
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { buildPortalDraft, validatePortalDraft } from "../../../../../lib/stsds-portal-draft";

/**
 * Shape of optional user-edited fields accepted in the request body.
 */
interface PortalDraftEditBody {
  stampOffice?: string;
  instrumentDate?: string;
  receivedInMalaysiaDate?: string | null;
  editableInstrumentCategory?: string | null;
}

function isEditBody(body: unknown): body is PortalDraftEditBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  // At least one editable field must be present
  return (
    "stampOffice" in b ||
    "instrumentDate" in b ||
    "receivedInMalaysiaDate" in b ||
    "editableInstrumentCategory" in b
  );
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

  if (!job.routingSuggestion) {
    return Response.json(
      {
        error:
          "No routing suggestion available. A routing suggestion must be saved before creating a portal draft.",
      },
      { status: 400 }
    );
  }

  // Parse optional body for user edits
  let editFields: PortalDraftEditBody | null = null;
  try {
    const rawBody = await request.text();
    if (rawBody.trim()) {
      const parsed = JSON.parse(rawBody);
      if (isEditBody(parsed)) {
        editFields = parsed;
      }
    }
  } catch {
    // Empty or invalid body — proceed with auto-build
  }

  // Build the base draft (always rebuild from job data as foundation)
  const baseDraft = buildPortalDraft(job);
  if (!baseDraft) {
    return Response.json(
      { error: "Unable to build portal draft from current job data." },
      { status: 400 }
    );
  }

  // Merge user edits into the draft if provided
  if (editFields) {
    if (baseDraft.lane === "sewa_pajakan" && baseDraft.maklumatAmSewaPajakan) {
      if (editFields.stampOffice !== undefined) {
        baseDraft.maklumatAmSewaPajakan.stampOffice = editFields.stampOffice || undefined;
      }
      if (editFields.instrumentDate !== undefined) {
        baseDraft.maklumatAmSewaPajakan.instrumentDate = editFields.instrumentDate || undefined;
      }
      if (editFields.receivedInMalaysiaDate !== undefined) {
        baseDraft.maklumatAmSewaPajakan.receivedInMalaysiaDate =
          editFields.receivedInMalaysiaDate || null;
      }
    } else if (
      baseDraft.lane === "penyeteman_am" &&
      baseDraft.maklumatAmPenyetemanAm
    ) {
      if (editFields.stampOffice !== undefined) {
        baseDraft.maklumatAmPenyetemanAm.stampOffice = editFields.stampOffice || undefined;
      }
      if (editFields.instrumentDate !== undefined) {
        baseDraft.maklumatAmPenyetemanAm.instrumentDate = editFields.instrumentDate || undefined;
      }
      if (editFields.receivedInMalaysiaDate !== undefined) {
        baseDraft.maklumatAmPenyetemanAm.receivedInMalaysiaDate =
          editFields.receivedInMalaysiaDate || null;
      }
      if (editFields.editableInstrumentCategory !== undefined) {
        baseDraft.maklumatAmPenyetemanAm.editableInstrumentCategory =
          editFields.editableInstrumentCategory ?? null;
      }
    }

    baseDraft.source = "manual_entry";
  }

  // Preserve user-edited fields from existing draft if no new edits provided
  if (!editFields && job.portalDraft) {
    const existing = job.portalDraft;
    if (
      baseDraft.lane === "sewa_pajakan" &&
      baseDraft.maklumatAmSewaPajakan &&
      existing.maklumatAmSewaPajakan
    ) {
      baseDraft.maklumatAmSewaPajakan.stampOffice =
        baseDraft.maklumatAmSewaPajakan.stampOffice ??
        existing.maklumatAmSewaPajakan.stampOffice;
      baseDraft.maklumatAmSewaPajakan.instrumentDate =
        baseDraft.maklumatAmSewaPajakan.instrumentDate ??
        existing.maklumatAmSewaPajakan.instrumentDate;
      baseDraft.maklumatAmSewaPajakan.receivedInMalaysiaDate =
        baseDraft.maklumatAmSewaPajakan.receivedInMalaysiaDate ??
        existing.maklumatAmSewaPajakan.receivedInMalaysiaDate;
    } else if (
      baseDraft.lane === "penyeteman_am" &&
      baseDraft.maklumatAmPenyetemanAm &&
      existing.maklumatAmPenyetemanAm
    ) {
      baseDraft.maklumatAmPenyetemanAm.stampOffice =
        baseDraft.maklumatAmPenyetemanAm.stampOffice ??
        existing.maklumatAmPenyetemanAm.stampOffice;
      baseDraft.maklumatAmPenyetemanAm.instrumentDate =
        baseDraft.maklumatAmPenyetemanAm.instrumentDate ??
        existing.maklumatAmPenyetemanAm.instrumentDate;
      baseDraft.maklumatAmPenyetemanAm.receivedInMalaysiaDate =
        baseDraft.maklumatAmPenyetemanAm.receivedInMalaysiaDate ??
        existing.maklumatAmPenyetemanAm.receivedInMalaysiaDate;
      baseDraft.maklumatAmPenyetemanAm.editableInstrumentCategory =
        baseDraft.maklumatAmPenyetemanAm.editableInstrumentCategory ??
        existing.maklumatAmPenyetemanAm.editableInstrumentCategory;
    }
  }

  // Validate and set status based on completeness
  const validation = validatePortalDraft(baseDraft);
  const wasReadyBefore = job.portalDraft?.status === "ready_for_review";
  baseDraft.status = validation.isComplete ? "ready_for_review" : "draft";

  const isUpdate = !!job.portalDraft;
  const events = [...(job.events ?? [])];

  // Standard create/update event
  const eventType = isUpdate ? "portal_draft_updated" : "portal_draft_created";
  const eventNote = isUpdate
    ? `Portal draft updated for ${baseDraft.lane} lane`
    : `Portal draft created for ${baseDraft.lane} lane`;
  events.push(createEvent(eventType, eventNote));

  // If draft just became ready_for_review, log that too
  if (validation.isComplete && !wasReadyBefore) {
    events.push(
      createEvent(
        "portal_draft_marked_ready_for_review",
        `Portal draft marked ready for review (${baseDraft.lane} lane)`
      )
    );
  }

  const updated = await updateJobOrConflict(id, {
    portalDraft: baseDraft,
    events,
  });

  if (updated instanceof Response) return updated;

  return Response.json({
    ...updated,
    _validation: validation,
  });
}
