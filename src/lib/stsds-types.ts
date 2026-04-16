/**
 * WeStamp — STSDS Portal Types
 *
 * Domain types for the e-Duti Setem portal: document catalogue,
 * portal lane routing, internal portal drafts, and mapping evidence.
 *
 * The portal exposes:
 * - Distinct lanes (sewa_pajakan, penyeteman_am)
 * - Under penyeteman_am, a searchable "Nama Surat Cara" dropdown
 * - After selection, a read-only greyed-out derived document group/family
 * - A separate editable "Kategori Surat Cara" field
 *
 * These three concepts (document name, derived group, editable category)
 * are explicitly modelled as SEPARATE fields throughout this file.
 *
 * None of this triggers live portal automation.
 * All data is draft/suggestion-level and unverified unless stated otherwise.
 */

// ─── Portal Lanes ───────────────────────────────────────────────────

/**
 * The two primary portal lanes in e-Duti Setem that WeStamp targets.
 */
export type PortalLane = "sewa_pajakan" | "penyeteman_am";

export const PORTAL_LANE_LABELS: Record<PortalLane, string> = {
  sewa_pajakan: "Sewa / Pajakan (Lease / Tenancy)",
  penyeteman_am: "Penyetemen Am (General Stamping)",
};

// ─── Stamp Office ───────────────────────────────────────────────────

/**
 * Known LHDN stamp offices selectable in the portal.
 * This is a starter subset — more offices can be added as observed.
 */
export type StampOffice =
  | "Kuala Lumpur"
  | "Petaling Jaya"
  | "Shah Alam"
  | "Putrajaya"
  | "Johor Bahru"
  | "George Town"
  | "Kota Kinabalu"
  | "Kuching";

export const STAMP_OFFICES: StampOffice[] = [
  "Kuala Lumpur",
  "Petaling Jaya",
  "Shah Alam",
  "Putrajaya",
  "Johor Bahru",
  "George Town",
  "Kota Kinabalu",
  "Kuching",
];

// ─── Portal Draft Status ────────────────────────────────────────────

/**
 * Status of the internal portal draft.
 * - draft: assembled from available job data, not submitted
 * - ready_for_review: all required fields populated, awaiting user review
 */
export type PortalDraftStatus = "draft" | "ready_for_review";

/**
 * How the portal draft was assembled.
 * - auto_from_job: built from existing job data (routing suggestion, stamping details)
 * - manual_entry: user manually provided values in the portal draft UI
 */
export type PortalDraftSource = "auto_from_job" | "manual_entry";

// ─── Observed Mapping Evidence ──────────────────────────────────────

/**
 * How confident we are in the portal mapping for a catalogue item.
 * - observed: all three fields (derived group, editable category) confirmed
 *             from real portal screenshots/observations
 * - partial: some fields observed, others unknown
 * - unknown: no portal observation available
 */
export type ObservedMappingConfidence = "observed" | "partial" | "unknown";

/**
 * Source of the mapping evidence.
 * - portal_screenshot: observed from an e-Duti Setem screenshot
 * - portal_interaction: observed from direct portal interaction
 * - assumed: inferred without direct evidence (use sparingly)
 */
export type ObservedMappingEvidenceSource =
  | "portal_screenshot"
  | "portal_interaction"
  | "live_p8_verification"
  | "live_p5_observation"
  | "assumed";

/**
 * Evidence metadata for a catalogue item's portal mapping.
 */
export interface ObservedMappingEvidence {
  /** Confidence level in this mapping. */
  confidence: ObservedMappingConfidence;
  /** How the mapping was obtained. */
  source: ObservedMappingEvidenceSource;
  /** When the mapping was observed (approximate, e.g. "2025-03"). */
  observedAt?: string;
  /** Free-text note about the evidence. */
  note?: string;
}

// ─── Catalogue Item ─────────────────────────────────────────────────

/**
 * A single entry in the STSDS document catalogue.
 *
 * Represents a "Nama Surat Cara" (instrument name) selectable in the portal.
 *
 * Three distinct portal concepts are tracked per item:
 * 1. portalDocumentName — the exact selectable name (Nama Surat Cara)
 * 2. expectedDerivedDocumentGroup — the read-only greyed-out group/family
 *    that the portal auto-assigns after selection
 * 3. observedEditableInstrumentCategory — the separate editable
 *    "Kategori Surat Cara" field observed in the portal
 *
 * These are NEVER conflated into a single field.
 */
export interface StsdsDocumentCatalogueItem {
  /** Unique internal ID for this catalogue entry. */
  id: string;
  /** Which portal lane this instrument belongs to. */
  portalLane: PortalLane;
  /**
   * The exact instrument name as shown in the portal dropdown.
   * For penyeteman_am: this is the "Nama Surat Cara" value.
   * For sewa_pajakan: a representative name for the tenancy lane.
   */
  portalDocumentName: string;
  /**
   * The read-only derived document group/family that the portal
   * auto-assigns after this instrument is selected.
   * This is the greyed-out field — NOT the editable category.
   * null = not yet observed / unknown.
   */
  expectedDerivedDocumentGroup: string | null;
  /**
   * The observed value of the editable "Kategori Surat Cara" field
   * as seen in the portal for this instrument.
   * This is a SEPARATE field from the derived group above.
   * null = not yet observed / unknown.
   */
  observedEditableInstrumentCategory: string | null;
  /**
   * Normalized lowercase version of portalDocumentName for search.
   */
  normalizedName: string;
  /**
   * Alternative names, abbreviations, or common phrasings.
   * Stored normalized (lowercase, trimmed).
   */
  aliases: string[];
  /**
   * Whether WeStamp has a planned automation path for this instrument.
   */
  supportedForAutomation: boolean;
  /**
   * Mapping evidence metadata. Tracks how confident we are in the
   * derived group and editable category values.
   */
  mappingEvidence: ObservedMappingEvidence;
  /** Optional notes for internal reference. */
  notes?: string;
}

// ─── Search Result ──────────────────────────────────────────────────

export type SearchMatchType =
  | "exact"
  | "prefix"
  | "contains"
  | "token_overlap"
  | "alias";

export interface StsdsSearchResult {
  item: StsdsDocumentCatalogueItem;
  matchType: SearchMatchType;
  score: number;
}

// ─── Routing Suggestion ─────────────────────────────────────────────

/**
 * A suggestion-level routing recommendation for a stamping job.
 * NOT a confirmed submission target.
 */
export interface StsdsRoutingSuggestion {
  suggestedLane: PortalLane;
  suggestedPortalDocumentName: string | null;
  expectedDerivedDocumentGroup: string | null;
  observedEditableInstrumentCategory: string | null;
  source: "category_match" | "catalogue_search";
  confidence: "high" | "medium" | "low";
  suggestedAt: string;
}

// ─── Maklumat Am (General Information) ──────────────────────────────

/**
 * Common "Maklumat Am" (General Information) fields observed in the portal.
 * These are present in both sewa_pajakan and penyeteman_am lanes.
 */
export interface MaklumatAmCommon {
  /** Selected stamp office. Free text — not restricted to known offices. */
  stampOffice?: string;
  /** Date of the instrument (agreement date). ISO 8601 date string. */
  instrumentDate?: string;
  /**
   * Date instrument was received in Malaysia, if signed abroad.
   * ISO 8601 date string. null if not applicable.
   */
  receivedInMalaysiaDate?: string | null;
}

/**
 * Penyeteman Am lane-specific Maklumat Am fields.
 * Extends the common fields with the document name/category fields.
 */
export interface MaklumatAmPenyetemanAm extends MaklumatAmCommon {
  /** The selected "Nama Surat Cara" from the portal dropdown. */
  portalDocumentName: string;
  /**
   * The portal-derived read-only document group/family.
   * Greyed-out, auto-assigned by the portal after document selection.
   */
  expectedDerivedDocumentGroup: string | null;
  /**
   * The editable "Kategori Surat Cara" field.
   * Separate from the derived group above.
   */
  editableInstrumentCategory: string | null;
}

/**
 * Sewa/Pajakan lane-specific Maklumat Am fields.
 * Tenancy uses its own dedicated lane — no Nama Surat Cara dropdown.
 */
export interface MaklumatAmSewaPajakan extends MaklumatAmCommon {
  /** Monthly rent in RM (from stamping details). */
  monthlyRent?: number;
  /** Lease duration in months (from stamping details). */
  leaseMonths?: number;
}

// ─── Duty Summary Draft ─────────────────────────────────────────────

/**
 * Internal model for the duty summary that the portal displays.
 * Used for later readback validation — NOT computed by WeStamp.
 *
 * Only fields actually observed in portal screenshots are included.
 */
export interface PortalDraftDutySummary {
  /** Summary heading text as shown in the portal (e.g. "Ringkasan Duti"). */
  summaryHeading?: string;
  /** Payable duty amount in RM. */
  payableDuty?: number;
  /** Duplicate/copy stamp amount in RM, if applicable. */
  duplicateCopyAmount?: number;
  /** Penalty amount in RM, if shown. */
  penaltyAmount?: number;
  /** Total payable amount in RM. */
  totalPayable?: number;
}

// ─── Portal Draft ───────────────────────────────────────────────────

/**
 * Internal portal draft — "what WeStamp intends to put into the portal."
 *
 * This is NOT a submitted record. It is a draft assembled from existing
 * job data (routing suggestion, stamping details, extraction results).
 *
 * Separate from:
 * - extractionResult (unverified PDF extraction)
 * - stampingDetails (confirmed user-entered values)
 * - submissionPayload (machine-readable payload for future submission)
 *
 * The draft models lane-specific portal form data.
 */
export interface StsdsPortalDraft {
  /** Draft status. */
  status: PortalDraftStatus;
  /** How the draft was assembled. */
  source: PortalDraftSource;
  /** Which portal lane this draft targets. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this draft was created/updated. */
  draftedAt: string;

  /**
   * Maklumat Am data for penyeteman_am lane.
   * Only populated when lane = "penyeteman_am".
   */
  maklumatAmPenyetemanAm?: MaklumatAmPenyetemanAm;

  /**
   * Maklumat Am data for sewa_pajakan lane.
   * Only populated when lane = "sewa_pajakan".
   */
  maklumatAmSewaPajakan?: MaklumatAmSewaPajakan;

  /**
   * Duty summary draft (for later portal readback validation).
   * Populated from WeStamp's own duty calculation for tenancy,
   * or left empty for penyeteman_am until portal interaction occurs.
   */
  dutySummary?: PortalDraftDutySummary;

  /**
   * Mapping evidence for the selected document, if available.
   * Carried from the catalogue item to the draft for reference.
   */
  mappingEvidence?: ObservedMappingEvidence;
}

// ─── Portal Page Schema ─────────────────────────────────────────────

/**
 * Known tab/page keys in the e-Duti Setem portal.
 *
 * "shared" keys appear in entry/navigation before lane selection.
 * Lane-specific keys are prefixed by convention but stored flat here
 * since both lanes share several tab names.
 */
export type PortalTabKey =
  | "dashboard"
  | "application_entry"
  | "maklumat_am"
  | "bahagian_a"
  | "bahagian_b"
  | "bahagian_c"         // sewa_pajakan only
  | "rumusan_pengiraan"
  | "lampiran"
  | "perakuan";

/**
 * What kind of portal UI control a field uses.
 * "unknown" is used for tabs/sections not yet fully observed.
 */
export type PortalFieldKind =
  | "text_input"
  | "dropdown"
  | "date_input"
  | "radio"
  | "derived_display"    // auto-populated read-only display
  | "read_only_display"  // static read-only label
  | "currency_display"   // read-only currency value
  | "unknown";

/**
 * Whether a portal field is editable, purely read-only, or derived
 * (auto-populated by the portal after another field is set).
 */
export type PortalFieldMode = "editable" | "read_only" | "derived";

/**
 * Grounded selector/config hints for later browser-automation use.
 * Does NOT contain Playwright/Puppeteer code or live CSS selectors.
 * Records what was observed about each field for planning purposes.
 */
export interface PortalSelectorHint {
  /** The label text as observed in the portal UI. */
  labelText: string;
  /** The type of input control observed. */
  inputType: "text" | "select" | "date" | "display";
  /** Whether this field must be filled for automation to proceed. */
  isRequired: boolean;
  /**
   * How automation would interact with this field:
   * - type: type a value into a text or date input
   * - select: choose from a dropdown
   * - read_back: read the current displayed value
   * - validate: compare the displayed value against an expected value
   * - observe: note the value without asserting correctness
   */
  interactionType: "type" | "select" | "read_back" | "validate" | "observe";
  /** Placeholder text observed in the input, if any. */
  placeholderText?: string;
  /** Approximate date this field was observed in the portal. */
  observedAt?: string;
}

/**
 * Schema for a single known portal field.
 */
export interface PortalFieldSchema {
  /**
   * Stable internal identifier for this field.
   * Used to link automation plan steps to schema entries.
   */
  fieldKey: string;
  /** Which portal tab this field belongs to. */
  tab: PortalTabKey;
  /** Which lane this field applies to. "shared" = both lanes. */
  lane: PortalLane | "shared";
  /** Whether the field is editable, read-only, or portal-derived. */
  mode: PortalFieldMode;
  /** What kind of UI control this field uses. */
  kind: PortalFieldKind;
  /** Human-readable internal label for this field. */
  label: string;
  /** The exact label text as shown in the portal (Malay). */
  portalLabel: string;
  /** Selector/config hints for later automation. */
  selectorHint: PortalSelectorHint;
  /**
   * Whether this schema entry is grounded in direct portal observation.
   * false = placeholder entry for a tab/field not yet fully observed.
   */
  isKnown: boolean;
  /** Internal notes about this field. */
  notes?: string;
}

/**
 * Schema for a single portal tab/page.
 */
export interface PortalPageSchema {
  /** Stable tab key. */
  tabKey: PortalTabKey;
  /** Human-readable tab label as shown in the portal. */
  tabLabel: string;
  /** Which lane this tab belongs to. "shared" = both lanes. */
  lane: PortalLane | "shared";
  /** Ordered list of known fields on this tab. */
  fields: PortalFieldSchema[];
  /**
   * Whether all fields on this tab have been observed and fully mapped.
   * false = some fields are placeholder/unknown.
   */
  isFullyMapped: boolean;
  /** Notes about what has been observed for this tab. */
  observationNote?: string;
}

/**
 * A single entry in the portal readback schema.
 * Describes a value WeStamp expects to be able to read/validate
 * from the portal after interaction.
 */
export interface PortalReadbackEntry {
  /** Reference to the field schema key being read back. */
  fieldKey: string;
  /** Which tab the value appears on. */
  tab: PortalTabKey;
  /** Human-readable description of what is being read. */
  description: string;
  /**
   * How the readback value should be compared to the intended value:
   * - exact_match: portal value must exactly equal expected value
   * - contains: portal value must contain expected value
   * - numeric_match: numeric comparison (e.g. duty amounts)
   * - observe_only: note the value without asserting correctness
   */
  readbackType: "exact_match" | "contains" | "numeric_match" | "observe_only";
  /** Whether this readback is a hard validation target for automation. */
  isValidationTarget: boolean;
}

/**
 * Full readback schema for a portal lane.
 * Describes all values WeStamp intends to validate after portal interaction.
 */
export interface PortalReadbackSchema {
  /** Which lane this readback schema applies to. */
  lane: PortalLane;
  /** Ordered readback entries. */
  entries: PortalReadbackEntry[];
}

// ─── Portal Automation Plan ────────────────────────────────────────

/**
 * Status of the internal automation plan.
 * - not_ready: insufficient data to produce a runnable plan
 * - ready_for_review: plan is complete and awaits internal review
 * - review_required: plan was built but has stops/warnings requiring attention
 * - blocked: plan cannot proceed due to missing data or unsupported conditions
 */
export type PortalAutomationPlanStatus =
  | "not_ready"
  | "ready_for_review"
  | "review_required"
  | "blocked"
  | "not_yet_proven";

/**
 * Step types that model distinct portal interactions.
 * These are business-level actions, NOT browser-driver commands.
 */
export type PortalAutomationStepType =
  | "navigate"
  | "select_lane"
  | "fill_input"
  | "select_document_name"
  | "wait_for_derived_group"
  | "validate_read_only_value"
  | "save_draft_step"
  | "continue_to_next_tab"
  | "stop_for_review";

/**
 * A single step in the automation plan.
 */
export interface PortalAutomationStep {
  /** Step sequence number (1-based). */
  seq: number;
  /** The type of portal interaction this step represents. */
  type: PortalAutomationStepType;
  /** Human-readable description of what this step does. */
  description: string;
  /** The portal field or target this step acts on, if applicable. */
  target?: string;
  /**
   * Optional reference to a PortalFieldSchema.fieldKey.
   * Links this step to the field schema for later selector resolution.
   */
  fieldKey?: string;
  /** The intended value to set or validate, if applicable. */
  intendedValue?: string | number | null;
  /**
   * Whether this step is blocked (missing data or stop condition).
   * If true, the plan cannot proceed past this step.
   */
  blocked?: boolean;
  /** Reason this step is blocked, if applicable. */
  blockReason?: string;
}

/**
 * A validation checkpoint embedded in the automation plan.
 * Represents an expected condition that must hold true during execution.
 */
export interface PortalValidationCheckpoint {
  /** Human-readable description of what is being validated. */
  description: string;
  /** The field or portal element being checked. */
  field: string;
  /**
   * Optional reference to a PortalFieldSchema.fieldKey.
   * Links this checkpoint to the field schema for later selector resolution.
   */
  fieldKey?: string;
  /** The expected value. null = no expectation available. */
  expectedValue: string | null;
  /**
   * Whether validation can proceed without this value.
   * - required: execution must stop if mismatch
   * - advisory: log warning but continue
   */
  severity: "required" | "advisory";
}

/**
 * Reason the automation plan is stopped or requires review.
 */
export type PortalStopReason =
  | "portal_draft_not_ready"
  | "routing_suggestion_missing"
  | "portal_document_name_missing"
  | "stamp_office_missing"
  | "instrument_date_missing"
  | "expected_derived_group_unknown"
  | "routing_confidence_low"
  | "unsupported_category"
  | "live_execution_not_enabled"
  | "bahagian_a_identity_flow_frozen"
  | "lampiran_upload_not_automated"
  | "hantar_automation_not_implemented";

/**
 * Internal automation plan — "how WeStamp would drive the portal."
 *
 * This is NOT an executed run. It is a structured internal plan
 * assembled from the portal draft and routing data.
 *
 * Separate from:
 * - portalDraft (the data to enter)
 * - submissionPayload (machine-readable payload for future submission)
 * - executionAttempt (placeholder for future live execution)
 */
export interface PortalAutomationPlan {
  /** Plan status. */
  status: PortalAutomationPlanStatus;
  /** Which portal lane this plan targets. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this plan was created/updated. */
  createdAt: string;
  /** Ordered list of planned portal interaction steps. */
  steps: PortalAutomationStep[];
  /** Validation checkpoints to verify during execution. */
  validationCheckpoints: PortalValidationCheckpoint[];
  /** Stop/review reasons, if any. Empty array = no stops. */
  stopReasons: PortalStopReason[];
  /** Total step count for quick display. */
  stepCount: number;
  /**
   * Key intended values for quick reference display.
   * Duplicated from steps for UI convenience.
   */
  intendedValues: {
    portalDocumentName?: string | null;
    expectedDerivedDocumentGroup?: string | null;
    editableInstrumentCategory?: string | null;
    stampOffice?: string | null;
    instrumentDate?: string | null;
  };
}

// ─── Portal Dry Run ────────────────────────────────────────────────

/**
 * Overall status of the internal dry-run evaluation.
 * - not_ready: automation plan or portal draft is missing
 * - ready_for_internal_review: all steps evaluable, no blocks or advisories
 * - review_required: evaluable but advisory/review items present
 * - blocked: one or more required steps cannot proceed
 */
export type PortalDryRunStatus =
  | "not_ready"
  | "ready_for_internal_review"
  | "review_required"
  | "blocked";

/**
 * Result status for a single dry-run step evaluation.
 * - ready: the step has all required data and is internally executable
 * - blocked: the step is missing required data and cannot proceed
 * - skipped: the step is a review gate (stop_for_review) — not an action step
 * - pending: not evaluated because a preceding required step is blocked
 */
export type PortalDryRunStepStatus =
  | "ready"
  | "blocked"
  | "skipped"
  | "pending";

/**
 * Result of evaluating a single plan step against current job data.
 */
export interface PortalDryRunStepResult {
  /** Matches the plan step sequence number. */
  seq: number;
  /** Step type from the plan. */
  stepType: string;
  /** Human-readable step description. */
  description: string;
  /** Schema field key this step targets, if applicable. */
  fieldKey?: string;
  /** Evaluation result for this step. */
  status: PortalDryRunStepStatus;
  /** Reason or note if blocked, skipped, or pending. */
  note?: string;
}

/**
 * Result status for a single dry-run checkpoint evaluation.
 * - ready: the checkpoint has an expected value and can be validated
 * - blocked: a required checkpoint has no expected value — validation impossible
 * - advisory: advisory checkpoint; cannot block execution
 */
export type PortalDryRunCheckpointStatus =
  | "ready"
  | "blocked"
  | "advisory";

/**
 * Result of evaluating a single validation checkpoint against current job data.
 */
export interface PortalDryRunCheckpointResult {
  /** Human-readable checkpoint description. */
  description: string;
  /** Schema field key this checkpoint targets, if applicable. */
  fieldKey?: string;
  /** The expected value this checkpoint will validate against. */
  expectedValue: string | null;
  /** Evaluation result for this checkpoint. */
  status: PortalDryRunCheckpointStatus;
  /** Reason or note if blocked or advisory. */
  note?: string;
}

/**
 * Aggregate counts from the dry-run evaluation.
 */
export interface PortalDryRunSummary {
  totalSteps: number;
  readySteps: number;
  blockedSteps: number;
  skippedSteps: number;
  pendingSteps: number;
  totalCheckpoints: number;
  readyCheckpoints: number;
  blockedCheckpoints: number;
  advisoryCheckpoints: number;
}

/**
 * Internal dry-run evaluation result — "WeStamp's current assessment of
 * whether it could later execute this automation plan on the portal."
 *
 * This is NOT an executed portal run. It evaluates the plan and schema
 * against current job data to determine internal readiness.
 *
 * Separate from:
 * - portalDraft (the data to enter)
 * - automationPlan (the plan of steps)
 * - submissionPayload (future submission payload)
 * - executionAttempt (future live execution placeholder)
 */
export interface PortalDryRun {
  /** Overall evaluation status. */
  status: PortalDryRunStatus;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this evaluation was performed. */
  evaluatedAt: string;
  /** Step-by-step evaluation results, ordered by seq. */
  stepResults: PortalDryRunStepResult[];
  /** Checkpoint evaluation results. */
  checkpointResults: PortalDryRunCheckpointResult[];
  /** Aggregate counts. */
  summary: PortalDryRunSummary;
  /**
   * Human-readable blocked reasons derived from the evaluation.
   * Empty if status is not blocked.
   */
  blockedReasons: string[];
  /**
   * Human-readable advisory notes from non-blocking issues.
   * Empty if no advisory items found.
   */
  advisoryNotes: string[];
}

// ─── Browser Automation Adapter Contract ────────────────────────────

/**
 * Status of the compiled browser-instruction set.
 * - not_ready: automation plan or portal draft is missing
 * - ready_for_internal_review: all instructions compiled with no blocks
 * - review_required: compiled but advisory or review-gate items present
 * - blocked: one or more required instructions cannot be compiled
 */
export type BrowserAutomationInstructionSetStatus =
  | "not_ready"
  | "ready_for_internal_review"
  | "review_required"
  | "blocked"
  | "not_yet_proven";

/**
 * Adapter-contract instruction types.
 * These map from internal plan step types to future browser-driver actions.
 * These are contract-level labels only — NOT Playwright/Puppeteer code.
 */
export type BrowserAutomationInstructionType =
  | "navigate_to_page"
  | "open_application_flow"
  | "select_lane"
  | "fill_field"
  | "select_dropdown_option"
  | "wait_for_read_only_value"
  | "assert_read_only_value"
  | "save_current_section"
  | "continue_to_tab"
  | "stop_for_review";

/**
 * Schema-backed target for a browser instruction.
 * Points to a known field/tab in the portal schema.
 */
export interface BrowserAutomationTarget {
  /** Reference to a PortalFieldSchema.fieldKey, if applicable. */
  fieldKey?: string;
  /** Reference to a PortalTabKey, if applicable. */
  tabKey?: string;
  /** The portal label as observed (Malay), for later driver reference. */
  portalLabel?: string;
  /**
   * Condensed selector/config hints from the field schema.
   * NOT a live CSS selector — a config hint for future driver wiring.
   */
  selectorHint?: {
    labelText: string;
    inputType: "text" | "select" | "date" | "display";
    interactionType: "type" | "select" | "read_back" | "validate" | "observe";
  };
  /** Field mode: editable, read_only, or derived. */
  mode?: PortalFieldMode;
}

/**
 * The value payload for an instruction.
 */
export interface BrowserAutomationPayload {
  /** The value a future driver should use. null = not available. */
  value: string | number | null;
  /** Where this value comes from in the internal data model. */
  source: "portal_draft" | "routing_suggestion" | "schema_default" | "none";
}

/**
 * A precondition that must hold before this instruction can execute.
 */
export interface BrowserAutomationPrecondition {
  /** Human-readable description of the condition. */
  description: string;
  /** Whether the condition is currently met given the job data. */
  met: boolean;
  /** Reason if not met. */
  reason?: string;
}

/**
 * An expectation of what should be true after this instruction executes.
 */
export interface BrowserAutomationExpectation {
  /** Human-readable description of what is expected. */
  description: string;
  /**
   * The expected value a future driver should observe.
   * null = expectation exists but value is unknown.
   */
  expectedValue: string | null;
}

/**
 * A single compiled browser-automation instruction.
 * Adapter-contract level — NOT executable browser code.
 */
export interface BrowserAutomationInstruction {
  /** Sequence number (1-based). */
  seq: number;
  /** Instruction type for future driver dispatch. */
  type: BrowserAutomationInstructionType;
  /** Human-readable description of what this instruction does. */
  description: string;
  /** Schema-backed target for this instruction, if applicable. */
  target?: BrowserAutomationTarget;
  /** Value payload for this instruction, if applicable. */
  payload?: BrowserAutomationPayload;
  /** Preconditions that must hold before this instruction executes. */
  preconditions: BrowserAutomationPrecondition[];
  /** Expectations of what should be true after this instruction executes. */
  expectations: BrowserAutomationExpectation[];
  /** Whether this instruction is blocked due to missing data. */
  blocked: boolean;
  /** Reason this instruction is blocked, if applicable. */
  blockReason?: string;
  /**
   * Whether this is a review-gate instruction (stop_for_review).
   * Advisory instructions do not block compilation but surface for review.
   */
  isAdvisory?: boolean;
}

/**
 * A compiled set of browser-automation instructions for a portal lane.
 *
 * This is NOT an executed browser run. It is the deterministic contract
 * a future browser driver would consume to execute the automation plan.
 *
 * Separate from:
 * - portalDraft (the data to enter)
 * - automationPlan (the business-level plan)
 * - dryRun (the internal readiness evaluation)
 * - submissionPayload (future submission payload)
 * - executionAttempt (future live execution placeholder)
 */
export interface BrowserAutomationInstructionSet {
  /** Overall compilation status. */
  status: BrowserAutomationInstructionSetStatus;
  /** Which portal lane these instructions target. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this set was compiled. */
  compiledAt: string;
  /** Ordered list of compiled instructions. */
  instructions: BrowserAutomationInstruction[];
  /** Total instruction count (including blocked). */
  instructionCount: number;
  /** Human-readable reasons why compilation is blocked, if any. */
  blockedReasons: string[];
  /** Human-readable advisory notes from non-blocking items. */
  advisoryNotes: string[];
  /**
   * Known later portal surfaces beyond the executable stop boundary.
   * These are NOT executable instructions — they are informational
   * only, representing portal sections that are proven accessible but
   * not yet part of the automated instruction path.
   */
  knownLaterSurfaces?: string[];
}

// ─── Browser Execution Result ────────────────────────────────────────

/**
 * Overall status of a browser execution (mock or real).
 * - not_ready: instruction set is not ready for execution
 * - ready_for_internal_review: all instructions executed, no blocks
 * - review_required: executed with advisory or review-gate items present
 * - blocked: one or more required instructions could not execute
 * - failed: execution encountered an unrecoverable failure
 */
export type BrowserExecutionStatus =
  | "not_ready"
  | "ready_for_internal_review"
  | "review_required"
  | "blocked"
  | "failed"
  | "not_yet_proven";

/**
 * Per-instruction execution status.
 * - pending: not yet evaluated
 * - executed: completed successfully (all preconditions met)
 * - blocked: preconditions not met — instruction was not executed
 * - failed: instruction attempted but encountered a failure condition
 * - skipped: instruction bypassed (e.g. after a halt or advisory step)
 */
export type BrowserExecutionInstructionStatus =
  | "pending"
  | "executed"
  | "blocked"
  | "failed"
  | "skipped";

/**
 * Result for a single instruction in the execution trace.
 */
export interface BrowserExecutionInstructionResult {
  /** Sequence number, matching the compiled instruction. */
  seq: number;
  /** Instruction type, matching the compiled instruction. */
  type: BrowserAutomationInstructionType;
  /** Human-readable description. */
  description: string;
  /** Execution status for this instruction. */
  status: BrowserExecutionInstructionStatus;
  /** Optional note explaining the status outcome. */
  note?: string;
  /** Whether this instruction was advisory (non-blocking review gate). */
  isAdvisory?: boolean;
}

/**
 * A structured failure record for an instruction that blocked or failed.
 */
export interface BrowserExecutionFailure {
  /** Which instruction sequence number caused the failure or block. */
  atSeq: number;
  /** Human-readable failure or block reason. */
  reason: string;
}

/**
 * Aggregate counts for an execution trace.
 */
export interface BrowserExecutionTrace {
  /** Total instructions evaluated. */
  totalInstructions: number;
  /** Count of instructions with status = executed. */
  executedCount: number;
  /** Count of instructions with status = blocked. */
  blockedCount: number;
  /** Count of instructions with status = failed. */
  failedCount: number;
  /** Count of instructions with status = skipped. */
  skippedCount: number;
}

/**
 * The full result of a browser execution (mock or real).
 *
 * This is NOT a real portal run. It is a deterministic evaluation
 * of whether the compiled instruction set is executable given current
 * job data, using the precondition.met values already resolved by
 * the instruction compiler.
 *
 * Separate from:
 * - browserInstructions (the compiled adapter contract)
 * - dryRun (the automation plan readiness evaluation)
 * - automationPlan (the business-level plan)
 * - executionAttempt (future live execution placeholder)
 */
export interface BrowserExecutionResult {
  /** Overall execution status. */
  status: BrowserExecutionStatus;
  /** Which portal lane was targeted. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this execution was run. */
  executedAt: string;
  /** Per-instruction results, ordered by seq. */
  instructionResults: BrowserExecutionInstructionResult[];
  /** Aggregate execution trace counts. */
  trace: BrowserExecutionTrace;
  /**
   * Structured failure records for blocked or failed instructions.
   * Empty if no instructions are blocked or failed.
   */
  failures: BrowserExecutionFailure[];
  /**
   * Human-readable blocked reasons derived from blocked instructions.
   * Empty if no instructions are blocked.
   */
  blockedReasons: string[];
  /**
   * Human-readable failed reasons derived from failed instructions.
   * Empty if no instructions failed.
   */
  failedReasons: string[];
  /**
   * Human-readable advisory notes from advisory instructions.
   * Empty if no advisory items found.
   */
  advisoryNotes: string[];
  /**
   * Known later portal surfaces beyond the executable stop boundary.
   * Carried forward from the instruction set. Informational only —
   * NOT treated as executed.
   */
  knownLaterSurfaces?: string[];
}

// ─── Portal State Snapshot + Assertion Registry ─────────────────────

/**
 * A single field value captured from the portal (real or mock).
 * Represents the observed state of one field at a point in time.
 */
/**
 * Which selector strategy succeeded when locating a portal field.
 * Used for diagnostics and maintenance tracking.
 */
export type SelectorResolutionMethod =
  | "label_exact"
  | "label_normalized"
  | "container_fallback"
  | "schema_hint_fallback"
  | "get_by_label"
  | "native_select"
  | "autocomplete_input"
  | "radio_label"
  | "text_match"
  | "not_applicable"
  | "already_on_portal"
  | "mytax_eduti_link"
  | "direct_fallback";

/**
 * Readback confidence for an observed portal value.
 * - exact: value was read cleanly from a single unambiguous source
 * - normalized: value required normalization (whitespace, case, etc.)
 * - low_confidence: value was read but may be unreliable
 */
export type ReadbackConfidence =
  | "exact"
  | "normalized"
  | "low_confidence";

export interface PortalStateFieldValue {
  /** The portal field key, matching PortalFieldSchema.fieldKey. */
  fieldKey: string;
  /** The observed value from the portal. null = field was empty or not found. */
  observedValue: string | number | null;
  /** The portal tab where this field was observed. */
  tab: string;
  /** The portal label (Malay) for this field, if known. */
  portalLabel?: string;
  /**
   * The raw observed value before normalization, if normalization was applied.
   * Preserved so assertion results can show both raw and normalized forms.
   * Omitted when no normalization was needed (raw === observed).
   */
  rawObservedValue?: string | null;
  /** Which selector strategy was used to locate this field. */
  selectorMethod?: SelectorResolutionMethod;
  /** Readback confidence level. */
  readbackConfidence?: ReadbackConfidence;
  /** Human-readable readback note for diagnostics. */
  readbackNote?: string;
}

/**
 * A snapshot of field values for a single portal tab.
 */
export interface PortalStateTabSnapshot {
  /** Tab key matching the portal schema. */
  tabKey: string;
  /** Tab label (Malay). */
  tabLabel: string;
  /** Field values observed on this tab. */
  fields: PortalStateFieldValue[];
}

/**
 * A complete point-in-time snapshot of portal field state.
 *
 * This is NOT a live scrape. It represents either:
 * - a mock snapshot built from WeStamp's internal draft state
 * - a future real snapshot captured by a browser driver
 *
 * The snapshot source distinguishes these cases.
 */
export interface PortalStateSnapshot {
  /** Which portal lane this snapshot represents. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this snapshot was taken. */
  capturedAt: string;
  /**
   * How this snapshot was obtained.
   * - mock_from_draft: built from WeStamp's internal portal draft
   * - browser_captured: captured from a real browser session (future)
   */
  source: "mock_from_draft" | "browser_captured";
  /** Per-tab field snapshots. */
  tabs: PortalStateTabSnapshot[];
  /** Flat list of all field values across tabs for easy lookup. */
  allFields: PortalStateFieldValue[];
}

/**
 * Assertion severity levels.
 * - blocking: mismatch would prevent automation from continuing
 * - advisory: mismatch is notable but does not hard-stop automation
 * - informational: logged for awareness only, never causes a stop
 */
export type PortalAssertionSeverity =
  | "blocking"
  | "advisory"
  | "informational";

/**
 * Why a particular assertion resulted in a mismatch.
 * - value_mismatch: expected and observed values differ
 * - value_missing: expected a value but observed null/empty
 * - unexpected_value: expected null/empty but found a value
 * - not_observable: field could not be observed in the snapshot
 */
export type PortalMismatchReason =
  | "value_mismatch"
  | "value_missing"
  | "unexpected_value"
  | "not_observable";

/**
 * A single assertion definition in the registry.
 * Describes what should be checked for a given field in a given lane.
 */
export interface PortalAssertion {
  /** The portal field key this assertion targets. */
  fieldKey: string;
  /** Which tab this field lives on. */
  tab: string;
  /** Human-readable description of the assertion. */
  description: string;
  /** How critical a mismatch is for this assertion. */
  severity: PortalAssertionSeverity;
  /** Which lane this assertion applies to. null = both lanes. */
  lane: PortalLane | null;
  /**
   * Comparison method.
   * - exact: string equality (trimmed, case-sensitive)
   * - numeric: numeric equality after parsing
   * - present: only checks that a non-null value exists
   */
  comparisonType: "exact" | "numeric" | "present";
}

/**
 * The result of evaluating a single assertion against a snapshot.
 */
export interface PortalAssertionResult {
  /** The portal field key checked. */
  fieldKey: string;
  /** Human-readable description of the assertion. */
  description: string;
  /** Assertion severity. */
  severity: PortalAssertionSeverity;
  /**
   * Outcome.
   * - match: expected and observed agree
   * - mismatch: values differ
   * - skipped: assertion could not be evaluated (e.g. no expected value)
   */
  outcome: "match" | "mismatch" | "skipped";
  /** The value WeStamp expected (from draft/plan/routing). */
  expectedValue: string | number | null;
  /** The value observed in the snapshot. */
  observedValue: string | number | null;
  /** Why a mismatch occurred, if applicable. */
  mismatchReason?: PortalMismatchReason;
  /** Optional note explaining the result. */
  note?: string;
}

/**
 * The full assertion registry for a portal lane.
 * Lists all assertions that should be evaluated for that lane.
 */
export interface PortalAssertionRegistry {
  /** Which lane this registry covers. */
  lane: PortalLane;
  /** The assertions to evaluate. */
  assertions: PortalAssertion[];
}

/**
 * Status of the assertion evaluation.
 * - ready_for_internal_review: all assertions passed or skipped
 * - blocking_mismatches: one or more blocking mismatches found
 * - advisory_mismatches: advisory mismatches found, no blocking
 * - not_ready: required inputs missing
 */
export type PortalAssertionEvaluationStatus =
  | "ready_for_internal_review"
  | "blocking_mismatches"
  | "advisory_mismatches"
  | "not_ready";

/**
 * The full result of evaluating portal assertions for a job.
 *
 * This is NOT a live portal validation. It compares WeStamp's
 * expected values against a portal-state snapshot (mock or real).
 *
 * Separate from:
 * - portalDraft (the data to enter)
 * - browserInstructions (the instruction contract)
 * - mockExecution (the instruction-level mock run)
 * - dryRun (the automation plan readiness check)
 */
export interface PortalAssertionEvaluation {
  /** Overall evaluation status. */
  status: PortalAssertionEvaluationStatus;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this evaluation was performed. */
  evaluatedAt: string;
  /** The snapshot that was compared against. */
  snapshot: PortalStateSnapshot;
  /** Per-assertion results. */
  results: PortalAssertionResult[];
  /** Aggregate summary. */
  summary: {
    totalAssertions: number;
    matchCount: number;
    mismatchCount: number;
    skippedCount: number;
    blockingMismatchCount: number;
    advisoryMismatchCount: number;
    informationalMismatchCount: number;
  };
  /** Human-readable blocking mismatch reasons. */
  blockingMismatches: string[];
  /** Human-readable advisory mismatch reasons. */
  advisoryMismatches: string[];
}

// ─── Portal Probe Artifact Types ────────────────────────────────────

/**
 * Types of artifacts that the local/dev portal probe can capture.
 *
 * - screenshot: a PNG screenshot of the portal at a safe checkpoint
 * - field_evidence: lightweight structured evidence for an observed field
 */
export type PortalProbeArtifactType = "screenshot" | "field_evidence";

/**
 * A single artifact captured during a local/dev portal probe.
 *
 * Screenshot artifacts store metadata + local file path only.
 * Binary content is NOT stored in the job record.
 *
 * Field evidence artifacts store structured observed-value diagnostics.
 */
export interface PortalProbeArtifact {
  /** Artifact type. */
  type: PortalProbeArtifactType;
  /** Checkpoint label describing when this artifact was captured. */
  checkpoint: string;
  /** ISO 8601 timestamp of capture. */
  capturedAt: string;
  /**
   * For screenshot artifacts: local file path (relative to project root).
   * For field_evidence: undefined.
   */
  filePath?: string;
  /** For screenshot artifacts: file name only. */
  fileName?: string;
  /**
   * For field_evidence artifacts: structured field observation.
   * For screenshot artifacts: undefined.
   */
  fieldEvidence?: PortalProbeFieldEvidence;
  /** Optional human-readable note. */
  note?: string;
}

/**
 * Lightweight structured evidence for a single observed field.
 * Stored directly on the artifact — no binary data, no DOM dump.
 */
export interface PortalProbeFieldEvidence {
  /** The portal field key. */
  fieldKey: string;
  /** Portal label text. */
  portalLabel?: string;
  /** Raw observed value before normalization. */
  rawObservedValue?: string | null;
  /** Normalized observed value. */
  normalizedValue?: string | number | null;
  /** Which selector strategy succeeded. */
  selectorMethod?: SelectorResolutionMethod;
  /** Readback confidence level. */
  readbackConfidence?: ReadbackConfidence;
  /** Readback diagnostic note. */
  readbackNote?: string;
}

/**
 * A checkpoint screenshot capture request.
 * Used internally to define when screenshots should be taken.
 */
export interface PortalProbeCheckpointArtifact {
  /** Checkpoint identifier — matches a probe execution stage. */
  checkpoint: string;
  /** Human-readable label for the checkpoint. */
  label: string;
  /** Whether this checkpoint has been captured. */
  captured: boolean;
}

/**
 * The collection of all artifacts captured during a portal probe.
 * Stored on the probe result, separate from binary files.
 */
export interface PortalProbeArtifactCollection {
  /** All captured artifacts (metadata only — no binary content). */
  artifacts: PortalProbeArtifact[];
  /**
   * Local directory where screenshot files were written.
   * Relative to project root.
   * Dev/local only — NOT a production storage path.
   */
  artifactDir: string;
  /** Count of screenshot artifacts captured. */
  screenshotCount: number;
  /** Count of field evidence artifacts captured. */
  fieldEvidenceCount: number;
  /** ISO 8601 timestamp of collection completion. */
  collectedAt: string;
}

// ─── Maklumat Am Save Preflight + Mutation Guard ────────────────────

/**
 * Severity of a save-preflight check.
 * - blocking: must be resolved before any save attempt
 * - advisory: notable but does not hard-stop a future save
 * - informational: logged for awareness only
 */
export type PortalSavePreflightSeverity =
  | "blocking"
  | "advisory"
  | "informational";

/**
 * A single preflight check evaluated against the current job state.
 */
export interface PortalSavePreflightCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity if the check fails. */
  severity: PortalSavePreflightSeverity;
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * Overall save-preflight status.
 * - not_ready: required upstream layers are missing
 * - blocking_issues: one or more blocking checks failed
 * - review_required: no blockers, but advisory issues require human review
 * - eligible: all blocking and advisory checks passed — internally eligible
 *             for a future save attempt in a later milestone
 */
export type PortalSavePreflightStatus =
  | "not_ready"
  | "blocking_issues"
  | "review_required"
  | "eligible";

/**
 * Why the mutation guard refuses or gates the first mutating action.
 * - missing_portal_draft: no portal draft exists
 * - missing_browser_instructions: no compiled instructions
 * - browser_instructions_blocked: instructions exist but are blocked
 * - dry_run_blocked: dry run exists but is blocked
 * - assertion_blocking_mismatch: assertion evaluation has blocking mismatches
 * - probe_failed: most recent probe failed
 * - probe_blocked: most recent probe is blocked
 * - probe_missing: no probe has been run for the current draft state
 * - probe_readback_failure: probe has blocking selector/readback failures
 * - draft_probe_drift: portal draft was updated after the last probe
 * - missing_required_maklumat_am_field: a required Maklumat Am input is absent
 * - manual_confirmation_required: no hard blocker but human review is required
 */
export type PortalMutationGuardReason =
  | "missing_portal_draft"
  | "missing_browser_instructions"
  | "browser_instructions_blocked"
  | "dry_run_blocked"
  | "assertion_blocking_mismatch"
  | "probe_failed"
  | "probe_blocked"
  | "probe_missing"
  | "probe_readback_failure"
  | "draft_probe_drift"
  | "missing_required_maklumat_am_field"
  | "manual_confirmation_required";

/**
 * The mutation guard decision for the first save action.
 */
export interface PortalMutationGuard {
  /**
   * Whether the first save action is currently allowed in principle.
   * - refused: one or more hard-stop reasons are active
   * - review_gated: no hard stop, but requires human confirmation
   * - permitted: internally eligible (does NOT mean save has been performed)
   */
  decision: "refused" | "review_gated" | "permitted";
  /** Active guard reasons, if any. */
  reasons: PortalMutationGuardReason[];
  /** Human-readable explanation of the decision. */
  explanation: string;
}

/**
 * The full save-preflight evaluation result for Maklumat Am.
 *
 * This represents WeStamp's internal readiness assessment for whether
 * the first save action could be attempted in a future milestone.
 *
 * This is NOT a save execution. No portal mutation has occurred.
 * Separate from all other job artifacts.
 */
export interface PortalSavePreflight {
  /** Overall preflight status. */
  status: PortalSavePreflightStatus;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** Per-check results. */
  checks: PortalSavePreflightCheck[];
  /** Mutation guard decision. */
  mutationGuard: PortalMutationGuard;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
    informationalFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable advisory reasons. */
  advisoryReasons: string[];
  /**
   * Reference to the probe used for this evaluation, if any.
   * ISO 8601 timestamp of the probe's probedAt value.
   */
  lastProbeReference?: string;
}

// ─── Maklumat Am Save Authorization ─────────────────────────────────

/**
 * Status of the save authorization.
 * - not_available: preflight is not eligible, so authorization cannot be issued
 * - available: preflight is eligible or review-gated, authorization can be issued
 * - active: authorization has been explicitly issued and is still valid
 * - stale: authorization was issued but underlying state has changed since
 * - revoked: authorization was explicitly revoked
 */
export type PortalSaveAuthorizationStatus =
  | "not_available"
  | "available"
  | "active"
  | "stale"
  | "revoked";

/**
 * What scope this authorization covers.
 * Currently only Maklumat Am save is modelled.
 */
export type PortalSaveAuthorizationScope = "maklumat_am_save";

/**
 * Why authorization is stale or not available.
 */
export type PortalSaveAuthorizationReason =
  | "preflight_not_eligible"
  | "preflight_changed"
  | "portal_draft_changed"
  | "probe_changed"
  | "assertion_changed"
  | "time_expired"
  | "explicitly_revoked";

/**
 * Expiry configuration and state for the authorization.
 */
export interface PortalSaveAuthorizationExpiry {
  /** ISO 8601 timestamp when the authorization expires. */
  expiresAt: string;
  /** Whether the authorization has expired based on current time. */
  isExpired: boolean;
  /** Duration in minutes that was used to set the expiry window. */
  windowMinutes: number;
}

/**
 * State fingerprint that the authorization is tied to.
 * If any of these change after issuance, the authorization becomes stale.
 */
export interface PortalSaveAuthorizationStateRef {
  /** ISO 8601 timestamp of the save preflight evaluation used. */
  preflightEvaluatedAt: string;
  /** ISO 8601 timestamp of the portal draft used. */
  portalDraftedAt: string;
  /** ISO 8601 timestamp of the probe used, if any. */
  probeProbedAt?: string;
  /** ISO 8601 timestamp of the assertion evaluation used, if any. */
  assertionEvaluatedAt?: string;
  /** Portal lane at time of authorization. */
  lane: PortalLane;
}

/**
 * The explicit human-confirmed save authorization for Maklumat Am.
 *
 * This represents a deliberate local/dev-only decision that the current
 * Maklumat Am state is approved for a future save attempt.
 *
 * This is NOT a save execution. No portal mutation has occurred.
 * Authorization can become stale if underlying state changes.
 * Separate from all other job artifacts.
 */
export interface PortalSaveAuthorization {
  /** Current authorization status. */
  status: PortalSaveAuthorizationStatus;
  /** What this authorization covers. */
  scope: PortalSaveAuthorizationScope;
  /** ISO 8601 timestamp of when authorization was issued or last evaluated. */
  evaluatedAt: string;
  /** ISO 8601 timestamp of when authorization was explicitly issued, if ever. */
  issuedAt?: string;
  /** ISO 8601 timestamp of when authorization was revoked, if applicable. */
  revokedAt?: string;
  /** Expiry state. Only present when authorization has been issued. */
  expiry?: PortalSaveAuthorizationExpiry;
  /** State fingerprint the authorization is tied to. */
  stateRef?: PortalSaveAuthorizationStateRef;
  /** Why authorization is stale or not available, if applicable. */
  staleReasons: PortalSaveAuthorizationReason[];
  /** Human-readable explanation of the current status. */
  explanation: string;
}

// ─── Maklumat Am Save Attempt ───────────────────────────────────────

/**
 * Status of a Maklumat Am save attempt.
 * - not_ready: preconditions are not met (authorization, preflight, etc.)
 * - blocked: a hard-stop condition prevented the attempt
 * - attempted: the save click was performed, outcome pending/observed
 * - failed: the save click was performed but the portal reported an error
 * - completed_with_stop: save click succeeded (or outcome observed), automation stopped
 */
export type PortalSaveAttemptStatus =
  | "not_ready"
  | "blocked"
  | "attempted"
  | "failed"
  | "completed_with_stop";

/**
 * What the portal showed after the save click.
 * - success_message: portal displayed a success/confirmation indicator
 * - validation_error: portal displayed a validation or field error
 * - error_banner: portal displayed a general error banner
 * - no_visible_change: save clicked but no observable response detected
 * - unknown: outcome could not be determined
 */
export type PortalSaveAttemptOutcome =
  | "success_message"
  | "validation_error"
  | "error_banner"
  | "no_visible_change"
  | "unknown";

/**
 * Evidence captured immediately after the save attempt.
 */
export interface PortalSaveAttemptEvidence {
  /** Screenshot file path after save attempt (local artifact, not binary). */
  screenshotFilePath?: string;
  /** Screenshot file name. */
  screenshotFileName?: string;
  /** Any visible portal message text observed after save. */
  observedPortalMessage?: string;
  /** What kind of outcome was observed. */
  outcome: PortalSaveAttemptOutcome;
  /** Additional diagnostic notes. */
  notes: string[];
}

/**
 * The full result of a Maklumat Am save attempt.
 *
 * This represents the first real mutating action on the portal,
 * performed under strict local/dev gating with active authorization.
 *
 * After the save outcome is observed, automation stops immediately.
 * No next-tab progression occurs.
 *
 * Separate from all other job artifacts.
 */
export interface PortalSaveAttempt {
  /** Overall save-attempt status. */
  status: PortalSaveAttemptStatus;
  /** Which portal lane was targeted. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  attemptedAt: string;
  /** Whether authorization was active at time of attempt. */
  authorizationWasActive: boolean;
  /** Whether preflight was eligible at time of attempt. */
  preflightWasEligible: boolean;
  /** Post-save evidence, if the save click was performed. */
  evidence?: PortalSaveAttemptEvidence;
  /**
   * Post-save observed snapshot — Maklumat Am field values read back from
   * the portal after the save click. This is a distinct snapshot from any
   * pre-save probe snapshot. Used by post-save reconciliation to refresh
   * assertion evaluation against actual post-save portal state.
   */
  postSaveSnapshot?: PortalStateSnapshot;
  /** Post-save artifact collection metadata. */
  artifactDir?: string;
  /** Human-readable blocking/refusal reason if attempt was not performed. */
  blockReason?: string;
  /** Human-readable notes. */
  notes: string[];
}

// ─── Post-Save Reconciliation ───────────────────────────────────────

/**
 * Overall status of the post-save reconciliation.
 */
export type PortalPostSaveReconciliationStatus =
  | "not_ready"
  | "stopped_cleanly"
  | "review_required"
  | "blocking_issue"
  | "save_failed";

/**
 * Post-save outcome classification.
 * Describes what WeStamp concluded from the save attempt + post-save state.
 */
export type PortalPostSaveOutcome =
  | "save_observed_and_stopped_cleanly"
  | "save_observed_but_review_required"
  | "save_observed_with_blocking_issue"
  | "save_attempt_failed"
  | "post_save_state_incomplete";

/**
 * Why the workflow stopped after the save attempt.
 */
export type PortalPostSaveStopReason =
  | "stopped_after_expected_save_observation"
  | "stopped_due_to_post_save_blocking_mismatch"
  | "stopped_due_to_visible_validation_error"
  | "stopped_due_to_missing_post_save_snapshot"
  | "stopped_due_to_unexpected_portal_state"
  | "stopped_due_to_save_failure"
  | "stopped_no_save_attempt";

/**
 * A single post-save reconciliation check.
 */
export interface PortalPostSaveCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity: blocking, advisory, or informational. */
  severity: "blocking" | "advisory" | "informational";
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * The full post-save reconciliation result.
 *
 * Evaluates the immediate outcome of the first Maklumat Am save attempt
 * and classifies the stop state without progressing further.
 *
 * This is NOT a later-tab or continuation evaluation.
 * Separate from all other job artifacts.
 */
export interface PortalPostSaveReconciliation {
  /** Overall reconciliation status. */
  status: PortalPostSaveReconciliationStatus;
  /** Classified post-save outcome. */
  outcome: PortalPostSaveOutcome;
  /** Why the workflow stopped. */
  stopReason: PortalPostSaveStopReason;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** Per-check results. */
  checks: PortalPostSaveCheck[];
  /** Post-save assertion evaluation status, if assertions were refreshed against post-save snapshot. */
  postSaveAssertionStatus?: string;
  /**
   * The full assertion evaluation refreshed against the post-save snapshot.
   * This is NOT the pre-save assertion evaluation stored on the job.
   * It is a fresh evaluation using the post-save observed state.
   * Null if no post-save snapshot was available.
   */
  postSaveAssertionEvaluation?: PortalAssertionEvaluation;
  /**
   * Whether this reconciliation was based on a post-save snapshot
   * (true) or fell back to prior state (false).
   * Explicit marker to distinguish pre-save vs post-save basis.
   */
  basedOnPostSaveSnapshot: boolean;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable review-required reasons. */
  reviewReasons: string[];
  /** Human-readable explanation of the reconciliation. */
  explanation: string;
}

// ─── Next-Tab Progression Preflight ──────────────────────────────────

/**
 * Overall status of the next-tab progression preflight.
 * - not_ready: required prior layers (save attempt, reconciliation) are missing
 * - blocking_issues: one or more blocking conditions prevent progression eligibility
 * - review_required: no blocking issues, but advisory conditions warrant human review
 * - eligible_for_later_attempt: all checks passed, progression could be attempted later
 */
export type PortalNextTabPreflightStatus =
  | "not_ready"
  | "blocking_issues"
  | "review_required"
  | "eligible_for_later_attempt";

/**
 * Severity levels for next-tab preflight checks.
 */
export type PortalNextTabPreflightSeverity =
  | "blocking"
  | "advisory"
  | "informational";

/**
 * A single next-tab progression preflight check.
 */
export interface PortalNextTabPreflightCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity of this check. */
  severity: PortalNextTabPreflightSeverity;
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * What WeStamp currently knows about the next tab's availability
 * from post-save evidence and snapshot.
 */
export type PortalNextTabObservedAvailability =
  | "confirmed_enabled"
  | "inferred_available"
  | "unknown"
  | "observed_disabled"
  | "observed_error";

/**
 * Observed state of the immediate next tab after the Maklumat Am save.
 * Grounded in currently available post-save snapshot/evidence only.
 */
export interface PortalNextTabObservedState {
  /** The expected immediate next tab key derived from schema order. */
  expectedNextTabKey: PortalTabKey | null;
  /** Human-readable label of the expected next tab. */
  expectedNextTabLabel: string | null;
  /** Whether the next tab appears available based on post-save evidence. */
  availability: PortalNextTabObservedAvailability;
  /** How the availability was determined. */
  availabilitySource: string;
  /** Whether any evidence suggests unintended progression already occurred. */
  unintendedProgressionDetected: boolean;
  /** Human-readable note about the observed state. */
  note?: string;
}

/**
 * Reason why the next-tab progression guard made a particular decision.
 */
export type PortalNextTabGuardReason =
  | "save_attempt_missing_or_failed"
  | "reconciliation_missing_or_blocking"
  | "blocking_assertion_mismatch_post_save"
  | "expected_next_tab_unknown"
  | "observed_post_save_error"
  | "unintended_progression_detected"
  | "post_save_snapshot_missing"
  | "next_tab_observed_disabled"
  | "next_tab_availability_unknown"
  | "post_save_evidence_incomplete"
  | "low_readback_confidence_on_critical_fields"
  | "next_tab_availability_inferred_not_confirmed";

/**
 * The next-tab progression guard decision.
 */
export interface PortalNextTabGuard {
  /** Guard outcome. */
  decision: "refused" | "review_gated" | "permitted";
  /** Reasons that contributed to the decision. */
  reasons: PortalNextTabGuardReason[];
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * The full next-tab progression preflight result.
 *
 * Evaluates whether the immediate next tab after Maklumat Am is
 * internally eligible for a later guarded progression attempt.
 *
 * This is NOT a next-tab click. No portal navigation occurs.
 * Separate from all other job artifacts.
 */
export interface PortalNextTabPreflight {
  /** Overall preflight status. */
  status: PortalNextTabPreflightStatus;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** The current tab (always maklumat_am for this milestone). */
  currentTabKey: PortalTabKey;
  /** Observed state of the next tab. */
  nextTabObservedState: PortalNextTabObservedState;
  /** Per-check results. */
  checks: PortalNextTabPreflightCheck[];
  /** The progression guard decision. */
  guard: PortalNextTabGuard;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
    informationalFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable advisory reasons. */
  advisoryReasons: string[];
  /** Human-readable explanation. */
  explanation: string;
}

// ─── Next-Tab Progression Authorization ──────────────────────────────

/**
 * Status of the next-tab progression authorization.
 */
export type PortalNextTabAuthorizationStatus =
  | "not_available"
  | "available"
  | "active"
  | "stale"
  | "revoked";

/**
 * What scope this next-tab authorization covers.
 */
export type PortalNextTabAuthorizationScope = "next_tab_progression";

/**
 * Why the next-tab authorization is stale or not available.
 */
export type PortalNextTabAuthorizationReason =
  | "preflight_not_eligible"
  | "preflight_changed"
  | "reconciliation_changed"
  | "save_attempt_changed"
  | "post_save_snapshot_changed"
  | "expected_next_tab_changed"
  | "time_expired"
  | "explicitly_revoked";

/**
 * Expiry configuration and state for the next-tab authorization.
 */
export interface PortalNextTabAuthorizationExpiry {
  /** ISO 8601 timestamp when the authorization expires. */
  expiresAt: string;
  /** Whether the authorization has expired based on current time. */
  isExpired: boolean;
  /** Duration in minutes that was used to set the expiry window. */
  windowMinutes: number;
}

/**
 * State fingerprint that the next-tab authorization is tied to.
 * If any of these change after issuance, the authorization becomes stale.
 */
export interface PortalNextTabAuthorizationStateRef {
  /** ISO 8601 timestamp of the next-tab preflight used. */
  nextTabPreflightEvaluatedAt: string;
  /** ISO 8601 timestamp of the post-save reconciliation used. */
  reconciliationEvaluatedAt: string;
  /** ISO 8601 timestamp of the save attempt used. */
  saveAttemptAttemptedAt: string;
  /** ISO 8601 timestamp of the post-save snapshot, if available. */
  postSaveSnapshotCapturedAt?: string;
  /** Portal lane at time of authorization. */
  lane: PortalLane;
  /** The expected next tab key at time of authorization. */
  expectedNextTabKey: PortalTabKey;
}

/**
 * The explicit human-confirmed next-tab progression authorization.
 *
 * This represents a deliberate local/dev-only decision that the current
 * post-save state is approved for a future first next-tab progression attempt.
 *
 * This is NOT a next-tab click. No portal navigation has occurred.
 * Authorization can become stale if underlying state changes.
 * Separate from all other job artifacts.
 */
export interface PortalNextTabAuthorization {
  /** Current authorization status. */
  status: PortalNextTabAuthorizationStatus;
  /** What this authorization covers. */
  scope: PortalNextTabAuthorizationScope;
  /** ISO 8601 timestamp of when authorization was issued or last evaluated. */
  evaluatedAt: string;
  /** ISO 8601 timestamp of when authorization was explicitly issued, if ever. */
  issuedAt?: string;
  /** ISO 8601 timestamp of when authorization was revoked, if applicable. */
  revokedAt?: string;
  /** Expiry state. Only present when authorization has been issued. */
  expiry?: PortalNextTabAuthorizationExpiry;
  /** State fingerprint the authorization is tied to. */
  stateRef?: PortalNextTabAuthorizationStateRef;
  /** Why authorization is stale or not available, if applicable. */
  staleReasons: PortalNextTabAuthorizationReason[];
  /** Human-readable explanation of the current status. */
  explanation: string;
}

// ─── Next-Tab Progression Attempt ────────────────────────────────────

/**
 * Status of a next-tab progression attempt.
 * - not_ready: preconditions not met
 * - blocked: authorization or preflight refused the attempt
 * - attempted: click was performed but outcome unclear
 * - failed: click failed or portal did not respond as expected
 * - completed_with_stop: progression observed and automation stopped
 */
export type PortalNextTabAttemptStatus =
  | "not_ready"
  | "blocked"
  | "attempted"
  | "failed"
  | "completed_with_stop";

/**
 * What the portal showed after the next-tab click.
 * - tab_became_active: the target tab appears active/visible
 * - tab_content_visible: the target tab content is visible on page
 * - no_visible_change: clicked but no observable tab change
 * - error_or_validation: portal displayed an error or validation message
 * - unknown: outcome could not be determined
 */
export type PortalNextTabAttemptOutcome =
  | "tab_became_active"
  | "tab_content_visible"
  | "no_visible_change"
  | "error_or_validation"
  | "unknown";

/**
 * Evidence captured immediately after the next-tab click.
 */
export interface PortalNextTabAttemptEvidence {
  /** Screenshot file path after next-tab click (local artifact). */
  screenshotFilePath?: string;
  /** Screenshot file name. */
  screenshotFileName?: string;
  /** Any visible portal message text observed after click. */
  observedPortalMessage?: string;
  /** What kind of outcome was observed. */
  outcome: PortalNextTabAttemptOutcome;
  /** Whether the target tab appeared active after click. */
  targetTabAppearedActive: boolean;
  /** Any observed tab heading or label confirming the new tab. */
  observedTabLabel?: string;
  /** Additional diagnostic notes. */
  notes: string[];
}

/**
 * The full result of a next-tab progression attempt.
 *
 * Represents the first real next-tab click from Maklumat Am into
 * Bahagian A, performed under strict local/dev gating with active
 * next-tab authorization.
 *
 * After the progression outcome is observed, automation stops immediately.
 * No Bahagian A fields are filled. No further tabs are clicked.
 *
 * Separate from all other job artifacts.
 */
export interface PortalNextTabAttempt {
  /** Overall attempt status. */
  status: PortalNextTabAttemptStatus;
  /** Which portal lane was targeted. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  attemptedAt: string;
  /** The tab being progressed from. */
  fromTabKey: PortalTabKey;
  /** The tab being progressed to. */
  toTabKey: PortalTabKey;
  /** Human-readable label of the target tab. */
  toTabLabel: string;
  /** Whether next-tab authorization was active at time of attempt. */
  authorizationWasActive: boolean;
  /** Whether next-tab preflight was eligible at time of attempt. */
  preflightWasEligible: boolean;
  /** Post-click evidence, if the click was performed. */
  evidence?: PortalNextTabAttemptEvidence;
  /** Post-click artifact directory. */
  artifactDir?: string;
  /** Human-readable blocking/refusal reason if attempt was not performed. */
  blockReason?: string;
  /** Human-readable notes. */
  notes: string[];
}

// ─── Bahagian A Entry-State + Schema Grounding ─────────────────────

/**
 * Observed visibility of a field in the portal.
 */
export type PortalObservedFieldVisibility =
  | "visible"
  | "hidden"
  | "not_found";

/**
 * Observed interaction mode of a field.
 * - editable: accepts user input
 * - read_only: visible but greyed-out or disabled
 * - derived: auto-populated by portal logic
 * - unknown: could not determine mode
 */
export type PortalObservedFieldMode =
  | "editable"
  | "read_only"
  | "derived"
  | "unknown";

/**
 * Best-effort type hint for an observed field.
 */
export type PortalObservedFieldTypeHint =
  | "text_input"
  | "select"
  | "date"
  | "checkbox"
  | "radio"
  | "textarea"
  | "display"
  | "unknown";

/**
 * A single observed field candidate on a portal tab.
 * Captures what was visible without filling anything.
 */
export interface PortalObservedField {
  /** Sequential index of observation. */
  index: number;
  /** Visible label text as observed (Malay). */
  labelText: string;
  /** Observed interaction mode. */
  mode: PortalObservedFieldMode;
  /** Observed field type hint. */
  typeHint: PortalObservedFieldTypeHint;
  /** Observed visibility. */
  visibility: PortalObservedFieldVisibility;
  /** Whether the field appears marked as required (e.g. asterisk, "wajib"). */
  appearsRequired: boolean;
  /** Current pre-populated value if any, without filling. */
  currentValue?: string | null;
  /** Selector method or locator note used to find this field. */
  locatorNote?: string;
  /** Container context (e.g. parent section label if observed). */
  containerContext?: string;
  /** Any observation note. */
  note?: string;
}

/**
 * How a schema field was classified during grounding.
 */
export type PortalSchemaGroundingMatch =
  | "matched"          // Observed field matches a schema field
  | "unmatched"        // Observed field has no schema mapping
  | "expected_missing" // Schema field expected but not observed
  | "uncertain";       // Possible match but not confirmed

/**
 * A single grounding entry linking observed state to schema.
 */
export interface PortalSchemaGroundingEntry {
  /** The observed field, if one was found. */
  observedField?: PortalObservedField;
  /** The schema field key, if mapped. */
  schemaFieldKey?: string;
  /** The schema field label, if mapped. */
  schemaFieldLabel?: string;
  /** Classification. */
  match: PortalSchemaGroundingMatch;
  /** Confidence note about this mapping. */
  note?: string;
}

/**
 * Overall status of the schema grounding.
 */
export type PortalSchemaGroundingStatus =
  | "not_observed"
  | "observed"
  | "grounding_incomplete"
  | "partially_matched"
  | "ready_for_review";

/**
 * Full tab entry-state snapshot + schema grounding result.
 * Represents "what was observed on a tab" without filling anything.
 */
export interface PortalTabEntryState {
  /** Grounding status. */
  status: PortalSchemaGroundingStatus;
  /** Which tab was observed. */
  tabKey: PortalTabKey;
  /** Human-readable tab label. */
  tabLabel: string;
  /** Which lane. */
  lane: PortalLane;
  /** ISO 8601 timestamp of observation. */
  observedAt: string;
  /** Whether the tab was actually observed in the portal. */
  tabObserved: boolean;
  /** All observed field candidates. */
  observedFields: PortalObservedField[];
  /** Schema grounding entries (observed → schema alignment). */
  groundingEntries: PortalSchemaGroundingEntry[];
  /** Summary statistics. */
  summary: PortalSchemaGroundingSummary;
  /** Post-observation screenshot file name. */
  screenshotFileName?: string;
  /** Artifact directory. */
  artifactDir?: string;
  /** Human-readable notes. */
  notes: string[];
}

/**
 * Summary statistics for schema grounding.
 */
export interface PortalSchemaGroundingSummary {
  /** Total observed fields on the tab. */
  totalObservedFields: number;
  /** Fields matched to existing schema entries. */
  groundedCount: number;
  /** Observed fields with no schema mapping. */
  unmatchedObservedCount: number;
  /** Schema fields expected but not found on the tab. */
  expectedButNotObservedCount: number;
  /** Uncertain/ambiguous mappings. */
  uncertainCount: number;
  /** Quality notes (restrained, no AI theater). */
  qualityNotes: string[];
}

// ─── Bahagian A Fill Preflight + Guard ─────────────────────────────

/**
 * Overall status of the Bahagian A fill preflight evaluation.
 */
export type PortalBahagianAFillPreflightStatus =
  | "not_ready"
  | "blocking_issues"
  | "review_required"
  | "eligible_for_later_fill_attempt";

/**
 * Severity for Bahagian A fill preflight checks.
 */
export type PortalBahagianAFillPreflightSeverity =
  | "blocking"
  | "advisory"
  | "informational";

/**
 * A single Bahagian A fill preflight check.
 */
export interface PortalBahagianAFillPreflightCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity. */
  severity: PortalBahagianAFillPreflightSeverity;
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * Reason why the Bahagian A fill guard made a particular decision.
 */
export type PortalBahagianAFillGuardReason =
  | "entry_state_missing"
  | "bahagian_a_not_observed"
  | "no_grounded_fields"
  | "all_fields_read_only_or_derived"
  | "schema_grounding_not_observed"
  | "grounding_incomplete_no_editable"
  | "next_tab_attempt_missing_or_failed"
  | "unintended_progression_beyond_bahagian_a"
  | "lane_unknown"
  | "partial_grounding_quality"
  | "unknown_field_modes_present"
  | "expected_schema_fields_missing"
  | "entry_state_has_quality_warnings"
  | "next_tab_attempt_outcome_uncertain";

/**
 * The Bahagian A fill guard decision.
 */
export interface PortalBahagianAFillGuard {
  /** Guard outcome. */
  decision: "refused" | "review_gated" | "permitted";
  /** Reasons that contributed to the decision. */
  reasons: PortalBahagianAFillGuardReason[];
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * Observed field mode summary for Bahagian A.
 */
export interface PortalBahagianAFieldModeSummary {
  /** Count of editable fields observed. */
  editableCount: number;
  /** Count of read-only fields observed. */
  readOnlyCount: number;
  /** Count of derived fields observed. */
  derivedCount: number;
  /** Count of unknown-mode fields observed. */
  unknownCount: number;
}

/**
 * The full Bahagian A fill preflight result.
 *
 * Determines whether a first Bahagian A field-fill attempt could
 * later be allowed, based on entry-state and schema grounding.
 *
 * This is NOT a field fill. No portal mutation occurs.
 * Separate from all other job artifacts.
 */
export interface PortalBahagianAFillPreflight {
  /** Overall preflight status. */
  status: PortalBahagianAFillPreflightStatus;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** Schema grounding status from the entry-state. */
  groundingStatus: PortalSchemaGroundingStatus | null;
  /** Observed field mode summary. */
  fieldModeSummary: PortalBahagianAFieldModeSummary;
  /** Per-check results. */
  checks: PortalBahagianAFillPreflightCheck[];
  /** The fill guard decision. */
  guard: PortalBahagianAFillGuard;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
    informationalFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable advisory reasons. */
  advisoryReasons: string[];
  /** Human-readable explanation. */
  explanation: string;
}

// ─── Bahagian A Fill Authorization ─────────────────────────────────

/**
 * Status of the Bahagian A fill authorization.
 */
export type PortalBahagianAFillAuthorizationStatus =
  | "not_available"
  | "available"
  | "active"
  | "stale"
  | "revoked";

/**
 * What scope this Bahagian A fill authorization covers.
 */
export type PortalBahagianAFillAuthorizationScope = "bahagian_a_field_fill";

/**
 * Why the Bahagian A fill authorization is stale or not available.
 */
export type PortalBahagianAFillAuthorizationReason =
  | "fill_preflight_not_eligible"
  | "fill_preflight_changed"
  | "entry_state_changed"
  | "grounding_status_changed"
  | "next_tab_attempt_changed"
  | "lane_changed"
  | "time_expired"
  | "explicitly_revoked";

/**
 * Expiry configuration and state for the Bahagian A fill authorization.
 */
export interface PortalBahagianAFillAuthorizationExpiry {
  /** ISO 8601 timestamp when the authorization expires. */
  expiresAt: string;
  /** Whether the authorization has expired based on current time. */
  isExpired: boolean;
  /** Duration in minutes that was used to set the expiry window. */
  windowMinutes: number;
}

/**
 * State fingerprint that the Bahagian A fill authorization is tied to.
 * If any of these change after issuance, the authorization becomes stale.
 */
export interface PortalBahagianAFillAuthorizationStateRef {
  /** ISO 8601 timestamp of the fill preflight used. */
  fillPreflightEvaluatedAt: string;
  /** ISO 8601 timestamp of the entry-state observation. */
  entryStateObservedAt: string;
  /** Schema grounding status at time of authorization. */
  groundingStatus: string;
  /** ISO 8601 timestamp of the next-tab attempt. */
  nextTabAttemptAttemptedAt: string;
  /** Portal lane at time of authorization. */
  lane: PortalLane;
}

/**
 * The explicit human-confirmed Bahagian A field-fill authorization.
 *
 * This represents a deliberate local/dev-only decision that the current
 * Bahagian A entry-state and fill-preflight are approved for a future
 * first Bahagian A field-fill attempt.
 *
 * This is NOT a field fill. No portal mutation has occurred.
 * Authorization can become stale if underlying state changes.
 * Separate from all other job artifacts.
 */
export interface PortalBahagianAFillAuthorization {
  /** Current authorization status. */
  status: PortalBahagianAFillAuthorizationStatus;
  /** What this authorization covers. */
  scope: PortalBahagianAFillAuthorizationScope;
  /** ISO 8601 timestamp of when authorization was last evaluated. */
  evaluatedAt: string;
  /** ISO 8601 timestamp of when authorization was explicitly issued, if ever. */
  issuedAt?: string;
  /** ISO 8601 timestamp of when authorization was revoked, if applicable. */
  revokedAt?: string;
  /** Expiry state. Only present when authorization has been issued. */
  expiry?: PortalBahagianAFillAuthorizationExpiry;
  /** State fingerprint the authorization is tied to. */
  stateRef?: PortalBahagianAFillAuthorizationStateRef;
  /** Why authorization is stale or not available, if applicable. */
  staleReasons: PortalBahagianAFillAuthorizationReason[];
  /** Human-readable explanation of the current status. */
  explanation: string;
}

// ─── Bahagian A Fill Attempt ──────────────────────────────────────

/**
 * Status of the first Bahagian A single-field fill attempt.
 */
export type PortalBahagianAFillAttemptStatus =
  | "not_ready"
  | "blocked"
  | "attempted"
  | "failed"
  | "completed_with_stop";

/**
 * Outcome classification for the single-field fill.
 */
export type PortalBahagianAFillAttemptOutcome =
  | "field_filled_successfully"
  | "field_fill_failed"
  | "field_not_found"
  | "readback_mismatch"
  | "validation_message_appeared"
  | "error_or_exception"
  | "unknown";

/**
 * Which field was targeted for the fill attempt.
 */
export interface PortalBahagianAFillTarget {
  /** Index from the entry-state observed fields array. */
  observedFieldIndex: number;
  /** The label text of the targeted field. */
  labelText: string;
  /** The schema field key, if grounded. */
  schemaFieldKey?: string;
  /** The schema field label, if grounded. */
  schemaFieldLabel?: string;
  /** The value that will be filled. */
  intendedValue: string;
  /** Source of the intended value. */
  valueSource: string;
  /** Why this field was selected for the first fill. */
  selectionReason: string;
}

/**
 * Post-fill evidence captured immediately after the single-field fill.
 */
export interface PortalBahagianAFillAttemptEvidence {
  /** Post-fill screenshot file path. */
  screenshotFilePath?: string;
  /** Post-fill screenshot file name. */
  screenshotFileName?: string;
  /** Value read back from the field after fill. */
  readbackValue?: string | null;
  /** Whether readback matched the intended value. */
  readbackMatch?: boolean;
  /** Selector method used to locate the field. */
  selectorMethod?: string;
  /** Any portal validation message observed after fill. */
  observedPortalMessage?: string;
  /** Fill outcome classification. */
  outcome: PortalBahagianAFillAttemptOutcome;
  /** Diagnostic notes from the fill attempt. */
  notes: string[];
}

/**
 * The first local/dev-only guarded Bahagian A single-field fill attempt.
 *
 * Fills exactly ONE grounded editable field, captures immediate post-fill
 * evidence and readback, then stops. No further fields are filled.
 * No further tabs are clicked.
 *
 * Requires active fill authorization and eligible fill preflight.
 */
export interface PortalBahagianAFillAttempt {
  /** Attempt status. */
  status: PortalBahagianAFillAttemptStatus;
  /** Portal lane. */
  lane: PortalLane;
  /** ISO 8601 timestamp of when this attempt was performed. */
  attemptedAt: string;
  /** Whether fill authorization was active at attempt time. */
  authorizationWasActive: boolean;
  /** Whether fill preflight was eligible at attempt time. */
  preflightWasEligible: boolean;
  /** The field targeted for fill. */
  target?: PortalBahagianAFillTarget;
  /** Post-fill evidence. */
  evidence?: PortalBahagianAFillAttemptEvidence;
  /** Post-fill artifact directory. */
  artifactDir?: string;
  /** Block reason if attempt was blocked. */
  blockReason?: string;
  /** Diagnostic notes. */
  notes: string[];
}

// ─── Bahagian A Post-Fill Reconciliation ──────────────────────────

/**
 * Overall status of the Bahagian A post-fill reconciliation.
 */
export type PortalBahagianAPostFillReconciliationStatus =
  | "not_ready"
  | "stopped_cleanly"
  | "review_required"
  | "blocking_issue"
  | "fill_attempt_failed";

/**
 * Classified post-fill outcome.
 * Describes what WeStamp concluded from the first Bahagian A single-field
 * fill attempt + immediate post-fill state.
 */
export type PortalBahagianAPostFillOutcome =
  | "field_fill_observed_and_stopped_cleanly"
  | "field_fill_observed_but_review_required"
  | "field_fill_observed_with_blocking_issue"
  | "field_fill_attempt_failed"
  | "post_fill_state_incomplete";

/**
 * Why the workflow stopped after the first Bahagian A field fill.
 */
export type PortalBahagianAPostFillStopReason =
  | "stopped_after_expected_field_fill_observation"
  | "stopped_due_to_readback_mismatch"
  | "stopped_due_to_visible_validation_error"
  | "stopped_due_to_missing_post_fill_readback"
  | "stopped_due_to_unexpected_field_state"
  | "stopped_due_to_fill_failure"
  | "stopped_no_fill_attempt";

/**
 * A single post-fill reconciliation check.
 */
export interface PortalBahagianAPostFillCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity: blocking, advisory, or informational. */
  severity: "blocking" | "advisory" | "informational";
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * The full Bahagian A post-fill reconciliation result.
 *
 * Evaluates the immediate outcome of the first Bahagian A single-field
 * fill attempt and classifies the stop state without filling further fields,
 * saving Bahagian A, or progressing to later tabs.
 *
 * This is NOT a Bahagian A completion assessment.
 * This is NOT a save or continuation evaluation.
 * Separate from all other job artifacts.
 */
export interface PortalBahagianAPostFillReconciliation {
  /** Overall reconciliation status. */
  status: PortalBahagianAPostFillReconciliationStatus;
  /** Classified post-fill outcome. */
  outcome: PortalBahagianAPostFillOutcome;
  /** Why the workflow stopped. */
  stopReason: PortalBahagianAPostFillStopReason;
  /** Which portal lane was evaluated. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** Per-check results. */
  checks: PortalBahagianAPostFillCheck[];
  /** Target field details from the fill attempt. */
  targetField?: {
    labelText: string;
    schemaFieldKey?: string;
    schemaFieldLabel?: string;
    observedFieldIndex: number;
  };
  /** Intended value that was filled. */
  intendedValue?: string;
  /** Observed value read back after fill. */
  observedValue?: string | null;
  /** Whether readback matched the intended value. */
  readbackMatch?: boolean;
  /** Fill attempt outcome from the evidence. */
  fillAttemptOutcome?: string;
  /**
   * Whether this reconciliation was based on the actual fill attempt
   * evidence (true) or had to fall back to incomplete data (false).
   */
  basedOnFillAttemptEvidence: boolean;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
    informationalFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable review-required reasons. */
  reviewReasons: string[];
  /** Human-readable explanation of the reconciliation. */
  explanation: string;
}

// ─── Bahagian A Next-Field Preflight ──────────────────────────────

/**
 * Overall status of the Bahagian A next-field preflight.
 */
export type PortalBahagianANextFieldPreflightStatus =
  | "not_ready"
  | "blocking_issues"
  | "review_required"
  | "eligible_for_later_next_field_attempt";

/**
 * Severity for next-field preflight checks.
 */
export type PortalBahagianANextFieldPreflightSeverity =
  | "blocking"
  | "advisory"
  | "informational";

/**
 * A single next-field preflight check.
 */
export interface PortalBahagianANextFieldPreflightCheck {
  /** Unique check identifier. */
  checkId: string;
  /** Human-readable description. */
  description: string;
  /** Severity. */
  severity: PortalBahagianANextFieldPreflightSeverity;
  /** Whether this check passed. */
  passed: boolean;
  /** Human-readable reason if the check did not pass. */
  reason?: string;
}

/**
 * Why the next-field guard refused or review-gated a second fill attempt.
 */
export type PortalBahagianANextFieldGuardReason =
  | "first_fill_attempt_missing"
  | "first_fill_attempt_failed"
  | "first_fill_reconciliation_missing"
  | "first_fill_reconciliation_blocking"
  | "first_fill_reconciliation_not_clean"
  | "entry_state_missing"
  | "no_additional_grounded_editable_candidate"
  | "candidate_selection_ambiguous"
  | "visible_portal_error_after_first_fill"
  | "unstable_bahagian_a_state"
  | "unintended_progression_detected"
  | "candidate_value_source_missing"
  | "candidate_mapping_partial"
  | "candidate_readback_confidence_low";

/**
 * The next-field sequencing guard decision.
 */
export interface PortalBahagianANextFieldGuard {
  /** Guard decision. */
  decision: "refused" | "review_gated" | "permitted";
  /** Reasons that contributed to the decision. */
  reasons: PortalBahagianANextFieldGuardReason[];
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * A single candidate for the next field fill.
 */
export interface PortalBahagianANextFieldCandidate {
  /** Index from entry-state observed fields. */
  observedFieldIndex: number;
  /** Label text of the candidate field. */
  labelText: string;
  /** Schema field key if grounded. */
  schemaFieldKey?: string;
  /** Schema field label if grounded. */
  schemaFieldLabel?: string;
  /** Intended value for a future fill, if a source is available. */
  intendedValue?: string;
  /** Source of the intended value. */
  valueSource?: string;
  /** Why this candidate was selected as the preferred next field. */
  selectionBasis: string;
  /** Whether this candidate is considered unambiguous. */
  isUnambiguous: boolean;
}

/**
 * The Bahagian A next-field preflight result.
 *
 * Evaluates whether a future second Bahagian A field-fill attempt could
 * later be internally eligible, and identifies the preferred next candidate.
 *
 * This is NOT a second field fill. No portal mutation has occurred.
 * This is NOT a Bahagian A save or completion assessment.
 * Separate from all other job artifacts.
 */
export interface PortalBahagianANextFieldPreflight {
  /** Overall preflight status. */
  status: PortalBahagianANextFieldPreflightStatus;
  /** Which portal lane. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  evaluatedAt: string;
  /** The first field that was already filled (for reference). */
  firstFilledField?: {
    labelText: string;
    schemaFieldKey?: string;
    observedFieldIndex: number;
  };
  /** The preferred next candidate, if one was identified. */
  nextCandidate?: PortalBahagianANextFieldCandidate;
  /** Total number of remaining grounded editable candidates (excluding first filled). */
  remainingCandidateCount: number;
  /** Per-check results. */
  checks: PortalBahagianANextFieldPreflightCheck[];
  /** Next-field sequencing guard decision. */
  guard: PortalBahagianANextFieldGuard;
  /** Aggregate summary. */
  summary: {
    totalChecks: number;
    passedCount: number;
    blockingFailures: number;
    advisoryFailures: number;
    informationalFailures: number;
  };
  /** Human-readable blocking reasons. */
  blockingReasons: string[];
  /** Human-readable advisory reasons. */
  advisoryReasons: string[];
  /** Human-readable explanation. */
  explanation: string;
}

// ─── Portal Submission Readiness ────────────────────────────────────

/**
 * Internal readiness assessment for portal submission (Hantar).
 *
 * Advisory-only evaluation based on proven portal behaviour.
 * Does NOT guarantee submission will succeed.
 *
 * Status semantics:
 * - "blocked": proven gates exist for this lane AND at least one is unsatisfied
 * - "ready_with_caveats": all proven gates satisfied but unresolved later checks remain
 * - "assessment_limited": gates not yet proven for this lane — no real readiness judgment possible
 */
export type PortalSubmissionReadinessStatus =
  | "blocked"
  | "ready_with_caveats"
  | "assessment_limited";

export interface PortalSubmissionReadinessCheck {
  /** Identifier for this check. */
  key: string;
  /** Human-readable description. */
  description: string;
  /** Current state: satisfied or not. */
  satisfied: boolean;
}

export interface PortalSubmissionReadiness {
  /** Overall readiness status. */
  status: PortalSubmissionReadinessStatus;
  /** Portal lane this assessment applies to. */
  lane: PortalLane;
  /** When this assessment was evaluated. */
  evaluatedAt: string;
  /** Whether Hantar gates have been proven for this lane via live exploration. */
  gatesProvenForLane: boolean;
  /**
   * Proven submission blockers — only populated when gatesProvenForLane=true.
   * These are checks that the live portal is known to enforce at Hantar time.
   */
  provenBlockers: PortalSubmissionReadinessCheck[];
  /** Unresolved/unknown later checks that may still apply at e-Duti Setem. */
  unresolvedChecks: string[];
  /** Notes about this assessment. */
  notes: string[];
}

// ─── Portal Preparation Inputs ──────────────────────────────────────

/**
 * Internal preparation markers for proven portal submit gates.
 *
 * These represent WeStamp's internal preparation state — NOT live
 * portal completion. A marker being true means WeStamp considers
 * the step internally prepared, not that it has been completed in
 * e-Duti Setem.
 *
 * Separate from portalDraft (Maklumat Am field values) and
 * submissionReadiness (evaluated assessment output).
 */
export interface PortalPreparationInputs {
  /** Whether the declaration (Perakuan) is internally prepared. */
  declarationPrepared: boolean;
  /** Whether Bahagian A first party (Pihak Pertama) is internally prepared. */
  bahagianAFirstPartyPrepared: boolean;
  /** Whether Bahagian A second party (Pihak Kedua) is internally prepared. */
  bahagianASecondPartyPrepared: boolean;
  /** When these inputs were last updated. */
  updatedAt: string;
}

// ─── Portal Execution Preview ───────────────────────────────────────

/**
 * Compiled internal preview of what WeStamp intends to enter and
 * validate in e-Duti Setem. NOT a live portal interaction.
 *
 * Separates:
 * - intendedInputs: values WeStamp will later enter into portal fields
 * - validationTargets: read-only values to compare against portal readback
 * - preparationSummary: current state of proven gate markers
 * - unresolvedSteps: things still needed before real submission
 */
export type PortalExecutionPreviewStatus =
  | "incomplete"
  | "preview_ready"
  | "limited";

export interface PortalExecutionPreviewIntendedInput {
  field: string;
  value: string | number | null;
  source: string;
}

export interface PortalExecutionPreviewValidationTarget {
  field: string;
  expectedValue: string | null;
  basis: string;
}

export interface PortalExecutionPreview {
  status: PortalExecutionPreviewStatus;
  lane: PortalLane;
  generatedAt: string;
  intendedInputs: PortalExecutionPreviewIntendedInput[];
  validationTargets: PortalExecutionPreviewValidationTarget[];
  preparationSummary: {
    declarationPrepared: boolean;
    bahagianAFirstPartyPrepared: boolean;
    bahagianASecondPartyPrepared: boolean;
  };
  unresolvedSteps: string[];
  notes: string[];
}
