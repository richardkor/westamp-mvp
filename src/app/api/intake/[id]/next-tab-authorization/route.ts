/**
 * POST /api/intake/[id]/next-tab-authorization
 *
 * Issues, evaluates, or revokes next-tab progression authorization.
 *
 * Actions (via ?action= query parameter):
 * - issue: Issue a new authorization (requires eligible next-tab preflight)
 * - revoke: Revoke an existing authorization
 * - evaluate: Re-evaluate the current authorization state
 *
 * Default action (no query param): evaluate.
 *
 * This route:
 * - Does NOT touch the live portal
 * - Does NOT perform any next-tab click
 * - Records a workflow event
 * - Persists the authorization on the job record
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import {
  evaluateNextTabProgressionAuthorization,
  issueNextTabProgressionAuthorization,
  revokeNextTabProgressionAuthorization,
} from "../../../../../lib/stsds-next-tab-authorization";

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
    | "next_tab_authorization_issued"
    | "next_tab_authorization_revoked"
    | "next_tab_authorization_evaluated";
  let eventNote: string;

  switch (action) {
    case "issue": {
      if (!job.nextTabPreflight) {
        return Response.json(
          {
            error:
              "Next-tab preflight must be evaluated before authorization can be issued.",
          },
          { status: 400 }
        );
      }

      authorization = issueNextTabProgressionAuthorization(job);

      if (authorization.status !== "active") {
        eventType = "next_tab_authorization_evaluated";
        eventNote = `Next-tab authorization issuance refused: ${authorization.explanation}`;
      } else {
        eventType = "next_tab_authorization_issued";
        eventNote =
          `Next-tab authorization issued for ${authorization.scope} — ` +
          `tied to preflight at ${authorization.stateRef?.nextTabPreflightEvaluatedAt ?? "unknown"}, ` +
          `next tab: ${authorization.stateRef?.expectedNextTabKey ?? "unknown"}`;
      }
      break;
    }

    case "revoke": {
      authorization = revokeNextTabProgressionAuthorization(job);
      eventType = "next_tab_authorization_revoked";
      eventNote = "Next-tab authorization explicitly revoked.";
      break;
    }

    case "evaluate":
    default: {
      authorization = evaluateNextTabProgressionAuthorization(job);
      eventType = "next_tab_authorization_evaluated";
      eventNote = `Next-tab authorization evaluated — status: ${authorization.status}`;
      break;
    }
  }

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    nextTabAuthorization: authorization,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
