/**
 * WeStamp — STSDS Internal State Refresh Orchestrator
 *
 * Rebuilds the internal STSDS artifacts from current job data in a
 * consistent order:
 *   1. Portal Draft (preserving manual edits)
 *   2. Submission Readiness
 *   3. Execution Preview
 *   4. Automation Plan
 *
 * This is NOT a live portal interaction. It rebuilds internal state
 * only. Does NOT touch any external system.
 */

import { StampingJob } from "./stamping-types";
import { buildPortalDraft, validatePortalDraft } from "./stsds-portal-draft";
import { evaluateSubmissionReadiness } from "./stsds-submission-readiness";
import { compileExecutionPreview } from "./stsds-execution-preview";
import { buildStsdsAutomationPlan } from "./stsds-automation-plan";
import { StsdsPortalDraft } from "./stsds-types";

export interface StsdsRefreshResult {
  success: boolean;
  refreshedAt: string;
  /** Which artifacts were rebuilt. */
  rebuilt: string[];
  /** Any issues encountered during rebuild. */
  issues: string[];
}

/**
 * Rebuild all internal STSDS artifacts from current job state.
 *
 * IMPORTANT: Preserves user-entered portal-draft fields (stampOffice,
 * instrumentDate, receivedInMalaysiaDate, editableInstrumentCategory)
 * by merging them back after the base draft is rebuilt.
 *
 * Returns the updated partial job fields to be persisted.
 */
export function refreshStsdsState(
  job: StampingJob
): {
  updates: Partial<StampingJob>;
  result: StsdsRefreshResult;
} {
  const now = new Date().toISOString();
  const rebuilt: string[] = [];
  const issues: string[] = [];

  if (!job.routingSuggestion) {
    return {
      updates: {},
      result: { success: false, refreshedAt: now, rebuilt, issues: ["No routing suggestion available."] },
    };
  }

  // ── Step 1: Rebuild Portal Draft (preserving manual edits) ────────
  const existingDraft = job.portalDraft;
  const baseDraft = buildPortalDraft(job);

  let finalDraft: StsdsPortalDraft | undefined;
  if (baseDraft) {
    // Preserve user-entered values from the existing draft
    if (existingDraft) {
      const lane = baseDraft.lane;
      if (lane === "sewa_pajakan" && baseDraft.maklumatAmSewaPajakan) {
        const existing = existingDraft.maklumatAmSewaPajakan;
        if (existing) {
          baseDraft.maklumatAmSewaPajakan.stampOffice =
            baseDraft.maklumatAmSewaPajakan.stampOffice || existing.stampOffice;
          baseDraft.maklumatAmSewaPajakan.instrumentDate =
            baseDraft.maklumatAmSewaPajakan.instrumentDate || existing.instrumentDate;
          baseDraft.maklumatAmSewaPajakan.receivedInMalaysiaDate =
            baseDraft.maklumatAmSewaPajakan.receivedInMalaysiaDate ?? existing.receivedInMalaysiaDate;
        }
      } else if (lane === "penyeteman_am" && baseDraft.maklumatAmPenyetemanAm) {
        const existing = existingDraft.maklumatAmPenyetemanAm;
        if (existing) {
          baseDraft.maklumatAmPenyetemanAm.stampOffice =
            baseDraft.maklumatAmPenyetemanAm.stampOffice || existing.stampOffice;
          baseDraft.maklumatAmPenyetemanAm.instrumentDate =
            baseDraft.maklumatAmPenyetemanAm.instrumentDate || existing.instrumentDate;
          baseDraft.maklumatAmPenyetemanAm.receivedInMalaysiaDate =
            baseDraft.maklumatAmPenyetemanAm.receivedInMalaysiaDate ?? existing.receivedInMalaysiaDate;
          baseDraft.maklumatAmPenyetemanAm.editableInstrumentCategory =
            baseDraft.maklumatAmPenyetemanAm.editableInstrumentCategory || existing.editableInstrumentCategory;
        }
      }
    }

    // Re-validate and set status
    const validation = validatePortalDraft(baseDraft);
    baseDraft.status = validation.isComplete ? "ready_for_review" : "draft";
    finalDraft = baseDraft;
    rebuilt.push("portalDraft");
  } else {
    issues.push("Could not rebuild portal draft.");
  }

  // Build a working job snapshot with the refreshed draft
  const jobWithDraft: StampingJob = {
    ...job,
    portalDraft: finalDraft ?? job.portalDraft,
  };

  // ── Step 2: Rebuild Submission Readiness ───────────────────────────
  const readiness = evaluateSubmissionReadiness(jobWithDraft);
  if (readiness) {
    rebuilt.push("submissionReadiness");
  } else {
    issues.push("Could not evaluate submission readiness.");
  }

  // ── Step 3: Rebuild Execution Preview ─────────────────────────────
  const preview = compileExecutionPreview(jobWithDraft);
  if (preview) {
    rebuilt.push("executionPreview");
  } else {
    issues.push("Could not compile execution preview.");
  }

  // ── Step 4: Rebuild Automation Plan ───────────────────────────────
  const plan = buildStsdsAutomationPlan(jobWithDraft);
  if (plan) {
    rebuilt.push("automationPlan");
  } else {
    issues.push("Could not build automation plan.");
  }

  const updates: Partial<StampingJob> = {};
  if (finalDraft) updates.portalDraft = finalDraft;
  if (readiness) updates.submissionReadiness = readiness;
  if (preview) updates.executionPreview = preview;
  if (plan) updates.automationPlan = plan;

  return {
    updates,
    result: {
      success: rebuilt.length > 0,
      refreshedAt: now,
      rebuilt,
      issues,
    },
  };
}
