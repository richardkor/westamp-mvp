/**
 * POST /api/intake
 *
 * Accepts a signed PDF document and a document category selection.
 * Saves the file to disk and creates a stamping intake record.
 *
 * Request: multipart/form-data
 *   file     — PDF file (required)
 *   category — DocumentCategory string (required)
 *
 * Response: { id: string, status: StampingJobStatus, receiptToken: string }
 *
 * Files are stored at: <project-root>/uploads/<uuid>.pdf
 * Records are stored at: <project-root>/data/stamping-jobs.json
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import { createJob } from "../../../lib/stamping-store";
import { blobStore } from "../../../lib/storage";
import {
  DocumentCategory,
  SUPPORTED_FOR_AUTOMATION,
  StampingJob,
} from "../../../lib/stamping-types";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "../../../lib/rate-limiter";

const ALLOWED_CATEGORIES = new Set<string>([
  "tenancy_agreement",
  "employment_contract",
  "other",
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit("intake", clientIp, RATE_LIMITS.intake);
  if (!rateCheck.allowed) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const category = formData.get("category");

    // ── Validate file ────────────────────────────────────────────────
    if (!file || !(file instanceof File)) {
      return Response.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return Response.json(
        { error: "Only PDF files are accepted." },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return Response.json({ error: "File is empty." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return Response.json(
        { error: "File exceeds the 20 MB limit. Please use a smaller PDF." },
        { status: 400 }
      );
    }

    // ── Validate category ────────────────────────────────────────────
    if (
      !category ||
      typeof category !== "string" ||
      !ALLOWED_CATEGORIES.has(category)
    ) {
      return Response.json(
        { error: "Invalid document category." },
        { status: 400 }
      );
    }

    // ── Persist file ─────────────────────────────────────────────────
    const id = crypto.randomUUID();
    const storedFileName = `${id}.pdf`;
    const storageKey = `uploads/${storedFileName}`;

    const bytes = await file.arrayBuffer();
    await blobStore.saveBlob(storageKey, Buffer.from(bytes));

    // ── Create intake record ─────────────────────────────────────────
    const now = new Date().toISOString();
    const docCategory = category as DocumentCategory;

    const receiptToken = crypto.randomBytes(24).toString("hex");

    const job: StampingJob = {
      id,
      originalFileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      documentCategory: docCategory,
      status: "uploaded",
      storagePath: storageKey,
      supportedForAutomation: SUPPORTED_FOR_AUTOMATION[docCategory],
      createdAt: now,
      updatedAt: now,
      receiptToken,
    };

    await createJob(job);

    return Response.json({ id, status: job.status, receiptToken });
  } catch (error) {
    console.error("Intake upload failed:", error);
    return Response.json(
      { error: "Upload failed. Please try again." },
      { status: 500 }
    );
  }
}
