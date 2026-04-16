/**
 * GET /api/intake/[id]/certificate-download
 *
 * Serves the certificate PDF file attached to a job.
 * Returns 404 if no certificate file is stored.
 *
 * Uses the blob store abstraction for file access.
 */

import { NextRequest } from "next/server";
import { getJob } from "../../../../../lib/stamping-store";
import { blobStore } from "../../../../../lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: "Record not found." }, { status: 404 });
  }

  const storageKey = job.fulfilmentState?.certificateStoragePath;
  if (!storageKey) {
    return Response.json(
      { error: "No certificate file attached to this job." },
      { status: 404 }
    );
  }

  const fileBuffer = await blobStore.readBlob(storageKey);
  if (!fileBuffer) {
    return Response.json(
      { error: "Certificate file not found." },
      { status: 404 }
    );
  }

  const fileName = job.fulfilmentState?.certificateFileName ?? "certificate.pdf";

  return new Response(new Uint8Array(fileBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(fileBuffer.length),
    },
  });
}
