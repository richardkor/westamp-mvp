/**
 * GET /api/intake/[id]/source-download
 *
 * Serves the original uploaded source PDF for an intake job. Used by
 * the authenticated operator page (`/upload/[id]`) so operators can
 * verify the actual uploaded instrument without leaving the hosted
 * workflow. Works across all lanes (tenancy, nominal-duty registry
 * categories, other) since every job has `storagePath` and
 * `originalFileName` populated at intake time.
 *
 * Access model
 * ────────────
 * This route is matched by `src/middleware.ts` under the
 * `/api/intake/:path*` matcher and is treated as a protected API
 * route. An unauthenticated request (no valid `operator_session`
 * cookie) returns 401 from middleware before this handler runs.
 * There is no public/receipt-token bypass on this route; the public
 * receipt page does not link to it.
 *
 * Privacy posture
 * ───────────────
 * Uploaded source PDFs may contain personally identifying information
 * (IC numbers, signatures, addresses). The response is served with
 * `Cache-Control: private, no-store` and `X-Content-Type-Options:
 * nosniff`, and the user-supplied filename is sanitised before being
 * placed in the `Content-Disposition` header to prevent header
 * injection.
 *
 * Does NOT
 * ────────
 * - submit anything to e-Duti Setem
 * - advance the job status
 * - expose storage paths, certificate files, or receipts
 */

import { NextRequest } from "next/server";
import { getJob } from "../../../../../lib/stamping-store";
import { blobStore } from "../../../../../lib/storage";

/**
 * Produce a safe ASCII-only filename for the `Content-Disposition`
 * header. Strips control characters, quotes, and backslashes; falls
 * back to `source.pdf` if nothing printable is left. Keeps the value
 * short enough that it cannot dominate the header.
 */
function safeContentDispositionFilename(
  original: string | undefined | null,
  fallback: string
): string {
  if (!original) return fallback;
  const cleaned = original
    // Strip CR/LF (header-injection guard) and quote/backslash
    // (quote-break guard for the surrounding `filename="…"`).
    .replace(/[\r\n"\\]/g, "")
    // Drop any remaining C0 control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  const storageKey = job.storagePath;
  if (!storageKey) {
    return Response.json(
      { error: "No source file attached to this job." },
      { status: 404 }
    );
  }

  const fileBuffer = await blobStore.readBlob(storageKey);
  if (!fileBuffer) {
    return Response.json(
      { error: "Source file not found in storage." },
      { status: 404 }
    );
  }

  const fileName = safeContentDispositionFilename(
    job.originalFileName,
    "source.pdf"
  );

  return new Response(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(fileBuffer.length),
      // Authenticated, potentially sensitive PII — do not cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
