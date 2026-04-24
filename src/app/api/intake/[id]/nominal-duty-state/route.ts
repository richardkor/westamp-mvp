/**
 * POST /api/intake/[id]/nominal-duty-state
 *
 * Operator-only update path for the internal nominal-duty lifecycle
 * state on a stamping job. Gated by `src/middleware.ts` under the
 * `/api/intake/:path*` matcher, so it is reachable only with a valid
 * `operator_session` cookie.
 *
 * Accepts a target `state` and an optional short `note`. Persists the
 * triple `nominalDutyState` / `nominalDutyStateUpdatedAt` /
 * `nominalDutyStateNote`, and appends a typed
 * `nominal_duty_state_changed` entry to the job's event history so
 * the full audit log is preserved.
 *
 * Does NOT
 * ────────
 * - submit anything to e-Duti Setem
 * - change the main `StampingJobStatus` enum value
 * - change the public receipt status (`derivePublicStatus` does not
 *   read this field)
 * - advance any tenancy-lane preparation logic
 *
 * Eligibility
 * ───────────
 * - Job must exist (404 if not).
 * - `documentCategory` must be a member of the nominal-duty registry
 *   (400 otherwise) — tenancy and unregistered categories have their
 *   own handling paths and must not use this field.
 * - `state` must be a member of the `NominalDutyState` union
 *   (400 otherwise).
 * - `note`, if supplied, must be a string no longer than
 *   `NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH`.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { appendEvent, createEvent } from "../../../../../lib/stamping-workflow";
import { isNominalDutyCategory } from "../../../../../lib/nominal-duty-registry";
import {
  isValidNominalDutyState,
  formatNominalDutyTransitionNote,
  NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH,
  NominalDutyState,
} from "../../../../../lib/nominal-duty-lifecycle";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  if (!isNominalDutyCategory(job.documentCategory)) {
    return Response.json(
      {
        error:
          "This job is not a nominal-duty registry category. The internal nominal-duty lifecycle does not apply here.",
      },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = body as { state?: unknown; note?: unknown };

  if (!isValidNominalDutyState(parsed.state)) {
    return Response.json(
      { error: "Invalid nominal-duty state." },
      { status: 400 }
    );
  }
  const state: NominalDutyState = parsed.state;

  let note: string | undefined;
  if (parsed.note !== undefined && parsed.note !== null) {
    if (typeof parsed.note !== "string") {
      return Response.json(
        { error: "Note must be a string." },
        { status: 400 }
      );
    }
    const trimmed = parsed.note.trim();
    if (trimmed.length > NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH) {
      return Response.json(
        {
          error: `Note exceeds the ${NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH}-character limit.`,
        },
        { status: 400 }
      );
    }
    note = trimmed.length > 0 ? trimmed : undefined;
  }

  const transitionEvent = createEvent(
    "nominal_duty_state_changed",
    formatNominalDutyTransitionNote(job.nominalDutyState, state, note)
  );

  const updates = {
    nominalDutyState: state,
    nominalDutyStateUpdatedAt: transitionEvent.timestamp,
    // Store the latest note only. Undefined means "no note for this
    // transition" — keep the previous value out of the way by
    // explicitly writing undefined so the shape stays predictable.
    nominalDutyStateNote: note,
    events: appendEvent(job.events, transitionEvent),
  };

  const result = await updateJobOrConflict(id, updates);
  if (result instanceof Response) return result;

  return Response.json({
    id: result.id,
    nominalDutyState: result.nominalDutyState,
    nominalDutyStateUpdatedAt: result.nominalDutyStateUpdatedAt,
    nominalDutyStateNote: result.nominalDutyStateNote,
  });
}
