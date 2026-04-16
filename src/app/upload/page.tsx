"use client";

/**
 * Upload Signed Document for Stamping
 *
 * Three-step intake flow:
 *   "upload"     — user selects a PDF file
 *   "review"     — user reviews file details and selects a document category
 *   "submitting" — file is being uploaded and record is being saved
 *
 * On success, the browser navigates to /receipt/[id]?token=... which shows
 * a safe public submission receipt.
 *
 * No OCR, extraction, LHDN submission, or payment in this milestone.
 */

import React, { useState, useRef } from "react";

type DocumentCategory = "tenancy_agreement" | "employment_contract" | "other";

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  tenancy_agreement: "Tenancy Agreement",
  employment_contract: "Employment Contract",
  other: "Other / Not Sure",
};

type View = "upload" | "review" | "submitting";

export default function UploadPage() {
  const [view, setView] = useState<View>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File selection ─────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.type !== "application/pdf") {
      setFileError("Only PDF files are accepted. Please select a PDF.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
  }

  function handleRemove() {
    setFile(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Submit to API ─────────────────────────────────────────────────

  async function handleSubmit() {
    if (!file || !category) return;
    setView("submitting");
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);

      const res = await fetch("/api/intake", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? "Upload failed. Please try again."
        );
      }

      const { id, receiptToken } = (await res.json()) as { id: string; receiptToken: string };
      window.location.href = `/receipt/${id}?token=${encodeURIComponent(receiptToken)}`;
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Upload failed. Please try again."
      );
      setView("review");
    }
  }

  // ── Step 1: Upload ─────────────────────────────────────────────────

  if (view === "upload") {
    return (
      <main>
        <a href="/" className="back-link">
          &larr; Back to Home
        </a>
        <h1>Upload Signed Document for Stamping</h1>
        <p className="upload-intro">
          Upload your signed document for LHDN stamping. Accepted format: PDF only.
        </p>

        <div className="upload-zone">
          <label htmlFor="upload-file" className="upload-zone-label">
            Choose PDF file
          </label>
          <input
            id="upload-file"
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="upload-file-input"
          />
          {file && (
            <div className="upload-file-selected">
              <span className="upload-file-name">{file.name}</span>
              <button
                type="button"
                className="upload-remove-btn"
                onClick={handleRemove}
              >
                Remove
              </button>
            </div>
          )}
          {fileError && <p className="field-error">{fileError}</p>}
        </div>

        <div className="upload-actions">
          <button
            type="button"
            onClick={() => setView("review")}
            disabled={!file}
          >
            Continue &rarr;
          </button>
        </div>
      </main>
    );
  }

  // ── Steps 2 + submitting: Review ───────────────────────────────────

  return (
    <main>
      <a href="/" className="back-link">
        &larr; Back to Home
      </a>
      <h1>Review Your Upload</h1>

      <div className="upload-review-card">
        <div className="upload-review-row">
          <span className="upload-review-label">File</span>
          <span className="upload-review-value">{file?.name}</span>
        </div>
        <div className="upload-review-row">
          <span className="upload-review-label">Format</span>
          <span className="upload-review-value">PDF</span>
        </div>
      </div>

      <div className="upload-category-section">
        <p className="upload-category-heading">Document category</p>
        {(
          Object.entries(CATEGORY_LABELS) as [DocumentCategory, string][]
        ).map(([val, label]) => (
          <label key={val} className="upload-category-option">
            <input
              type="radio"
              name="category"
              value={val}
              checked={category === val}
              onChange={() => setCategory(val)}
              disabled={view === "submitting"}
            />
            {label}
          </label>
        ))}
      </div>

      {submitError && (
        <p className="field-error" style={{ marginBottom: 12 }}>
          {submitError}
        </p>
      )}

      <div className="upload-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setView("upload");
            setSubmitError(null);
          }}
          disabled={view === "submitting"}
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!category || view === "submitting"}
        >
          {view === "submitting" ? "Saving\u2026" : "Confirm \u2192"}
        </button>
      </div>
    </main>
  );
}
