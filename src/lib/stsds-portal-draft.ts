/**
 * WeStamp — STSDS Portal Draft Builder
 *
 * Assembles an internal portal draft from existing job data:
 * routing suggestion, stamping details, extraction results.
 *
 * The draft represents "what WeStamp intends to put into the portal"
 * — NOT what has been submitted.
 *
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT advance job status.
 */

import { StampingJob } from "./stamping-types";
import {
  StsdsPortalDraft,
  MaklumatAmSewaPajakan,
  MaklumatAmPenyetemanAm,
  PortalDraftDutySummary,
  ObservedMappingEvidence,
} from "./stsds-types";
import { getCatalogue } from "./stsds-catalogue";

/**
 * Validation result for a portal draft.
 * Lists missing required fields, if any.
 */
export interface PortalDraftValidation {
  /** Whether the draft has all required fields for ready_for_review. */
  isComplete: boolean;
  /** Human-readable list of missing required fields. */
  missingFields: string[];
}

/**
 * Check whether a portal draft has all required fields for ready_for_review.
 *
 * Required for both lanes: stampOffice, instrumentDate.
 * Required additionally for penyeteman_am: portalDocumentName.
 *
 * @param draft - The portal draft to validate
 * @returns Validation result with missing field names
 */
export function validatePortalDraft(
  draft: StsdsPortalDraft
): PortalDraftValidation {
  const missing: string[] = [];

  if (draft.lane === "sewa_pajakan") {
    const am = draft.maklumatAmSewaPajakan;
    if (!am?.stampOffice?.trim()) missing.push("Stamp Office");
    if (!am?.instrumentDate?.trim()) missing.push("Instrument Date");
  } else if (draft.lane === "penyeteman_am") {
    const am = draft.maklumatAmPenyetemanAm;
    if (!am?.portalDocumentName?.trim()) missing.push("Portal Document Name");
    if (!am?.stampOffice?.trim()) missing.push("Stamp Office");
    if (!am?.instrumentDate?.trim()) missing.push("Instrument Date");
  }

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

/**
 * Build or update an internal portal draft from the current job state.
 *
 * @param job - The stamping job to build the draft from
 * @returns A portal draft object, or null if insufficient data
 */
export function buildPortalDraft(
  job: StampingJob
): StsdsPortalDraft | null {
  const routing = job.routingSuggestion;
  if (!routing) return null;

  const lane = routing.suggestedLane;
  const now = new Date().toISOString();

  if (lane === "sewa_pajakan") {
    return buildSewaPajakanDraft(job, now);
  }

  if (lane === "penyeteman_am") {
    return buildPenyetemanAmDraft(job, now);
  }

  return null;
}

// ─── Sewa / Pajakan Draft ────────────────────────────────────────────

function buildSewaPajakanDraft(
  job: StampingJob,
  now: string
): StsdsPortalDraft {
  const maklumatAm: MaklumatAmSewaPajakan = {};

  // Populate from stamping details if available
  if (job.stampingDetails) {
    maklumatAm.monthlyRent = job.stampingDetails.monthlyRent;
    maklumatAm.leaseMonths = job.stampingDetails.leaseMonths;
  }

  // Populate instrument date from extraction if available
  if (job.extractionResult?.suggestedAgreementDate?.value) {
    maklumatAm.instrumentDate =
      job.extractionResult.suggestedAgreementDate.value;
  }

  // Build duty summary from stamping details if available
  let dutySummary: PortalDraftDutySummary | undefined;
  if (job.stampingDetails?.calculatedDuty) {
    const d = job.stampingDetails.calculatedDuty;
    dutySummary = {
      payableDuty: d.baseDuty,
      duplicateCopyAmount:
        d.duplicateCopyTotal > 0 ? d.duplicateCopyTotal : undefined,
      totalPayable: d.totalDuty,
    };
  }

  return {
    status: job.stampingDetails ? "ready_for_review" : "draft",
    source: "auto_from_job",
    lane: "sewa_pajakan",
    draftedAt: now,
    maklumatAmSewaPajakan: maklumatAm,
    dutySummary,
  };
}

// ─── Penyeteman Am Draft ─────────────────────────────────────────────

function buildPenyetemanAmDraft(
  job: StampingJob,
  now: string
): StsdsPortalDraft {
  const routing = job.routingSuggestion!;

  const maklumatAm: MaklumatAmPenyetemanAm = {
    portalDocumentName: routing.suggestedPortalDocumentName ?? "",
    expectedDerivedDocumentGroup:
      routing.expectedDerivedDocumentGroup ?? null,
    editableInstrumentCategory:
      routing.observedEditableInstrumentCategory ?? null,
  };

  // Look up mapping evidence from catalogue
  let mappingEvidence: ObservedMappingEvidence | undefined;
  if (routing.suggestedPortalDocumentName) {
    const catalogue = getCatalogue();
    const match = catalogue.find(
      (c) =>
        c.portalLane === "penyeteman_am" &&
        c.portalDocumentName === routing.suggestedPortalDocumentName
    );
    if (match) {
      mappingEvidence = match.mappingEvidence;
      // Fill in derived group and editable category from catalogue if not already set
      if (!maklumatAm.expectedDerivedDocumentGroup && match.expectedDerivedDocumentGroup) {
        maklumatAm.expectedDerivedDocumentGroup = match.expectedDerivedDocumentGroup;
      }
      if (!maklumatAm.editableInstrumentCategory && match.observedEditableInstrumentCategory) {
        maklumatAm.editableInstrumentCategory = match.observedEditableInstrumentCategory;
      }
    }
  }

  const hasDocName = !!maklumatAm.portalDocumentName;

  return {
    status: hasDocName ? "ready_for_review" : "draft",
    source: "auto_from_job",
    lane: "penyeteman_am",
    draftedAt: now,
    maklumatAmPenyetemanAm: maklumatAm,
    mappingEvidence,
  };
}
