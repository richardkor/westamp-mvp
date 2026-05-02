/**
 * POST /api/intake/[id]/supervised-run/execute-phase-4-bahagian-b-fixed-rent
 *
 * Operator-only route for the FOURTH controlled portal mutation:
 * navigating to the Bahagian B tab, selecting fixed-rent
 * (pds_jenis = "1103"), opening the rent-period modal, filling
 * one rent row (start, end, monthly rent), committing it, then
 * clicking the section-level Simpan Bahagian B exactly once.
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
import { executePhase4BahagianBRouteHandler } from "../../../../../../lib/tenancy-phase-4-bahagian-b-route";
import type { Phase4BahagianBExecutionResult } from "../../../../../../lib/tenancy-phase-4-bahagian-b-executor";
import type {
  TenancyRunSessionPhase4BahagianBResult,
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

  const result: Phase4BahagianBExecutionResult =
    await executePhase4BahagianBRouteHandler({
      job,
      cdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
    });

  if (result.status === "refused") {
    return Response.json({ ok: false, result, applied: false });
  }

  if (result.status === "failed") {
    const failureBlock = toRunSessionBlock(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        phase4BahagianBFixedRent: failureBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_4_bahagian_b_fixed_rent_failed",
      `Phase 4 Bahagian B fixed-rent save failed. reason=${result.refusalReason ?? "unknown"}`
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: false, result, applied: true });
  }

  if (result.status === "saved") {
    const savedBlock = toRunSessionBlock(result);
    const updates: Parameters<typeof updateJobOrConflict>[1] = {};
    if (job.supervisedRunSession) {
      const updatedSession: TenancyRunSessionState = {
        ...job.supervisedRunSession,
        currentRunStage: "phase_4_bahagian_b_fixed_rent_saved",
        phase4BahagianBFixedRent: savedBlock,
        updatedAt: new Date().toISOString(),
      };
      updates.supervisedRunSession = updatedSession;
    }
    const event = createEvent(
      "supervised_run_phase_4_bahagian_b_fixed_rent_saved",
      "Phase 4 Bahagian B fixed-rent data saved. No Bahagian C, upload, Hantar, payment, or certificate retrieval was performed."
    );
    updates.events = appendEvent(job.events, event);
    const updated = await updateJobOrConflict(id, updates);
    if (updated instanceof Response) return updated;
    return Response.json({ ok: true, result, applied: true });
  }

  return Response.json({ ok: false, result, applied: false });
}

function toRunSessionBlock(
  result: Phase4BahagianBExecutionResult
): TenancyRunSessionPhase4BahagianBResult {
  if (result.status !== "saved" && result.status !== "failed") {
    return {
      status: "failed",
      attemptedAt: result.attemptedAt,
      ...(result.refusalReason !== undefined
        ? { failureReasonCode: result.refusalReason }
        : {}),
    };
  }
  const out: TenancyRunSessionPhase4BahagianBResult = {
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
  if (result.preRentRowCount !== undefined) out.preRentRowCount = result.preRentRowCount;
  if (result.postRentRowCount !== undefined)
    out.postRentRowCount = result.postRentRowCount;
  return out;
}
