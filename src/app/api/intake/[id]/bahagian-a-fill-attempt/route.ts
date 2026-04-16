/**
 * POST /api/intake/[id]/bahagian-a-fill-attempt
 *
 * DEV/LOCAL ONLY — Executes the first guarded Bahagian A single-field
 * fill attempt. Fills exactly ONE grounded editable field, captures
 * post-fill evidence and readback, then stops.
 *
 * This route:
 * - Requires the same two-layer environment gate as the portal probe
 * - Requires active, non-stale Bahagian A fill authorization
 * - Requires eligible Bahagian A fill preflight
 * - Requires completed entry-state with observed fields
 * - Launches a real browser, progresses to Bahagian A, fills ONE field
 * - Captures a post-fill screenshot and readback
 * - Persists the result separately on the job record
 * - Does NOT fill additional fields
 * - Does NOT continue beyond the single-field outcome
 *
 * NOT suitable for serverless/Vercel production deployment.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runBahagianAFirstFieldFillAttempt } from "../../../../../lib/stsds-bahagian-a-fill-attempt";
import { evaluateBahagianAFillAuthorization } from "../../../../../lib/stsds-bahagian-a-fill-authorization";
import { assertProbeAllowed } from "../../../../../lib/stsds-probe-guard";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = assertProbeAllowed();
  if (blocked) return blocked;

  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  // ── Pre-validate: active fill authorization ─────────────────────
  if (!job.bahagianAFillAuthorization) {
    return Response.json(
      {
        error:
          "No Bahagian A fill authorization exists. " +
          "Issue fill authorization before attempting a fill.",
      },
      { status: 400 }
    );
  }

  // Re-evaluate freshness
  const freshAuth = evaluateBahagianAFillAuthorization(job);
  if (freshAuth.status !== "active") {
    return Response.json(
      {
        error:
          `Bahagian A fill authorization is "${freshAuth.status}": ${freshAuth.explanation} ` +
          "Issue a fresh fill authorization before attempting a fill.",
      },
      { status: 400 }
    );
  }

  // ── Pre-validate: eligible fill preflight ────────────────────────
  if (!job.bahagianAFillPreflight) {
    return Response.json(
      {
        error:
          "Bahagian A fill preflight has not been evaluated. " +
          "Evaluate fill preflight before attempting a fill.",
      },
      { status: 400 }
    );
  }

  if (job.bahagianAFillPreflight.status !== "eligible_for_later_fill_attempt") {
    return Response.json(
      {
        error:
          `Bahagian A fill preflight status is "${job.bahagianAFillPreflight.status}" — ` +
          'must be "eligible_for_later_fill_attempt".',
      },
      { status: 400 }
    );
  }

  // ── Pre-validate: entry-state exists ─────────────────────────────
  if (!job.bahagianAEntryState || !job.bahagianAEntryState.tabObserved) {
    return Response.json(
      {
        error:
          "Bahagian A entry-state has not been captured or tab was not observed. " +
          "Capture entry-state before attempting a fill.",
      },
      { status: 400 }
    );
  }

  // ── Run the fill attempt ─────────────────────────────────────────
  let fillAttempt;
  try {
    fillAttempt = await runBahagianAFirstFieldFillAttempt(job);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Bahagian A fill attempt failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  // ── Record event ─────────────────────────────────────────────────
  let eventType: "bahagian_a_fill_attempt_completed" | "bahagian_a_fill_attempt_failed" | "bahagian_a_fill_attempt_blocked";
  let eventNote: string;

  if (fillAttempt.status === "completed_with_stop") {
    eventType = "bahagian_a_fill_attempt_completed";
    eventNote =
      `Bahagian A single-field fill attempt completed — ` +
      `target: "${fillAttempt.target?.labelText ?? "unknown"}", ` +
      `outcome: ${fillAttempt.evidence?.outcome ?? "unknown"}, ` +
      `readback match: ${fillAttempt.evidence?.readbackMatch ?? "unknown"}`;
  } else if (fillAttempt.status === "blocked") {
    eventType = "bahagian_a_fill_attempt_blocked";
    eventNote = `Bahagian A fill attempt blocked: ${fillAttempt.blockReason}`;
  } else {
    eventType = "bahagian_a_fill_attempt_failed";
    eventNote =
      `Bahagian A fill attempt failed — ` +
      `target: "${fillAttempt.target?.labelText ?? "unknown"}", ` +
      `reason: ${fillAttempt.blockReason ?? fillAttempt.evidence?.outcome ?? "unknown"}`;
  }

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    bahagianAFillAttempt: fillAttempt,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
