/**
 * WeStamp — STSDS Browser-Automation Adapter Contract Compiler
 *
 * Transforms the existing automation plan + portal schema into a
 * deterministic set of browser-automation instructions for a future driver.
 *
 * This is the adapter contract layer:
 * - Consumes the automation plan step sequence
 * - Resolves schema-backed targets via the portal schema
 * - Resolves field values from the portal draft
 * - Carries preconditions and expectations per instruction
 * - Produces a stable instruction contract for a future browser driver
 *
 * Does NOT import Playwright/Puppeteer.
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT execute any browser automation.
 * Does NOT advance job status.
 */

import { StampingJob } from "./stamping-types";
import {
  BrowserAutomationInstructionSet,
  BrowserAutomationInstructionSetStatus,
  BrowserAutomationInstruction,
  BrowserAutomationInstructionType,
  BrowserAutomationTarget,
  BrowserAutomationPayload,
  BrowserAutomationPrecondition,
  BrowserAutomationExpectation,
  PortalAutomationStep,
} from "./stsds-types";
import { getFieldSchema, PORTAL_FIELD_KEYS } from "./stsds-portal-schema";

/**
 * Compile a browser-automation instruction set from the current job state.
 *
 * Returns null only if there is no routing suggestion (lane cannot be
 * determined). Otherwise always returns a set — possibly with status
 * "not_ready" or "blocked" if prerequisites are missing.
 *
 * @param job - The stamping job to compile instructions for
 * @returns A compiled instruction set, or null if lane unknown
 */
export function compileStsdsBrowserInstructions(
  job: StampingJob
): BrowserAutomationInstructionSet | null {
  if (!job.routingSuggestion) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const now = new Date().toISOString();

  // Short-circuit: no automation plan
  if (!job.automationPlan) {
    return blockedSet(lane, now, ["Automation plan has not been generated yet."]);
  }

  // Short-circuit: no portal draft
  if (!job.portalDraft) {
    return blockedSet(lane, now, ["Portal draft has not been created yet."]);
  }

  // Short-circuit: plan is not yet proven for this lane
  if (job.automationPlan.status === "not_yet_proven") {
    const advisoryNotes: string[] = lane === "sewa_pajakan"
      ? [
          "Browser instruction set not yet compiled for sewa_pajakan. Live gate-chain walk (2026-04-22) proved MA→P5 advance, Hantar gate 1 (pds_suratcara required), and Hantar gate 2 (pds_alamat_1 — Alamat Harta di Bahagian C — required). The end-to-end instruction chain has not been authored.",
          "Known required P5 fields per Hantar :invalid evidence: pds_suratcara, pds_jenis, pds_alamat_1, pds_poskod, pds_city, pds_harta_state, pds_harta_type, pds_floor, pds_mp, pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim, pds_daerah, pds_luas, par_id. Observed gate order so far: pds_suratcara → pds_alamat_1; ordering of the remaining 14 fields beyond pds_alamat_1 not yet enumerated.",
          "Harta detail fields live on Bahagian C (per gate 2 modal 'Sila masukkan Alamat Harta di Bahagian C terlebih dahulu'), not Bahagian B.",
          "pds_jenis is NOT auto-populated by pds_suratcara — options are static (7 options present pre- and post-pds_suratcara selection).",
        ]
      : [
          "Browser instruction set not yet independently proven for this lane.",
        ];
    return {
      status: "not_yet_proven",
      lane,
      compiledAt: now,
      instructions: [],
      instructionCount: 0,
      blockedReasons: [],
      advisoryNotes,
    };
  }

  // Short-circuit: plan is blocked
  if (job.automationPlan.status === "blocked") {
    return blockedSet(
      lane,
      now,
      job.automationPlan.stopReasons.map((r) =>
        r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      )
    );
  }

  const plan = job.automationPlan;
  const draft = job.portalDraft;
  const instructions: BrowserAutomationInstruction[] = [];
  const blockedReasons: string[] = [];
  const advisoryNotes: string[] = [];
  const knownLaterSurfaces: string[] = [];

  let navigateCount = 0;
  let reachedStopBoundary = false;

  for (const step of plan.steps) {
    // Once we hit a blocked stop_for_review, everything after is a
    // known later surface, not an executable instruction.
    if (reachedStopBoundary) {
      knownLaterSurfaces.push(step.description);
      continue;
    }

    // A blocked stop_for_review marks the executable stop boundary.
    if (step.type === "stop_for_review" && step.blocked) {
      // Record the stop reason but do NOT add as an executable instruction.
      if (step.blockReason) {
        advisoryNotes.push(step.blockReason);
      }
      reachedStopBoundary = true;
      // Collect this step's description as the first known later surface
      knownLaterSurfaces.push(step.description);
      continue;
    }

    const instruction = compileStep(step, job, navigateCount);

    if (step.type === "navigate") navigateCount++;

    if (instruction.blocked && instruction.blockReason) {
      blockedReasons.push(instruction.blockReason);
    }
    if (instruction.isAdvisory) {
      advisoryNotes.push(instruction.description);
    }

    instructions.push(instruction);
  }

  const hasBlocked = instructions.some((i) => i.blocked && !i.isAdvisory);
  const hasAdvisory = advisoryNotes.length > 0;

  let status: BrowserAutomationInstructionSetStatus;
  if (hasBlocked) {
    status = "blocked";
  } else if (hasAdvisory || plan.status === "review_required") {
    status = "review_required";
  } else {
    status = "ready_for_internal_review";
  }

  return {
    status,
    lane,
    compiledAt: now,
    instructions,
    instructionCount: instructions.length,
    blockedReasons,
    advisoryNotes,
    knownLaterSurfaces: knownLaterSurfaces.length > 0 ? knownLaterSurfaces : undefined,
  };
}

// ─── Step Compiler ───────────────────────────────────────────────────

function compileStep(
  step: PortalAutomationStep,
  job: StampingJob,
  navigateCount: number
): BrowserAutomationInstruction {
  const lane = job.routingSuggestion!.suggestedLane;
  const draft = job.portalDraft!;

  switch (step.type) {
    case "navigate":
      return compileNavigate(step, navigateCount);

    case "select_lane":
      return compileSelectLane(step, lane);

    case "fill_input":
      return compileFillField(step, job);

    case "select_document_name":
      return compileSelectDocumentName(step, job);

    case "wait_for_derived_group":
      return compileWaitForDerivedGroup(step, job);

    case "validate_read_only_value":
      return compileAssertReadOnlyValue(step, job);

    case "save_draft_step":
      return compileSaveSection(step);

    case "continue_to_next_tab":
      return compileContinueToTab(step);

    case "stop_for_review":
      return compileStopForReview(step);

    default:
      return {
        seq: step.seq,
        type: "navigate_to_page",
        description: step.description,
        preconditions: [],
        expectations: [],
        blocked: false,
      };
  }
}

// ─── Individual Instruction Compilers ───────────────────────────────

function compileNavigate(
  step: PortalAutomationStep,
  navigateCount: number
): BrowserAutomationInstruction {
  const type: BrowserAutomationInstructionType =
    navigateCount === 0 ? "navigate_to_page" : "open_application_flow";

  return {
    seq: step.seq,
    type,
    description: step.description,
    target: { tabKey: "dashboard" },
    preconditions: [],
    expectations: [],
    blocked: false,
  };
}

function compileSelectLane(
  step: PortalAutomationStep,
  lane: string
): BrowserAutomationInstruction {
  const schemaTarget = buildTarget(null, PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION, lane, undefined);

  return {
    seq: step.seq,
    type: "select_lane",
    description: step.description,
    target: schemaTarget,
    payload: {
      value: step.intendedValue as string ?? lane,
      source: "routing_suggestion",
    },
    preconditions: [
      {
        description: "Portal lane selection page is accessible",
        met: true,
      },
    ],
    expectations: [
      {
        description: `Portal lane should be set to ${lane}`,
        expectedValue: step.intendedValue as string ?? lane,
      },
    ],
    blocked: false,
  };
}

function compileFillField(
  step: PortalAutomationStep,
  job: StampingJob
): BrowserAutomationInstruction {
  const lane = job.routingSuggestion!.suggestedLane;
  const fieldKey = step.fieldKey;
  const fieldSchema = fieldKey ? getFieldSchema(lane, fieldKey) : null;

  const target: BrowserAutomationTarget | undefined = fieldKey
    ? buildTarget(fieldSchema, fieldKey, lane, fieldSchema?.portalLabel)
    : undefined;

  const value = step.intendedValue ?? null;
  const valuePresent = value !== null && value !== undefined && String(value).trim() !== "";

  const preconditions: BrowserAutomationPrecondition[] = [
    {
      description: `Field value for "${fieldSchema?.label ?? step.target}" must be set in portal draft`,
      met: valuePresent,
      reason: valuePresent ? undefined : `No value available for ${fieldKey ?? step.target}`,
    },
  ];

  return {
    seq: step.seq,
    type: "fill_field",
    description: step.description,
    target,
    payload: {
      value: value as string | number | null,
      source: "portal_draft",
    },
    preconditions,
    expectations: valuePresent
      ? [
          {
            description: `Field "${fieldSchema?.portalLabel ?? step.target}" should display the entered value`,
            expectedValue: String(value),
          },
        ]
      : [],
    blocked: step.blocked ?? false,
    blockReason: step.blockReason,
  };
}

function compileSelectDocumentName(
  step: PortalAutomationStep,
  job: StampingJob
): BrowserAutomationInstruction {
  const lane = job.routingSuggestion!.suggestedLane;
  const fieldKey = PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME;
  const fieldSchema = getFieldSchema(lane, fieldKey);
  const docName = step.intendedValue as string | null ?? null;
  const hasDocName = !!docName;

  return {
    seq: step.seq,
    type: "select_dropdown_option",
    description: step.description,
    target: buildTarget(fieldSchema, fieldKey, lane, fieldSchema?.portalLabel),
    payload: {
      value: docName,
      source: "portal_draft",
    },
    preconditions: [
      {
        description: "Portal document name (Nama Surat Cara) must be set in portal draft",
        met: hasDocName,
        reason: hasDocName ? undefined : "Portal document name is not set",
      },
    ],
    expectations: hasDocName
      ? [
          {
            description: "Selected Nama Surat Cara must match intended document",
            expectedValue: docName,
          },
          {
            description: "Portal will auto-populate Derived Document Group after selection",
            expectedValue: null,
          },
        ]
      : [],
    blocked: step.blocked ?? false,
    blockReason: step.blockReason,
  };
}

function compileWaitForDerivedGroup(
  step: PortalAutomationStep,
  job: StampingJob
): BrowserAutomationInstruction {
  const lane = job.routingSuggestion!.suggestedLane;
  const fieldKey = PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP;
  const fieldSchema = getFieldSchema(lane, fieldKey);
  const expectedGroup = step.intendedValue as string | null ?? null;

  return {
    seq: step.seq,
    type: "wait_for_read_only_value",
    description: step.description,
    target: buildTarget(fieldSchema, fieldKey, lane, fieldSchema?.portalLabel),
    payload: {
      value: null,
      source: "none",
    },
    preconditions: [
      {
        description: "Portal document name must have been selected in the preceding step",
        met: !!(job.portalDraft?.maklumatAmPenyetemanAm?.portalDocumentName),
        reason: "Derived group only appears after Nama Surat Cara selection",
      },
    ],
    expectations: [
      {
        description: "Derived Document Group field should become populated",
        expectedValue: expectedGroup,
      },
    ],
    blocked: false,
    blockReason: !expectedGroup
      ? "Expected derived group is unknown — cannot assert a specific value"
      : undefined,
  };
}

function compileAssertReadOnlyValue(
  step: PortalAutomationStep,
  job: StampingJob
): BrowserAutomationInstruction {
  const lane = job.routingSuggestion!.suggestedLane;
  const fieldKey = PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP;
  const fieldSchema = getFieldSchema(lane, fieldKey);
  const expectedGroup = step.intendedValue as string | null ?? null;
  const canAssert = !!expectedGroup;

  return {
    seq: step.seq,
    type: "assert_read_only_value",
    description: step.description,
    target: buildTarget(fieldSchema, fieldKey, lane, fieldSchema?.portalLabel),
    payload: {
      value: expectedGroup,
      source: "portal_draft",
    },
    preconditions: [
      {
        description: "Derived Document Group must have populated (wait step must complete first)",
        met: true,
      },
      {
        description: "Expected derived group must be known in order to assert a match",
        met: canAssert,
        reason: canAssert ? undefined : "Expected derived group is unknown — assertion not possible",
      },
    ],
    expectations: canAssert
      ? [
          {
            description: "Portal Derived Document Group must equal expected value — stop if mismatch",
            expectedValue: expectedGroup,
          },
        ]
      : [
          {
            description: "Derived Document Group value should be noted for manual verification",
            expectedValue: null,
          },
        ],
    blocked: false,
    isAdvisory: !canAssert,
    blockReason: undefined,
  };
}

function compileSaveSection(
  step: PortalAutomationStep
): BrowserAutomationInstruction {
  return {
    seq: step.seq,
    type: "save_current_section",
    description: step.description,
    target: { tabKey: "maklumat_am", portalLabel: "Maklumat Am" },
    preconditions: [
      {
        description: "All required Maklumat Am fields must be filled before saving",
        met: !(step.blocked),
        reason: step.blocked ? step.blockReason : undefined,
      },
    ],
    expectations: [
      {
        description: "Section should save without portal-side validation errors",
        expectedValue: null,
      },
    ],
    blocked: step.blocked ?? false,
    blockReason: step.blockReason,
  };
}

function compileContinueToTab(
  step: PortalAutomationStep
): BrowserAutomationInstruction {
  return {
    seq: step.seq,
    type: "continue_to_tab",
    description: step.description,
    target: { tabKey: "bahagian_a" },
    preconditions: [
      {
        description: "Maklumat Am section must be saved before continuing",
        met: !(step.blocked),
        reason: step.blocked ? step.blockReason : undefined,
      },
    ],
    expectations: [
      {
        description: "Next portal tab should become active",
        expectedValue: null,
      },
    ],
    blocked: step.blocked ?? false,
    blockReason: step.blockReason,
  };
}

function compileStopForReview(
  step: PortalAutomationStep
): BrowserAutomationInstruction {
  return {
    seq: step.seq,
    type: "stop_for_review",
    description: step.description,
    preconditions: [],
    expectations: [],
    blocked: false,
    isAdvisory: true,
    blockReason: undefined,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildTarget(
  fieldSchema: ReturnType<typeof getFieldSchema>,
  fieldKey: string,
  _lane: string,
  portalLabel?: string
): BrowserAutomationTarget {
  return {
    fieldKey,
    tabKey: fieldSchema?.tab,
    portalLabel: portalLabel ?? fieldSchema?.portalLabel,
    selectorHint: fieldSchema
      ? {
          labelText: fieldSchema.selectorHint.labelText,
          inputType: fieldSchema.selectorHint.inputType,
          interactionType: fieldSchema.selectorHint.interactionType,
        }
      : undefined,
    mode: fieldSchema?.mode,
  };
}

function blockedSet(
  lane: BrowserAutomationInstructionSet["lane"],
  compiledAt: string,
  blockedReasons: string[]
): BrowserAutomationInstructionSet {
  return {
    status: "not_ready",
    lane,
    compiledAt,
    instructions: [],
    instructionCount: 0,
    blockedReasons,
    advisoryNotes: [],
  };
}
