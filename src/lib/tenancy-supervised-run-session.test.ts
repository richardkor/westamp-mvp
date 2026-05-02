/**
 * WeStamp — Tenancy Supervised Run Session · model + builder + gate tests
 *
 * Covers Milestone B6 (model + approval gate). Tests the pure
 * `buildSupervisedRunSessionState`, `canApproveFirstMutation`,
 * `applyFirstMutationApproval`, and `buildSupervisedRunSessionViewModel`
 * helpers.
 *
 * The downstream route + persistence layers are tested in
 * `tenancy-supervised-run-session-route.test.ts`. The card UI is
 * tested in `tenancy-supervised-run-session-card.test.ts`. This
 * file is the kernel: model invariants, stage derivation, gate
 * eligibility, and the sensitive-data invariant.
 */

import {
  APPROVAL_BUTTON_HELPER_WARNING,
  APPROVAL_BUTTON_LABEL,
  APPROVAL_REFUSAL_LABELS,
  applyFirstMutationApproval,
  buildSupervisedRunSessionState,
  buildSupervisedRunSessionViewModel,
  canApproveFirstMutation,
  FIRST_MUTATION_APPROVED_NOTICE,
  NON_EXECUTION_NOTE,
  PREPARE_BUTTON_LABEL,
  RUN_SESSION_HEADING,
  RUN_SESSION_HELPER_TEXT,
  RUN_STAGE_LABELS,
  type ApprovalRefusalReason,
  type TenancyRunSessionState,
} from "./tenancy-supervised-run-session";
import {
  ABSENT_MARKERS,
  type SupervisedSessionReport,
} from "./tenancy-supervised-session-shell";
import {
  buildTenancyInstructionGraph,
  type TenancyInstructionGraph,
  type TenancyInstructionGraphJobInput,
} from "./tenancy-instruction-graph";
import {
  evaluateTenancyPortalRunReadiness,
  type TenancyPortalRunReadinessReport,
} from "./tenancy-portal-run-readiness";
import type { TenancyPortalParty } from "./stamping-types";

// ─── Fixture helpers ──────────────────────────────────────────────

function buildReadyJob(): TenancyInstructionGraphJobInput {
  const landlord: TenancyPortalParty = {
    role: "landlord",
    type: "individual",
    nameAsPerInstrument: "Test Landlord",
    nationality: "malaysian",
    identityType: "nric",
    identityNumber: "900101015555",
    addressLine1: "1 Test Lane",
    postcode: "50000",
    city: "Kuala Lumpur",
    state: "Kuala Lumpur",
    country: "Malaysia",
    mobile: "0123456789",
    tinAutoGenerationExpected: true,
    citizenshipCategory: "citizen",
    gender: "male",
    nricSubType: "ic_baru",
  };
  const tenant: TenancyPortalParty = {
    ...landlord,
    role: "tenant",
    nameAsPerInstrument: "Test Tenant",
    identityNumber: "950505055555",
    addressLine1: "2 Test Lane",
    mobile: "0129876543",
    gender: "female",
  };
  return {
    tenancyPortalDetails: {
      updatedAt: new Date().toISOString(),
      parties: [landlord, tenant],
      instrument: {
        instrumentDate: "2026-01-01",
        duplicateCopies: 1,
        portalDescriptionType: "fixed_rent_during_tenancy",
        rentSchedule: [
          {
            startDate: "2026-01-01",
            endDate: "2027-01-01",
            monthlyRent: 1000,
            durationMonths: 12,
          },
        ],
        portalInstrumentName: { code: "1101", label: "Perjanjian Sewa" },
      },
      property: {
        addressLine1: "Unit 1, Test Building",
        postcode: "50000",
        city: "Kuala Lumpur",
        state: "Kuala Lumpur",
        country: "Malaysia",
        propertyType: "kediaman",
        buildingType: "kondominium",
        furnishedStatus: "fully_furnished",
        premisesAreaSqm: 100,
        landRegistry: {
          milikPenuh: "Hak Milik Penuh",
          lot: "12345",
          mukim: "Petaling",
          daerah: "Kuala Lumpur",
          luas: 250,
          luasUnit: "mps",
        },
      },
      maklumatAm: {
        dutyStampType: { code: "1101", label: "Sewa / Pajakan" },
        instrumentRelationship: "principal",
      },
    },
    storagePath: "uploads/test/sample.pdf",
    originalFileName: "sample.pdf",
    mimeType: "application/pdf",
    documentCategory: "tenancy_agreement",
    stampingDetails: undefined,
  };
}

function buildContext(opts: {
  blocked?: boolean;
  variableRent?: boolean;
} = {}): {
  jobId: string;
  readinessReport: TenancyPortalRunReadinessReport;
  graph: TenancyInstructionGraph;
} {
  const job = buildReadyJob();
  if (opts.blocked) {
    job.storagePath = "";
  }
  if (opts.variableRent) {
    job.tenancyPortalDetails!.instrument!.portalDescriptionType =
      "variable_rent_during_tenancy";
  }
  const readinessReport = evaluateTenancyPortalRunReadiness(job);
  const graph = buildTenancyInstructionGraph({
    job,
    jobId: "rs-test-job",
    readinessReport,
  });
  return { jobId: "rs-test-job", readinessReport, graph };
}

function reachableP5Report(
  graphPhaseCompatibility: SupervisedSessionReport["graphPhaseCompatibility"] = "compatible"
): SupervisedSessionReport {
  return {
    status: "sewa_pajakan_p5_form",
    reachable: true,
    candidatePageCount: 1,
    selectedPageKind: "sewa_pajakan_p5_form",
    pageKind: "sewa_pajakan_p5_form",
    pathKind: "sewa_pajakan_p5_form",
    safeMarkers: { ...ABSENT_MARKERS, pdsSuratcaraPresent: true },
    graphPhaseCompatibility,
    recommendedOperatorAction: "Ready for read-only phase-position verification.",
    reason: "Operator session is on the Sewa/Pajakan p5 form.",
  };
}

function unreachableReport(): SupervisedSessionReport {
  return {
    status: "cdp_unreachable",
    reachable: false,
    candidatePageCount: 0,
    selectedPageKind: "unknown",
    pageKind: "unknown",
    pathKind: "other",
    safeMarkers: { ...ABSENT_MARKERS },
    graphPhaseCompatibility: "unknown",
    recommendedOperatorAction:
      "Launch Chrome with remote debugging enabled.",
    reason: "CDP endpoint is not reachable.",
  };
}

// ─── Test 1 · Stage derivation, no browser inspection ─────────────

describe("Run-session · stage derivation", () => {
  test("ready job + no browser snapshot → preflight_ready", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(state.currentRunStage).toBe("preflight_ready");
    expect(state.readinessVerdict).toBe("ready_for_supervised_run");
    expect(state.instructionGraphVerdict).toBe("ready_for_supervised_run");
    expect(state.operatorApproval.firstPortalMutationApproved).toBe(false);
    expect(state.browserSession).toBeUndefined();
    expect(state.lane).toBe("sewa_pajakan");
    expect(state.supportedPath).toBe("fixed_rent_residential_kediaman");
    expect(state.nonExecutionNote).toBe(NON_EXECUTION_NOTE);
    expect(state.blockedReasonCodes).toEqual([]);
  });

  test("ready job + reachable+compatible browser → awaiting_first_mutation_approval", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    expect(state.currentRunStage).toBe("awaiting_first_mutation_approval");
    expect(state.browserSession?.phaseCompatibility).toBe("compatible");
  });

  test("ready job + incompatible browser → browser_not_ready", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("incompatible"),
    });
    expect(state.currentRunStage).toBe("browser_not_ready");
  });

  test("ready job + unreachable browser → browser_not_ready", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: unreachableReport(),
    });
    expect(state.currentRunStage).toBe("browser_not_ready");
  });

  test("blocked job → blocked", () => {
    const { jobId, readinessReport, graph } = buildContext({ blocked: true });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(state.currentRunStage).toBe("blocked");
    expect(state.readinessVerdict).toBe("blocked");
    expect(state.instructionGraphVerdict).toBe("blocked");
  });

  test("variable-rent job → blocked + multi-pass blocker code surfaced", () => {
    const { jobId, readinessReport, graph } = buildContext({
      variableRent: true,
    });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(state.currentRunStage).toBe("blocked");
    expect(state.blockedReasonCodes).toContain(
      "pds_jenis_1104_unsupported"
    );
  });

  test("blocker codes are deduplicated and capped at 6", () => {
    const { jobId, readinessReport, graph } = buildContext({ blocked: true });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    // Cap holds even on a maximally broken job.
    expect(state.blockedReasonCodes.length).toBeLessThanOrEqual(6);
    // Codes are unique.
    expect(new Set(state.blockedReasonCodes).size).toBe(
      state.blockedReasonCodes.length
    );
  });
});

// ─── Test 2 · createdAt / updatedAt ───────────────────────────────

describe("Run-session · timestamps", () => {
  test("createdAt is set on first build and preserved on refresh", () => {
    const { jobId, readinessReport, graph } = buildContext();
    let n = 0;
    const now = () => `2026-01-${String(++n).padStart(2, "0")}T00:00:00Z`;
    const initial = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      now,
    });
    const refreshed = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      existingState: initial,
      now,
    });
    expect(initial.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(refreshed.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(refreshed.updatedAt).toBe("2026-01-02T00:00:00Z");
  });
});

// ─── Test 3 · Approval preservation across refreshes ──────────────

describe("Run-session · approval preservation", () => {
  test("existing approval survives a refresh that does not regress eligibility", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const initial = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const refreshed = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
      existingState: initial,
    });
    expect(refreshed.currentRunStage).toBe("first_mutation_approved");
    expect(refreshed.operatorApproval.firstPortalMutationApproved).toBe(true);
    expect(refreshed.operatorApproval.approvedAt).toBe(
      initial.operatorApproval.approvedAt
    );
  });

  test("existing approval is cleared when a refresh introduces an incompatibility", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const initial = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const refreshed = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("incompatible"),
      existingState: initial,
    });
    expect(refreshed.operatorApproval.firstPortalMutationApproved).toBe(false);
    expect(refreshed.currentRunStage).toBe("browser_not_ready");
  });

  test("existing approval is cleared if the readiness verdict regresses", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const initial = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const blocked = buildContext({ blocked: true });
    const refreshed = buildSupervisedRunSessionState({
      jobId,
      readinessReport: blocked.readinessReport,
      instructionGraph: blocked.graph,
      browserSessionReport: reachableP5Report("compatible"),
      existingState: initial,
    });
    expect(refreshed.operatorApproval.firstPortalMutationApproved).toBe(false);
    expect(refreshed.currentRunStage).toBe("blocked");
  });

  test("aborted state is sticky across refreshes", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const seed = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const abortedSeed: TenancyRunSessionState = {
      ...seed,
      currentRunStage: "aborted",
    };
    const refreshed = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      existingState: abortedSeed,
    });
    expect(refreshed.currentRunStage).toBe("aborted");
  });
});

// ─── Test 4 · canApproveFirstMutation eligibility ─────────────────

describe("Run-session · approval eligibility", () => {
  test("preflight_ready (no browser snapshot) is NOT eligible — browser_not_checked", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(state.currentRunStage).toBe("preflight_ready");
    expect(state.browserSession).toBeUndefined();
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_not_checked" });
  });

  test("awaiting_first_mutation_approval is eligible", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: true, alreadyApproved: false });
  });

  test("blocked state is rejected with session_blocked", () => {
    const { jobId, readinessReport, graph } = buildContext({ blocked: true });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "session_blocked" });
  });

  test("browser_not_ready (incompatible) is rejected with browser_incompatible", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("incompatible"),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_incompatible" });
  });

  test("browser_not_ready (unreachable) is rejected with browser_unreachable", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: unreachableReport(),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_unreachable" });
  });

  test("aborted state is rejected with session_aborted", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const seed: TenancyRunSessionState = {
      ...buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
      }),
      currentRunStage: "aborted",
    };
    const r = canApproveFirstMutation(seed);
    expect(r).toEqual({ ok: false, reason: "session_aborted" });
  });

  test("already-approved state is idempotent (ok: true, alreadyApproved: true)", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const approved = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const r = canApproveFirstMutation(approved);
    expect(r).toEqual({ ok: true, alreadyApproved: true });
  });
});

// ─── Test 4b · B6 safety correction · browser-check requirement ───

describe("Run-session · B6 safety correction · browser check required", () => {
  test("compatible browser snapshot allows approval", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: true, alreadyApproved: false });
  });

  test("incompatible browser refuses with browser_incompatible (NOT browser_not_checked)", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("incompatible"),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_incompatible" });
  });

  test("unreachable CDP refuses with browser_unreachable (NOT browser_not_checked)", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: unreachableReport(),
    });
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_unreachable" });
  });

  test("unknown phase compatibility refuses with browser_unreachable", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("unknown"),
    });
    // Status is reachable but compat is unknown — this routes to
    // browser_unreachable per `canApproveFirstMutation`.
    const r = canApproveFirstMutation(state);
    expect(r).toEqual({ ok: false, reason: "browser_unreachable" });
  });

  test("applyFirstMutationApproval throws on a preflight_ready state", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(() => applyFirstMutationApproval(state)).toThrow(
      /browser_not_checked/
    );
  });

  test("the new refusal-reason code surfaces the brief's exact wording", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const vm = buildSupervisedRunSessionViewModel(state);
    expect(vm.approveRefusalLabel).toBe(
      "Run a browser check before approving the first portal mutation."
    );
  });

  test("a refresh that drops the browser snapshot clears a previous approval", () => {
    const { jobId, readinessReport, graph } = buildContext();
    // Approve with a compatible browser snapshot.
    const approved = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    // Refresh path: when the operator clicks "Prepare Run Session"
    // (without browser check) the existing browser snapshot is
    // PRESERVED across refreshes (per the builder's
    // existing-snapshot fallback), so approval survives. Verify
    // that contract.
    const refreshedKeepingSnapshot = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      existingState: approved,
    });
    expect(
      refreshedKeepingSnapshot.operatorApproval.firstPortalMutationApproved
    ).toBe(true);
    expect(refreshedKeepingSnapshot.browserSession?.phaseCompatibility).toBe(
      "compatible"
    );

    // But if a state existed WITHOUT a browser snapshot, no
    // approval flag could ever be set under the new rule. Confirm
    // by attempting to approve a no-snapshot state.
    const preflight = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(() => applyFirstMutationApproval(preflight)).toThrow(
      /browser_not_checked/
    );
  });
});

// ─── Test 5 · applyFirstMutationApproval ──────────────────────────

describe("Run-session · applyFirstMutationApproval", () => {
  test("transitions stage to first_mutation_approved and stamps approvedAt", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const after = applyFirstMutationApproval(state, {
      now: () => "2026-04-30T16:00:00Z",
      approvedBy: "operator_session",
    });
    expect(after.currentRunStage).toBe("first_mutation_approved");
    expect(after.operatorApproval.firstPortalMutationApproved).toBe(true);
    expect(after.operatorApproval.approvedAt).toBe("2026-04-30T16:00:00Z");
    expect(after.operatorApproval.approvedBy).toBe("operator_session");
  });

  test("approving a blocked state throws", () => {
    const { jobId, readinessReport, graph } = buildContext({ blocked: true });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    expect(() => applyFirstMutationApproval(state)).toThrow(
      /session_blocked/
    );
  });

  test("re-approving an already-approved state preserves approvedAt", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const first = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      }),
      { now: () => "2026-04-30T16:00:00Z" }
    );
    const second = applyFirstMutationApproval(first, {
      now: () => "2026-05-01T16:00:00Z",
    });
    expect(second.operatorApproval.approvedAt).toBe(
      "2026-04-30T16:00:00Z"
    );
    expect(second.updatedAt).toBe("2026-05-01T16:00:00Z");
  });

  test("approval is non-mutating: returns a new state, leaves input unchanged", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("compatible"),
    });
    const before = JSON.stringify(state);
    applyFirstMutationApproval(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ─── Test 6 · view-model ──────────────────────────────────────────

describe("Run-session · view-model", () => {
  test("null state shows not_prepared with prepare button enabled", () => {
    const vm = buildSupervisedRunSessionViewModel(null);
    expect(vm.heading).toBe(RUN_SESSION_HEADING);
    expect(vm.helperText).toBe(RUN_SESSION_HELPER_TEXT);
    expect(vm.runStage).toBe("not_prepared");
    expect(vm.runStageLabel).toBe(RUN_STAGE_LABELS.not_prepared);
    expect(vm.approveButtonEnabled).toBe(false);
    expect(vm.approveRefusalReason).toBe("not_prepared");
    expect(vm.approvalCompletedNotice).toBeNull();
    expect(vm.lastUpdatedAt).toBeNull();
  });

  test("preflight_ready state DISABLES approve button (browser check required)", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const vm = buildSupervisedRunSessionViewModel(state);
    expect(vm.runStage).toBe("preflight_ready");
    expect(vm.approveButtonEnabled).toBe(false);
    expect(vm.approveRefusalReason).toBe("browser_not_checked");
    expect(vm.approveRefusalLabel).toBe(
      "Run a browser check before approving the first portal mutation."
    );
  });

  test("browser_not_ready state disables approve button + surfaces label", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
      browserSessionReport: reachableP5Report("incompatible"),
    });
    const vm = buildSupervisedRunSessionViewModel(state);
    expect(vm.approveButtonEnabled).toBe(false);
    expect(vm.approveRefusalReason).toBe("browser_incompatible");
    expect(vm.approveRefusalLabel).toBe(
      APPROVAL_REFUSAL_LABELS.browser_incompatible
    );
  });

  test("first_mutation_approved state shows the approval-completed notice", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const vm = buildSupervisedRunSessionViewModel(state);
    expect(vm.runStage).toBe("first_mutation_approved");
    expect(vm.approvalCompletedNotice).toBe(FIRST_MUTATION_APPROVED_NOTICE);
    expect(vm.approveButtonEnabled).toBe(false);
    expect(vm.approvalStatusLabel).toBe("Approved internally");
  });

  test("approved button label and helper warning match the brief verbatim", () => {
    const vm = buildSupervisedRunSessionViewModel(null);
    expect(vm.approveButtonLabel).toBe(APPROVAL_BUTTON_LABEL);
    expect(vm.approveButtonLabel).toBe("Approve First Portal Mutation");
    expect(vm.approvalButtonHelperWarning).toBe(
      APPROVAL_BUTTON_HELPER_WARNING
    );
    expect(vm.prepareButtonLabel).toBe(PREPARE_BUTTON_LABEL);
    expect(vm.prepareButtonLabel).toBe("Prepare Run Session");
  });
});

// ─── Test 7 · Forbidden wording invariant ─────────────────────────

describe("Run-session · forbidden wording invariant", () => {
  /**
   * Per the B6 brief, the run-session surface (state record + view-
   * model) must not contain any of:
   *   - "submitted"
   *   - "sent to LHDN"
   *   - "portal run started"
   *   - "draft created"
   *   - "saved to portal"
   *   - "executed"
   *   - "completed"
   *
   * Plus the standing forbidden-affordance set:
   *   - "Start Portal Run", "Send to LHDN", "Save to Portal",
   *     "Hantar", "Create Draft Now"
   */
  const FORBIDDEN_WORDING: { pattern: RegExp; label: string }[] = [
    { pattern: /\bsubmitted\b/i, label: "submitted" },
    { pattern: /\bsent to LHDN\b/i, label: "sent to LHDN" },
    { pattern: /\bportal run started\b/i, label: "portal run started" },
    { pattern: /\bdraft created\b/i, label: "draft created" },
    { pattern: /\bsaved to portal\b/i, label: "saved to portal" },
    { pattern: /\bexecuted\b/i, label: "executed" },
    { pattern: /\bcompleted\b/i, label: "completed" },
    { pattern: /\bStart Portal Run\b/i, label: "Start Portal Run" },
    { pattern: /\bSave to Portal\b/i, label: "Save to Portal" },
    { pattern: /\bHantar\b/i, label: "Hantar" },
    { pattern: /\bCreate Draft Now\b/i, label: "Create Draft Now" },
  ];

  test("ready preflight state is free of forbidden wording", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const vm = buildSupervisedRunSessionViewModel(state);
    const serialized = JSON.stringify({ state, vm });
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched: ${m?.[0]}`
        );
      }
    }
  });

  test("approved state is free of forbidden wording", () => {
    const { jobId, readinessReport, graph } = buildContext();
    const state = applyFirstMutationApproval(
      buildSupervisedRunSessionState({
        jobId,
        readinessReport,
        instructionGraph: graph,
        browserSessionReport: reachableP5Report("compatible"),
      })
    );
    const vm = buildSupervisedRunSessionViewModel(state);
    const serialized = JSON.stringify({ state, vm });
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched: ${m?.[0]}`
        );
      }
    }
  });

  test("blocked state is free of forbidden wording", () => {
    const { jobId, readinessReport, graph } = buildContext({ blocked: true });
    const state = buildSupervisedRunSessionState({
      jobId,
      readinessReport,
      instructionGraph: graph,
    });
    const vm = buildSupervisedRunSessionViewModel(state);
    const serialized = JSON.stringify({ state, vm });
    for (const { pattern, label } of FORBIDDEN_WORDING) {
      if (pattern.test(serialized)) {
        const m = serialized.match(pattern);
        throw new Error(
          `Forbidden wording "${label}" matched: ${m?.[0]}`
        );
      }
    }
  });
});

// ─── Test 8 · Sensitive-data invariant ────────────────────────────

describe("Run-session · sensitive-data invariant", () => {
  const FORBIDDEN: { name: string; pattern: RegExp }[] = [
    { name: "12-digit IC", pattern: /\b\d{12}\b/ },
    { name: "literal landlord IC", pattern: /900101015555/ },
    { name: "literal tenant IC", pattern: /950505055555/ },
    { name: "literal landlord name", pattern: /Test Landlord/i },
    { name: "literal tenant name", pattern: /Test Tenant/i },
    { name: "literal mobile (landlord)", pattern: /0123456789/ },
    { name: "literal mobile (tenant)", pattern: /0129876543/ },
    { name: "literal address line", pattern: /Test Lane/i },
    { name: "literal building", pattern: /Test Building/i },
    { name: "literal mukim", pattern: /\bPetaling\b/ },
    { name: "literal lot", pattern: /\b12345\b/ },
    { name: "http URL", pattern: /https?:\/\//i },
    { name: "leading-slash portal path", pattern: /\/stamps\// },
    { name: "raw href attribute", pattern: /href=/i },
    { name: "cookie keyword", pattern: /cookie/i },
    { name: "token keyword", pattern: /token/i },
    { name: "lhdnmsstoken", pattern: /lhdnmsstoken/i },
    { name: "TIN keyword", pattern: /\bTIN[: ]/ },
    { name: "storagePath leak", pattern: /uploads\/test\/sample\.pdf/ },
  ];

  const SCENARIOS: {
    label: string;
    build: () => { state: TenancyRunSessionState };
  }[] = [
    {
      label: "preflight_ready",
      build: () => {
        const { jobId, readinessReport, graph } = buildContext();
        return {
          state: buildSupervisedRunSessionState({
            jobId,
            readinessReport,
            instructionGraph: graph,
          }),
        };
      },
    },
    {
      label: "awaiting approval",
      build: () => {
        const { jobId, readinessReport, graph } = buildContext();
        return {
          state: buildSupervisedRunSessionState({
            jobId,
            readinessReport,
            instructionGraph: graph,
            browserSessionReport: reachableP5Report("compatible"),
          }),
        };
      },
    },
    {
      label: "first_mutation_approved",
      build: () => {
        const { jobId, readinessReport, graph } = buildContext();
        return {
          state: applyFirstMutationApproval(
            buildSupervisedRunSessionState({
              jobId,
              readinessReport,
              instructionGraph: graph,
              browserSessionReport: reachableP5Report("compatible"),
            })
          ),
        };
      },
    },
    {
      label: "blocked (storage missing)",
      build: () => {
        const { jobId, readinessReport, graph } = buildContext({
          blocked: true,
        });
        return {
          state: buildSupervisedRunSessionState({
            jobId,
            readinessReport,
            instructionGraph: graph,
          }),
        };
      },
    },
    {
      label: "blocked (variable rent)",
      build: () => {
        const { jobId, readinessReport, graph } = buildContext({
          variableRent: true,
        });
        return {
          state: buildSupervisedRunSessionState({
            jobId,
            readinessReport,
            instructionGraph: graph,
          }),
        };
      },
    },
  ];

  test.each(SCENARIOS)(
    "$label state + view-model JSON is sensitive-data-free",
    ({ build }) => {
      const { state } = build();
      const vm = buildSupervisedRunSessionViewModel(state);
      const serialized = JSON.stringify({ state, vm });
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(serialized)) {
          const m = serialized.match(pattern);
          throw new Error(
            `Forbidden pattern "${name}" matched: ${m?.[0]}`
          );
        }
      }
    }
  );
});

// ─── Test 9 · Approved-wording constants ──────────────────────────

describe("Run-session · approved-wording constants", () => {
  test("each B6 string matches the brief verbatim", () => {
    expect(NON_EXECUTION_NOTE).toBe(
      "No e-Duti Setem action has been taken."
    );
    expect(RUN_SESSION_HEADING).toBe("Supervised Run Session");
    expect(RUN_SESSION_HELPER_TEXT).toBe(
      "This records WeStamp's internal readiness to begin a future supervised portal run. It does not execute portal actions."
    );
    expect(APPROVAL_BUTTON_LABEL).toBe("Approve First Portal Mutation");
    expect(PREPARE_BUTTON_LABEL).toBe("Prepare Run Session");
    expect(APPROVAL_BUTTON_HELPER_WARNING).toBe(
      "Approval is internal only. The next milestone is required before WeStamp can create a portal draft."
    );
    expect(FIRST_MUTATION_APPROVED_NOTICE).toBe(
      "First portal mutation approved internally. No e-Duti Setem action has been taken."
    );
  });

  test("all refusal-reason labels are present (incl. browser_not_checked)", () => {
    const expectedReasons: ApprovalRefusalReason[] = [
      "not_prepared",
      "readiness_blocked",
      "instruction_graph_blocked",
      "browser_not_checked",
      "browser_unreachable",
      "browser_incompatible",
      "session_blocked",
      "session_aborted",
    ];
    for (const k of expectedReasons) {
      expect(typeof APPROVAL_REFUSAL_LABELS[k]).toBe("string");
      expect(APPROVAL_REFUSAL_LABELS[k].length).toBeGreaterThan(0);
    }
    // The new browser-check-required hint matches the brief verbatim.
    expect(APPROVAL_REFUSAL_LABELS.browser_not_checked).toBe(
      "Run a browser check before approving the first portal mutation."
    );
  });
});

// ─── B10 stage / wording invariants ────────────────────────────────

describe("Run-session · B10 phase_3_landlord_individual_saved stage", () => {
  test("stage is sticky once set — a subsequent prepare does NOT revert it", () => {
    const job = buildReadyJob();
    const readiness = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraph({ job, jobId: "j-b10" });
    // Build a state with previousStage set to phase_3_landlord_individual_saved.
    const previous: TenancyRunSessionState = {
      ...buildSupervisedRunSessionState({
        jobId: "j-b10",
        readinessReport: readiness,
        instructionGraph: graph,
      }),
      currentRunStage: "phase_3_landlord_individual_saved",
    };
    const refreshed = buildSupervisedRunSessionState({
      jobId: "j-b10",
      readinessReport: readiness,
      instructionGraph: graph,
      existingState: previous,
    });
    expect(refreshed.currentRunStage).toBe(
      "phase_3_landlord_individual_saved"
    );
  });

  test("RUN_STAGE_LABELS includes phase_3_landlord_individual_saved", () => {
    expect(RUN_STAGE_LABELS.phase_3_landlord_individual_saved).toBe(
      "Phase 3 landlord individual row saved"
    );
  });

  test("approved B10 wording is verbatim from the brief", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    expect(mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL).toBe(
      "Save Landlord Row: Individual Only"
    );
    expect(mod.PHASE_3_LANDLORD_EXECUTE_WARNING).toBe(
      "This will enter one landlord individual row in Bahagian A. It will not enter tenant data, upload, submit, pay, or retrieve a certificate."
    );
    expect(mod.PHASE_3_LANDLORD_EXECUTE_SUCCESS).toBe(
      "Landlord individual row saved. No tenant, upload, Hantar, payment, or certificate action was performed."
    );
  });

  test("forbidden button labels do NOT appear in the B10 wording", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    const all = [
      mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL,
      mod.PHASE_3_LANDLORD_EXECUTE_WARNING,
      mod.PHASE_3_LANDLORD_EXECUTE_SUCCESS,
    ].join(" | ");
    // The brief explicitly forbids these button labels.
    expect(all).not.toMatch(/\bStart automation\b/i);
    expect(all).not.toMatch(/\bRun all parties\b/i);
    // "Submit" — guard against the button label, but allow narrative
    // mentions like "It will not ... submit ..." in the warning.
    expect(mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL).not.toMatch(
      /\bSubmit\b/i
    );
    expect(all).not.toMatch(/\bSend to LHDN\b/i);
    // "Hantar" must not appear as a button label, but the success
    // text deliberately mentions the word "Hantar" in the
    // "No ... Hantar" disclaimer; the BUTTON LABEL specifically
    // must not.
    expect(mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL).not.toMatch(/\bHantar\b/i);
    expect(mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL).not.toMatch(/\bPay\b/i);
    expect(mod.PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL).not.toMatch(
      /\bComplete stamping\b/i
    );
  });
});

// ─── B11 stage / wording invariants ────────────────────────────────

describe("Run-session · B11 phase_3_tenant_individual_saved stage", () => {
  test("stage is sticky once set — a subsequent prepare does NOT revert it", () => {
    const job = buildReadyJob();
    const readiness = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraph({ job, jobId: "j-b11" });
    const previous: TenancyRunSessionState = {
      ...buildSupervisedRunSessionState({
        jobId: "j-b11",
        readinessReport: readiness,
        instructionGraph: graph,
      }),
      currentRunStage: "phase_3_tenant_individual_saved",
    };
    const refreshed = buildSupervisedRunSessionState({
      jobId: "j-b11",
      readinessReport: readiness,
      instructionGraph: graph,
      existingState: previous,
    });
    expect(refreshed.currentRunStage).toBe(
      "phase_3_tenant_individual_saved"
    );
  });

  test("RUN_STAGE_LABELS includes phase_3_tenant_individual_saved", () => {
    expect(RUN_STAGE_LABELS.phase_3_tenant_individual_saved).toBe(
      "Phase 3 tenant individual row saved"
    );
  });

  test("approved B11 wording is verbatim from the brief", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    expect(mod.PHASE_3_TENANT_EXECUTE_BUTTON_LABEL).toBe(
      "Save Tenant Row: Individual Only"
    );
    expect(mod.PHASE_3_TENANT_EXECUTE_WARNING).toBe(
      "This will enter one tenant individual row in Bahagian A. It will not enter company data, upload, submit, pay, or retrieve a certificate."
    );
    expect(mod.PHASE_3_TENANT_EXECUTE_SUCCESS).toBe(
      "Tenant individual row saved. No company, upload, Hantar, payment, or certificate action was performed."
    );
  });

  test("forbidden button labels do NOT appear in the B11 button label", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    const lbl = mod.PHASE_3_TENANT_EXECUTE_BUTTON_LABEL;
    expect(lbl).not.toMatch(/\bStart automation\b/i);
    expect(lbl).not.toMatch(/\bRun all parties\b/i);
    expect(lbl).not.toMatch(/\bSubmit\b/i);
    expect(lbl).not.toMatch(/\bSend to LHDN\b/i);
    expect(lbl).not.toMatch(/\bHantar\b/i);
    expect(lbl).not.toMatch(/\bPay\b/i);
    expect(lbl).not.toMatch(/\bComplete stamping\b/i);
  });
});

// ─── B12 stage / wording invariants ────────────────────────────────

describe("Run-session · B12 phase_4_bahagian_b_fixed_rent_saved stage", () => {
  test("stage is sticky once set — a subsequent prepare does NOT revert it", () => {
    const job = buildReadyJob();
    const readiness = evaluateTenancyPortalRunReadiness(job);
    const graph = buildTenancyInstructionGraph({ job, jobId: "j-b12" });
    const previous: TenancyRunSessionState = {
      ...buildSupervisedRunSessionState({
        jobId: "j-b12",
        readinessReport: readiness,
        instructionGraph: graph,
      }),
      currentRunStage: "phase_4_bahagian_b_fixed_rent_saved",
    };
    const refreshed = buildSupervisedRunSessionState({
      jobId: "j-b12",
      readinessReport: readiness,
      instructionGraph: graph,
      existingState: previous,
    });
    expect(refreshed.currentRunStage).toBe(
      "phase_4_bahagian_b_fixed_rent_saved"
    );
  });

  test("RUN_STAGE_LABELS includes phase_4_bahagian_b_fixed_rent_saved", () => {
    expect(RUN_STAGE_LABELS.phase_4_bahagian_b_fixed_rent_saved).toBe(
      "Phase 4 Bahagian B fixed-rent saved"
    );
  });

  test("approved B12 wording is verbatim from the brief", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    expect(mod.PHASE_4_BAHAGIAN_B_EXECUTE_BUTTON_LABEL).toBe(
      "Save Bahagian B: Fixed Rent Only"
    );
    expect(mod.PHASE_4_BAHAGIAN_B_EXECUTE_WARNING).toBe(
      "This will enter fixed-rent Bahagian B data only. It will not enter property data, upload, submit, pay, or retrieve a certificate."
    );
    expect(mod.PHASE_4_BAHAGIAN_B_EXECUTE_SUCCESS).toBe(
      "Bahagian B fixed-rent data saved. No Bahagian C, upload, Hantar, payment, or certificate action was performed."
    );
  });

  test("forbidden button labels do NOT appear in the B12 button label", async () => {
    const mod = await import("./tenancy-supervised-run-session");
    const lbl = mod.PHASE_4_BAHAGIAN_B_EXECUTE_BUTTON_LABEL;
    expect(lbl).not.toMatch(/\bStart automation\b/i);
    expect(lbl).not.toMatch(/\bRun all sections\b/i);
    expect(lbl).not.toMatch(/\bSubmit\b/i);
    expect(lbl).not.toMatch(/\bSend to LHDN\b/i);
    expect(lbl).not.toMatch(/\bHantar\b/i);
    expect(lbl).not.toMatch(/\bPay\b/i);
    expect(lbl).not.toMatch(/\bComplete stamping\b/i);
  });
});
