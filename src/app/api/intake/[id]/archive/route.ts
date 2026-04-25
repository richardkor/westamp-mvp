/**
 * POST /api/intake/[id]/archive
 *
 * Operator-only soft-archive / restore for a stamping job. Gated by
 * `src/middleware.ts` under the `/api/intake/:path*` matcher, so it
 * is reachable only with a valid `operator_session` cookie.
 *
 * Archiving sets `archivedAt` to the current ISO timestamp and (if
 * provided) records a short `archivedReason` on the job record. It
 * also appends a typed `job_archived` event to the job's event
 * history so the audit log is preserved.
 *
 * Restoring clears `archivedAt` and `archivedReason` and appends a
 * `job_restored` event.
 *
 * Does NOT
 * ────────
 * - delete the job record
 * - delete the uploaded source PDF or any blob
 * - touch fulfilment state, nominal-duty state, or any other field
 * - change the main `StampingJobStatus` enum value
 * - change the public receipt status
 *
 * Request body
 * ────────────
 * Archive: { reason?: string }
 *   - `reason`, if supplied, must be a string no longer than
 *     `ARCHIVE_REASON_MAX_LENGTH` (200) characters.
 * Restore: { restore: true }
 *   - any other fields are ignored
 *
 * Eligibility
 * ───────────
 * - Job must exist (404 if not).
 * - Archive on an already-archived job is a no-op success.
 * - Restore on a non-archived job is a no-op success.
 */

import { NextRequest } from "next/server";
import { getJob, updateJobOrConflict } from "../../../../../lib/stamping-store";
import { appendEvent, createEvent } from "../../../../../lib/stamping-workflow";

const ARCHIVE_REASON_MAX_LENGTH = 200;

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
    // Empty body is allowed for the simple "archive without reason" case.
    body = {};
  }

  if (body !== null && typeof body !== "object") {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = (body ?? {}) as { reason?: unknown; restore?: unknown };
  const isRestore = parsed.restore === true;

  // ── Restore branch ────────────────────────────────────────────────
  if (isRestore) {
    if (!job.archivedAt) {
      // Idempotent: not archived → return current shape, no event.
      return Response.json({
        id: job.id,
        archivedAt: null,
        archivedReason: null,
      });
    }

    const event = createEvent(
      "job_restored",
      job.archivedReason
        ? `Restored to active queue (was: "${job.archivedReason}").`
        : "Restored to active queue."
    );

    const result = await updateJobOrConflict(id, {
      archivedAt: undefined,
      archivedReason: undefined,
      events: appendEvent(job.events, event),
    });
    if (result instanceof Response) return result;

    return Response.json({
      id: result.id,
      archivedAt: null,
      archivedReason: null,
    });
  }

  // ── Archive branch ────────────────────────────────────────────────
  let reason: string | undefined;
  if (parsed.reason !== undefined && parsed.reason !== null) {
    if (typeof parsed.reason !== "string") {
      return Response.json(
        { error: "Reason must be a string." },
        { status: 400 }
      );
    }
    const trimmed = parsed.reason.trim();
    if (trimmed.length > ARCHIVE_REASON_MAX_LENGTH) {
      return Response.json(
        {
          error: `Reason exceeds the ${ARCHIVE_REASON_MAX_LENGTH}-character limit.`,
        },
        { status: 400 }
      );
    }
    reason = trimmed.length > 0 ? trimmed : undefined;
  }

  if (job.archivedAt) {
    // Idempotent: already archived → return current shape, no event.
    return Response.json({
      id: job.id,
      archivedAt: job.archivedAt,
      archivedReason: job.archivedReason ?? null,
    });
  }

  const event = createEvent(
    "job_archived",
    reason
      ? `Hidden from active queue. Reason: ${reason}`
      : "Hidden from active queue."
  );

  const result = await updateJobOrConflict(id, {
    archivedAt: event.timestamp,
    archivedReason: reason,
    events: appendEvent(job.events, event),
  });
  if (result instanceof Response) return result;

  return Response.json({
    id: result.id,
    archivedAt: result.archivedAt ?? null,
    archivedReason: result.archivedReason ?? null,
  });
}
