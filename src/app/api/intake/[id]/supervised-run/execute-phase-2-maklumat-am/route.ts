/**
 * POST /api/intake/[id]/supervised-run/execute-phase-2-maklumat-am
 *
 * Operator-only route that performs the FIRST controlled portal
 * mutation for the Sewa/Pajakan fixed-rent path: filling the
 * Maklumat Am fields on the operator's open Sewa/Pajakan p5 form
 * and clicking Simpan Maklumat Am exactly once. Nothing else.
 *
 * Auth: handled by the existing operator middleware
 * (`/api/intake/:path*` requires a valid `operator_session`
 * cookie; 401 otherwise).
 *
 * Inputs: empty body. Every input the executor needs comes from
 * the persisted job state (readiness, instruction graph,
 * supervisedRunSession, payload values).
 *
 * Outputs:
 *   - 200 with `{ ok: true, result, applied }` on success
 *     (`applied=true` when this call recorded the saved-event;
 *     `applied=false` for an already-saved job).
 *   - 200 with `{ ok: false, result }` on refusal / failure. The
 *     `result.refusalReason` is one of the stable Phase 2 codes
 *     and `result.reason` is the operator-facing fixed-vocabulary
 *     sentence.
 *   - 404 when the job does not exist.
 *   - 409 on a concurrent-update conflict.
 *
 * Read-only / write-scoped invariants:
 *   - The route runs the pure preflight (`evaluatePhase2Preflight`)
 *     BEFORE any CDP attach. Any precondition failure refuses
 *     without touching the operator's browser.
 *   - The CDP attach uses `chromium.connectOverCDP` (read-only by
 *     definition; does not start a new browser; does not close
 *     the operator's Chrome on detach).
 *   - The page-selection step uses ONLY `page.url()` and the
 *     existing path classifier; the raw URL is dropped at this
 *     seam.
 *   - The executor itself is the only writer; it touches ONLY the
 *     six Maklumat Am field selectors + the single Simpan
 *     Maklumat Am button.
 *   - On any failure, `browser.close()` disconnects Playwright
 *     without terminating the operator's Chrome.
 *
 * Persistence:
 *   - On `status === "saved"`: append a
 *     `supervised_run_phase_2_maklumat_am_saved` event AND update
 *     `supervisedRunSession.currentRunStage` to
 *     `phase_2_maklumat_am_saved` AND record the sanitized
 *     `phase2MaklumatAm` block on the run session.
 *   - On `status === "failed"`: append a
 *     `supervised_run_phase_2_maklumat_am_failed` event AND
 *     record the sanitized failure result on the run session.
 *     The currentRunStage is NOT changed.
 *   - On `status === "refused"`: NO persistence. Refusal means we
 *     never touched the portal; recording an event would only
 *     create audit-trail noise.
 *
 * Forbidden actions: every Bahagian A / B / C / Lampiran /
 * Perakuan / Hantar / payment / certificate-retrieval surface is
 * out of scope for this route. The executor's selector allow-list
 * is enforced by `tenancy-phase-2-executor.ts`.
 */

import { NextRequest } from "next/server";
import {
  getJob,
  updateJobOrConflict,
} from "../../../../../../lib/stamping-store";
import {
  appendEvent,
  createEvent,
} from "../../../../../../lib/stamping-workflow";
import { executePhase2RouteHandler } from "../../../../../../lib/tenancy-phase-2-route";
import type { Phase2ExecutionResult } from "../../../../../../lib/tenancy-phase-2-executor";
import type {
  TenancyRunSessionPhase2Result,
  TenancyRunSessionState,
} from "../../../../../../lib/tenancy-supervised-run-session";

// Force Node.js runtime — Playwright's CDP attach is server-only and
// not Edge-compatible. Force-dynamic so this never runs at build time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  const result: Phase2ExecutionResult = await executePhase2RouteHandler({
    job,
    cdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
  });

  // Refusal → no persistence, just return the result for the UI.
  if (result.status === "refused") {
    return Response.json({ ok: false, result, applied: false });
  }

  // Failure → persist the sanitized failure block + an event.
  if (result.status === "failed") {
    const failureBlock = toRunSessionPhase2Result(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        phase2MaklumatAm: failureBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_2_maklumat_am_failed",
      `Phase 2 Maklumat Am attempt failed. reason=${result.refusalReason ?? "unknown"}`
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: false, result, applied: true });
  }

  // Success → persist saved block + transition stage + append event.
  if (result.status === "saved") {
    const savedBlock = toRunSessionPhase2Result(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        currentRunStage: "phase_2_maklumat_am_saved",
        phase2MaklumatAm: savedBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_2_maklumat_am_saved",
      "Phase 2 Maklumat Am draft saved. No Hantar, upload, payment, or certificate retrieval was performed."
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: true, result, applied: true });
  }

  // Defensive — `not_attempted` / `started` are never returned by
  // the route handler. Treat as refusal for safety.
  return Response.json({ ok: false, result, applied: false });
}

/**
 * Project the executor's full result down to the sanitized block
 * we persist on the run-session record. Drops nothing important
 * but never stores a raw exception text or URL.
 */
function toRunSessionPhase2Result(
  result: Phase2ExecutionResult
): TenancyRunSessionPhase2Result {
  if (result.status !== "saved" && result.status !== "failed") {
    // Defensive — only saved/failed reach the persistence path.
    return {
      status: "failed",
      attemptedAt: result.attemptedAt,
      ...(result.refusalReason !== undefined
        ? { failureReasonCode: result.refusalReason }
        : {}),
    };
  }
  const out: TenancyRunSessionPhase2Result = {
    status: result.status,
    attemptedAt: result.attemptedAt,
  };
  if (result.savedAt !== undefined) out.savedAt = result.savedAt;
  if (result.postSavePathKind !== undefined) {
    out.postSavePathKind = result.postSavePathKind;
  }
  if (result.refusalReason !== undefined) {
    out.failureReasonCode = result.refusalReason;
  }
  return out;
}
