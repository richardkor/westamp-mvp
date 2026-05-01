/**
 * POST /api/intake/[id]/supervised-run/execute-phase-3-tenant-individual
 *
 * Operator-only route for the THIRD controlled portal mutation:
 * opening the Bahagian A `Tambah Individu` modal scoped to the
 * TENANT fieldset, filling the captured tenant-individual party,
 * clicking the modal Simpan button exactly once, then verifying
 * the tenant row count climbed by exactly 1. Mirror of the B10
 * landlord route with role-scoped resolution + an additional
 * preflight gate that requires the landlord row to already be
 * saved.
 *
 * Persistence:
 *   - On `status === "saved"`: append a
 *     `supervised_run_phase_3_tenant_individual_saved` event AND
 *     update `currentRunStage` to
 *     `phase_3_tenant_individual_saved` AND record the sanitized
 *     `phase3TenantIndividual` block on the run session.
 *   - On `status === "failed"`: append a
 *     `supervised_run_phase_3_tenant_individual_failed` event AND
 *     record the sanitized failure block. `currentRunStage`
 *     unchanged.
 *   - On `status === "refused"`: NO persistence.
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
import { executePhase3TenantRouteHandler } from "../../../../../../lib/tenancy-phase-3-tenant-route";
import type { Phase3TenantExecutionResult } from "../../../../../../lib/tenancy-phase-3-tenant-executor";
import type {
  TenancyRunSessionPhase3TenantResult,
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

  const result: Phase3TenantExecutionResult =
    await executePhase3TenantRouteHandler({
      job,
      cdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
    });

  // Refusal → no persistence.
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
        phase3TenantIndividual: failureBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_3_tenant_individual_failed",
      `Phase 3 tenant-individual save failed. reason=${result.refusalReason ?? "unknown"}`
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
        currentRunStage: "phase_3_tenant_individual_saved",
        phase3TenantIndividual: savedBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_3_tenant_individual_saved",
      "Phase 3 tenant-individual row saved. No company, upload, Hantar, payment, or certificate retrieval was performed."
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: true, result, applied: true });
  }

  return Response.json({ ok: false, result, applied: false });
}

function toRunSessionBlock(
  result: Phase3TenantExecutionResult
): TenancyRunSessionPhase3TenantResult {
  if (result.status !== "saved" && result.status !== "failed") {
    return {
      status: "failed",
      attemptedAt: result.attemptedAt,
      ...(result.refusalReason !== undefined
        ? { failureReasonCode: result.refusalReason }
        : {}),
    };
  }
  const out: TenancyRunSessionPhase3TenantResult = {
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
  if (result.postRowCount !== undefined) out.postRowCount = result.postRowCount;
  return out;
}
