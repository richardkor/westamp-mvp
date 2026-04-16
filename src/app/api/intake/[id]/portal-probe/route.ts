/**
 * POST /api/intake/[id]/portal-probe
 *
 * DEV/LOCAL ONLY — Runs a real Maklumat Am portal probe against
 * the e-Duti Setem portal using Playwright.
 *
 * This route:
 * - Launches a headed Chromium browser
 * - Requires manual login if no saved session exists
 * - Fills Maklumat Am fields using the compiled browser instructions
 * - Reads back portal-derived values
 * - Captures a real observed portal-state snapshot
 * - Evaluates assertions against the observed snapshot
 * - Persists the probe result and assertion evaluation on the job
 * - STOPS before save/submit — never creates a portal record
 *
 * NOT suitable for serverless/Vercel production deployment.
 * NOT a background automation path.
 * This is a local developer tool for validating portal integration.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { createEvent, appendEvent } from "../../../../../lib/stamping-workflow";
import { runStsdsMaklumatAmProbe } from "../../../../../lib/stsds-portal-probe";
import { evaluatePortalAssertions } from "../../../../../lib/stsds-assertions";
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

  if (!job.browserInstructions) {
    return Response.json(
      {
        error:
          "No browser instructions available. Compile browser instructions before running the portal probe.",
      },
      { status: 400 }
    );
  }

  if (!job.routingSuggestion) {
    return Response.json(
      {
        error: "No routing suggestion available.",
      },
      { status: 400 }
    );
  }

  if (!job.portalDraft) {
    return Response.json(
      {
        error: "No portal draft available. Create a portal draft before running the probe.",
      },
      { status: 400 }
    );
  }

  // Run the real portal probe
  let probeResult;
  try {
    probeResult = await runStsdsMaklumatAmProbe(job);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Portal probe failed: ${errorMsg}` },
      { status: 500 }
    );
  }

  // Evaluate assertions against observed snapshot if available
  let assertionEvaluation = job.assertionEvaluation;
  if (probeResult.observedSnapshot) {
    const assertionResult = evaluatePortalAssertions(
      job,
      probeResult.observedSnapshot
    );
    if (assertionResult) {
      assertionEvaluation = assertionResult;
    }
  }

  // Record event
  const eventType =
    probeResult.status === "failed"
      ? "portal_probe_failed"
      : "portal_probe_completed";
  const statusLabel =
    probeResult.status === "completed"
      ? "completed"
      : probeResult.status === "blocked"
        ? "blocked"
        : probeResult.status === "failed"
          ? "failed"
          : "not ready";
  const eventNote = `Portal probe ${statusLabel} for ${probeResult.lane} lane — ${probeResult.executedCount} executed, ${probeResult.refusedCount} refused, ${probeResult.failedCount} failed`;

  const event = createEvent(eventType, eventNote);

  const updated = await updateJobOrConflict(id, {
    portalProbe: probeResult,
    assertionEvaluation: assertionEvaluation ?? job.assertionEvaluation,
    events: appendEvent(job.events, event),
  });

  if (updated instanceof Response) return updated;

  return Response.json(updated);
}
