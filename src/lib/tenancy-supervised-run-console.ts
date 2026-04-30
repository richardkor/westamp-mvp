/**
 * WeStamp — Tenancy Supervised Run Console · view-model helper
 *
 * Pure, framework-free helper that turns the existing readiness
 * report + offline instruction graph + preview view-model into an
 * operator-facing console summary for the future supervised
 * e-Duti Setem run.
 *
 * What this module IS
 * ───────────────────
 * - A pure adapter. Given a readiness report + instruction graph +
 *   preview view-model + the same job input the readiness gate
 *   sees, returns a `SupervisedRunConsoleViewModel` containing:
 *     · banner + eligibility wording (B2 approved strings)
 *     · graph summary (verdict, supported path, phase count, gate
 *       count)
 *     · preflight checklist (8 items per the B2 brief)
 *     · blocked summary when verdict is `blocked`
 *     · standing helper text + caveats
 * - Sensitive-data-safe by design: every string emitted is composed
 *   from a fixed vocabulary or a small non-sensitive counter.
 * - The single source of truth for the "Supervised Run Console"
 *   wording rendered by the React panel; the panel must not compose
 *   its own strings from raw job values.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT execute anything. The view-model is metadata only.
 * - It does NOT add a "Run" / "Execute" / "Submit" / "Send" / "Pay"
 *   affordance. The optional refresh action is a non-mutating
 *   "Refresh Run Plan" label only.
 * - It does NOT touch the portal, payment, OCR, or certificate
 *   retrieval surfaces.
 * - It does NOT modify agreement-generation, agreement-template,
 *   clause-numbering, Annexure A, lawyer-CTA, or browser-print
 *   logic.
 *
 * Forbidden wording (per the B2 brief)
 * ────────────────────────────────────
 * The view-model never emits any of:
 *   - "automated submission"
 *   - "submitted to LHDN"
 *   - "portal run started"
 *   - "execution completed"
 *   - the lone word "sent"
 *   - "paid"
 *   - "certificate retrieved"
 * Test 6 in `tenancy-supervised-run-console.test.ts` enforces this.
 */

import type {
  TenancyInstructionGraph,
  TenancyInstructionGraphSupportedPath,
} from "./tenancy-instruction-graph";
import type {
  InstructionGraphPreviewViewModel,
  InstructionGraphPreviewBlockedGroup,
} from "./tenancy-instruction-graph-preview";
import type {
  TenancyPortalFieldMappingGap,
  TenancyPortalFieldMappingGapCategory,
  TenancyPortalRunReadinessJobInput,
  TenancyPortalRunReadinessReport,
  TenancyPortalRunReadinessVerdict,
} from "./tenancy-portal-run-readiness";

// ─── Public types ──────────────────────────────────────────────────

/** Console-level eligibility for a future supervised run. */
export type SupervisedRunEligibility = "eligible" | "not_eligible";

/** Status of a single preflight checklist item. Pure binary. */
export type PreflightChecklistStatus = "pass" | "fail";

/** Stable identifiers for the eight preflight checklist categories. */
export type PreflightChecklistItemId =
  | "source_pdf_present"
  | "readiness_verdict_ready"
  | "fixed_rent_single_period"
  | "mapped_canonical_values"
  | "party_identity_complete"
  | "land_registry_complete"
  | "maklumat_am_complete"
  | "instruction_graph_built";

/** One row of the preflight checklist. */
export interface PreflightChecklistItem {
  id: PreflightChecklistItemId;
  /** Operator-facing label (stable English). */
  label: string;
  status: PreflightChecklistStatus;
  /**
   * Operator-facing reason populated only when `status === "fail"`.
   * Composed from fixed vocabulary + non-sensitive blocker counts.
   */
  failReason?: string;
}

/**
 * Compact summary of the offline instruction graph for the console
 * info grid. All fields are non-sensitive integers / fixed strings.
 */
export interface SupervisedRunGraphSummary {
  /** Graph verdict, mirrors the underlying graph value. */
  verdict: TenancyInstructionGraph["verdict"];
  /** Banner-style label echoing the preview helper's wording. */
  verdictLabel: string;
  /** "ready" or "blocked" — drives styling. */
  verdictTone: "ready" | "blocked";
  /** Stable supported-path label (e.g. "Fixed-rent residential ..."). */
  supportedPathLabel: string;
  /** Stable lane label (e.g. "Sewa / Pajakan"). */
  laneLabel: string;
  /** Number of phases in the graph (always 9 in B-impl Phase 0). */
  phaseCount: number;
  /** Number of operator gates in the graph (the canonical 5 when ready). */
  operatorGateCount: number;
}

/** One blocker group in the console's blocked summary. */
export interface SupervisedRunConsoleBlockedGroup {
  /** Stable group key, mirroring the graph's blocker categories. */
  key: string;
  /** Operator-facing label for the group. */
  label: string;
  /** How many blockers belong to this group. */
  count: number;
}

/** Console blocked summary, populated only when not eligible. */
export interface SupervisedRunConsoleBlockedSummary {
  /** Verbatim from the graph's `safeActionText`. */
  safeActionText: string;
  /** Aggregated by graph blocker category, in stable order. */
  groups: SupervisedRunConsoleBlockedGroup[];
}

/** Top-level view-model returned by the helper. */
export interface SupervisedRunConsoleViewModel {
  /** B2 approved heading. Constant text. */
  heading: string;
  /** B2 approved standing helper text. Constant text. */
  helperText: string;
  /** B2 approved banner (text + tone). */
  banner: { text: string; tone: "ready" | "blocked" };
  /** Boolean shorthand for the banner. */
  eligibility: SupervisedRunEligibility;
  /** Approved eligibility wording (the same string the banner uses). */
  eligibilityLabel: string;
  /** Verbatim wording from the readiness verdict (e.g. "ready_for_supervised_run"). */
  readinessVerdict: TenancyPortalRunReadinessVerdict;
  /** Operator-facing label for the readiness verdict. */
  readinessVerdictLabel: string;
  /** B2 approved non-execution note. Constant text. */
  nonExecutionNote: string;
  /** B2 approved future-gate note. Constant text. */
  futureGateNote: string;
  /** Standing authorization caveat (mirrors instruction-graph preview). */
  authorizationCaveat: string;
  /** Compact graph summary for the info grid. */
  graphSummary: SupervisedRunGraphSummary;
  /** Eight-item preflight checklist. */
  preflightChecklist: PreflightChecklistItem[];
  /** Populated only when `eligibility === "not_eligible"`. */
  blockedSummary: SupervisedRunConsoleBlockedSummary | null;
  /**
   * Approved label for the optional non-mutating refresh action. The
   * panel may render it as a button; the action handler is the
   * panel's responsibility and must not invoke any portal action.
   */
  refreshActionLabel: string;
  /** Stable graphId for telemetry / aria. NOT a portal draft ID. */
  graphId: string;
}

/** Builder input. Caller passes the four pieces of state directly. */
export interface BuildSupervisedRunConsoleInput {
  job: TenancyPortalRunReadinessJobInput;
  readinessReport: TenancyPortalRunReadinessReport;
  graph: TenancyInstructionGraph;
  graphPreview: InstructionGraphPreviewViewModel;
}

// ─── Approved B2 wording ───────────────────────────────────────────

export const CONSOLE_HEADING = "Supervised Run Console";

export const CONSOLE_HELPER_TEXT =
  "This console prepares the internal run plan for a future supervised e-Duti Setem session. It does not execute portal actions.";

export const CONSOLE_BANNER_READY = "Eligible for future supervised run";
export const CONSOLE_BANNER_BLOCKED = "Not eligible for supervised run";

export const CONSOLE_NON_EXECUTION_NOTE =
  "No e-Duti Setem action has been taken.";

export const CONSOLE_FUTURE_GATE_NOTE =
  "A separate operator approval milestone is required before any portal mutation.";

export const CONSOLE_AUTHORIZATION_CAVEAT =
  "This console does not authorize browser execution, portal mutation, payment, certificate retrieval, or final submission.";

export const CONSOLE_REFRESH_ACTION_LABEL = "Refresh Run Plan";

const READINESS_VERDICT_LABELS: Record<
  TenancyPortalRunReadinessVerdict,
  string
> = {
  ready_for_supervised_run: "Ready for supervised portal run",
  blocked: "Not ready for supervised portal run",
};

const SUPPORTED_PATH_LABELS: Record<
  TenancyInstructionGraphSupportedPath,
  string
> = {
  fixed_rent_residential_kediaman:
    "Fixed-rent residential (Kediaman) tenancy",
};

const GAP_CATEGORY_LABELS: Record<
  TenancyPortalFieldMappingGapCategory,
  string
> = {
  multi_pass_unsupported: "Multi-pass not supported",
  land_registry_not_modelled: "Bahagian C land-registry not captured",
  maklumat_am_not_captured: "Maklumat Am not captured",
  portal_enum_mismatch: "Portal enum mismatch",
  party_model_not_modelled: "Party identity not captured",
};

const PREFLIGHT_LABELS: Record<PreflightChecklistItemId, string> = {
  source_pdf_present: "Source PDF present",
  readiness_verdict_ready: "Readiness verdict ready",
  fixed_rent_single_period: "Fixed-rent single-period instrument",
  mapped_canonical_values: "Mapped canonical values available",
  party_identity_complete: "Party identity complete",
  land_registry_complete: "Land registry complete",
  maklumat_am_complete: "Maklumat Am complete",
  instruction_graph_built: "Instruction graph built",
};

// ─── Public builder ────────────────────────────────────────────────

/**
 * Build the operator-side supervised-run console view-model. Pure.
 *
 * Eligibility rule: the job is `eligible` iff the offline
 * instruction graph's verdict is `ready_for_supervised_run`. The
 * graph builder treats the readiness gate as authoritative, so the
 * two sources are equivalent — but we use the GRAPH'S verdict
 * because it adds defence-in-depth for `unsupported_path` blockers
 * (e.g. variable rent / amendment that somehow slipped past a stale
 * cached readiness report).
 */
export function buildSupervisedRunConsoleViewModel(
  input: BuildSupervisedRunConsoleInput
): SupervisedRunConsoleViewModel {
  const { job, readinessReport, graph, graphPreview } = input;
  const isReady = graph.verdict === "ready_for_supervised_run";
  const eligibility: SupervisedRunEligibility = isReady
    ? "eligible"
    : "not_eligible";

  const banner = isReady
    ? { text: CONSOLE_BANNER_READY, tone: "ready" as const }
    : { text: CONSOLE_BANNER_BLOCKED, tone: "blocked" as const };

  const supportedPathLabel =
    SUPPORTED_PATH_LABELS[graph.supportedPath] ?? graph.supportedPath;

  const graphSummary: SupervisedRunGraphSummary = {
    verdict: graph.verdict,
    verdictLabel: graphPreview.banner.text,
    verdictTone: graphPreview.banner.tone,
    supportedPathLabel,
    laneLabel: graphPreview.laneLabel,
    phaseCount: graph.phases.length,
    operatorGateCount: graphPreview.operatorGates.length,
  };

  const preflightChecklist = buildPreflightChecklist(job, readinessReport, graph);

  const blockedSummary: SupervisedRunConsoleBlockedSummary | null = isReady
    ? null
    : {
        safeActionText: graph.safeActionText,
        groups: aggregateBlockedGroups(graph, graphPreview, readinessReport),
      };

  return {
    heading: CONSOLE_HEADING,
    helperText: CONSOLE_HELPER_TEXT,
    banner,
    eligibility,
    eligibilityLabel: banner.text,
    readinessVerdict: readinessReport.verdict,
    readinessVerdictLabel:
      READINESS_VERDICT_LABELS[readinessReport.verdict] ??
      readinessReport.verdict,
    nonExecutionNote: CONSOLE_NON_EXECUTION_NOTE,
    futureGateNote: CONSOLE_FUTURE_GATE_NOTE,
    authorizationCaveat: CONSOLE_AUTHORIZATION_CAVEAT,
    graphSummary,
    preflightChecklist,
    blockedSummary,
    refreshActionLabel: CONSOLE_REFRESH_ACTION_LABEL,
    graphId: graph.graphId,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────

/**
 * Compute each of the eight preflight checklist items independently
 * so a partially-blocked job shows some passes and some fails. None
 * of the fail reasons embed party identity values, addresses, IC
 * numbers, TINs, URLs, or hrefs — only category names + counts.
 */
function buildPreflightChecklist(
  job: TenancyPortalRunReadinessJobInput,
  report: TenancyPortalRunReadinessReport,
  graph: TenancyInstructionGraph
): PreflightChecklistItem[] {
  const out: PreflightChecklistItem[] = [];

  // 1. source_pdf_present — driven directly by the readiness report.
  out.push({
    id: "source_pdf_present",
    label: PREFLIGHT_LABELS.source_pdf_present,
    status: report.sourcePdfReady ? "pass" : "fail",
    ...(report.sourcePdfReady
      ? {}
      : { failReason: "Storage path is empty on the job." }),
  });

  // 2. readiness_verdict_ready
  const readinessReady =
    report.verdict === "ready_for_supervised_run";
  out.push({
    id: "readiness_verdict_ready",
    label: PREFLIGHT_LABELS.readiness_verdict_ready,
    status: readinessReady ? "pass" : "fail",
    ...(readinessReady
      ? {}
      : { failReason: "Readiness gate verdict is blocked." }),
  });

  // 3. fixed_rent_single_period — derived from job + multi_pass gaps
  const tpd = job.tenancyPortalDetails;
  const descType = tpd?.instrument?.portalDescriptionType ?? null;
  const scheduleLength = tpd?.instrument?.rentSchedule?.length ?? 0;
  const multiPassGaps = countGapsInCategory(
    report.portalFieldMappingGaps,
    "multi_pass_unsupported"
  );
  const fixedRentSinglePeriod =
    descType === "fixed_rent_during_tenancy" &&
    scheduleLength === 1 &&
    multiPassGaps === 0;
  out.push({
    id: "fixed_rent_single_period",
    label: PREFLIGHT_LABELS.fixed_rent_single_period,
    status: fixedRentSinglePeriod ? "pass" : "fail",
    ...(fixedRentSinglePeriod
      ? {}
      : {
          failReason: deriveFixedRentFailReason(
            descType,
            scheduleLength,
            multiPassGaps
          ),
        }),
  });

  // 4. mapped_canonical_values — driven by portal_enum_mismatch gaps
  const enumMismatches = countGapsInCategory(
    report.portalFieldMappingGaps,
    "portal_enum_mismatch"
  );
  out.push({
    id: "mapped_canonical_values",
    label: PREFLIGHT_LABELS.mapped_canonical_values,
    status: enumMismatches === 0 ? "pass" : "fail",
    ...(enumMismatches === 0
      ? {}
      : {
          failReason: `${enumMismatches} canonical mapping gap${
            enumMismatches === 1 ? "" : "s"
          } in portal_enum_mismatch.`,
        }),
  });

  // 5. party_identity_complete — driven by party_model_not_modelled gaps
  const partyGaps = countGapsInCategory(
    report.portalFieldMappingGaps,
    "party_model_not_modelled"
  );
  out.push({
    id: "party_identity_complete",
    label: PREFLIGHT_LABELS.party_identity_complete,
    status: partyGaps === 0 ? "pass" : "fail",
    ...(partyGaps === 0
      ? {}
      : {
          failReason: `${partyGaps} party identity gap${
            partyGaps === 1 ? "" : "s"
          }.`,
        }),
  });

  // 6. land_registry_complete
  const lrGaps = countGapsInCategory(
    report.portalFieldMappingGaps,
    "land_registry_not_modelled"
  );
  out.push({
    id: "land_registry_complete",
    label: PREFLIGHT_LABELS.land_registry_complete,
    status: lrGaps === 0 ? "pass" : "fail",
    ...(lrGaps === 0
      ? {}
      : {
          failReason: `${lrGaps} land-registry gap${
            lrGaps === 1 ? "" : "s"
          }.`,
        }),
  });

  // 7. maklumat_am_complete
  const maGaps = countGapsInCategory(
    report.portalFieldMappingGaps,
    "maklumat_am_not_captured"
  );
  out.push({
    id: "maklumat_am_complete",
    label: PREFLIGHT_LABELS.maklumat_am_complete,
    status: maGaps === 0 ? "pass" : "fail",
    ...(maGaps === 0
      ? {}
      : {
          failReason: `${maGaps} Maklumat Am gap${
            maGaps === 1 ? "" : "s"
          }.`,
        }),
  });

  // 8. instruction_graph_built — graph verdict is the source of truth
  const graphReady = graph.verdict === "ready_for_supervised_run";
  out.push({
    id: "instruction_graph_built",
    label: PREFLIGHT_LABELS.instruction_graph_built,
    status: graphReady ? "pass" : "fail",
    ...(graphReady
      ? {}
      : { failReason: "Instruction graph compile-result is blocked." }),
  });

  return out;
}

function deriveFixedRentFailReason(
  descType: string | null,
  scheduleLength: number,
  multiPassGaps: number
): string {
  if (descType === null) {
    return "Instrument description type (pds_jenis) not captured.";
  }
  if (descType !== "fixed_rent_during_tenancy") {
    return "Instrument description type is not fixed_rent_during_tenancy.";
  }
  if (scheduleLength !== 1) {
    return `Rent schedule has ${scheduleLength} period${
      scheduleLength === 1 ? "" : "s"
    }; supervised run requires exactly 1.`;
  }
  if (multiPassGaps > 0) {
    return `${multiPassGaps} multi-pass gap${
      multiPassGaps === 1 ? "" : "s"
    } detected.`;
  }
  return "Fixed-rent single-period invariant did not hold.";
}

function countGapsInCategory(
  gaps: TenancyPortalFieldMappingGap[],
  category: TenancyPortalFieldMappingGapCategory
): number {
  let n = 0;
  for (const g of gaps) if (g.category === category) n++;
  return n;
}

/**
 * Aggregate blocker groups for the console's blocked summary. Builds
 * on the existing instruction-graph preview groups (graph blocker
 * category) and additionally surfaces a per-readiness-gap-category
 * count, so the operator sees a richer breakdown than the graph
 * preview alone provides.
 */
function aggregateBlockedGroups(
  graph: TenancyInstructionGraph,
  preview: InstructionGraphPreviewViewModel,
  report: TenancyPortalRunReadinessReport
): SupervisedRunConsoleBlockedGroup[] {
  const groups: SupervisedRunConsoleBlockedGroup[] = [];

  // Top-level graph blocker categories first (telemetry-style).
  const previewGroups: InstructionGraphPreviewBlockedGroup[] =
    preview.blockedSummary?.groups ?? [];
  for (const g of previewGroups) {
    groups.push({
      key: `graph_${g.category}`,
      label: g.categoryLabel,
      count: g.count,
    });
  }

  // Then per-readiness-gap-category counts. These have rich category
  // labels operators recognise from the existing readiness panel.
  const order: TenancyPortalFieldMappingGapCategory[] = [
    "multi_pass_unsupported",
    "portal_enum_mismatch",
    "party_model_not_modelled",
    "land_registry_not_modelled",
    "maklumat_am_not_captured",
  ];
  for (const cat of order) {
    const count = countGapsInCategory(report.portalFieldMappingGaps, cat);
    if (count === 0) continue;
    groups.push({
      key: `readiness_${cat}`,
      label: GAP_CATEGORY_LABELS[cat],
      count,
    });
  }

  // Defensive — if neither source produced any groups but the graph
  // is still blocked (e.g. only a `readiness_blocker` category from
  // missing-source-PDF), surface a single bucket so the panel does
  // not render an empty list.
  if (groups.length === 0 && graph.blockingReasons.length > 0) {
    groups.push({
      key: "graph_unspecified",
      label: "Other readiness blocker",
      count: graph.blockingReasons.length,
    });
  }

  return groups;
}
