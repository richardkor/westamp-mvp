/**
 * WeStamp — Tenancy Supervised Session · Phase-Positioning Summary
 *
 * Pure helper that derives a multi-phase compatibility breakdown
 * from an existing `SupervisedSessionReport`. Surfaces, side-by-
 * side, whether the operator's currently-detected browser position
 * is compatible with each of three phase groups:
 *
 *   - Phase 1 — session positioning
 *   - Phase 2 — Maklumat Am draft planning
 *   - Later p5 form phases (Bahagian A through Perakuan)
 *
 * The single existing `report.graphPhaseCompatibility` only answers
 * "is the page compatible with the ONE target phase the caller
 * asked about?". Operators reading the Browser Session Status card
 * benefit from seeing the full position picture at a glance — this
 * helper provides exactly that, with no extra portal contact and no
 * extra state.
 *
 * What this module IS
 * ───────────────────
 * - A pure adapter over `SupervisedSessionReport`. Reads only the
 *   already-sanitized `pageKind` and `reachable` fields. Never
 *   touches the network, never invokes Playwright, never reads
 *   cookies or storage.
 * - The single source of truth for the "Browser position is
 *   compatible with the planned phase" / "Browser position is not
 *   compatible with the planned phase" wording approved in the B5
 *   brief.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute portal actions. It does NOT click, fill,
 *   select, type, upload, submit, or save anything.
 * - It does NOT navigate the operator's Chrome.
 * - It does NOT introduce a new state machine — it is a pure
 *   single-shot adapter.
 *
 * Sensitive-data policy
 * ─────────────────────
 * The output contains only fixed-vocabulary strings (phase labels,
 * compatibility labels, summary sentences) and small enum values.
 * Test 5 in `tenancy-supervised-phase-positioning.test.ts` enforces
 * the standing forbidden-pattern set against the serialized output.
 */

import type {
  GraphPhaseCompatibility,
  SupervisedSessionPageKind,
  SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";

// ─── Public types ──────────────────────────────────────────────────

/** Three coarse phase groups operators reason about. */
export type PhaseGroupId =
  | "phase_1_session_positioning"
  | "phase_2_maklumat_am_draft"
  | "later_p5_form_phases";

/** One per-phase row. */
export interface PhasePositioningRow {
  phaseGroupId: PhaseGroupId;
  /** Operator-facing phase label (stable English). */
  phaseLabel: string;
  /** Per-row compatibility derived from the report's pageKind. */
  compatibility: GraphPhaseCompatibility;
  /** Operator-facing compatibility label. */
  compatibilityLabel: string;
}

/** Top-level summary returned by the helper. */
export interface PhasePositioningSummary {
  /** Three rows, in stable canonical order. */
  rows: PhasePositioningRow[];
  /**
   * Single short sentence that uses the brief's approved B5 wording.
   * Reflects compatibility against the SAME target phase the report
   * was generated for (so the card's primary "Phase compatibility"
   * line and this summary stay in lockstep).
   */
  overallSummary: string;
}

// ─── Approved wording (constants) ──────────────────────────────────

export const PHASE_LABEL_PHASE_1 = "Phase 1 — session positioning";
export const PHASE_LABEL_PHASE_2 = "Phase 2 — Maklumat Am draft planning";
export const PHASE_LABEL_LATER_P5 = "Later p5 form phases";

export const PHASE_COMPAT_LABEL_COMPATIBLE = "Compatible";
export const PHASE_COMPAT_LABEL_INCOMPATIBLE = "Incompatible";
export const PHASE_COMPAT_LABEL_UNKNOWN = "Not yet known";

export const SUMMARY_COMPATIBLE =
  "Browser position is compatible with the planned phase";
export const SUMMARY_NOT_COMPATIBLE =
  "Browser position is not compatible with the planned phase";
export const SUMMARY_UNKNOWN =
  "Browser position cannot be determined yet";

const COMPAT_LABELS: Record<GraphPhaseCompatibility, string> = {
  compatible: PHASE_COMPAT_LABEL_COMPATIBLE,
  incompatible: PHASE_COMPAT_LABEL_INCOMPATIBLE,
  unknown: PHASE_COMPAT_LABEL_UNKNOWN,
};

const PHASE_LABELS: Record<PhaseGroupId, string> = {
  phase_1_session_positioning: PHASE_LABEL_PHASE_1,
  phase_2_maklumat_am_draft: PHASE_LABEL_PHASE_2,
  later_p5_form_phases: PHASE_LABEL_LATER_P5,
};

// ─── Public builder ────────────────────────────────────────────────

/**
 * Build the multi-phase positioning summary from an existing
 * sanitized session report. Pure. Total. Free of I/O.
 *
 * Compatibility rules (derived from
 * `tenancy-supervised-session-shell.ts` §`deriveGraphPhaseCompatibility`):
 *   - Phase 1 (session positioning) → compatible on `stamps_role_change`
 *     or `stamps_dashboard`; unknown when CDP unreachable; otherwise
 *     incompatible.
 *   - Phase 2 (Maklumat Am draft planning) AND later p5 phases →
 *     compatible on `sewa_pajakan_p5_form`; unknown when CDP
 *     unreachable; otherwise incompatible.
 *
 * `overallSummary` mirrors the report's existing
 * `graphPhaseCompatibility` so this helper stays in lockstep with
 * the card's primary phase-compatibility line.
 */
export function buildPhasePositioningSummary(
  report: SupervisedSessionReport
): PhasePositioningSummary {
  const phase1 = derivePhase1Compatibility(report.pageKind, report.reachable);
  const phase2 = deriveP5Compatibility(report.pageKind, report.reachable);
  const laterP5 = deriveP5Compatibility(report.pageKind, report.reachable);

  return {
    rows: [
      makeRow("phase_1_session_positioning", phase1),
      makeRow("phase_2_maklumat_am_draft", phase2),
      makeRow("later_p5_form_phases", laterP5),
    ],
    overallSummary: deriveOverallSummary(report.graphPhaseCompatibility),
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

function derivePhase1Compatibility(
  pageKind: SupervisedSessionPageKind,
  reachable: boolean
): GraphPhaseCompatibility {
  if (!reachable) return "unknown";
  if (pageKind === "stamps_role_change" || pageKind === "stamps_dashboard") {
    return "compatible";
  }
  if (pageKind === "unknown") return "unknown";
  return "incompatible";
}

function deriveP5Compatibility(
  pageKind: SupervisedSessionPageKind,
  reachable: boolean
): GraphPhaseCompatibility {
  if (!reachable) return "unknown";
  if (pageKind === "sewa_pajakan_p5_form") return "compatible";
  if (pageKind === "unknown") return "unknown";
  return "incompatible";
}

function makeRow(
  phaseGroupId: PhaseGroupId,
  compat: GraphPhaseCompatibility
): PhasePositioningRow {
  return {
    phaseGroupId,
    phaseLabel: PHASE_LABELS[phaseGroupId],
    compatibility: compat,
    compatibilityLabel: COMPAT_LABELS[compat],
  };
}

function deriveOverallSummary(
  primary: GraphPhaseCompatibility
): string {
  switch (primary) {
    case "compatible":
      return SUMMARY_COMPATIBLE;
    case "incompatible":
      return SUMMARY_NOT_COMPATIBLE;
    case "unknown":
      return SUMMARY_UNKNOWN;
  }
}
