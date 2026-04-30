/**
 * POST /api/intake/[id]/supervised-run/approve-first-mutation
 *
 * Operator-only endpoint that records the first-portal-mutation
 * approval flag on the internal supervised-run-session state.
 *
 * Auth: handled by the existing operator middleware (`operator_session`
 * cookie required; 401 otherwise).
 *
 * Inputs: empty body. The route reads the job's existing
 * supervisedRunSession; the body has no fields.
 *
 * Outputs:
 *   - 200 with `{ ok: true, state, applied, notice }` on success.
 *     `applied=true` when this call recorded the approval;
 *     `applied=false` when the state was already approved
 *     (idempotent).
 *   - 404 when the job does not exist.
 *   - 200 with `{ ok: false, error, reason }` on eligibility
 *     refusal. `reason` is one of the stable
 *     `ApprovalRefusalReason` codes; the operator UI maps it to
 *     a human-readable label.
 *   - 409 on a concurrent-update conflict.
 *
 * NEVER does any of:
 *   - open a browser
 *   - click anything
 *   - create a draft
 *   - save Maklumat Am
 *   - upload anything
 *   - submit anything
 *
 * Approval just sets an internal flag. The B7+ milestone is
 * required before WeStamp can create a portal draft.
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
import { handleApproveFirstMutationRequest } from "../../../../../../lib/tenancy-supervised-run-session-route";

// Stays Node-only purely for symmetry with the prepare route — the
// helper itself uses no Playwright API.
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

  const result = await handleApproveFirstMutationRequest({ job });

  if (!result.ok) {
    return Response.json(result);
  }

  // Persist the new state. Append an event ONLY when this call
  // actually applied the approval — repeated idempotent calls do
  // not append duplicate events.
  const updates: Parameters<typeof updateJobOrConflict>[1] = {
    supervisedRunSession: result.state,
  };
  if (result.applied) {
    const event = createEvent(
      "supervised_run_first_mutation_approved",
      "First portal mutation approved internally. No e-Duti Setem action has been taken."
    );
    updates.events = appendEvent(job.events, event);
  }

  const updated = await updateJobOrConflict(id, updates);
  if (updated instanceof Response) return updated;

  return Response.json({
    ok: true,
    state: updated.supervisedRunSession ?? result.state,
    applied: result.applied,
    notice: result.notice,
  });
}
