/**
 * WeStamp — STSDS Portal Automation Plan Builder
 *
 * Converts an internal portal draft into a structured automation plan
 * representing "how WeStamp would drive the e-Duti Setem portal."
 *
 * This is a dry-run internal plan layer:
 * - Lane-specific action planning
 * - Expected portal validation checkpoints
 * - Stop/review rules for insufficient or uncertain data
 *
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT execute any browser automation.
 * Does NOT advance job status.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalAutomationPlan,
  PortalAutomationStep,
  PortalValidationCheckpoint,
  PortalStopReason,
  PortalLane,
  PortalAutomationPlanStatus,
} from "./stsds-types";
import { validatePortalDraft } from "./stsds-portal-draft";
import { PORTAL_FIELD_KEYS } from "./stsds-portal-schema";
import { getLaneKnowledgeProfile } from "./stsds-lane-knowledge";

/**
 * Build an internal automation plan from the current job state.
 *
 * Returns null only if the job has no routing suggestion at all.
 * Otherwise returns a plan — possibly with status "blocked" or
 * "review_required" if data is insufficient.
 *
 * @param job - The stamping job to build the plan from
 * @returns An automation plan, or null if no routing suggestion exists
 */
export function buildStsdsAutomationPlan(
  job: StampingJob
): PortalAutomationPlan | null {
  const routing = job.routingSuggestion;
  if (!routing) return null;

  const lane = routing.suggestedLane;
  const profile = getLaneKnowledgeProfile(lane);

  // Lanes without independently proven automation get a limited plan
  if (!profile.laneAutomationProven) {
    return buildUnprovenLanePlan(lane);
  }

  if (lane === "penyeteman_am") {
    return buildPenyetemanAmPlan(job);
  }

  return buildUnprovenLanePlan(lane);
}

// ─── Unproven Lane Plan ─────────────────────────────────────────────
// Returns a not_yet_proven state for any lane lacking independent proof.

function buildUnprovenLanePlan(lane: PortalLane): PortalAutomationPlan {
  const now = new Date().toISOString();

  return {
    status: "not_yet_proven",
    lane,
    createdAt: now,
    steps: [],
    validationCheckpoints: [],
    stopReasons: [],
    stepCount: 0,
    intendedValues: {},
  };
}

// ─── Penyeteman Am Plan ─────────────────────────────────────────────

function buildPenyetemanAmPlan(job: StampingJob): PortalAutomationPlan {
  const now = new Date().toISOString();
  const draft = job.portalDraft;
  const routing = job.routingSuggestion!;
  const am = draft?.maklumatAmPenyetemanAm;
  const steps: PortalAutomationStep[] = [];
  const checkpoints: PortalValidationCheckpoint[] = [];
  const stopReasons: PortalStopReason[] = [];
  let seq = 0;

  // Check preconditions
  if (!draft) {
    stopReasons.push("portal_draft_not_ready");
  } else {
    const validation = validatePortalDraft(draft);
    if (!validation.isComplete) {
      if (!am?.portalDocumentName?.trim()) stopReasons.push("portal_document_name_missing");
      if (!am?.stampOffice?.trim()) stopReasons.push("stamp_office_missing");
      if (!am?.instrumentDate?.trim()) stopReasons.push("instrument_date_missing");
    }
  }

  if (!am?.expectedDerivedDocumentGroup) {
    stopReasons.push("expected_derived_group_unknown");
  }

  if (routing.confidence === "low") {
    stopReasons.push("routing_confidence_low");
  }

  const hasBlockingStops = stopReasons.some(
    (r) =>
      r === "portal_draft_not_ready" ||
      r === "portal_document_name_missing" ||
      r === "stamp_office_missing" ||
      r === "instrument_date_missing"
  );

  // Step 1: Navigate to portal
  steps.push({
    seq: ++seq,
    type: "navigate",
    description: "Navigate to e-Duti Setem portal starting point",
    target: "e-Duti Setem home",
  });

  // Step 2: Go to application flow
  steps.push({
    seq: ++seq,
    type: "navigate",
    description: "Go to new application flow",
    target: "Permohonan Baharu",
  });

  // Step 3: Select penyeteman_am lane
  steps.push({
    seq: ++seq,
    type: "select_lane",
    description: "Select Penyetemen Am lane",
    target: "Portal Lane",
    intendedValue: "penyeteman_am",
  });

  // Step 4: Fill stamp office
  steps.push({
    seq: ++seq,
    type: "fill_input",
    description: "Set stamp office",
    target: "Pejabat Setem",
    fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
    intendedValue: am?.stampOffice ?? null,
    blocked: !am?.stampOffice?.trim(),
    blockReason: !am?.stampOffice?.trim() ? "Stamp office not set in portal draft" : undefined,
  });

  // Step 5: Fill instrument date
  steps.push({
    seq: ++seq,
    type: "fill_input",
    description: "Set instrument date",
    target: "Tarikh Surat Cara",
    fieldKey: PORTAL_FIELD_KEYS.INSTRUMENT_DATE,
    intendedValue: am?.instrumentDate ?? null,
    blocked: !am?.instrumentDate?.trim(),
    blockReason: !am?.instrumentDate?.trim() ? "Instrument date not set in portal draft" : undefined,
  });

  // Step 6: Fill received in Malaysia date (optional)
  if (am?.receivedInMalaysiaDate) {
    steps.push({
      seq: ++seq,
      type: "fill_input",
      description: "Set received in Malaysia date (signed abroad)",
      target: "Tarikh Diterima di Malaysia",
      fieldKey: PORTAL_FIELD_KEYS.RECEIVED_IN_MALAYSIA_DATE,
      intendedValue: am.receivedInMalaysiaDate,
    });
  }

  // Step 7: Select portal document name
  const docName = am?.portalDocumentName ?? null;
  steps.push({
    seq: ++seq,
    type: "select_document_name",
    description: "Select Portal Document Name (Nama Surat Cara)",
    target: "Nama Surat Cara",
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME,
    intendedValue: docName,
    blocked: !docName,
    blockReason: !docName ? "Portal document name not set" : undefined,
  });

  // Step 8: Wait for derived group to populate
  const expectedGroup = am?.expectedDerivedDocumentGroup ?? null;
  steps.push({
    seq: ++seq,
    type: "wait_for_derived_group",
    description: "Wait for Expected Derived Document Group to auto-populate",
    target: "Derived Document Group",
    fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
    intendedValue: expectedGroup,
  });

  // Step 9: Validate derived group matches expected
  steps.push({
    seq: ++seq,
    type: "validate_read_only_value",
    description: "Validate that derived document group matches expected value",
    target: "Derived Document Group",
    fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
    intendedValue: expectedGroup,
    blocked: false,
    blockReason: !expectedGroup
      ? "No expected derived group to validate — manual verification needed"
      : undefined,
  });

  // Step 10: Set editable instrument category if present
  const editCat = am?.editableInstrumentCategory ?? null;
  if (editCat) {
    steps.push({
      seq: ++seq,
      type: "fill_input",
      description: "Set Editable Instrument Category (Kategori Surat Cara)",
      target: "Kategori Surat Cara",
      fieldKey: PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY,
      intendedValue: editCat,
    });
  }

  // Step 11: Save Maklumat Am
  steps.push({
    seq: ++seq,
    type: "save_draft_step",
    description: "Save Maklumat Am section",
    target: "Maklumat Am",
    blocked: hasBlockingStops,
    blockReason: hasBlockingStops ? "Required fields missing — cannot save" : undefined,
  });

  // Step 12: Stop for review if needed, or continue
  if (stopReasons.length > 0 && !hasBlockingStops) {
    steps.push({
      seq: ++seq,
      type: "stop_for_review",
      description: "Stop for internal review before proceeding to later tabs",
      blocked: false,
      blockReason: "Non-blocking review items present",
    });
  } else {
    steps.push({
      seq: ++seq,
      type: "continue_to_next_tab",
      description: "Prepare to continue to later portal tabs",
      target: "Next portal section",
      blocked: hasBlockingStops,
      blockReason: hasBlockingStops ? "Cannot continue — preceding steps incomplete" : undefined,
    });
  }

  // ── Execution-level stop reasons (derived from lane knowledge profile) ──
  const profile = getLaneKnowledgeProfile("penyeteman_am");
  if (!profile.liveExecutionEnabled) {
    stopReasons.push("live_execution_not_enabled");
  }
  if (profile.partyEntryFrozen) {
    stopReasons.push("bahagian_a_identity_flow_frozen");
  }
  stopReasons.push("lampiran_upload_not_automated");
  stopReasons.push("hantar_automation_not_implemented");

  // ── Known later portal sections (proven accessible, not yet automated) ──
  // These are NOT blocked by preceding sections — live exploration proved
  // they are independently accessible even with empty Bahagian A.

  steps.push({
    seq: ++seq,
    type: "stop_for_review",
    description: "Bahagian A: party entry — requires real identity/TIN flow (currently frozen)",
    target: "Bahagian A",
    blocked: profile.partyEntryFrozen,
    blockReason: profile.partyEntryFrozen
      ? "Party entry depends on identity/TIN workflow that remains frozen"
      : undefined,
  });

  steps.push({
    seq: ++seq,
    type: "continue_to_next_tab",
    description: profile.bahagianBAccessibleWithEmptyA === "proven"
      ? "Bahagian B: instrument details — proven accessible independently"
      : "Bahagian B: instrument details",
    target: "Bahagian B",
  });

  steps.push({
    seq: ++seq,
    type: "continue_to_next_tab",
    description: profile.rumusanAccessible === "proven"
      ? "Rumusan Pengiraan: duty calculation — proven accessible and auto-calculates"
      : "Rumusan Pengiraan: duty calculation",
    target: "Rumusan Pengiraan",
  });

  steps.push({
    seq: ++seq,
    type: "stop_for_review",
    description: "Lampiran: document uploads — not yet automated",
    target: "Lampiran",
    blocked: true,
    blockReason: "Upload automation not yet implemented",
  });

  steps.push({
    seq: ++seq,
    type: "stop_for_review",
    description: "Perakuan / Hantar: declaration and submit — not yet automated",
    target: "Perakuan / Hantar",
    blocked: true,
    blockReason: "Final Hantar automation not yet implemented",
  });

  // Validation checkpoints
  checkpoints.push({
    description: "Selected lane must be Penyetemen Am",
    field: "Portal Lane",
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION,
    expectedValue: "penyeteman_am",
    severity: "required",
  });

  if (docName) {
    checkpoints.push({
      description: "Selected portal document name must match intended document",
      field: "Nama Surat Cara",
      fieldKey: PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME,
      expectedValue: docName,
      severity: "required",
    });
  }

  if (expectedGroup) {
    checkpoints.push({
      description: "Actual portal-derived document group must equal expected derived group",
      field: "Derived Document Group",
      fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
      expectedValue: expectedGroup,
      severity: "required",
    });
  } else {
    checkpoints.push({
      description: "Derived document group is unknown — manual verification required after selection",
      field: "Derived Document Group",
      fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
      expectedValue: null,
      severity: "advisory",
    });
  }

  if (am?.stampOffice) {
    checkpoints.push({
      description: "Stamp office must match intended value",
      field: "Pejabat Setem",
      fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
      expectedValue: am.stampOffice,
      severity: "required",
    });
  }

  if (editCat) {
    checkpoints.push({
      description: "Editable instrument category must match intended value",
      field: "Kategori Surat Cara",
      fieldKey: PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY,
      expectedValue: editCat,
      severity: "advisory",
    });
  }

  const status = resolveStatus(stopReasons, hasBlockingStops);

  return {
    status,
    lane: "penyeteman_am",
    createdAt: now,
    steps,
    validationCheckpoints: checkpoints,
    stopReasons,
    stepCount: steps.length,
    intendedValues: {
      portalDocumentName: docName,
      expectedDerivedDocumentGroup: expectedGroup,
      editableInstrumentCategory: editCat,
      stampOffice: am?.stampOffice ?? null,
      instrumentDate: am?.instrumentDate ?? null,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function resolveStatus(
  stopReasons: PortalStopReason[],
  hasBlockingStops: boolean
): PortalAutomationPlanStatus {
  if (stopReasons.length === 0) return "ready_for_review";
  if (hasBlockingStops) return "blocked";
  return "review_required";
}
