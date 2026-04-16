/**
 * POST /api/intake/[id]/transition
 *
 * Attempts a controlled state transition on a stamping job.
 * Validates the transition via the centralized workflow service
 * and appends an event to the job history.
 *
 * Request body: { targetStatus: StampingJobStatus }
 *
 * Only user-triggerable transitions are allowed in this milestone.
 * Reserved statuses (submitted, processing, completed) return 400.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { StampingJobStatus } from "../../../../../lib/stamping-types";
import {
  canTransition,
  createEvent,
  appendEvent,
  buildInitialArtifacts,
} from "../../../../../lib/stamping-workflow";

const VALID_STATUSES = new Set<string>([
  "uploaded",
  "intake_reviewed",
  "prepared",
  "ready_for_submission",
  "submitted",
  "processing",
  "completed",
  "failed",
  "manual_review_required",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // Parse body
  let body: { targetStatus?: unknown; systemTriggered?: unknown; errorMessage?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const targetStatus = body.targetStatus;
  if (
    typeof targetStatus !== "string" ||
    !VALID_STATUSES.has(targetStatus)
  ) {
    return Response.json(
      { error: "Invalid target status." },
      { status: 400 }
    );
  }

  const systemTriggered = body.systemTriggered === true;

  // Validate transition
  const result = canTransition(
    job,
    targetStatus as StampingJobStatus,
    { systemTriggered }
  );
  if (!result.ok) {
    // Log the blocked transition as an event
    const blockedEvent = createEvent(
      "transition_blocked",
      `Attempted ${job.status} → ${targetStatus}: ${result.reason}`
    );
    await updateJobOrConflict(id, {
      events: appendEvent(job.events, blockedEvent),
    });

    return Response.json({ error: result.reason }, { status: 400 });
  }

  // Determine event type based on target
  let eventType: Parameters<typeof createEvent>[0];
  if (targetStatus === "ready_for_submission") {
    eventType = "marked_ready_for_submission";
  } else if (targetStatus === "manual_review_required") {
    eventType = "moved_to_manual_review";
  } else if (targetStatus === "failed") {
    eventType = "moved_to_failed";
  } else {
    eventType = "status_changed";
  }

  const eventNote =
    typeof body.errorMessage === "string" && body.errorMessage.trim()
      ? `${job.status} → ${targetStatus}: ${body.errorMessage.trim()}`
      : `${job.status} → ${targetStatus}`;

  const event = createEvent(eventType, eventNote);

  const updates: Record<string, unknown> = {
    status: targetStatus,
    events: appendEvent(job.events, event),
  };

  // Populate artifacts on first transition to ready_for_submission
  if (targetStatus === "ready_for_submission" && !job.artifacts) {
    updates.artifacts = buildInitialArtifacts(job);
  }

  // Store error message when transitioning to failed
  if (targetStatus === "failed" && typeof body.errorMessage === "string") {
    updates.errorMessage = body.errorMessage.trim() || undefined;
  }

  // Store reason note when transitioning to manual_review_required
  if (targetStatus === "manual_review_required" && typeof body.errorMessage === "string") {
    updates.notes = body.errorMessage.trim() || undefined;
  }

  const updated = await updateJobOrConflict(id, updates);

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
