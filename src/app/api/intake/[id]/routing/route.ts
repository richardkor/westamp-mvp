/**
 * POST /api/intake/[id]/routing
 *
 * Persists a suggestion-level STSDS routing recommendation on a stamping job.
 *
 * This does NOT submit anything to the live portal.
 * This does NOT advance the job status.
 * It only stores unverified routing metadata.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { StsdsRoutingSuggestion, PortalLane } from "../../../../../lib/stsds-types";

const VALID_LANES: PortalLane[] = ["sewa_pajakan", "penyeteman_am"];
const VALID_SOURCES: StsdsRoutingSuggestion["source"][] = [
  "category_match",
  "catalogue_search",
];
const VALID_CONFIDENCES: StsdsRoutingSuggestion["confidence"][] = [
  "high",
  "medium",
  "low",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const suggestedLane = body.suggestedLane as string;
  if (!VALID_LANES.includes(suggestedLane as PortalLane)) {
    return Response.json(
      { error: "suggestedLane must be 'sewa_pajakan' or 'penyeteman_am'." },
      { status: 400 }
    );
  }

  const source = body.source as string;
  if (!VALID_SOURCES.includes(source as StsdsRoutingSuggestion["source"])) {
    return Response.json(
      { error: "source must be 'category_match' or 'catalogue_search'." },
      { status: 400 }
    );
  }

  const confidence = body.confidence as string;
  if (
    !VALID_CONFIDENCES.includes(
      confidence as StsdsRoutingSuggestion["confidence"]
    )
  ) {
    return Response.json(
      { error: "confidence must be 'high', 'medium', or 'low'." },
      { status: 400 }
    );
  }

  const suggestedPortalDocumentName =
    typeof body.suggestedPortalDocumentName === "string"
      ? body.suggestedPortalDocumentName.trim()
      : null;

  const expectedDerivedDocumentGroup =
    typeof body.expectedDerivedDocumentGroup === "string"
      ? body.expectedDerivedDocumentGroup.trim()
      : null;

  const observedEditableInstrumentCategory =
    typeof body.observedEditableInstrumentCategory === "string"
      ? body.observedEditableInstrumentCategory.trim()
      : null;

  const routingSuggestion: StsdsRoutingSuggestion = {
    suggestedLane: suggestedLane as PortalLane,
    suggestedPortalDocumentName,
    expectedDerivedDocumentGroup,
    observedEditableInstrumentCategory,
    source: source as StsdsRoutingSuggestion["source"],
    confidence: confidence as StsdsRoutingSuggestion["confidence"],
    suggestedAt: new Date().toISOString(),
  };

  const laneLabel =
    suggestedLane === "sewa_pajakan" ? "Sewa/Pajakan" : "Penyeteman Am";
  const docNote = suggestedPortalDocumentName
    ? ` — ${suggestedPortalDocumentName}`
    : "";
  const event = createEvent(
    "routing_suggestion_saved",
    `Portal routing suggestion saved: ${laneLabel}${docNote}`
  );

  const updated = await updateJobOrConflict(id, {
    routingSuggestion,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
