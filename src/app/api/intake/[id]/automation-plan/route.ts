/**
 * POST /api/intake/[id]/automation-plan
 *
 * Builds or updates the internal STSDS portal automation plan for a job.
 *
 * The plan is assembled from the current job state (routing suggestion,
 * portal draft) and represents "how WeStamp would drive the portal."
 *
 * This does NOT execute any browser automation.
 * This does NOT submit anything to the live e-Duti Setem portal.
 * This does NOT advance the job status.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { buildStsdsAutomationPlan } from "../../../../../lib/stsds-automation-plan";

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
      {
        error:
          "No routing suggestion available. A routing suggestion must be saved before generating an automation plan.",
      },
      { status: 400 }
    );
  }

  const plan = buildStsdsAutomationPlan(job);
  if (!plan) {
    return Response.json(
      { error: "Unable to build automation plan from current job data." },
      { status: 400 }
    );
  }

  const isUpdate = !!job.automationPlan;
  const eventType = isUpdate ? "automation_plan_updated" : "automation_plan_created";
  const statusLabel =
    plan.status === "ready_for_review"
      ? "ready for review"
      : plan.status === "review_required"
        ? "review required"
        : plan.status === "blocked"
          ? "blocked"
          : "not ready";
  const eventNote = isUpdate
    ? `Automation plan updated for ${plan.lane} lane (${statusLabel})`
    : `Automation plan created for ${plan.lane} lane (${statusLabel})`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    automationPlan: plan,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
