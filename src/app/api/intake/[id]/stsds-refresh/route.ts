/**
 * POST /api/intake/[id]/stsds-refresh
 *
 * Rebuilds all internal STSDS artifacts from current job data in a
 * consistent order. Preserves manual portal-draft edits.
 *
 * This is NOT a live portal interaction. It rebuilds internal state
 * only. Does NOT touch any external system.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { refreshStsdsState } from "../../../../../lib/stsds-refresh";

export async function POST(
  _request: NextRequest,
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

  const { updates, result } = refreshStsdsState(job);

  if (!result.success) {
    return Response.json(
      { error: "Refresh failed.", _refreshResult: result },
      { status: 400 }
    );
  }

  const event = createEvent(
    "stsds_state_refreshed",
    `STSDS internal state refreshed. Rebuilt: ${result.rebuilt.join(", ")}.` +
    (result.issues.length > 0 ? ` Issues: ${result.issues.join("; ")}.` : "")
  );

  const updated = await updateJobOrConflict(id, {
    ...updates,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json({ ...updated, _refreshResult: result });
}
