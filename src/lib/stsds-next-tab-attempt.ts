/**
 * WeStamp — STSDS Next-Tab Progression Attempt
 *
 * Executes the first real next-tab progression click from Maklumat Am
 * into Bahagian A under strict local/dev gating. Requires active
 * next-tab authorization, eligible next-tab preflight, and the
 * existing portal environment gate.
 *
 * After the progression outcome is observed, automation stops immediately.
 * No Bahagian A fields are filled. No further tabs are clicked.
 *
 * SAFETY:
 * - Only the Maklumat Am → Bahagian A progression is performed
 * - No field filling in Bahagian A
 * - No further tab clicks
 * - No upload, payment, certificate, or submission
 * - Stops after post-click observation
 */

import { StampingJob } from "./stamping-types";
import {
  PortalNextTabAttempt,
  PortalNextTabAttemptStatus,
  PortalNextTabAttemptEvidence,
  PortalNextTabAttemptOutcome,
  PortalLane,
  PortalTabKey,
} from "./stsds-types";
import {
  PlaywrightStsdsDriver,
  launchAuthenticatedSession,
} from "./stsds-playwright-driver";
import { evaluateNextTabProgressionAuthorization } from "./stsds-next-tab-authorization";
import { getPortalSchema } from "./stsds-portal-schema";

/** Local artifact directory convention (shared with probe/save). */
const ARTIFACT_BASE_DIR = "data/portal-probe-artifacts";

/**
 * Ensure the artifact directory exists for a job.
 */
async function ensureArtifactDir(jobId: string): Promise<string> {
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(ARTIFACT_BASE_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the immediate next tab after Maklumat Am from schema.
 */
function resolveNextTab(
  lane: PortalLane
): { tabKey: PortalTabKey; tabLabel: string } | null {
  const schema = getPortalSchema(lane);
  const currentIndex = schema.findIndex((s) => s.tabKey === "maklumat_am");
  if (currentIndex < 0 || currentIndex >= schema.length - 1) return null;
  const next = schema[currentIndex + 1];
  return { tabKey: next.tabKey, tabLabel: next.tabLabel };
}

/**
 * Validate all preconditions before attempting next-tab progression.
 * Returns a block reason string if blocked, or null if clear to proceed.
 */
function validatePreconditions(job: StampingJob): string | null {
  // Require routing suggestion
  if (!job.routingSuggestion) {
    return "No routing suggestion exists.";
  }

  // Require save attempt completed
  if (!job.saveAttempt) {
    return "No save attempt has been performed.";
  }
  if (job.saveAttempt.status !== "completed_with_stop") {
    return `Save attempt status is "${job.saveAttempt.status}" — must be "completed_with_stop".`;
  }

  // Require next-tab preflight to be eligible
  if (!job.nextTabPreflight) {
    return "Next-tab preflight has not been evaluated.";
  }
  if (job.nextTabPreflight.status !== "eligible_for_later_attempt") {
    return `Next-tab preflight status is "${job.nextTabPreflight.status}" — must be "eligible_for_later_attempt".`;
  }

  // Require next-tab guard to not be refused
  if (job.nextTabPreflight.guard.decision === "refused") {
    return `Next-tab guard refuses progression: ${job.nextTabPreflight.guard.explanation}`;
  }

  // Require active non-stale next-tab authorization
  if (!job.nextTabAuthorization) {
    return "No next-tab authorization exists.";
  }

  // Re-evaluate authorization freshness
  const freshAuth = evaluateNextTabProgressionAuthorization(job);
  if (freshAuth.status !== "active") {
    return `Next-tab authorization is "${freshAuth.status}": ${freshAuth.explanation}`;
  }

  // Require post-save reconciliation
  if (!job.postSaveReconciliation) {
    return "No post-save reconciliation exists.";
  }

  return null;
}

/**
 * Run the first next-tab progression attempt from Maklumat Am into Bahagian A.
 *
 * This is the main entry point for the local/dev next-tab attempt.
 *
 * It:
 * 1. Validates all authorization and preflight preconditions
 * 2. Resolves the next tab from schema
 * 3. Launches a browser session
 * 4. Navigates to the portal and replays Maklumat Am state (lane selection)
 * 5. Clicks the next tab (Bahagian A)
 * 6. Captures post-click evidence
 * 7. Stops immediately — no Bahagian A field filling, no further tabs
 */
export async function runNextTabProgressionAttempt(
  job: StampingJob
): Promise<PortalNextTabAttempt> {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";

  const nextTab = resolveNextTab(lane);
  const fromTabKey: PortalTabKey = "maklumat_am";
  const toTabKey: PortalTabKey = nextTab?.tabKey ?? "bahagian_a";
  const toTabLabel: string = nextTab?.tabLabel ?? "Bahagian A";

  // ── Validate preconditions ──────────────────────────────────────
  const blockReason = validatePreconditions(job);
  if (blockReason) {
    return {
      status: "blocked",
      lane,
      attemptedAt: now,
      fromTabKey,
      toTabKey,
      toTabLabel,
      authorizationWasActive:
        job.nextTabAuthorization?.status === "active",
      preflightWasEligible:
        job.nextTabPreflight?.status === "eligible_for_later_attempt",
      blockReason,
      notes: [`Next-tab attempt blocked: ${blockReason}`],
    };
  }

  // ── Ensure artifact directory ───────────────────────────────────
  let artifactDir: string;
  try {
    artifactDir = await ensureArtifactDir(job.id);
  } catch {
    artifactDir = `${ARTIFACT_BASE_DIR}/${job.id}`;
  }

  // ── Launch browser session ──────────────────────────────────────
  let page;
  let cleanup: ((failed?: boolean) => Promise<void>) | null = null;
  let browserSessionFailed = true;

  try {
    const session = await launchAuthenticatedSession();
    page = session.page;
    cleanup = session.cleanup;
  } catch (err) {
    return {
      status: "failed",
      lane,
      attemptedAt: now,
      fromTabKey,
      toTabKey,
      toTabLabel,
      authorizationWasActive: true,
      preflightWasEligible: true,
      blockReason: `Failed to launch browser session: ${err instanceof Error ? err.message : String(err)}`,
      notes: ["Browser session launch failed."],
    };
  }

  const driver = new PlaywrightStsdsDriver(page);
  const notes: string[] = [];

  try {
    // ── Navigate to portal ──────────────────────────────────────
    const navResult = await driver.navigateToPage({});
    if (!navResult.success) {
      return {
        status: "failed",
        lane,
        attemptedAt: now,
        fromTabKey,
        toTabKey,
        toTabLabel,
        authorizationWasActive: true,
        preflightWasEligible: true,
        blockReason: navResult.failureReason,
        artifactDir,
        notes: [`Navigation failed: ${navResult.failureReason}`],
      };
    }

    // ── Open application flow ───────────────────────────────────
    const openResult = await driver.openApplicationFlow({});
    if (!openResult.success) {
      return {
        status: "failed",
        lane,
        attemptedAt: now,
        fromTabKey,
        toTabKey,
        toTabLabel,
        authorizationWasActive: true,
        preflightWasEligible: true,
        blockReason: openResult.failureReason,
        artifactDir,
        notes: [`Open application flow failed: ${openResult.failureReason}`],
      };
    }

    // ── Select lane ─────────────────────────────────────────────
    const laneResult = await driver.selectLane(
      {},
      { value: lane, source: "routing_suggestion" }
    );
    if (!laneResult.success) {
      return {
        status: "failed",
        lane,
        attemptedAt: now,
        fromTabKey,
        toTabKey,
        toTabLabel,
        authorizationWasActive: true,
        preflightWasEligible: true,
        blockReason: laneResult.failureReason,
        artifactDir,
        notes: [`Lane selection failed: ${laneResult.failureReason}`],
      };
    }

    // ── Pre-click screenshot ────────────────────────────────────
    const preClickTs = new Date().toISOString().replace(/[:.]/g, "-");
    const preClickPath = `${artifactDir}/pre_next_tab_${preClickTs}.png`;
    await driver.captureScreenshot(preClickPath);

    // ── Perform the next-tab click ──────────────────────────────
    notes.push(`Performing next-tab click into ${toTabLabel}...`);
    const clickResult = await driver.performNextTabProgression(toTabLabel);

    // ── Post-click screenshot ───────────────────────────────────
    const postClickTs = new Date().toISOString().replace(/[:.]/g, "-");
    const postClickFileName = `post_next_tab_${postClickTs}.png`;
    const postClickPath = `${artifactDir}/${postClickFileName}`;
    await driver.captureScreenshot(postClickPath);

    // ── Determine outcome ───────────────────────────────────────
    let outcome: PortalNextTabAttemptOutcome;
    if (!clickResult.success) {
      if (
        clickResult.observedMessage &&
        (clickResult.observedMessage.toLowerCase().includes("ralat") ||
          clickResult.observedMessage.toLowerCase().includes("error"))
      ) {
        outcome = "error_or_validation";
      } else if (
        clickResult.failureReason?.includes("Could not find")
      ) {
        outcome = "no_visible_change";
      } else {
        outcome = "unknown";
      }
    } else {
      if (clickResult.targetTabAppearedActive) {
        outcome = "tab_became_active";
      } else if (clickResult.observedTabLabel) {
        outcome = "tab_content_visible";
      } else {
        outcome = "no_visible_change";
      }
    }

    // ── Build evidence ──────────────────────────────────────────
    const evidence: PortalNextTabAttemptEvidence = {
      screenshotFilePath: postClickPath,
      screenshotFileName: postClickFileName,
      observedPortalMessage: clickResult.observedMessage,
      outcome,
      targetTabAppearedActive: clickResult.targetTabAppearedActive,
      observedTabLabel: clickResult.observedTabLabel,
      notes: [
        ...notes,
        clickResult.success
          ? `Next-tab click performed — ${toTabLabel} response captured.`
          : `Next-tab click failed: ${clickResult.failureReason}`,
      ],
    };

    // ── HARD STOP — no further automation ────────────────────────
    notes.push(
      "STOP: Automation stopped after next-tab progression outcome observation."
    );

    const status: PortalNextTabAttemptStatus = clickResult.success
      ? "completed_with_stop"
      : "failed";

    // Only clear failure flag if the tab click actually succeeded
    if (clickResult.success) {
      browserSessionFailed = false;
    }

    return {
      status,
      lane,
      attemptedAt: now,
      fromTabKey,
      toTabKey,
      toTabLabel,
      authorizationWasActive: true,
      preflightWasEligible: true,
      evidence,
      artifactDir,
      notes,
    };
  } finally {
    // Always clean up the browser session
    if (cleanup) {
      await cleanup(browserSessionFailed).catch(() => {});
    }
  }
}
