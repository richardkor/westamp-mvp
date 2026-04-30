/**
 * WeStamp — Tenancy Instruction-Graph Builder (Milestone B-impl · Phase 0)
 *
 * Pure, framework-free, side-effect-free helper that converts a
 * `ready_for_supervised_run` tenancy job into a planned, inspectable
 * multi-pass instruction graph for the e-Duti Setem Sewa/Pajakan
 * fixed-rent residential happy path.
 *
 * What this module IS
 * ───────────────────
 * - The first concrete artefact of the multi-pass instruction-graph
 *   compiler scoped in `docs/2026-04-29-tenancy-multi-pass-
 *   instruction-graph-scope.md`.
 * - A pure offline builder that emits a typed graph structure with
 *   nine phases (Phase 0 → Phase 8), each containing an ordered list
 *   of typed steps annotated with `mutationLevel`, `executionStatus`
 *   and a stable selector key.
 * - The single source of truth for "what would WeStamp ask the
 *   browser to do, in what order, behind which operator gates" — to
 *   be inspected by humans, persisted as a record of intent, and
 *   later consumed by a runtime that does not yet exist.
 * - Strict by default. The builder calls
 *   `evaluateTenancyPortalRunReadiness(...)` and refuses to compile
 *   an executable graph for any non-`ready_for_supervised_run` job.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT drive a browser, connect to CDP, run Playwright, or
 *   touch the live e-Duti Setem portal.
 * - It does NOT submit anything, save anything to the portal, upload
 *   anything, click any portal button, fill any portal field, or
 *   trigger any HTTP request to the portal or any other server.
 * - It does NOT mutate the `StampingJob` record. The graph is
 *   computed in memory and returned by value; persistence (if any)
 *   is the caller's concern in a future milestone.
 * - It does NOT authorize live submission, payment, or certificate
 *   retrieval — even when `verdict === "ready_for_supervised_run"`.
 *   Final Hantar is always represented as a `final_submit` step
 *   behind an explicit `operator_gate`.
 * - It does NOT extract / OCR anything from any document.
 * - It does NOT change agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print logic.
 *
 * Sensitive-data policy
 * ─────────────────────
 * Per the scoping doc §8 the graph never embeds:
 *   - IC numbers, TINs, firm IDs
 *   - cookies, tokens, `lhdnmsstoken`
 *   - raw `href` values, full URLs, query strings, hashes
 *   - HAR payloads, replayed request bodies
 *   - raw uploaded document contents
 * The graph stores ONLY:
 *   - stable phase / step IDs (no portal data)
 *   - the fixed enum values: stepType, mutationLevel, executionStatus
 *   - selector KEYS by stable name / id (e.g. `pds_jenis`,
 *     `pdsL01_button_hantar`) — never raw href / portal numeric IDs
 *   - portal `<option value>` codes already published in WeStamp's
 *     canonical-mapping seed (e.g. `1101` for pds_suratcara) — these
 *     are public fixed-vocabulary values, not job-specific identifiers
 *   - operator-facing description strings constructed from fixed
 *     vocabulary + non-sensitive deterministic counters (e.g.
 *     "Landlord #1") — never the party name, identity number, or
 *     address text from the job
 *   - non-sensitive deterministic counters (party indices, expected
 *     row counts)
 * Every test in `tenancy-instruction-graph.test.ts` enforces this
 * via a dedicated invariant — see test 8 in that file.
 */

import type {
  StampingJob,
  TenancyPortalParty,
} from "./stamping-types";
import {
  TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_PORTAL_CODES,
  TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES,
} from "./stamping-types";
import {
  evaluateTenancyPortalRunReadiness,
  type TenancyPortalRunReadinessJobInput,
  type TenancyPortalRunReadinessReport,
  type TenancyPortalFieldMappingGap,
} from "./tenancy-portal-run-readiness";
import {
  isMappingSafe,
  mapDuplicateCopies,
  mapFurnishedStatus,
  mapPropertyCategory,
  mapPropertyCountry,
  mapPropertyState,
} from "./tenancy-portal-canonical-maps";

// ─── Public types ──────────────────────────────────────────────────

/**
 * The lane currently supported by this builder. Reserved as a union
 * even though only one value exists today — future Penyeteman Am
 * support would add `"penyeteman_am"`.
 */
export type TenancyInstructionGraphLane = "sewa_pajakan";

/**
 * The supported path within the lane. Today only the fixed-rent
 * residential Kediaman path is in scope (per the scoping doc §3).
 */
export type TenancyInstructionGraphSupportedPath =
  "fixed_rent_residential_kediaman";

/**
 * Top-level verdict of the builder. Mirrors the readiness gate's
 * verdict because the builder treats the gate as authoritative — a
 * `blocked` job NEVER yields an executable graph.
 */
export type TenancyInstructionGraphVerdict =
  | "ready_for_supervised_run"
  | "blocked";

/**
 * Per-step execution status, in order of decreasing readiness for
 * runtime. `planned_only` is the only value emitted in this
 * milestone — the builder produces design-only graphs that no
 * runtime executes yet. `executable_later` is reserved for future
 * milestones where Phase 0 may be auto-runnable but later phases
 * still are not. `blocked` is set on every step in a graph whose
 * verdict is `blocked` (so the runtime, when it exists, cannot
 * accidentally execute a blocked graph step-by-step).
 */
export type TenancyInstructionExecutionStatus =
  | "planned_only"
  | "blocked"
  | "executable_later";

/**
 * Step-level mutation level. Encodes the escalating authorization
 * model from the scoping doc §6:
 *   - read_only          : DOM read / wait / verify / reinspect
 *   - local_row_commit   : modal-internal Simpan committing to a
 *                          local table (no server round-trip)
 *   - server_save        : page-level Simpan that round-trips to
 *                          the portal server (Maklumat Am, A, B, C)
 *   - upload             : Lampiran file upload
 *   - declaration        : Perakuan tick / `pre_hantar` click
 *   - final_submit       : `pdsL01_button_hantar` (irreversible)
 * Operator gates use `read_only` because the gate itself is a UI
 * pause, not a portal mutation.
 */
export type TenancyInstructionMutationLevel =
  | "read_only"
  | "local_row_commit"
  | "server_save"
  | "upload"
  | "declaration"
  | "final_submit";

/**
 * Step-level kind. The builder emits one of these per step. Selector
 * targeting / DOM verbs come from this enum; the actual side-effect
 * of running the step is captured by `mutationLevel`.
 */
export type TenancyInstructionStepType =
  | "preflight_check"
  | "fill_field"
  | "select_option"
  | "click_button"
  | "wait_for_server"
  | "reinspect_dom"
  | "verify_row_count"
  | "verify_computed_value"
  | "operator_gate"
  | "fail_closed";

/**
 * Stable phase identifiers. The 9-phase shape mirrors the scoping
 * document §4 verbatim. Treat these as opaque strings — never parse
 * them in caller code.
 */
export type TenancyInstructionPhaseId =
  | "phase_0_preflight"
  | "phase_1_session_positioning"
  | "phase_2_maklumat_am_draft"
  | "phase_3_bahagian_a_parties"
  | "phase_4_bahagian_b_rent"
  | "phase_5_bahagian_c_property"
  | "phase_6_lampiran_upload"
  | "phase_7_rumusan_readback"
  | "phase_8_perakuan_hantar";

/**
 * Category of a blocking reason on a `blocked` graph. The category
 * mirrors the readiness gate's view of the world plus an
 * `unsupported_path` bucket for completeness.
 */
export type TenancyInstructionBlockingReasonCategory =
  /** Reasons surfaced by the readiness gate's per-layer checks. */
  | "readiness_blocker"
  /** Reasons from the field-mapping gap evaluator (Categories A–D). */
  | "portal_field_mapping_gap"
  /** This builder only supports fixed-rent residential Kediaman. */
  | "unsupported_path";

/** One blocking reason on a `blocked` graph. */
export interface TenancyInstructionBlockingReason {
  category: TenancyInstructionBlockingReasonCategory;
  /** Stable machine-readable code where available; else short text. */
  code: string;
  /** Operator-facing reason — concrete and actionable. */
  reason: string;
}

/**
 * One typed step within a phase. Steps are emitted in execution
 * order; the runtime (when it exists) processes them sequentially.
 */
export interface TenancyInstructionStep {
  /** Stable per-graph identifier. Format: `<phaseId>__<index>__<stepType>__<key>`. */
  stepId: string;
  stepType: TenancyInstructionStepType;
  mutationLevel: TenancyInstructionMutationLevel;
  executionStatus: TenancyInstructionExecutionStatus;
  /**
   * Operator-facing description. Constructed from fixed vocabulary
   * and non-sensitive counters only. Never contains identity values,
   * raw URLs, raw hrefs, cookies, or tokens.
   */
  description: string;
  /**
   * Optional stable selector key (e.g. `pds_jenis`,
   * `pdsL01_button_hantar`). Never a raw `href`, never a portal
   * numeric ID, never a full URL.
   */
  selectorKey?: string;
  /**
   * For `select_option` and `fill_field` steps, the resolved portal
   * `<option value>` code from the canonical mapping (e.g. `"1101"`
   * for pds_suratcara). Optional. Public fixed-vocabulary value, not
   * job-specific identity data.
   */
  expectedPortalCode?: string;
  /**
   * For `verify_row_count` steps, the expected count. Always a small
   * integer (party count, attachment count). Not sensitive.
   */
  expectedCount?: number;
  /**
   * True when this step is itself an explicit operator gate. Mirrors
   * `stepType === "operator_gate"` for ergonomic filtering.
   */
  isOperatorGate?: boolean;
}

/**
 * One phase. Phases run sequentially Phase 0 → Phase 8.
 */
export interface TenancyInstructionPhase {
  phaseId: TenancyInstructionPhaseId;
  /** Operator-facing phase name. Stable text from the scoping doc. */
  name: string;
  /** Highest mutation level any step in this phase reaches. */
  highestMutationLevel: TenancyInstructionMutationLevel;
  /** Phase-level execution status. */
  executionStatus: TenancyInstructionExecutionStatus;
  /**
   * True when no step in this phase may execute until the operator
   * has explicitly approved. The gate itself is also represented as
   * a step (so the runtime never "skips" the gate even if a phase
   * boundary is crossed without re-checking).
   */
  requiresOperatorGateBefore: boolean;
  /**
   * Optional one-line description of the post-phase save expectation
   * (per scoping doc §5). Free-text, no sensitive values.
   */
  saveCheckpointDescription?: string;
  /** Ordered steps. Empty only on a `blocked` graph. */
  steps: TenancyInstructionStep[];
}

/**
 * Standing authorization markers. Always all-`false` in this
 * milestone. Ensures every consumer of the graph sees an explicit
 * "this graph does not authorize anything" header.
 */
export interface TenancyInstructionAuthorization {
  /** A graph never authorizes browser execution. */
  browserExecution: false;
  /** A graph never authorizes portal mutation. */
  portalMutation: false;
  /** A graph never authorizes payment. */
  payment: false;
  /** A graph never authorizes certificate retrieval. */
  certificateRetrieval: false;
  /** A graph never authorizes final Hantar. */
  finalSubmission: false;
}

/** Top-level instruction graph. */
export interface TenancyInstructionGraph {
  /**
   * Stable, deterministic identifier derived from `jobId` + lane +
   * supportedPath. Same inputs always produce the same `graphId`.
   * Format: `wsg_<8-char-hex>`. NOT a portal draft ID.
   */
  graphId: string;
  /** ISO 8601 timestamp of compilation. */
  compiledAt: string;
  lane: TenancyInstructionGraphLane;
  supportedPath: TenancyInstructionGraphSupportedPath;
  /** WeStamp internal job id, when supplied. NOT the portal draft ID. */
  jobId?: string;
  verdict: TenancyInstructionGraphVerdict;
  /**
   * Empty array when verdict is `ready_for_supervised_run`.
   * Non-empty (and graph has zero steps in mutating phases) when
   * verdict is `blocked`.
   */
  blockingReasons: TenancyInstructionBlockingReason[];
  /**
   * Stable operator-facing action text. On a ready graph this points
   * the operator at the next supervised milestone; on a blocked
   * graph it points them at resolving the blockers.
   */
  safeActionText: string;
  phases: TenancyInstructionPhase[];
  /** Always all-false. The graph authorizes nothing. */
  doesNotAuthorize: TenancyInstructionAuthorization;
}

// ─── Builder input types ───────────────────────────────────────────

/**
 * Job subset the builder reads. Reused from the readiness gate so
 * callers never have to remember which fields are needed.
 */
export type TenancyInstructionGraphJobInput = TenancyPortalRunReadinessJobInput;

/** Builder input. `jobId` and pre-computed report are optional. */
export interface BuildTenancyInstructionGraphInput {
  job: TenancyInstructionGraphJobInput;
  /**
   * WeStamp internal job id. Used (in salted form) to derive the
   * deterministic `graphId`. When omitted the graph is "unanchored"
   * and `graphId` is derived from the lane + path constants only.
   */
  jobId?: string;
  /**
   * Optional pre-computed readiness report. When supplied the
   * builder uses it verbatim and does NOT re-call the readiness
   * gate. Useful for tests and for keeping a single readiness call
   * across UI + builder. When omitted the builder computes the
   * report internally.
   */
  readinessReport?: TenancyPortalRunReadinessReport;
}

// ─── Stable text constants ─────────────────────────────────────────

/** Stable safe-action text on a `ready_for_supervised_run` graph. */
export const SAFE_ACTION_READY =
  "Inspect the planned phases below before authorizing the next supervised milestone. This graph does NOT execute anything; it is design-only.";

/** Stable safe-action text on a `blocked` graph (per the brief). */
export const SAFE_ACTION_BLOCKED =
  "Resolve readiness blockers before building a supervised portal run graph.";

/** Stable phase name labels (operator-facing, stable English). */
const PHASE_NAMES: Record<TenancyInstructionPhaseId, string> = {
  phase_0_preflight: "Phase 0 · Offline preflight",
  phase_1_session_positioning: "Phase 1 · Session and portal positioning",
  phase_2_maklumat_am_draft: "Phase 2 · Maklumat Am draft creation",
  phase_3_bahagian_a_parties: "Phase 3 · Bahagian A party modal pass",
  phase_4_bahagian_b_rent: "Phase 4 · Bahagian B fixed-rent pass",
  phase_5_bahagian_c_property: "Phase 5 · Bahagian C property and land registry",
  phase_6_lampiran_upload: "Phase 6 · Lampiran upload",
  phase_7_rumusan_readback: "Phase 7 · Rumusan Pengiraan readback",
  phase_8_perakuan_hantar: "Phase 8 · Perakuan and final Hantar gates",
};

// ─── Public builder ────────────────────────────────────────────────

/**
 * Build the planned multi-pass instruction graph for a tenancy job.
 *
 * Behaviour:
 *   - When the readiness verdict is NOT `ready_for_supervised_run`,
 *     returns a `blocked` graph with empty phases and a populated
 *     `blockingReasons` list. The runtime (when it exists) cannot
 *     accidentally execute a blocked graph because every phase has
 *     zero steps and `executionStatus === "blocked"`.
 *   - When the readiness verdict is `ready_for_supervised_run`, the
 *     unsupported-path check (§3 of the scoping doc) is enforced as
 *     a defence-in-depth: variable rent / amendment / multi-period
 *     remain blocked even if the gate somehow passed them. (This is
 *     theoretical — the gate already blocks them — but better belt-
 *     and-braces than a bug-class regression.)
 *   - Otherwise emits a 9-phase graph with `executionStatus:
 *     "planned_only"` on every phase and step. The runtime layer to
 *     actually execute Phase 0 onwards is a separate, explicitly-
 *     scoped future milestone.
 *
 * Pure. No I/O. No browser contact. No portal contact.
 */
export function buildTenancyInstructionGraph(
  input: BuildTenancyInstructionGraphInput
): TenancyInstructionGraph {
  const { job, jobId, readinessReport } = input;

  const compiledAt = new Date().toISOString();
  const lane: TenancyInstructionGraphLane = "sewa_pajakan";
  const supportedPath: TenancyInstructionGraphSupportedPath =
    "fixed_rent_residential_kediaman";
  const graphId = deriveGraphId(jobId, lane, supportedPath);
  const doesNotAuthorize: TenancyInstructionAuthorization = {
    browserExecution: false,
    portalMutation: false,
    payment: false,
    certificateRetrieval: false,
    finalSubmission: false,
  };

  // ── Step 1: readiness verdict ──
  const report =
    readinessReport ?? evaluateTenancyPortalRunReadiness(job);

  if (report.verdict !== "ready_for_supervised_run") {
    const blockingReasons = collectBlockingReasonsFromReport(report);
    return {
      graphId,
      compiledAt,
      lane,
      supportedPath,
      ...(typeof jobId === "string" ? { jobId } : {}),
      verdict: "blocked",
      blockingReasons,
      safeActionText: SAFE_ACTION_BLOCKED,
      phases: emitBlockedPhaseSkeleton(),
      doesNotAuthorize,
    };
  }

  // ── Step 2: defence-in-depth unsupported-path check ──
  // The readiness gate already blocks these; we re-check here in
  // case the readiness report was supplied externally and is
  // somehow inconsistent with the job (e.g. a cached report from
  // before the operator switched description type). If hit, this is
  // still a "blocked" graph rather than an Error.
  const unsupportedReasons = collectUnsupportedPathReasons(job);
  if (unsupportedReasons.length > 0) {
    return {
      graphId,
      compiledAt,
      lane,
      supportedPath,
      ...(typeof jobId === "string" ? { jobId } : {}),
      verdict: "blocked",
      blockingReasons: unsupportedReasons,
      safeActionText: SAFE_ACTION_BLOCKED,
      phases: emitBlockedPhaseSkeleton(),
      doesNotAuthorize,
    };
  }

  // ── Step 3: emit the 9-phase ready graph ──
  const phases: TenancyInstructionPhase[] = [
    buildPhase0Preflight(report),
    buildPhase1SessionPositioning(),
    buildPhase2MaklumatAm(job),
    buildPhase3BahagianA(job),
    buildPhase4BahagianB(),
    buildPhase5BahagianC(job),
    buildPhase6LampiranUpload(),
    buildPhase7RumusanReadback(),
    buildPhase8PerakuanHantar(),
  ];

  return {
    graphId,
    compiledAt,
    lane,
    supportedPath,
    ...(typeof jobId === "string" ? { jobId } : {}),
    verdict: "ready_for_supervised_run",
    blockingReasons: [],
    safeActionText: SAFE_ACTION_READY,
    phases,
    doesNotAuthorize,
  };
}

// ─── Convenience adapter ──────────────────────────────────────────

/**
 * Convenience helper for callers holding a full `StampingJob`. Picks
 * the readiness-gate input subset and forwards. Pure.
 */
export function buildTenancyInstructionGraphFromJob(
  job: Pick<
    StampingJob,
    | "id"
    | "tenancyPortalDetails"
    | "storagePath"
    | "originalFileName"
    | "mimeType"
    | "documentCategory"
    | "stampingDetails"
  >
): TenancyInstructionGraph {
  return buildTenancyInstructionGraph({
    job: {
      tenancyPortalDetails: job.tenancyPortalDetails,
      storagePath: job.storagePath,
      originalFileName: job.originalFileName,
      mimeType: job.mimeType,
      documentCategory: job.documentCategory,
      stampingDetails: job.stampingDetails,
    },
    jobId: job.id,
  });
}

// ─── Internal helpers ──────────────────────────────────────────────

/**
 * Stable FNV-1a 32-bit hash. Used only to produce a deterministic
 * `graphId`; not a security-critical hash.
 */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5; // 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function deriveGraphId(
  jobId: string | undefined,
  lane: TenancyInstructionGraphLane,
  supportedPath: TenancyInstructionGraphSupportedPath
): string {
  const seed = `${jobId ?? "unanchored"}::${lane}::${supportedPath}`;
  return `wsg_${fnv1a32Hex(seed)}`;
}

/**
 * Collect blocking reasons from a `blocked` readiness report. The
 * gate's own `blockingReasons` array is the primary source; the
 * structured `portalFieldMappingGaps` are added with their machine-
 * readable codes for telemetry-friendly grouping.
 */
function collectBlockingReasonsFromReport(
  report: TenancyPortalRunReadinessReport
): TenancyInstructionBlockingReason[] {
  const out: TenancyInstructionBlockingReason[] = [];
  // Gap-derived blockers first (structured, with codes).
  for (const g of report.portalFieldMappingGaps) {
    out.push(toGapBlockingReason(g));
  }
  // Remaining gate-level blocking reasons (string-only).
  const gapReasonSet = new Set(
    report.portalFieldMappingGaps.map((g) => g.reason)
  );
  for (const r of report.blockingReasons) {
    if (!gapReasonSet.has(r)) {
      out.push({
        category: "readiness_blocker",
        code: "readiness_blocker",
        reason: r,
      });
    }
  }
  return out;
}

function toGapBlockingReason(
  gap: TenancyPortalFieldMappingGap
): TenancyInstructionBlockingReason {
  return {
    category: "portal_field_mapping_gap",
    code: gap.code,
    reason: gap.reason,
  };
}

/**
 * Defence-in-depth check enforcing the supported-path scope of
 * scoping doc §3. The readiness gate already blocks these but we
 * re-check here so an externally-supplied stale `readinessReport`
 * cannot bypass the path scope.
 */
function collectUnsupportedPathReasons(
  job: TenancyInstructionGraphJobInput
): TenancyInstructionBlockingReason[] {
  const out: TenancyInstructionBlockingReason[] = [];
  const tpd = job.tenancyPortalDetails;

  const descType = tpd?.instrument?.portalDescriptionType ?? null;
  if (descType !== null && descType !== "fixed_rent_during_tenancy") {
    out.push({
      category: "unsupported_path",
      code: `unsupported_pds_jenis_${descType}`,
      reason: `Instruction graph supports fixed_rent_during_tenancy only. Received pds_jenis = ${descType}.`,
    });
  }

  const scheduleLength = tpd?.instrument?.rentSchedule?.length ?? 0;
  if (scheduleLength > 1) {
    out.push({
      category: "unsupported_path",
      code: "unsupported_multi_period_rent",
      reason: `Instruction graph supports a single rent period only. Received ${scheduleLength} periods.`,
    });
  }

  const propertyType = tpd?.property?.propertyType ?? null;
  if (propertyType !== null && propertyType !== "kediaman") {
    out.push({
      category: "unsupported_path",
      code: `unsupported_property_type_${propertyType}`,
      reason: `Instruction graph supports residential (Kediaman) only. Received propertyType = ${propertyType}.`,
    });
  }

  return out;
}

/**
 * Emit a 9-phase skeleton with zero steps and `executionStatus:
 * "blocked"` on every phase. Ensures `phases.length === 9` even on a
 * blocked graph (so consumers can still iterate the canonical phase
 * order) but no step is emitted that the runtime could
 * accidentally execute.
 */
function emitBlockedPhaseSkeleton(): TenancyInstructionPhase[] {
  const ids: TenancyInstructionPhaseId[] = [
    "phase_0_preflight",
    "phase_1_session_positioning",
    "phase_2_maklumat_am_draft",
    "phase_3_bahagian_a_parties",
    "phase_4_bahagian_b_rent",
    "phase_5_bahagian_c_property",
    "phase_6_lampiran_upload",
    "phase_7_rumusan_readback",
    "phase_8_perakuan_hantar",
  ];
  return ids.map((id) => ({
    phaseId: id,
    name: PHASE_NAMES[id],
    highestMutationLevel: "read_only",
    executionStatus: "blocked",
    requiresOperatorGateBefore: false,
    steps: [],
  }));
}

// ── Step builders ────────────────────────────────────────────────

/**
 * Construct a stable step ID. Format:
 *   `<phaseId>__<index>__<stepType>__<key>`
 * `key` is a short stable identifier (e.g. `pds_jenis`,
 * `bahagian_a_simpan`). Never includes any portal-side raw values.
 */
function makeStepId(
  phaseId: TenancyInstructionPhaseId,
  index: number,
  stepType: TenancyInstructionStepType,
  key: string
): string {
  return `${phaseId}__${String(index).padStart(2, "0")}__${stepType}__${key}`;
}

// ── Phase 0 · Preflight ──────────────────────────────────────────

function buildPhase0Preflight(
  report: TenancyPortalRunReadinessReport
): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_0_preflight";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "verify_verdict"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Verify readiness verdict equals ready_for_supervised_run. Builder confirmed this prior to compiling the graph; runtime must re-check before Phase 1.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "source_pdf_present"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Confirm the source PDF storage path is non-empty (Lampiran upload depends on this in Phase 6).",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "fixed_rent_single_period"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Confirm pds_jenis = fixed_rent_during_tenancy and rentSchedule.length === 1. Multi-period or variable rent is not supported by this builder.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "no_blocker_categories"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description: `Confirm no Category A/B/B2/C/D blockers (readiness gate reported ${report.portalFieldMappingGaps.length} field-mapping gaps and ${report.blockingReasons.length} blocking reasons at compile time).`,
  });
  steps.push({
    stepId: makeStepId(
      phaseId,
      i++,
      "operator_gate",
      "before_first_portal_mutation"
    ),
    stepType: "operator_gate",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Operator gate · Approve proceeding to Phase 1 (read-only portal positioning) and Phase 2 (first portal mutation: Maklumat Am draft creation). No portal contact occurs before this gate is approved.",
    isOperatorGate: true,
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "read_only",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "No save (offline). Phase exits via operator approval.",
    steps,
  };
}

// ── Phase 1 · Session and portal positioning ─────────────────────

function buildPhase1SessionPositioning(): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_1_session_positioning";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "on_role_change_path"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Verify the operator's portal session is positioned on the role-change page before role-change anchors are collected. Path classification via classifyPathKind only; the raw URL is never logged.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "collect_role_anchors"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Collect role-change anchors using the existing safe firm-anchor matcher (planned only — matcher is not invoked in this milestone).",
    selectorKey: "stsds_role_change_anchors",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "match_target_firm"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Match collected anchors against the configured target firm (and optional branch) by normalized exact equality. Index-based selection is not permitted. Zero-match, multiple-match, or ambiguous-match all fail closed.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "click_matched_firm_anchor"),
    stepType: "click_button",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Click the unique matched firm-change anchor. Read-only at the portal level (navigation only — no portal-side state mutation).",
    selectorKey: "stsds_matched_firm_anchor",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "preflight_check", "verify_dashboard"),
    stepType: "preflight_check",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Verify post-click path classifies as `dashboard` via classifyPathKind. Any other classification fails closed.",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "read_only",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "No save (read-only on the portal). Phase exits when the operator session is on the Sewa/Pajakan p5 entry path.",
    steps,
  };
}

// ── Phase 2 · Maklumat Am draft creation ─────────────────────────

function buildPhase2MaklumatAm(
  job: TenancyInstructionGraphJobInput
): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_2_maklumat_am_draft";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;
  const tpd = job.tenancyPortalDetails;
  // Defensive resolve — readiness gate has already validated, but
  // we still null-check to keep the builder pure and total.
  const dutyStampCode = tpd?.maklumatAm?.dutyStampType?.code ?? null;
  const instrRel = tpd?.maklumatAm?.instrumentRelationship ?? null;
  const psPortalCode =
    instrRel !== null
      ? TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_PORTAL_CODES[instrRel]
      : null;
  const duplicateCopiesValue = tpd?.instrument?.duplicateCopies ?? null;
  const salinanResult =
    duplicateCopiesValue !== null
      ? mapDuplicateCopies(duplicateCopiesValue)
      : null;

  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_suratcara"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_suratcara (Nama Surat Cara) = Perjanjian Sewa. Fixed canonical code 1101.",
    selectorKey: "pds_suratcara",
    expectedPortalCode: "1101",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_jenis"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_jenis (Jenis Surat Cara) = fixed_rent_during_tenancy. Canonical code 1103.",
    selectorKey: "pds_jenis",
    expectedPortalCode: "1103",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_dutisetem"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_dutisetem (Jenis Duti Setem). Code resolved from the captured Maklumat Am dutyStampType.",
    selectorKey: "pds_dutisetem",
    ...(typeof dutyStampCode === "string" && dutyStampCode.length > 0
      ? { expectedPortalCode: dutyStampCode }
      : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_ps"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_ps (instrument relationship). Code resolved from instrumentRelationship: principal → p, related_lease_49e → s.",
    selectorKey: "pds_ps",
    ...(psPortalCode !== null ? { expectedPortalCode: psPortalCode } : {}),
  });
  if (
    salinanResult !== null &&
    isMappingSafe(salinanResult) &&
    salinanResult.portalCode !== null
  ) {
    steps.push({
      stepId: makeStepId(phaseId, i++, "select_option", "pds_salinan"),
      stepType: "select_option",
      mutationLevel: "server_save",
      executionStatus: "planned_only",
      description:
        "Select pds_salinan (Bilangan Salinan). Code resolved from duplicateCopies via the canonical 0..20 ladder.",
      selectorKey: "pds_salinan",
      expectedPortalCode: salinanResult.portalCode,
    });
  } else {
    steps.push({
      stepId: makeStepId(phaseId, i++, "select_option", "pds_salinan"),
      stepType: "select_option",
      mutationLevel: "server_save",
      executionStatus: "planned_only",
      description:
        "Select pds_salinan (Bilangan Salinan). Code unresolved at compile time — runtime will resolve via the canonical mapping.",
      selectorKey: "pds_salinan",
    });
  }
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_date_suratcara"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Fill pds_date_suratcara (instrument date). Value carried in the payload — runtime fills the YYYY-MM-DD string captured on the job.",
    selectorKey: "pds_date_suratcara",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "simpan_maklumat_am"),
    stepType: "click_button",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Click Simpan Maklumat Am. Triggers portal-side draft creation (server round-trip).",
    selectorKey: "simpan_maklumat_am",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "wait_for_server", "after_maklumat_am_save"),
    stepType: "wait_for_server",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Wait for the server round-trip. Expected outcome: portal allocates a draft ID visible in the edit URL. Any other classification fails closed.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "after_maklumat_am_save"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect the DOM for newly-revealed conditional fields after the Maklumat Am save (Bahagian B/C field counts may shift; Lampiran widget is NOT yet expected here).",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "server_save",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: true,
    saveCheckpointDescription:
      "Save checkpoint · draft creation. Expect URL still classifies as Sewa/Pajakan p5 edit, no bootbox error, draft ID allocated server-side.",
    steps,
  };
}

// ── Phase 3 · Bahagian A party modal pass ────────────────────────

function buildPhase3BahagianA(
  job: TenancyInstructionGraphJobInput
): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_3_bahagian_a_parties";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;
  const parties: TenancyPortalParty[] = job.tenancyPortalDetails?.parties ?? [];

  parties.forEach((p, idx) => {
    const tambahKey =
      p.type === "individual"
        ? "tambah_individu"
        : p.type === "company_ssm"
          ? "tambah_syarikat_ssm"
          : "tambah_syarikat_bukan_ssm";
    const partyOrdinal = `${p.role === "landlord" ? "Landlord" : "Tenant"} #${idx + 1}`;

    steps.push({
      stepId: makeStepId(
        phaseId,
        i++,
        "click_button",
        `tambah_p${idx + 1}`
      ),
      stepType: "click_button",
      mutationLevel: "read_only",
      executionStatus: "planned_only",
      description: `Open Tambah modal (${tambahKey}) for ${partyOrdinal}. Modal-open is non-portal-mutating.`,
      selectorKey: tambahKey,
    });
    steps.push({
      stepId: makeStepId(
        phaseId,
        i++,
        "fill_field",
        `modal_identity_p${idx + 1}`
      ),
      stepType: "fill_field",
      mutationLevel: "read_only",
      executionStatus: "planned_only",
      description: `Fill the party-identity fields in the modal for ${partyOrdinal} (USER_SEX, warga, EPD_NOKP_TYPE when NRIC, plus SSM-only fields for company_ssm). Identity values are read at runtime from the captured party record; this step records intent only.`,
      selectorKey: "party_modal_identity_fields",
    });
    steps.push({
      stepId: makeStepId(
        phaseId,
        i++,
        "click_button",
        `modal_simpan_p${idx + 1}`
      ),
      stepType: "click_button",
      mutationLevel: "local_row_commit",
      executionStatus: "planned_only",
      description: `Click the modal's local Simpan for ${partyOrdinal}. Commits the row to the local Bahagian A table; does NOT round-trip to the server.`,
      selectorKey: "party_modal_simpan",
    });
  });

  steps.push({
    stepId: makeStepId(phaseId, i++, "verify_row_count", "bahagian_a_parties"),
    stepType: "verify_row_count",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description: `Verify the local Bahagian A table row count equals the captured party count.`,
    selectorKey: "bahagian_a_party_table",
    expectedCount: parties.length,
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "simpan_bahagian_a"),
    stepType: "click_button",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Click page-level Simpan Bahagian A to round-trip the committed party rows to the server.",
    selectorKey: "simpan_bahagian_a",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "wait_for_server", "after_bahagian_a_save"),
    stepType: "wait_for_server",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Wait for the server round-trip. Expect URL still classifies as Sewa/Pajakan p5 edit and no bootbox error.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "after_bahagian_a_save"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect the DOM for any newly-revealed fields after Bahagian A save.",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "server_save",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "Save checkpoint · Bahagian A. Expect saved party row count equals the captured party count.",
    steps,
  };
}

// ── Phase 4 · Bahagian B fixed-rent pass ─────────────────────────

function buildPhase4BahagianB(): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_4_bahagian_b_rent";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_balasan"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Fill pds_balasan (Balasan / Premium) when the operator-supplied Maklumat Am balasan is required for this pds_jenis path. Never auto-derived from the rent schedule.",
    selectorKey: "pds_balasan",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "simpan_bahagian_b"),
    stepType: "click_button",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Click Simpan Bahagian B to round-trip rent / consideration values to the server.",
    selectorKey: "simpan_bahagian_b",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "wait_for_server", "after_bahagian_b_save"),
    stepType: "wait_for_server",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Wait for the server round-trip after Bahagian B save.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "after_bahagian_b_save"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect the DOM for any newly-revealed fields after Bahagian B save. Variable-rent / amendment / multi-period reveal targets are explicitly out of scope for this builder.",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "server_save",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "Save checkpoint · Bahagian B. Fixed-rent single-period only. Variable rent / amendment / multi-period are deferred.",
    steps,
  };
}

// ── Phase 5 · Bahagian C property and land registry ──────────────

function buildPhase5BahagianC(
  job: TenancyInstructionGraphJobInput
): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_5_bahagian_c_property";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;
  const property = job.tenancyPortalDetails?.property;

  // Resolve canonical mapping codes once. The readiness gate has
  // already verified each is `mapped`; defensive null-checks keep
  // the function pure and total.
  const stateMap = property?.state ? mapPropertyState(property.state) : null;
  const countryMap = property?.country
    ? mapPropertyCountry(property.country)
    : null;
  const catMap = property
    ? mapPropertyCategory(property.propertyType, property.buildingType)
    : null;
  const furnMap =
    property && property.furnishedStatus !== undefined
      ? mapFurnishedStatus(property.furnishedStatus)
      : null;
  const luasUnitCode = property?.landRegistry?.luasUnit
    ? TENANCY_PORTAL_LAND_AREA_UNIT_PORTAL_CODES[property.landRegistry.luasUnit]
    : null;

  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_alamat_1"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Fill pds_alamat_1 (Bahagian C address line 1). Value sourced from property.addressLine1; the field key is recorded here, the value is not.",
    selectorKey: "pds_alamat_1",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_poskod"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_poskod (postcode).",
    selectorKey: "pds_poskod",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_city"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_city (city).",
    selectorKey: "pds_city",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_harta_state"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_harta_state (property state). Portal `<option value>` resolved via the canonical state mapping.",
    selectorKey: "pds_harta_state",
    ...(stateMap && isMappingSafe(stateMap) && stateMap.portalCode !== null
      ? { expectedPortalCode: stateMap.portalCode }
      : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_harta_country"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_harta_country (property country). Portal `<option value>` resolved via the canonical country mapping (Malaysia = 146).",
    selectorKey: "pds_harta_country",
    ...(countryMap && isMappingSafe(countryMap) && countryMap.portalCode !== null
      ? { expectedPortalCode: countryMap.portalCode }
      : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_harta_type"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Select pds_harta_type (property type) = Kediaman. Fixed canonical code 1107.",
    selectorKey: "pds_harta_type",
    expectedPortalCode: "1107",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_floor"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_floor (floor / unit).",
    selectorKey: "pds_floor",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_mp"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_mp (Milik Penuh / land-title proprietorship descriptor).",
    selectorKey: "pds_mp",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_harta_cat"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_harta_cat (Jenis Bangunan, the per-property-type building category). Portal `<option value>` resolved via the canonical Kediaman mapping.",
    selectorKey: "pds_harta_cat_kediaman",
    ...(catMap && isMappingSafe(catMap) && catMap.portalCode !== null
      ? { expectedPortalCode: catMap.portalCode }
      : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_lot"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_lot (No. Lot from the land registry).",
    selectorKey: "pds_lot",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_mukim"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_mukim (Mukim from the land registry).",
    selectorKey: "pds_mukim",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_daerah"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Fill pds_daerah (Daerah from the land registry).",
    selectorKey: "pds_daerah",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "fill_field", "pds_luas"),
    stepType: "fill_field",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Fill pds_luas (Luas Tanah numeric). Distinct from the WeStamp-side premisesAreaSqm (built-up area).",
    selectorKey: "pds_luas",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_luasunit"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_luasunit (Unit Luas). Portal code resolved from the WeStamp luasUnit enum (ekar=1, hektar=2, kps=3, mps=4).",
    selectorKey: "pds_luasunit",
    ...(luasUnitCode !== null ? { expectedPortalCode: luasUnitCode } : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "select_option", "pds_harta_perabot"),
    stepType: "select_option",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description:
      "Select pds_harta_perabot (furnishing). Portal code resolved via the canonical furnishedStatus mapping.",
    selectorKey: "pds_harta_perabot",
    ...(furnMap && isMappingSafe(furnMap) && furnMap.portalCode !== null
      ? { expectedPortalCode: furnMap.portalCode }
      : {}),
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "simpan_bahagian_c"),
    stepType: "click_button",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Click Simpan Bahagian C to round-trip property + land-registry to the server.",
    selectorKey: "simpan_bahagian_c",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "wait_for_server", "after_bahagian_c_save"),
    stepType: "wait_for_server",
    mutationLevel: "server_save",
    executionStatus: "planned_only",
    description: "Wait for the server round-trip after Bahagian C save.",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "after_bahagian_c_save"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect the DOM. Lampiran upload widget is expected to load conditionally on saved Bahagian B/C state and is checked at the start of Phase 6.",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "server_save",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "Save checkpoint · Bahagian C. Expect property + land-registry persisted; Lampiran widget revealed for Phase 6.",
    steps,
  };
}

// ── Phase 6 · Lampiran upload ────────────────────────────────────

function buildPhase6LampiranUpload(): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_6_lampiran_upload";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "lampiran_upload_widget"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect for the Lampiran upload widget (`<input type=\"file\">`). Fail closed if it is not present after a bounded wait.",
    selectorKey: "lampiran_file_input",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "operator_gate", "before_upload"),
    stepType: "operator_gate",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Operator gate · Approve uploading the source PDF (mutation: Lampiran upload).",
    isOperatorGate: true,
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "upload_source_pdf"),
    stepType: "click_button",
    mutationLevel: "upload",
    executionStatus: "planned_only",
    description:
      "Upload the source PDF via setInputFiles on the Lampiran file input. The PDF storage path is read at runtime from the job; the path itself is not embedded in the graph.",
    selectorKey: "lampiran_file_input",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "verify_row_count", "lampiran_attachment_row"),
    stepType: "verify_row_count",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Verify the upload row appears (one attachment row). Fail closed if not.",
    selectorKey: "lampiran_attachment_row",
    expectedCount: 1,
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "upload",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "Save checkpoint · Lampiran upload. Expect one attachment row visible after a bounded wait.",
    steps,
  };
}

// ── Phase 7 · Rumusan Pengiraan readback ─────────────────────────

function buildPhase7RumusanReadback(): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_7_rumusan_readback";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "reinspect_dom", "rumusan_readonly_fields"),
    stepType: "reinspect_dom",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Re-inspect Rumusan Pengiraan readonly fields (d_sc, d_ab, dt_kena, dt_remit, pnlt, slnn, jslnn, jmlh) once they unhide post server-side calc.",
    selectorKey: "rumusan_readonly_block",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "verify_computed_value", "duty_compare"),
    stepType: "verify_computed_value",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Compare portal-computed total duty against WeStamp's calculatedDuty.totalDuty. Mismatch is an operator-review blocker, not an auto-fix — emits an operator gate at runtime; the compiler never silently uses the server duty.",
    selectorKey: "rumusan_total_duty",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "read_only",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "No save (readback only). Operator decision on duty mismatch is gated, not silently coerced.",
    steps,
  };
}

// ── Phase 8 · Perakuan and final Hantar gates ────────────────────

function buildPhase8PerakuanHantar(): TenancyInstructionPhase {
  const phaseId: TenancyInstructionPhaseId = "phase_8_perakuan_hantar";
  const steps: TenancyInstructionStep[] = [];
  let i = 0;

  steps.push({
    stepId: makeStepId(phaseId, i++, "operator_gate", "before_declaration"),
    stepType: "operator_gate",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Operator gate · Approve ticking the Perakuan declaration checkbox (pds_akuan).",
    isOperatorGate: true,
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "tick_pds_akuan"),
    stepType: "click_button",
    mutationLevel: "declaration",
    executionStatus: "planned_only",
    description: "Tick the pds_akuan declaration checkbox.",
    selectorKey: "pds_akuan",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "operator_gate", "before_pre_hantar"),
    stepType: "operator_gate",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Operator gate · Approve clicking pre_hantar (opens the portal confirmation modal).",
    isOperatorGate: true,
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "pre_hantar"),
    stepType: "click_button",
    mutationLevel: "declaration",
    executionStatus: "planned_only",
    description:
      "Click pre_hantar to open the portal confirmation modal. The modal must be confirmed by the operator before the irreversible final Hantar.",
    selectorKey: "pre_hantar",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "operator_gate", "before_final_hantar"),
    stepType: "operator_gate",
    mutationLevel: "read_only",
    executionStatus: "planned_only",
    description:
      "Operator gate · Approve final Hantar. This gate guards the irreversible submission step (pdsL01_button_hantar).",
    isOperatorGate: true,
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "modal_confirm"),
    stepType: "click_button",
    mutationLevel: "final_submit",
    executionStatus: "planned_only",
    description:
      "Click the confirmation modal's accept button. Reveals pdsL01_button_hantar.",
    selectorKey: "perakuan_modal_confirm",
  });
  steps.push({
    stepId: makeStepId(phaseId, i++, "click_button", "final_hantar"),
    stepType: "click_button",
    mutationLevel: "final_submit",
    executionStatus: "planned_only",
    description:
      "Click pdsL01_button_hantar. IRREVERSIBLE final Hantar. The runtime layer required to execute this step does NOT exist in this milestone.",
    selectorKey: "pdsL01_button_hantar",
  });

  return {
    phaseId,
    name: PHASE_NAMES[phaseId],
    highestMutationLevel: "final_submit",
    executionStatus: "planned_only",
    requiresOperatorGateBefore: false,
    saveCheckpointDescription:
      "No save (final submission). The first implementation milestone may stop at the operator gate before pre_hantar; clicking pdsL01_button_hantar is irreversible and out of scope for this milestone.",
    steps,
  };
}
