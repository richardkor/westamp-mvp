/**
 * GET /api/receipt/[id]/certificate?token=<receiptToken>
 *
 * Public, receipt-token-gated certificate download for completed jobs.
 *
 * Returns the stamped certificate PDF only when ALL of the following
 * are true:
 *   1. Receipt token is provided and matches the job's token
 *   2. The job is in a delivered state
 *   3. A certificate file actually exists in storage
 *
 * All failure responses are public-safe — no internal lifecycle
 * details, storage paths, or adjudication numbers are exposed.
 *
 * This route is public (not in the middleware matcher) and does NOT
 * require an operator session.
 */

import { NextRequest } from "next/server";
import { getJob } from "../../../../../lib/stamping-store";
import { blobStore } from "../../../../../lib/storage";

const CACHE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token");

  // ── Token required ─────────────────────────────────────────────────
  if (!token) {
    return Response.json(
      { error: "Access denied." },
      { status: 403, headers: CACHE_HEADERS }
    );
  }

  // ── Job must exist ─────────────────────────────────────────────────
  const job = await getJob(id);
  if (!job) {
    return Response.json(
      { error: "Access denied." },
      { status: 403, headers: CACHE_HEADERS }
    );
  }

  // ── Token must match (legacy jobs without token fail closed) ───────
  if (!job.receiptToken || job.receiptToken !== token) {
    return Response.json(
      { error: "Access denied." },
      { status: 403, headers: CACHE_HEADERS }
    );
  }

  // ── Job must be delivered ──────────────────────────────────────────
  if (!job.fulfilmentState?.delivered) {
    return Response.json(
      { error: "Certificate is not available for this submission." },
      { status: 404, headers: CACHE_HEADERS }
    );
  }

  // ── Certificate storage path must exist on the job ─────────────────
  const storagePath = job.fulfilmentState.certificateStoragePath;
  if (!storagePath) {
    return Response.json(
      { error: "Certificate is not available for this submission." },
      { status: 404, headers: CACHE_HEADERS }
    );
  }

  // ── Certificate file must exist in storage ─────────────────────────
  let fileBuffer: Buffer | null;
  try {
    fileBuffer = await blobStore.readBlob(storagePath);
  } catch {
    return Response.json(
      { error: "Certificate is not available for this submission." },
      { status: 404, headers: CACHE_HEADERS }
    );
  }

  if (!fileBuffer) {
    return Response.json(
      { error: "Certificate is not available for this submission." },
      { status: 404, headers: CACHE_HEADERS }
    );
  }

  // ── Return the certificate PDF ─────────────────────────────────────
  const fileName =
    job.fulfilmentState.certificateFileName ?? "certificate.pdf";

  return new Response(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(fileBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}
