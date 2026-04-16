/**
 * POST /api/intake/[id]/bahagian-a-fill-authorization
 *
 * Issues, evaluates, or revokes Bahagian A fill authorization.
 *
 * Actions (via ?action= query parameter):
 * - issue: Issue a new authorization (requires eligible fill preflight)
 * - revoke: Revoke an existing authorization
 * - evaluate: Re-evaluate the current authorization state
 *
 * Default action (no query param): evaluate.
 *
 * This route:
 * - Does NOT touch the live portal
 * - Does NOT fill any Bahagian A field
 * - Records a workflow event
 * - Persists the authorization on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  evaluateBahagianAFillAuthorization,
  issueBahagianAFillAuthorization,
  revokeBahagianAFillAuthorization,
} from "../../../../../lib/stsds-bahagian-a-fill-authorization";

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
      {
        error: `Invalid action: "${action}". Use issue, revoke, or evaluate.`,
      },
      { status: 400 }
    );
  }

  let authorization;
  let eventType:
    | "bahagian_a_fill_authorization_issued"
    | "bahagian_a_fill_authorization_revoked"
    | "bahagian_a_fill_authorization_evaluated";
  let eventNote: string;

  switch (action) {
    case "issue": {
      if (!job.bahagianAFillPreflight) {
        return Response.json(
          {
            error:
              "Bahagian A fill preflight must be evaluated before authorization can be issued.",
          },
          { status: 400 }
        );
      }

      authorization = issueBahagianAFillAuthorization(job);

      if (authorization.status !== "active") {
        eventType = "bahagian_a_fill_authorization_evaluated";
        eventNote = `Bahagian A fill authorization issuance refused: ${authorization.explanation}`;
      } else {
        eventType = "bahagian_a_fill_authorization_issued";
        eventNote =
          `Bahagian A fill authorization issued for ${authorization.scope} — ` +
          `tied to fill preflight at ${authorization.stateRef?.fillPreflightEvaluatedAt ?? "unknown"}, ` +
          `entry-state at ${authorization.stateRef?.entryStateObservedAt ?? "unknown"}, ` +
          `lane: ${authorization.stateRef?.lane ?? "unknown"}`;
      }
      break;
    }

    case "revoke": {
      authorization = revokeBahagianAFillAuthorization(job);
      eventType = "bahagian_a_fill_authorization_revoked";
      eventNote = "Bahagian A fill authorization explicitly revoked.";
      break;
    }

    case "evaluate":
    default: {
      authorization = evaluateBahagianAFillAuthorization(job);
      eventType = "bahagian_a_fill_authorization_evaluated";
      eventNote = `Bahagian A fill authorization evaluated — status: ${authorization.status}`;
      break;
    }
  }

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    bahagianAFillAuthorization: authorization,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
