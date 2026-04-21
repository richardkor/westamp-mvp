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
  | "other";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  tenancy_agreement: "Tenancy Agreement",
  employment_contract: "Employment Contract",
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
  | "delivered";

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
}
