/**
 * POST /api/intake/[id]/preparation-inputs
 *
 * Updates the internal preparation markers for proven portal submit
 * gates, then re-evaluates submission readiness.
 *
 * These markers represent WeStamp's internal preparation state —
 * NOT live portal completion. Does NOT touch any external system.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { evaluateSubmissionReadiness } from "../../../../../lib/stsds-submission-readiness";

interface PreparationInputsBody {
  declarationPrepared?: boolean;
  bahagianAFirstPartyPrepared?: boolean;
  bahagianASecondPartyPrepared?: boolean;
}

function isValidBody(body: unknown): body is PreparationInputsBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if ("declarationPrepared" in b && typeof b.declarationPrepared !== "boolean") return false;
  if ("bahagianAFirstPartyPrepared" in b && typeof b.bahagianAFirstPartyPrepared !== "boolean") return false;
  if ("bahagianASecondPartyPrepared" in b && typeof b.bahagianASecondPartyPrepared !== "boolean") return false;
  return true;
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
      { error: "No routing suggestion available." },
      { status: 400 }
    );
  }

  let body: PreparationInputsBody = {};
  try {
    const raw = await request.json();
    if (isValidBody(raw)) {
      body = raw;
    }
  } catch {
    // Empty body is acceptable — just re-evaluate with current state
  }

  const now = new Date().toISOString();
  const existing = job.preparationInputs;

  const updated = {
    declarationPrepared: body.declarationPrepared ?? existing?.declarationPrepared ?? false,
    bahagianAFirstPartyPrepared: body.bahagianAFirstPartyPrepared ?? existing?.bahagianAFirstPartyPrepared ?? false,
    bahagianASecondPartyPrepared: body.bahagianASecondPartyPrepared ?? existing?.bahagianASecondPartyPrepared ?? false,
    updatedAt: now,
  };

  // Build a temporary job with the new inputs to evaluate readiness
  const jobWithInputs = { ...job, preparationInputs: updated };
  const readiness = evaluateSubmissionReadiness(jobWithInputs);

  const event = createEvent(
    "preparation_inputs_updated",
    `Preparation inputs updated: declaration=${updated.declarationPrepared}, ` +
    `partyA=${updated.bahagianAFirstPartyPrepared}, partyB=${updated.bahagianASecondPartyPrepared}. ` +
    `Readiness: ${readiness?.status ?? "unknown"}.`
  );

  const result = await updateJobOrConflict(id, {
    preparationInputs: updated,
    submissionReadiness: readiness ?? undefined,
    events: appendEvent(job.events, event),
  });

  if (result instanceof Response) return result;

  return Response.json(result);
}
