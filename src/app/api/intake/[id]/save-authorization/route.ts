/**
 * POST /api/intake/[id]/save-authorization
 *
 * Issues, evaluates, or revokes Maklumat Am save authorization.
 *
 * Actions (via ?action= query parameter):
 * - issue: Issue a new authorization (requires eligible preflight)
 * - revoke: Revoke an existing authorization
 * - evaluate: Re-evaluate the current authorization state
 *
 * Default action (no query param): evaluate.
 *
 * This route:
 * - Does NOT touch the live portal
 * - Does NOT perform any save action
 * - Records a workflow event
 * - Persists the authorization on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  evaluateMaklumatAmSaveAuthorization,
  issueMaklumatAmSaveAuthorization,
  revokeMaklumatAmSaveAuthorization,
} from "../../../../../lib/stsds-save-authorization";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Determine action from query parameter
  const action = request.nextUrl.searchParams.get("action") ?? "evaluate";

  if (!["issue", "revoke", "evaluate"].includes(action)) {
    return Response.json(
      { error: `Invalid action: "${action}". Use issue, revoke, or evaluate.` },
      { status: 400 }
    );
  }

  let authorization;
  let eventType: "save_authorization_issued" | "save_authorization_revoked" | "save_authorization_evaluated";
  let eventNote: string;

  switch (action) {
    case "issue": {
      if (!job.savePreflight) {
        return Response.json(
          {
            error:
              "Save preflight must be evaluated before authorization can be issued.",
          },
          { status: 400 }
        );
      }

      authorization = issueMaklumatAmSaveAuthorization(job);

      if (authorization.status !== "active") {
        // Issuance was refused — still persist the refusal state
        eventType = "save_authorization_evaluated";
        eventNote = `Save authorization issuance refused: ${authorization.explanation}`;
      } else {
        eventType = "save_authorization_issued";
        eventNote = `Save authorization issued for ${authorization.scope} — tied to preflight at ${authorization.stateRef?.preflightEvaluatedAt ?? "unknown"}`;
      }
      break;
    }

    case "revoke": {
      authorization = revokeMaklumatAmSaveAuthorization(job);
      eventType = "save_authorization_revoked";
      eventNote = "Save authorization explicitly revoked.";
      break;
    }

    case "evaluate":
    default: {
      authorization = evaluateMaklumatAmSaveAuthorization(job);
      eventType = "save_authorization_evaluated";
      eventNote = `Save authorization evaluated — status: ${authorization.status}`;
      break;
    }
  }

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    saveAuthorization: authorization,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
