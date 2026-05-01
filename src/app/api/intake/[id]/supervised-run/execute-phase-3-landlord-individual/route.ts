/**
 * POST /api/intake/[id]/supervised-run/execute-phase-3-landlord-individual
 *
 * Operator-only route that performs the SECOND controlled portal
 * mutation for the Sewa/Pajakan fixed-rent path: opening the
 * Bahagian A `Tambah Individu` modal scoped to the LANDLORD
 * fieldset, filling the captured landlord-individual party, and
 * clicking the modal Simpan button exactly once. Then verifying
 * the landlord row count climbed by exactly 1. Stops there.
 *
 * Auth: handled by the existing operator middleware
 * (`/api/intake/:path*` requires a valid `operator_session` cookie).
 *
 * Inputs: empty body. Every input the executor needs comes from
 * the persisted job state (readiness, run session, party data).
 *
 * Outputs:
 *   - 200 with `{ ok: true, result, applied: true }` on success.
 *   - 200 with `{ ok: false, result, applied }` on refusal /
 *     failure. `result.refusalReason` is one of the stable Phase 3
 *     codes; `result.reason` is the operator-facing fixed-vocab
 *     sentence.
 *   - 404 when the job does not exist.
 *   - 409 on a concurrent-update conflict.
 *
 * Read-only / write-scoped invariants — same as B7's Phase 2 route:
 *   - Pure preflight runs BEFORE any CDP attach.
 *   - CDP attach uses `chromium.connectOverCDP` (does not start a
 *     new browser, does not close the operator's Chrome).
 *   - Page selection uses ONLY `page.url()` + the path classifier.
 *   - The executor is the only writer. Its selector allow-list is
 *     enforced by `tenancy-phase-3-landlord-executor.ts` — tab
 *     anchor + landlord trigger + modal field set + modal Simpan
 *     button + landlord-table row counter. Nothing else.
 *   - Tenant rows / company rows / Bahagian B / C / Lampiran /
 *     Perakuan / Hantar / payment / certificate-retrieval surfaces
 *     are explicitly OUT of scope.
 *
 * Persistence:
 *   - On `status === "saved"`: append a
 *     `supervised_run_phase_3_landlord_individual_saved` event AND
 *     update `currentRunStage` to
 *     `phase_3_landlord_individual_saved` AND record the sanitized
 *     `phase3LandlordIndividual` block on the run session.
 *   - On `status === "failed"`: append a
 *     `supervised_run_phase_3_landlord_individual_failed` event
 *     AND record the sanitized failure block. `currentRunStage`
 *     unchanged.
 *   - On `status === "refused"`: NO persistence (we never touched
 *     the portal).
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
import { executePhase3LandlordRouteHandler } from "../../../../../../lib/tenancy-phase-3-landlord-route";
import type { Phase3LandlordExecutionResult } from "../../../../../../lib/tenancy-phase-3-landlord-executor";
import type {
  TenancyRunSessionPhase3LandlordResult,
  TenancyRunSessionState,
} from "../../../../../../lib/tenancy-supervised-run-session";

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

  const result: Phase3LandlordExecutionResult =
    await executePhase3LandlordRouteHandler({
      job,
      cdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
    });

  // Refusal → no persistence, just return the result for the UI.
  if (result.status === "refused") {
    return Response.json({ ok: false, result, applied: false });
  }

  // Failure → persist sanitized failure block + an event.
  if (result.status === "failed") {
    const failureBlock = toRunSessionBlock(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        phase3LandlordIndividual: failureBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_3_landlord_individual_failed",
      `Phase 3 landlord-individual save failed. reason=${result.refusalReason ?? "unknown"}`
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: false, result, applied: true });
  }

  // Success → persist saved block + transition stage + append event.
  if (result.status === "saved") {
    const savedBlock = toRunSessionBlock(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        currentRunStage: "phase_3_landlord_individual_saved",
        phase3LandlordIndividual: savedBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_3_landlord_individual_saved",
      "Phase 3 landlord-individual row saved. No tenant, upload, Hantar, payment, or certificate retrieval was performed."
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: true, result, applied: true });
  }

  return Response.json({ ok: false, result, applied: false });
}

function toRunSessionBlock(
  result: Phase3LandlordExecutionResult
): TenancyRunSessionPhase3LandlordResult {
  if (result.status !== "saved" && result.status !== "failed") {
    return {
      status: "failed",
      attemptedAt: result.attemptedAt,
      ...(result.refusalReason !== undefined
        ? { failureReasonCode: result.refusalReason }
        : {}),
    };
  }
  const out: TenancyRunSessionPhase3LandlordResult = {
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
  if (result.preRowCount !== undefined) out.preRowCount = result.preRowCount;
  if (result.postRowCount !== undefined)
    out.postRowCount = result.postRowCount;
  return out;
}
