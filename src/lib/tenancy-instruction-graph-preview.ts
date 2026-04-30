/**
 * WeStamp — Tenancy Instruction Graph Preview · view-model helper
 *
 * Pure, framework-free helper that converts a
 * `TenancyInstructionGraph` (the offline, planned multi-pass
 * instruction graph produced by `buildTenancyInstructionGraph`) into
 * a flat, render-ready view-model used by the operator-side
 * `Instruction Graph Preview` panel (Milestone B1).
 *
 * What this module IS
 * ───────────────────
 * - A pure adapter. Given a graph, returns a view-model with stable
 *   operator-facing strings (banner text, phase rows, operator-gate
 *   labels, blocked-summary lines).
 * - The single source of truth for the wording surfaced under the
 *   `Instruction Graph Preview` heading in the operator UI. The
 *   React component that renders it MUST NOT compose its own
 *   wording — it consumes this view-model verbatim.
 * - Defensive about sensitive data: every string emitted is built
 *   from a fixed vocabulary or deterministic counters (phase count,
 *   step count, blocker count). No party names, no addresses, no IC,
 *   no TIN, no URLs, no `href`s, no cookies, no tokens.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute the graph. The view-model is metadata only.
 * - It does NOT add a "Run" / "Execute" / "Submit" / "Send" affordance.
 * - It does NOT touch the portal, payment, OCR, or certificate
 *   retrieval surfaces.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print logic.
 *
 * Forbidden wording (per the B1 brief)
 * ────────────────────────────────────
 * The view-model never emits any of the following words / phrases:
 *   - "automated"
 *   - "submitted"
 *   - "sent to LHDN"
 *   - "executed"
 *   - "completed"
 *   - "portal run started"
 * Test 6 in `tenancy-instruction-graph-preview.test.ts` enforces
 * this graph-wide.
 */

import type {
  TenancyInstructionGraph,
  TenancyInstructionMutationLevel,
  TenancyInstructionExecutionStatus,
  TenancyInstructionGraphSupportedPath,
  TenancyInstructionStep,
  TenancyInstructionPhase,
  TenancyInstructionBlockingReasonCategory,
} from "./tenancy-instruction-graph";

// ─── Public types ──────────────────────────────────────────────────

/**
 * One row in the per-phase table the panel renders. All fields are
 * non-sensitive (no party identity values, no addresses, no URLs).
 */
export interface InstructionGraphPreviewPhaseRow {
  phaseId: string;
  /** Operator-facing phase name straight from the graph. */
  phaseName: string;
  /** Human-readable mutation level (e.g. `"Server save"`). */
  mutationLevelLabel: string;
  /** Human-readable execution status (always `"Planned only"` in B1). */
  executionStatusLabel: string;
  /** Number of steps the phase plans. Always a small integer. */
  stepCount: number;
  /** True when this phase contains or requires at least one operator gate. */
  hasOperatorGate: boolean;
}

/** One concise label for the operator-gate list. */
export interface InstructionGraphPreviewGateLabel {
  /** Stable matching key (the step ID substring, e.g. `before_upload`). */
  key: string;
  /** Approved B1 wording (verbatim) — e.g. `"before upload"`. */
  label: string;
  /** Phase that contains the gate, e.g. `"Phase 6 · Lampiran upload"`. */
  phaseName: string;
}

/**
 * One blocker group in the blocked-graph summary. Aggregates by the
 * graph's blocker category to keep the panel concise; the operator
 * can drill into the existing Portal Run Readiness section above for
 * the verbose reason text.
 */
export interface InstructionGraphPreviewBlockedGroup {
  category: TenancyInstructionBlockingReasonCategory;
  /** Operator-facing label for the category. */
  categoryLabel: string;
  /** How many blockers fall into this category. */
  count: number;
  /** Up to three stable codes per category, telemetry-style. */
  representativeCodes: string[];
}

/** Blocked summary, populated only when the graph verdict is `blocked`. */
export interface InstructionGraphPreviewBlockedSummary {
  /** Verbatim from `graph.safeActionText`. Already approved wording. */
  safeActionText: string;
  /** Aggregated blocker groups, ordered by category. */
  groups: InstructionGraphPreviewBlockedGroup[];
}

/** Top-level view-model. The React component renders this as-is. */
export interface InstructionGraphPreviewViewModel {
  /** B1 approved heading. Constant text. */
  heading: string;
  /** B1 approved standing helper text. Constant text. */
  helperText: string;
  /** B1 approved future-execution caveat. Constant text. */
  futureExecutionLabel: string;
  /** Single short caveat about final Hantar. Constant text. */
  finalHantarCaveat: string;
  /** Single short caveat reading "this graph authorizes nothing". */
  authorizationCaveat: string;
  /** Approved banner wording + tone for the verdict. */
  banner: {
    text: string;
    tone: "ready" | "blocked";
  };
  /** Stable label for the graph's `supportedPath`. */
  supportedPathLabel: string;
  /** Stable label for the graph's `lane`. */
  laneLabel: string;
  /** Per-phase rows. Empty when verdict is `blocked`. */
  phases: InstructionGraphPreviewPhaseRow[];
  /** Operator-gate concise list. Empty when verdict is `blocked`. */
  operatorGates: InstructionGraphPreviewGateLabel[];
  /** Populated when verdict is `blocked`; null otherwise. */
  blockedSummary: InstructionGraphPreviewBlockedSummary | null;
  /**
   * Stable graph identifier — exposed for telemetry / aria-label
   * only. NOT a portal draft ID.
   */
  graphId: string;
}

// ─── Approved B1 wording (constants) ───────────────────────────────

export const PREVIEW_HEADING = "Instruction Graph Preview";

export const PREVIEW_HELPER_TEXT =
  "This is a planned, non-executing graph for a future supervised portal run. No e-Duti Setem action has been taken.";

export const PREVIEW_BANNER_READY = "Graph ready for supervised-run planning";
export const PREVIEW_BANNER_BLOCKED = "Graph blocked by readiness issues";

export const PREVIEW_PLANNED_ONLY_LABEL = "Planned only";
export const PREVIEW_BLOCKED_STATUS_LABEL = "Blocked";
export const PREVIEW_EXECUTABLE_LATER_LABEL = "Executable later";

export const PREVIEW_FUTURE_EXECUTION_LABEL =
  "Execution not implemented in this milestone";

export const PREVIEW_FINAL_HANTAR_CAVEAT =
  "Final Hantar still requires explicit operator approval in a future milestone.";

export const PREVIEW_AUTHORIZATION_CAVEAT =
  "This planned graph does not authorize browser execution, portal mutation, payment, certificate retrieval, or final submission.";

// ─── Internal label maps ───────────────────────────────────────────

const MUTATION_LEVEL_LABELS: Record<TenancyInstructionMutationLevel, string> = {
  read_only: "Read only",
  local_row_commit: "Local row commit",
  server_save: "Server save",
  upload: "Upload",
  declaration: "Declaration",
  final_submit: "Final submit",
};

const EXECUTION_STATUS_LABELS: Record<
  TenancyInstructionExecutionStatus,
  string
> = {
  planned_only: PREVIEW_PLANNED_ONLY_LABEL,
  blocked: PREVIEW_BLOCKED_STATUS_LABEL,
  executable_later: PREVIEW_EXECUTABLE_LATER_LABEL,
};

const SUPPORTED_PATH_LABELS: Record<
  TenancyInstructionGraphSupportedPath,
  string
> = {
  fixed_rent_residential_kediaman:
    "Fixed-rent residential (Kediaman) tenancy",
};

const LANE_LABEL = "Sewa / Pajakan";

const BLOCKER_CATEGORY_LABELS: Record<
  TenancyInstructionBlockingReasonCategory,
  string
> = {
  readiness_blocker: "Readiness gate blocker",
  portal_field_mapping_gap: "Portal field-mapping gap",
  unsupported_path: "Unsupported path",
};

/**
 * Stable mapping from operator-gate step-ID suffix to the brief's
 * verbatim concise label. Keys mirror the suffixes emitted by
 * `tenancy-instruction-graph.ts` so a drift between modules trips a
 * test rather than a runtime mismatch.
 */
const OPERATOR_GATE_LABEL_BY_KEY: Record<string, string> = {
  before_first_portal_mutation: "before first portal mutation",
  before_upload: "before upload",
  before_declaration: "before declaration",
  before_pre_hantar: "before pre-Hantar",
  before_final_hantar: "before final Hantar",
};

// ─── Public builder ────────────────────────────────────────────────

/**
 * Build the operator-side preview view-model from an instruction
 * graph. Pure. Free of sensitive data — every string is composed
 * from fixed vocabulary or non-sensitive counters.
 */
export function buildInstructionGraphPreviewViewModel(
  graph: TenancyInstructionGraph
): InstructionGraphPreviewViewModel {
  const isReady = graph.verdict === "ready_for_supervised_run";

  const banner: InstructionGraphPreviewViewModel["banner"] = isReady
    ? { text: PREVIEW_BANNER_READY, tone: "ready" }
    : { text: PREVIEW_BANNER_BLOCKED, tone: "blocked" };

  const supportedPathLabel =
    SUPPORTED_PATH_LABELS[graph.supportedPath] ?? graph.supportedPath;

  // Phase rows — populated for ready graphs; collapsed to an empty
  // list when blocked so the panel renders only the blocked summary.
  const phases: InstructionGraphPreviewPhaseRow[] = isReady
    ? graph.phases.map((phase) => ({
        phaseId: phase.phaseId,
        phaseName: phase.name,
        mutationLevelLabel: MUTATION_LEVEL_LABELS[phase.highestMutationLevel],
        executionStatusLabel: EXECUTION_STATUS_LABELS[phase.executionStatus],
        stepCount: phase.steps.length,
        hasOperatorGate: phaseHasOperatorGate(phase),
      }))
    : [];

  // Operator gates — concise, stable, brief-approved labels in
  // graph-traversal order. Empty for blocked graphs.
  const operatorGates: InstructionGraphPreviewGateLabel[] = isReady
    ? collectOperatorGateLabels(graph)
    : [];

  // Blocked summary — null on ready graphs.
  const blockedSummary: InstructionGraphPreviewBlockedSummary | null = isReady
    ? null
    : {
        safeActionText: graph.safeActionText,
        groups: aggregateBlockedReasons(graph),
      };

  return {
    heading: PREVIEW_HEADING,
    helperText: PREVIEW_HELPER_TEXT,
    futureExecutionLabel: PREVIEW_FUTURE_EXECUTION_LABEL,
    finalHantarCaveat: PREVIEW_FINAL_HANTAR_CAVEAT,
    authorizationCaveat: PREVIEW_AUTHORIZATION_CAVEAT,
    banner,
    supportedPathLabel,
    laneLabel: LANE_LABEL,
    phases,
    operatorGates,
    blockedSummary,
    graphId: graph.graphId,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

function phaseHasOperatorGate(phase: TenancyInstructionPhase): boolean {
  if (phase.requiresOperatorGateBefore) return true;
  return phase.steps.some((s) => s.stepType === "operator_gate");
}

/**
 * Collect operator gate labels in graph order. Each gate's stepId
 * suffix is mapped to the brief's verbatim concise label; a gate
 * whose suffix is unknown is intentionally dropped (defence in depth
 * — never invent operator-facing wording from an unknown source).
 */
function collectOperatorGateLabels(
  graph: TenancyInstructionGraph
): InstructionGraphPreviewGateLabel[] {
  const out: InstructionGraphPreviewGateLabel[] = [];
  for (const phase of graph.phases) {
    for (const step of phase.steps) {
      if (step.stepType !== "operator_gate") continue;
      const key = extractOperatorGateKey(step);
      if (key === null) continue;
      const label = OPERATOR_GATE_LABEL_BY_KEY[key];
      if (typeof label !== "string") continue;
      out.push({ key, label, phaseName: phase.name });
    }
  }
  return out;
}

/**
 * Extract the gate key from the step ID. The graph builder uses the
 * format `<phaseId>__<index>__operator_gate__<key>`; we split on the
 * `__operator_gate__` separator. Returns null when the format does
 * not match (defence in depth).
 */
function extractOperatorGateKey(step: TenancyInstructionStep): string | null {
  const sep = "__operator_gate__";
  const idx = step.stepId.lastIndexOf(sep);
  if (idx < 0) return null;
  const tail = step.stepId.substring(idx + sep.length);
  return tail.length > 0 ? tail : null;
}

/**
 * Group blocker reasons by category, returning a small summary per
 * category (count + up to three stable codes). The verbose reason
 * text is intentionally omitted — operators see it in the existing
 * Portal Run Readiness section above the preview.
 */
function aggregateBlockedReasons(
  graph: TenancyInstructionGraph
): InstructionGraphPreviewBlockedGroup[] {
  const order: TenancyInstructionBlockingReasonCategory[] = [
    "readiness_blocker",
    "portal_field_mapping_gap",
    "unsupported_path",
  ];
  return order
    .map((category) => {
      const inCategory = graph.blockingReasons.filter(
        (r) => r.category === category
      );
      if (inCategory.length === 0) return null;
      const codes = inCategory.slice(0, 3).map((r) => r.code);
      return {
        category,
        categoryLabel: BLOCKER_CATEGORY_LABELS[category],
        count: inCategory.length,
        representativeCodes: codes,
      };
    })
    .filter((g): g is InstructionGraphPreviewBlockedGroup => g !== null);
}
