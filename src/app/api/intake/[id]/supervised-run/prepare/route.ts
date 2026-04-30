/**
 * POST /api/intake/[id]/supervised-run/prepare
 *
 * Operator-only endpoint that prepares (or refreshes) the internal
 * supervised-run-session state for a tenancy job.
 *
 * Auth: handled by the existing operator middleware. Every request
 * to `/api/intake/:path*` requires a valid `operator_session`
 * cookie; an unauthenticated request returns `401` BEFORE this
 * handler runs.
 *
 * Inputs (JSON body):
 *   - inspectBrowserSession?: boolean — when `true`, runs ONE
 *     read-only CDP attach cycle to snapshot the browser session.
 *     Defaults to `false` (no portal contact at all).
 *
 * Outputs:
 *   - 200 with `{ ok: true, state }` on success.
 *   - 404 when the job does not exist.
 *   - 200 with `{ ok: false, error }` on input-validation failures
 *     and when the job is not a tenancy-agreement job.
 *   - 409 on a concurrent-update conflict.
 *
 * Read-only invariants:
 *   - Never clicks, fills, types, selects, uploads, submits, or
 *     saves anything on the LHDN portal.
 *   - Never reads cookies / storage / tokens / `lhdnmsstoken`.
 *   - The state record never embeds a raw URL, href, IC, TIN,
 *     party name, address, or document content.
 *
 * The actual logic is delegated to `handlePrepareRequest` in
 * `src/lib/tenancy-supervised-run-session-route.ts` so the
 * read-only contract is testable without booting Next.js.
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
import { handlePrepareRequest } from "../../../../../../lib/tenancy-supervised-run-session-route";

// Force Node.js runtime — Playwright's CDP attach is server-only and
// not Edge-compatible. Force-dynamic so this never runs at build time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const result = await handlePrepareRequest({
    job,
    body,
    cdpEndpoint: process.env.WESTAMP_CDP_ENDPOINT,
    ...(job.supervisedRunSession !== undefined
      ? { existingState: job.supervisedRunSession }
      : {}),
  });

  if (!result.ok) {
    return Response.json(result);
  }

  // Persist the new state on the job record. The route layer is
  // the only place state is persisted; the helper itself is pure.
  const event = createEvent(
    "supervised_run_prepared",
    `Supervised run session prepared. stage=${result.state.currentRunStage}`
  );
  const updated = await updateJobOrConflict(id, {
    supervisedRunSession: result.state,
    events: appendEvent(job.events, event),
  });
  if (updated instanceof Response) return updated;

  return Response.json({
    ok: true,
    state: updated.supervisedRunSession ?? result.state,
  });
}
