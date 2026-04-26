"use client";

/**
 * /upload/[id] — Intake Details + Stamping Preparation
 *
 * Shows the saved intake record. For tenancy-agreement records at
 * "uploaded" status, presents a form to capture stamping details
 * (rent, duration, duplicate copies) and calculate duty.
 *
 * For unsupported categories, shows an honest message that automated
 * stamping is not yet available.
 *
 * Does NOT imply LHDN submission, extraction, or stamping has occurred.
 */

import React, { useState, useEffect, useRef } from "react";
import { evaluateFulfilmentIntegrity } from "../../../lib/fulfilment-integrity";
import { getLaneKnowledgeProfile } from "../../../lib/stsds-lane-knowledge";
import { getSewaPajakanGateChainView } from "../../../lib/sewa-pajakan-gate-chain";
import {
  getNominalDutyEntry,
  NOMINAL_DUTY_SEWA_PAJAKAN_SEPARATION_NOTE,
} from "../../../lib/nominal-duty-registry";
import {
  NominalDutyState,
  NOMINAL_DUTY_STATE_LABELS,
  NOMINAL_DUTY_STATE_DESCRIPTIONS,
  NOMINAL_DUTY_STATE_ORDER,
  NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH,
} from "../../../lib/nominal-duty-lifecycle";
import { resolveConfirmedTenancyPreparationValues } from "../../../lib/tenancy-preparation-resolver";
import { derivePublicStatus } from "../../../lib/public-status";

// ─── Types (mirrored from stamping-types for client use) ─────────────

interface StructureFlags {
  hasPremiumOrFine?: boolean;
  hasVariableRent?: boolean;
  isMixedUse?: boolean;
  isPeriodicOrIndefinite?: boolean;
  hasBundledCharges?: boolean;
  hasUnusualConsideration?: boolean;
}

interface StampingDetails {
  monthlyRent: number;
  leaseMonths: number;
  duplicateCopies: number;
  calculatedDuty: {
    baseDuty: number;
    duplicateCopyTotal: number;
    totalDuty: number;
    rateTierLabel: string;
  };
  structureFlags?: StructureFlags;
  manualReviewReason?: string;
}

interface PreparationSnapshot {
  preparedAt: string;
  documentCategory: string;
  uploadedFile: { originalFileName: string; storagePath: string };
  tenancyDetails: { monthlyRent: number; leaseMonths: number; duplicateCopies: number };
  dutyCalculation: { baseDuty: number; duplicateCopyTotal: number; totalDuty: number; rateTierLabel: string };
  dataSource: string;
}

interface JobEvent {
  type: string;
  timestamp: string;
  note?: string;
}

interface SubmissionPayloadDraft {
  payloadStatus: "draft";
  draftedAt: string;
  internalJobId: string;
  documentCategory: string;
  uploadedFile: {
    originalFileName: string;
    storagePath: string;
    mimeType: string;
    fileSizeBytes: number;
  };
  tenancyDetails: { monthlyRent: number; leaseMonths: number; duplicateCopies: number };
  dutyCalculation: { baseDuty: number; duplicateCopyTotal: number; totalDuty: number; rateTierLabel: string };
  dataSource: string;
  preparedAt: string;
}

interface StampingJob {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  documentCategory: string;
  status: string;
  storagePath: string;
  supportedForAutomation: boolean;
  createdAt: string;
  updatedAt: string;
  stampingDetails?: StampingDetails;
  preparationSnapshot?: PreparationSnapshot;
  events?: JobEvent[];
  errorMessage?: string;
  notes?: string;
  submissionPayload?: SubmissionPayloadDraft;
  executionAttempt?: {
    attemptId: string;
    createdAt: string;
    attemptStatus: "not_enabled";
    payloadJobId: string;
    note: string;
  };
  extractionResult?: {
    extractedAt: string;
    dataSource: "pdf_parsed_unverified" | "ocr_unverified";
    suggestedMonthlyRent: { value: number | null; confidence: string | null; source: string | null; matchNote?: string };
    suggestedLeaseMonths: { value: number | null; confidence: string | null; source: string | null; matchNote?: string };
    suggestedAgreementDate: { value: string | null; confidence: string | null; source: string | null; matchNote?: string };
    fieldsExtracted: number;
    textLengthChars: number;
    ocrAttempted?: boolean;
  };
  confirmedTenancyInputs?: {
    confirmedAt: string;
    reviewStatus: "reviewed_confirmed" | "reviewed_overridden";
    confirmedMonthlyRent: number | null;
    confirmedLeaseMonths: number | null;
    confirmedAgreementDate: string | null;
    confirmedBySource: {
      monthlyRent: "extraction_confirmed" | "operator_override" | "operator_entered" | null;
      leaseMonths: "extraction_confirmed" | "operator_override" | "operator_entered" | null;
      agreementDate: "extraction_confirmed" | "operator_override" | "operator_entered" | null;
    };
  };
  tenancyPreparationReadiness?: {
    markedReadyAt: string;
    source: "operator_marked";
    basis: {
      hasExtraction: boolean;
      hasConfirmedInputs: boolean;
      reviewStatus: "reviewed_confirmed" | "reviewed_overridden";
    };
  };
  routingSuggestion?: {
    suggestedLane: "sewa_pajakan" | "penyeteman_am";
    suggestedPortalDocumentName: string | null;
    expectedDerivedDocumentGroup: string | null;
    observedEditableInstrumentCategory: string | null;
    source: "category_match" | "catalogue_search";
    confidence: "high" | "medium" | "low";
    suggestedAt: string;
  };
  browserInstructions?: {
    status: "not_ready" | "ready_for_internal_review" | "review_required" | "blocked" | "not_yet_proven";
    lane: "sewa_pajakan" | "penyeteman_am";
    compiledAt: string;
    instructions: {
      seq: number;
      type: string;
      description: string;
      target?: {
        fieldKey?: string;
        tabKey?: string;
        portalLabel?: string;
        mode?: string;
      };
      payload?: { value: string | number | null; source: string };
      preconditions: { description: string; met: boolean; reason?: string }[];
      expectations: { description: string; expectedValue: string | null }[];
      blocked: boolean;
      blockReason?: string;
      isAdvisory?: boolean;
    }[];
    instructionCount: number;
    blockedReasons: string[];
    advisoryNotes: string[];
    knownLaterSurfaces?: string[];
  };
  mockExecution?: {
    status: "not_ready" | "ready_for_internal_review" | "review_required" | "blocked" | "failed" | "not_yet_proven";
    lane: "sewa_pajakan" | "penyeteman_am";
    executedAt: string;
    instructionResults: {
      seq: number;
      type: string;
      description: string;
      status: "pending" | "executed" | "blocked" | "failed" | "skipped";
      note?: string;
      isAdvisory?: boolean;
    }[];
    trace: {
      totalInstructions: number;
      executedCount: number;
      blockedCount: number;
      failedCount: number;
      skippedCount: number;
    };
    failures: { atSeq: number; reason: string }[];
    blockedReasons: string[];
    failedReasons: string[];
    advisoryNotes: string[];
    knownLaterSurfaces?: string[];
  };
  fulfilmentState?: {
    adjudicationNumber: string | null;
    paymentStatus: "not_applicable" | "not_ready" | "awaiting_payment" | "payment_marked_done";
    paymentMethod: string | null;
    paymentMarkedAt: string | null;
    paymentNote: string | null;
    paymentReference: string | null;
    certificateStatus: "not_ready" | "waiting_for_certificate" | "certificate_retrieved";
    certificateRetrievedAt: string | null;
    certificateFileName: string | null;
    certificateStoragePath: string | null;
    delivered: boolean;
    deliveredAt: string | null;
    lastFulfilmentUpdateAt: string;
  };
  portalProbe?: {
    status: "not_ready" | "ready_for_local_run" | "completed" | "blocked" | "failed";
    lane: "sewa_pajakan" | "penyeteman_am";
    probedAt: string;
    stepResults: {
      seq: number;
      type: string;
      description: string;
      status: "executed" | "blocked" | "failed" | "skipped" | "refused";
      observedValue?: string | null;
      note?: string;
      selectorMethod?: string;
      readbackConfidence?: string;
      readbackNote?: string;
      rawObservedValue?: string | null;
    }[];
    observedSnapshot: {
      lane: "sewa_pajakan" | "penyeteman_am";
      capturedAt: string;
      source: "mock_from_draft" | "browser_captured";
      allFields: {
        fieldKey: string;
        observedValue: string | number | null;
        tab: string;
        selectorMethod?: string;
        readbackConfidence?: string;
        readbackNote?: string;
        rawObservedValue?: string | null;
      }[];
    } | null;
    assertionEvaluationStatus: string | null;
    executedCount: number;
    refusedCount: number;
    failedCount: number;
    notes: string[];
    artifactCollection?: {
      artifacts: {
        type: "screenshot" | "field_evidence";
        checkpoint: string;
        capturedAt: string;
        filePath?: string;
        fileName?: string;
        fieldEvidence?: {
          fieldKey: string;
          portalLabel?: string;
          rawObservedValue?: string | null;
          normalizedValue?: string | number | null;
          selectorMethod?: string;
          readbackConfidence?: string;
          readbackNote?: string;
        };
        note?: string;
      }[];
      artifactDir: string;
      screenshotCount: number;
      fieldEvidenceCount: number;
      collectedAt: string;
    };
  };
  assertionEvaluation?: {
    status: "ready_for_internal_review" | "blocking_mismatches" | "advisory_mismatches" | "not_ready";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    snapshot: {
      lane: "sewa_pajakan" | "penyeteman_am";
      capturedAt: string;
      source: "mock_from_draft" | "browser_captured";
      tabs: { tabKey: string; tabLabel: string; fields: { fieldKey: string; observedValue: string | number | null; tab: string }[] }[];
      allFields: { fieldKey: string; observedValue: string | number | null; tab: string }[];
    };
    results: {
      fieldKey: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      outcome: "match" | "mismatch" | "skipped";
      expectedValue: string | number | null;
      observedValue: string | number | null;
      mismatchReason?: string;
      note?: string;
    }[];
    summary: {
      totalAssertions: number;
      matchCount: number;
      mismatchCount: number;
      skippedCount: number;
      blockingMismatchCount: number;
      advisoryMismatchCount: number;
      informationalMismatchCount: number;
    };
    blockingMismatches: string[];
    advisoryMismatches: string[];
  };
  dryRun?: {
    status: "not_ready" | "ready_for_internal_review" | "review_required" | "blocked";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    stepResults: {
      seq: number;
      stepType: string;
      description: string;
      fieldKey?: string;
      status: "ready" | "blocked" | "skipped" | "pending";
      note?: string;
    }[];
    checkpointResults: {
      description: string;
      fieldKey?: string;
      expectedValue: string | null;
      status: "ready" | "blocked" | "advisory";
      note?: string;
    }[];
    summary: {
      totalSteps: number;
      readySteps: number;
      blockedSteps: number;
      skippedSteps: number;
      pendingSteps: number;
      totalCheckpoints: number;
      readyCheckpoints: number;
      blockedCheckpoints: number;
      advisoryCheckpoints: number;
    };
    blockedReasons: string[];
    advisoryNotes: string[];
  };
  automationPlan?: {
    status: "not_ready" | "ready_for_review" | "review_required" | "blocked" | "not_yet_proven";
    lane: "sewa_pajakan" | "penyeteman_am";
    createdAt: string;
    steps: {
      seq: number;
      type: string;
      description: string;
      target?: string;
      intendedValue?: string | number | null;
      blocked?: boolean;
      blockReason?: string;
    }[];
    validationCheckpoints: {
      description: string;
      field: string;
      expectedValue: string | null;
      severity: "required" | "advisory";
    }[];
    stopReasons: string[];
    stepCount: number;
    intendedValues: {
      portalDocumentName?: string | null;
      expectedDerivedDocumentGroup?: string | null;
      editableInstrumentCategory?: string | null;
      stampOffice?: string | null;
      instrumentDate?: string | null;
    };
  };
  portalDraft?: {
    status: "draft" | "ready_for_review";
    source: "auto_from_job" | "manual_entry";
    lane: "sewa_pajakan" | "penyeteman_am";
    draftedAt: string;
    maklumatAmPenyetemanAm?: {
      portalDocumentName: string;
      expectedDerivedDocumentGroup: string | null;
      editableInstrumentCategory: string | null;
      stampOffice?: string;
      instrumentDate?: string;
      receivedInMalaysiaDate?: string | null;
    };
    maklumatAmSewaPajakan?: {
      monthlyRent?: number;
      leaseMonths?: number;
      stampOffice?: string;
      instrumentDate?: string;
      receivedInMalaysiaDate?: string | null;
    };
    dutySummary?: {
      summaryHeading?: string;
      payableDuty?: number;
      duplicateCopyAmount?: number;
      penaltyAmount?: number;
      totalPayable?: number;
    };
    mappingEvidence?: {
      confidence: "observed" | "partial" | "unknown";
      source: string;
      observedAt?: string;
      note?: string;
    };
  };
  savePreflight?: {
    status: "not_ready" | "blocking_issues" | "review_required" | "eligible";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    mutationGuard: {
      decision: "refused" | "review_gated" | "permitted";
      reasons: string[];
      explanation: string;
    };
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
      informationalFailures: number;
    };
    blockingReasons: string[];
    advisoryReasons: string[];
    lastProbeReference?: string;
  };
  saveAuthorization?: {
    status: "not_available" | "available" | "active" | "stale" | "revoked";
    scope: string;
    evaluatedAt: string;
    issuedAt?: string;
    revokedAt?: string;
    expiry?: {
      expiresAt: string;
      isExpired: boolean;
      windowMinutes: number;
    };
    stateRef?: {
      preflightEvaluatedAt: string;
      portalDraftedAt: string;
      probeProbedAt?: string;
      assertionEvaluatedAt?: string;
      lane: string;
    };
    staleReasons: string[];
    explanation: string;
  };
  saveAttempt?: {
    status: "not_ready" | "blocked" | "attempted" | "failed" | "completed_with_stop";
    lane: "sewa_pajakan" | "penyeteman_am";
    attemptedAt: string;
    authorizationWasActive: boolean;
    preflightWasEligible: boolean;
    evidence?: {
      screenshotFilePath?: string;
      screenshotFileName?: string;
      observedPortalMessage?: string;
      outcome: string;
      notes: string[];
    };
    artifactDir?: string;
    blockReason?: string;
    notes: string[];
  };
  postSaveReconciliation?: {
    status: "not_ready" | "stopped_cleanly" | "review_required" | "blocking_issue" | "save_failed";
    outcome: string;
    stopReason: string;
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    postSaveAssertionStatus?: string;
    postSaveAssertionEvaluation?: {
      status: string;
      lane: string;
      evaluatedAt: string;
      summary: {
        totalAssertions: number;
        matchCount: number;
        mismatchCount: number;
        blockingMismatchCount: number;
        advisoryMismatchCount: number;
      };
      blockingMismatches: string[];
      advisoryMismatches: string[];
    };
    basedOnPostSaveSnapshot: boolean;
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
    };
    blockingReasons: string[];
    reviewReasons: string[];
    explanation: string;
  };
  nextTabPreflight?: {
    status: "not_ready" | "blocking_issues" | "review_required" | "eligible_for_later_attempt";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    currentTabKey: string;
    nextTabObservedState: {
      expectedNextTabKey: string | null;
      expectedNextTabLabel: string | null;
      availability: string;
      availabilitySource: string;
      unintendedProgressionDetected: boolean;
      note?: string;
    };
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    guard: {
      decision: "refused" | "review_gated" | "permitted";
      reasons: string[];
      explanation: string;
    };
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
      informationalFailures: number;
    };
    blockingReasons: string[];
    advisoryReasons: string[];
    explanation: string;
  };
  nextTabAuthorization?: {
    status: "not_available" | "available" | "active" | "stale" | "revoked";
    scope: string;
    evaluatedAt: string;
    issuedAt?: string;
    revokedAt?: string;
    expiry?: {
      expiresAt: string;
      isExpired: boolean;
      windowMinutes: number;
    };
    stateRef?: {
      nextTabPreflightEvaluatedAt: string;
      reconciliationEvaluatedAt: string;
      saveAttemptAttemptedAt: string;
      postSaveSnapshotCapturedAt?: string;
      lane: string;
      expectedNextTabKey: string;
    };
    staleReasons: string[];
    explanation: string;
  };
  nextTabAttempt?: {
    status: "not_ready" | "blocked" | "attempted" | "failed" | "completed_with_stop";
    lane: "sewa_pajakan" | "penyeteman_am";
    attemptedAt: string;
    fromTabKey: string;
    toTabKey: string;
    toTabLabel: string;
    authorizationWasActive: boolean;
    preflightWasEligible: boolean;
    evidence?: {
      screenshotFilePath?: string;
      screenshotFileName?: string;
      observedPortalMessage?: string;
      outcome: string;
      targetTabAppearedActive: boolean;
      observedTabLabel?: string;
      notes: string[];
    };
    artifactDir?: string;
    blockReason?: string;
    notes: string[];
  };
  bahagianAEntryState?: {
    status: "not_observed" | "observed" | "grounding_incomplete" | "partially_matched" | "ready_for_review";
    tabKey: string;
    tabLabel: string;
    lane: "sewa_pajakan" | "penyeteman_am";
    observedAt: string;
    tabObserved: boolean;
    observedFields: {
      index: number;
      labelText: string;
      mode: "editable" | "read_only" | "derived" | "unknown";
      typeHint: string;
      visibility: string;
      appearsRequired: boolean;
      currentValue?: string | null;
      locatorNote?: string;
      containerContext?: string;
      note?: string;
    }[];
    groundingEntries: {
      observedField?: {
        index: number;
        labelText: string;
        mode: string;
        typeHint: string;
      };
      schemaFieldKey?: string;
      schemaFieldLabel?: string;
      match: "matched" | "unmatched" | "expected_missing" | "uncertain";
      note?: string;
    }[];
    summary: {
      totalObservedFields: number;
      groundedCount: number;
      unmatchedObservedCount: number;
      expectedButNotObservedCount: number;
      uncertainCount: number;
      qualityNotes: string[];
    };
    screenshotFileName?: string;
    artifactDir?: string;
    notes: string[];
  };
  bahagianAFillPreflight?: {
    status: "not_ready" | "blocking_issues" | "review_required" | "eligible_for_later_fill_attempt";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    groundingStatus: string | null;
    fieldModeSummary: {
      editableCount: number;
      readOnlyCount: number;
      derivedCount: number;
      unknownCount: number;
    };
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    guard: {
      decision: "refused" | "review_gated" | "permitted";
      reasons: string[];
      explanation: string;
    };
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
      informationalFailures: number;
    };
    blockingReasons: string[];
    advisoryReasons: string[];
    explanation: string;
  };
  bahagianAFillAuthorization?: {
    status: "not_available" | "available" | "active" | "stale" | "revoked";
    scope: string;
    evaluatedAt: string;
    issuedAt?: string;
    revokedAt?: string;
    expiry?: {
      expiresAt: string;
      isExpired: boolean;
      windowMinutes: number;
    };
    stateRef?: {
      fillPreflightEvaluatedAt: string;
      entryStateObservedAt: string;
      groundingStatus: string;
      nextTabAttemptAttemptedAt: string;
      lane: string;
    };
    staleReasons: string[];
    explanation: string;
  };
  bahagianAFillAttempt?: {
    status: "not_ready" | "blocked" | "attempted" | "failed" | "completed_with_stop";
    lane: "sewa_pajakan" | "penyeteman_am";
    attemptedAt: string;
    authorizationWasActive: boolean;
    preflightWasEligible: boolean;
    target?: {
      observedFieldIndex: number;
      labelText: string;
      schemaFieldKey?: string;
      schemaFieldLabel?: string;
      intendedValue: string;
      valueSource: string;
      selectionReason: string;
    };
    evidence?: {
      screenshotFilePath?: string;
      screenshotFileName?: string;
      readbackValue?: string | null;
      readbackMatch?: boolean;
      selectorMethod?: string;
      observedPortalMessage?: string;
      outcome: string;
      notes: string[];
    };
    artifactDir?: string;
    blockReason?: string;
    notes: string[];
  };
  bahagianAPostFillReconciliation?: {
    status: "not_ready" | "stopped_cleanly" | "review_required" | "blocking_issue" | "fill_attempt_failed";
    outcome: string;
    stopReason: string;
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    targetField?: {
      labelText: string;
      schemaFieldKey?: string;
      schemaFieldLabel?: string;
      observedFieldIndex: number;
    };
    intendedValue?: string;
    observedValue?: string | null;
    readbackMatch?: boolean;
    fillAttemptOutcome?: string;
    basedOnFillAttemptEvidence: boolean;
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
      informationalFailures: number;
    };
    blockingReasons: string[];
    reviewReasons: string[];
    explanation: string;
  };
  bahagianANextFieldPreflight?: {
    status: "not_ready" | "blocking_issues" | "review_required" | "eligible_for_later_next_field_attempt";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    firstFilledField?: {
      labelText: string;
      schemaFieldKey?: string;
      observedFieldIndex: number;
    };
    nextCandidate?: {
      observedFieldIndex: number;
      labelText: string;
      schemaFieldKey?: string;
      schemaFieldLabel?: string;
      intendedValue?: string;
      valueSource?: string;
      selectionBasis: string;
      isUnambiguous: boolean;
    };
    remainingCandidateCount: number;
    checks: {
      checkId: string;
      description: string;
      severity: "blocking" | "advisory" | "informational";
      passed: boolean;
      reason?: string;
    }[];
    guard: {
      decision: "refused" | "review_gated" | "permitted";
      reasons: string[];
      explanation: string;
    };
    summary: {
      totalChecks: number;
      passedCount: number;
      blockingFailures: number;
      advisoryFailures: number;
      informationalFailures: number;
    };
    blockingReasons: string[];
    advisoryReasons: string[];
    explanation: string;
  };
  submissionReadiness?: {
    status: "blocked" | "ready_with_caveats" | "assessment_limited";
    lane: "sewa_pajakan" | "penyeteman_am";
    evaluatedAt: string;
    gatesProvenForLane: boolean;
    provenBlockers: {
      key: string;
      description: string;
      satisfied: boolean;
    }[];
    unresolvedChecks: string[];
    notes: string[];
  };
  preparationInputs?: {
    declarationPrepared: boolean;
    bahagianAFirstPartyPrepared: boolean;
    bahagianASecondPartyPrepared: boolean;
    updatedAt: string;
  };
  executionPreview?: {
    status: "incomplete" | "preview_ready" | "limited";
    lane: "sewa_pajakan" | "penyeteman_am";
    generatedAt: string;
    intendedInputs: { field: string; value: string | number | null; source: string }[];
    validationTargets: { field: string; expectedValue: string | null; basis: string }[];
    preparationSummary: {
      declarationPrepared: boolean;
      bahagianAFirstPartyPrepared: boolean;
      bahagianASecondPartyPrepared: boolean;
    };
    unresolvedSteps: string[];
    notes: string[];
  };
  // Internal operator lifecycle for nominal-duty registry jobs
  // (Employment Contract, Statutory Declaration, future admissions).
  // Parallel to `status`; not a public-receipt input.
  nominalDutyState?: NominalDutyState;
  nominalDutyStateUpdatedAt?: string;
  nominalDutyStateNote?: string;
}

interface CatalogueSearchResult {
  id: string;
  portalLane: "sewa_pajakan" | "penyeteman_am";
  portalDocumentName: string;
  expectedDerivedDocumentGroup: string | null;
  observedEditableInstrumentCategory: string | null;
  supportedForAutomation: boolean;
  mappingEvidence: {
    confidence: "observed" | "partial" | "unknown";
    source: string;
  };
  matchType: string;
  score: number;
}

type FieldSourceClient = "user_entered" | "extracted_applied" | "extracted_applied_then_edited";

interface FieldProvenanceClient {
  monthlyRent: FieldSourceClient;
  leaseMonths: FieldSourceClient;
}

const CATEGORY_LABELS: Record<string, string> = {
  tenancy_agreement: "Tenancy Agreement",
  employment_contract: "Employment Contract",
  statutory_declaration: "Statutory Declaration",
  other: "Other / Not Sure",
};

const STATUS_LABELS: Record<string, string> = {
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

// ─── Helpers ─────────────────────────────────────────────────────────

function formatRM(amount: number): string {
  return `RM ${amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Event Label Formatter ──────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  document_uploaded: "Intake created",
  intake_saved: "Intake saved",
  stamping_details_saved: "Stamping details saved",
  preparation_completed: "Preparation completed",
  marked_ready_for_submission: "Marked ready for submission",
  transition_blocked: "Transition blocked",
  validation_failed: "Validation failed",
  status_changed: "Status changed",
  moved_to_manual_review: "Moved to manual review",
  moved_to_failed: "Moved to failed",
  extraction_completed: "Extraction completed",
  extraction_suggestions_applied: "Extraction suggestions applied",
  routing_suggestion_saved: "Routing suggestion saved",
  portal_draft_created: "Portal draft created",
  portal_draft_updated: "Portal draft updated",
  submission_readiness_evaluated: "Submission readiness evaluated",
  preparation_inputs_updated: "Preparation inputs updated",
  execution_preview_compiled: "Execution preview compiled",
  stsds_state_refreshed: "STSDS state refreshed",
  automation_plan_created: "Automation plan created",
  automation_plan_updated: "Automation plan updated",
  browser_instructions_compiled: "Browser instructions compiled",
  mock_execution_created: "Mock execution created",
  portal_probe_completed: "Portal probe completed",
  portal_probe_failed: "Portal probe failed",
  save_preflight_evaluated: "Save preflight evaluated",
  save_authorization_issued: "Save authorization issued",
  save_attempt_completed: "Save attempt completed",
  save_attempt_failed: "Save attempt failed",
  adjudication_number_recorded: "Adjudication number recorded",
  payment_marked_awaiting: "Payment marked awaiting",
  payment_marked_done: "Payment marked done",
  certificate_marked_waiting: "Certificate marked waiting",
  certificate_marked_retrieved: "Certificate uploaded",
  delivered: "Delivered",
};

function formatEventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

// ─── Page Component ──────────────────────────────────────────────────

export default function IntakeDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<StampingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Stamping details form state
  const [monthlyRentStr, setMonthlyRentStr] = useState("");
  const [leaseMonthsStr, setLeaseMonthsStr] = useState("");
  const [duplicateCopiesStr, setDuplicateCopiesStr] = useState("0");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Structure flag state
  const [structureFlags, setStructureFlags] = useState<StructureFlags>({});

  // Preparation action state
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  // Transition action state
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Payload drafting action state
  const [draftingPayload, setDraftingPayload] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // Execution attempt action state
  const [initializingExecution, setInitializingExecution] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractionDone, setExtractionDone] = useState(false);

  // STSDS routing state
  const [routingSearchQuery, setRoutingSearchQuery] = useState("");
  const [routingSearchResults, setRoutingSearchResults] = useState<CatalogueSearchResult[]>([]);
  const [routingSearching, setRoutingSearching] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);

  // Portal draft state
  const [draftingPortal, setDraftingPortal] = useState(false);
  const [portalDraftError, setPortalDraftError] = useState<string | null>(null);

  // Portal draft editable field state
  const [pdStampOffice, setPdStampOffice] = useState("");
  const [pdInstrumentDate, setPdInstrumentDate] = useState("");
  const [pdReceivedDate, setPdReceivedDate] = useState("");
  const [pdEditableCategory, setPdEditableCategory] = useState("");
  const [pdFieldsInitialized, setPdFieldsInitialized] = useState(false);
  const [savingPortalDraft, setSavingPortalDraft] = useState(false);
  const [evaluatingReadiness, setEvaluatingReadiness] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [savingPrepInputs, setSavingPrepInputs] = useState(false);
  const [prepInputsError, setPrepInputsError] = useState<string | null>(null);
  const [compilingPreview, setCompilingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [refreshingStsds, setRefreshingStsds] = useState(false);
  const [stsdsRefreshError, setStsdsRefreshError] = useState<string | null>(null);
  const [stsdsRefreshMsg, setStsdsRefreshMsg] = useState<string | null>(null);
  const [fulfilmentLoading, setFulfilmentLoading] = useState(false);
  const [fulfilmentError, setFulfilmentError] = useState<string | null>(null);
  const [adjNumInput, setAdjNumInput] = useState("");
  const [payMethodInput, setPayMethodInput] = useState("");
  const [payNoteInput, setPayNoteInput] = useState("");
  const [payRefInput, setPayRefInput] = useState("");
  // certFileInput removed — certificate_retrieved now requires file upload only
  const certUploadRef = useRef<HTMLInputElement>(null);
  const [certUploading, setCertUploading] = useState(false);
  const [certUploadError, setCertUploadError] = useState<string | null>(null);
  // Queue context — set if navigated from /jobs
  const [fromQueue, setFromQueue] = useState<string | null>(null);
  const [portalDraftSaveError, setPortalDraftSaveError] = useState<string | null>(null);
  const [portalDraftValidation, setPortalDraftValidation] = useState<{
    isComplete: boolean;
    missingFields: string[];
  } | null>(null);

  // Automation plan state
  const [buildingPlan, setBuildingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Dry-run state
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  // Browser instructions state
  const [compilingInstructions, setCompilingInstructions] = useState(false);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);

  // Mock execution state
  const [runningMock, setRunningMock] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);

  // Assertion evaluation state
  const [evaluatingAssertions, setEvaluatingAssertions] = useState(false);
  const [assertionsError, setAssertionsError] = useState<string | null>(null);

  // Portal probe state
  const [runningProbe, setRunningProbe] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Save preflight state
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  // Save authorization state
  const [runningAuth, setRunningAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Save attempt state
  const [runningSaveAttempt, setRunningSaveAttempt] = useState(false);
  const [saveAttemptError, setSaveAttemptError] = useState<string | null>(null);

  // Post-save reconciliation state
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  // Next-tab preflight state
  const [runningNextTabPreflight, setRunningNextTabPreflight] = useState(false);
  const [nextTabPreflightError, setNextTabPreflightError] = useState<string | null>(null);

  // Next-tab authorization state
  const [runningNextTabAuth, setRunningNextTabAuth] = useState(false);
  const [nextTabAuthError, setNextTabAuthError] = useState<string | null>(null);

  // Next-tab attempt state
  const [runningNextTabAttempt, setRunningNextTabAttempt] = useState(false);
  const [nextTabAttemptError, setNextTabAttemptError] = useState<string | null>(null);

  // Bahagian A grounding state
  const [runningBahagianAGrounding, setRunningBahagianAGrounding] = useState(false);
  const [bahagianAGroundingError, setBahagianAGroundingError] = useState<string | null>(null);

  // Bahagian A fill preflight state
  const [runningBahagianAFillPreflight, setRunningBahagianAFillPreflight] = useState(false);
  const [bahagianAFillPreflightError, setBahagianAFillPreflightError] = useState<string | null>(null);

  // Bahagian A fill authorization state
  const [runningBahagianAFillAuth, setRunningBahagianAFillAuth] = useState(false);
  const [bahagianAFillAuthError, setBahagianAFillAuthError] = useState<string | null>(null);

  // Bahagian A fill attempt state
  const [runningBahagianAFillAttempt, setRunningBahagianAFillAttempt] = useState(false);
  const [bahagianAFillAttemptError, setBahagianAFillAttemptError] = useState<string | null>(null);

  // Bahagian A post-fill reconciliation state
  const [runningBahagianAPostFillRecon, setRunningBahagianAPostFillRecon] = useState(false);
  const [bahagianAPostFillReconError, setBahagianAPostFillReconError] = useState<string | null>(null);

  // Bahagian A next-field preflight state
  const [runningBahagianANextFieldPreflight, setRunningBahagianANextFieldPreflight] = useState(false);
  const [bahagianANextFieldPreflightError, setBahagianANextFieldPreflightError] = useState<string | null>(null);

  // Extraction application state — tracks whether user has applied suggestions
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [fieldProvenance, setFieldProvenance] = useState<FieldProvenanceClient>({
    monthlyRent: "user_entered",
    leaseMonths: "user_entered",
  });

  // Extraction review / confirmation state (operator-confirmed tenancy inputs).
  // Distinct from the Stamping Details form below — this layer persists
  // operator-confirmed values on job.confirmedTenancyInputs and is consumed
  // by downstream draft/readiness logic ahead of raw extraction suggestions.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRentStr, setReviewRentStr] = useState("");
  const [reviewMonthsStr, setReviewMonthsStr] = useState("");
  const [reviewDateStr, setReviewDateStr] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // State for the "Mark preparation review complete" action.
  // Drives the POST to /api/intake/[id]/mark-tenancy-preparation-ready.
  // Does NOT submit anything externally — internal WeStamp marker only.
  const [markReadySaving, setMarkReadySaving] = useState(false);
  const [markReadyError, setMarkReadyError] = useState<string | null>(null);

  // Internal nominal-duty lifecycle state (operator-facing only).
  // Drives POST /api/intake/[id]/nominal-duty-state. Does NOT submit
  // anything to e-Duti Setem and is NOT a public-status input —
  // it only reflects what the operator is actually doing internally.
  const [nominalDutySelectedState, setNominalDutySelectedState] =
    useState<NominalDutyState>("received");
  const [nominalDutyNoteInput, setNominalDutyNoteInput] = useState("");
  const [nominalDutySaving, setNominalDutySaving] = useState(false);
  const [nominalDutyError, setNominalDutyError] = useState<string | null>(null);

  // Resolve params (Next.js 15 async params)
  useEffect(() => {
    params.then((p) => setJobId(p.id));
  }, [params]);

  // Read queue context from URL (set if navigated from /jobs)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("fromQueue");
    if (q && q.startsWith("/jobs")) setFromQueue(q);
  }, []);

  // Fetch the record
  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    fetch(`/api/intake/${jobId}`)
      .then((res) => {
        if (!res.ok) {
          setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setJob(data as StampingJob);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [jobId]);

  // Auto-trigger extraction for tenancy uploads without results
  useEffect(() => {
    if (
      !job ||
      extractionDone ||
      extracting ||
      job.documentCategory !== "tenancy_agreement" ||
      job.status !== "uploaded" ||
      job.extractionResult
    ) {
      return;
    }

    setExtracting(true);
    fetch(`/api/intake/${job.id}/extract`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) return;
        const updated = await res.json();
        setJob(updated as StampingJob);
      })
      .catch(() => {
        // Extraction failure is not user-blocking
      })
      .finally(() => {
        setExtracting(false);
        setExtractionDone(true);
      });
  }, [job, extracting, extractionDone]);

  // Auto-suggest sewa_pajakan routing for tenancy uploads without existing routing
  useEffect(() => {
    if (
      !job ||
      job.routingSuggestion ||
      job.documentCategory !== "tenancy_agreement"
    ) {
      return;
    }

    // Auto-save routing suggestion for tenancy
    setRoutingSaving(true);
    fetch(`/api/intake/${job.id}/routing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suggestedLane: "sewa_pajakan",
        suggestedPortalDocumentName: null,
        expectedDerivedDocumentGroup: null,
        observedEditableInstrumentCategory: null,
        source: "category_match",
        confidence: "high",
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const updated = await res.json();
        setJob(updated as StampingJob);
      })
      .catch(() => {
        // Routing suggestion is not blocking — fail silently
      })
      .finally(() => setRoutingSaving(false));
  }, [job]);

  // Catalogue search with debounce
  useEffect(() => {
    if (!routingSearchQuery.trim()) {
      setRoutingSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setRoutingSearching(true);
      fetch(
        `/api/stsds-search?q=${encodeURIComponent(routingSearchQuery)}&lane=penyeteman_am`
      )
        .then((res) => res.json())
        .then((data) => {
          setRoutingSearchResults(
            (data.results ?? []) as CatalogueSearchResult[]
          );
        })
        .catch(() => setRoutingSearchResults([]))
        .finally(() => setRoutingSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [routingSearchQuery]);

  // Keep the nominal-duty lifecycle dropdown in sync with the server
  // value whenever the job record refreshes. Default to "received" for
  // jobs that have never had an internal transition recorded.
  useEffect(() => {
    if (!job) return;
    setNominalDutySelectedState(job.nominalDutyState ?? "received");
  }, [job?.id, job?.nominalDutyState]);

  // ── Routing selection handler ──────────────────────────────────────

  function handleSelectRoutingDocument(result: CatalogueSearchResult) {
    if (!job) return;
    setRoutingSaving(true);
    setRoutingError(null);

    fetch(`/api/intake/${job.id}/routing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suggestedLane: result.portalLane,
        suggestedPortalDocumentName: result.portalDocumentName,
        expectedDerivedDocumentGroup: result.expectedDerivedDocumentGroup,
        observedEditableInstrumentCategory: result.observedEditableInstrumentCategory,
        source: "catalogue_search",
        confidence: "medium",
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to save routing suggestion.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
        setRoutingSearchQuery("");
        setRoutingSearchResults([]);
      })
      .catch((err) => {
        setRoutingError(
          err instanceof Error ? err.message : "Failed to save routing suggestion."
        );
      })
      .finally(() => setRoutingSaving(false));
  }

  // ── Nominal-duty internal lifecycle save handler ──────────────────
  // Posts the operator's selected internal state (and optional note)
  // to /api/intake/[id]/nominal-duty-state. The route appends a
  // `nominal_duty_state_changed` event server-side and returns the
  // updated triple, which we splice into the current job state. This
  // never touches e-Duti Setem and is not a public-status input.

  function handleSaveNominalDutyState() {
    if (!job) return;
    if (nominalDutyNoteInput.length > NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH) {
      setNominalDutyError(
        `Note exceeds the ${NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH}-character limit.`
      );
      return;
    }

    setNominalDutySaving(true);
    setNominalDutyError(null);

    const trimmedNote = nominalDutyNoteInput.trim();
    const body: { state: NominalDutyState; note?: string } = {
      state: nominalDutySelectedState,
    };
    if (trimmedNote.length > 0) {
      body.note = trimmedNote;
    }

    fetch(`/api/intake/${job.id}/nominal-duty-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to update internal handling state."
          );
        }
        return res.json();
      })
      .then(() => {
        // Re-fetch full job so the `events[]` log picks up the new
        // `nominal_duty_state_changed` entry in addition to the
        // updated state/timestamp/note triple returned by the route.
        return fetch(`/api/intake/${job.id}`).then(async (res) => {
          if (!res.ok) return;
          const updated = await res.json();
          setJob(updated as StampingJob);
          setNominalDutyNoteInput("");
        });
      })
      .catch((err) => {
        setNominalDutyError(
          err instanceof Error
            ? err.message
            : "Failed to update internal handling state."
        );
      })
      .finally(() => setNominalDutySaving(false));
  }

  // ── Create/update portal draft action ─────────────────────────────

  function handleBuildPortalDraft() {
    if (!job) return;
    setDraftingPortal(true);
    setPortalDraftError(null);

    fetch(`/api/intake/${job.id}/portal-draft`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to build portal draft."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setPortalDraftError(
          err instanceof Error ? err.message : "Failed to build portal draft."
        );
      })
      .finally(() => setDraftingPortal(false));
  }

  // ── Compile / update browser instructions ────────────────────────

  function handleCompileInstructions() {
    if (!job) return;
    setCompilingInstructions(true);
    setInstructionsError(null);

    fetch(`/api/intake/${job.id}/browser-instructions`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to compile browser instructions.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setInstructionsError(
          err instanceof Error ? err.message : "Failed to compile browser instructions."
        );
      })
      .finally(() => setCompilingInstructions(false));
  }

  // ── Run / re-run mock execution ───────────────────────────────────

  function handleRunMockExecution() {
    if (!job) return;
    setRunningMock(true);
    setMockError(null);

    fetch(`/api/intake/${job.id}/mock-execution`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run mock execution.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setMockError(
          err instanceof Error ? err.message : "Failed to run mock execution."
        );
      })
      .finally(() => setRunningMock(false));
  }

  // ── Evaluate / re-evaluate portal assertions ─────────────────────

  function handleEvaluateAssertions() {
    if (!job) return;
    setEvaluatingAssertions(true);
    setAssertionsError(null);

    fetch(`/api/intake/${job.id}/assertions`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to evaluate assertions.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setAssertionsError(
          err instanceof Error ? err.message : "Failed to evaluate assertions."
        );
      })
      .finally(() => setEvaluatingAssertions(false));
  }

  // ── Run portal probe (dev/local only) ─────────────────────────────

  function handleRunPortalProbe() {
    if (!job) return;
    setRunningProbe(true);
    setProbeError(null);

    fetch(`/api/intake/${job.id}/portal-probe`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run portal probe.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setProbeError(
          err instanceof Error ? err.message : "Failed to run portal probe."
        );
      })
      .finally(() => setRunningProbe(false));
  }

  // ── Run save preflight evaluation ──────────────────────────────

  function handleRunSavePreflight() {
    if (!job) return;
    setRunningPreflight(true);
    setPreflightError(null);

    fetch(`/api/intake/${job.id}/save-preflight`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to evaluate save preflight.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setPreflightError(
          err instanceof Error ? err.message : "Failed to evaluate save preflight."
        );
      })
      .finally(() => setRunningPreflight(false));
  }

  // ── Save authorization actions ──────────────────────────────────

  function handleSaveAuthAction(action: "issue" | "revoke" | "evaluate") {
    if (!job) return;
    setRunningAuth(true);
    setAuthError(null);

    fetch(`/api/intake/${job.id}/save-authorization?action=${action}`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to process save authorization.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setAuthError(
          err instanceof Error ? err.message : "Failed to process save authorization."
        );
      })
      .finally(() => setRunningAuth(false));
  }

  // ── Run save attempt ───────────────────────────────────────────

  function handleRunSaveAttempt() {
    if (!job) return;
    setRunningSaveAttempt(true);
    setSaveAttemptError(null);

    fetch(`/api/intake/${job.id}/save-attempt`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run save attempt.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setSaveAttemptError(
          err instanceof Error ? err.message : "Failed to run save attempt."
        );
      })
      .finally(() => setRunningSaveAttempt(false));
  }

  // ── Run post-save reconciliation ──────────────────────────────

  function handleRunReconciliation() {
    if (!job) return;
    setRunningReconciliation(true);
    setReconciliationError(null);

    fetch(`/api/intake/${job.id}/post-save-reconciliation`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to evaluate reconciliation.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setReconciliationError(
          err instanceof Error ? err.message : "Failed to evaluate reconciliation."
        );
      })
      .finally(() => setRunningReconciliation(false));
  }

  // ── Run next-tab preflight ────────────────────────────────────

  function handleRunNextTabPreflight() {
    if (!job) return;
    setRunningNextTabPreflight(true);
    setNextTabPreflightError(null);

    fetch(`/api/intake/${job.id}/next-tab-preflight`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to evaluate next-tab preflight.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setNextTabPreflightError(
          err instanceof Error ? err.message : "Failed to evaluate next-tab preflight."
        );
      })
      .finally(() => setRunningNextTabPreflight(false));
  }

  // ── Next-tab authorization action ─────────────────────────────

  function handleNextTabAuthAction(action: "issue" | "revoke" | "evaluate") {
    if (!job) return;
    setRunningNextTabAuth(true);
    setNextTabAuthError(null);

    fetch(`/api/intake/${job.id}/next-tab-authorization?action=${action}`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to process next-tab authorization."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setNextTabAuthError(
          err instanceof Error
            ? err.message
            : "Failed to process next-tab authorization."
        );
      })
      .finally(() => setRunningNextTabAuth(false));
  }

  // ── Run next-tab progression attempt ─────────────────────────────

  function handleRunNextTabAttempt() {
    if (!job) return;
    setRunningNextTabAttempt(true);
    setNextTabAttemptError(null);

    fetch(`/api/intake/${job.id}/next-tab-attempt`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run next-tab attempt.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setNextTabAttemptError(
          err instanceof Error ? err.message : "Failed to run next-tab attempt."
        );
      })
      .finally(() => setRunningNextTabAttempt(false));
  }

  // ── Run Bahagian A entry-state grounding ─────────────────────────

  function handleRunBahagianAGrounding() {
    if (!job) return;
    setRunningBahagianAGrounding(true);
    setBahagianAGroundingError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-grounding`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run Bahagian A grounding.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianAGroundingError(
          err instanceof Error ? err.message : "Failed to run Bahagian A grounding."
        );
      })
      .finally(() => setRunningBahagianAGrounding(false));
  }

  // ── Run Bahagian A fill preflight ────────────────────────────────

  function handleRunBahagianAFillPreflight() {
    if (!job) return;
    setRunningBahagianAFillPreflight(true);
    setBahagianAFillPreflightError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-fill-preflight`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to evaluate Bahagian A fill preflight.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianAFillPreflightError(
          err instanceof Error ? err.message : "Failed to evaluate Bahagian A fill preflight."
        );
      })
      .finally(() => setRunningBahagianAFillPreflight(false));
  }

  // ── Bahagian A fill authorization actions ────────────────────────

  function handleBahagianAFillAuthAction(action: "issue" | "revoke" | "evaluate") {
    if (!job) return;
    setRunningBahagianAFillAuth(true);
    setBahagianAFillAuthError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-fill-authorization?action=${action}`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to process Bahagian A fill authorization."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianAFillAuthError(
          err instanceof Error
            ? err.message
            : "Failed to process Bahagian A fill authorization."
        );
      })
      .finally(() => setRunningBahagianAFillAuth(false));
  }

  // ── Bahagian A fill attempt ──────────────────────────────────────

  function handleBahagianAFillAttempt() {
    if (!job) return;
    setRunningBahagianAFillAttempt(true);
    setBahagianAFillAttemptError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-fill-attempt`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to run Bahagian A fill attempt."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianAFillAttemptError(
          err instanceof Error
            ? err.message
            : "Failed to run Bahagian A fill attempt."
        );
      })
      .finally(() => setRunningBahagianAFillAttempt(false));
  }

  // ── Bahagian A post-fill reconciliation ──────────────────────────

  function handleBahagianAPostFillRecon() {
    if (!job) return;
    setRunningBahagianAPostFillRecon(true);
    setBahagianAPostFillReconError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-post-fill-reconciliation`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to evaluate Bahagian A post-fill reconciliation."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianAPostFillReconError(
          err instanceof Error
            ? err.message
            : "Failed to evaluate Bahagian A post-fill reconciliation."
        );
      })
      .finally(() => setRunningBahagianAPostFillRecon(false));
  }

  // ── Bahagian A next-field preflight ──────────────────────────────

  function handleBahagianANextFieldPreflight() {
    if (!job) return;
    setRunningBahagianANextFieldPreflight(true);
    setBahagianANextFieldPreflightError(null);

    fetch(`/api/intake/${job.id}/bahagian-a-next-field-preflight`, {
      method: "POST",
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to evaluate Bahagian A next-field preflight."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setBahagianANextFieldPreflightError(
          err instanceof Error
            ? err.message
            : "Failed to evaluate Bahagian A next-field preflight."
        );
      })
      .finally(() => setRunningBahagianANextFieldPreflight(false));
  }

  // ── Run / update dry-run evaluation ──────────────────────────────

  function handleRunDryRun() {
    if (!job) return;
    setRunningDryRun(true);
    setDryRunError(null);

    fetch(`/api/intake/${job.id}/dry-run`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to run dry-run evaluation.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setDryRunError(
          err instanceof Error ? err.message : "Failed to run dry-run evaluation."
        );
      })
      .finally(() => setRunningDryRun(false));
  }

  // ── Evaluate submission readiness action ─────────────────────────

  function handleEvaluateReadiness() {
    if (!job) return;
    setEvaluatingReadiness(true);
    setReadinessError(null);

    fetch(`/api/intake/${job.id}/submission-readiness`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to evaluate readiness.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setReadinessError(
          err instanceof Error ? err.message : "Failed to evaluate readiness."
        );
      })
      .finally(() => setEvaluatingReadiness(false));
  }

  // ── Update preparation inputs action ─────────────────────────────

  function handleUpdatePrepInputs(updates: {
    declarationPrepared?: boolean;
    bahagianAFirstPartyPrepared?: boolean;
    bahagianASecondPartyPrepared?: boolean;
  }) {
    if (!job) return;
    setSavingPrepInputs(true);
    setPrepInputsError(null);

    fetch(`/api/intake/${job.id}/preparation-inputs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to update preparation inputs.");
        }
        return res.json();
      })
      .then((updated) => { setJob(updated as StampingJob); })
      .catch((err) => {
        setPrepInputsError(
          err instanceof Error ? err.message : "Failed to update."
        );
      })
      .finally(() => setSavingPrepInputs(false));
  }

  // ── Fulfilment update action ────────────────────────────────────

  function handleFulfilmentAction(body: Record<string, string>) {
    if (!job) return;
    setFulfilmentLoading(true);
    setFulfilmentError(null);

    fetch(`/api/intake/${job.id}/fulfilment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to update.");
        }
        return res.json();
      })
      .then((updated) => { setJob(updated as StampingJob); })
      .catch((err) => {
        setFulfilmentError(err instanceof Error ? err.message : "Failed.");
      })
      .finally(() => setFulfilmentLoading(false));
  }

  // ── Certificate file upload action ──────────────────────────────

  function handleCertificateUpload(file: File) {
    if (!job) return;
    setCertUploading(true);
    setCertUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    fetch(`/api/intake/${job.id}/certificate-upload`, {
      method: "POST",
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Upload failed.");
        }
        return res.json();
      })
      .then((updated) => { setJob(updated as StampingJob); })
      .catch((err) => {
        setCertUploadError(err instanceof Error ? err.message : "Upload failed.");
      })
      .finally(() => {
        setCertUploading(false);
        if (certUploadRef.current) certUploadRef.current.value = "";
      });
  }

  // ── STSDS refresh action ────────────────────────────────────────

  function handleStsdsRefresh() {
    if (!job) return;
    setRefreshingStsds(true);
    setStsdsRefreshError(null);
    setStsdsRefreshMsg(null);

    fetch(`/api/intake/${job.id}/stsds-refresh`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Refresh failed.");
        }
        return res.json();
      })
      .then((data) => {
        setJob(data as StampingJob);
        const r = (data as Record<string, unknown>)._refreshResult as
          | { rebuilt?: string[]; issues?: string[] }
          | undefined;
        if (r?.rebuilt) {
          setStsdsRefreshMsg(`Refreshed: ${r.rebuilt.join(", ")}.`);
        }
      })
      .catch((err) => {
        setStsdsRefreshError(err instanceof Error ? err.message : "Refresh failed.");
      })
      .finally(() => setRefreshingStsds(false));
  }

  // ── Compile execution preview action ─────────────────────────────

  function handleCompilePreview() {
    if (!job) return;
    setCompilingPreview(true);
    setPreviewError(null);

    fetch(`/api/intake/${job.id}/execution-preview`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to compile preview.");
        }
        return res.json();
      })
      .then((updated) => { setJob(updated as StampingJob); })
      .catch((err) => {
        setPreviewError(err instanceof Error ? err.message : "Failed.");
      })
      .finally(() => setCompilingPreview(false));
  }

  // ── Build/update automation plan action ──────────────────────────

  function handleBuildAutomationPlan() {
    if (!job) return;
    setBuildingPlan(true);
    setPlanError(null);

    fetch(`/api/intake/${job.id}/automation-plan`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to build automation plan."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setPlanError(
          err instanceof Error ? err.message : "Failed to build automation plan."
        );
      })
      .finally(() => setBuildingPlan(false));
  }

  // Initialize portal draft input fields from existing draft data
  useEffect(() => {
    if (!job?.portalDraft || pdFieldsInitialized) return;

    const draft = job.portalDraft;
    const am =
      draft.lane === "sewa_pajakan"
        ? draft.maklumatAmSewaPajakan
        : draft.maklumatAmPenyetemanAm;

    if (am) {
      setPdStampOffice(am.stampOffice ?? "");
      setPdInstrumentDate(am.instrumentDate ?? "");
      setPdReceivedDate(am.receivedInMalaysiaDate ?? "");
    }

    if (
      draft.lane === "penyeteman_am" &&
      draft.maklumatAmPenyetemanAm
    ) {
      setPdEditableCategory(
        draft.maklumatAmPenyetemanAm.editableInstrumentCategory ?? ""
      );
    }

    setPdFieldsInitialized(true);
  }, [job, pdFieldsInitialized]);

  // ── Save portal draft with user edits ──────────────────────────

  function handleSavePortalDraft() {
    if (!job) return;
    setSavingPortalDraft(true);
    setPortalDraftSaveError(null);

    const body: Record<string, unknown> = {
      stampOffice: pdStampOffice.trim() || undefined,
      instrumentDate: pdInstrumentDate.trim() || undefined,
      receivedInMalaysiaDate: pdReceivedDate.trim() || null,
    };

    // Only include editableInstrumentCategory for penyeteman_am
    if (job.portalDraft?.lane === "penyeteman_am") {
      body.editableInstrumentCategory = pdEditableCategory.trim() || null;
    }

    fetch(`/api/intake/${job.id}/portal-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to save portal draft.");
        }
        return res.json();
      })
      .then((updated) => {
        const { _validation, ...jobData } = updated as StampingJob & {
          _validation?: { isComplete: boolean; missingFields: string[] };
        };
        setJob(jobData as StampingJob);
        if (_validation) {
          setPortalDraftValidation(_validation);
        }
      })
      .catch((err) => {
        setPortalDraftSaveError(
          err instanceof Error ? err.message : "Failed to save portal draft."
        );
      })
      .finally(() => setSavingPortalDraft(false));
  }

  // ── Loading / Not Found states ───────────────────────────────────

  if (loading) {
    return (
      <main>
        <p>Loading&hellip;</p>
      </main>
    );
  }

  if (notFound || !job) {
    return (
      <main>
        <a href="/" className="back-link">
          &larr; Back to Home
        </a>
        <h1>Record Not Found</h1>
        <p>
          No intake record was found for this reference. The link may be
          incorrect or the record may no longer be available.
        </p>
        <div className="upload-actions" style={{ marginTop: 24 }}>
          <a href="/upload" className="btn-secondary">
            Upload a document
          </a>
          <a href="/">Back to Home</a>
        </div>
      </main>
    );
  }

  // ── Format display values ────────────────────────────────────────

  const createdAt = new Date(job.createdAt).toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const fileSizeKB = (job.fileSize / 1024).toFixed(1);

  // ── Stamping details form validation + submit ────────────────────

  function validateAndSubmit() {
    const errors: Record<string, string> = {};

    const rentTrimmed = monthlyRentStr.trim();
    if (!rentTrimmed) {
      errors.monthlyRent = "Required.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(rentTrimmed)) {
      errors.monthlyRent =
        "Enter a valid amount (e.g. 1500 or 1500.50).";
    } else if (parseFloat(rentTrimmed) <= 0) {
      errors.monthlyRent = "Must be greater than 0.";
    }

    const monthsTrimmed = leaseMonthsStr.trim();
    if (!monthsTrimmed) {
      errors.leaseMonths = "Required.";
    } else if (!/^\d+$/.test(monthsTrimmed)) {
      errors.leaseMonths = "Enter a whole number of months.";
    } else if (parseInt(monthsTrimmed, 10) === 0) {
      errors.leaseMonths = "Must be at least 1 month.";
    }

    const copiesTrimmed = duplicateCopiesStr.trim();
    if (!copiesTrimmed) {
      errors.duplicateCopies = "Required (enter 0 if none).";
    } else if (!/^\d+$/.test(copiesTrimmed)) {
      errors.duplicateCopies = "Enter a whole number (0 or more).";
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setSaveError(null);

    fetch(`/api/intake/${job!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyRent: parseFloat(rentTrimmed),
        leaseMonths: parseInt(monthsTrimmed, 10),
        duplicateCopies: parseInt(copiesTrimmed, 10),
        structureFlags,
        fieldProvenance: suggestionsApplied ? fieldProvenance : undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to save. Please try again.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setSaveError(
          err instanceof Error ? err.message : "Failed to save. Please try again."
        );
      })
      .finally(() => setSaving(false));
  }

  // ── Prepare for stamping action ───────────────────────────────────

  function handlePrepare() {
    if (!job) return;
    setPreparing(true);
    setPrepareError(null);

    fetch(`/api/intake/${job.id}/prepare`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ??
              "Preparation failed. Please try again."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setPrepareError(
          err instanceof Error
            ? err.message
            : "Preparation failed. Please try again."
        );
      })
      .finally(() => setPreparing(false));
  }

  // ── Transition action ─────────────────────────────────────────────

  function handleTransition(targetStatus: string) {
    if (!job) return;
    setTransitioning(true);
    setTransitionError(null);

    fetch(`/api/intake/${job.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStatus }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Action failed. Please try again.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setTransitionError(
          err instanceof Error ? err.message : "Action failed. Please try again."
        );
      })
      .finally(() => setTransitioning(false));
  }

  // ── Draft submission payload action ─────────────────────────────

  function handleDraftPayload() {
    if (!job) return;
    setDraftingPayload(true);
    setPayloadError(null);

    fetch(`/api/intake/${job.id}/payload`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Failed to prepare submission data. Please try again.");
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setPayloadError(
          err instanceof Error ? err.message : "Failed to prepare submission data. Please try again."
        );
      })
      .finally(() => setDraftingPayload(false));
  }

  // ── Initialize execution layer action ────────────────────────────

  function handleInitializeExecution() {
    if (!job) return;
    setInitializingExecution(true);
    setExecutionError(null);

    fetch(`/api/intake/${job.id}/execute`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Failed to initialize execution layer. Please try again."
          );
        }
        return res.json();
      })
      .then((updated) => {
        setJob(updated as StampingJob);
      })
      .catch((err) => {
        setExecutionError(
          err instanceof Error
            ? err.message
            : "Failed to initialize execution layer. Please try again."
        );
      })
      .finally(() => setInitializingExecution(false));
  }

  // ── Render ───────────────────────────────────────────────────────

  const isTenancy = job.documentCategory === "tenancy_agreement";
  // Nominal-duty assisted lane lookup. `null` for tenancy or any
  // category not in the nominal-duty registry. Drives the shared
  // operator handling panel below — not a substitute for operator
  // confirmation.
  const nominalDutyEntry = getNominalDutyEntry(job.documentCategory);
  const isNominalDuty = nominalDutyEntry !== null;
  const needsDetails = isTenancy && job.status === "uploaded";
  const hasDetails = isTenancy && !!job.stampingDetails;
  const canPrepare = isTenancy && job.status === "intake_reviewed";
  const isPrepared = isTenancy && job.status === "prepared";
  const isReady = isTenancy && job.status === "ready_for_submission";
  const isManualReview = job.status === "manual_review_required";
  const isFailed = job.status === "failed";

  let pageHeading = "Signed Document Intake Saved";
  if (isPrepared) pageHeading = "Stamping Preparation Complete";
  if (isReady) pageHeading = "Stamping Workflow Ready";
  if (isManualReview) pageHeading = "Manual Review Required";
  if (isFailed) pageHeading = "Unable to Continue";

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <a href="/" className="back-link">
          &larr; Back to Home
        </a>
        {fromQueue && (
          <a href={fromQueue} className="back-link">
            &larr; Back to jobs queue
          </a>
        )}
      </div>
      <h1>{pageHeading}</h1>

      {/* ── Pilot safety banner ───────────────────────────────────────
          Persistent, page-level reminder that every panel on this
          operator view is internal/advisory. Many sections below
          ("Portal Draft", "Automation Plan", "Browser Instruction
          Set", "Mock Execution", etc.) read as if they could act on
          the live portal — they do not. Individual panels still carry
          their own scoped disclaimers; this banner is the single
          always-visible reminder so an operator cannot miss it. */}
      <div
        role="note"
        aria-label="Internal advisory view — no live portal actions are performed"
        style={{
          marginTop: 12,
          marginBottom: 16,
          padding: "10px 12px",
          border: "1px solid #f1b27a",
          borderLeft: "4px solid #d97706",
          background: "#fff8ec",
          borderRadius: 4,
          fontSize: 13,
          lineHeight: 1.45,
          color: "#4a3108",
        }}
      >
        <strong style={{ display: "block", marginBottom: 2 }}>
          Internal advisory view — no live portal actions.
        </strong>
        Nothing on this page has been submitted to e-Duti Setem. No
        payment has been made. No certificate has been retrieved. All
        panels below (Portal Draft, Automation Plan, Browser
        Instruction Set, Mock Execution, and similar) describe WeStamp&rsquo;s
        internal preparation state only.
        {/* Operator pointer to the pilot SOP + checklist.
            Kept inside the existing amber banner so it adds zero
            extra page chrome. Points at repo-relative paths — the
            hosted UI does not serve docs; operators read them at
            source, same as setup.md / supabase-cutover-runbook.md. */}
        <span
          style={{
            display: "block",
            marginTop: 6,
            fontSize: 12,
            color: "#6b4a0a",
          }}
        >
          Operator reference: <code>docs/pilot-operator-sop.md</code>{" "}
          (full SOP) &middot;{" "}
          <code>docs/pilot-operator-checklist.md</code> (in-flight
          checklist).
        </span>
      </div>

      {/* ── Record summary ──────────────────────────────────────────── */}
      <div className="intake-details-card">
        <div className="intake-details-row">
          <span className="intake-details-label">Intake Reference</span>
          <span className="intake-details-value intake-ref">{job.id}</span>
        </div>
        <div className="intake-details-row">
          <span className="intake-details-label">File</span>
          <span className="intake-details-value">
            {job.originalFileName}
            {/* Operator-only link to the uploaded source PDF. Served
                by GET /api/intake/[id]/source-download, which is
                gated by the operator-session middleware. Works across
                all lanes (tenancy / nominal-duty / other). */}
            {job.storagePath && (
              <>
                {" "}
                <a
                  href={`/api/intake/${job.id}/source-download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12,
                    color: "#0066cc",
                    marginLeft: 6,
                  }}
                >
                  View Uploaded PDF
                </a>
              </>
            )}
          </span>
        </div>
        <div className="intake-details-row">
          <span className="intake-details-label">Format</span>
          <span className="intake-details-value">
            PDF ({fileSizeKB} KB)
          </span>
        </div>
        <div className="intake-details-row">
          <span className="intake-details-label">Category</span>
          <span className="intake-details-value">
            {CATEGORY_LABELS[job.documentCategory] ?? job.documentCategory}
          </span>
        </div>
        <div className="intake-details-row">
          <span className="intake-details-label">Status</span>
          <span
            className={`intake-status-badge intake-status-${job.status}`}
          >
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
        </div>
        <div className="intake-details-row">
          <span className="intake-details-label">Saved</span>
          <span className="intake-details-value">{createdAt}</span>
        </div>
      </div>

      {/* ── Operator Command Centre ──────────────────────────────────
          Compact operational summary placed near the top of the page
          so an operator can see lane, status, public status, what to
          do next, and the headline payment / certificate / user-
          confirmation indicators without scrolling through the
          diagnostic stack. The wording is operational, not technical:
          no automation jargon, no "submitted to portal" claims, no
          fixed-duty assumptions for General/Other.
          The next-action line is derived per lane (tenancy / nominal-
          duty registry / other) and is intentionally a single string
          aimed at the next handling decision. */}
      {(() => {
        // ── Derived: public status ────────────────────────────────
        // Mirrors what the user sees on /receipt/[id]. Operator can
        // glance at this to keep operator-side and user-side narratives
        // aligned.
        const publicStatusLabel = derivePublicStatus({
          status: job.status,
          fulfilmentState: job.fulfilmentState
            ? {
                delivered: job.fulfilmentState.delivered,
                certificateStatus: job.fulfilmentState.certificateStatus,
                paymentStatus: job.fulfilmentState.paymentStatus,
              }
            : null,
        });

        // ── Derived: handling lane ────────────────────────────────
        let handlingLane = "Tenancy (sewa_pajakan)";
        if (isNominalDuty && nominalDutyEntry) {
          handlingLane = `${nominalDutyEntry.internalLabel} · ${nominalDutyEntry.handlingModeLabel}`;
        } else if (job.documentCategory === "other") {
          handlingLane = "Other / Not Sure — classify before proceeding";
        }

        // ── Derived: user-confirmation indicator ──────────────────
        // The full user-confirmation flow does not exist yet; this
        // line acknowledges the future shape without promising it.
        let userConfirmation = "Not yet required";
        if (job.nominalDutyState === "awaiting_user") {
          userConfirmation = "Yes — waiting for user reply";
        } else if (job.nominalDutyState === "cannot_proceed") {
          userConfirmation = "Action needed — see internal note";
        } else if (job.fulfilmentState?.delivered === true) {
          userConfirmation = "Not applicable — delivered";
        }

        // ── Derived: payment indicator ────────────────────────────
        let paymentIndicator = "Not yet started";
        const fs = job.fulfilmentState;
        if (fs?.paymentStatus === "awaiting_payment") {
          paymentIndicator = "Pending — awaiting operator action";
        } else if (fs?.paymentStatus === "payment_marked_done") {
          paymentIndicator = fs.paymentMarkedAt
            ? `Paid (recorded ${new Date(fs.paymentMarkedAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })})`
            : "Paid";
        } else if (fs?.paymentStatus === "not_applicable") {
          paymentIndicator = "Not applicable";
        }

        // ── Derived: certificate indicator ────────────────────────
        let certificateIndicator = "Not yet issued";
        if (fs?.delivered === true) {
          certificateIndicator = "Delivered";
        } else if (fs?.certificateStatus === "certificate_retrieved") {
          certificateIndicator = "Retrieved — ready to mark delivered";
        } else if (fs?.certificateStatus === "waiting_for_certificate") {
          certificateIndicator = "Pending — waiting for certificate";
        }

        // ── Derived: next operator action ─────────────────────────
        // Lane-aware. Order is most-specific-first (delivered ends
        // the chain). Wording is operational, not technical.
        let nextAction = "Open the record below.";
        if (isManualReview) {
          nextAction = "Manual review required. Review the record below.";
        } else if (isFailed) {
          nextAction = "Job marked failed. Review the record below.";
        } else if (fs?.delivered === true) {
          nextAction = "Delivered. No further action required.";
        } else if (fs?.certificateStatus === "certificate_retrieved") {
          nextAction = "Certificate retrieved. Mark delivered when ready.";
        } else if (fs?.certificateStatus === "waiting_for_certificate") {
          nextAction = "Waiting for certificate. Upload it when received.";
        } else if (fs?.paymentStatus === "awaiting_payment") {
          nextAction = fs.adjudicationNumber
            ? "Adjudication recorded. Mark payment done when paid."
            : "Record adjudication number, then mark payment done.";
        } else if (job.nominalDutyState === "awaiting_user") {
          nextAction =
            "Awaiting user reply. Follow up if too much time has passed.";
        } else if (job.nominalDutyState === "cannot_proceed") {
          nextAction =
            "Job cannot proceed on the assisted path. See internal note.";
        } else if (isNominalDuty) {
          // Registry categories: review the document face, confirm
          // category, advance the internal lifecycle. No portal
          // automation runs for these jobs.
          if (
            !job.nominalDutyState ||
            job.nominalDutyState === "received"
          ) {
            nextAction =
              "Verify document face, confirm category, then move handling state to under review.";
          } else if (job.nominalDutyState === "under_review") {
            nextAction =
              "Continue review. When ready, proceed to fulfilment via e-Duti Setem.";
          } else if (job.nominalDutyState === "external_portal_in_progress") {
            nextAction =
              "External e-Duti Setem work in progress. Record adjudication when issued.";
          } else if (job.nominalDutyState === "completed") {
            nextAction =
              "External stamping complete. Continue with payment / certificate fulfilment.";
          }
        } else if (job.documentCategory === "other") {
          // General / Not Sure: never assumed RM10. Classify first.
          nextAction =
            "Classify this document before proceeding. Do not assume fixed duty.";
        } else if (job.documentCategory === "tenancy_agreement") {
          // Tenancy lane progression hints, ordered.
          if (job.status === "uploaded") {
            nextAction =
              "Review extracted values, then capture stamping details.";
          } else if (job.status === "intake_reviewed") {
            nextAction = "Confirm preparation, then mark ready.";
          } else if (job.status === "prepared") {
            nextAction = "Mark ready for the next preparation step.";
          } else if (job.status === "ready_for_submission") {
            nextAction =
              "Proceed with portal preparation and fulfilment via e-Duti Setem.";
          }
        }

        return (
          <section
            className="operator-command-centre"
            aria-label="Operator command centre — operational summary"
          >
            <header className="op-cc-header">
              <h2>Operator Command Centre</h2>
              <a className="op-cc-back" href="/jobs">
                ← Back to /jobs queue
              </a>
            </header>
            <p className="op-cc-intro">
              Operational summary. Day-to-day handling normally needs
              only this block. Detailed engineering panels remain
              available below under Advanced / Diagnostics.
            </p>

            <dl className="op-cc-grid">
              <div className="op-cc-cell">
                <dt>Category</dt>
                <dd>
                  {CATEGORY_LABELS[job.documentCategory] ??
                    job.documentCategory}
                </dd>
              </div>
              <div className="op-cc-cell">
                <dt>Handling lane</dt>
                <dd>{handlingLane}</dd>
              </div>
              <div className="op-cc-cell">
                <dt>Internal status</dt>
                <dd>
                  <span
                    className={`intake-status-badge intake-status-${job.status}`}
                  >
                    {STATUS_LABELS[job.status] ?? job.status}
                  </span>
                </dd>
              </div>
              <div className="op-cc-cell">
                <dt>Public status</dt>
                <dd>
                  <span className="op-cc-public-status">
                    {publicStatusLabel}
                  </span>
                  <span className="op-cc-public-status-hint">
                    {" "}
                    (what the user sees)
                  </span>
                </dd>
              </div>
              <div className="op-cc-cell">
                <dt>User confirmation</dt>
                <dd>{userConfirmation}</dd>
              </div>
              <div className="op-cc-cell">
                <dt>Payment</dt>
                <dd>{paymentIndicator}</dd>
              </div>
              <div className="op-cc-cell">
                <dt>Certificate</dt>
                <dd>{certificateIndicator}</dd>
              </div>
              <div className="op-cc-cell op-cc-cell-link">
                <dt>Uploaded source</dt>
                <dd>
                  {job.storagePath ? (
                    <a
                      href={`/api/intake/${job.id}/source-download`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View Uploaded PDF
                    </a>
                  ) : (
                    <span style={{ color: "#999" }}>—</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="op-cc-next-action">
              <span className="op-cc-next-action-label">
                Next operator action
              </span>
              <p className="op-cc-next-action-text">{nextAction}</p>
            </div>
          </section>
        );
      })()}

      {/* ── Nominal Duty Handling (internal, operator-only) ──────────
          Repositioned to appear immediately after the record summary
          so nominal-duty operators (Employment Contract, Statutory
          Declaration, future admitted categories) reach their
          meaningful handling controls without scrolling through
          tenancy/advisory stacks that do not apply to them.

          Registry-driven assisted handling panel. Rendered for any
          document category in `nominal-duty-registry.ts`. Entries
          share one handling model so new nominal/fixed-duty-style
          categories can be added without duplicating UI.

          Registry contents at time of writing: Employment Contract
          and Statutory Declaration. The authoritative list lives in
          `src/lib/nominal-duty-registry.ts` — this panel renders
          whatever is in that registry, so no code change here is
          needed when a new admitted category is added. All such
          categories are taken through e-Duti Setem manually by the
          operator — they are NOT part of the sewa_pajakan advisory
          stack (Proven Hantar Gate Chain, lane readiness gates,
          Bahagian C preflights). The "Likely nominal/fixed-duty"
          framing is deliberately tentative: duty is confirmed by
          the operator against the live portal and the document
          itself, not assumed. */}
      {nominalDutyEntry && !isManualReview && !isFailed && (
        <div
          className="intake-details-card"
          style={{ marginTop: 16 }}
          role="region"
          aria-label={`${nominalDutyEntry.internalLabel} — nominal duty assisted handling, internal operator view`}
        >
          <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>
            Nominal Duty Handling &middot; {nominalDutyEntry.internalLabel}
          </h2>
          <p style={{ fontSize: 12, color: "#78716c", margin: "0 0 12px" }}>
            Internal operator view. Nothing here has been submitted,
            paid, or certified.
          </p>

          <div className="intake-details-row">
            <span className="intake-details-label">Category</span>
            <span className="intake-details-value">
              {nominalDutyEntry.internalLabel}
            </span>
          </div>
          <div className="intake-details-row">
            <span className="intake-details-label">Handling mode</span>
            <span className="intake-details-value">
              {nominalDutyEntry.handlingModeLabel}
            </span>
          </div>
          <div className="intake-details-row">
            <span className="intake-details-label">Duty profile</span>
            <span className="intake-details-value">
              {nominalDutyEntry.dutyFramingLabel}
            </span>
          </div>
          <div className="intake-details-row">
            <span className="intake-details-label">Portal path</span>
            <span className="intake-details-value">
              Handled manually in e-Duti Setem (not via the
              sewa_pajakan advisory stack)
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                margin: "0 0 6px",
                color: "#3f3f46",
              }}
            >
              Operator must confirm before proceeding
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                lineHeight: 1.6,
                color: "#3f3f46",
              }}
            >
              {nominalDutyEntry.operatorConfirmationBullets.map(
                (bullet, i) => (
                  <li key={i}>{bullet}</li>
                )
              )}
            </ul>
          </div>

          <div style={{ marginTop: 12 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                margin: "0 0 6px",
                color: "#3f3f46",
              }}
            >
              Stop and contact user if
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                fontSize: 13,
                lineHeight: 1.6,
                color: "#3f3f46",
              }}
            >
              {nominalDutyEntry.stopTriggers.map((trigger, i) => (
                <li key={i}>{trigger}</li>
              ))}
            </ul>
          </div>

          {/* ── Internal handling state (operator-only lifecycle) ──────
              Minimal, truthful internal lifecycle for nominal-duty
              registry jobs. Phrased to avoid implying automation,
              portal submission, payment, or certificate retrieval.
              This is NOT surfaced on the public receipt — the public
              status is still driven by `status` + `fulfilmentState`
              via `derivePublicStatus`, not by this field. Operators
              use it to reflect real progress (e.g. "under review",
              "external portal in progress", "completed —
              operator-attested") that would otherwise leave the job
              stuck at "Uploaded" for its entire handling. */}
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#fff",
              border: "1px solid #e7e5e4",
              borderRadius: 4,
            }}
          >
            <h3
              style={{
                fontSize: 14,
                margin: "0 0 4px",
                color: "#292524",
              }}
            >
              Internal handling state
            </h3>
            <p
              style={{
                fontSize: 12,
                color: "#78716c",
                margin: "0 0 12px",
                lineHeight: 1.5,
              }}
            >
              Reflects what the operator is actually doing with this
              job. This is an internal lifecycle only — it is not
              e-Duti Setem automation, not a public-completion signal,
              and does not change the public receipt status. The
              public receipt still reads &quot;Received&quot; until
              the operator marks fulfilment delivered via the
              existing fulfilment controls.
            </p>

            <div className="intake-details-row">
              <span className="intake-details-label">Current state</span>
              <span className="intake-details-value">
                {
                  NOMINAL_DUTY_STATE_LABELS[
                    job.nominalDutyState ?? "received"
                  ]
                }
              </span>
            </div>
            <p
              style={{
                fontSize: 12,
                color: "#57534e",
                margin: "4px 0 8px",
                lineHeight: 1.5,
              }}
            >
              {
                NOMINAL_DUTY_STATE_DESCRIPTIONS[
                  job.nominalDutyState ?? "received"
                ]
              }
            </p>
            {job.nominalDutyStateUpdatedAt && (
              <div className="intake-details-row">
                <span className="intake-details-label">Last updated</span>
                <span className="intake-details-value">
                  {new Date(job.nominalDutyStateUpdatedAt).toLocaleString()}
                </span>
              </div>
            )}
            {job.nominalDutyStateNote && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  background: "#fafaf9",
                  border: "1px solid #e7e5e4",
                  borderRadius: 4,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "#3f3f46",
                  whiteSpace: "pre-wrap",
                }}
              >
                <strong style={{ display: "block", marginBottom: 2 }}>
                  Latest operator note
                </strong>
                {job.nominalDutyStateNote}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="nominal-duty-state-select"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#3f3f46",
                  marginBottom: 4,
                }}
              >
                Update internal state
              </label>
              <select
                id="nominal-duty-state-select"
                value={nominalDutySelectedState}
                onChange={(e) =>
                  setNominalDutySelectedState(
                    e.target.value as NominalDutyState
                  )
                }
                disabled={nominalDutySaving}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: 13,
                  border: "1px solid #d6d3d1",
                  borderRadius: 4,
                  background: "#fff",
                }}
              >
                {NOMINAL_DUTY_STATE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {NOMINAL_DUTY_STATE_LABELS[s]}
                  </option>
                ))}
              </select>

              <label
                htmlFor="nominal-duty-state-note"
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#3f3f46",
                  margin: "10px 0 4px",
                }}
              >
                Operator note (optional,{" "}
                {NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH}-char limit)
              </label>
              <textarea
                id="nominal-duty-state-note"
                value={nominalDutyNoteInput}
                onChange={(e) => setNominalDutyNoteInput(e.target.value)}
                disabled={nominalDutySaving}
                maxLength={NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH}
                rows={3}
                placeholder="Short internal note for the audit log (e.g. what was checked, what you asked the user)."
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: 13,
                  border: "1px solid #d6d3d1",
                  borderRadius: 4,
                  background: "#fff",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <p
                style={{
                  fontSize: 11,
                  color: "#78716c",
                  margin: "2px 0 0",
                  textAlign: "right",
                }}
              >
                {nominalDutyNoteInput.length}/
                {NOMINAL_DUTY_STATE_NOTE_MAX_LENGTH}
              </p>

              <button
                type="button"
                onClick={handleSaveNominalDutyState}
                disabled={nominalDutySaving}
                style={{
                  marginTop: 8,
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: nominalDutySaving ? "#a8a29e" : "#44403c",
                  border: "none",
                  borderRadius: 4,
                  cursor: nominalDutySaving ? "default" : "pointer",
                }}
              >
                {nominalDutySaving
                  ? "Saving…"
                  : "Update internal state"}
              </button>

              {nominalDutyError && (
                <p
                  style={{
                    fontSize: 12,
                    color: "#b91c1c",
                    margin: "8px 0 0",
                  }}
                  role="alert"
                >
                  {nominalDutyError}
                </p>
              )}
            </div>

            <p
              style={{
                fontSize: 11,
                color: "#78716c",
                margin: "12px 0 0",
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              Each update is appended to the job&apos;s event log as a
              timestamped <code>nominal_duty_state_changed</code>{" "}
              entry. Selecting &quot;Completed&quot; is an operator
              attestation that external e-Duti Setem stamping was
              done — WeStamp does not detect this automatically.
            </p>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "#fafaf9",
              border: "1px solid #e7e5e4",
              borderRadius: 4,
              fontSize: 12,
              lineHeight: 1.5,
              color: "#57534e",
            }}
          >
            <strong style={{ display: "block", marginBottom: 2 }}>
              Sewa/Pajakan portal evidence does not apply here.
            </strong>
            {NOMINAL_DUTY_SEWA_PAJAKAN_SEPARATION_NOTE} Follow the
            Nominal Fixed-Duty section of{" "}
            <code>docs/pilot-operator-sop.md</code> and{" "}
            <code>docs/pilot-operator-checklist.md</code>.
          </div>

          <p
            style={{
              fontSize: 12,
              color: "#78716c",
              margin: "12px 0 0",
              fontStyle: "italic",
            }}
          >
            If any confirmation above fails, stop and contact the user
            per the SOP before touching the portal. Do not represent
            this job as submitted, paid, or certified until those
            steps are actually performed.
          </p>
        </div>
      )}

      {/* ── STSDS Portal Routing ──────────────────────────────────── */}
      {/* Hidden for nominal-duty registry categories (e.g. Employment
          Contract, Statutory Declaration). Those are handled manually
          by the operator in e-Duti Setem per SOP §4A; they do not go
          through the sewa_pajakan advisory stack, and the catalogue
          search / Build Portal Draft flow below does not apply to
          them. The dedicated "Nominal Duty Handling" panel above
          (immediately after the record summary) is the correct
          anchor for those jobs. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="routing-section">
          <h2 className="routing-heading">Portal Routing</h2>

          {/* Show existing routing suggestion if saved */}
          {job.routingSuggestion ? (
            <div className="routing-saved">
              <div className="intake-details-card">
                <div className="intake-details-row">
                  <span className="intake-details-label">Suggested Lane</span>
                  <span className="intake-details-value">
                    {job.routingSuggestion.suggestedLane === "sewa_pajakan"
                      ? "Sewa / Pajakan (Lease / Tenancy)"
                      : "Penyetemen Am (General Stamping)"}
                  </span>
                </div>
                {job.routingSuggestion.suggestedPortalDocumentName && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">
                      Portal Document Name
                    </span>
                    <span className="intake-details-value">
                      {job.routingSuggestion.suggestedPortalDocumentName}
                    </span>
                  </div>
                )}
                {job.routingSuggestion.expectedDerivedDocumentGroup && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">
                      Expected Derived Document Group
                    </span>
                    <span className="intake-details-value routing-derived-category">
                      {job.routingSuggestion.expectedDerivedDocumentGroup}
                      <span className="routing-readonly-badge">Read-only</span>
                    </span>
                  </div>
                )}
                {job.routingSuggestion.observedEditableInstrumentCategory && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">
                      Editable Instrument Category
                    </span>
                    <span className="intake-details-value">
                      {job.routingSuggestion.observedEditableInstrumentCategory}
                    </span>
                  </div>
                )}
                <div className="intake-details-row">
                  <span className="intake-details-label">Source</span>
                  <span className="intake-details-value">
                    {job.routingSuggestion.source === "category_match"
                      ? "Auto-suggested from document category"
                      : "Selected from catalogue search"}
                    {" "}
                    ({job.routingSuggestion.confidence} confidence)
                  </span>
                </div>
              </div>
              <p className="routing-note">
                This is a suggestion only and has not been confirmed with the
                e-Duti Setem portal. Actual portal behaviour may differ.
              </p>

              {/* Build / update portal draft button */}
              {!job.portalDraft && (
                <div style={{ marginTop: 12 }}>
                  {portalDraftError && (
                    <p className="field-error" style={{ marginBottom: 8 }}>
                      {portalDraftError}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleBuildPortalDraft}
                    disabled={draftingPortal}
                  >
                    {draftingPortal
                      ? "Building\u2026"
                      : "Build Portal Draft"}
                  </button>
                </div>
              )}
            </div>
          ) : routingSaving ? (
            <p className="routing-loading">Determining portal routing&hellip;</p>
          ) : (
            /* Show search for non-tenancy documents without routing */
            !isTenancy && (
              <div className="routing-search">
                <p className="routing-search-intro">
                  Search for the document type to determine the correct e-Duti
                  Setem portal lane and instrument name.
                </p>
                <div className="form-group">
                  <label htmlFor="routing-search">
                    Search STSDS Document Catalogue
                  </label>
                  <input
                    id="routing-search"
                    type="text"
                    value={routingSearchQuery}
                    onChange={(e) => setRoutingSearchQuery(e.target.value)}
                    placeholder="e.g. Power of Attorney, Loan Agreement"
                    disabled={routingSaving}
                  />
                </div>
                {routingSearching && (
                  <p className="routing-loading">Searching&hellip;</p>
                )}
                {routingError && (
                  <p className="field-error">{routingError}</p>
                )}
                {!routingSearching &&
                  routingSearchResults.length > 0 && (
                    <div className="routing-results">
                      {routingSearchResults.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="routing-result-item"
                          onClick={() => handleSelectRoutingDocument(r)}
                          disabled={routingSaving}
                        >
                          <span className="routing-result-name">
                            {r.portalDocumentName}
                          </span>
                          <span className="routing-result-meta">
                            {r.expectedDerivedDocumentGroup
                              ? `Group: ${r.expectedDerivedDocumentGroup}`
                              : "Group: Unknown"}
                            {r.observedEditableInstrumentCategory
                              ? ` | Category: ${r.observedEditableInstrumentCategory}`
                              : ""}
                            {r.mappingEvidence.confidence === "observed"
                              ? " | Observed"
                              : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                {!routingSearching &&
                  routingSearchQuery.trim().length > 0 &&
                  routingSearchResults.length === 0 && (
                    <p className="routing-no-results">
                      No matching documents found. Try a different search term.
                    </p>
                  )}
              </div>
            )
          )}
        </div>
      )}

      {/* ── STSDS Portal Draft ─────────────────────────────────────── */}
      {job.portalDraft && (
        <div className="portal-draft-section">
          <h2 className="portal-draft-heading">STSDS Portal Draft</h2>
          <p className="portal-draft-intro">
            WeStamp has prepared the current portal draft for this job
            based on the available information.
          </p>

          {/* ── Draft readiness indicator ─────────────────────── */}
          <div className={`portal-draft-readiness ${
            job.portalDraft.status === "ready_for_review"
              ? "portal-draft-readiness-ready"
              : "portal-draft-readiness-incomplete"
          }`}>
            {job.portalDraft.status === "ready_for_review"
              ? "Draft Ready for Review"
              : "Draft Incomplete"}
            {portalDraftValidation &&
              !portalDraftValidation.isComplete &&
              portalDraftValidation.missingFields.length > 0 && (
                <span className="portal-draft-missing">
                  {" \u2014 Missing: "}
                  {portalDraftValidation.missingFields.join(", ")}
                </span>
              )}
          </div>

          <div className="intake-details-card">
            <div className="intake-details-row">
              <span className="intake-details-label">Lane</span>
              <span className="intake-details-value">
                {job.portalDraft.lane === "sewa_pajakan"
                  ? "Sewa / Pajakan (Lease / Tenancy)"
                  : "Penyetemen Am (General Stamping)"}
              </span>
            </div>

            {/* ── Penyeteman Am read-only fields ─────────────── */}
            {job.portalDraft.maklumatAmPenyetemanAm && (
              <>
                <div className="intake-details-row">
                  <span className="intake-details-label">
                    Portal Document Name
                  </span>
                  <span className="intake-details-value routing-derived-category">
                    {job.portalDraft.maklumatAmPenyetemanAm.portalDocumentName ||
                      "Not set"}
                    <span className="routing-readonly-badge">Read-only</span>
                  </span>
                </div>
                {job.portalDraft.maklumatAmPenyetemanAm
                  .expectedDerivedDocumentGroup && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">
                      Expected Derived Document Group
                    </span>
                    <span className="intake-details-value routing-derived-category">
                      {
                        job.portalDraft.maklumatAmPenyetemanAm
                          .expectedDerivedDocumentGroup
                      }
                      <span className="routing-readonly-badge">Read-only</span>
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── Sewa / Pajakan read-only fields ──────────── */}
            {job.portalDraft.maklumatAmSewaPajakan && (
              <>
                {job.portalDraft.maklumatAmSewaPajakan.monthlyRent != null && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Monthly Rent</span>
                    <span className="intake-details-value">
                      {formatRM(
                        job.portalDraft.maklumatAmSewaPajakan.monthlyRent
                      )}
                    </span>
                  </div>
                )}
                {job.portalDraft.maklumatAmSewaPajakan.leaseMonths != null && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">
                      Lease Duration
                    </span>
                    <span className="intake-details-value">
                      {job.portalDraft.maklumatAmSewaPajakan.leaseMonths} months
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ── Duty Summary ──────────────────────────── */}
            {job.portalDraft.dutySummary &&
              job.portalDraft.dutySummary.totalPayable != null && (
                <>
                  <div className="intake-details-row">
                    <span className="intake-details-label">Payable Duty</span>
                    <span className="intake-details-value">
                      {formatRM(
                        job.portalDraft.dutySummary.payableDuty ?? 0
                      )}
                    </span>
                  </div>
                  {job.portalDraft.dutySummary.duplicateCopyAmount != null &&
                    job.portalDraft.dutySummary.duplicateCopyAmount > 0 && (
                      <div className="intake-details-row">
                        <span className="intake-details-label">
                          Duplicate Copy Amount
                        </span>
                        <span className="intake-details-value">
                          {formatRM(
                            job.portalDraft.dutySummary.duplicateCopyAmount
                          )}
                        </span>
                      </div>
                    )}
                  {job.portalDraft.dutySummary.penaltyAmount != null &&
                    job.portalDraft.dutySummary.penaltyAmount > 0 && (
                      <div className="intake-details-row">
                        <span className="intake-details-label">
                          Penalty Amount
                        </span>
                        <span className="intake-details-value">
                          {formatRM(
                            job.portalDraft.dutySummary.penaltyAmount
                          )}
                        </span>
                      </div>
                    )}
                  <div className="intake-details-row">
                    <span className="intake-details-label">Total Payable</span>
                    <span className="intake-details-value">
                      {formatRM(job.portalDraft.dutySummary.totalPayable)}
                    </span>
                  </div>
                </>
              )}
          </div>

          {/* ── Editable portal draft fields ─────────────────── */}
          <div className="portal-draft-edit-section">
            <h3 className="portal-draft-edit-heading">Portal Input Fields</h3>
            <p className="portal-draft-edit-intro">
              Enter the values that WeStamp will use when submitting to the
              e-Duti Setem portal. Stamp Office and Instrument Date are required.
            </p>

            <div className="form-group">
              <label htmlFor="pd-stamp-office">
                Stamp Office{" "}
                <span className="label-hint">(required)</span>
              </label>
              <input
                id="pd-stamp-office"
                type="text"
                value={pdStampOffice}
                onChange={(e) => setPdStampOffice(e.target.value)}
                placeholder="e.g. Kuala Lumpur, Petaling Jaya"
                disabled={savingPortalDraft}
              />
            </div>

            <div className="form-group">
              <label htmlFor="pd-instrument-date">
                Instrument Date{" "}
                <span className="label-hint">(required, YYYY-MM-DD)</span>
              </label>
              <input
                id="pd-instrument-date"
                type="text"
                value={pdInstrumentDate}
                onChange={(e) => setPdInstrumentDate(e.target.value)}
                placeholder="e.g. 2025-01-15"
                disabled={savingPortalDraft}
              />
            </div>

            <div className="form-group">
              <label htmlFor="pd-received-date">
                Received in Malaysia Date{" "}
                <span className="label-hint">
                  (if signed abroad, YYYY-MM-DD)
                </span>
              </label>
              <input
                id="pd-received-date"
                type="text"
                value={pdReceivedDate}
                onChange={(e) => setPdReceivedDate(e.target.value)}
                placeholder="Leave blank if signed in Malaysia"
                disabled={savingPortalDraft}
              />
            </div>

            {/* Editable Instrument Category — penyeteman_am only */}
            {job.portalDraft.lane === "penyeteman_am" && (
              <div className="form-group">
                <label htmlFor="pd-editable-category">
                  Editable Instrument Category{" "}
                  <span className="label-hint">(Kategori Surat Cara)</span>
                </label>
                <input
                  id="pd-editable-category"
                  type="text"
                  value={pdEditableCategory}
                  onChange={(e) => setPdEditableCategory(e.target.value)}
                  placeholder="e.g. Prinsipal"
                  disabled={savingPortalDraft}
                />
                {job.portalDraft.maklumatAmPenyetemanAm?.editableInstrumentCategory &&
                  !pdEditableCategory && (
                    <p className="portal-draft-prefill-note">
                      Prefilled from observed mapping:{" "}
                      {job.portalDraft.maklumatAmPenyetemanAm.editableInstrumentCategory}
                    </p>
                  )}
              </div>
            )}

            {portalDraftSaveError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {portalDraftSaveError}
              </p>
            )}

            <button
              type="button"
              onClick={handleSavePortalDraft}
              disabled={savingPortalDraft}
            >
              {savingPortalDraft ? "Saving\u2026" : "Save Portal Draft"}
            </button>
          </div>

          {/* Mapping evidence indicator */}
          {job.portalDraft.mappingEvidence && (
            <p className="portal-draft-evidence">
              {job.portalDraft.mappingEvidence.confidence === "observed"
                ? "Observed portal mapping available"
                : job.portalDraft.mappingEvidence.confidence === "partial"
                  ? "Partial portal mapping available"
                  : "Portal mapping not yet observed"}
              {job.portalDraft.mappingEvidence.observedAt &&
                ` (${job.portalDraft.mappingEvidence.observedAt})`}
            </p>
          )}

          <p className="portal-draft-disclaimer">
            This draft has not been submitted to e-Duti Setem.
          </p>

          {/* Rebuild draft from job data button */}
          <div style={{ marginTop: 10 }}>
            {portalDraftError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {portalDraftError}
              </p>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleBuildPortalDraft}
              disabled={draftingPortal}
            >
              {draftingPortal ? "Rebuilding\u2026" : "Rebuild Draft from Job Data"}
            </button>
          </div>
        </div>
      )}

      {/* ── STSDS Refresh ─────────────────────────────────────── */}
      {job.routingSuggestion && !isManualReview && !isFailed && (
        <div style={{ marginTop: 8, marginBottom: 16, padding: "8px 0" }}>
          <p style={{ fontSize: 12, color: "#a8a29e", margin: "0 0 6px" }}>
            Rebuilds internal STSDS draft, readiness, preview, and plan from
            current job data.
          </p>
          {stsdsRefreshMsg && (
            <p style={{ fontSize: 12, color: "#16a34a", margin: "0 0 6px" }}>{stsdsRefreshMsg}</p>
          )}
          {stsdsRefreshError && (
            <p className="field-error" style={{ fontSize: 12, margin: "0 0 6px" }}>{stsdsRefreshError}</p>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleStsdsRefresh}
            disabled={refreshingStsds}
            style={{ fontSize: 13 }}
          >
            {refreshingStsds ? "Refreshing\u2026" : "Refresh STSDS Internal State"}
          </button>
        </div>
      )}

      {/* ── Portal Preparation Inputs ────────────────────────────
          Hidden for nominal-duty registry jobs: they are handled
          manually in e-Duti Setem and never accumulate portal-facing
          preparation data, so this panel would render empty for
          them and only add scroll noise. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="preparation-inputs-section">
          <h2 className="preparation-inputs-heading">
            Portal Preparation Inputs
          </h2>
          <p style={{ fontSize: 13, color: "#78716c", marginBottom: 4 }}>
            Structured internal inputs currently prepared for portal work on this job.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            These inputs have not been entered into live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Preparation inputs are not available.
            </p>
          ) : (
            <>
              {/* Lane context */}
              <div className="intake-details-card">
                <div className="intake-details-row">
                  <span className="intake-details-label">Lane</span>
                  <span className="intake-details-value">
                    {job.routingSuggestion.suggestedLane === "penyeteman_am"
                      ? "Penyeteman Am (p8)"
                      : "Sewa / Pajakan (p5)"}
                  </span>
                </div>

                {/* penyeteman_am-specific: document name / group / category */}
                {job.routingSuggestion.suggestedLane === "penyeteman_am" && (
                  <>
                    <div className="intake-details-row">
                      <span className="intake-details-label">Portal Document Name</span>
                      <span className="intake-details-value">
                        {job.routingSuggestion.suggestedPortalDocumentName ?? (
                          <span style={{ color: "#999", fontStyle: "italic" }}>Not prepared yet</span>
                        )}
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">Expected Derived Document Group</span>
                      <span className="intake-details-value">
                        {job.routingSuggestion.expectedDerivedDocumentGroup ?? (
                          <span style={{ color: "#999", fontStyle: "italic" }}>Not prepared yet</span>
                        )}
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">Editable Instrument Category</span>
                      <span className="intake-details-value">
                        {job.routingSuggestion.observedEditableInstrumentCategory ?? (
                          <span style={{ color: "#999", fontStyle: "italic" }}>Not prepared yet</span>
                        )}
                      </span>
                    </div>
                  </>
                )}

                {/* Updated timestamp */}
                {job.preparationInputs?.updatedAt && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Last Updated</span>
                    <span className="intake-details-value" style={{ fontSize: 12, color: "#999" }}>
                      {new Date(job.preparationInputs.updatedAt).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
              </div>

              {/* penyeteman_am: proven preparation markers */}
              {job.routingSuggestion.suggestedLane === "penyeteman_am" && (
                <>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#555", margin: "12px 0 4px" }}>
                    Proven Submit Gate Markers
                  </p>
                  <div className="intake-details-card">
                    <div className="intake-details-row">
                      <span className="intake-details-label">
                        Declaration (Perakuan) prepared
                      </span>
                      <span className="intake-details-value">
                        <input
                          type="checkbox"
                          checked={job.preparationInputs?.declarationPrepared ?? false}
                          disabled={savingPrepInputs}
                          onChange={(e) =>
                            handleUpdatePrepInputs({
                              declarationPrepared: e.target.checked,
                            })
                          }
                        />
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">
                        Bahagian A first party (Pihak Pertama) prepared
                      </span>
                      <span className="intake-details-value">
                        <input
                          type="checkbox"
                          checked={
                            job.preparationInputs?.bahagianAFirstPartyPrepared ?? false
                          }
                          disabled={savingPrepInputs}
                          onChange={(e) =>
                            handleUpdatePrepInputs({
                              bahagianAFirstPartyPrepared: e.target.checked,
                            })
                          }
                        />
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">
                        Bahagian A second party (Pihak Kedua) prepared
                      </span>
                      <span className="intake-details-value">
                        <input
                          type="checkbox"
                          checked={
                            job.preparationInputs?.bahagianASecondPartyPrepared ?? false
                          }
                          disabled={savingPrepInputs}
                          onChange={(e) =>
                            handleUpdatePrepInputs({
                              bahagianASecondPartyPrepared: e.target.checked,
                            })
                          }
                        />
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* sewa_pajakan: honest limited state */}
              {job.routingSuggestion.suggestedLane === "sewa_pajakan" && (
                <p style={{ fontSize: 13, color: "#999", fontStyle: "italic", marginTop: 8 }}>
                  Preparation input markers have not yet been proven for the sewa_pajakan lane. Internal preparation tracking is limited to portal draft fields.
                </p>
              )}

              {prepInputsError && (
                <p className="field-error" style={{ marginTop: 8 }}>
                  {prepInputsError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Portal Submission Readiness ───────────────────────────
          Hidden for nominal-duty registry jobs: submission readiness
          is a sewa_pajakan / penyeteman_am advisory concept that
          does not apply to manually-handled nominal-duty instruments. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="submission-readiness-section">
          <h2 className="submission-readiness-heading">
            Portal Submission Readiness
          </h2>
          <p className="submission-readiness-intro">
            Internal advisory assessment based on the current WeStamp data.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            This has not been validated against live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Readiness cannot be assessed.
            </p>
          ) : job.submissionReadiness ? (
            <>
              {/* Status badge */}
              <div
                className={`submission-readiness-status ${
                  job.submissionReadiness.status === "ready_with_caveats"
                    ? "submission-readiness-status-caveats"
                    : job.submissionReadiness.status === "blocked"
                      ? "submission-readiness-status-blocked"
                      : "submission-readiness-status-limited"
                }`}
              >
                {job.submissionReadiness.status === "ready_with_caveats"
                  ? "Ready (with caveats)"
                  : job.submissionReadiness.status === "blocked"
                    ? "Blocked"
                    : "Assessment Limited"}
              </div>

              {/* Assessment limited explanation */}
              {job.submissionReadiness.status === "assessment_limited" && (
                <p style={{ fontSize: 13, color: "#78716c", marginTop: 8 }}>
                  Submit-readiness gates have not yet been independently
                  proven for this lane. No real readiness judgment is
                  available.
                </p>
              )}

              {/* ── Sewa/Pajakan Proven Hantar Gate Chain ──────────── */}
              {/* Sewa/Pajakan-only panel. Shows the gate chain walked
                  during live discovery (2026-04-22): which Hantar gates
                  are proven, which step is currently blocking, and
                  which fields are still known to be required but have
                  not been enumerated as next gates. Read-only. */}
              {job.submissionReadiness.lane === "sewa_pajakan" && (() => {
                const view = getSewaPajakanGateChainView("sewa_pajakan");
                if (!view) return null;
                return (
                  <div style={{ marginTop: 12 }}>
                    {/* Proven Gate Chain */}
                    <div className="intake-details-card">
                      <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                        Proven Hantar Gate Chain (Sewa/Pajakan)
                      </h3>
                      <p style={{ fontSize: 12, color: "#78716c", margin: "0 0 8px" }}>
                        Gates walked directly against the live e-Duti
                        Setem Hantar button on 2026-04-22. Listed in the
                        order they were observed.
                      </p>
                      {view.provenGates.map((g) => (
                        <div key={g.index} className="intake-details-row">
                          <span className="intake-details-label">
                            Gate {g.index}: {g.fieldLabel}
                            <span style={{ fontSize: 11, color: "#a8a29e", marginLeft: 6 }}>
                              ({g.section})
                            </span>
                          </span>
                          <span className="intake-details-value">
                            <span style={{ color: "#16a34a" }}>Proven</span>
                            <span style={{ fontSize: 11, color: "#78716c", marginLeft: 8, fontStyle: "italic" }}>
                              &ldquo;{g.modalMessage}&rdquo;
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Current Blocking Step */}
                    {view.currentBlockingStep && (
                      <div
                        className="intake-details-card"
                        style={{ marginTop: 10, borderLeft: "3px solid #d97706" }}
                      >
                        <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                          Current Blocking Step
                        </h3>
                        <div className="intake-details-row">
                          <span className="intake-details-label">Section</span>
                          <span className="intake-details-value">
                            {view.currentBlockingStep.section}
                          </span>
                        </div>
                        <div className="intake-details-row">
                          <span className="intake-details-label">Field</span>
                          <span className="intake-details-value">
                            {view.currentBlockingStep.fieldLabel}
                            <span style={{ fontSize: 11, color: "#a8a29e", marginLeft: 6 }}>
                              ({view.currentBlockingStep.field})
                            </span>
                          </span>
                        </div>
                        <div className="intake-details-row">
                          <span className="intake-details-label">Requirement</span>
                          <span className="intake-details-value">
                            {view.currentBlockingStep.requirement}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: "#78716c", margin: "6px 0 0", fontStyle: "italic" }}>
                          {view.currentBlockingStep.basis}
                        </p>
                      </div>
                    )}

                    {/* Still unresolved later gates */}
                    {view.laterUnresolvedGates.length > 0 && (
                      <div className="intake-details-card" style={{ marginTop: 10 }}>
                        <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                          Still Unresolved Later Gates
                        </h3>
                        <p style={{ fontSize: 12, color: "#78716c", margin: "0 0 8px" }}>
                          Fields remaining in the pre-Hantar :invalid set
                          after gate&nbsp;2. Known to be required by HTML
                          constraint validation; their Hantar gate order
                          beyond Alamat Harta has not been enumerated.
                        </p>
                        {view.laterUnresolvedGates.map((g) => (
                          <div key={g.field} className="intake-details-row">
                            <span className="intake-details-label">
                              {g.fieldLabel}
                              <span style={{ fontSize: 11, color: "#a8a29e", marginLeft: 6 }}>
                                ({g.field})
                              </span>
                            </span>
                            <span className="intake-details-value" style={{ color: "#78716c" }}>
                              {g.section}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Untested areas */}
                    {view.untestedAreas.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                          Untested Areas
                        </h3>
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                          {view.untestedAreas.map((a, idx) => (
                            <li key={idx} style={{ marginBottom: 4, color: "#78716c" }}>
                              {a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Proven blockers — only shown when gates are proven */}
              {job.submissionReadiness.gatesProvenForLane &&
                job.submissionReadiness.provenBlockers.length > 0 && (
                <div className="intake-details-card" style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                    Proven Submit Blockers
                  </h3>
                  {job.submissionReadiness.provenBlockers.map((b: { key: string; description: string; satisfied: boolean }) => (
                    <div key={b.key} className="intake-details-row">
                      <span className="intake-details-label">
                        {b.description}
                      </span>
                      <span className="intake-details-value">
                        {b.satisfied ? (
                          <span style={{ color: "#16a34a" }}>Satisfied</span>
                        ) : (
                          <span style={{ color: "#dc2626" }}>Not satisfied</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Unresolved later checks (generic prose list).
                  Suppressed for sewa_pajakan — the structured "Proven
                  Hantar Gate Chain / Current Blocking Step / Still
                  Unresolved Later Gates / Untested Areas" panel above
                  presents the same evidence in a clearer form. */}
              {job.submissionReadiness.lane !== "sewa_pajakan" &&
                job.submissionReadiness.unresolvedChecks.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                    Unresolved Later Checks
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {job.submissionReadiness.unresolvedChecks.map(
                      (check: string, idx: number) => (
                        <li key={idx} style={{ marginBottom: 4, color: "#78716c" }}>
                          {check}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {/* Notes */}
              {job.submissionReadiness.notes.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#78716c" }}>
                  {job.submissionReadiness.notes.map((n: string, idx: number) => (
                    <p key={idx} style={{ margin: "4px 0" }}>
                      {n}
                    </p>
                  ))}
                </div>
              )}

              <p className="submission-readiness-caveat">
                Additional submit checks may still apply at e-Duti Setem.
              </p>
              <p className="portal-draft-disclaimer">
                Nothing has been submitted to e-Duti Setem.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 14, color: "#78716c" }}>
              Readiness has not been evaluated yet.
            </p>
          )}

          {job.routingSuggestion && (
            <>
              {readinessError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {readinessError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleEvaluateReadiness}
                disabled={evaluatingReadiness}
                style={{ marginTop: 10 }}
              >
                {evaluatingReadiness
                  ? "Evaluating\u2026"
                  : job.submissionReadiness
                    ? "Re-evaluate Readiness"
                    : "Evaluate Readiness"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Advanced / Diagnostics — engineering panel cluster 1 ────
          Wraps the long internal-evidence chain (execution preview,
          automation plan, browser instructions, mock execution, lane
          knowledge, save and next-tab gates, Bahagian A gates) in a
          single collapsed-by-default disclosure. None of this content
          is removed; it is simply de-emphasised so day-to-day
          operators are not buried in it. Open by default? No — the
          Operator Command Centre and the panels above are normally
          enough for handling. Open this section only when an
          engineer or operator needs to inspect underlying state.
          The conditional rendering of each panel inside the chain is
          unchanged; this <details> only controls visual hierarchy. */}
      <details className="advanced-diagnostics">
        <summary className="advanced-diagnostics-summary">
          <span className="advanced-diagnostics-title">
            Advanced / Diagnostics — Portal preview, automation plan,
            and Maklumat Am gates
          </span>
          <span className="advanced-diagnostics-hint">
            Click to expand. Detailed engineering and portal-state
            evidence. Day-to-day handling normally does not need this.
          </span>
        </summary>

      {/* ── Portal Execution Preview ────────────────────────────────
          Hidden for nominal-duty registry jobs: portal execution
          preview reflects sewa_pajakan/penyeteman_am advisory values
          that are never computed for nominal-duty jobs. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="execution-preview-section">
          <h2>Portal Execution Preview</h2>
          <p style={{ fontSize: 13, color: "#78716c", marginBottom: 4 }}>
            Internal preview of the current portal-facing values WeStamp intends to use for this job.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            This preview has not been executed in live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Execution preview is not available.
            </p>
          ) : job.executionPreview ? (
            <>
              <div
                className={`submission-readiness-status ${
                  job.executionPreview.status === "preview_ready"
                    ? "submission-readiness-status-caveats"
                    : job.executionPreview.status === "limited"
                      ? "submission-readiness-status-limited"
                      : "submission-readiness-status-blocked"
                }`}
              >
                {job.executionPreview.status === "preview_ready"
                  ? "Preview Ready"
                  : job.executionPreview.status === "limited"
                    ? "Limited Preview"
                    : "Incomplete"}
              </div>

              {/* Intended Inputs */}
              {job.executionPreview.intendedInputs.length > 0 && (
                <div className="intake-details-card" style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                    Intended Portal Inputs
                  </h3>
                  {job.executionPreview.intendedInputs.map((input: { field: string; value: string | number | null; source: string }, idx: number) => (
                    <div key={idx} className="intake-details-row">
                      <span className="intake-details-label">{input.field}</span>
                      <span className="intake-details-value">
                        {input.value != null && input.value !== ""
                          ? String(input.value)
                          : <span style={{ color: "#dc2626" }}>Not set</span>}
                        <span style={{ fontSize: 11, color: "#a8a29e", marginLeft: 8 }}>
                          ({input.source})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Validation Targets */}
              {job.executionPreview.validationTargets.length > 0 && (
                <div className="intake-details-card" style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                    Validation Targets
                    <span className="routing-readonly-badge" style={{ marginLeft: 8 }}>
                      Read-only
                    </span>
                  </h3>
                  {job.executionPreview.validationTargets.map((target: { field: string; expectedValue: string | null; basis: string }, idx: number) => (
                    <div key={idx} className="intake-details-row">
                      <span className="intake-details-label">{target.field}</span>
                      <span className="intake-details-value">
                        {target.expectedValue ?? <span style={{ color: "#78716c" }}>Unknown</span>}
                        <span style={{ fontSize: 11, color: "#a8a29e", marginLeft: 8 }}>
                          ({target.basis})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Unresolved Steps */}
              {job.executionPreview.unresolvedSteps.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                    Unresolved Steps
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {job.executionPreview.unresolvedSteps.map((step: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: 4, color: "#78716c" }}>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Notes */}
              {job.executionPreview.notes.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#78716c" }}>
                  {job.executionPreview.notes.map((n: string, idx: number) => (
                    <p key={idx} style={{ margin: "4px 0" }}>{n}</p>
                  ))}
                </div>
              )}

            </>
          ) : (
            <p style={{ fontSize: 14, color: "#78716c" }}>
              Execution preview has not been compiled yet.
            </p>
          )}

          {job.routingSuggestion && (
            <>
              {previewError && (
                <p className="field-error" style={{ marginBottom: 8 }}>{previewError}</p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCompilePreview}
                disabled={compilingPreview}
                style={{ marginTop: 10 }}
              >
                {compilingPreview
                  ? "Compiling\u2026"
                  : job.executionPreview
                    ? "Recompile Preview"
                    : "Compile Execution Preview"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── STSDS Automation Plan ──────────────────────────────────
          Hidden for nominal-duty registry jobs: the automation plan
          is a sewa_pajakan/penyeteman_am advisory artefact. Nominal-
          duty jobs are handled manually in e-Duti Setem and have no
          such plan. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="automation-plan-section">
          <h2 className="automation-plan-heading">Portal Automation Plan</h2>
          <p className="automation-plan-intro" style={{ marginBottom: 4 }}>
            Internal step-by-step plan WeStamp currently intends to follow for portal work on this job.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            This plan has not been executed in live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Automation plan is not available.
            </p>
          ) : job.automationPlan ? (
            <>

              {/* Plan status indicator */}
              <div className={`automation-plan-status ${
                job.automationPlan.status === "ready_for_review"
                  ? "automation-plan-status-ready"
                  : job.automationPlan.status === "review_required"
                    ? "automation-plan-status-review"
                    : job.automationPlan.status === "not_yet_proven"
                      ? "submission-readiness-status-limited"
                      : job.automationPlan.status === "blocked"
                        ? "automation-plan-status-blocked"
                        : "automation-plan-status-notready"
              }`}>
                {job.automationPlan.status === "ready_for_review"
                  ? "Plan Ready for Internal Review"
                  : job.automationPlan.status === "review_required"
                    ? "Review Required"
                    : job.automationPlan.status === "not_yet_proven"
                      ? "Not Yet Proven"
                      : job.automationPlan.status === "blocked"
                        ? "Plan Not Ready"
                        : "Plan Not Ready"}
              </div>

              {/* Stop reasons */}
              {job.automationPlan.stopReasons.length > 0 && (
                <div className="automation-plan-stops">
                  <span className="automation-plan-stops-label">Stop Reason</span>
                  <ul className="automation-plan-stops-list">
                    {job.automationPlan.stopReasons.map((reason, i) => (
                      <li key={i}>
                        {reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Limited lane notice */}
              {job.automationPlan.stepCount === 0 && (
                <p style={{ fontSize: 13, color: "#78716c", marginTop: 12 }}>
                  Automation plan not yet independently proven for this lane.
                  No step plan is available.
                </p>
              )}

              {/* Key intended values — only if steps exist */}
              {job.automationPlan.stepCount > 0 && (
              <div className="intake-details-card">
                <div className="intake-details-row">
                  <span className="intake-details-label">Portal Lane</span>
                  <span className="intake-details-value">
                    {job.automationPlan.lane === "sewa_pajakan"
                      ? "Sewa / Pajakan (Lease / Tenancy)"
                      : "Penyetemen Am (General Stamping)"}
                  </span>
                </div>
                <div className="intake-details-row">
                  <span className="intake-details-label">Steps</span>
                  <span className="intake-details-value">
                    {job.automationPlan.stepCount} planned
                  </span>
                </div>
                {job.automationPlan.intendedValues.portalDocumentName && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Portal Document Name</span>
                    <span className="intake-details-value">
                      {job.automationPlan.intendedValues.portalDocumentName}
                    </span>
                  </div>
                )}
                {job.automationPlan.intendedValues.expectedDerivedDocumentGroup && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Expected Derived Document Group</span>
                    <span className="intake-details-value routing-derived-category">
                      {job.automationPlan.intendedValues.expectedDerivedDocumentGroup}
                      <span className="routing-readonly-badge">Validation target</span>
                    </span>
                  </div>
                )}
                {job.automationPlan.intendedValues.editableInstrumentCategory && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Editable Instrument Category</span>
                    <span className="intake-details-value">
                      {job.automationPlan.intendedValues.editableInstrumentCategory}
                    </span>
                  </div>
                )}
                {job.automationPlan.intendedValues.stampOffice && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Stamp Office</span>
                    <span className="intake-details-value">
                      {job.automationPlan.intendedValues.stampOffice}
                    </span>
                  </div>
                )}
                {job.automationPlan.intendedValues.instrumentDate && (
                  <div className="intake-details-row">
                    <span className="intake-details-label">Instrument Date</span>
                    <span className="intake-details-value">
                      {job.automationPlan.intendedValues.instrumentDate}
                    </span>
                  </div>
                )}
              </div>
              )}

              {/* Validation checkpoints */}
              {job.automationPlan.validationCheckpoints.length > 0 && (
                <div className="automation-plan-checkpoints">
                  <h3 className="automation-plan-checkpoints-heading">
                    Validation Checkpoints
                  </h3>
                  <ul className="automation-plan-checkpoints-list">
                    {job.automationPlan.validationCheckpoints.map((cp, i) => (
                      <li key={i} className={`automation-plan-checkpoint ${
                        cp.severity === "required"
                          ? "automation-plan-checkpoint-required"
                          : "automation-plan-checkpoint-advisory"
                      }`}>
                        <span className="automation-plan-checkpoint-desc">
                          {cp.description}
                        </span>
                        {cp.expectedValue && (
                          <span className="automation-plan-checkpoint-expected">
                            Expected: {cp.expectedValue}
                          </span>
                        )}
                        <span className={`automation-plan-checkpoint-severity ${
                          cp.severity === "required"
                            ? "automation-plan-severity-required"
                            : "automation-plan-severity-advisory"
                        }`}>
                          {cp.severity === "required" ? "Required" : "Advisory"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* disclaimer moved to section-level secondary note above */}

              {/* Known Portal Schema subsection */}
              <div className="portal-schema-subsection">
                <h3 className="portal-schema-heading">Known Portal Schema</h3>
                <p className="portal-schema-note">
                  WeStamp has prepared the current internal portal field schema
                  for this job. This schema is used for internal planning only
                  and has not been executed on e-Duti Setem.
                </p>
                <div className="portal-schema-fields">
                  {job.automationPlan.lane === "penyeteman_am" ? (
                    <>
                      {[
                        { label: "Pejabat Setem", mode: "Editable", kind: "Dropdown" },
                        { label: "Tarikh Surat Cara", mode: "Editable", kind: "Date input" },
                        { label: "Tarikh Diterima di Malaysia", mode: "Editable", kind: "Date input" },
                        { label: "Nama Surat Cara", mode: "Editable", kind: "Dropdown" },
                        { label: "Kumpulan Dokumen", mode: "Derived", kind: "Read-only display" },
                        { label: "Kategori Surat Cara", mode: "Editable", kind: "Dropdown" },
                      ].map((f) => (
                        <div key={f.label} className="portal-schema-field-row">
                          <span className="portal-schema-field-label">{f.label}</span>
                          <span className={`portal-schema-field-mode ${
                            f.mode === "Derived"
                              ? "portal-schema-mode-derived"
                              : "portal-schema-mode-editable"
                          }`}>
                            {f.mode}
                          </span>
                          <span className="portal-schema-field-kind">{f.kind}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {[
                        { label: "Pejabat Setem", mode: "Editable", kind: "Dropdown" },
                        { label: "Tarikh Surat Cara", mode: "Editable", kind: "Date input" },
                        { label: "Tarikh Diterima di Malaysia", mode: "Editable", kind: "Date input" },
                      ].map((f) => (
                        <div key={f.label} className="portal-schema-field-row">
                          <span className="portal-schema-field-label">{f.label}</span>
                          <span className="portal-schema-field-mode portal-schema-mode-editable">
                            {f.mode}
                          </span>
                          <span className="portal-schema-field-kind">{f.kind}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <p className="portal-schema-tab-note">
                  Maklumat Am tab only. Later tabs (Bahagian A, B
                  {job.automationPlan.lane === "sewa_pajakan" ? ", C" : ""},
                  {" "}Rumusan Pengiraan, Lampiran, Perakuan) are modelled as
                  placeholder schema entries pending further observation.
                </p>
              </div>

              {/* Update plan button */}
              <div style={{ marginTop: 10 }}>
                {planError && (
                  <p className="field-error" style={{ marginBottom: 8 }}>
                    {planError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleBuildAutomationPlan}
                  disabled={buildingPlan}
                >
                  {buildingPlan ? "Updating\u2026" : "Update Automation Plan"}
                </button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 14, color: "#78716c" }}>
              Automation plan has not been built yet.
            </p>
          )}

          {job.routingSuggestion && (
            <>
              {planError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {planError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleBuildAutomationPlan}
                disabled={buildingPlan}
                style={{ marginTop: 10 }}
              >
                {buildingPlan
                  ? "Building\u2026"
                  : job.automationPlan
                    ? "Update Automation Plan"
                    : "Build Automation Plan"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── STSDS Browser Instructions ─────────────────────────────
          Hidden for nominal-duty registry jobs: browser instruction
          sets are only produced for sewa_pajakan/penyeteman_am lanes.
          Nominal-duty jobs are never driven by this instruction set. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="browser-instr-section">
          <h2 className="browser-instr-heading">Browser Instruction Set</h2>
          <p className="browser-instr-intro" style={{ marginBottom: 4 }}>
            Internal browser-step instructions currently prepared for portal work on this job.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            These instructions have not been executed in live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Browser instructions are not available.
            </p>
          ) : job.browserInstructions ? (
            <>

              {/* Status + count */}
              <div className={`browser-instr-status ${
                job.browserInstructions.status === "ready_for_internal_review"
                  ? "browser-instr-status-ready"
                  : job.browserInstructions.status === "review_required"
                    ? "browser-instr-status-review"
                    : job.browserInstructions.status === "not_yet_proven"
                      ? "submission-readiness-status-limited"
                      : job.browserInstructions.status === "blocked"
                        ? "browser-instr-status-blocked"
                        : "browser-instr-status-notready"
              }`}>
                <span className="browser-instr-status-label">Instruction Status</span>
                <span className="browser-instr-status-value">
                  {job.browserInstructions.status === "ready_for_internal_review"
                    ? "Instructions Ready for Internal Review"
                    : job.browserInstructions.status === "review_required"
                      ? "Review Required"
                      : job.browserInstructions.status === "not_yet_proven"
                        ? "Not Yet Proven"
                        : job.browserInstructions.status === "blocked"
                          ? "Blocked"
                          : "Instructions Not Ready"}
                </span>
                <span className="browser-instr-count-badge">
                  <span className="browser-instr-count-label">Instruction Count</span>
                  {" "}{job.browserInstructions.instructionCount}
                </span>
              </div>

              {/* Blocked reasons */}
              {job.browserInstructions.blockedReasons.length > 0 && (
                <div className="browser-instr-reasons browser-instr-reasons-blocked">
                  <span className="browser-instr-reasons-label">Blocked Reasons</span>
                  <ul className="browser-instr-reasons-list">
                    {job.browserInstructions.blockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory notes */}
              {job.browserInstructions.advisoryNotes.length > 0 && (
                <div className="browser-instr-reasons browser-instr-reasons-advisory">
                  <span className="browser-instr-reasons-label">Advisory Notes</span>
                  <ul className="browser-instr-reasons-list">
                    {job.browserInstructions.advisoryNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Known later portal surfaces (not executable) */}
              {job.browserInstructions.knownLaterSurfaces &&
                job.browserInstructions.knownLaterSurfaces.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                    Known Later Portal Surfaces
                    <span
                      className="routing-readonly-badge"
                      style={{ marginLeft: 8 }}
                    >
                      Not yet automated
                    </span>
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {job.browserInstructions.knownLaterSurfaces.map(
                      (surface: string, idx: number) => (
                        <li
                          key={idx}
                          style={{ marginBottom: 4, color: "#78716c" }}
                        >
                          {surface}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {/* Instruction list — first 8 shown */}
              {job.browserInstructions.instructions.length > 0 && (
                <div className="browser-instr-list-section">
                  <h3 className="browser-instr-list-heading">Instructions</h3>
                  <ol className="browser-instr-list">
                    {job.browserInstructions.instructions.slice(0, 8).map((instr) => (
                      <li
                        key={instr.seq}
                        className={`browser-instr-item ${
                          instr.blocked
                            ? "browser-instr-item-blocked"
                            : instr.isAdvisory
                              ? "browser-instr-item-advisory"
                              : "browser-instr-item-ready"
                        }`}
                      >
                        <div className="browser-instr-item-row">
                          <span className="browser-instr-item-type">
                            {instr.type.replace(/_/g, " ")}
                          </span>
                          <span className="browser-instr-item-desc">
                            {instr.description}
                          </span>
                          {instr.target?.portalLabel && (
                            <span className="browser-instr-item-target">
                              {instr.target.portalLabel}
                            </span>
                          )}
                          {instr.payload?.value != null && (
                            <span className="browser-instr-item-value">
                              Value: {String(instr.payload.value)}
                            </span>
                          )}
                        </div>
                        {/* Preconditions not met */}
                        {instr.preconditions.filter((p) => !p.met).map((p, j) => (
                          <div key={j} className="browser-instr-item-precond">
                            Precondition: {p.description}
                            {p.reason && ` — ${p.reason}`}
                          </div>
                        ))}
                        {/* Expectations */}
                        {instr.expectations
                          .filter((e) => e.expectedValue !== null)
                          .slice(0, 1)
                          .map((e, j) => (
                            <div key={j} className="browser-instr-item-expect">
                              Expects: {e.description}
                              {e.expectedValue && ` (${e.expectedValue})`}
                            </div>
                          ))}
                      </li>
                    ))}
                    {job.browserInstructions.instructions.length > 8 && (
                      <li className="browser-instr-more">
                        + {job.browserInstructions.instructions.length - 8} more instructions
                      </li>
                    )}
                  </ol>
                </div>
              )}

            </>
          ) : (
            <p style={{ fontSize: 14, color: "#78716c" }}>
              Browser instruction set has not been compiled yet.
            </p>
          )}

          {job.routingSuggestion && (
            <>
              {instructionsError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {instructionsError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCompileInstructions}
                disabled={compilingInstructions}
                style={{ marginTop: 10 }}
              >
                {compilingInstructions
                  ? "Compiling\u2026"
                  : job.browserInstructions
                    ? "Recompile Instructions"
                    : "Compile Browser Instructions"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── STSDS Mock Execution ────────────────────────────────────
          Hidden for nominal-duty registry jobs: mock execution runs
          the browser-instruction set (also hidden above). Nominal-
          duty jobs have no such workflow. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div className="mock-exec-section">
          <h2 className="mock-exec-heading">Mock Execution</h2>
          <p className="mock-exec-intro" style={{ marginBottom: 4 }}>
            Internal simulated run of the current portal workflow WeStamp has prepared for this job.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            This mock execution has not interacted with live e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Mock execution is not available.
            </p>
          ) : job.mockExecution ? (
            <>

              {/* Execution Status */}
              <div className={`mock-exec-status ${
                job.mockExecution.status === "ready_for_internal_review"
                  ? "mock-exec-status-ready"
                  : job.mockExecution.status === "review_required"
                    ? "mock-exec-status-review"
                    : job.mockExecution.status === "not_yet_proven"
                      ? "submission-readiness-status-limited"
                      : job.mockExecution.status === "blocked"
                        ? "mock-exec-status-blocked"
                        : job.mockExecution.status === "failed"
                          ? "mock-exec-status-failed"
                          : "mock-exec-status-notready"
              }`}>
                <span className="mock-exec-status-label">Execution Status</span>
                <span className="mock-exec-status-value">
                  {job.mockExecution.status === "ready_for_internal_review"
                    ? "Mock Execution Ready for Internal Review"
                    : job.mockExecution.status === "review_required"
                      ? "Review Required"
                      : job.mockExecution.status === "not_yet_proven"
                        ? "Not Yet Proven"
                        : job.mockExecution.status === "blocked"
                          ? "Blocked"
                          : job.mockExecution.status === "failed"
                            ? "Failed"
                            : "Mock Execution Not Ready"}
                </span>
                <span className="mock-exec-trace-badge">
                  {job.mockExecution.trace.executedCount}/{job.mockExecution.trace.totalInstructions} executed
                </span>
              </div>

              {/* Blocked reasons */}
              {job.mockExecution.blockedReasons.length > 0 && (
                <div className="mock-exec-reasons mock-exec-reasons-blocked">
                  <span className="mock-exec-reasons-label">Blocked Reasons</span>
                  <ul className="mock-exec-reasons-list">
                    {job.mockExecution.blockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Failed reasons */}
              {job.mockExecution.failedReasons.length > 0 && (
                <div className="mock-exec-reasons mock-exec-reasons-failed">
                  <span className="mock-exec-reasons-label">Failed Reasons</span>
                  <ul className="mock-exec-reasons-list">
                    {job.mockExecution.failedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory notes */}
              {job.mockExecution.advisoryNotes.length > 0 && (
                <div className="mock-exec-reasons mock-exec-reasons-advisory">
                  <span className="mock-exec-reasons-label">Advisory Notes</span>
                  <ul className="mock-exec-reasons-list">
                    {job.mockExecution.advisoryNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Known later portal surfaces (not executed) */}
              {job.mockExecution.knownLaterSurfaces &&
                job.mockExecution.knownLaterSurfaces.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 4 }}>
                    Known Later Portal Surfaces
                    <span className="routing-readonly-badge" style={{ marginLeft: 8 }}>
                      Not executed
                    </span>
                  </h3>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {job.mockExecution.knownLaterSurfaces.map((surface: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: 4, color: "#78716c" }}>{surface}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Instruction Results — first 8 shown */}
              {job.mockExecution.instructionResults.length > 0 && (
                <div className="mock-exec-list-section">
                  <h3 className="mock-exec-list-heading">Instruction Results</h3>
                  <ol className="mock-exec-list">
                    {job.mockExecution.instructionResults.slice(0, 8).map((r) => (
                      <li
                        key={r.seq}
                        className={`mock-exec-item ${
                          r.status === "executed"
                            ? "mock-exec-item-executed"
                            : r.status === "blocked"
                              ? "mock-exec-item-blocked"
                              : r.status === "failed"
                                ? "mock-exec-item-failed"
                                : r.status === "skipped"
                                  ? "mock-exec-item-skipped"
                                  : "mock-exec-item-pending"
                        }`}
                      >
                        <div className="mock-exec-item-row">
                          <span className="mock-exec-item-status-badge">
                            {r.status}
                          </span>
                          <span className="mock-exec-item-type">
                            {r.type.replace(/_/g, " ")}
                          </span>
                          <span className="mock-exec-item-desc">
                            {r.description}
                          </span>
                        </div>
                        {r.note && (
                          <div className="mock-exec-item-note">
                            {r.note}
                          </div>
                        )}
                      </li>
                    ))}
                    {job.mockExecution.instructionResults.length > 8 && (
                      <li className="mock-exec-more">
                        + {job.mockExecution.instructionResults.length - 8} more results
                      </li>
                    )}
                  </ol>
                </div>
              )}

            </>
          ) : (
            <p style={{ fontSize: 14, color: "#78716c" }}>
              Mock execution has not been run yet.
            </p>
          )}

          {job.routingSuggestion && (
            <>
              {mockError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {mockError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRunMockExecution}
                disabled={runningMock || !job.browserInstructions}
                style={{ marginTop: 10 }}
              >
                {runningMock
                  ? "Running\u2026"
                  : job.mockExecution
                    ? "Re-run Mock Execution"
                    : "Run Mock Execution"}
              </button>
              {!job.browserInstructions && (
                <p className="mock-exec-prereq-note">
                  Browser instructions must be compiled first.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Portal Lane Knowledge Profile ────────────────────────────
          Hidden for nominal-duty registry jobs: the lane knowledge
          profile is a sewa_pajakan/penyeteman_am advisory surface.
          Nominal-duty jobs do not use portal lanes. */}
      {!isNominalDuty && !isManualReview && !isFailed && (
        <div style={{ marginTop: 28 }}>
          <h2>Portal Lane Knowledge Profile</h2>
          <p style={{ fontSize: 13, color: "#78716c", marginBottom: 4 }}>
            Internal summary of the current portal knowledge basis WeStamp has for this job&apos;s lane.
          </p>
          <p style={{ fontSize: 12, color: "#999", fontStyle: "italic", margin: "0 0 12px" }}>
            This knowledge profile is not live validation from e-Duti Setem.
          </p>

          {!job.routingSuggestion ? (
            <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              No portal routing has been determined for this job. Lane knowledge profile is not available.
            </p>
          ) : (() => {
            const lk = getLaneKnowledgeProfile(job.routingSuggestion.suggestedLane as "sewa_pajakan" | "penyeteman_am");
            return (
              <>
                <div className="intake-details-card">
                  <div className="intake-details-row">
                    <span className="intake-details-label">Lane</span>
                    <span className="intake-details-value">
                      {lk.lane === "penyeteman_am" ? "Penyeteman Am (p8)" : "Sewa / Pajakan (p5)"}
                    </span>
                  </div>
                  <div className="intake-details-row">
                    <span className="intake-details-label">Knowledge Basis</span>
                    <span className="intake-details-value">
                      {lk.laneAutomationProven
                        ? <span style={{ color: "#16a34a" }}>Observed internal portal knowledge available</span>
                        : <span style={{ color: "#d97706" }}>Limited internal lane knowledge</span>}
                    </span>
                  </div>
                  <div className="intake-details-row">
                    <span className="intake-details-label">Live Execution Enabled</span>
                    <span className="intake-details-value">
                      {lk.liveExecutionEnabled
                        ? <span style={{ color: "#16a34a" }}>Yes</span>
                        : <span style={{ color: "#78716c" }}>No</span>}
                    </span>
                  </div>
                </div>

                {/* Observed portal behavior — only shown when internal knowledge exists */}
                {lk.laneAutomationProven && (
                  <>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#555", margin: "12px 0 4px" }}>
                      Observed Portal Behavior
                    </p>
                    <div className="intake-details-card">
                      {[
                        { label: "Declaration (Perakuan) Gate", value: lk.declarationGateProven },
                        { label: "Bahagian A Completeness Gate", value: lk.bahagianAGateProven },
                        { label: "Bahagian B Accessible (empty A)", value: lk.bahagianBAccessibleWithEmptyA },
                        { label: "Bahagian B Save Permissive (empty A)", value: lk.bahagianBSavePermissive },
                        { label: "Rumusan Pengiraan Accessible", value: lk.rumusanAccessible },
                        { label: "Lampiran Tab Accessible", value: lk.lampiranAccessible },
                        { label: "Perakuan Tab Accessible", value: lk.perakuanAccessible },
                      ].map((item) => (
                        <div key={item.label} className="intake-details-row">
                          <span className="intake-details-label">{item.label}</span>
                          <span className="intake-details-value">
                            {item.value === "proven"
                              ? <span style={{ color: "#16a34a" }}>Observed</span>
                              : <span style={{ color: "#d97706" }}>Not yet observed</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                    {lk.lane === "sewa_pajakan" && (
                      <p style={{ fontSize: 12, color: "#78716c", margin: "6px 0 0", fontStyle: "italic" }}>
                        Note: the &ldquo;Bahagian B&rdquo; rows above
                        report only whether the Bahagian B tab is
                        reachable and whether its save was exercised —
                        they are not the save target for harta (property)
                        fields on this lane. The gate&nbsp;2 modal
                        observed on 2026-04-22 confirmed Alamat Harta
                        lives on <strong>Bahagian C</strong>, not
                        Bahagian B.
                      </p>
                    )}
                  </>
                )}

                {/* Dependencies / frozen assumptions */}
                <p style={{ fontSize: 12, fontWeight: 600, color: "#555", margin: "12px 0 4px" }}>
                  Dependencies &amp; Constraints
                </p>
                <div className="intake-details-card">
                  <div className="intake-details-row">
                    <span className="intake-details-label">Party Entry (Identity/TIN)</span>
                    <span className="intake-details-value">
                      {lk.partyEntryFrozen
                        ? <span style={{ color: "#dc2626" }}>Frozen dependency</span>
                        : <span style={{ color: "#16a34a" }}>Available</span>}
                    </span>
                  </div>
                </div>

                {/* Notes */}
                {lk.notes.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#78716c" }}>
                    {lk.notes.map((n, i) => (
                      <p key={i} style={{ margin: "4px 0" }}>{n}</p>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── Next-Tab Progression Preflight ──────────────────────────── */}
      {job.saveAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="next-tab-pf-section">
          <h2 className="next-tab-pf-heading">Next-Tab Progression Preflight</h2>
          <p className="next-tab-pf-intro">
            WeStamp has evaluated whether the immediate next tab is internally eligible for a future progression attempt.
          </p>

          {job.nextTabPreflight ? (
            <>
              <div className={`next-tab-pf-status ${
                job.nextTabPreflight.status === "eligible_for_later_attempt"
                  ? "next-tab-pf-status-eligible"
                  : job.nextTabPreflight.status === "review_required"
                    ? "next-tab-pf-status-review"
                    : job.nextTabPreflight.status === "blocking_issues"
                      ? "next-tab-pf-status-blocking"
                      : "next-tab-pf-status-notready"
              }`}>
                <span className="next-tab-pf-status-label">Next-Tab Preflight</span>
                <span className="next-tab-pf-status-value">
                  {job.nextTabPreflight.status === "eligible_for_later_attempt"
                    ? "Internally Eligible for Later Next-Tab Attempt"
                    : job.nextTabPreflight.status === "review_required"
                      ? "Review Required Before Next-Tab Progression"
                      : job.nextTabPreflight.status === "blocking_issues"
                        ? "Blocking Issues Found"
                        : "Next-Tab Preflight Not Ready"}
                </span>
              </div>

              {/* Next tab + guard */}
              <div className="next-tab-pf-context">
                {job.nextTabPreflight.nextTabObservedState.expectedNextTabLabel && (
                  <span className="next-tab-pf-context-item">
                    Expected Next Tab: {job.nextTabPreflight.nextTabObservedState.expectedNextTabLabel} ({job.nextTabPreflight.nextTabObservedState.expectedNextTabKey})
                  </span>
                )}
                <span className="next-tab-pf-context-item">
                  Lane: {job.nextTabPreflight.lane}
                </span>
                <span className={`next-tab-pf-context-item next-tab-pf-guard-${job.nextTabPreflight.guard.decision}`}>
                  Progression Guard: {job.nextTabPreflight.guard.decision === "refused"
                    ? "Refused"
                    : job.nextTabPreflight.guard.decision === "review_gated"
                      ? "Review Gated"
                      : "Permitted"}
                </span>
              </div>

              {/* Observed next-tab state */}
              <div className="next-tab-pf-observed">
                <span className="next-tab-pf-observed-label">Observed Next-Tab State</span>
                <div className="next-tab-pf-observed-detail">
                  <span className={`next-tab-pf-availability next-tab-pf-availability-${job.nextTabPreflight.nextTabObservedState.availability}`}>
                    {job.nextTabPreflight.nextTabObservedState.availability.replace(/_/g, " ")}
                  </span>
                  <span className="next-tab-pf-availability-source">
                    Source: {job.nextTabPreflight.nextTabObservedState.availabilitySource.replace(/_/g, " ")}
                  </span>
                </div>
                {job.nextTabPreflight.nextTabObservedState.note && (
                  <p className="next-tab-pf-observed-note">{job.nextTabPreflight.nextTabObservedState.note}</p>
                )}
              </div>

              {/* Explanation */}
              <div className="next-tab-pf-explanation">
                <p>{job.nextTabPreflight.explanation}</p>
              </div>

              {/* Summary */}
              <div className="next-tab-pf-summary">
                <span className="next-tab-pf-summary-item">
                  Checks: {job.nextTabPreflight.summary.passedCount}/{job.nextTabPreflight.summary.totalChecks} passed
                </span>
                {job.nextTabPreflight.summary.blockingFailures > 0 && (
                  <span className="next-tab-pf-summary-item next-tab-pf-summary-blocking">
                    Blocking: {job.nextTabPreflight.summary.blockingFailures}
                  </span>
                )}
                {job.nextTabPreflight.summary.advisoryFailures > 0 && (
                  <span className="next-tab-pf-summary-item next-tab-pf-summary-advisory">
                    Advisory: {job.nextTabPreflight.summary.advisoryFailures}
                  </span>
                )}
              </div>

              {/* Blocking reasons */}
              {job.nextTabPreflight.blockingReasons.length > 0 && (
                <div className="next-tab-pf-reasons next-tab-pf-reasons-blocking">
                  <span className="next-tab-pf-reasons-label">Blocking Reasons</span>
                  <ul className="next-tab-pf-reasons-list">
                    {job.nextTabPreflight.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory reasons */}
              {job.nextTabPreflight.advisoryReasons.length > 0 && (
                <div className="next-tab-pf-reasons next-tab-pf-reasons-advisory">
                  <span className="next-tab-pf-reasons-label">Advisory Reasons</span>
                  <ul className="next-tab-pf-reasons-list">
                    {job.nextTabPreflight.advisoryReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Guard detail */}
              <div className="next-tab-pf-guard-detail">
                <span className="next-tab-pf-guard-label">Guard Explanation</span>
                <p className="next-tab-pf-guard-text">{job.nextTabPreflight.guard.explanation}</p>
              </div>

              {/* Per-check details */}
              <details className="next-tab-pf-checks-details">
                <summary className="next-tab-pf-checks-summary">
                  Check Details ({job.nextTabPreflight.checks.length})
                </summary>
                <table className="next-tab-pf-checks-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Severity</th>
                      <th>Result</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.nextTabPreflight.checks.map((c, i) => (
                      <tr key={i} className={c.passed ? "next-tab-pf-check-pass" : "next-tab-pf-check-fail"}>
                        <td>{c.description}</td>
                        <td>
                          <span className={`next-tab-pf-severity next-tab-pf-severity-${c.severity}`}>
                            {c.severity}
                          </span>
                        </td>
                        <td>{c.passed ? "Passed" : "Failed"}</td>
                        <td>{c.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <p className="next-tab-pf-disclaimer">
                No next-tab progression has been attempted.
              </p>
            </>
          ) : (
            <p className="next-tab-pf-empty">
              No next-tab progression preflight has been evaluated yet.
            </p>
          )}

          <div style={{ marginTop: 10 }}>
            {nextTabPreflightError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {nextTabPreflightError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleRunNextTabPreflight}
              disabled={runningNextTabPreflight}
            >
              {runningNextTabPreflight
                ? "Evaluating Next-Tab Preflight…"
                : job.nextTabPreflight
                  ? "Re-evaluate Next-Tab Preflight"
                  : "Evaluate Next-Tab Progression Preflight"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bahagian A Next-Field Preflight ─────────────────────────── */}
      {job.bahagianAPostFillReconciliation && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-nfp-section">
          <h2 className="bahagian-a-nfp-heading">Bahagian A Next-Field Preflight</h2>
          <p className="bahagian-a-nfp-intro">
            WeStamp has evaluated whether a future second Bahagian A field-fill attempt is internally eligible for this job.
          </p>
          <p className="bahagian-a-nfp-disclaimer">
            No second Bahagian A field-filling has been attempted.
          </p>

          {job.bahagianANextFieldPreflight ? (
            <>
              <div className={`bahagian-a-nfp-status ${
                job.bahagianANextFieldPreflight.status === "eligible_for_later_next_field_attempt"
                  ? "bahagian-a-nfp-status-eligible"
                  : job.bahagianANextFieldPreflight.status === "review_required"
                    ? "bahagian-a-nfp-status-review"
                    : job.bahagianANextFieldPreflight.status === "blocking_issues"
                      ? "bahagian-a-nfp-status-blocking"
                      : "bahagian-a-nfp-status-notready"
              }`}>
                <span className="bahagian-a-nfp-status-label">Preflight Status</span>
                <span className="bahagian-a-nfp-status-value">
                  {job.bahagianANextFieldPreflight.status === "eligible_for_later_next_field_attempt"
                    ? "Internally Eligible for Later Next Field Fill Attempt"
                    : job.bahagianANextFieldPreflight.status === "review_required"
                      ? "Review Required Before Next Field Fill"
                      : job.bahagianANextFieldPreflight.status === "blocking_issues"
                        ? "Blocking Issues Found"
                        : "Bahagian A Next-Field Preflight Not Ready"}
                </span>
              </div>

              <p className="bahagian-a-nfp-explanation">{job.bahagianANextFieldPreflight.explanation}</p>

              {/* Guard decision */}
              <div className={`bahagian-a-nfp-guard ${
                job.bahagianANextFieldPreflight.guard.decision === "permitted"
                  ? "bahagian-a-nfp-guard-permitted"
                  : job.bahagianANextFieldPreflight.guard.decision === "review_gated"
                    ? "bahagian-a-nfp-guard-review"
                    : "bahagian-a-nfp-guard-refused"
              }`}>
                <span className="bahagian-a-nfp-guard-label">Next-Field Guard</span>
                <span className="bahagian-a-nfp-guard-value">
                  {job.bahagianANextFieldPreflight.guard.decision === "permitted"
                    ? "Permitted — eligible for later second fill attempt"
                    : job.bahagianANextFieldPreflight.guard.decision === "review_gated"
                      ? "Review Gated — human review recommended"
                      : "Refused — blocking issues must be resolved"}
                </span>
                <span className="bahagian-a-nfp-guard-explanation">
                  {job.bahagianANextFieldPreflight.guard.explanation}
                </span>
              </div>

              {/* First filled field reference */}
              {job.bahagianANextFieldPreflight.firstFilledField && (
                <div className="bahagian-a-nfp-first-filled">
                  <span className="bahagian-a-nfp-first-filled-label">First Filled Field</span>
                  <span className="bahagian-a-nfp-first-filled-value">
                    &quot;{job.bahagianANextFieldPreflight.firstFilledField.labelText}&quot;
                    {job.bahagianANextFieldPreflight.firstFilledField.schemaFieldKey && (
                      <> (key: {job.bahagianANextFieldPreflight.firstFilledField.schemaFieldKey})</>
                    )}
                  </span>
                </div>
              )}

              {/* Next candidate */}
              {job.bahagianANextFieldPreflight.nextCandidate ? (
                <div className="bahagian-a-nfp-candidate">
                  <span className="bahagian-a-nfp-candidate-label">Next Field Candidate</span>
                  <span className="bahagian-a-nfp-candidate-field">
                    &quot;{job.bahagianANextFieldPreflight.nextCandidate.labelText}&quot;
                    {job.bahagianANextFieldPreflight.nextCandidate.schemaFieldLabel && (
                      <> (Schema: &quot;{job.bahagianANextFieldPreflight.nextCandidate.schemaFieldLabel}&quot;)</>
                    )}
                  </span>
                  {job.bahagianANextFieldPreflight.nextCandidate.intendedValue && (
                    <span className="bahagian-a-nfp-candidate-value">
                      Source Value: &quot;{job.bahagianANextFieldPreflight.nextCandidate.intendedValue}&quot;
                      ({job.bahagianANextFieldPreflight.nextCandidate.valueSource ?? "unknown"})
                    </span>
                  )}
                  <span className="bahagian-a-nfp-candidate-basis">
                    Candidate Selection Basis: {job.bahagianANextFieldPreflight.nextCandidate.selectionBasis}
                  </span>
                  <span className="bahagian-a-nfp-candidate-ambiguity">
                    Unambiguous: {job.bahagianANextFieldPreflight.nextCandidate.isUnambiguous ? "Yes" : "No"}
                  </span>
                </div>
              ) : (
                <p className="bahagian-a-nfp-no-candidate">
                  No next field candidate identified.
                </p>
              )}

              {/* Remaining candidates count */}
              <div className="bahagian-a-nfp-remaining">
                <span className="bahagian-a-nfp-remaining-label">Remaining Candidates</span>
                <span className="bahagian-a-nfp-remaining-value">
                  {job.bahagianANextFieldPreflight.remainingCandidateCount} grounded editable field(s) after first fill
                </span>
              </div>

              {/* Blocking reasons */}
              {job.bahagianANextFieldPreflight.blockingReasons.length > 0 && (
                <div className="bahagian-a-nfp-blocking">
                  <span className="bahagian-a-nfp-blocking-label">Blocking Reasons</span>
                  <ul className="bahagian-a-nfp-blocking-list">
                    {job.bahagianANextFieldPreflight.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory reasons */}
              {job.bahagianANextFieldPreflight.advisoryReasons.length > 0 && (
                <div className="bahagian-a-nfp-advisory">
                  <span className="bahagian-a-nfp-advisory-label">Advisory Reasons</span>
                  <ul className="bahagian-a-nfp-advisory-list">
                    {job.bahagianANextFieldPreflight.advisoryReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Checks summary */}
              <div className="bahagian-a-nfp-summary">
                <span className="bahagian-a-nfp-summary-label">Checks</span>
                <span className="bahagian-a-nfp-summary-value">
                  {job.bahagianANextFieldPreflight.summary.passedCount}/{job.bahagianANextFieldPreflight.summary.totalChecks} passed
                  {job.bahagianANextFieldPreflight.summary.blockingFailures > 0 && (
                    <> &middot; {job.bahagianANextFieldPreflight.summary.blockingFailures} blocking</>
                  )}
                  {job.bahagianANextFieldPreflight.summary.advisoryFailures > 0 && (
                    <> &middot; {job.bahagianANextFieldPreflight.summary.advisoryFailures} advisory</>
                  )}
                </span>
              </div>

              {/* Expandable checks detail */}
              <details className="bahagian-a-nfp-checks-details">
                <summary>All Checks ({job.bahagianANextFieldPreflight.checks.length})</summary>
                <ul className="bahagian-a-nfp-checks-list">
                  {job.bahagianANextFieldPreflight.checks.map((c, i) => (
                    <li key={i} className={`bahagian-a-nfp-check-item ${c.passed ? "bahagian-a-nfp-check-pass" : "bahagian-a-nfp-check-fail"}`}>
                      <span className="bahagian-a-nfp-check-badge">
                        {c.passed ? "PASS" : "FAIL"} [{c.severity}]
                      </span>
                      {" "}{c.description}
                      {c.reason && !c.passed && (
                        <span className="bahagian-a-nfp-check-reason"> — {c.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="bahagian-a-nfp-empty">
              Bahagian A next-field preflight has not been evaluated yet.
            </p>
          )}

          <div className="bahagian-a-nfp-actions" style={{ marginTop: 10 }}>
            {bahagianANextFieldPreflightError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianANextFieldPreflightError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleBahagianANextFieldPreflight}
              disabled={runningBahagianANextFieldPreflight}
              style={{ background: "#f5f5f5" }}
            >
              {runningBahagianANextFieldPreflight
                ? "Evaluating…"
                : job.bahagianANextFieldPreflight
                  ? "Re-evaluate Next-Field Preflight"
                  : "Evaluate Next-Field Preflight"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bahagian A Post-Fill Reconciliation ────────────────────── */}
      {job.bahagianAFillAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-pfr-section">
          <h2 className="bahagian-a-pfr-heading">Bahagian A Post-Fill Reconciliation</h2>
          <p className="bahagian-a-pfr-intro">
            WeStamp has evaluated the immediate post-fill state for the first Bahagian A field attempt on this job.
          </p>
          <p className="bahagian-a-pfr-disclaimer">
            No second field fill or Bahagian A save has been attempted.
          </p>

          {job.bahagianAPostFillReconciliation ? (
            <>
              <div className={`bahagian-a-pfr-status ${
                job.bahagianAPostFillReconciliation.status === "stopped_cleanly"
                  ? "bahagian-a-pfr-status-clean"
                  : job.bahagianAPostFillReconciliation.status === "review_required"
                    ? "bahagian-a-pfr-status-review"
                    : job.bahagianAPostFillReconciliation.status === "blocking_issue"
                      ? "bahagian-a-pfr-status-blocking"
                      : job.bahagianAPostFillReconciliation.status === "fill_attempt_failed"
                        ? "bahagian-a-pfr-status-failed"
                        : "bahagian-a-pfr-status-notready"
              }`}>
                <span className="bahagian-a-pfr-status-label">Reconciliation Status</span>
                <span className="bahagian-a-pfr-status-value">
                  {job.bahagianAPostFillReconciliation.status === "stopped_cleanly"
                    ? "Stopped Cleanly After First Field Fill"
                    : job.bahagianAPostFillReconciliation.status === "review_required"
                      ? "Review Required After First Field Fill"
                      : job.bahagianAPostFillReconciliation.status === "blocking_issue"
                        ? "Blocking Issue Found After First Field Fill"
                        : job.bahagianAPostFillReconciliation.status === "fill_attempt_failed"
                          ? "Bahagian A Fill Attempt Failed"
                          : "Post-Fill State Not Ready"}
                </span>
              </div>

              <p className="bahagian-a-pfr-explanation">{job.bahagianAPostFillReconciliation.explanation}</p>

              {/* Post-Fill Outcome + Stop Reason */}
              <div className="bahagian-a-pfr-outcome">
                <span className="bahagian-a-pfr-outcome-label">Post-Fill Outcome</span>
                <span className="bahagian-a-pfr-outcome-value">
                  {job.bahagianAPostFillReconciliation.outcome.replace(/_/g, " ")}
                </span>
              </div>
              <div className="bahagian-a-pfr-stop-reason">
                <span className="bahagian-a-pfr-stop-reason-label">Stop Reason</span>
                <span className="bahagian-a-pfr-stop-reason-value">
                  {job.bahagianAPostFillReconciliation.stopReason.replace(/_/g, " ")}
                </span>
              </div>

              {/* Target Field + Values */}
              {job.bahagianAPostFillReconciliation.targetField && (
                <div className="bahagian-a-pfr-target">
                  <span className="bahagian-a-pfr-target-label">Target Field</span>
                  <span className="bahagian-a-pfr-target-field">
                    &quot;{job.bahagianAPostFillReconciliation.targetField.labelText}&quot;
                    {job.bahagianAPostFillReconciliation.targetField.schemaFieldLabel && (
                      <> (Schema: &quot;{job.bahagianAPostFillReconciliation.targetField.schemaFieldLabel}&quot;)</>
                    )}
                  </span>
                </div>
              )}

              {job.bahagianAPostFillReconciliation.intendedValue !== undefined && (
                <div className="bahagian-a-pfr-values">
                  <div className="bahagian-a-pfr-value-row">
                    <span className="bahagian-a-pfr-value-label">Intended Value</span>
                    <span className="bahagian-a-pfr-value-data">
                      &quot;{job.bahagianAPostFillReconciliation.intendedValue}&quot;
                    </span>
                  </div>
                  <div className="bahagian-a-pfr-value-row">
                    <span className="bahagian-a-pfr-value-label">Observed Value</span>
                    <span className="bahagian-a-pfr-value-data">
                      &quot;{job.bahagianAPostFillReconciliation.observedValue ?? "(null)"}&quot;
                    </span>
                  </div>
                  <div className="bahagian-a-pfr-value-row">
                    <span className="bahagian-a-pfr-value-label">Readback Match</span>
                    <span className={`bahagian-a-pfr-value-data ${
                      job.bahagianAPostFillReconciliation.readbackMatch
                        ? "bahagian-a-pfr-match"
                        : "bahagian-a-pfr-mismatch"
                    }`}>
                      {job.bahagianAPostFillReconciliation.readbackMatch ? "MATCH" : "MISMATCH"}
                    </span>
                  </div>
                </div>
              )}

              {/* Post-Fill Evidence reference */}
              {job.bahagianAPostFillReconciliation.fillAttemptOutcome && (
                <div className="bahagian-a-pfr-evidence-ref">
                  <span className="bahagian-a-pfr-evidence-ref-label">Post-Fill Evidence</span>
                  <span className="bahagian-a-pfr-evidence-ref-item">
                    Fill Outcome: {job.bahagianAPostFillReconciliation.fillAttemptOutcome.replace(/_/g, " ")}
                  </span>
                  <span className="bahagian-a-pfr-evidence-ref-item">
                    Based on fill attempt evidence: {job.bahagianAPostFillReconciliation.basedOnFillAttemptEvidence ? "Yes" : "No"}
                  </span>
                </div>
              )}

              {/* Blocking reasons */}
              {job.bahagianAPostFillReconciliation.blockingReasons.length > 0 && (
                <div className="bahagian-a-pfr-blocking">
                  <span className="bahagian-a-pfr-blocking-label">Blocking Issues</span>
                  <ul className="bahagian-a-pfr-blocking-list">
                    {job.bahagianAPostFillReconciliation.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Review reasons */}
              {job.bahagianAPostFillReconciliation.reviewReasons.length > 0 && (
                <div className="bahagian-a-pfr-review">
                  <span className="bahagian-a-pfr-review-label">Review Items</span>
                  <ul className="bahagian-a-pfr-review-list">
                    {job.bahagianAPostFillReconciliation.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Checks summary */}
              <div className="bahagian-a-pfr-summary">
                <span className="bahagian-a-pfr-summary-label">Checks</span>
                <span className="bahagian-a-pfr-summary-value">
                  {job.bahagianAPostFillReconciliation.summary.passedCount}/{job.bahagianAPostFillReconciliation.summary.totalChecks} passed
                  {job.bahagianAPostFillReconciliation.summary.blockingFailures > 0 && (
                    <> &middot; {job.bahagianAPostFillReconciliation.summary.blockingFailures} blocking</>
                  )}
                  {job.bahagianAPostFillReconciliation.summary.advisoryFailures > 0 && (
                    <> &middot; {job.bahagianAPostFillReconciliation.summary.advisoryFailures} advisory</>
                  )}
                </span>
              </div>

              {/* Expandable checks detail */}
              <details className="bahagian-a-pfr-checks-details">
                <summary>All Checks ({job.bahagianAPostFillReconciliation.checks.length})</summary>
                <ul className="bahagian-a-pfr-checks-list">
                  {job.bahagianAPostFillReconciliation.checks.map((c, i) => (
                    <li key={i} className={`bahagian-a-pfr-check-item ${c.passed ? "bahagian-a-pfr-check-pass" : "bahagian-a-pfr-check-fail"}`}>
                      <span className="bahagian-a-pfr-check-badge">
                        {c.passed ? "PASS" : "FAIL"} [{c.severity}]
                      </span>
                      {" "}{c.description}
                      {c.reason && !c.passed && (
                        <span className="bahagian-a-pfr-check-reason"> — {c.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="bahagian-a-pfr-empty">
              Bahagian A post-fill reconciliation has not been evaluated yet.
            </p>
          )}

          <div className="bahagian-a-pfr-actions" style={{ marginTop: 10 }}>
            {bahagianAPostFillReconError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianAPostFillReconError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleBahagianAPostFillRecon}
              disabled={runningBahagianAPostFillRecon}
              style={{ background: "#f5f5f5" }}
            >
              {runningBahagianAPostFillRecon
                ? "Evaluating…"
                : job.bahagianAPostFillReconciliation
                  ? "Re-evaluate Post-Fill Reconciliation"
                  : "Evaluate Post-Fill Reconciliation"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bahagian A Fill Attempt ────────────────────────────────── */}
      {job.bahagianAFillAuthorization && job.bahagianAFillPreflight && job.bahagianAEntryState && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-fill-attempt-section">
          <h2 className="bahagian-a-fill-attempt-heading">Bahagian A Single-Field Fill Attempt</h2>
          <p className="bahagian-a-fill-attempt-intro">
            WeStamp can execute a guarded first single-field fill in Bahagian A for one grounded editable field.
            This fills exactly ONE field, captures post-fill evidence, then stops.
          </p>

          {job.bahagianAFillAttempt ? (
            <>
              <div className={`bahagian-a-fill-attempt-status ${
                job.bahagianAFillAttempt.status === "completed_with_stop"
                  ? "bahagian-a-fill-attempt-status-completed"
                  : job.bahagianAFillAttempt.status === "failed"
                    ? "bahagian-a-fill-attempt-status-failed"
                    : job.bahagianAFillAttempt.status === "blocked"
                      ? "bahagian-a-fill-attempt-status-blocked"
                      : "bahagian-a-fill-attempt-status-notready"
              }`}>
                <span className="bahagian-a-fill-attempt-status-label">Fill Attempt Status</span>
                <span className="bahagian-a-fill-attempt-status-value">
                  {job.bahagianAFillAttempt.status === "completed_with_stop"
                    ? "Single-Field Fill Completed (Stopped)"
                    : job.bahagianAFillAttempt.status === "failed"
                      ? "Fill Attempt Failed"
                      : job.bahagianAFillAttempt.status === "blocked"
                        ? "Fill Attempt Blocked"
                        : "Fill Attempt Not Ready"}
                </span>
              </div>

              {/* Target info */}
              {job.bahagianAFillAttempt.target && (
                <div className="bahagian-a-fill-attempt-target">
                  <span className="bahagian-a-fill-attempt-target-label">Fill Target</span>
                  <span className="bahagian-a-fill-attempt-target-field">
                    Field: &quot;{job.bahagianAFillAttempt.target.labelText}&quot;
                    {job.bahagianAFillAttempt.target.schemaFieldLabel && (
                      <> (Schema: &quot;{job.bahagianAFillAttempt.target.schemaFieldLabel}&quot;)</>
                    )}
                  </span>
                  <span className="bahagian-a-fill-attempt-target-value">
                    Intended Value: &quot;{job.bahagianAFillAttempt.target.intendedValue}&quot;
                  </span>
                  <span className="bahagian-a-fill-attempt-target-reason">
                    {job.bahagianAFillAttempt.target.selectionReason}
                  </span>
                </div>
              )}

              {/* Evidence */}
              {job.bahagianAFillAttempt.evidence && (
                <div className="bahagian-a-fill-attempt-evidence">
                  <span className="bahagian-a-fill-attempt-evidence-label">Post-Fill Evidence</span>
                  <span className="bahagian-a-fill-attempt-evidence-item">
                    Outcome: {job.bahagianAFillAttempt.evidence.outcome.replace(/_/g, " ")}
                  </span>
                  {job.bahagianAFillAttempt.evidence.readbackValue !== undefined && (
                    <span className="bahagian-a-fill-attempt-evidence-item">
                      Readback Value: &quot;{job.bahagianAFillAttempt.evidence.readbackValue ?? "(null)"}&quot;
                    </span>
                  )}
                  {job.bahagianAFillAttempt.evidence.readbackMatch !== undefined && (
                    <span className={`bahagian-a-fill-attempt-evidence-item ${
                      job.bahagianAFillAttempt.evidence.readbackMatch
                        ? "bahagian-a-fill-attempt-readback-match"
                        : "bahagian-a-fill-attempt-readback-mismatch"
                    }`}>
                      Readback: {job.bahagianAFillAttempt.evidence.readbackMatch ? "MATCH" : "MISMATCH"}
                    </span>
                  )}
                  {job.bahagianAFillAttempt.evidence.selectorMethod && (
                    <span className="bahagian-a-fill-attempt-evidence-item">
                      Selector: {job.bahagianAFillAttempt.evidence.selectorMethod}
                    </span>
                  )}
                  {job.bahagianAFillAttempt.evidence.screenshotFileName && (
                    <span className="bahagian-a-fill-attempt-evidence-item bahagian-a-fill-attempt-screenshot">
                      Screenshot: {job.bahagianAFillAttempt.evidence.screenshotFileName}
                    </span>
                  )}
                  {job.bahagianAFillAttempt.evidence.notes.length > 0 && (
                    <ul className="bahagian-a-fill-attempt-evidence-notes">
                      {job.bahagianAFillAttempt.evidence.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Block reason */}
              {job.bahagianAFillAttempt.blockReason && (
                <p className="bahagian-a-fill-attempt-block-reason">
                  {job.bahagianAFillAttempt.blockReason}
                </p>
              )}

              {/* Notes */}
              {job.bahagianAFillAttempt.notes.length > 0 && (
                <details className="bahagian-a-fill-attempt-notes-details">
                  <summary>Attempt Notes ({job.bahagianAFillAttempt.notes.length})</summary>
                  <ul className="bahagian-a-fill-attempt-notes-list">
                    {job.bahagianAFillAttempt.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="bahagian-a-fill-attempt-disclaimer">
                Attempted at: {new Date(job.bahagianAFillAttempt.attemptedAt).toLocaleString()}.
                Only ONE field was filled. No further automation was performed.
              </p>
            </>
          ) : (
            <p className="bahagian-a-fill-attempt-empty">
              Bahagian A single-field fill attempt has not been performed yet.
            </p>
          )}

          <div className="bahagian-a-fill-attempt-actions" style={{ marginTop: 10 }}>
            {bahagianAFillAttemptError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianAFillAttemptError}
              </p>
            )}
            {/* Run button — only when fill auth is active and preflight eligible and no completed attempt yet */}
            {job.bahagianAFillAuthorization?.status === "active" &&
              job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt" &&
              (!job.bahagianAFillAttempt || job.bahagianAFillAttempt.status === "blocked" || job.bahagianAFillAttempt.status === "failed") && (
              <button
                className="btn btn-secondary"
                onClick={handleBahagianAFillAttempt}
                disabled={runningBahagianAFillAttempt}
                style={{ background: "#fff3e0", borderColor: "#ffcc80" }}
              >
                {runningBahagianAFillAttempt
                  ? "Filling Bahagian A field…"
                  : "Run Bahagian A Single-Field Fill (Local/Dev)"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Bahagian A Fill Authorization ─────────────────────────── */}
      {job.bahagianAFillPreflight && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-auth-section">
          <h2 className="bahagian-a-auth-heading">Bahagian A Fill Authorization</h2>
          <p className="bahagian-a-auth-intro">
            WeStamp can record an explicit local/dev authorization for a future first Bahagian A field-fill attempt.
          </p>

          {job.bahagianAFillAuthorization ? (
            <>
              <div className={`bahagian-a-auth-status ${
                job.bahagianAFillAuthorization.status === "active"
                  ? "bahagian-a-auth-status-active"
                  : job.bahagianAFillAuthorization.status === "available"
                    ? "bahagian-a-auth-status-available"
                    : job.bahagianAFillAuthorization.status === "stale"
                      ? "bahagian-a-auth-status-stale"
                      : job.bahagianAFillAuthorization.status === "revoked"
                        ? "bahagian-a-auth-status-revoked"
                        : "bahagian-a-auth-status-notavailable"
              }`}>
                <span className="bahagian-a-auth-status-label">Authorization Status</span>
                <span className="bahagian-a-auth-status-value">
                  {job.bahagianAFillAuthorization.status === "active"
                    ? "Authorization Active"
                    : job.bahagianAFillAuthorization.status === "available"
                      ? "Authorization Available for Local Confirmation"
                      : job.bahagianAFillAuthorization.status === "stale"
                        ? "Authorization Stale"
                        : job.bahagianAFillAuthorization.status === "revoked"
                          ? "Authorization Revoked"
                          : "Authorization Not Available"}
                </span>
              </div>

              <p className="bahagian-a-auth-explanation">{job.bahagianAFillAuthorization.explanation}</p>

              {/* Stale reasons */}
              {job.bahagianAFillAuthorization.staleReasons.length > 0 && job.bahagianAFillAuthorization.status === "stale" && (
                <div className="bahagian-a-auth-stale-reasons">
                  <span className="bahagian-a-auth-stale-label">Stale Reason</span>
                  <ul className="bahagian-a-auth-stale-list">
                    {job.bahagianAFillAuthorization.staleReasons.map((r, i) => (
                      <li key={i}>{r.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* State ref / issued against */}
              {job.bahagianAFillAuthorization.stateRef && job.bahagianAFillAuthorization.status === "active" && (
                <div className="bahagian-a-auth-state-ref">
                  <span className="bahagian-a-auth-state-ref-label">Issued Against</span>
                  <span className="bahagian-a-auth-state-ref-item">
                    Fill Preflight: {new Date(job.bahagianAFillAuthorization.stateRef.fillPreflightEvaluatedAt).toLocaleString()}
                  </span>
                  <span className="bahagian-a-auth-state-ref-item">
                    Entry-State: {new Date(job.bahagianAFillAuthorization.stateRef.entryStateObservedAt).toLocaleString()}
                  </span>
                  <span className="bahagian-a-auth-state-ref-item">
                    Schema Grounding Status: {job.bahagianAFillAuthorization.stateRef.groundingStatus.replace(/_/g, " ")}
                  </span>
                  <span className="bahagian-a-auth-state-ref-item">
                    Next-Tab Attempt: {new Date(job.bahagianAFillAuthorization.stateRef.nextTabAttemptAttemptedAt).toLocaleString()}
                  </span>
                  <span className="bahagian-a-auth-state-ref-item">
                    Lane: {job.bahagianAFillAuthorization.stateRef.lane.replace(/_/g, " ")}
                  </span>
                </div>
              )}

              {/* Expiry */}
              {job.bahagianAFillAuthorization.expiry && job.bahagianAFillAuthorization.status === "active" && (
                <p className="bahagian-a-auth-expiry">
                  Expires: {new Date(job.bahagianAFillAuthorization.expiry.expiresAt).toLocaleString()} ({job.bahagianAFillAuthorization.expiry.windowMinutes} min window)
                </p>
              )}

              <p className="bahagian-a-auth-disclaimer">
                No Bahagian A field-filling has been attempted.
              </p>
            </>
          ) : (
            <p className="bahagian-a-auth-empty">Bahagian A fill authorization has not been evaluated yet.</p>
          )}

          <div className="bahagian-a-auth-actions" style={{ marginTop: 10 }}>
            {bahagianAFillAuthError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianAFillAuthError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Issue button — only when preflight eligible and no active auth */}
              {(job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt" || job.bahagianAFillPreflight.status === "review_required") &&
                (!job.bahagianAFillAuthorization || job.bahagianAFillAuthorization.status !== "active") && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleBahagianAFillAuthAction("issue")}
                  disabled={runningBahagianAFillAuth}
                >
                  {runningBahagianAFillAuth ? "Issuing…" : "Issue Bahagian A Fill Authorization (Local/Dev)"}
                </button>
              )}
              {/* Revoke button — only when active */}
              {job.bahagianAFillAuthorization?.status === "active" && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleBahagianAFillAuthAction("revoke")}
                  disabled={runningBahagianAFillAuth}
                  style={{ background: "#fff3e0", borderColor: "#ffcc80" }}
                >
                  {runningBahagianAFillAuth ? "Revoking…" : "Revoke Authorization"}
                </button>
              )}
              {/* Re-evaluate button — always available */}
              <button
                className="btn btn-secondary"
                onClick={() => handleBahagianAFillAuthAction("evaluate")}
                disabled={runningBahagianAFillAuth}
                style={{ background: "#f5f5f5" }}
              >
                {runningBahagianAFillAuth ? "Evaluating…" : "Re-evaluate Authorization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bahagian A Fill Preflight ──────────────────────────────── */}
      {job.bahagianAEntryState && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-fp-section">
          <h2 className="bahagian-a-fp-heading">Bahagian A Fill Preflight</h2>
          <p className="bahagian-a-fp-intro">
            WeStamp has evaluated whether a future first Bahagian A field-fill attempt is internally eligible for this job.
          </p>
          <p className="bahagian-a-fp-disclaimer">
            No Bahagian A field-filling has been attempted.
          </p>

          {job.bahagianAFillPreflight ? (
            <>
              <div className={`bahagian-a-fp-status ${
                job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt"
                  ? "bahagian-a-fp-status-eligible"
                  : job.bahagianAFillPreflight.status === "review_required"
                    ? "bahagian-a-fp-status-review"
                    : job.bahagianAFillPreflight.status === "blocking_issues"
                      ? "bahagian-a-fp-status-blocking"
                      : "bahagian-a-fp-status-notready"
              }`}>
                <span className="bahagian-a-fp-status-label">Preflight Status</span>
                <span className="bahagian-a-fp-status-value">
                  {job.bahagianAFillPreflight.status === "eligible_for_later_fill_attempt"
                    ? "Internally Eligible for Later Bahagian A Fill Attempt"
                    : job.bahagianAFillPreflight.status === "review_required"
                      ? "Review Required Before Bahagian A Fill"
                      : job.bahagianAFillPreflight.status === "blocking_issues"
                        ? "Blocking Issues Found"
                        : "Bahagian A Fill Preflight Not Ready"}
                </span>
              </div>

              <p className="bahagian-a-fp-explanation">{job.bahagianAFillPreflight.explanation}</p>

              {/* Guard decision */}
              <div className={`bahagian-a-fp-guard ${
                job.bahagianAFillPreflight.guard.decision === "permitted"
                  ? "bahagian-a-fp-guard-permitted"
                  : job.bahagianAFillPreflight.guard.decision === "review_gated"
                    ? "bahagian-a-fp-guard-review"
                    : "bahagian-a-fp-guard-refused"
              }`}>
                <span className="bahagian-a-fp-guard-label">Fill Guard</span>
                <span className="bahagian-a-fp-guard-value">
                  {job.bahagianAFillPreflight.guard.decision === "permitted"
                    ? "Permitted"
                    : job.bahagianAFillPreflight.guard.decision === "review_gated"
                      ? "Review Gated"
                      : "Refused"}
                </span>
                <p className="bahagian-a-fp-guard-explanation">
                  {job.bahagianAFillPreflight.guard.explanation}
                </p>
              </div>

              {/* Field mode summary */}
              <div className="bahagian-a-fp-modes">
                <span className="bahagian-a-fp-modes-label">Observed Field Modes</span>
                <div className="bahagian-a-fp-modes-row">
                  <span className="bahagian-a-fp-mode-item">
                    Editable: <strong>{job.bahagianAFillPreflight.fieldModeSummary.editableCount}</strong>
                  </span>
                  <span className="bahagian-a-fp-mode-item">
                    Read-only: <strong>{job.bahagianAFillPreflight.fieldModeSummary.readOnlyCount}</strong>
                  </span>
                  <span className="bahagian-a-fp-mode-item">
                    Derived: <strong>{job.bahagianAFillPreflight.fieldModeSummary.derivedCount}</strong>
                  </span>
                  <span className="bahagian-a-fp-mode-item">
                    Unknown: <strong>{job.bahagianAFillPreflight.fieldModeSummary.unknownCount}</strong>
                  </span>
                </div>
              </div>

              {/* Schema grounding status */}
              {job.bahagianAFillPreflight.groundingStatus && (
                <div className="bahagian-a-fp-grounding">
                  <span className="bahagian-a-fp-grounding-label">Schema Grounding Status</span>
                  <span className="bahagian-a-fp-grounding-value">
                    {job.bahagianAFillPreflight.groundingStatus.replace(/_/g, " ")}
                  </span>
                </div>
              )}

              {/* Blocking reasons */}
              {job.bahagianAFillPreflight.blockingReasons.length > 0 && (
                <div className="bahagian-a-fp-blocking">
                  <span className="bahagian-a-fp-blocking-label">Blocking Reasons</span>
                  <ul className="bahagian-a-fp-blocking-list">
                    {job.bahagianAFillPreflight.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory reasons */}
              {job.bahagianAFillPreflight.advisoryReasons.length > 0 && (
                <div className="bahagian-a-fp-advisory">
                  <span className="bahagian-a-fp-advisory-label">Advisory Reasons</span>
                  <ul className="bahagian-a-fp-advisory-list">
                    {job.bahagianAFillPreflight.advisoryReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Checks summary */}
              <div className="bahagian-a-fp-checks-summary">
                <span className="bahagian-a-fp-checks-label">Checks</span>
                <span className="bahagian-a-fp-checks-text">
                  {job.bahagianAFillPreflight.summary.passedCount}/{job.bahagianAFillPreflight.summary.totalChecks} passed
                  {job.bahagianAFillPreflight.summary.blockingFailures > 0 &&
                    ` · ${job.bahagianAFillPreflight.summary.blockingFailures} blocking`}
                  {job.bahagianAFillPreflight.summary.advisoryFailures > 0 &&
                    ` · ${job.bahagianAFillPreflight.summary.advisoryFailures} advisory`}
                  {job.bahagianAFillPreflight.summary.informationalFailures > 0 &&
                    ` · ${job.bahagianAFillPreflight.summary.informationalFailures} informational`}
                </span>
              </div>

              {/* Per-check details (collapsed by default with a toggle would be ideal,
                  but keeping it simple — show all checks) */}
              <div className="bahagian-a-fp-checks-detail">
                {job.bahagianAFillPreflight.checks.map((c) => (
                  <div key={c.checkId} className={`bahagian-a-fp-check ${
                    c.passed
                      ? "bahagian-a-fp-check-passed"
                      : c.severity === "blocking"
                        ? "bahagian-a-fp-check-blocking"
                        : c.severity === "advisory"
                          ? "bahagian-a-fp-check-advisory"
                          : "bahagian-a-fp-check-info"
                  }`}>
                    <span className="bahagian-a-fp-check-status">
                      {c.passed ? "✓" : c.severity === "blocking" ? "✗" : "⚠"}
                    </span>
                    <span className="bahagian-a-fp-check-desc">{c.description}</span>
                    {!c.passed && c.reason && (
                      <span className="bahagian-a-fp-check-reason">{c.reason}</span>
                    )}
                  </div>
                ))}
              </div>

              <p className="bahagian-a-fp-meta">
                Evaluated: {new Date(job.bahagianAFillPreflight.evaluatedAt).toLocaleString()} | Lane: {job.bahagianAFillPreflight.lane.replace(/_/g, " ")}
              </p>
            </>
          ) : (
            <p className="bahagian-a-fp-empty">Bahagian A fill preflight has not been evaluated yet.</p>
          )}

          <div className="bahagian-a-fp-actions" style={{ marginTop: 10 }}>
            {bahagianAFillPreflightError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianAFillPreflightError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleRunBahagianAFillPreflight}
              disabled={runningBahagianAFillPreflight}
            >
              {runningBahagianAFillPreflight
                ? "Evaluating…"
                : job.bahagianAFillPreflight
                  ? "Re-evaluate Bahagian A Fill Preflight"
                  : "Evaluate Bahagian A Fill Preflight"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bahagian A Entry-State ───────────────────────────────────── */}
      {job.nextTabAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="bahagian-a-section">
          <h2 className="bahagian-a-heading">Bahagian A Entry-State</h2>
          <p className="bahagian-a-intro">
            WeStamp has captured the current Bahagian A entry-state for this job.
          </p>
          <p className="bahagian-a-disclaimer">
            No Bahagian A field-filling has been attempted.
          </p>

          {job.bahagianAEntryState ? (
            <>
              <div className={`bahagian-a-status ${
                job.bahagianAEntryState.status === "ready_for_review"
                  ? "bahagian-a-status-ready"
                  : job.bahagianAEntryState.status === "partially_matched"
                    ? "bahagian-a-status-partial"
                    : job.bahagianAEntryState.status === "observed"
                      ? "bahagian-a-status-observed"
                      : job.bahagianAEntryState.status === "grounding_incomplete"
                        ? "bahagian-a-status-incomplete"
                        : "bahagian-a-status-notobserved"
              }`}>
                <span className="bahagian-a-status-label">Grounding Status</span>
                <span className="bahagian-a-status-value">
                  {job.bahagianAEntryState.status === "ready_for_review"
                    ? "Schema Grounding Ready for Review"
                    : job.bahagianAEntryState.status === "partially_matched"
                      ? "Schema Grounding Partially Matched"
                      : job.bahagianAEntryState.status === "observed"
                        ? "Bahagian A Observed"
                        : job.bahagianAEntryState.status === "grounding_incomplete"
                          ? "Schema Grounding Incomplete"
                          : "Bahagian A Not Observed"}
                </span>
              </div>

              {/* Summary counters */}
              <div className="bahagian-a-summary">
                <div className="bahagian-a-summary-row">
                  <span className="bahagian-a-summary-label">Observed Fields</span>
                  <span className="bahagian-a-summary-value">{job.bahagianAEntryState.summary.totalObservedFields}</span>
                </div>
                <div className="bahagian-a-summary-row">
                  <span className="bahagian-a-summary-label">Grounded Fields</span>
                  <span className="bahagian-a-summary-value">{job.bahagianAEntryState.summary.groundedCount}</span>
                </div>
                <div className="bahagian-a-summary-row">
                  <span className="bahagian-a-summary-label">Unmatched Observed Fields</span>
                  <span className="bahagian-a-summary-value">{job.bahagianAEntryState.summary.unmatchedObservedCount}</span>
                </div>
                <div className="bahagian-a-summary-row">
                  <span className="bahagian-a-summary-label">Expected but Not Observed</span>
                  <span className="bahagian-a-summary-value">{job.bahagianAEntryState.summary.expectedButNotObservedCount}</span>
                </div>
                {job.bahagianAEntryState.summary.uncertainCount > 0 && (
                  <div className="bahagian-a-summary-row">
                    <span className="bahagian-a-summary-label">Uncertain</span>
                    <span className="bahagian-a-summary-value">{job.bahagianAEntryState.summary.uncertainCount}</span>
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="bahagian-a-meta">
                <span className="bahagian-a-meta-item">
                  Tab: {job.bahagianAEntryState.tabLabel} | Lane: {job.bahagianAEntryState.lane.replace(/_/g, " ")}
                </span>
                <span className="bahagian-a-meta-item">
                  Observed: {new Date(job.bahagianAEntryState.observedAt).toLocaleString()}
                </span>
                {job.bahagianAEntryState.screenshotFileName && (
                  <span className="bahagian-a-meta-item">
                    Screenshot: {job.bahagianAEntryState.screenshotFileName}
                  </span>
                )}
              </div>

              {/* Observed fields list */}
              {job.bahagianAEntryState.observedFields.length > 0 && (
                <div className="bahagian-a-fields">
                  <span className="bahagian-a-fields-label">Observed Fields</span>
                  <table className="bahagian-a-fields-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Label</th>
                        <th>Field Mode</th>
                        <th>Field Type Hint</th>
                        <th>Required</th>
                        <th>Current Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.bahagianAEntryState.observedFields.map((f) => (
                        <tr key={f.index}>
                          <td>{f.index + 1}</td>
                          <td>{f.labelText}</td>
                          <td>
                            <span className={`bahagian-a-mode bahagian-a-mode-${f.mode}`}>
                              {f.mode.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td>{f.typeHint.replace(/_/g, " ")}</td>
                          <td>{f.appearsRequired ? "Yes" : "–"}</td>
                          <td className="bahagian-a-field-value">
                            {f.currentValue ?? "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Grounding entries */}
              {job.bahagianAEntryState.groundingEntries.length > 0 && (
                <div className="bahagian-a-grounding">
                  <span className="bahagian-a-grounding-label">Schema Grounding</span>
                  <table className="bahagian-a-grounding-table">
                    <thead>
                      <tr>
                        <th>Classification</th>
                        <th>Observed Label</th>
                        <th>Schema Field</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.bahagianAEntryState.groundingEntries.map((g, i) => (
                        <tr key={i} className={`bahagian-a-grounding-${g.match}`}>
                          <td>
                            <span className={`bahagian-a-match bahagian-a-match-${g.match}`}>
                              {g.match === "matched"
                                ? "Matched"
                                : g.match === "unmatched"
                                  ? "Unmatched"
                                  : g.match === "expected_missing"
                                    ? "Expected Missing"
                                    : "Uncertain"}
                            </span>
                          </td>
                          <td>{g.observedField?.labelText ?? "–"}</td>
                          <td>{g.schemaFieldLabel ?? "–"}</td>
                          <td className="bahagian-a-grounding-note">{g.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Quality notes */}
              {job.bahagianAEntryState.summary.qualityNotes.length > 0 && (
                <div className="bahagian-a-quality">
                  <span className="bahagian-a-quality-label">Quality Notes</span>
                  <ul className="bahagian-a-quality-list">
                    {job.bahagianAEntryState.summary.qualityNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Notes */}
              {job.bahagianAEntryState.notes.length > 0 && (
                <div className="bahagian-a-notes">
                  <span className="bahagian-a-notes-label">Observation Notes</span>
                  <ul className="bahagian-a-notes-list">
                    {job.bahagianAEntryState.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="bahagian-a-empty">Bahagian A entry-state has not been captured yet.</p>
          )}

          <div className="bahagian-a-actions" style={{ marginTop: 10 }}>
            {bahagianAGroundingError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {bahagianAGroundingError}
              </p>
            )}
            {job.nextTabAttempt.status === "completed_with_stop" &&
              job.nextTabAttempt.toTabKey === "bahagian_a" &&
              job.nextTabAuthorization?.status === "active" &&
              job.nextTabPreflight?.status === "eligible_for_later_attempt" && (
              <button
                className="btn btn-secondary"
                onClick={handleRunBahagianAGrounding}
                disabled={runningBahagianAGrounding}
              >
                {runningBahagianAGrounding
                  ? "Capturing Bahagian A Entry-State…"
                  : job.bahagianAEntryState
                    ? "Re-capture Bahagian A Entry-State (Local/Dev)"
                    : "Capture Bahagian A Entry-State (Local/Dev)"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Next-Tab Progression Attempt ────────────────────────────── */}
      {job.nextTabAuthorization && job.nextTabPreflight && job.saveAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="next-tab-attempt-section">
          <h2 className="next-tab-attempt-heading">Next-Tab Progression Attempt</h2>
          <p className="next-tab-attempt-intro">
            WeStamp can perform the first local/dev next-tab progression click from Maklumat Am into Bahagian A.
            No Bahagian A fields are filled. Automation stops immediately after the post-click observation.
          </p>

          {job.nextTabAttempt ? (
            <>
              <div className={`next-tab-attempt-status ${
                job.nextTabAttempt.status === "completed_with_stop"
                  ? "next-tab-attempt-status-completed"
                  : job.nextTabAttempt.status === "blocked"
                    ? "next-tab-attempt-status-blocked"
                    : job.nextTabAttempt.status === "failed"
                      ? "next-tab-attempt-status-failed"
                      : "next-tab-attempt-status-default"
              }`}>
                <span className="next-tab-attempt-status-label">Attempt Status</span>
                <span className="next-tab-attempt-status-value">
                  {job.nextTabAttempt.status === "completed_with_stop"
                    ? "Completed — Stopped After Observation"
                    : job.nextTabAttempt.status === "blocked"
                      ? "Blocked"
                      : job.nextTabAttempt.status === "failed"
                        ? "Failed"
                        : job.nextTabAttempt.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="next-tab-attempt-meta">
                <span className="next-tab-attempt-meta-item">
                  Progression: {job.nextTabAttempt.fromTabKey} → {job.nextTabAttempt.toTabKey} ({job.nextTabAttempt.toTabLabel})
                </span>
                <span className="next-tab-attempt-meta-item">
                  Lane: {job.nextTabAttempt.lane.replace(/_/g, " ")}
                </span>
                <span className="next-tab-attempt-meta-item">
                  Attempted: {new Date(job.nextTabAttempt.attemptedAt).toLocaleString()}
                </span>
                <span className="next-tab-attempt-meta-item">
                  Auth Active: {job.nextTabAttempt.authorizationWasActive ? "Yes" : "No"} | Preflight Eligible: {job.nextTabAttempt.preflightWasEligible ? "Yes" : "No"}
                </span>
              </div>

              {/* Block reason */}
              {job.nextTabAttempt.blockReason && (
                <div className="next-tab-attempt-block-reason">
                  <span className="next-tab-attempt-block-label">Block Reason</span>
                  <p className="next-tab-attempt-block-text">{job.nextTabAttempt.blockReason}</p>
                </div>
              )}

              {/* Evidence */}
              {job.nextTabAttempt.evidence && (
                <div className="next-tab-attempt-evidence">
                  <span className="next-tab-attempt-evidence-label">Post-Click Evidence</span>
                  <div className="next-tab-attempt-evidence-row">
                    <span className="next-tab-attempt-evidence-key">Outcome</span>
                    <span className={`next-tab-attempt-outcome ${
                      job.nextTabAttempt.evidence.outcome === "tab_became_active"
                        ? "next-tab-attempt-outcome-success"
                        : job.nextTabAttempt.evidence.outcome === "tab_content_visible"
                          ? "next-tab-attempt-outcome-success"
                          : job.nextTabAttempt.evidence.outcome === "error_or_validation"
                            ? "next-tab-attempt-outcome-error"
                            : "next-tab-attempt-outcome-neutral"
                    }`}>
                      {job.nextTabAttempt.evidence.outcome.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="next-tab-attempt-evidence-row">
                    <span className="next-tab-attempt-evidence-key">Target Tab Active</span>
                    <span>{job.nextTabAttempt.evidence.targetTabAppearedActive ? "Yes" : "No"}</span>
                  </div>
                  {job.nextTabAttempt.evidence.observedTabLabel && (
                    <div className="next-tab-attempt-evidence-row">
                      <span className="next-tab-attempt-evidence-key">Observed Tab Label</span>
                      <span>{job.nextTabAttempt.evidence.observedTabLabel}</span>
                    </div>
                  )}
                  {job.nextTabAttempt.evidence.observedPortalMessage && (
                    <div className="next-tab-attempt-evidence-row">
                      <span className="next-tab-attempt-evidence-key">Portal Message</span>
                      <span>{job.nextTabAttempt.evidence.observedPortalMessage}</span>
                    </div>
                  )}
                  {job.nextTabAttempt.evidence.screenshotFileName && (
                    <div className="next-tab-attempt-evidence-row">
                      <span className="next-tab-attempt-evidence-key">Screenshot</span>
                      <span className="next-tab-attempt-evidence-file">{job.nextTabAttempt.evidence.screenshotFileName}</span>
                    </div>
                  )}
                  {job.nextTabAttempt.evidence.notes.length > 0 && (
                    <div className="next-tab-attempt-evidence-notes">
                      <span className="next-tab-attempt-evidence-key">Evidence Notes</span>
                      <ul className="next-tab-attempt-notes-list">
                        {job.nextTabAttempt.evidence.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Artifact dir */}
              {job.nextTabAttempt.artifactDir && (
                <p className="next-tab-attempt-artifact-dir">
                  Artifacts: {job.nextTabAttempt.artifactDir}
                </p>
              )}

              {/* Notes */}
              {job.nextTabAttempt.notes.length > 0 && (
                <div className="next-tab-attempt-notes">
                  <span className="next-tab-attempt-notes-label">Notes</span>
                  <ul className="next-tab-attempt-notes-list">
                    {job.nextTabAttempt.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="next-tab-attempt-disclaimer">
                Automation stopped immediately after post-click observation. No Bahagian A fields were filled.
              </p>
            </>
          ) : (
            <p className="next-tab-attempt-empty">No next-tab progression attempt has been performed yet.</p>
          )}

          <div className="next-tab-attempt-actions" style={{ marginTop: 10 }}>
            {nextTabAttemptError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {nextTabAttemptError}
              </p>
            )}
            {/* Only show button when authorization is active and preflight eligible */}
            {job.nextTabAuthorization.status === "active" &&
              job.nextTabPreflight.status === "eligible_for_later_attempt" && (
              <button
                className="btn btn-secondary"
                onClick={handleRunNextTabAttempt}
                disabled={runningNextTabAttempt}
              >
                {runningNextTabAttempt ? "Running Next-Tab Attempt…" : "Run Next-Tab Attempt (Local/Dev)"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Next-Tab Progression Authorization ──────────────────────── */}
      {job.nextTabPreflight && job.saveAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="next-tab-auth-section">
          <h2 className="next-tab-auth-heading">Next-Tab Progression Authorization</h2>
          <p className="next-tab-auth-intro">
            WeStamp can record an explicit local/dev authorization for a future first next-tab progression attempt.
          </p>

          {job.nextTabAuthorization ? (
            <>
              <div className={`next-tab-auth-status ${
                job.nextTabAuthorization.status === "active"
                  ? "next-tab-auth-status-active"
                  : job.nextTabAuthorization.status === "available"
                    ? "next-tab-auth-status-available"
                    : job.nextTabAuthorization.status === "stale"
                      ? "next-tab-auth-status-stale"
                      : job.nextTabAuthorization.status === "revoked"
                        ? "next-tab-auth-status-revoked"
                        : "next-tab-auth-status-notavailable"
              }`}>
                <span className="next-tab-auth-status-label">Authorization Status</span>
                <span className="next-tab-auth-status-value">
                  {job.nextTabAuthorization.status === "active"
                    ? "Authorization Active"
                    : job.nextTabAuthorization.status === "available"
                      ? "Authorization Available for Local Confirmation"
                      : job.nextTabAuthorization.status === "stale"
                        ? "Authorization Stale"
                        : job.nextTabAuthorization.status === "revoked"
                          ? "Authorization Revoked"
                          : "Authorization Not Available"}
                </span>
              </div>

              <p className="next-tab-auth-explanation">{job.nextTabAuthorization.explanation}</p>

              {/* Stale reasons */}
              {job.nextTabAuthorization.staleReasons.length > 0 && job.nextTabAuthorization.status === "stale" && (
                <div className="next-tab-auth-stale-reasons">
                  <span className="next-tab-auth-stale-label">Stale Reason</span>
                  <ul className="next-tab-auth-stale-list">
                    {job.nextTabAuthorization.staleReasons.map((r, i) => (
                      <li key={i}>{r.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* State ref / issued against */}
              {job.nextTabAuthorization.stateRef && job.nextTabAuthorization.status === "active" && (
                <div className="next-tab-auth-state-ref">
                  <span className="next-tab-auth-state-ref-label">Issued Against</span>
                  <span className="next-tab-auth-state-ref-item">
                    Next-Tab Preflight: {new Date(job.nextTabAuthorization.stateRef.nextTabPreflightEvaluatedAt).toLocaleString()}
                  </span>
                  <span className="next-tab-auth-state-ref-item">
                    Reconciliation: {new Date(job.nextTabAuthorization.stateRef.reconciliationEvaluatedAt).toLocaleString()}
                  </span>
                  <span className="next-tab-auth-state-ref-item">
                    Save Attempt: {new Date(job.nextTabAuthorization.stateRef.saveAttemptAttemptedAt).toLocaleString()}
                  </span>
                  <span className="next-tab-auth-state-ref-item">
                    Expected Next Tab: {job.nextTabAuthorization.stateRef.expectedNextTabKey}
                  </span>
                  <span className="next-tab-auth-state-ref-item">
                    Lane: {job.nextTabAuthorization.stateRef.lane}
                  </span>
                </div>
              )}

              {/* Expiry */}
              {job.nextTabAuthorization.expiry && job.nextTabAuthorization.status === "active" && (
                <p className="next-tab-auth-expiry">
                  Expires: {new Date(job.nextTabAuthorization.expiry.expiresAt).toLocaleString()} ({job.nextTabAuthorization.expiry.windowMinutes} min window)
                </p>
              )}

              <p className="next-tab-auth-disclaimer">
                No next-tab progression has been attempted.
              </p>
            </>
          ) : (
            <p className="next-tab-auth-empty">Next-tab authorization has not been evaluated yet.</p>
          )}

          <div className="next-tab-auth-actions" style={{ marginTop: 10 }}>
            {nextTabAuthError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {nextTabAuthError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Issue button — only when preflight eligible and no active auth */}
              {(job.nextTabPreflight.status === "eligible_for_later_attempt" || job.nextTabPreflight.status === "review_required") &&
                (!job.nextTabAuthorization || job.nextTabAuthorization.status !== "active") && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleNextTabAuthAction("issue")}
                  disabled={runningNextTabAuth}
                >
                  {runningNextTabAuth ? "Issuing…" : "Issue Next-Tab Authorization (Local/Dev)"}
                </button>
              )}
              {/* Revoke button — only when active */}
              {job.nextTabAuthorization?.status === "active" && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleNextTabAuthAction("revoke")}
                  disabled={runningNextTabAuth}
                  style={{ background: "#fff3e0", borderColor: "#ffcc80" }}
                >
                  {runningNextTabAuth ? "Revoking…" : "Revoke Authorization"}
                </button>
              )}
              {/* Re-evaluate button — always available */}
              <button
                className="btn btn-secondary"
                onClick={() => handleNextTabAuthAction("evaluate")}
                disabled={runningNextTabAuth}
                style={{ background: "#f5f5f5" }}
              >
                {runningNextTabAuth ? "Evaluating…" : "Re-evaluate Authorization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Post-Save Reconciliation ─────────────────────────────────── */}
      {job.saveAttempt && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="reconciliation-section">
          <h2 className="reconciliation-heading">Post-Save Reconciliation</h2>
          <p className="reconciliation-intro">
            WeStamp classifies the stop state after the first Maklumat Am save attempt.
          </p>

          {job.postSaveReconciliation ? (
            <>
              <div className={`reconciliation-status ${
                job.postSaveReconciliation.status === "stopped_cleanly"
                  ? "reconciliation-status-clean"
                  : job.postSaveReconciliation.status === "review_required"
                    ? "reconciliation-status-review"
                    : job.postSaveReconciliation.status === "blocking_issue"
                      ? "reconciliation-status-blocking"
                      : job.postSaveReconciliation.status === "save_failed"
                        ? "reconciliation-status-failed"
                        : "reconciliation-status-notready"
              }`}>
                <span className="reconciliation-status-label">Reconciliation</span>
                <span className="reconciliation-status-value">
                  {job.postSaveReconciliation.status === "stopped_cleanly"
                    ? "Stopped Cleanly"
                    : job.postSaveReconciliation.status === "review_required"
                      ? "Review Required"
                      : job.postSaveReconciliation.status === "blocking_issue"
                        ? "Blocking Issue"
                        : job.postSaveReconciliation.status === "save_failed"
                          ? "Save Failed"
                          : "Not Ready"}
                </span>
              </div>

              {/* Outcome + Stop Reason */}
              <div className="reconciliation-context">
                <span className="reconciliation-context-item">
                  Outcome: {job.postSaveReconciliation.outcome.replace(/_/g, " ")}
                </span>
                <span className="reconciliation-context-item">
                  Stop Reason: {job.postSaveReconciliation.stopReason.replace(/_/g, " ")}
                </span>
                <span className="reconciliation-context-item">
                  Lane: {job.postSaveReconciliation.lane}
                </span>
                <span className={`reconciliation-context-item ${
                  job.postSaveReconciliation.basedOnPostSaveSnapshot
                    ? "reconciliation-basis-post-save"
                    : "reconciliation-basis-no-snapshot"
                }`}>
                  Basis: {job.postSaveReconciliation.basedOnPostSaveSnapshot
                    ? "Post-Save Snapshot"
                    : "No Post-Save Snapshot"}
                </span>
                {job.postSaveReconciliation.postSaveAssertionStatus && (
                  <span className="reconciliation-context-item">
                    Refreshed Assertion Status: {job.postSaveReconciliation.postSaveAssertionStatus}
                  </span>
                )}
              </div>

              {/* Post-save assertion summary (refreshed, not pre-save) */}
              {job.postSaveReconciliation.postSaveAssertionEvaluation && (
                <div className="reconciliation-assertion-refresh">
                  <span className="reconciliation-assertion-refresh-label">
                    Post-Save Assertion Refresh
                  </span>
                  <div className="reconciliation-assertion-refresh-summary">
                    <span>
                      Assertions: {job.postSaveReconciliation.postSaveAssertionEvaluation.summary.matchCount}/{job.postSaveReconciliation.postSaveAssertionEvaluation.summary.totalAssertions} matched
                    </span>
                    {job.postSaveReconciliation.postSaveAssertionEvaluation.summary.blockingMismatchCount > 0 && (
                      <span className="reconciliation-summary-blocking">
                        Blocking: {job.postSaveReconciliation.postSaveAssertionEvaluation.summary.blockingMismatchCount}
                      </span>
                    )}
                    {job.postSaveReconciliation.postSaveAssertionEvaluation.summary.advisoryMismatchCount > 0 && (
                      <span className="reconciliation-summary-advisory">
                        Advisory: {job.postSaveReconciliation.postSaveAssertionEvaluation.summary.advisoryMismatchCount}
                      </span>
                    )}
                  </div>
                  {job.postSaveReconciliation.postSaveAssertionEvaluation.blockingMismatches.length > 0 && (
                    <ul className="reconciliation-reasons-list" style={{ marginTop: 4 }}>
                      {job.postSaveReconciliation.postSaveAssertionEvaluation.blockingMismatches.map((m, i) => (
                        <li key={i} style={{ color: "#c62828" }}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Explanation */}
              <div className="reconciliation-explanation">
                <p>{job.postSaveReconciliation.explanation}</p>
              </div>

              {/* Summary */}
              <div className="reconciliation-summary">
                <span className="reconciliation-summary-item">
                  Checks: {job.postSaveReconciliation.summary.passedCount}/{job.postSaveReconciliation.summary.totalChecks} passed
                </span>
                {job.postSaveReconciliation.summary.blockingFailures > 0 && (
                  <span className="reconciliation-summary-item reconciliation-summary-blocking">
                    Blocking: {job.postSaveReconciliation.summary.blockingFailures}
                  </span>
                )}
                {job.postSaveReconciliation.summary.advisoryFailures > 0 && (
                  <span className="reconciliation-summary-item reconciliation-summary-advisory">
                    Advisory: {job.postSaveReconciliation.summary.advisoryFailures}
                  </span>
                )}
              </div>

              {/* Blocking reasons */}
              {job.postSaveReconciliation.blockingReasons.length > 0 && (
                <div className="reconciliation-reasons reconciliation-reasons-blocking">
                  <span className="reconciliation-reasons-label">Blocking Reasons</span>
                  <ul className="reconciliation-reasons-list">
                    {job.postSaveReconciliation.blockingReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Review reasons */}
              {job.postSaveReconciliation.reviewReasons.length > 0 && (
                <div className="reconciliation-reasons reconciliation-reasons-advisory">
                  <span className="reconciliation-reasons-label">Review Reasons</span>
                  <ul className="reconciliation-reasons-list">
                    {job.postSaveReconciliation.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Per-check details */}
              <details className="reconciliation-checks-details">
                <summary className="reconciliation-checks-summary">
                  Check Details ({job.postSaveReconciliation.checks.length})
                </summary>
                <table className="reconciliation-checks-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Severity</th>
                      <th>Result</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.postSaveReconciliation.checks.map((c, i) => (
                      <tr key={i} className={c.passed ? "reconciliation-check-pass" : "reconciliation-check-fail"}>
                        <td>{c.description}</td>
                        <td>
                          <span className={`reconciliation-severity reconciliation-severity-${c.severity}`}>
                            {c.severity}
                          </span>
                        </td>
                        <td>{c.passed ? "Passed" : "Failed"}</td>
                        <td>{c.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              <p className="reconciliation-disclaimer">
                This reconciliation classifies the immediate stop state only. No continuation action is performed.
              </p>
            </>
          ) : (
            <p className="reconciliation-empty">
              No post-save reconciliation has been evaluated yet.
            </p>
          )}

          <div style={{ marginTop: 10 }}>
            {reconciliationError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {reconciliationError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleRunReconciliation}
              disabled={runningReconciliation}
            >
              {runningReconciliation
                ? "Evaluating Reconciliation…"
                : job.postSaveReconciliation
                  ? "Re-evaluate Post-Save Reconciliation"
                  : "Evaluate Post-Save Reconciliation"}
            </button>
          </div>
        </div>
      )}

      {/* ── Maklumat Am Save Attempt ─────────────────────────────────── */}
      {job.saveAuthorization && job.savePreflight && job.portalDraft && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="save-attempt-section">
          <h2 className="save-attempt-heading">Maklumat Am Save Attempt</h2>
          <p className="save-attempt-intro">
            WeStamp can run the first local/dev Maklumat Am save attempt for this job when authorization is active.
          </p>

          {job.saveAttempt ? (
            <>
              <div className={`save-attempt-status ${
                job.saveAttempt.status === "completed_with_stop"
                  ? "save-attempt-status-completed"
                  : job.saveAttempt.status === "failed"
                    ? "save-attempt-status-failed"
                    : job.saveAttempt.status === "blocked"
                      ? "save-attempt-status-blocked"
                      : "save-attempt-status-notready"
              }`}>
                <span className="save-attempt-status-label">Save Attempt</span>
                <span className="save-attempt-status-value">
                  {job.saveAttempt.status === "completed_with_stop"
                    ? "Stopped After Save Observation"
                    : job.saveAttempt.status === "failed"
                      ? "Save Attempt Failed"
                      : job.saveAttempt.status === "blocked"
                        ? "Save Attempt Blocked"
                        : "Save Attempt Not Ready"}
                </span>
              </div>

              {/* Authorization / preflight state at time of attempt */}
              <div className="save-attempt-context">
                <span className="save-attempt-context-item">
                  Authorization State: {job.saveAttempt.authorizationWasActive ? "Active" : "Not Active"}
                </span>
                <span className="save-attempt-context-item">
                  Preflight: {job.saveAttempt.preflightWasEligible ? "Eligible" : "Not Eligible"}
                </span>
                <span className="save-attempt-context-item">
                  Lane: {job.saveAttempt.lane}
                </span>
              </div>

              {/* Block reason */}
              {job.saveAttempt.blockReason && (
                <div className="save-attempt-block-reason">
                  <span className="save-attempt-block-label">Block Reason</span>
                  <p className="save-attempt-block-text">{job.saveAttempt.blockReason}</p>
                </div>
              )}

              {/* Save outcome / evidence */}
              {job.saveAttempt.evidence && (
                <div className="save-attempt-evidence">
                  <span className="save-attempt-evidence-label">Save Outcome</span>
                  <span className={`save-attempt-outcome save-attempt-outcome-${job.saveAttempt.evidence.outcome}`}>
                    {job.saveAttempt.evidence.outcome.replace(/_/g, " ")}
                  </span>
                  {job.saveAttempt.evidence.observedPortalMessage && (
                    <div className="save-attempt-portal-message">
                      <span className="save-attempt-message-label">Observed Portal Message</span>
                      <p className="save-attempt-message-text">{job.saveAttempt.evidence.observedPortalMessage}</p>
                    </div>
                  )}
                  {job.saveAttempt.evidence.screenshotFileName && (
                    <p className="save-attempt-artifact-ref">
                      Post-Save Artifacts: {job.saveAttempt.evidence.screenshotFileName}
                      {job.saveAttempt.artifactDir && (
                        <span className="save-attempt-artifact-dir"> ({job.saveAttempt.artifactDir})</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Notes */}
              {job.saveAttempt.notes.length > 0 && (
                <details className="save-attempt-notes-details">
                  <summary className="save-attempt-notes-summary">Attempt Notes ({job.saveAttempt.notes.length})</summary>
                  <ul className="save-attempt-notes-list">
                    {job.saveAttempt.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="save-attempt-disclaimer">
                This attempt stops immediately after the save outcome is observed.
              </p>
            </>
          ) : (
            <p className="save-attempt-empty">No save attempt has been performed yet.</p>
          )}

          <div style={{ marginTop: 10 }}>
            {saveAttemptError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {saveAttemptError}
              </p>
            )}
            {/* Only allow save attempt when authorization is active */}
            {job.saveAuthorization.status === "active" && (
              <button
                className="btn btn-secondary"
                onClick={handleRunSaveAttempt}
                disabled={runningSaveAttempt}
                style={{ background: "#fff3e0", borderColor: "#ff9800", color: "#e65100" }}
              >
                {runningSaveAttempt
                  ? "Running Save Attempt…"
                  : job.saveAttempt
                    ? "Re-run Save Attempt (Local/Dev)"
                    : "Run Maklumat Am Save Attempt (Local/Dev)"}
              </button>
            )}
            {job.saveAuthorization.status !== "active" && (
              <p className="save-attempt-auth-note">
                Active save authorization is required to run this attempt.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Maklumat Am Save Authorization ──────────────────────────── */}
      {job.savePreflight && job.portalDraft && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="save-auth-section">
          <h2 className="save-auth-heading">Maklumat Am Save Authorization</h2>
          <p className="save-auth-intro">
            WeStamp can record an explicit local/dev authorization for a future Maklumat Am save attempt.
          </p>

          {job.saveAuthorization ? (
            <>
              <div className={`save-auth-status ${
                job.saveAuthorization.status === "active"
                  ? "save-auth-status-active"
                  : job.saveAuthorization.status === "available"
                    ? "save-auth-status-available"
                    : job.saveAuthorization.status === "stale"
                      ? "save-auth-status-stale"
                      : job.saveAuthorization.status === "revoked"
                        ? "save-auth-status-revoked"
                        : "save-auth-status-notavailable"
              }`}>
                <span className="save-auth-status-label">Authorization Status</span>
                <span className="save-auth-status-value">
                  {job.saveAuthorization.status === "active"
                    ? "Authorization Active"
                    : job.saveAuthorization.status === "available"
                      ? "Authorization Available for Local Confirmation"
                      : job.saveAuthorization.status === "stale"
                        ? "Authorization Stale"
                        : job.saveAuthorization.status === "revoked"
                          ? "Authorization Revoked"
                          : "Authorization Not Available"}
                </span>
              </div>

              <p className="save-auth-explanation">{job.saveAuthorization.explanation}</p>

              {/* Stale reasons */}
              {job.saveAuthorization.staleReasons.length > 0 && job.saveAuthorization.status === "stale" && (
                <div className="save-auth-stale-reasons">
                  <span className="save-auth-stale-label">Stale Reason</span>
                  <ul className="save-auth-stale-list">
                    {job.saveAuthorization.staleReasons.map((r, i) => (
                      <li key={i}>{r.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* State ref / issued against */}
              {job.saveAuthorization.stateRef && job.saveAuthorization.status === "active" && (
                <div className="save-auth-state-ref">
                  <span className="save-auth-state-ref-label">Issued Against</span>
                  <span className="save-auth-state-ref-item">Preflight: {new Date(job.saveAuthorization.stateRef.preflightEvaluatedAt).toLocaleString()}</span>
                  <span className="save-auth-state-ref-item">Draft: {new Date(job.saveAuthorization.stateRef.portalDraftedAt).toLocaleString()}</span>
                  {job.saveAuthorization.stateRef.probeProbedAt && (
                    <span className="save-auth-state-ref-item">Probe: {new Date(job.saveAuthorization.stateRef.probeProbedAt).toLocaleString()}</span>
                  )}
                  <span className="save-auth-state-ref-item">Lane: {job.saveAuthorization.stateRef.lane}</span>
                </div>
              )}

              {/* Expiry */}
              {job.saveAuthorization.expiry && job.saveAuthorization.status === "active" && (
                <p className="save-auth-expiry">
                  Expires: {new Date(job.saveAuthorization.expiry.expiresAt).toLocaleString()} ({job.saveAuthorization.expiry.windowMinutes} min window)
                </p>
              )}

              <p className="save-auth-disclaimer">
                No save has been attempted on e-Duti Setem.
              </p>
            </>
          ) : (
            <p className="save-auth-empty">Save authorization has not been evaluated yet.</p>
          )}

          <div className="save-auth-actions" style={{ marginTop: 10 }}>
            {authError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {authError}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Issue button — only when preflight eligible and no active auth */}
              {(job.savePreflight.status === "eligible" || job.savePreflight.status === "review_required") &&
                (!job.saveAuthorization || job.saveAuthorization.status !== "active") && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleSaveAuthAction("issue")}
                  disabled={runningAuth}
                >
                  {runningAuth ? "Issuing…" : "Issue Save Authorization (Local/Dev)"}
                </button>
              )}
              {/* Revoke button — only when active */}
              {job.saveAuthorization?.status === "active" && (
                <button
                  className="btn btn-secondary"
                  onClick={() => handleSaveAuthAction("revoke")}
                  disabled={runningAuth}
                  style={{ background: "#fff3e0", borderColor: "#ffcc80" }}
                >
                  {runningAuth ? "Revoking…" : "Revoke Authorization"}
                </button>
              )}
              {/* Re-evaluate button — always available */}
              <button
                className="btn btn-secondary"
                onClick={() => handleSaveAuthAction("evaluate")}
                disabled={runningAuth}
                style={{ background: "#f5f5f5" }}
              >
                {runningAuth ? "Evaluating…" : "Re-evaluate Authorization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Maklumat Am Save Preflight ──────────────────────────────── */}
      {job.portalDraft && job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="save-preflight-section">
          <h2 className="save-preflight-heading">Maklumat Am Save Preflight</h2>
          <p className="save-preflight-intro">
            WeStamp has evaluated whether the current Maklumat Am state is internally eligible for a future save attempt.
          </p>

          {job.savePreflight ? (
            <>
              <div className={`save-preflight-status ${
                job.savePreflight.status === "eligible"
                  ? "save-preflight-status-eligible"
                  : job.savePreflight.status === "review_required"
                    ? "save-preflight-status-review"
                    : job.savePreflight.status === "blocking_issues"
                      ? "save-preflight-status-blocking"
                      : "save-preflight-status-notready"
              }`}>
                <span className="save-preflight-status-label">Preflight Status</span>
                <span className="save-preflight-status-value">
                  {job.savePreflight.status === "eligible"
                    ? "Internally Eligible for Later Save Attempt"
                    : job.savePreflight.status === "review_required"
                      ? "Review Required Before Save"
                      : job.savePreflight.status === "blocking_issues"
                        ? "Blocking Issues Found"
                        : "Save Preflight Not Ready"}
                </span>
                <span className="save-preflight-count-badge">
                  {job.savePreflight.summary.passedCount}/{job.savePreflight.summary.totalChecks} checks passed
                </span>
              </div>

              {/* Mutation Guard */}
              <div className={`save-preflight-guard save-preflight-guard-${job.savePreflight.mutationGuard.decision}`}>
                <span className="save-preflight-guard-label">Mutation Guard</span>
                <span className="save-preflight-guard-decision">
                  {job.savePreflight.mutationGuard.decision === "refused"
                    ? "Refused"
                    : job.savePreflight.mutationGuard.decision === "review_gated"
                      ? "Review Required"
                      : "Permitted (internal only)"}
                </span>
                <span className="save-preflight-guard-explanation">
                  {job.savePreflight.mutationGuard.explanation}
                </span>
              </div>

              {/* Blocking reasons */}
              {job.savePreflight.blockingReasons.length > 0 && (
                <div className="save-preflight-reasons">
                  <span className="save-preflight-reasons-label save-preflight-reasons-blocking">Blocking Reasons</span>
                  <ul className="save-preflight-reasons-list">
                    {job.savePreflight.blockingReasons.map((r, i) => (
                      <li key={i} className="save-preflight-reason-item save-preflight-reason-blocking">{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory reasons */}
              {job.savePreflight.advisoryReasons.length > 0 && (
                <div className="save-preflight-reasons">
                  <span className="save-preflight-reasons-label save-preflight-reasons-advisory">Advisory Reasons</span>
                  <ul className="save-preflight-reasons-list">
                    {job.savePreflight.advisoryReasons.map((r, i) => (
                      <li key={i} className="save-preflight-reason-item save-preflight-reason-advisory">{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preflight Checks */}
              {job.savePreflight.checks.length > 0 && (
                <details className="save-preflight-checks-details">
                  <summary className="save-preflight-checks-summary">
                    Preflight Checks ({job.savePreflight.summary.passedCount} passed, {job.savePreflight.summary.blockingFailures} blocking, {job.savePreflight.summary.advisoryFailures} advisory)
                  </summary>
                  <ul className="save-preflight-checks-list">
                    {job.savePreflight.checks.map((c) => (
                      <li key={c.checkId} className={`save-preflight-check-item ${c.passed ? "save-preflight-check-passed" : `save-preflight-check-failed save-preflight-check-${c.severity}`}`}>
                        <span className="save-preflight-check-indicator">{c.passed ? "✓" : "✗"}</span>
                        <span className="save-preflight-check-desc">{c.description}</span>
                        <span className={`save-preflight-check-severity save-preflight-severity-${c.severity}`}>{c.severity}</span>
                        {!c.passed && c.reason && (
                          <span className="save-preflight-check-reason">{c.reason}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {/* Last probe reference */}
              {job.savePreflight.lastProbeReference && (
                <p className="save-preflight-probe-ref">
                  Last Probe Reference: {new Date(job.savePreflight.lastProbeReference).toLocaleString()}
                </p>
              )}

              <p className="save-preflight-disclaimer">
                No save has been attempted on e-Duti Setem.
              </p>
            </>
          ) : (
            <p className="save-preflight-empty">Save preflight has not been evaluated yet.</p>
          )}

          <div style={{ marginTop: 10 }}>
            {preflightError && (
              <p className="field-error" style={{ marginBottom: 8 }}>
                {preflightError}
              </p>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleRunSavePreflight}
              disabled={runningPreflight}
            >
              {runningPreflight
                ? "Evaluating…"
                : job.savePreflight
                  ? "Re-evaluate Save Preflight"
                  : "Evaluate Save Preflight"}
            </button>
          </div>
        </div>
      )}

      </details>
      {/* ── /Advanced / Diagnostics — engineering panel cluster 1 ─── */}

      {/* ── Payment & Certificate Lifecycle ─────────────────────────────
          Shown for any operator-worked job regardless of lane: tenancy
          jobs (which acquire `routingSuggestion` via the Portal Routing
          flow) AND nominal-duty registry jobs (which never acquire a
          routing suggestion because the Portal Routing panel is hidden
          for them, but are still taken through e-Duti Setem manually by
          the operator). Without this, SOP §8 "what done looks like"
          cannot be executed in the UI for nominal-duty lanes — the
          operator has no way to record adjudication, mark payment
          done, upload the certificate, or mark delivered, and the
          public receipt stays on "Received" forever. Hidden for manual
          review / failed jobs as before. */}
      {(job.routingSuggestion || isNominalDuty) && !isManualReview && !isFailed && (
        <div id="fulfilment-lifecycle" className="fulfilment-section">
          <h2>Payment &amp; Certificate Lifecycle</h2>
          <p style={{ fontSize: 13, color: "#78716c" }}>
            This is WeStamp&apos;s internal operational tracking for payment
            and certificate collection.
          </p>

          {(() => {
            const integrity = evaluateFulfilmentIntegrity(
              job.fulfilmentState
                ? {
                    paymentStatus: job.fulfilmentState.paymentStatus,
                    certificateStatus: job.fulfilmentState.certificateStatus,
                    adjudicationNumber: job.fulfilmentState.adjudicationNumber,
                    certificateStoragePath: job.fulfilmentState.certificateStoragePath,
                  }
                : null
            );
            if (!integrity.hasAnomalies) return null;
            return (
              <div id="fulfilment-integrity" className="fulfilment-integrity-warn" style={{ margin: "10px 0", padding: "8px 12px", background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 6, fontSize: 12 }}>
                <strong style={{ color: "#92400e" }}>Fulfilment Integrity Warning</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0, color: "#92400e" }}>
                  {integrity.anomalies.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <div className="intake-details-card" style={{ marginTop: 12 }}>
            {/* Adjudication Number */}
            <div className="intake-details-row">
              <span className="intake-details-label">Adjudication Number</span>
              <span className="intake-details-value">
                {job.fulfilmentState?.adjudicationNumber ?? (
                  <span style={{ color: "#78716c" }}>Not recorded</span>
                )}
              </span>
            </div>

            {/* Payment Status */}
            <div className="intake-details-row">
              <span className="intake-details-label">Payment Status</span>
              <span className="intake-details-value">
                {job.fulfilmentState?.paymentStatus === "payment_marked_done" ? (
                  <span style={{ color: "#16a34a" }}>
                    Payment Marked Done
                    {job.fulfilmentState.paymentMethod && ` (${job.fulfilmentState.paymentMethod})`}
                  </span>
                ) : job.fulfilmentState?.paymentStatus === "awaiting_payment" ? (
                  <span style={{ color: "#d97706" }}>Awaiting Payment</span>
                ) : (
                  <span style={{ color: "#78716c" }}>Not Ready</span>
                )}
              </span>
            </div>

            {/* Payment Reference */}
            {job.fulfilmentState?.paymentReference && (
              <div className="intake-details-row">
                <span className="intake-details-label">Payment Reference</span>
                <span className="intake-details-value" style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {job.fulfilmentState.paymentReference}
                </span>
              </div>
            )}

            {/* Certificate Status */}
            <div className="intake-details-row">
              <span className="intake-details-label">Certificate Status</span>
              <span className="intake-details-value">
                {job.fulfilmentState?.certificateStatus === "certificate_retrieved" ? (
                  <span style={{ color: "#16a34a" }}>
                    Certificate Retrieved
                    {job.fulfilmentState.certificateFileName && ` (${job.fulfilmentState.certificateFileName})`}
                  </span>
                ) : job.fulfilmentState?.certificateStatus === "waiting_for_certificate" ? (
                  <span style={{ color: "#d97706" }}>Waiting for Certificate</span>
                ) : (
                  <span style={{ color: "#78716c" }}>Not Ready</span>
                )}
              </span>
            </div>

            {/* Delivered */}
            {job.fulfilmentState?.delivered && (
              <div className="intake-details-row">
                <span className="intake-details-label">Delivered</span>
                <span className="intake-details-value">
                  <span style={{ color: "#16a34a", fontWeight: 600 }}>
                    Yes
                    {job.fulfilmentState.deliveredAt && (
                      <span style={{ fontWeight: 400 }}>
                        {" — "}{new Date(job.fulfilmentState.deliveredAt).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {/* Record adjudication + mark awaiting */}
            {!job.fulfilmentState?.adjudicationNumber && (
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  value={adjNumInput}
                  onChange={(e) => setAdjNumInput(e.target.value)}
                  placeholder="Adjudication number"
                  disabled={fulfilmentLoading}
                  style={{ width: 200, marginRight: 8 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={fulfilmentLoading || !adjNumInput.trim()}
                  onClick={() => handleFulfilmentAction({
                    action: "record_adjudication",
                    adjudicationNumber: adjNumInput.trim(),
                  })}
                >
                  Record &amp; Mark Awaiting Payment
                </button>
              </div>
            )}

            {/* Mark payment done */}
            {job.fulfilmentState?.paymentStatus === "awaiting_payment" && (
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  value={payMethodInput}
                  onChange={(e) => setPayMethodInput(e.target.value)}
                  placeholder="Payment method (e.g. FPX)"
                  disabled={fulfilmentLoading}
                  style={{ width: 160, marginRight: 8 }}
                />
                <input
                  type="text"
                  value={payRefInput}
                  onChange={(e) => setPayRefInput(e.target.value)}
                  placeholder="Payment reference (optional)"
                  disabled={fulfilmentLoading}
                  style={{ width: 200, marginRight: 8 }}
                />
                <input
                  type="text"
                  value={payNoteInput}
                  onChange={(e) => setPayNoteInput(e.target.value)}
                  placeholder="Note (optional)"
                  disabled={fulfilmentLoading}
                  style={{ width: 160, marginRight: 8 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={fulfilmentLoading}
                  onClick={() => handleFulfilmentAction({
                    action: "mark_payment_done",
                    paymentMethod: payMethodInput.trim(),
                    paymentNote: payNoteInput.trim(),
                    paymentReference: payRefInput.trim(),
                  })}
                >
                  Mark Payment Done
                </button>
                <p style={{ fontSize: 11, color: "#999", margin: "4px 0 0" }}>
                  Optional internal record of the bank / FPX / batch payment reference.
                </p>
              </div>
            )}

            {/* Certificate file upload / display */}
            {job.fulfilmentState?.certificateStatus === "waiting_for_certificate" && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#555", margin: "8px 0 4px" }}>
                  Certificate File
                </p>
                <input
                  ref={certUploadRef}
                  type="file"
                  accept="application/pdf"
                  disabled={certUploading}
                  style={{ fontSize: 12, marginRight: 8 }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCertificateUpload(f);
                  }}
                />
                <span style={{ fontSize: 12, color: "#666" }}>
                  {certUploading ? "Uploading…" : "Upload certificate PDF"}
                </span>
                {certUploadError && (
                  <p className="field-error" style={{ fontSize: 12 }}>{certUploadError}</p>
                )}
              </div>
            )}

            {job.fulfilmentState?.certificateStatus === "certificate_retrieved" && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#555", margin: "8px 0 4px" }}>
                  Certificate File
                </p>
                {job.fulfilmentState?.certificateStoragePath ? (
                  <>
                    <span style={{ fontSize: 13 }}>
                      {job.fulfilmentState.certificateFileName ?? "certificate.pdf"}
                    </span>
                    {" "}
                    <a
                      href={`/api/intake/${job.id}/certificate-download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#0066cc" }}
                    >
                      View PDF
                    </a>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
                    No certificate file attached.
                  </span>
                )}
                <div style={{ marginTop: 6 }}>
                  <input
                    ref={certUploadRef}
                    type="file"
                    accept="application/pdf"
                    disabled={certUploading}
                    style={{ fontSize: 12, marginRight: 8 }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCertificateUpload(f);
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#999" }}>
                    {certUploading
                      ? "Uploading…"
                      : job.fulfilmentState?.certificateStoragePath
                        ? "Uploading a new certificate PDF will replace the current file."
                        : "Upload certificate PDF"}
                  </span>
                  {certUploadError && (
                    <p className="field-error" style={{ fontSize: 12 }}>{certUploadError}</p>
                  )}
                </div>
              </div>
            )}

            {/* Mark delivered */}
            {job.fulfilmentState?.certificateStatus === "certificate_retrieved" &&
              job.fulfilmentState?.certificateStoragePath &&
              !job.fulfilmentState?.delivered && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={fulfilmentLoading}
                  onClick={() => handleFulfilmentAction({ action: "mark_delivered" })}
                >
                  Mark Delivered
                </button>
                <span style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>
                  Internal operational mark only. Does not send or notify.
                </span>
              </div>
            )}
          </div>

          {fulfilmentError && (
            <p className="field-error" style={{ fontSize: 12 }}>{fulfilmentError}</p>
          )}

          <p className="portal-draft-disclaimer">
            Payment and certificate retrieval have not been automated in WeStamp.
          </p>
        </div>
      )}

      {/* ── Internal Event History ──────────────────────────────────── */}
      <div style={{ marginTop: 28 }}>
        <h2>Internal Event History</h2>
        <p style={{ fontSize: 13, color: "#78716c", marginBottom: 12 }}>
          For internal operational tracking only.
        </p>
        {job.events && job.events.length > 0 ? (
          <div className="intake-details-card" style={{ padding: "8px 16px" }}>
            {[...job.events].reverse().slice(0, 20).map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: i < Math.min(job.events!.length, 20) - 1 ? "1px solid #eee" : "none", fontSize: 13 }}>
                <span style={{ minWidth: 140, color: "#666", fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap", paddingTop: 1 }}>
                  {new Date(ev.timestamp).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span style={{ color: "#333" }}>
                  {formatEventLabel(ev.type)}
                  {ev.note && (
                    <span style={{ color: "#888", fontSize: 12 }}>{" — "}{ev.note}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
            No internal events recorded yet.
          </p>
        )}
      </div>

      {/* ── Advanced / Diagnostics — engineering panel cluster 2 ────
          Wraps the portal-evidence cluster (probe, assertions, dry
          run) in a single collapsed-by-default disclosure. Same
          rationale as cluster 1: the panels are kept intact and
          fully accessible — only the visual hierarchy changes. */}
      <details className="advanced-diagnostics">
        <summary className="advanced-diagnostics-summary">
          <span className="advanced-diagnostics-title">
            Advanced / Diagnostics — Portal probe, assertions, and dry run
          </span>
          <span className="advanced-diagnostics-hint">
            Click to expand. Internal portal-state evidence used to
            verify expectations against e-Duti Setem snapshots. Not
            required for routine handling.
          </span>
        </summary>

      {/* ── STSDS Portal Probe ──────────────────────────────────────── */}
      {job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="portal-probe-section">
          <h2 className="portal-probe-heading">STSDS Portal Probe</h2>

          {job.portalProbe ? (
            <>
              <p className="portal-probe-intro">
                WeStamp has run a local authenticated Maklumat Am probe against
                e-Duti Setem for this job.
              </p>

              {/* Status */}
              <div className={`portal-probe-status ${
                job.portalProbe.status === "completed"
                  ? "portal-probe-status-completed"
                  : job.portalProbe.status === "blocked"
                    ? "portal-probe-status-blocked"
                    : job.portalProbe.status === "failed"
                      ? "portal-probe-status-failed"
                      : "portal-probe-status-notready"
              }`}>
                <span className="portal-probe-status-label">Probe Status</span>
                <span className="portal-probe-status-value">
                  {job.portalProbe.status === "completed"
                    ? "Probe Completed"
                    : job.portalProbe.status === "blocked"
                      ? "Probe Blocked"
                      : job.portalProbe.status === "failed"
                        ? "Probe Failed"
                        : "Probe Not Ready"}
                </span>
                <span className="portal-probe-count-badge">
                  {job.portalProbe.executedCount} executed, {job.portalProbe.refusedCount} refused, {job.portalProbe.failedCount} failed
                </span>
              </div>

              {/* Notes */}
              {job.portalProbe.notes.length > 0 && (
                <div className="portal-probe-notes">
                  <span className="portal-probe-notes-label">Probe Notes</span>
                  <ul className="portal-probe-notes-list">
                    {job.portalProbe.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Observed snapshot summary */}
              {job.portalProbe.observedSnapshot && (
                <div className="portal-probe-snapshot">
                  <h3 className="portal-probe-snapshot-heading">Observed Portal Values</h3>
                  <div className="portal-probe-snapshot-source">
                    Source: {job.portalProbe.observedSnapshot.source === "browser_captured"
                      ? "Live portal capture"
                      : "Mock from draft"}
                  </div>
                  {job.portalProbe.observedSnapshot.allFields.length > 0 ? (
                    <ul className="portal-probe-snapshot-list">
                      {job.portalProbe.observedSnapshot.allFields.map((f, i) => (
                        <li key={i} className="portal-probe-snapshot-field">
                          <span className="portal-probe-snapshot-key">{f.fieldKey.replace(/_/g, " ")}</span>
                          <span className="portal-probe-snapshot-val">
                            {f.observedValue != null ? String(f.observedValue) : "—"}
                          </span>
                          {(f.selectorMethod || f.readbackConfidence || f.readbackNote) && (
                            <span className="portal-probe-snapshot-diag">
                              {f.selectorMethod && <span className="portal-probe-diag-tag">sel: {f.selectorMethod}</span>}
                              {f.readbackConfidence && <span className={`portal-probe-diag-tag portal-probe-confidence-${f.readbackConfidence}`}>conf: {f.readbackConfidence}</span>}
                              {f.readbackNote && <span className="portal-probe-diag-note">{f.readbackNote}</span>}
                            </span>
                          )}
                          {f.rawObservedValue != null && f.rawObservedValue !== String(f.observedValue) && (
                            <span className="portal-probe-snapshot-raw">raw: {f.rawObservedValue}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="portal-probe-snapshot-empty">No field values captured.</p>
                  )}
                </div>
              )}

              {/* Step results — first 8 */}
              {job.portalProbe.stepResults.length > 0 && (
                <div className="portal-probe-steps">
                  <h3 className="portal-probe-steps-heading">Step Results</h3>
                  <ol className="portal-probe-steps-list">
                    {job.portalProbe.stepResults.slice(0, 8).map((r) => (
                      <li
                        key={r.seq}
                        className={`portal-probe-step-item portal-probe-step-${r.status}`}
                      >
                        <div className="portal-probe-step-row">
                          <span className="portal-probe-step-badge">{r.status}</span>
                          <span className="portal-probe-step-type">{r.type.replace(/_/g, " ")}</span>
                          <span className="portal-probe-step-desc">{r.description}</span>
                        </div>
                        {r.note && (
                          <div className="portal-probe-step-note">{r.note}</div>
                        )}
                        {(r.selectorMethod || r.readbackConfidence) && (
                          <div className="portal-probe-step-diag">
                            {r.selectorMethod && <span className="portal-probe-diag-tag">sel: {r.selectorMethod}</span>}
                            {r.readbackConfidence && <span className={`portal-probe-diag-tag portal-probe-confidence-${r.readbackConfidence}`}>conf: {r.readbackConfidence}</span>}
                            {r.readbackNote && <span className="portal-probe-diag-note">{r.readbackNote}</span>}
                          </div>
                        )}
                      </li>
                    ))}
                    {job.portalProbe.stepResults.length > 8 && (
                      <li className="portal-probe-steps-more">
                        + {job.portalProbe.stepResults.length - 8} more steps
                      </li>
                    )}
                  </ol>
                </div>
              )}

              {/* Probe Artifacts */}
              {job.portalProbe.artifactCollection && job.portalProbe.artifactCollection.artifacts.length > 0 && (
                <div className="portal-probe-artifacts">
                  <h3 className="portal-probe-artifacts-heading">Probe Artifacts</h3>
                  <div className="portal-probe-artifacts-summary">
                    <span className="portal-probe-diag-tag">{job.portalProbe.artifactCollection.screenshotCount} screenshot{job.portalProbe.artifactCollection.screenshotCount !== 1 ? "s" : ""}</span>
                    <span className="portal-probe-diag-tag">{job.portalProbe.artifactCollection.fieldEvidenceCount} field evidence</span>
                    <span className="portal-probe-artifacts-dir">dir: {job.portalProbe.artifactCollection.artifactDir}</span>
                  </div>
                  <ul className="portal-probe-artifacts-list">
                    {job.portalProbe.artifactCollection.artifacts
                      .filter((a) => a.type === "screenshot")
                      .map((a, i) => (
                        <li key={`ss-${i}`} className="portal-probe-artifact-item portal-probe-artifact-screenshot">
                          <span className="portal-probe-artifact-badge">screenshot</span>
                          <span className="portal-probe-artifact-checkpoint">{a.checkpoint.replace(/_/g, " ")}</span>
                          {a.fileName && <span className="portal-probe-artifact-file">{a.fileName}</span>}
                        </li>
                      ))}
                    {job.portalProbe.artifactCollection.artifacts
                      .filter((a) => a.type === "field_evidence" && a.fieldEvidence)
                      .slice(0, 10)
                      .map((a, i) => (
                        <li key={`fe-${i}`} className="portal-probe-artifact-item portal-probe-artifact-field">
                          <span className="portal-probe-artifact-badge">field</span>
                          <span className="portal-probe-artifact-checkpoint">{a.fieldEvidence!.portalLabel ?? a.fieldEvidence!.fieldKey.replace(/_/g, " ")}</span>
                          <span className="portal-probe-snapshot-val">
                            {a.fieldEvidence!.normalizedValue != null ? String(a.fieldEvidence!.normalizedValue) : "—"}
                          </span>
                          {a.fieldEvidence!.selectorMethod && (
                            <span className="portal-probe-diag-tag">sel: {a.fieldEvidence!.selectorMethod}</span>
                          )}
                          {a.fieldEvidence!.readbackConfidence && (
                            <span className={`portal-probe-diag-tag portal-probe-confidence-${a.fieldEvidence!.readbackConfidence}`}>
                              conf: {a.fieldEvidence!.readbackConfidence}
                            </span>
                          )}
                        </li>
                      ))}
                    {job.portalProbe.artifactCollection.artifacts.filter((a) => a.type === "field_evidence").length > 10 && (
                      <li className="portal-probe-steps-more">
                        + {job.portalProbe.artifactCollection.artifacts.filter((a) => a.type === "field_evidence").length - 10} more field evidence entries
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <p className="portal-probe-disclaimer">
                This probe stops before save or submission.
              </p>
              <p className="portal-probe-env-note">
                Local/dev only — requires ENABLE_STSDS_PORTAL_PROBE=true
              </p>

              <div style={{ marginTop: 10 }}>
                {probeError && (
                  <p className="field-error" style={{ marginBottom: 8 }}>
                    {probeError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleRunPortalProbe}
                  disabled={runningProbe}
                >
                  {runningProbe ? "Re-running Probe\u2026" : "Re-run Portal Probe"}
                </button>
              </div>
            </>
          ) : (
            <div>
              <p className="portal-probe-intro">
                WeStamp can run a local authenticated Maklumat Am probe against
                e-Duti Setem for this job.
              </p>
              <p className="portal-probe-secondary">
                This probe stops before save or submission.
              </p>
              <p className="portal-probe-env-note">
                Local/dev only — requires ENABLE_STSDS_PORTAL_PROBE=true
              </p>
              {probeError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {probeError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRunPortalProbe}
                disabled={runningProbe || !job.browserInstructions || !job.portalDraft}
              >
                {runningProbe ? "Running Probe\u2026" : "Run Portal Probe"}
              </button>
              {(!job.browserInstructions || !job.portalDraft) && (
                <p className="portal-probe-prereq-note">
                  Browser instructions and portal draft must be available first.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STSDS Portal Assertions ────────────────────────────────── */}
      {job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="assertions-section">
          <h2 className="assertions-heading">STSDS Portal Assertions</h2>

          {job.assertionEvaluation ? (
            <>
              <p className="assertions-intro">
                WeStamp has evaluated the current expected portal state against
                an internal snapshot for this job.
              </p>

              {/* Status */}
              <div className={`assertions-status ${
                job.assertionEvaluation.status === "ready_for_internal_review"
                  ? "assertions-status-ready"
                  : job.assertionEvaluation.status === "blocking_mismatches"
                    ? "assertions-status-blocking"
                    : job.assertionEvaluation.status === "advisory_mismatches"
                      ? "assertions-status-advisory"
                      : "assertions-status-notready"
              }`}>
                <span className="assertions-status-label">Assertion Summary</span>
                <span className="assertions-status-value">
                  {job.assertionEvaluation.status === "ready_for_internal_review"
                    ? "Assertions Ready for Internal Review"
                    : job.assertionEvaluation.status === "blocking_mismatches"
                      ? "Blocking Mismatches Found"
                      : job.assertionEvaluation.status === "advisory_mismatches"
                        ? "Advisory Mismatches Found"
                        : "Assertions Not Ready"}
                </span>
                <span className="assertions-count-badge">
                  {job.assertionEvaluation.summary.matchCount}/{job.assertionEvaluation.summary.totalAssertions} matched
                </span>
              </div>

              {/* Blocking mismatches */}
              {job.assertionEvaluation.blockingMismatches.length > 0 && (
                <div className="assertions-reasons assertions-reasons-blocking">
                  <span className="assertions-reasons-label">Blocking Mismatches</span>
                  <ul className="assertions-reasons-list">
                    {job.assertionEvaluation.blockingMismatches.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory mismatches */}
              {job.assertionEvaluation.advisoryMismatches.length > 0 && (
                <div className="assertions-reasons assertions-reasons-advisory">
                  <span className="assertions-reasons-label">Advisory Mismatches</span>
                  <ul className="assertions-reasons-list">
                    {job.assertionEvaluation.advisoryMismatches.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Assertion results — matched fields + mismatches */}
              {job.assertionEvaluation.results.length > 0 && (
                <div className="assertions-list-section">
                  {/* Matched fields */}
                  {job.assertionEvaluation.results.filter((r) => r.outcome === "match").length > 0 && (
                    <>
                      <h3 className="assertions-list-heading">Matched Fields</h3>
                      <ul className="assertions-list">
                        {job.assertionEvaluation.results
                          .filter((r) => r.outcome === "match")
                          .map((r, i) => (
                            <li key={i} className="assertions-item assertions-item-match">
                              <div className="assertions-item-row">
                                <span className="assertions-item-badge assertions-badge-match">match</span>
                                <span className="assertions-item-desc">{r.description}</span>
                              </div>
                              <div className="assertions-item-values">
                                <span className="assertions-item-val-label">Expected Value</span>
                                <span className="assertions-item-val">{r.expectedValue != null ? String(r.expectedValue) : "—"}</span>
                                <span className="assertions-item-val-label">Observed Value</span>
                                <span className="assertions-item-val">{r.observedValue != null ? String(r.observedValue) : "—"}</span>
                              </div>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}

                  {/* Mismatch fields */}
                  {job.assertionEvaluation.results.filter((r) => r.outcome === "mismatch").length > 0 && (
                    <>
                      <h3 className="assertions-list-heading" style={{ marginTop: 12 }}>Mismatched Fields</h3>
                      <ul className="assertions-list">
                        {job.assertionEvaluation.results
                          .filter((r) => r.outcome === "mismatch")
                          .map((r, i) => (
                            <li key={i} className={`assertions-item ${
                              r.severity === "blocking" ? "assertions-item-blocking" : "assertions-item-advisory"
                            }`}>
                              <div className="assertions-item-row">
                                <span className={`assertions-item-badge ${
                                  r.severity === "blocking" ? "assertions-badge-blocking" : "assertions-badge-advisory"
                                }`}>{r.severity}</span>
                                <span className="assertions-item-desc">{r.description}</span>
                              </div>
                              <div className="assertions-item-values">
                                <span className="assertions-item-val-label">Expected Value</span>
                                <span className="assertions-item-val">{r.expectedValue != null ? String(r.expectedValue) : "—"}</span>
                                <span className="assertions-item-val-label">Observed Value</span>
                                <span className="assertions-item-val">{r.observedValue != null ? String(r.observedValue) : "—"}</span>
                              </div>
                              {r.note && (
                                <div className="assertions-item-note">{r.note}</div>
                              )}
                            </li>
                          ))}
                      </ul>
                    </>
                  )}

                  {/* Skipped fields */}
                  {job.assertionEvaluation.results.filter((r) => r.outcome === "skipped").length > 0 && (
                    <>
                      <h3 className="assertions-list-heading" style={{ marginTop: 12 }}>Skipped Assertions</h3>
                      <ul className="assertions-list">
                        {job.assertionEvaluation.results
                          .filter((r) => r.outcome === "skipped")
                          .map((r, i) => (
                            <li key={i} className="assertions-item assertions-item-skipped">
                              <div className="assertions-item-row">
                                <span className="assertions-item-badge assertions-badge-skipped">skipped</span>
                                <span className="assertions-item-desc">{r.description}</span>
                              </div>
                              {r.note && (
                                <div className="assertions-item-note-skipped">{r.note}</div>
                              )}
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              <p className="assertions-disclaimer">
                This assertion check has not been run against the live e-Duti Setem portal.
              </p>

              <div style={{ marginTop: 10 }}>
                {assertionsError && (
                  <p className="field-error" style={{ marginBottom: 8 }}>
                    {assertionsError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleEvaluateAssertions}
                  disabled={evaluatingAssertions}
                >
                  {evaluatingAssertions ? "Re-evaluating\u2026" : "Re-evaluate Assertions"}
                </button>
              </div>
            </>
          ) : (
            <div>
              <p className="assertions-intro">
                Evaluate expected portal state against an internal snapshot
                built from the current portal draft.
              </p>
              {assertionsError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {assertionsError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleEvaluateAssertions}
                disabled={evaluatingAssertions || !job.portalDraft}
              >
                {evaluatingAssertions ? "Evaluating\u2026" : "Evaluate Assertions"}
              </button>
              {!job.portalDraft && (
                <p className="assertions-prereq-note">
                  A portal draft must be created first.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STSDS Dry Run ─────────────────────────────────────────── */}
      {job.routingSuggestion && !isManualReview && !isFailed && (
        <div className="dry-run-section">
          <h2 className="dry-run-heading">STSDS Dry Run</h2>

          {job.dryRun ? (
            <>
              <p className="dry-run-intro">
                WeStamp has evaluated the current internal portal execution
                path for this job.
              </p>

              {/* Status indicator */}
              <div className={`dry-run-status ${
                job.dryRun.status === "ready_for_internal_review"
                  ? "dry-run-status-ready"
                  : job.dryRun.status === "review_required"
                    ? "dry-run-status-review"
                    : job.dryRun.status === "blocked"
                      ? "dry-run-status-blocked"
                      : "dry-run-status-notready"
              }`}>
                <span className="dry-run-status-label">Dry Run Status</span>
                <span className="dry-run-status-value">
                  {job.dryRun.status === "ready_for_internal_review"
                    ? "Dry Run Ready for Internal Review"
                    : job.dryRun.status === "review_required"
                      ? "Review Required"
                      : job.dryRun.status === "blocked"
                        ? "Blocked"
                        : "Dry Run Not Ready"}
                </span>
              </div>

              {/* Step summary counts */}
              <div className="dry-run-summary">
                <div className="dry-run-summary-row">
                  <span className="dry-run-summary-label">Step Results</span>
                  <span className="dry-run-summary-counts">
                    <span className="dry-run-count dry-run-count-ready">
                      {job.dryRun.summary.readySteps} ready
                    </span>
                    {job.dryRun.summary.blockedSteps > 0 && (
                      <span className="dry-run-count dry-run-count-blocked">
                        {job.dryRun.summary.blockedSteps} blocked
                      </span>
                    )}
                    {job.dryRun.summary.skippedSteps > 0 && (
                      <span className="dry-run-count dry-run-count-skipped">
                        {job.dryRun.summary.skippedSteps} skipped
                      </span>
                    )}
                    {job.dryRun.summary.pendingSteps > 0 && (
                      <span className="dry-run-count dry-run-count-pending">
                        {job.dryRun.summary.pendingSteps} pending
                      </span>
                    )}
                  </span>
                </div>
                <div className="dry-run-summary-row">
                  <span className="dry-run-summary-label">
                    Validation Checkpoints
                  </span>
                  <span className="dry-run-summary-counts">
                    <span className="dry-run-count dry-run-count-ready">
                      {job.dryRun.summary.readyCheckpoints} ready
                    </span>
                    {job.dryRun.summary.blockedCheckpoints > 0 && (
                      <span className="dry-run-count dry-run-count-blocked">
                        {job.dryRun.summary.blockedCheckpoints} blocked
                      </span>
                    )}
                    {job.dryRun.summary.advisoryCheckpoints > 0 && (
                      <span className="dry-run-count dry-run-count-advisory">
                        {job.dryRun.summary.advisoryCheckpoints} advisory
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Blocked reasons */}
              {job.dryRun.blockedReasons.length > 0 && (
                <div className="dry-run-reasons">
                  <span className="dry-run-reasons-label">Blocked Reasons</span>
                  <ul className="dry-run-reasons-list dry-run-reasons-blocked">
                    {job.dryRun.blockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advisory notes */}
              {job.dryRun.advisoryNotes.length > 0 && (
                <div className="dry-run-reasons">
                  <span className="dry-run-reasons-label">Advisory Notes</span>
                  <ul className="dry-run-reasons-list dry-run-reasons-advisory">
                    {job.dryRun.advisoryNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Step results */}
              {job.dryRun.stepResults.length > 0 && (
                <div className="dry-run-steps">
                  <h3 className="dry-run-steps-heading">Step Results</h3>
                  <ol className="dry-run-steps-list">
                    {job.dryRun.stepResults.map((s) => (
                      <li key={s.seq} className={`dry-run-step dry-run-step-${s.status}`}>
                        <span className="dry-run-step-desc">{s.description}</span>
                        <span className={`dry-run-step-badge dry-run-badge-${s.status}`}>
                          {s.status}
                        </span>
                        {s.note && s.status !== "ready" && (
                          <span className="dry-run-step-note">{s.note}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Checkpoint results */}
              {job.dryRun.checkpointResults.length > 0 && (
                <div className="dry-run-checkpoints">
                  <h3 className="dry-run-checkpoints-heading">
                    Validation Checkpoints
                  </h3>
                  <ul className="dry-run-checkpoints-list">
                    {job.dryRun.checkpointResults.map((c, i) => (
                      <li
                        key={i}
                        className={`dry-run-checkpoint dry-run-checkpoint-${c.status}`}
                      >
                        <span className="dry-run-checkpoint-desc">
                          {c.description}
                        </span>
                        {c.expectedValue && (
                          <span className="dry-run-checkpoint-expected">
                            Expected: {c.expectedValue}
                          </span>
                        )}
                        <span className={`dry-run-step-badge dry-run-badge-${c.status}`}>
                          {c.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="dry-run-disclaimer">
                This dry run has not been executed on e-Duti Setem.
              </p>

              {/* Re-run button */}
              <div style={{ marginTop: 10 }}>
                {dryRunError && (
                  <p className="field-error" style={{ marginBottom: 8 }}>
                    {dryRunError}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleRunDryRun}
                  disabled={runningDryRun}
                >
                  {runningDryRun ? "Re-evaluating\u2026" : "Re-run Dry Run"}
                </button>
              </div>
            </>
          ) : (
            <div>
              <p className="dry-run-intro">
                Evaluate the internal portal execution path based on the
                current automation plan and portal draft.
              </p>
              {dryRunError && (
                <p className="field-error" style={{ marginBottom: 8 }}>
                  {dryRunError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRunDryRun}
                disabled={runningDryRun}
              >
                {runningDryRun ? "Evaluating\u2026" : "Run Dry Run"}
              </button>
            </div>
          )}
        </div>
      )}

      </details>
      {/* ── /Advanced / Diagnostics — engineering panel cluster 2 ─── */}

      {/* ── Tenancy: stamping details form (status = uploaded) ─────── */}
      {needsDetails && (
        <div className="stamping-details-section">
          <h2 className="stamping-details-heading">Stamping Details</h2>
          <p className="stamping-details-intro">
            Enter the tenancy details from your signed agreement. The stamp
            duty calculation is based on the values you provide below.
          </p>

          {/* ── Extraction suggestions panel ───────────────────── */}
          {extracting && (
            <div className="extraction-loading">
              Scanning uploaded PDF for suggested values&hellip;
            </div>
          )}
          {!extracting && job.extractionResult && job.extractionResult.fieldsExtracted > 0 && (
            <div className="extraction-suggestions-panel">
              <h3 className="extraction-suggestions-heading">
                Extracted tenancy details
              </h3>
              <p className="extraction-suggestions-note">
                These values were suggested from the uploaded PDF and have not been verified.
              </p>
              <p className="extraction-suggestions-note">
                Please confirm or correct them before using them for stamping preparation.
              </p>
              <div className="extraction-suggestions-values">
                {job.extractionResult.suggestedMonthlyRent.value !== null && (
                  <span className={`extraction-suggestion-tag extraction-confidence-${job.extractionResult.suggestedMonthlyRent.confidence}`}>
                    Rent: RM {job.extractionResult.suggestedMonthlyRent.value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="extraction-confidence-label">
                      {job.extractionResult.suggestedMonthlyRent.confidence}
                    </span>
                  </span>
                )}
                {job.extractionResult.suggestedLeaseMonths.value !== null && (
                  <span className={`extraction-suggestion-tag extraction-confidence-${job.extractionResult.suggestedLeaseMonths.confidence}`}>
                    Duration: {job.extractionResult.suggestedLeaseMonths.value} months
                    <span className="extraction-confidence-label">
                      {job.extractionResult.suggestedLeaseMonths.confidence}
                    </span>
                  </span>
                )}
                {job.extractionResult.suggestedAgreementDate.value !== null && (
                  <span className={`extraction-suggestion-tag extraction-confidence-${job.extractionResult.suggestedAgreementDate.confidence}`}>
                    Date: {job.extractionResult.suggestedAgreementDate.value}
                    <span className="extraction-confidence-label">
                      {job.extractionResult.suggestedAgreementDate.confidence}
                    </span>
                  </span>
                )}
              </div>
              <p className="extraction-suggestions-provenance">
                {job.extractionResult.ocrAttempted
                  ? "Source: PDF scan / OCR (unverified)"
                  : "Source: PDF text extraction (unverified)"}
              </p>
              {!suggestionsApplied && (
                <button
                  type="button"
                  className="btn-secondary extraction-apply-btn"
                  onClick={() => {
                    const er = job.extractionResult!;
                    const newProvenance: FieldProvenanceClient = {
                      monthlyRent: "user_entered",
                      leaseMonths: "user_entered",
                    };
                    if (er.suggestedMonthlyRent.value !== null) {
                      setMonthlyRentStr(String(er.suggestedMonthlyRent.value));
                      newProvenance.monthlyRent = "extracted_applied";
                    }
                    if (er.suggestedLeaseMonths.value !== null) {
                      setLeaseMonthsStr(String(er.suggestedLeaseMonths.value));
                      newProvenance.leaseMonths = "extracted_applied";
                    }
                    setFieldProvenance(newProvenance);
                    setSuggestionsApplied(true);
                  }}
                >
                  Apply Suggested Values
                </button>
              )}
              {suggestionsApplied && (
                <p className="extraction-applied-note">
                  Suggested values applied. Edit them below if needed.
                </p>
              )}

              {/* ── Operator confirmation / override layer ─────────── */}
              {/* Persists job.confirmedTenancyInputs. Distinct from the
                  Stamping Details form — downstream draft/readiness logic
                  prefers these confirmed values over raw extraction. */}
              {job.confirmedTenancyInputs && !reviewOpen && (
                <div className="extraction-review-summary" style={{ marginTop: 12, padding: 12, border: "1px solid #ccc", borderRadius: 4 }}>
                  <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>
                    Reviewed — {job.confirmedTenancyInputs.reviewStatus === "reviewed_confirmed" ? "confirmed" : "overridden"}
                    {" "}
                    <span style={{ fontWeight: 400, color: "#555" }}>
                      ({new Date(job.confirmedTenancyInputs.confirmedAt).toLocaleString()})
                    </span>
                  </p>
                  <ul style={{ margin: "0 0 6px 0", paddingLeft: 18 }}>
                    {job.confirmedTenancyInputs.confirmedMonthlyRent !== null && (
                      <li>Rent: RM {job.confirmedTenancyInputs.confirmedMonthlyRent.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <em style={{ color: "#666" }}>({job.confirmedTenancyInputs.confirmedBySource.monthlyRent})</em></li>
                    )}
                    {job.confirmedTenancyInputs.confirmedLeaseMonths !== null && (
                      <li>Lease: {job.confirmedTenancyInputs.confirmedLeaseMonths} months <em style={{ color: "#666" }}>({job.confirmedTenancyInputs.confirmedBySource.leaseMonths})</em></li>
                    )}
                    {job.confirmedTenancyInputs.confirmedAgreementDate !== null && (
                      <li>Agreement date: {job.confirmedTenancyInputs.confirmedAgreementDate} <em style={{ color: "#666" }}>({job.confirmedTenancyInputs.confirmedBySource.agreementDate})</em></li>
                    )}
                  </ul>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const c = job.confirmedTenancyInputs!;
                      setReviewRentStr(c.confirmedMonthlyRent !== null ? String(c.confirmedMonthlyRent) : "");
                      setReviewMonthsStr(c.confirmedLeaseMonths !== null ? String(c.confirmedLeaseMonths) : "");
                      setReviewDateStr(c.confirmedAgreementDate ?? "");
                      setReviewError(null);
                      setReviewOpen(true);
                    }}
                  >
                    Edit confirmed values
                  </button>
                </div>
              )}

              {/* ── Resolved tenancy preparation values (internal) ───── */}
              {/* Canonical resolver output — single source of truth for the
                  sewa_pajakan advisory stack. Does NOT duplicate precedence
                  logic; always renders for tenancy jobs so operators can
                  verify exactly what values the internal layers will use
                  right now, regardless of confirmation state. */}
              {!reviewOpen && (() => {
                // Client StampingJob mirrors the server type shape used by
                // the resolver. The resolver only reads fields that exist
                // on the mirror (documentCategory, extractionResult,
                // confirmedTenancyInputs, stampingDetails), so this cast is
                // safe. Cast kept narrow to the resolver's input surface.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const resolved = resolveConfirmedTenancyPreparationValues(job as any);
                if (!resolved) return null;

                const c = job.confirmedTenancyInputs ?? null;

                const labelForSource = (s: string): string => {
                  switch (s) {
                    case "stamping_details":
                      return "stamping_details";
                    case "confirmed_input":
                      return "confirmed_input";
                    case "extraction_suggestion":
                      return "extraction_suggestion";
                    case "none":
                    default:
                      return "not_set";
                  }
                };

                return (
                  <div
                    className="tenancy-prep-basis-summary"
                    style={{ marginTop: 12, padding: 12, border: "1px solid #c9d6e8", borderRadius: 4, background: "#f4f8fd" }}
                  >
                    <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>
                      Resolved tenancy preparation values (internal)
                    </p>
                    <p style={{ margin: "0 0 8px 0", color: "#444", fontSize: 13 }}>
                      These are the exact values the internal sewa_pajakan
                      advisory stack is using right now. Derived by the
                      canonical resolver — precedence is not duplicated here.
                    </p>
                    <ul style={{ margin: "0 0 6px 0", paddingLeft: 18 }}>
                      <li>
                        Monthly rent:{" "}
                        {resolved.monthlyRent !== null
                          ? `RM ${resolved.monthlyRent.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}{" "}
                        <em style={{ color: "#666" }}>
                          ({labelForSource(resolved.sources.monthlyRent)})
                        </em>
                        {resolved.stampingDetailsOverridesConfirmed.monthlyRent && c?.confirmedMonthlyRent != null && (
                          <span style={{ color: "#a05a00", marginLeft: 6 }}>
                            — Stamping Details is currently overriding the confirmed value
                            (confirmed was RM {c.confirmedMonthlyRent.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                          </span>
                        )}
                      </li>
                      <li>
                        Lease months:{" "}
                        {resolved.leaseMonths !== null ? `${resolved.leaseMonths} months` : "—"}{" "}
                        <em style={{ color: "#666" }}>
                          ({labelForSource(resolved.sources.leaseMonths)})
                        </em>
                        {resolved.stampingDetailsOverridesConfirmed.leaseMonths && c?.confirmedLeaseMonths != null && (
                          <span style={{ color: "#a05a00", marginLeft: 6 }}>
                            — Stamping Details is currently overriding the confirmed value
                            (confirmed was {c.confirmedLeaseMonths} months)
                          </span>
                        )}
                      </li>
                      <li>
                        Agreement date:{" "}
                        {resolved.instrumentDate ?? "—"}{" "}
                        <em style={{ color: "#666" }}>
                          ({labelForSource(resolved.sources.instrumentDate)})
                        </em>
                      </li>
                      {c && (
                        <>
                          <li>
                            Review status:{" "}
                            {c.reviewStatus === "reviewed_confirmed" ? "reviewed — confirmed" : "reviewed — overridden"}
                          </li>
                          <li>
                            Confirmed at: {new Date(c.confirmedAt).toLocaleString()}
                          </li>
                        </>
                      )}
                      {!c && (
                        <li style={{ color: "#666" }}>
                          Operator confirmation not yet completed. Values
                          above fall back to raw extraction only for the
                          agreement date — rent and lease months remain
                          unset until stamping details or confirmation
                          provide them.
                        </li>
                      )}
                    </ul>
                    <p style={{ margin: "6px 0 0 0", color: "#666", fontSize: 12 }}>
                      Internal preparation only. This does not imply submission to any external system or live portal validation.
                    </p>
                  </div>
                );
              })()}

              {/* ── Tenancy Preparation Status panel ─────────────────── */}
              {/* Truthful internal rollup: extraction present? confirmation
                  completed? internally marked ready? Plus an operator-only
                  mark-ready action. No external system is contacted. */}
              {(() => {
                const hasExtraction = !!job.extractionResult;
                const hasConfirmation = !!job.confirmedTenancyInputs;
                const readiness = job.tenancyPreparationReadiness;
                const isMarkedReady = !!readiness;

                let statusLabel: string;
                if (isMarkedReady) {
                  statusLabel = "Preparation review complete";
                } else if (hasConfirmation) {
                  statusLabel = "Awaiting preparation review mark";
                } else if (hasExtraction) {
                  statusLabel = "Awaiting confirmation of extracted values";
                } else {
                  statusLabel = "Awaiting extraction";
                }

                return (
                  <div
                    className="tenancy-preparation-status-panel"
                    style={{ marginTop: 16, padding: 12, border: "1px solid #ccd6e0", borderRadius: 4, background: "#fafcfe" }}
                  >
                    <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>
                      Tenancy preparation status (internal)
                    </p>
                    <p style={{ margin: "0 0 8px 0", color: "#333" }}>
                      {statusLabel}
                    </p>
                    <ul style={{ margin: "0 0 8px 0", paddingLeft: 18, fontSize: 13 }}>
                      <li>
                        Extraction: {hasExtraction ? "present" : "not present"}
                      </li>
                      <li>
                        Confirmation: {hasConfirmation
                          ? `completed (${job.confirmedTenancyInputs!.reviewStatus === "reviewed_confirmed" ? "confirmed" : "overridden"})`
                          : "not yet completed"}
                      </li>
                      <li>
                        Marked internally ready for preparation:{" "}
                        {isMarkedReady
                          ? `yes (${new Date(readiness!.markedReadyAt).toLocaleString()})`
                          : "no"}
                      </li>
                    </ul>

                    {!isMarkedReady && (
                      <>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!hasConfirmation || markReadySaving}
                          title={!hasConfirmation ? "Confirm or override the extracted values first." : undefined}
                          onClick={async () => {
                            setMarkReadyError(null);
                            setMarkReadySaving(true);
                            try {
                              const res = await fetch(
                                `/api/intake/${job.id}/mark-tenancy-preparation-ready`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({}),
                                },
                              );
                              if (!res.ok) {
                                const body = await res.json().catch(() => ({}));
                                setMarkReadyError(body.error ?? `Action failed (HTTP ${res.status}).`);
                                return;
                              }
                              const updated = await res.json();
                              setJob(updated as StampingJob);
                            } catch (err) {
                              setMarkReadyError(
                                err instanceof Error ? err.message : "Action failed.",
                              );
                            } finally {
                              setMarkReadySaving(false);
                            }
                          }}
                        >
                          {markReadySaving ? "Marking…" : "Mark preparation review complete"}
                        </button>
                        {!hasConfirmation && (
                          <p style={{ margin: "6px 0 0 0", color: "#666", fontSize: 12 }}>
                            Confirm or override the extracted tenancy values first.
                          </p>
                        )}
                        {markReadyError && (
                          <p style={{ margin: "6px 0 0 0", color: "#a00", fontSize: 12 }}>
                            {markReadyError}
                          </p>
                        )}
                      </>
                    )}

                    {isMarkedReady && (
                      <p style={{ margin: "6px 0 0 0", color: "#666", fontSize: 12 }}>
                        Internal marker only. Does not imply submission to any external system or live portal validation.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* ── Advisory snapshot (sewa_pajakan) ─────────────────── */}
              {/* Compact internal verification of the downstream advisory
                  outputs: routing lane, portal draft tenancy fields (if
                  drafted), and execution preview summary (if compiled).
                  Reads persisted advisory output only — does not recompute
                  or call the portal. */}
              {(() => {
                const lane = job.routingSuggestion?.suggestedLane ?? null;
                const draft = job.portalDraft;
                const ma = draft?.maklumatAmSewaPajakan;
                const preview = job.executionPreview;
                const hasAny = !!lane || !!draft || !!preview;
                if (!hasAny) return null;

                const draftDate = ma?.instrumentDate ?? null;
                const draftRent =
                  typeof ma?.monthlyRent === "number" ? ma.monthlyRent : null;
                const draftMonths =
                  typeof ma?.leaseMonths === "number" ? ma.leaseMonths : null;

                const intendedCount = preview?.intendedInputs?.length ?? 0;
                const unresolvedCount = preview?.unresolvedSteps?.length ?? 0;

                return (
                  <div
                    className="tenancy-advisory-snapshot"
                    style={{ marginTop: 16, padding: 12, border: "1px solid #d4dbe3", borderRadius: 4, background: "#fbfcfd" }}
                  >
                    <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>
                      Advisory snapshot (sewa_pajakan)
                    </p>
                    <p style={{ margin: "0 0 8px 0", color: "#444", fontSize: 13 }}>
                      Read-only summary of the internal advisory outputs for
                      operator verification. No live portal interaction.
                    </p>
                    <ul style={{ margin: "0 0 6px 0", paddingLeft: 18, fontSize: 13 }}>
                      <li>
                        Routing lane:{" "}
                        {lane ? lane : <em style={{ color: "#666" }}>not suggested yet</em>}
                      </li>
                      <li>
                        Portal draft:{" "}
                        {draft ? (
                          <>
                            {draft.status}
                            {draft.draftedAt && (
                              <span style={{ color: "#666" }}>
                                {" "}
                                ({new Date(draft.draftedAt).toLocaleString()})
                              </span>
                            )}
                          </>
                        ) : (
                          <em style={{ color: "#666" }}>not drafted yet</em>
                        )}
                      </li>
                      {draft && lane === "sewa_pajakan" && (
                        <>
                          <li>
                            Draft instrument date: {draftDate ?? "—"}
                          </li>
                          <li>
                            Draft monthly rent:{" "}
                            {draftRent !== null
                              ? `RM ${draftRent.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "—"}
                          </li>
                          <li>
                            Draft lease months:{" "}
                            {draftMonths !== null ? `${draftMonths} months` : "—"}
                          </li>
                        </>
                      )}
                      <li>
                        Execution preview:{" "}
                        {preview ? (
                          <>
                            {preview.status} — {intendedCount} intended input
                            {intendedCount === 1 ? "" : "s"}, {unresolvedCount}{" "}
                            unresolved step{unresolvedCount === 1 ? "" : "s"}
                          </>
                        ) : (
                          <em style={{ color: "#666" }}>not compiled yet</em>
                        )}
                      </li>
                      {preview && unresolvedCount > 0 && (
                        <li style={{ color: "#a05a00" }}>
                          Unresolved dependencies still block downstream steps.
                        </li>
                      )}
                    </ul>
                    <p style={{ margin: "6px 0 0 0", color: "#666", fontSize: 12 }}>
                      Internal advisory only. No external system contacted.
                    </p>
                  </div>
                );
              })()}

              {!job.confirmedTenancyInputs && !reviewOpen && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const er = job.extractionResult!;
                    setReviewRentStr(er.suggestedMonthlyRent.value !== null ? String(er.suggestedMonthlyRent.value) : "");
                    setReviewMonthsStr(er.suggestedLeaseMonths.value !== null ? String(er.suggestedLeaseMonths.value) : "");
                    setReviewDateStr(er.suggestedAgreementDate.value ?? "");
                    setReviewError(null);
                    setReviewOpen(true);
                  }}
                >
                  Review &amp; confirm / override
                </button>
              )}

              {reviewOpen && (
                <div className="extraction-review-form" style={{ marginTop: 12, padding: 12, border: "1px solid #ccc", borderRadius: 4 }}>
                  <p style={{ margin: "0 0 8px 0", fontWeight: 600 }}>
                    Confirm or correct extracted tenancy details
                  </p>
                  <p style={{ margin: "0 0 12px 0", color: "#555", fontSize: 13 }}>
                    Leave a field blank if it does not apply. These values are saved as your confirmed review and are not sent to any external system.
                  </p>

                  <div className="form-group">
                    <label htmlFor="rv-rent">Monthly rent <span className="label-hint">(RM)</span></label>
                    <input
                      id="rv-rent"
                      type="text"
                      inputMode="decimal"
                      value={reviewRentStr}
                      onChange={(e) => setReviewRentStr(e.target.value)}
                      disabled={reviewSaving}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="rv-months">Lease duration <span className="label-hint">(months)</span></label>
                    <input
                      id="rv-months"
                      type="text"
                      inputMode="numeric"
                      value={reviewMonthsStr}
                      onChange={(e) => setReviewMonthsStr(e.target.value)}
                      disabled={reviewSaving}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="rv-date">Agreement date <span className="label-hint">(YYYY-MM-DD)</span></label>
                    <input
                      id="rv-date"
                      type="text"
                      value={reviewDateStr}
                      onChange={(e) => setReviewDateStr(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      disabled={reviewSaving}
                    />
                  </div>

                  {reviewError && (
                    <p className="field-error" style={{ color: "#a00", margin: "4px 0 8px 0" }}>{reviewError}</p>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={reviewSaving}
                      onClick={async () => {
                        setReviewError(null);

                        // Parse inputs; a blank field maps to null.
                        const parseNum = (s: string): number | null => {
                          const t = s.trim();
                          if (!t) return null;
                          const n = Number(t.replace(/,/g, ""));
                          return Number.isFinite(n) ? n : NaN as unknown as number;
                        };
                        const rentVal = parseNum(reviewRentStr);
                        const monthsRaw = reviewMonthsStr.trim();
                        const monthsVal = monthsRaw === "" ? null : Number(monthsRaw);
                        const dateVal = reviewDateStr.trim() === "" ? null : reviewDateStr.trim();

                        if (rentVal !== null && !Number.isFinite(rentVal)) {
                          setReviewError("Monthly rent must be a number.");
                          return;
                        }
                        if (monthsVal !== null && (!Number.isFinite(monthsVal) || !Number.isInteger(monthsVal))) {
                          setReviewError("Lease duration must be a whole number of months.");
                          return;
                        }
                        if (rentVal === null && monthsVal === null && dateVal === null) {
                          setReviewError("Enter at least one value to confirm.");
                          return;
                        }

                        setReviewSaving(true);
                        try {
                          const res = await fetch(`/api/intake/${job.id}/confirm-tenancy`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              confirmedMonthlyRent: rentVal,
                              confirmedLeaseMonths: monthsVal,
                              confirmedAgreementDate: dateVal,
                            }),
                          });
                          if (!res.ok) {
                            const body = await res.json().catch(() => ({}));
                            setReviewError(body.error ?? `Save failed (HTTP ${res.status}).`);
                            return;
                          }
                          const updated = await res.json();
                          setJob(updated as StampingJob);
                          setReviewOpen(false);
                        } catch (err) {
                          setReviewError(err instanceof Error ? err.message : "Save failed.");
                        } finally {
                          setReviewSaving(false);
                        }
                      }}
                    >
                      {reviewSaving ? "Saving…" : "Save confirmed values"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={reviewSaving}
                      onClick={() => { setReviewOpen(false); setReviewError(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!extracting && job.extractionResult && job.extractionResult.fieldsExtracted === 0 && (
            <div className="extraction-empty-note">
              {job.extractionResult.ocrAttempted
                ? "No suggested values could be detected from the uploaded PDF scan. Please enter the details manually below."
                : "No suggested values could be detected from the uploaded PDF. Please enter the details manually below."}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="sd-rent">
              Monthly Rent{" "}
              <span className="label-hint">(RM, e.g. 1500 or 1500.50)</span>
            </label>
            <input
              id="sd-rent"
              type="text"
              inputMode="decimal"
              value={monthlyRentStr}
              onChange={(e) => {
                setMonthlyRentStr(e.target.value);
                if (suggestionsApplied && fieldProvenance.monthlyRent === "extracted_applied") {
                  setFieldProvenance((prev) => ({ ...prev, monthlyRent: "extracted_applied_then_edited" }));
                }
              }}
              placeholder="e.g. 1500"
              className={formErrors.monthlyRent ? "input-error" : ""}
              disabled={saving}
            />
            {formErrors.monthlyRent && (
              <p className="field-error">{formErrors.monthlyRent}</p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="sd-months">
              Lease Duration{" "}
              <span className="label-hint">(months, e.g. 12)</span>
            </label>
            <input
              id="sd-months"
              type="text"
              inputMode="numeric"
              value={leaseMonthsStr}
              onChange={(e) => {
                setLeaseMonthsStr(e.target.value);
                if (suggestionsApplied && fieldProvenance.leaseMonths === "extracted_applied") {
                  setFieldProvenance((prev) => ({ ...prev, leaseMonths: "extracted_applied_then_edited" }));
                }
              }}
              placeholder="e.g. 12"
              className={formErrors.leaseMonths ? "input-error" : ""}
              disabled={saving}
            />
            {formErrors.leaseMonths && (
              <p className="field-error">{formErrors.leaseMonths}</p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="sd-copies">
              Duplicate Copies{" "}
              <span className="label-hint">
                (0 if none — RM10 flat per copy)
              </span>
            </label>
            <input
              id="sd-copies"
              type="text"
              inputMode="numeric"
              value={duplicateCopiesStr}
              onChange={(e) => setDuplicateCopiesStr(e.target.value)}
              placeholder="0"
              className={formErrors.duplicateCopies ? "input-error" : ""}
              disabled={saving}
            />
            {formErrors.duplicateCopies && (
              <p className="field-error">{formErrors.duplicateCopies}</p>
            )}
          </div>

          {/* ── Tenancy structure flags ────────────────────────── */}
          <fieldset className="structure-flags-fieldset" disabled={saving}>
            <legend className="structure-flags-legend">
              Does this tenancy include any of the following?
            </legend>
            <p className="structure-flags-hint">
              If any apply, this case will require manual review and cannot
              proceed through the automated workflow.
            </p>
            {([
              ["hasPremiumOrFine", "Premium or fine payable"],
              ["hasVariableRent", "Variable, percentage-based, or escalating rent"],
              ["isMixedUse", "Mixed-use or ambiguous property classification"],
              ["isPeriodicOrIndefinite", "Periodic, rolling, or indefinite lease term"],
              ["hasBundledCharges", "Charges bundled with rent (maintenance, furnishing, service charges)"],
              ["hasUnusualConsideration", "Unusual or unclear consideration"],
            ] as [keyof StructureFlags, string][]).map(([key, label]) => (
              <label key={key} className="structure-flag-option">
                <input
                  type="checkbox"
                  checked={structureFlags[key] === true}
                  onChange={(e) =>
                    setStructureFlags((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>

          {saveError && (
            <p className="field-error" style={{ marginBottom: 12 }}>
              {saveError}
            </p>
          )}

          <button
            type="button"
            onClick={validateAndSubmit}
            disabled={saving}
          >
            {saving ? "Saving\u2026" : "Calculate & Save"}
          </button>
        </div>
      )}

      {/* ── Tenancy: saved stamping details + duty breakdown ─────── */}
      {hasDetails && job.stampingDetails && (
        <div className="stamping-details-section">
          <h2 className="stamping-details-heading">Stamping Details</h2>

          <div className="intake-details-card">
            <div className="intake-details-row">
              <span className="intake-details-label">Monthly Rent</span>
              <span className="intake-details-value">
                {formatRM(job.stampingDetails.monthlyRent)}
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Lease Duration</span>
              <span className="intake-details-value">
                {job.stampingDetails.leaseMonths} months
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Duplicate Copies</span>
              <span className="intake-details-value">
                {job.stampingDetails.duplicateCopies}
              </span>
            </div>
          </div>

          <h3 className="duty-breakdown-heading">Stamp Duty Breakdown</h3>
          <table className="breakdown-table">
            <tbody>
              <tr>
                <td>Rate Tier</td>
                <td>{job.stampingDetails.calculatedDuty.rateTierLabel}</td>
              </tr>
              <tr>
                <td>Base Duty</td>
                <td>
                  {formatRM(job.stampingDetails.calculatedDuty.baseDuty)}
                </td>
              </tr>
              <tr>
                <td>Duplicate Copy Fee</td>
                <td>
                  {formatRM(
                    job.stampingDetails.calculatedDuty.duplicateCopyTotal
                  )}
                </td>
              </tr>
              <tr className="total-row">
                <td>Total Stamp Duty</td>
                <td>
                  {formatRM(job.stampingDetails.calculatedDuty.totalDuty)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="intake-next-note">
            <p>
              Your stamping details and duty calculation have been saved.
              The duty amount shown is based on the values you entered and
              has not been verified against the uploaded document. LHDN
              submission will be available in a future update.
            </p>
          </div>
        </div>
      )}

      {/* ── Tenancy: prepare for stamping (status = intake_reviewed) ── */}
      {canPrepare && (
        <div className="stamping-details-section">
          {prepareError && (
            <p className="field-error" style={{ marginBottom: 12 }}>
              {prepareError}
            </p>
          )}
          <button
            type="button"
            onClick={handlePrepare}
            disabled={preparing}
          >
            {preparing ? "Preparing\u2026" : "Prepare for Stamping"}
          </button>
        </div>
      )}

      {/* ── Tenancy: prepared state (status = prepared) ──────────────── */}
      {isPrepared && job.preparationSnapshot && (
        <div className="stamping-details-section">
          <h2 className="stamping-details-heading">Preparation Snapshot</h2>

          <div className="intake-details-card">
            <div className="intake-details-row">
              <span className="intake-details-label">Prepared At</span>
              <span className="intake-details-value">
                {new Date(job.preparationSnapshot.preparedAt).toLocaleString(
                  "en-MY",
                  { dateStyle: "medium", timeStyle: "short" }
                )}
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Monthly Rent</span>
              <span className="intake-details-value">
                {formatRM(job.preparationSnapshot.tenancyDetails.monthlyRent)}
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Lease Duration</span>
              <span className="intake-details-value">
                {job.preparationSnapshot.tenancyDetails.leaseMonths} months
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Duplicate Copies</span>
              <span className="intake-details-value">
                {job.preparationSnapshot.tenancyDetails.duplicateCopies}
              </span>
            </div>
          </div>

          <h3 className="duty-breakdown-heading">Stamp Duty Breakdown</h3>
          <table className="breakdown-table">
            <tbody>
              <tr>
                <td>Rate Tier</td>
                <td>{job.preparationSnapshot.dutyCalculation.rateTierLabel}</td>
              </tr>
              <tr>
                <td>Base Duty</td>
                <td>
                  {formatRM(job.preparationSnapshot.dutyCalculation.baseDuty)}
                </td>
              </tr>
              <tr>
                <td>Duplicate Copy Fee</td>
                <td>
                  {formatRM(
                    job.preparationSnapshot.dutyCalculation.duplicateCopyTotal
                  )}
                </td>
              </tr>
              <tr className="total-row">
                <td>Total Stamp Duty</td>
                <td>
                  {formatRM(job.preparationSnapshot.dutyCalculation.totalDuty)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="intake-next-note">
            <p>
              This preparation snapshot is based on the details you entered and
              has not been verified against the uploaded PDF. STSDS submission
              will be added in a later update.
            </p>
          </div>
        </div>
      )}

      {/* ── Tenancy: mark ready (status = prepared) ────────────────── */}
      {isPrepared && (
        <div className="stamping-details-section">
          {transitionError && (
            <p className="field-error" style={{ marginBottom: 12 }}>
              {transitionError}
            </p>
          )}
          <button
            type="button"
            onClick={() => handleTransition("ready_for_submission")}
            disabled={transitioning}
          >
            {transitioning ? "Updating\u2026" : "Confirm & Mark Ready"}
          </button>
        </div>
      )}

      {/* ── Tenancy: submission review (status = ready_for_submission) ── */}
      {isReady && job.stampingDetails && (
        <div className="submission-review">
          <h2 className="submission-review-heading">Submission Review</h2>

          {/* ── Document summary ─────────────────────────────────── */}
          <div className="intake-details-card">
            <div className="intake-details-row">
              <span className="intake-details-label">Document</span>
              <span className="intake-details-value">
                {job.originalFileName}
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Category</span>
              <span className="intake-details-value">
                {CATEGORY_LABELS[job.documentCategory] ?? job.documentCategory}
              </span>
            </div>
          </div>

          {/* ── Tenancy details snapshot ─────────────────────────── */}
          <h3 className="submission-review-subheading">Tenancy Details</h3>
          <div className="intake-details-card">
            <div className="intake-details-row">
              <span className="intake-details-label">Monthly Rent</span>
              <span className="intake-details-value">
                {formatRM(job.stampingDetails.monthlyRent)}
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Lease Duration</span>
              <span className="intake-details-value">
                {job.stampingDetails.leaseMonths} months
              </span>
            </div>
            <div className="intake-details-row">
              <span className="intake-details-label">Duplicate Copies</span>
              <span className="intake-details-value">
                {job.stampingDetails.duplicateCopies}
              </span>
            </div>
          </div>

          {/* ── Estimated stamping summary ───────────────────────── */}
          <h3 className="submission-review-subheading">
            Estimated Stamping Summary
          </h3>
          <p className="submission-review-note">
            Stamp duty based on entered details
          </p>
          <table className="breakdown-table">
            <tbody>
              <tr>
                <td>Rate Tier</td>
                <td>{job.stampingDetails.calculatedDuty.rateTierLabel}</td>
              </tr>
              <tr>
                <td>Base Duty</td>
                <td>
                  {formatRM(job.stampingDetails.calculatedDuty.baseDuty)}
                </td>
              </tr>
              {job.stampingDetails.calculatedDuty.duplicateCopyTotal > 0 && (
                <tr>
                  <td>
                    Duplicate Copy Fee ({job.stampingDetails.duplicateCopies}{" "}
                    {job.stampingDetails.duplicateCopies === 1
                      ? "copy"
                      : "copies"}{" "}
                    &times; RM10)
                  </td>
                  <td>
                    {formatRM(
                      job.stampingDetails.calculatedDuty.duplicateCopyTotal
                    )}
                  </td>
                </tr>
              )}
              <tr className="total-row">
                <td>Total Stamp Duty</td>
                <td>
                  {formatRM(job.stampingDetails.calculatedDuty.totalDuty)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── Provenance note ──────────────────────────────────── */}
          <div className="intake-next-note">
            <p>
              These figures are based on the details you entered and have not
              been verified against the uploaded PDF.
            </p>
          </div>

          {/* ── Final action area ────────────────────────────────── */}
          {/* ── Payload ready panel ─────────────────────────────── */}
          {job.submissionPayload ? (
            <div className="payload-ready-panel">
              <h3 className="payload-ready-heading">
                Submission Payload Ready
              </h3>
              <p className="payload-ready-note">
                WeStamp has prepared the structured submission data for this
                tenancy case.
              </p>
              <div className="intake-details-card" style={{ marginTop: 12 }}>
                <div className="intake-details-row">
                  <span className="intake-details-label">Drafted</span>
                  <span className="intake-details-value">
                    {new Date(job.submissionPayload.draftedAt).toLocaleString(
                      "en-MY",
                      { dateStyle: "medium", timeStyle: "short" }
                    )}
                  </span>
                </div>
                <div className="intake-details-row">
                  <span className="intake-details-label">Payload Status</span>
                  <span className="intake-details-value">Draft</span>
                </div>
                <div className="intake-details-row">
                  <span className="intake-details-label">Data Source</span>
                  <span className="intake-details-value">
                    User-entered, unverified
                  </span>
                </div>
              </div>
              <p className="payload-ready-deferred">
                Live STSDS submission is not yet available. This will be
                enabled in a future update.
              </p>

              {/* ── Execution layer section ──────────────────────── */}
              {job.executionAttempt ? (
                <div className="execution-panel">
                  <h4 className="execution-panel-heading">
                    Execution Layer Initialized
                  </h4>
                  <p className="execution-panel-note">
                    WeStamp has created the internal execution placeholder
                    for this tenancy case.
                  </p>
                  <div
                    className="intake-details-card"
                    style={{ marginTop: 10 }}
                  >
                    <div className="intake-details-row">
                      <span className="intake-details-label">
                        Attempt ID
                      </span>
                      <span className="intake-details-value intake-ref">
                        {job.executionAttempt.attemptId}
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">
                        Initialized
                      </span>
                      <span className="intake-details-value">
                        {new Date(
                          job.executionAttempt.createdAt
                        ).toLocaleString("en-MY", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <div className="intake-details-row">
                      <span className="intake-details-label">Status</span>
                      <span className="intake-details-value">
                        Not enabled
                      </span>
                    </div>
                  </div>
                  <p className="execution-panel-deferred">
                    Live STSDS execution is not yet available.
                  </p>
                </div>
              ) : (
                <div className="execution-init-area">
                  {executionError && (
                    <p className="field-error" style={{ marginBottom: 10 }}>
                      {executionError}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginTop: 4 }}
                    onClick={handleInitializeExecution}
                    disabled={initializingExecution}
                  >
                    {initializingExecution
                      ? "Initializing\u2026"
                      : "Prepare Execution Layer"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="submission-final-action">
              <h3 className="submission-final-heading">
                Submission Step Coming Soon
              </h3>
              <p className="submission-final-note">
                This job is ready for submission, but live STSDS submission is
                not yet available.
              </p>
              {payloadError && (
                <p className="field-error" style={{ marginTop: 10 }}>
                  {payloadError}
                </p>
              )}
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 12 }}
                onClick={handleDraftPayload}
                disabled={draftingPayload}
              >
                {draftingPayload
                  ? "Preparing\u2026"
                  : "Prepare Submission Data"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Manual review required ──────────────────────────────────── */}
      {isManualReview && (
        <div className="manual-review-panel">
          <h2 className="manual-review-heading">Manual Review Required</h2>
          <p className="manual-review-note">
            {isTenancy
              ? "This tenancy case cannot continue through the current automated workflow based on the available details."
              : "This job cannot continue through the current automated workflow based on the available details."}
          </p>
          {job.notes && (
            <div className="manual-review-reason">
              <span className="manual-review-reason-label">Reason</span>
              {job.notes.includes("\n") ? (
                <ul className="manual-review-reason-list">
                  {job.notes.split("\n").filter(Boolean).map((line, i) => (
                    <li key={i}>{line.replace(/^•\s*/, "")}</li>
                  ))}
                </ul>
              ) : (
                <p>{job.notes}</p>
              )}
            </div>
          )}
          <p className="manual-review-secondary">
            A later update may add support for this type of case.
          </p>
        </div>
      )}

      {/* ── Failed state ──────────────────────────────────────────────── */}
      {isFailed && (
        <div className="failed-panel">
          <h2 className="failed-heading">Unable to Continue</h2>
          <p className="failed-note">
            This job cannot move to the next step in its current state.
          </p>
          {job.errorMessage && (
            <div className="failed-reason">
              <span className="failed-reason-label">Details</span>
              <p>{job.errorMessage}</p>
            </div>
          )}
          <p className="failed-secondary">
            Please review the job information or upload a new document to try
            again.
          </p>
        </div>
      )}

      {/* ── Other / Not Sure (no automated lane) ─────────────────────
          Catch-all for non-tenancy categories that are NOT in the
          nominal-duty registry (for example, "Other / Not Sure").
          Intentionally narrow: no advisory, no automation, no
          commitment beyond confirming the file was received. */}
      {!isTenancy && !isNominalDuty && !isManualReview && !isFailed && (
        <div className="intake-next-note">
          <p>
            Your document has been saved. An operator will review the
            category and follow up if anything needs to be confirmed.
          </p>
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <div className="upload-actions" style={{ marginTop: 24 }}>
        <a href="/upload" className="btn-secondary">
          Upload another document
        </a>
        <a href="/">Back to Home</a>
      </div>
    </main>
  );
}
