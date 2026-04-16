/**
 * WeStamp — Portal Execution Preview Compiler
 *
 * Compiles an internal preview of what WeStamp intends to enter and
 * validate in e-Duti Setem, based on current job state.
 *
 * This is NOT a live portal interaction. It is an internal compiled
 * view for operator review before any real automation begins.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalExecutionPreview,
  PortalExecutionPreviewIntendedInput,
  PortalExecutionPreviewValidationTarget,
  PortalExecutionPreviewStatus,
} from "./stsds-types";
import { getLaneKnowledgeProfile } from "./stsds-lane-knowledge";

export function compileExecutionPreview(
  job: StampingJob
): PortalExecutionPreview | null {
  if (!job.routingSuggestion) return null;

  const now = new Date().toISOString();
  const lane = job.routingSuggestion.suggestedLane;
  const draft = job.portalDraft;
  const prep = job.preparationInputs;
  const notes: string[] = [];

  const intendedInputs: PortalExecutionPreviewIntendedInput[] = [];
  const validationTargets: PortalExecutionPreviewValidationTarget[] = [];
  const unresolvedSteps: string[] = [];

  const preparationSummary = {
    declarationPrepared: prep?.declarationPrepared ?? false,
    bahagianAFirstPartyPrepared: prep?.bahagianAFirstPartyPrepared ?? false,
    bahagianASecondPartyPrepared: prep?.bahagianASecondPartyPrepared ?? false,
  };

  if (lane === "penyeteman_am") {
    const ma = draft?.maklumatAmPenyetemanAm;

    // ── Intended inputs ─────────────────────────────────────────
    intendedInputs.push({
      field: "Portal Document Name (Nama Surat Cara)",
      value: ma?.portalDocumentName ?? null,
      source: "routing_suggestion",
    });
    intendedInputs.push({
      field: "Editable Instrument Category (Kategori Surat Cara)",
      value: ma?.editableInstrumentCategory ?? null,
      source: ma?.editableInstrumentCategory ? "observed_mapping" : "unknown",
    });
    intendedInputs.push({
      field: "Stamp Office (Pejabat Setem Negeri)",
      value: ma?.stampOffice ?? null,
      source: ma?.stampOffice ? "user_entered" : "not_set",
    });
    intendedInputs.push({
      field: "Instrument Date (Tarikh Surat Cara)",
      value: ma?.instrumentDate ?? null,
      source: ma?.instrumentDate ? "user_entered" : "not_set",
    });
    if (ma?.receivedInMalaysiaDate) {
      intendedInputs.push({
        field: "Received in Malaysia Date",
        value: ma.receivedInMalaysiaDate,
        source: "user_entered",
      });
    }

    // Bahagian B values from draft if available
    const ds = draft?.dutySummary;
    if (ds?.payableDuty != null) {
      intendedInputs.push({
        field: "Bahagian B: Bayaran / Balasan (RM)",
        value: ds.payableDuty,
        source: "calculated",
      });
    }

    // ── Validation targets ──────────────────────────────────────
    validationTargets.push({
      field: "Expected Derived Document Group",
      expectedValue: ma?.expectedDerivedDocumentGroup ?? null,
      basis: ma?.expectedDerivedDocumentGroup
        ? "observed_portal_classification"
        : "unknown",
    });

    if (draft?.mappingEvidence) {
      validationTargets.push({
        field: "Mapping Evidence Status",
        expectedValue: draft.mappingEvidence.confidence,
        basis: `${draft.mappingEvidence.source}${draft.mappingEvidence.observedAt ? ` (${draft.mappingEvidence.observedAt})` : ""}`,
      });
    }

    // ── Unresolved steps ────────────────────────────────────────
    if (!ma?.portalDocumentName) {
      unresolvedSteps.push("Portal document name not yet selected");
    }
    if (!ma?.stampOffice) {
      unresolvedSteps.push("Stamp office not yet set");
    }
    if (!ma?.instrumentDate) {
      unresolvedSteps.push("Instrument date not yet set");
    }
    if (!preparationSummary.declarationPrepared) {
      unresolvedSteps.push("Declaration (Perakuan) not yet prepared");
    }
    if (!preparationSummary.bahagianAFirstPartyPrepared ||
        !preparationSummary.bahagianASecondPartyPrepared) {
      unresolvedSteps.push(
        "Bahagian A party entry still depends on real identity/TIN flow"
      );
    }
    unresolvedSteps.push(
      "Lampiran (document uploads) not yet automated"
    );
    unresolvedSteps.push(
      "Additional portal submit checks may still apply"
    );

    notes.push("Preview compiled from portal draft + preparation inputs.");

  } else if (lane === "sewa_pajakan") {
    const ma = draft?.maklumatAmSewaPajakan;

    // ── Intended inputs ─────────────────────────────────────────
    intendedInputs.push({
      field: "Stamp Office (Pejabat Setem Negeri)",
      value: ma?.stampOffice ?? null,
      source: ma?.stampOffice ? "user_entered" : "not_set",
    });
    intendedInputs.push({
      field: "Instrument Date (Tarikh Surat Cara)",
      value: ma?.instrumentDate ?? null,
      source: ma?.instrumentDate ? "user_entered" : "not_set",
    });
    if (ma?.monthlyRent != null) {
      intendedInputs.push({
        field: "Monthly Rent (RM)",
        value: ma.monthlyRent,
        source: "stamping_details",
      });
    }
    if (ma?.leaseMonths != null) {
      intendedInputs.push({
        field: "Lease Duration (months)",
        value: ma.leaseMonths,
        source: "stamping_details",
      });
    }

    const ds = draft?.dutySummary;
    if (ds?.totalPayable != null) {
      validationTargets.push({
        field: "Expected Total Payable Duty",
        expectedValue: `RM ${ds.totalPayable.toFixed(2)}`,
        basis: "internal_calculation",
      });
    }

    if (!ma?.stampOffice) {
      unresolvedSteps.push("Stamp office not yet set");
    }
    if (!ma?.instrumentDate) {
      unresolvedSteps.push("Instrument date not yet set");
    }
    unresolvedSteps.push(
      "Hantar gates not yet proven for this lane"
    );
    unresolvedSteps.push(
      "Additional portal checks may still apply"
    );

    notes.push(
      "Limited preview — Hantar gates not yet independently proven for sewa_pajakan."
    );
  }

  // ── Status ────────────────────────────────────────────────────
  const profile = getLaneKnowledgeProfile(lane);
  const hasRequiredInputs = intendedInputs.some(
    (i) => i.value != null && i.value !== ""
  );
  const isLaneLimited = !profile.laneAutomationProven;

  let status: PortalExecutionPreviewStatus;
  if (isLaneLimited) {
    status = "limited";
  } else if (hasRequiredInputs && unresolvedSteps.length <= 2) {
    // Only Lampiran + additional checks remaining
    status = "preview_ready";
  } else {
    status = "incomplete";
  }

  return {
    status,
    lane,
    generatedAt: now,
    intendedInputs,
    validationTargets,
    preparationSummary,
    unresolvedSteps,
    notes,
  };
}
