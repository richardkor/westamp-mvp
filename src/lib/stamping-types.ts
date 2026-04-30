/**
 * WeStamp — Stamping Intake / Job Types
 *
 * Data model for uploaded signed documents awaiting LHDN stamping.
 * This is the minimal backbone for the upload-for-stamping flow.
 *
 * Extraction, automation, LHDN submission, and payment are NOT implemented here.
 * This file defines the model only.
 */

// ─── Document Category ────────────────────────────────────────────────

export type DocumentCategory =
  | "tenancy_agreement"
  | "employment_contract"
  | "statutory_declaration"
  | "other";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  tenancy_agreement: "Tenancy Agreement",
  employment_contract: "Employment Contract",
  statutory_declaration: "Statutory Declaration",
  other: "Other / Not Sure",
};

/**
 * Whether a category has a planned automation path in a future milestone.
 * Used only for internal routing scaffolding.
 * NOT shown to users as a promise.
 */
export const SUPPORTED_FOR_AUTOMATION: Record<DocumentCategory, boolean> = {
  tenancy_agreement: true,
  employment_contract: false,
  // Statutory declarations are handled via the nominal-duty assisted
  // operator path. No automation — the duty/submission/payment/certificate
  // flow does not run for this category.
  statutory_declaration: false,
  other: false,
};

// ─── Stamping Job Status ──────────────────────────────────────────────

export type StampingJobStatus =
  | "uploaded"
  | "intake_reviewed"
  | "prepared"
  | "ready_for_submission"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "manual_review_required";

export const STAMPING_JOB_STATUS_LABELS: Record<StampingJobStatus, string> = {
  uploaded: "Uploaded",
  intake_reviewed: "Stamping Details Saved",
  prepared: "Stamping Preparation Saved",
  ready_for_submission: "Ready for Next Step",
  submitted: "Submitted",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  manual_review_required: "Manual Review Required",
};

// ─── Job Events ──────────────────────────────────────────────────────

/** Lightweight event types for workflow history. */
export type JobEventType =
  | "document_uploaded"
  | "intake_saved"
  | "stamping_details_saved"
  | "preparation_completed"
  | "marked_ready_for_submission"
  | "transition_blocked"
  | "validation_failed"
  | "status_changed"
  | "moved_to_manual_review"
  | "moved_to_failed"
  | "submission_payload_drafted"
  | "execution_attempt_initialized"
  | "extraction_completed"
  | "extraction_suggestions_applied"
  | "tenancy_inputs_confirmed"
  | "tenancy_preparation_marked_ready"
  | "tenancy_preparation_readiness_invalidated"
  | "routing_suggestion_saved"
  | "portal_draft_created"
  | "portal_draft_updated"
  | "portal_draft_marked_ready_for_review"
  | "automation_plan_created"
  | "automation_plan_updated"
  | "dry_run_created"
  | "dry_run_updated"
  | "browser_instructions_compiled"
  | "browser_instructions_updated"
  | "mock_execution_created"
  | "mock_execution_updated"
  | "assertion_evaluation_created"
  | "assertion_evaluation_updated"
  | "portal_probe_completed"
  | "portal_probe_failed"
  | "save_preflight_evaluated"
  | "save_authorization_issued"
  | "save_authorization_revoked"
  | "save_authorization_evaluated"
  | "save_attempt_completed"
  | "save_attempt_failed"
  | "save_attempt_blocked"
  | "post_save_reconciliation_evaluated"
  | "next_tab_preflight_evaluated"
  | "next_tab_authorization_issued"
  | "next_tab_authorization_revoked"
  | "next_tab_authorization_evaluated"
  | "next_tab_attempt_completed"
  | "next_tab_attempt_failed"
  | "next_tab_attempt_blocked"
  | "bahagian_a_grounding_completed"
  | "bahagian_a_grounding_failed"
  | "bahagian_a_fill_preflight_evaluated"
  | "bahagian_a_fill_authorization_issued"
  | "bahagian_a_fill_authorization_revoked"
  | "bahagian_a_fill_authorization_evaluated"
  | "bahagian_a_fill_attempt_completed"
  | "bahagian_a_fill_attempt_failed"
  | "bahagian_a_fill_attempt_blocked"
  | "bahagian_a_post_fill_reconciliation_evaluated"
  | "bahagian_a_next_field_preflight_evaluated"
  | "submission_readiness_evaluated"
  | "preparation_inputs_updated"
  | "execution_preview_compiled"
  | "stsds_state_refreshed"
  | "adjudication_number_recorded"
  | "payment_marked_awaiting"
  | "payment_marked_done"
  | "certificate_marked_waiting"
  | "certificate_marked_retrieved"
  | "delivered"
  // Nominal-duty internal lifecycle transitions (operator-driven,
  // category-scoped; see `src/lib/nominal-duty-lifecycle.ts`).
  | "nominal_duty_state_changed"
  // Soft-archive lifecycle. Both transitions are operator-driven and
  // do NOT delete records or files. Presence of `archivedAt` on the
  // job record is the source of truth for "archived"; these events
  // record the audit trail of when archive/restore happened and why.
  | "job_archived"
  | "job_restored"
  // Tenancy portal-required-details capture. Internal operator action
  // that updates the structured `tenancyPortalDetails` block used to
  // close the e-Duti Setem Sewa/Pajakan data gap. Does NOT touch the
  // portal, payment, or fulfilment.
  | "tenancy_portal_details_updated"
  // Tenancy supervised-run session lifecycle (Milestone B6). Internal
  // operator-driven; both events are recorded by routes under
  // `/api/intake/[id]/supervised-run/`. Neither event implies any
  // e-Duti Setem portal action — they describe WeStamp's internal
  // readiness to begin a future supervised portal run.
  | "supervised_run_prepared"
  | "supervised_run_first_mutation_approved"
  // Tenancy supervised-run · Phase 2 Maklumat Am executor outcomes
  // (Milestone B7). The "saved" event is appended ONLY when the
  // controlled executor successfully fills the Maklumat Am fields
  // and clicks Simpan Maklumat Am, AND the post-save URL classifier
  // confirms the page remains on the Sewa/Pajakan p5 form. The
  // "failed" event records a sanitized failure reason code; no
  // portal text, no URL, no exception stack is stored.
  | "supervised_run_phase_2_maklumat_am_saved"
  | "supervised_run_phase_2_maklumat_am_failed";

export interface JobEvent {
  /** Event type identifier. */
  type: JobEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Optional human-readable note. */
  note?: string;
}

// ─── Stamping Fulfilment State ───────────────────────────────────────

/**
 * Internal operational tracking for payment and certificate collection.
 *
 * This is WeStamp's internal state — NOT automated payment execution
 * or automated certificate retrieval. An operator manually marks these
 * states as they progress through the human-in-the-loop stamping flow.
 */

export type PaymentStatus =
  | "not_applicable"
  | "not_ready"
  | "awaiting_payment"
  | "payment_marked_done";

export type CertificateStatus =
  | "not_ready"
  | "waiting_for_certificate"
  | "certificate_retrieved";

export interface StampingFulfilmentState {
  /** Portal adjudication number, if captured. */
  adjudicationNumber: string | null;
  /** Current payment status. */
  paymentStatus: PaymentStatus;
  /** How payment was made, if known (e.g., "FPX", "manual", "counter"). */
  paymentMethod: string | null;
  /** When payment was marked done by operator. */
  paymentMarkedAt: string | null;
  /** Operator note about payment. */
  paymentNote: string | null;
  /** Bank / FPX / batch payment reference for tracing. Optional. */
  paymentReference: string | null;
  /** Current certificate status. */
  certificateStatus: CertificateStatus;
  /** When certificate was marked as retrieved. */
  certificateRetrievedAt: string | null;
  /** Certificate file name, if downloaded/stored. */
  certificateFileName: string | null;
  /** Certificate storage path, if stored locally. */
  certificateStoragePath: string | null;
  /** Whether the job has been internally marked as delivered. */
  delivered: boolean;
  /** When the job was marked delivered by operator. */
  deliveredAt: string | null;
  /** Last time any fulfilment field was updated. */
  lastFulfilmentUpdateAt: string;
}

// ─── Job Artifacts ───────────────────────────────────────────────────

/**
 * Placeholder structure for final output artifacts.
 * Only originalDocument is populated now. The others are null
 * placeholders for future certificate retrieval and PDF bundling.
 */
export interface JobArtifacts {
  /** Reference to the uploaded signed document. */
  originalDocument: {
    fileName: string;
    storagePath: string;
    mimeType: string;
  } | null;
  /** Future: LHDN stamp certificate after submission. */
  stampCertificate: {
    fileName: string;
    storagePath: string;
    retrievedAt: string;
  } | null;
  /** Future: combined output (original + certificate). */
  finalPackage: {
    fileName: string;
    storagePath: string;
    generatedAt: string;
  } | null;
}

// ─── Extraction Confidence ───────────────────────────────────────────

/**
 * Coarse confidence tier for an extracted field.
 *
 * - high: strong keyword context + clean value (e.g. "monthly rental of RM 1,500")
 * - medium: weaker context or ambiguous phrasing
 * - low: value found but context is uncertain
 *
 * These are pattern-strength indicators, NOT probabilistic scores.
 */
export type ExtractionConfidence = "high" | "medium" | "low";

/**
 * A single suggested field extracted from a PDF.
 * null value means the field was not found.
 */
export interface ExtractedField<T> {
  /** The suggested value, or null if not found. */
  value: T | null;
  /** Confidence tier based on pattern match strength. */
  confidence: ExtractionConfidence | null;
  /** What extraction method produced this value. */
  source: "pdf_text_pattern" | "ocr_unverified" | null;
  /** Optional note about which pattern matched. */
  matchNote?: string;
}

// ─── Tenancy Extraction Result ───────────────────────────────────────

/**
 * Result of attempting to extract tenancy details from an uploaded PDF.
 *
 * All values are SUGGESTIONS only — unverified and potentially wrong.
 * The user must review and confirm before they become stampingDetails.
 */
export interface TenancyExtractionResult {
  /** ISO 8601 timestamp of when extraction was performed. */
  extractedAt: string;
  /**
   * Provenance marker for the extraction method used.
   * "pdf_parsed_unverified" — text layer was parsed.
   * "ocr_unverified" — OCR was attempted (text layer yielded no fields).
   */
  dataSource: "pdf_parsed_unverified" | "ocr_unverified";
  /** Suggested monthly rent in RM. */
  suggestedMonthlyRent: ExtractedField<number>;
  /** Suggested lease duration in months. */
  suggestedLeaseMonths: ExtractedField<number>;
  /** Suggested agreement/contract date string (YYYY-MM-DD). */
  suggestedAgreementDate: ExtractedField<string>;
  /** Number of fields that were successfully extracted. */
  fieldsExtracted: number;
  /** Total text length extracted from the PDF (for diagnostic purposes). */
  textLengthChars: number;
  /**
   * Whether OCR was attempted for this extraction.
   * true = text-layer yielded no fields; OCR was tried as fallback.
   * false or absent = text-layer was sufficient; OCR was not attempted.
   */
  ocrAttempted?: boolean;
  /**
   * Whether OCR was needed but unavailable in the runtime environment.
   * true = OCR was attempted but gs/tesseract binaries are missing.
   * absent or false = OCR was not attempted, or OCR binaries were available.
   *
   * When ocrAttempted is true and ocrUnavailable is true, extraction could
   * not fall back to OCR — this is distinct from "OCR ran but found nothing."
   */
  ocrUnavailable?: boolean;
}

// ─── Confirmed Tenancy Inputs (operator-review layer) ────────────────

/**
 * Narrow per-field provenance marker for operator-confirmed tenancy inputs.
 *
 * - "extraction_confirmed" — operator accepted the extracted suggestion unchanged
 * - "operator_override"    — operator changed the value from the extracted suggestion
 * - "operator_entered"     — operator provided a value where no suggestion existed
 */
export type ConfirmedTenancyInputSource =
  | "extraction_confirmed"
  | "operator_override"
  | "operator_entered";

/**
 * Overall review state for a tenancy job's extracted-inputs review step.
 *
 * - "not_reviewed"          — no confirmedTenancyInputs record yet
 * - "reviewed_confirmed"    — operator accepted all present values unchanged
 * - "reviewed_overridden"   — operator corrected at least one value
 */
export type TenancyReviewStatus =
  | "not_reviewed"
  | "reviewed_confirmed"
  | "reviewed_overridden";

/**
 * Operator-confirmed tenancy preparation inputs.
 *
 * Persisted separately from extractionResult, stampingDetails, portalDraft,
 * and submissionPayload. Represents the review layer where an operator
 * confirms or overrides extraction suggestions before downstream draft /
 * readiness logic consumes them.
 *
 * All three value fields are nullable — the operator may confirm only a
 * subset of fields (e.g. rent/months but not date).
 */
export interface ConfirmedTenancyInputs {
  /** ISO 8601 timestamp of the confirm/override action. */
  confirmedAt: string;
  /** Whole-record review state. */
  reviewStatus: "reviewed_confirmed" | "reviewed_overridden";
  /** Confirmed monthly rent in RM, or null if not confirmed. */
  confirmedMonthlyRent: number | null;
  /** Confirmed lease duration in months, or null. */
  confirmedLeaseMonths: number | null;
  /** Confirmed agreement date (YYYY-MM-DD), or null. */
  confirmedAgreementDate: string | null;
  /** Per-field provenance. null where the corresponding field was not confirmed. */
  confirmedBySource: {
    monthlyRent: ConfirmedTenancyInputSource | null;
    leaseMonths: ConfirmedTenancyInputSource | null;
    agreementDate: ConfirmedTenancyInputSource | null;
  };
}

// ─── Tenancy Preparation Readiness (internal status) ─────────────────

/**
 * Narrow internal flag that the operator has explicitly marked a
 * tenancy job as "Preparation review complete" — i.e. the internal
 * preparation stack (extraction review → confirmed inputs → canonical
 * resolver → portal draft) has been reviewed and is internally ready
 * for the next preparation step.
 *
 * This is NOT a submission status, NOT a portal transaction, and does
 * NOT imply any external system has accepted, validated, or received
 * anything. It is a WeStamp-internal workflow marker only.
 *
 * Absent until the operator explicitly marks the job ready.
 */
export interface TenancyPreparationReadiness {
  /** ISO 8601 timestamp of the operator mark-ready action. */
  markedReadyAt: string;
  /**
   * Provenance of the mark-ready action. Only "operator_marked" is
   * supported in this pass; no automated path exists.
   */
  source: "operator_marked";
  /**
   * Snapshot of the internal basis at the moment the operator marked
   * the job ready — captured so the event log stays auditable even if
   * later state changes reshape the job.
   */
  basis: {
    /** Whether an extractionResult existed at mark time. */
    hasExtraction: boolean;
    /** Whether confirmedTenancyInputs existed at mark time. */
    hasConfirmedInputs: boolean;
    /** Review status of the confirmed inputs at mark time. */
    reviewStatus: "reviewed_confirmed" | "reviewed_overridden";
  };
}

// ─── Field Provenance ────────────────────────────────────────────────

/**
 * How a stamping detail field got its value.
 *
 * - user_entered: typed manually by the user
 * - extracted_applied: applied from PDF extraction suggestions
 * - extracted_applied_then_edited: applied from extraction, then user modified
 */
export type FieldSource =
  | "user_entered"
  | "extracted_applied"
  | "extracted_applied_then_edited";

/**
 * Lean provenance record for stamping detail fields.
 * Only populated for rent and lease months — the fields that
 * extraction can currently suggest.
 */
export interface FieldProvenance {
  monthlyRent: FieldSource;
  leaseMonths: FieldSource;
}

// ─── Stamping Details (tenancy agreements only) ──────────────────────

/**
 * User-provided stamping details and the resulting duty calculation.
 * Populated only for tenancy-agreement records after the user provides
 * rent, duration, and duplicate-copy count.
 */
export interface StampingDetails {
  /** Monthly rent in RM (as entered by user). */
  monthlyRent: number;
  /** Lease duration in months. */
  leaseMonths: number;
  /** Number of duplicate copies for stamping. */
  duplicateCopies: number;
  /** Duty calculation result from the existing calculator. */
  calculatedDuty: {
    baseDuty: number;
    duplicateCopyTotal: number;
    totalDuty: number;
    rateTierLabel: string;
  };
  /**
   * Optional tenancy structure flags indicating conditions outside the
   * supported straight-through workflow. Mirrors UnsupportedStructureFlags
   * from duty-calculator.ts. When any flag is true, the job is routed
   * to manual_review_required instead of proceeding.
   */
  structureFlags?: {
    hasPremiumOrFine?: boolean;
    hasVariableRent?: boolean;
    isMixedUse?: boolean;
    isPeriodicOrIndefinite?: boolean;
    hasBundledCharges?: boolean;
    hasUnusualConsideration?: boolean;
  };
  /** If the calculator returned manual_review, the reason is stored here. */
  manualReviewReason?: string;
  /**
   * Lean provenance tracking for rent and lease months.
   * Records whether these values came from manual entry, extraction
   * suggestions, or extraction suggestions that were later edited.
   * Only populated when extraction results were available at input time.
   */
  fieldProvenance?: FieldProvenance;
}

// ─── Preparation Snapshot ─────────────────────────────────────────────

/**
 * Normalized snapshot created at preparation time.
 * Freezes all user-entered details and the duty calculation into the
 * shape that a future STSDS / MyTax submission module would consume.
 *
 * dataSource is always "user_entered_unverified" — the values were
 * typed in by the user, NOT extracted from or verified against the
 * uploaded PDF.
 */
export interface PreparationSnapshot {
  /** ISO 8601 timestamp of when preparation was created. */
  preparedAt: string;
  /** Document category — always "tenancy_agreement" for now. */
  documentCategory: "tenancy_agreement";
  /** Reference to the uploaded signed document. */
  uploadedFile: {
    originalFileName: string;
    storagePath: string;
  };
  /** Tenancy details as entered by the user. */
  tenancyDetails: {
    monthlyRent: number;
    leaseMonths: number;
    duplicateCopies: number;
  };
  /** Duty calculation derived from user-entered values. */
  dutyCalculation: {
    baseDuty: number;
    duplicateCopyTotal: number;
    totalDuty: number;
    rateTierLabel: string;
  };
  /** Explicit provenance: data is user-entered and unverified. */
  dataSource: "user_entered_unverified";
}

// ─── Submission Payload Draft ─────────────────────────────────────────

/**
 * Machine-readable payload draft for a supported tenancy-agreement job
 * in the ready_for_submission state.
 *
 * Intended for future consumption by STSDS / MyTax submission code.
 * Does NOT represent a live submission — payloadStatus is always "draft".
 *
 * Contains only data WeStamp currently captures and can vouch for.
 * Fields that STSDS will eventually require but WeStamp does not yet
 * capture (e.g. party names, NRIC, property address) are NOT included.
 */
export interface SubmissionPayloadDraft {
  /** Always "draft" — this payload has not been submitted to STSDS. */
  payloadStatus: "draft";
  /** ISO 8601 timestamp of when this draft was created. */
  draftedAt: string;
  /** Internal WeStamp job reference. */
  internalJobId: string;
  /** Document category — always "tenancy_agreement" for this payload. */
  documentCategory: "tenancy_agreement";
  /** Reference to the uploaded signed document. */
  uploadedFile: {
    originalFileName: string;
    storagePath: string;
    mimeType: string;
    fileSizeBytes: number;
  };
  /** Tenancy details as entered by the user (from preparation snapshot). */
  tenancyDetails: {
    monthlyRent: number;
    leaseMonths: number;
    duplicateCopies: number;
  };
  /** Stamp duty calculation derived from user-entered tenancy details. */
  dutyCalculation: {
    baseDuty: number;
    duplicateCopyTotal: number;
    totalDuty: number;
    rateTierLabel: string;
  };
  /**
   * Explicit provenance: all values are user-entered and unverified
   * against the uploaded PDF.
   */
  dataSource: "user_entered_unverified";
  /** ISO 8601 timestamp of when preparation was completed. */
  preparedAt: string;
}

// ─── Execution Attempt Placeholder ───────────────────────────────────

/**
 * Internal placeholder for a future STSDS execution attempt.
 *
 * This is NOT a real submission to STSDS. It is a pre-integration
 * structure that reserves the slot for future execution code.
 *
 * attemptStatus is always "not_enabled" until live STSDS integration
 * is built in a future milestone.
 */
export interface ExecutionAttempt {
  /** Unique attempt identifier. */
  attemptId: string;
  /** ISO 8601 timestamp of when this placeholder was created. */
  createdAt: string;
  /**
   * Always "not_enabled" — real STSDS execution is not yet available.
   * Future milestones will introduce additional statuses.
   */
  attemptStatus: "not_enabled";
  /** Internal reference to the submission payload this attempt is based on. */
  payloadJobId: string;
  /** Human-readable note clarifying this is a placeholder only. */
  note: string;
}

// ─── Tenancy Portal Required Details (Sewa/Pajakan) ───────────────────

/**
 * Structured capture of the tenancy-specific e-Duti Setem (Sewa/Pajakan)
 * portal fields that the live portal requires for submission.
 *
 * Scope notes
 * ───────────
 * - Captures only fields that the portal observably requires or that
 *   are submission-blocking per recorded gate-chain evidence.
 * - Intentionally OMITS: landlord/tenant email; signed-in-Malaysia /
 *   signed-outside-Malaysia status; received-in-Malaysia date. These
 *   are not required by the portal at the present level of evidence
 *   and are deliberately left out of this milestone.
 * - This is INTERNAL operator-captured data. It is not surfaced on the
 *   public receipt and does not feed `derivePublicStatus`.
 * - Saving this block is an operator-only action via
 *   `POST /api/intake/[id]/tenancy-portal-details`.
 */

/**
 * Whether a party is an individual or a registered/non-registered
 * business entity. The portal asks operators to pick one; the choice
 * affects which identity field is required.
 */
export type TenancyPortalPartyType =
  | "individual"
  | "company_ssm"
  | "company_non_ssm";

/** Party role: which side of the tenancy this party occupies. */
export type TenancyPortalPartyRole = "landlord" | "tenant";

/**
 * Identity document type used by the portal. NRIC for Malaysian
 * individuals, passport for non-Malaysian individuals, company
 * registration number for companies.
 */
export type TenancyPortalIdentityType =
  | "nric"
  | "passport"
  | "company_registration";

/**
 * Nationality status — only meaningful for `type === "individual"`.
 * Companies use registration jurisdiction separately.
 *
 * NOTE: kept for backwards compatibility with already-persisted job
 * data, but it is NO LONGER the source of truth for portal identity.
 * The portal asks a 3-way question — see `TenancyPortalCitizenshipCategory`
 * and `TenancyPortalParty.citizenshipCategory` below. WeStamp must
 * NEVER infer `citizenshipCategory` from this `nationality` value.
 */
export type TenancyPortalNationality = "malaysian" | "non_malaysian";

/**
 * Bahagian A · party citizenship — `warga` portal field.
 *
 * Field-mapping evidence (ε-3 run, 2026-04-28): the portal's `warga`
 * is a 3-way enum with options `1=Citizen`, `2=Non-citizen`,
 * `3=Permanent Resident`. WeStamp's earlier 2-way `nationality` could
 * not represent PR; this enum is the new source of truth for
 * Bahagian A identity readiness.
 *
 * Operator capture is REQUIRED for individual parties and for the
 * SSM company representative. Never inferred from `nationality`,
 * `country`, or any other field.
 */
export type TenancyPortalCitizenshipCategory =
  | "citizen"
  | "non_citizen"
  | "permanent_resident";

/**
 * Bahagian A · NRIC sub-type — `EPD_NOKP_TYPE` portal field.
 *
 * Field-mapping evidence: the portal's NRIC entry has a sub-type
 * dropdown with four observed values:
 *   - "ic_baru"  ≈ portal IC_BARU  (post-1990 standard NRIC)
 *   - "ic_lama"  ≈ portal IC_LAMA  (pre-1990 NRIC)
 *   - "ic_polis" ≈ portal IC_POLIS (Polis ID)
 *   - "ic_army"  ≈ portal IC_ARMY  (Tentera ID)
 *
 * Required only when `identityType === "nric"`. Never inferred from
 * the IC number's format or content — the operator must select.
 */
export type TenancyPortalNricSubType =
  | "ic_baru"
  | "ic_lama"
  | "ic_polis"
  | "ic_army";

/**
 * Bahagian A · gender — `USER_SEX` portal field.
 *
 * Required by the portal for natural-person identity capture (every
 * `type === "individual"` party AND the SSM company representative).
 * Operator-set; never inferred from name or IC number.
 *
 * "unknown" / "unspecified" is intentionally NOT a value — the
 * portal expects one of two. If the operator does not know, the
 * field stays absent and readiness blocks.
 */
export type TenancyPortalGender = "male" | "female";

/**
 * Bahagian A · SSM company business type — `jenis_perniagaan` portal
 * field. Field-mapping run observed 6 options but did NOT enumerate
 * the codes / labels. Captured-select shape: operator types the
 * portal `<option value>` code; an optional human label is allowed.
 */
export interface TenancyPortalBusinessType {
  /** Portal `<option value>` code. Required when supplied. */
  code: string;
  /** Operator-supplied portal label. Optional. */
  label?: string;
}

/**
 * Bahagian A · company locality — `tb_syarikat` portal field.
 * Local vs foreign company. Field-mapping observed two values; codes
 * not enumerated. Operator-set; NEVER inferred from `country`.
 */
export type TenancyPortalCompanyLocality =
  | "local_company"
  | "foreign_company";

/**
 * Bahagian A · SSM company representative identity sub-block.
 *
 * Field-mapping evidence: the portal's SSM "Tambah" modal captures
 * full representative-person identity in addition to the company
 * entity itself — `owner_name` plus the natural-person identity
 * fields (citizenship, IC type, IC/passport, gender). WeStamp models
 * these here so a `company_ssm` party can be ready for portal
 * preparation only when both the entity AND the representative are
 * captured.
 *
 * Every field is optional in the persisted shape so partial saves
 * don't silently discard typed values; readiness blocks until all
 * required fields are present.
 */
export interface TenancyPortalCompanyRepresentative {
  /** Portal field: `owner_name`. Free text. */
  ownerName?: string;
  /** Portal field: `warga` for the representative. */
  citizenshipCategory?: TenancyPortalCitizenshipCategory;
  /** Identity document type for the representative. */
  identityType?: TenancyPortalIdentityType;
  /** Identity number value. */
  identityNumber?: string;
  /** Portal field: `EPD_NOKP_TYPE`. Required only when identityType === "nric". */
  nricSubType?: TenancyPortalNricSubType;
  /** Portal field: `USER_SEX`. */
  gender?: TenancyPortalGender;
  /**
   * Optional nationality status for the representative. Surfaced for
   * parity with individual parties; not used to infer
   * citizenshipCategory.
   */
  nationality?: TenancyPortalNationality | null;
}

/**
 * Single landlord or tenant record. The data model supports any number
 * of landlords and any number of tenants — the operator panel renders
 * the parties array dynamically.
 */
export interface TenancyPortalParty {
  /** Landlord or tenant. */
  role: TenancyPortalPartyRole;
  /** Individual / SSM-registered entity / non-SSM entity. */
  type: TenancyPortalPartyType;
  /** Name as written on the instrument. Free text. */
  nameAsPerInstrument: string;
  /**
   * Legacy nationality flag (pre-A4). Kept for backwards
   * compatibility. NEVER used to infer `citizenshipCategory`.
   * Only meaningful when `type === "individual"`. Null for companies.
   */
  nationality?: TenancyPortalNationality | null;
  /**
   * Bahagian A · `warga` (3-way citizenship — Milestone A4). Required
   * for individual parties. The SSM company representative carries
   * its own `citizenshipCategory` under `companyRepresentative`.
   */
  citizenshipCategory?: TenancyPortalCitizenshipCategory;
  /** NRIC / passport / company registration number type. */
  identityType?: TenancyPortalIdentityType;
  /** Identity number value. Operator-entered. */
  identityNumber?: string;
  /**
   * Bahagian A · `EPD_NOKP_TYPE` (NRIC sub-type — Milestone A4).
   * Required when `identityType === "nric"`.
   */
  nricSubType?: TenancyPortalNricSubType;
  /**
   * Bahagian A · `USER_SEX` (gender — Milestone A4). Required for
   * individual parties.
   */
  gender?: TenancyPortalGender;
  /**
   * Tax Identification Number (TIN), if known. The portal MAY auto-
   * generate a TIN after identity number entry — in that case operators
   * leave this field blank and set `tinAutoGenerationExpected = true`.
   * NEVER fabricate a TIN.
   */
  tin?: string;
  /**
   * Internal hint that the portal is expected to auto-generate the
   * TIN once the identity number is entered. Not a stored portal
   * value. Operator-set.
   */
  tinAutoGenerationExpected?: boolean;
  /** First line of mailing address. */
  addressLine1: string;
  /** Optional second line. */
  addressLine2?: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
  /** Mobile / contact number. Required by the portal. */
  mobile: string;
  /** Optional landline. */
  phone?: string;
  /**
   * Bahagian A · `tb_roc` — old / pre-2017 ROC company registration
   * number. Required for `company_ssm` parties (Milestone A4). The
   * portal exposes BOTH old and new ROC fields and operators must
   * supply at least one. WeStamp NEVER fabricates one from the other.
   */
  rocOld?: string;
  /**
   * Bahagian A · `tb_roc_new` — new / post-2017 ROC company
   * registration number. Same partial-save rules as `rocOld`.
   */
  rocNew?: string;
  /**
   * Bahagian A · `jenis_perniagaan` (SSM business type — Milestone A4).
   * Captured-select; portal codes not yet observed. Required for
   * `company_ssm`.
   */
  businessType?: TenancyPortalBusinessType;
  /**
   * Bahagian A · `tb_syarikat` (company locality — Milestone A4).
   * Required for `company_ssm`. Operator-set; NEVER inferred from
   * the party's `country` field.
   */
  companyLocality?: TenancyPortalCompanyLocality;
  /**
   * Bahagian A · SSM company representative identity sub-block
   * (Milestone A4). Required for `company_ssm` parties. The
   * representative is the natural person whose identity the portal
   * captures alongside the company entity in the SSM "Tambah" modal.
   */
  companyRepresentative?: TenancyPortalCompanyRepresentative;
  /** Optional internal operator note about this party. */
  operatorNote?: string;
}

/**
 * Bahagian B · Section 1 — Nama Surat Cara (`pds_suratcara`).
 *
 * The portal's "Nama Surat Cara" dropdown identifies the *name* of
 * the instrument and is REQUIRED at Hantar gate 1 (proven by the
 * Apr 2026 live walk; see `src/lib/sewa-pajakan-gate-chain.ts`).
 *
 * IMPORTANT: this field is DISTINCT from `pds_jenis` (Jenis Surat
 * Cara / description sub-type). Both are required at Hantar gate 1
 * and pds_jenis options are NOT cascade-populated from pds_suratcara
 * (live-walk evidence: 7 static options pre- and post-pds_suratcara
 * select).
 *
 * Today only one value is documented from repo evidence:
 *   1101 / "Perjanjian Sewa"
 * — accepted at the live walk, recorded in `stsds-lane-knowledge.ts`.
 * Additional codes will be added as further live-walk evidence is
 * captured. We do NOT invent codes.
 */
export type TenancyPortalInstrumentNameCode = "1101";

/**
 * Operator-captured pds_suratcara value. The model only stores the
 * code + label pair; the portal field key and Bahasa Malaysia label
 * are constants, surfaced by the payload compiler / instruction
 * draft so consumers don't redefine them.
 */
export interface TenancyPortalInstrumentName {
  /** Stable portal value code (e.g. "1101"). */
  code: TenancyPortalInstrumentNameCode;
  /** Operator-facing label for the selected code (e.g. "Perjanjian Sewa"). */
  label: string;
}

/**
 * Bahagian B · Section 3 — Diskripsi Surat Cara (`pds_jenis`).
 *
 * The e-Duti Setem Sewa/Pajakan portal exposes this as a static
 * dropdown that does NOT auto-populate from the previous instrument-
 * type selection. Six values are encoded here from observed portal
 * evidence; a seventh option exists in the portal but its exact
 * label has not been recorded — when an operator captures it, it
 * can be added without breaking the model.
 *
 * Mapping notes
 * ─────────────
 * - `fixed_rent_during_tenancy`        — Perjanjian Sewa / Pajakan ·
 *                                        Bayaran Sewa Tetap Dalam
 *                                        Tempoh Penyewaan. Single
 *                                        rent across the tenancy.
 * - `variable_rent_during_tenancy`     — Perjanjian Sewa / Pajakan ·
 *                                        Bayaran Sewa Berbeza Dalam
 *                                        Tempoh Penyewaan. Different
 *                                        rent across periods.
 * - `amendment_to_original_tenancy`    — Perjanjian Sewa / Pajakan ·
 *                                        Terdapat Pindaan Ke Atas
 *                                        Perjanjian Sewa / Pajakan
 *                                        Yang Asal.
 * - `other_item_49f`                   — Lain-lain (BUTIRAN 49(f),
 *                                        Jadual Pertama Akta Setem
 *                                        1949).
 * - `premium_only`                     — Premium atau balasan sahaja.
 * - `crop_share_only`                  — Nisbah hasil tanaman sahaja.
 *
 * Of these, only the first two are currently representable by the
 * standard `rentSchedule` shape. The remaining four require
 * substantively different data (premium amount, crop share ratio,
 * amendment reference) that this milestone does NOT model. They are
 * accepted here so operators can record the actual portal selection,
 * but the readiness evaluator marks any job with one of those four
 * values as not supported by current automation — the operator must
 * handle stamping outside the assisted path until the model is
 * extended.
 */
export type TenancyPortalDescriptionType =
  | "fixed_rent_during_tenancy"
  | "variable_rent_during_tenancy"
  | "amendment_to_original_tenancy"
  | "other_item_49f"
  | "premium_only"
  | "crop_share_only";

/**
 * One row of the rent schedule. For a fixed-rent tenancy, the array
 * contains a single entry whose `startDate`/`endDate` covers the
 * whole instrument. For a variable-rent tenancy, multiple entries
 * cover successive periods.
 */
export interface TenancyPortalRentPeriod {
  /** ISO 8601 yyyy-mm-dd. */
  startDate: string;
  /** ISO 8601 yyyy-mm-dd. */
  endDate: string;
  /** Monthly rent in RM for this period. */
  monthlyRent: number;
  /** Operator-entered or derived. Optional. */
  durationMonths?: number;
}

/**
 * Bahagian B — Instrument and rent details. Excludes signed-in-MY /
 * received-in-MY at this milestone (deliberate per scope guardrails).
 */
export interface TenancyPortalInstrument {
  /** Tarikh Surat Cara. ISO 8601 yyyy-mm-dd. */
  instrumentDate: string;
  /** Number of duplicate copies for stamping. >= 0. */
  duplicateCopies: number;
  /**
   * Bahagian B · Section 1 — Nama Surat Cara (`pds_suratcara`).
   * Operator-confirmed instrument name. Required at Hantar gate 1.
   * Distinct from `portalDescriptionType` (pds_jenis) below — both
   * must be set independently. Optional in the persisted shape so
   * legacy / partially-captured jobs remain valid; required by the
   * readiness evaluator before automation can be deemed ready.
   */
  portalInstrumentName?: TenancyPortalInstrumentName;
  /**
   * Bahagian B · Section 3 — Diskripsi Surat Cara (`pds_jenis`).
   * Operator-selected from a fixed list of observed portal options.
   * The readiness evaluator uses this value to decide whether the
   * `rentSchedule` shape is appropriate (fixed = one row,
   * variable = multiple rows) or whether the job is outside the
   * supported automation path (amendment / other-49f / premium-only /
   * crop-share-only).
   */
  portalDescriptionType: TenancyPortalDescriptionType;
  /**
   * Rent schedule rows. Length >= 1 when description type is
   * `fixed_rent_during_tenancy`; length >= 2 expected when
   * `variable_rent_during_tenancy`. Other description types do not
   * have a schedule shape supported by this model — see the
   * readiness evaluator for treatment.
   */
  rentSchedule: TenancyPortalRentPeriod[];
  /** Optional operator note about the instrument. */
  operatorNote?: string;
}

/**
 * Property type — Jenis Harta. Mirrors the four observed portal options
 * for tenancy. Other options can be added when more portal evidence is
 * recorded.
 */
export type TenancyPortalPropertyType =
  | "kediaman"
  | "perdagangan"
  | "perindustrian"
  | "tanah_kosong";

/**
 * Building type — Jenis Bangunan. Required when property type is
 * `kediaman`; conditional otherwise. Free string within a known set
 * so the model is extensible without code change.
 */
export type TenancyPortalBuildingType =
  | "rumah_teres"
  | "rumah_banglo"
  | "rumah_berkembar"
  | "rumah_kluster"
  | "townhouse"
  | "apartment"
  | "kondominium"
  | "studio"
  | "lain_lain";

/** Furnished status — Perabot. Optional unless portal requires it. */
export type TenancyPortalFurnishedStatus =
  | "fully_furnished"
  | "partially_furnished"
  | "unfurnished";

/**
 * Bahagian C · land-area unit (`pds_luasunit`).
 *
 * Observed during the 2026-04-28 ε-3 supervised field-mapping run
 * (see `docs/2026-04-28-tenancy-portal-field-mapping.md` §4.3). The
 * portal exposes a 5-option `<select>` with values 1–4 (option 0 is
 * the placeholder). Each WeStamp enum value is a stable internal
 * code; the portal numeric code lives in
 * `TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES` so future automation
 * can map to the portal value without re-deriving from labels.
 *
 *   - "ekar"   → portal code "1" — Ekar
 *   - "hektar" → portal code "2" — Hektar
 *   - "kps"    → portal code "3" — Kaki Persegi (square feet)
 *   - "mps"    → portal code "4" — Meter Persegi (square metres)
 */
export type TenancyPortalLandAreaUnit = "ekar" | "hektar" | "kps" | "mps";

/**
 * Mapping from WeStamp's stable enum to the portal `<option value>`
 * code observed for `pds_luasunit`. Kept here so the data-model file
 * is the single source of truth for portal value codes — the payload
 * compiler reads from this table; it does not redeclare its own.
 */
export const TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES: Record<
  TenancyPortalLandAreaUnit,
  "1" | "2" | "3" | "4"
> = {
  ekar: "1",
  hektar: "2",
  kps: "3",
  mps: "4",
};

/**
 * Operator-facing labels for `pds_luasunit`. These mirror the portal
 * labels observed during the field-mapping run — not translations
 * invented by WeStamp. Surfaced in the operator UI dropdown.
 */
export const TENANCY_PORTAL_LAND_AREA_UNIT_LABELS: Record<
  TenancyPortalLandAreaUnit,
  string
> = {
  ekar: "Ekar",
  hektar: "Hektar",
  kps: "Kaki Persegi (Kps)",
  mps: "Meter Persegi (Mps)",
};

/**
 * Bahagian C · land-registry sub-block (`pds_mp` / `pds_lot` /
 * `pds_mukim` / `pds_daerah` / `pds_luas` / `pds_luasunit` /
 * `pds_kegunaan`).
 *
 * These are the seven Bahagian C land-registry portal fields the
 * 2026-04-28 ε-3 field-mapping run proved required (six are
 * structurally required; `pds_kegunaan` is optional). They are
 * grouped under their own sub-object to:
 *
 *   1. Make it clear that they describe the *land registry* — these
 *      are facts pulled from the title / suratcara / land-office
 *      record, NOT facts about the physical premises (which are the
 *      address-level / built-up-area fields above).
 *   2. Keep `luas` (land area on title) physically separate from
 *      `premisesAreaSqm` (built-up / interior area on the surat
 *      cara). The two values are usually different and must NEVER be
 *      auto-substituted; the portal treats them as different fields.
 *
 * Portal-field-name mapping is documented inline so the future
 * payload compiler / automation step has a single source of truth.
 */
/**
 * Persisted shape for the Bahagian C land-registry sub-block.
 *
 * **Partial-save semantics (Milestone A1, post-review patch):** every
 * field is optional in *storage* even though six of the seven are
 * required by the portal. This is deliberate. The operator panel must
 * be able to persist whatever the operator has typed so far without
 * rejecting the entire save just because one required portal field
 * is still blank. Otherwise typed values would be lost on page reload
 * — silent data loss that the field-mapping safety-correction
 * milestone explicitly forbids.
 *
 * The completeness check (which portal fields are missing / invalid)
 * lives in the readiness gate, NOT in this type. Readiness blockers
 * keep firing until every required field is captured and valid; the
 * payload compiler reports `captured: false` until then. So a partial
 * save is safe: it persists, it shows up on reload, and the run
 * remains "Not ready for supervised portal run" until the operator
 * fills the remaining fields.
 *
 * The validator rejects MALFORMED values (e.g. `luas: -5`,
 * `luasUnit: "square_miles"`) but accepts MISSING values (omits them
 * from the persisted shape). This way the operator's mistakes are
 * surfaced, but their absence-of-input is not.
 */
export interface TenancyPortalLandRegistry {
  /**
   * Portal field: `pds_mp` ("Milik Penuh"). Free string captured
   * from the land-title document. The label `Milik Penuh` is the
   * exact portal label observed during the field-mapping run; we
   * deliberately do NOT reinterpret its legal meaning beyond that.
   *
   * Required by the portal. Optional in storage — see partial-save
   * note on the interface.
   */
  milikPenuh?: string;
  /**
   * Portal field: `pds_lot` (lot number / lot reference). Free text.
   * Required by the portal; optional in storage.
   */
  lot?: string;
  /**
   * Portal field: `pds_mukim` (mukim). Free text. Required by the
   * portal; optional in storage.
   */
  mukim?: string;
  /**
   * Portal field: `pds_daerah` (district / daerah). Free text.
   * Required by the portal; optional in storage.
   */
  daerah?: string;
  /**
   * Portal field: `pds_luas` (land area as recorded on the title).
   *
   * **IMPORTANT:** distinct from `TenancyPortalProperty.premisesAreaSqm`.
   * `premisesAreaSqm` is the built-up / interior area; `luas` is the
   * land-title area. WeStamp NEVER auto-fills one from the other.
   *
   * When present, must be a positive finite `number`. The unit is
   * captured separately in `luasUnit`. The validator rejects 0,
   * negative, or non-finite values; absence is allowed.
   */
  luas?: number;
  /**
   * Portal field: `pds_luasunit` (unit selector for `luas`).
   * Maps to portal codes 1–4 — see
   * `TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES`. Required by the
   * portal; optional in storage.
   */
  luasUnit?: TenancyPortalLandAreaUnit;
  /**
   * Portal field: `pds_kegunaan` (property usage description).
   *
   * Always optional. Field-mapping run did NOT prove this is required
   * at Hantar gate; treat as optional unless future portal evidence
   * proves otherwise.
   */
  kegunaan?: string;
}

/**
 * Bahagian C — Property details. Captures the address-level fields
 * proven necessary by the Apr 2026 gate-chain walk plus the property-
 * type / building-type / furnishing fields needed for sewa_pajakan.
 */
export interface TenancyPortalProperty {
  addressLine1: string;
  addressLine2?: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
  /** Jenis Harta. */
  propertyType: TenancyPortalPropertyType;
  /** Jenis Bangunan. Required when `propertyType === "kediaman"`. */
  buildingType?: TenancyPortalBuildingType;
  /** Perabot. */
  furnishedStatus?: TenancyPortalFurnishedStatus;
  /** Floor / level / lot label. Free text. */
  floor?: string;
  /** Number of floors in the building. */
  numberOfFloors?: number;
  /**
   * Premises area in square metres. The portal requires a numeric
   * value. If the tenancy agreement does not specify one, the operator
   * may enter `0` AND set `premisesAreaIsZeroFallback = true` to mark
   * this as an explicit fallback rather than a real zero.
   *
   * NOTE: This is the *built-up / interior* area. The land-title area
   * lives in `landRegistry.luas` and is a strictly separate field.
   */
  premisesAreaSqm: number;
  /** Explicit operator/user-confirmed fallback flag — see field above. */
  premisesAreaIsZeroFallback?: boolean;
  /**
   * Bahagian C land-registry sub-block (`pds_mp` / `pds_lot` /
   * `pds_mukim` / `pds_daerah` / `pds_luas` / `pds_luasunit` /
   * `pds_kegunaan`). Optional at the persisted-shape level so legacy
   * jobs remain valid; required by the readiness gate before the
   * land-registry blockers can be lifted. See
   * `TenancyPortalLandRegistry` for the per-field contract.
   */
  landRegistry?: TenancyPortalLandRegistry;
  /** Optional operator note about the property. */
  operatorNote?: string;
}

// ─── Maklumat Am · Sewa/Pajakan portal metadata ─────────────────────
//
// Added in Milestone A2 (2026-04-29) after the ε-3 supervised
// field-mapping run proved these portal fields exist on the Maklumat
// Am tab and are referenced by the Hantar gate. The field-mapping
// report (`docs/2026-04-28-tenancy-portal-field-mapping.md` §4.4)
// catalogues them; this block makes them capturable.
//
// IMPORTANT: `pds_radio_ya` / `pds_radio_tidak` are observed in the
// portal DOM but their purpose is NOT YET CONFIRMED. They are
// intentionally NOT captured here until a future field-mapping pass
// pins down what they control. Do not invent a model for them.

/**
 * Operator-captured portal `<select>` value where the full option
 * list is not yet enumerated in WeStamp. The operator types the
 * option's stable portal `<option value>` code (and optionally the
 * human-readable label) so the readiness gate can verify presence
 * without WeStamp inventing the full enum from incomplete evidence.
 *
 * Used for `pds_dutisetem` (17 options observed but not catalogued)
 * and `pds_remit` (16 options, same situation).
 */
export interface TenancyPortalCapturedSelect {
  /**
   * Stable portal `<option value>` code. Required when this object
   * exists — the validator rejects empty / blank codes. Free string
   * because the portal's option codes vary across `<select>`s.
   */
  code: string;
  /**
   * Operator-supplied portal label (e.g. "Sewa / Pajakan"). Optional;
   * helps the operator preview show what the code means. Never
   * required by the readiness gate — labels are documentation, not
   * portal payload.
   */
  label?: string;
}

/**
 * Bahagian B / Maklumat Am · Section 4 — Hubungan Surat Cara
 * (`pds_ps`).
 *
 * Observed `<option value>` codes:
 *   - "p" → "Prinsipal"
 *   - "s" → "Surat Cara berkaitan Pajakan 49(e)"
 * The third option is the empty placeholder ("Sila pilih...") which
 * is NOT a valid selection.
 */
export type TenancyPortalInstrumentRelationship =
  | "principal"
  | "related_lease_49e";

/**
 * Mapping from WeStamp's stable enum to the portal `<option value>`
 * code observed for `pds_ps`. Source of truth — payload compiler reads
 * from this table.
 */
export const TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_PORTAL_CODES: Record<
  TenancyPortalInstrumentRelationship,
  "p" | "s"
> = {
  principal: "p",
  related_lease_49e: "s",
};

/**
 * Operator-facing labels for `pds_ps` — mirrors the portal labels
 * observed during the field-mapping run.
 */
export const TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_LABELS: Record<
  TenancyPortalInstrumentRelationship,
  string
> = {
  principal: "Prinsipal",
  related_lease_49e: "Surat Cara berkaitan Pajakan 49(e)",
};

/**
 * Bahagian B / Maklumat Am · `pds_perjanjian` treaty / diplomatic
 * exemption flags. Observed in the portal DOM as three independent
 * checkboxes sharing the `pds_perjanjian` name attribute but with
 * distinct ids (`#kmkt`, `#klnm`, `#vienna`).
 *
 * The semantic meaning of each flag is documented in the field-
 * mapping report — diplomatic / multilateral-treaty exemption from
 * stamp duty under specific conventions. WeStamp does NOT advise on
 * which flag applies; the operator captures whichever the agreement
 * explicitly invokes.
 *
 * Booleans only. Storage may omit `false` values to keep persisted
 * shape minimal — the readiness gate and payload compiler treat
 * absent and `false` identically (no exemption claimed).
 */
export interface TenancyPortalTreatyExemption {
  /** `pds_perjanjian` checkbox id `#kmkt`. */
  kmkt?: boolean;
  /** `pds_perjanjian` checkbox id `#klnm`. */
  klnm?: boolean;
  /** `pds_perjanjian` checkbox id `#vienna` — Vienna Convention exemption. */
  vienna?: boolean;
}

/**
 * Maklumat Am sub-block on the Sewa/Pajakan portal.
 *
 * Partial-save semantics (mirrors A1 land-registry pattern): every
 * field is optional in *storage* even though some are required by the
 * portal. The validator rejects MALFORMED supplied values but accepts
 * MISSING values. Readiness blockers fire per-field as long as any
 * required field is unfilled, so partial saves are safe — they
 * persist, survive reload, and keep readiness blocked until complete.
 */
export interface TenancyPortalMaklumatAm {
  /**
   * Portal field: `pds_dutisetem` ("Jenis Duti Setem"). 17 options
   * observed during the field-mapping run; the full option list has
   * NOT been catalogued so we use a generic captured-select rather
   * than a fixed enum. Required by the portal; optional in storage.
   */
  dutyStampType?: TenancyPortalCapturedSelect;
  /**
   * Portal field: `pds_ps` (instrument relationship — Prinsipal or
   * 49(e)). Required by the portal; optional in storage.
   */
  instrumentRelationship?: TenancyPortalInstrumentRelationship;
  /**
   * Portal field: `pds_balasan` (consideration / premium amount).
   * Single-value text input on the portal. WeStamp captures it as a
   * positive `number`. **NEVER auto-derived from `rentSchedule`** —
   * the portal treats it as a separate operator-supplied value, and
   * silently conflating the two could submit incorrect figures.
   *
   * Required for some `pds_jenis` paths; the readiness gate decides
   * which based on existing evidence. Validator rejects 0 / negative
   * / non-finite when supplied; absence is allowed.
   */
  balasan?: number;
  /**
   * Portal field: `pds_remit` ("Pelepasan / Remission"). 16 options
   * observed; option list NOT catalogued. Captured-select like
   * `pds_dutisetem`. Optional throughout — current evidence does NOT
   * prove this is required at Hantar gate; flag for re-evaluation if
   * future field-mapping evidence proves otherwise.
   */
  remission?: TenancyPortalCapturedSelect;
  /**
   * Portal field: `pds_perjanjian` checkbox group (kmkt / klnm /
   * vienna). Optional throughout — unchecked is the normal case and
   * does not block readiness.
   */
  treatyExemption?: TenancyPortalTreatyExemption;
}

/**
 * Top-level tenancy portal-required-details block. Persisted on the
 * `StampingJob` record as `tenancyPortalDetails`. Absent until the
 * operator first saves through the capture panel.
 */
export interface TenancyPortalDetails {
  /** ISO 8601 timestamp of the latest operator save. */
  updatedAt: string;
  /** All landlord and tenant parties, in any order. */
  parties: TenancyPortalParty[];
  /** Bahagian B block. Optional until the operator captures it. */
  instrument?: TenancyPortalInstrument;
  /** Bahagian C block. Optional until the operator captures it. */
  property?: TenancyPortalProperty;
  /**
   * Maklumat Am block (Milestone A2). Optional until the operator
   * captures it. See `TenancyPortalMaklumatAm` for the per-field
   * contract and the partial-persistence semantics.
   */
  maklumatAm?: TenancyPortalMaklumatAm;
  /** Optional operator note about overall portal-readiness. */
  operatorNote?: string;
}

// ─── Stamping Job Record ──────────────────────────────────────────────

export interface StampingJob {
  /** UUID generated at intake time. */
  id: string;
  /** Original file name as uploaded by the user. */
  originalFileName: string;
  /** MIME type — expected to always be "application/pdf". */
  mimeType: string;
  /** File size in bytes. */
  fileSize: number;
  /** User-selected document category. */
  documentCategory: DocumentCategory;
  /** Current processing status. */
  status: StampingJobStatus;
  /** Relative path to the stored file on disk, e.g. "uploads/uuid.pdf". */
  storagePath: string;
  /** Whether this category has a planned automation path. */
  supportedForAutomation: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp — updated on any status change. */
  updatedAt: string;
  /** Unguessable token for public receipt access. All new jobs get one; legacy jobs may lack it. */
  receiptToken?: string;
  /** Stamping details — populated for tenancy agreements after user provides inputs. */
  stampingDetails?: StampingDetails;
  /** Preparation snapshot — populated when a tenancy record is prepared for stamping. */
  preparationSnapshot?: PreparationSnapshot;
  /** Ordered workflow event history. Appended by workflow actions. */
  events?: JobEvent[];
  /** Output artifact references (original doc, future certificate, future bundle). */
  artifacts?: JobArtifacts;
  /** Optional error detail if status = "failed". */
  errorMessage?: string;
  /** Optional free-text notes for admin/internal use. */
  notes?: string;
  /**
   * Internal operator lifecycle state for nominal-duty registry jobs
   * (Employment Contract, Statutory Declaration, future admissions).
   *
   * Parallel to, and does not replace, `status`. Absent on tenancy
   * jobs and on legacy jobs. Set exclusively by the
   * `/api/intake/[id]/nominal-duty-state` operator route. Does NOT
   * feed `derivePublicStatus` — public receipt remains driven by
   * `status` and `fulfilmentState`.
   */
  nominalDutyState?: import("./nominal-duty-lifecycle").NominalDutyState;
  /**
   * ISO 8601 timestamp of the most recent `nominalDutyState` write.
   * Absent until the first operator transition.
   */
  nominalDutyStateUpdatedAt?: string;
  /**
   * Most recent operator note supplied alongside a nominal-duty state
   * transition. Holds only the latest note; the full log lives in the
   * `events[]` array as `nominal_duty_state_changed` entries.
   */
  nominalDutyStateNote?: string;
  /** Submission payload draft — populated for ready_for_submission tenancy jobs. */
  submissionPayload?: SubmissionPayloadDraft;
  /** Execution attempt placeholder — populated after payload draft exists. */
  executionAttempt?: ExecutionAttempt;
  /** Tenancy extraction result — suggested values from uploaded PDF. Unverified. */
  extractionResult?: TenancyExtractionResult;
  /**
   * Operator-confirmed tenancy preparation inputs.
   * Persisted distinct from extractionResult, stampingDetails, portalDraft,
   * and submissionPayload. Downstream draft / readiness layers prefer these
   * values over raw extraction suggestions. Absent until an operator
   * completes the extraction review step.
   */
  confirmedTenancyInputs?: ConfirmedTenancyInputs;
  /**
   * Operator mark that tenancy preparation has been reviewed and is
   * internally ready for the next preparation step.
   *
   * Absent until the operator explicitly marks it ready. Never set by
   * any automated flow. Does NOT imply external submission.
   */
  tenancyPreparationReadiness?: TenancyPreparationReadiness;
  /**
   * STSDS portal routing suggestion — unverified internal suggestion only.
   * Populated when WeStamp auto-suggests a lane (e.g. tenancy → sewa_pajakan)
   * or when the user selects a document from the catalogue search.
   * Does NOT represent a confirmed submission target.
   */
  routingSuggestion?: import("./stsds-types").StsdsRoutingSuggestion;
  /**
   * Internal portal draft — "what WeStamp intends to put into the portal."
   * Draft-only, NOT submitted to e-Duti Setem.
   * Separate from extractionResult, stampingDetails, and submissionPayload.
   */
  portalDraft?: import("./stsds-types").StsdsPortalDraft;
  /**
   * Internal automation plan — "how WeStamp would drive the portal."
   * Structured plan with steps, validation checkpoints, and stop reasons.
   * NOT an executed run. Separate from portalDraft, submissionPayload,
   * and executionAttempt.
   */
  automationPlan?: import("./stsds-types").PortalAutomationPlan;
  /**
   * Internal dry-run evaluation — WeStamp's assessment of whether
   * the automation plan is internally executable against current job data.
   * NOT an executed portal run. Separate from all other job artifacts.
   */
  dryRun?: import("./stsds-types").PortalDryRun;
  /**
   * Compiled browser-automation instruction set — the adapter contract
   * a future browser driver would consume to execute the automation plan.
   * NOT an executed browser run. Separate from all other job artifacts.
   */
  browserInstructions?: import("./stsds-types").BrowserAutomationInstructionSet;
  /**
   * Mock execution result — WeStamp's deterministic simulation of the
   * compiled instruction set against current job data.
   * NOT a real portal run. Evaluates precondition.met values from the
   * compiled instructions. Separate from all other job artifacts.
   */
  mockExecution?: import("./stsds-types").BrowserExecutionResult;
  /**
   * Portal assertion evaluation — WeStamp's comparison of expected
   * portal state vs an internal snapshot (mock or future real).
   * NOT a live portal validation. Separate from all other job artifacts.
   */
  assertionEvaluation?: import("./stsds-types").PortalAssertionEvaluation;
  /**
   * Portal probe result — the last Maklumat Am probe run against
   * the real e-Duti Setem portal. Dev/local only.
   * Includes observed snapshot and per-step results.
   * Stops before save/submit — never creates a portal record.
   */
  portalProbe?: import("./stsds-portal-probe").PortalProbeResult;
  /**
   * Maklumat Am save-boundary preflight — WeStamp's internal readiness
   * assessment for whether the first save action could be attempted later.
   * This is NOT a save execution. No portal mutation has occurred.
   * Separate from all other job artifacts.
   */
  savePreflight?: import("./stsds-types").PortalSavePreflight;
  /**
   * Maklumat Am save authorization — explicit human-confirmed decision
   * that the current state is approved for a future save attempt.
   * This is NOT a save execution. No portal mutation has occurred.
   * Authorization can become stale if underlying state changes.
   * Separate from all other job artifacts.
   */
  saveAuthorization?: import("./stsds-types").PortalSaveAuthorization;
  /**
   * Maklumat Am save attempt — the first real mutating portal action.
   * Performed under strict local/dev gating with active authorization.
   * Automation stops immediately after the save outcome is observed.
   * No next-tab progression. Separate from all other job artifacts.
   */
  saveAttempt?: import("./stsds-types").PortalSaveAttempt;
  /**
   * Post-save reconciliation — WeStamp's classification of the immediate
   * stop state after the first Maklumat Am save attempt.
   * Evaluates save evidence, assertion refresh, and stop-state checks.
   * This is NOT a continuation action. Separate from all other job artifacts.
   */
  postSaveReconciliation?: import("./stsds-types").PortalPostSaveReconciliation;
  /**
   * Next-tab progression preflight — WeStamp's internal evaluation of
   * whether the immediate next tab after Maklumat Am is eligible for
   * a future guarded progression attempt.
   * This is NOT a next-tab click. No portal navigation has occurred.
   * Separate from all other job artifacts.
   */
  nextTabPreflight?: import("./stsds-types").PortalNextTabPreflight;
  /**
   * Next-tab progression authorization — explicit human-confirmed decision
   * that the current post-save state is approved for a future first
   * next-tab progression attempt.
   * This is NOT a next-tab click. No portal navigation has occurred.
   * Authorization can become stale if underlying state changes.
   * Separate from all other job artifacts.
   */
  nextTabAuthorization?: import("./stsds-types").PortalNextTabAuthorization;
  /**
   * Next-tab progression attempt — the first real local/dev next-tab click
   * from Maklumat Am into Bahagian A. Performed under strict gating with
   * active next-tab authorization. Automation stops immediately after the
   * progression outcome is observed. No Bahagian A fields are filled.
   * Separate from all other job artifacts.
   */
  nextTabAttempt?: import("./stsds-types").PortalNextTabAttempt;
  /**
   * Bahagian A entry-state — the real observed Bahagian A entry-state
   * captured after the first next-tab progression, with schema grounding.
   * Does NOT mean Bahagian A was filled or completed.
   * Separate from all other job artifacts.
   */
  bahagianAEntryState?: import("./stsds-types").PortalTabEntryState;
  /**
   * Bahagian A fill preflight — internal readiness decision for whether
   * a first Bahagian A field-fill attempt could later be attempted.
   * Does NOT mean Bahagian A was filled.
   * Separate from all other job artifacts.
   */
  bahagianAFillPreflight?: import("./stsds-types").PortalBahagianAFillPreflight;
  /**
   * Bahagian A fill authorization — explicit human-confirmed authorization
   * for a future first Bahagian A field-fill attempt. Does NOT mean
   * Bahagian A was filled. Separate from all other job artifacts.
   */
  bahagianAFillAuthorization?: import("./stsds-types").PortalBahagianAFillAuthorization;
  /**
   * Bahagian A fill attempt — the first real local/dev-only single-field
   * fill in Bahagian A. Fills exactly ONE grounded editable field, captures
   * post-fill evidence and readback, then stops immediately.
   * Requires active fill authorization and eligible fill preflight.
   * Separate from all other job artifacts.
   */
  bahagianAFillAttempt?: import("./stsds-types").PortalBahagianAFillAttempt;
  /**
   * Bahagian A post-fill reconciliation — internal classification of the
   * immediate stop state after the first Bahagian A single-field fill attempt.
   * Evaluates fill evidence, readback, and stop-state checks.
   * This is NOT a Bahagian A completion or continuation evaluation.
   * Separate from all other job artifacts.
   */
  bahagianAPostFillReconciliation?: import("./stsds-types").PortalBahagianAPostFillReconciliation;
  /**
   * Bahagian A next-field preflight — internal readiness decision for whether
   * a future second Bahagian A field-fill attempt could later be attempted,
   * and what the next preferred field candidate is.
   * This is NOT a second field fill. No portal mutation has occurred.
   * Separate from all other job artifacts.
   */
  bahagianANextFieldPreflight?: import("./stsds-types").PortalBahagianANextFieldPreflight;
  /**
   * Portal submission readiness — internal advisory assessment of
   * whether the job is ready for portal submission (Hantar), based on
   * proven portal behaviour. Does NOT mean submission has occurred.
   * Does NOT guarantee submission will succeed.
   */
  submissionReadiness?: import("./stsds-types").PortalSubmissionReadiness;
  /**
   * Portal preparation inputs — internal markers for proven submit gates.
   * These represent WeStamp's internal preparation state, NOT live portal
   * completion. Separate from portalDraft and submissionReadiness.
   */
  preparationInputs?: import("./stsds-types").PortalPreparationInputs;
  /**
   * Portal execution preview — compiled internal preview of what WeStamp
   * intends to enter and validate in e-Duti Setem. NOT a live portal
   * interaction. Separate from portalDraft, submissionReadiness, and
   * preparationInputs.
   */
  executionPreview?: import("./stsds-types").PortalExecutionPreview;
  /**
   * Stamping fulfilment state — internal operational tracking for
   * payment and certificate collection. NOT automated.
   */
  fulfilmentState?: StampingFulfilmentState;
  /**
   * Soft-archive marker. Presence of `archivedAt` indicates the job
   * has been hidden from the operator's active queue. The job record,
   * uploaded source PDF, fulfilment state, and event history are all
   * preserved — archive is a UI filter only, NOT a deletion.
   *
   * Absent on active jobs and on legacy jobs. Set by the operator
   * route at `/api/intake/[id]/archive`. Cleared by the same route
   * when the job is restored.
   */
  archivedAt?: string;
  /**
   * Optional short operator note recorded at archive time (e.g.
   * "test upload", "duplicate of #abc-1234", "user withdrew"). Free
   * text. The full audit trail of archive/restore actions lives in
   * the `events[]` array as `job_archived` / `job_restored` entries.
   */
  archivedReason?: string;
  /**
   * Internal tenancy-portal required-details block. Captures the
   * structured Sewa/Pajakan data the e-Duti Setem portal requires
   * (parties, instrument/rent, property). Operator-entered via
   * `POST /api/intake/[id]/tenancy-portal-details`. Absent until the
   * operator first saves through the capture panel. Only applies to
   * tenancy-agreement jobs; ignored for nominal-duty / other lanes.
   *
   * Does NOT replace `stampingDetails` or `confirmedTenancyInputs`.
   * It complements them by adding the party/property/rent-schedule
   * structure that the portal needs but the existing duty-calc layer
   * does not represent.
   */
  tenancyPortalDetails?: TenancyPortalDetails;
  /**
   * Internal supervised-run session state (Milestone B6). Optional;
   * absent until the operator first calls
   * `POST /api/intake/[id]/supervised-run/prepare`.
   *
   * This block stores ONLY sanitized scalars (enum values, ISO
   * timestamps, booleans, blocker-code list, and a non-execution
   * marker). It NEVER stores raw URLs, hrefs, cookies, tokens,
   * `lhdnmsstoken`, IC numbers, TINs, firm IDs, party names,
   * addresses, or uploaded document content. See
   * `tenancy-supervised-run-session.ts` for the type contract and
   * `tenancy-supervised-run-session.test.ts` for the
   * sensitive-data invariant.
   */
  supervisedRunSession?: import("./tenancy-supervised-run-session").TenancyRunSessionState;
}
