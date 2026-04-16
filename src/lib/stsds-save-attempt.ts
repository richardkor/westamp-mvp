/**
 * WeStamp — STSDS Maklumat Am Save Attempt
 *
 * Executes the first real Maklumat Am save action under strict local/dev
 * gating. Requires active authorization, eligible preflight, and the
 * existing portal probe environment gate.
 *
 * After the save outcome is observed, automation stops immediately.
 * No next-tab progression occurs.
 *
 * SAFETY:
 * - Only the Maklumat Am save is performed
 * - No continue-to-tab
 * - No upload, payment, certificate, or submission
 * - Stops after post-save observation
 */

import { StampingJob } from "./stamping-types";
import {
  PortalSaveAttempt,
  PortalSaveAttemptStatus,
  PortalSaveAttemptEvidence,
  PortalSaveAttemptOutcome,
  PortalProbeArtifact,
  PortalLane,
  PortalStateSnapshot,
  PortalStateFieldValue,
  PortalStateTabSnapshot,
  BrowserAutomationTarget,
  BrowserAutomationInstruction,
} from "./stsds-types";
import { PORTAL_FIELD_KEYS } from "./stsds-portal-schema";
import {
  PlaywrightStsdsDriver,
  launchAuthenticatedSession,
} from "./stsds-playwright-driver";
import { evaluateMaklumatAmSaveAuthorization } from "./stsds-save-authorization";

/** Local artifact directory convention (shared with probe). */
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
 * Validate all preconditions before attempting the save.
 * Returns a block reason string if blocked, or null if clear to proceed.
 */
function validatePreconditions(job: StampingJob): string | null {
  // Require portal draft
  if (!job.portalDraft) {
    return "No portal draft exists.";
  }

  // Require routing suggestion
  if (!job.routingSuggestion) {
    return "No routing suggestion exists.";
  }

  // Require browser instructions
  if (!job.browserInstructions) {
    return "No browser instructions have been compiled.";
  }

  // Require save preflight to be eligible
  if (!job.savePreflight) {
    return "Save preflight has not been evaluated.";
  }
  if (job.savePreflight.status !== "eligible") {
    return `Save preflight status is "${job.savePreflight.status}" — must be "eligible" for the first save attempt.`;
  }

  // Require mutation guard to not be refused
  if (job.savePreflight.mutationGuard.decision === "refused") {
    return `Mutation guard refuses save: ${job.savePreflight.mutationGuard.explanation}`;
  }

  // Require active non-stale authorization
  if (!job.saveAuthorization) {
    return "No save authorization exists.";
  }

  // Re-evaluate authorization freshness
  const freshAuth = evaluateMaklumatAmSaveAuthorization(job);
  if (freshAuth.status !== "active") {
    return `Save authorization is "${freshAuth.status}": ${freshAuth.explanation}`;
  }

  // Require a completed probe (the save attempt follows a successful probe run)
  if (!job.portalProbe) {
    return "No portal probe has been run.";
  }
  if (job.portalProbe.status !== "completed") {
    return `Portal probe status is "${job.portalProbe.status}" — must be completed.`;
  }

  return null;
}

/**
 * Run the first Maklumat Am save attempt.
 *
 * This is the main entry point for the local/dev save attempt.
 *
 * It:
 * 1. Validates all authorization and preflight preconditions
 * 2. Launches a browser session (reusing existing probe path)
 * 3. Navigates to the portal and replays Maklumat Am fill steps
 * 4. Clicks the save button
 * 5. Captures post-save evidence
 * 6. Stops immediately — no next-tab progression
 *
 * @param job - The stamping job with all layers populated
 * @returns The save attempt result
 */
export async function runMaklumatAmSaveAttempt(
  job: StampingJob
): Promise<PortalSaveAttempt> {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";

  // ── Validate preconditions ──────────────────────────────────────
  const blockReason = validatePreconditions(job);
  if (blockReason) {
    return {
      status: "blocked",
      lane,
      attemptedAt: now,
      authorizationWasActive: job.saveAuthorization?.status === "active",
      preflightWasEligible: job.savePreflight?.status === "eligible",
      blockReason,
      notes: [`Save attempt blocked: ${blockReason}`],
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
        authorizationWasActive: true,
        preflightWasEligible: true,
        blockReason: laneResult.failureReason,
        artifactDir,
        notes: [`Lane selection failed: ${laneResult.failureReason}`],
      };
    }

    // ── Replay Maklumat Am field fills from browser instructions ─
    const instructions = job.browserInstructions!.instructions;
    const fillTypes = new Set([
      "fill_field",
      "select_dropdown_option",
      "wait_for_read_only_value",
      "assert_read_only_value",
    ]);

    for (const instr of instructions) {
      // Skip non-fill instructions and blocked/advisory instructions
      if (!fillTypes.has(instr.type)) continue;
      if (instr.blocked) continue;
      if (instr.isAdvisory) continue;
      if (instr.type === "save_current_section") continue;
      if (instr.type === "continue_to_tab") continue;
      if (instr.type === "stop_for_review") continue;

      // Execute the field fill
      let result;
      switch (instr.type) {
        case "fill_field":
          result = await driver.fillField(
            instr.target ?? {},
            instr.payload ?? { value: null, source: "none" }
          );
          break;
        case "select_dropdown_option":
          result = await driver.selectDropdownOption(
            instr.target ?? {},
            instr.payload ?? { value: null, source: "none" }
          );
          break;
        case "wait_for_read_only_value":
          result = await driver.waitForReadOnlyValue(
            instr.target ?? {},
            instr.expectations
          );
          break;
        case "assert_read_only_value":
          result = await driver.assertReadOnlyValue(
            instr.target ?? {},
            instr.payload ?? { value: null, source: "none" },
            instr.expectations
          );
          break;
        default:
          continue;
      }

      if (!result.success) {
        notes.push(
          `Field fill warning at instruction ${instr.seq} (${instr.type}): ${result.failureReason}`
        );
        // Non-fatal for fill steps — continue and attempt save
      }
    }

    // ── Pre-save screenshot ─────────────────────────────────────
    const preSaveTs = new Date().toISOString().replace(/[:.]/g, "-");
    const preSavePath = `${artifactDir}/pre_save_${preSaveTs}.png`;
    await driver.captureScreenshot(preSavePath);

    // ── Perform the actual save click ───────────────────────────
    notes.push("Performing Maklumat Am save click...");
    const saveResult = await driver.performMaklumatAmSave();

    // ── Post-save screenshot ────────────────────────────────────
    const postSaveTs = new Date().toISOString().replace(/[:.]/g, "-");
    const postSaveFileName = `post_save_${postSaveTs}.png`;
    const postSavePath = `${artifactDir}/${postSaveFileName}`;
    await driver.captureScreenshot(postSavePath);

    // ── Post-save field readback (for post-save snapshot) ────────
    // Re-read Maklumat Am fields after save to capture post-save state.
    // This produces a distinct snapshot from any pre-save probe snapshot.
    const postSaveSnapshot = await capturePostSaveSnapshot(
      driver,
      lane,
      instructions,
      notes
    );

    // ── Determine outcome ───────────────────────────────────────
    let outcome: PortalSaveAttemptOutcome;
    if (!saveResult.success) {
      if (
        saveResult.observedMessage &&
        (saveResult.observedMessage.toLowerCase().includes("ralat") ||
          saveResult.observedMessage.toLowerCase().includes("error") ||
          saveResult.observedMessage.toLowerCase().includes("sila"))
      ) {
        outcome = saveResult.observedMessage.toLowerCase().includes("validation")
          ? "validation_error"
          : "error_banner";
      } else if (saveResult.failureReason?.includes("Could not find")) {
        outcome = "no_visible_change";
      } else {
        outcome = "unknown";
      }
    } else {
      if (
        saveResult.observedMessage &&
        (saveResult.observedMessage.toLowerCase().includes("berjaya") ||
          saveResult.observedMessage.toLowerCase().includes("success"))
      ) {
        outcome = "success_message";
      } else if (
        saveResult.observedMessage?.includes("no explicit success")
      ) {
        outcome = "no_visible_change";
      } else {
        outcome = "success_message";
      }
    }

    // ── Build evidence ──────────────────────────────────────────
    const evidence: PortalSaveAttemptEvidence = {
      screenshotFilePath: postSavePath,
      screenshotFileName: postSaveFileName,
      observedPortalMessage: saveResult.observedMessage,
      outcome,
      notes: [
        ...notes,
        saveResult.success
          ? "Save click performed — portal response captured."
          : `Save click failed: ${saveResult.failureReason}`,
      ],
    };

    // ── HARD STOP — no further automation ────────────────────────
    notes.push("STOP: Automation stopped after save outcome observation.");

    const status: PortalSaveAttemptStatus = saveResult.success
      ? "completed_with_stop"
      : "failed";

    // Only clear failure flag if save actually succeeded
    if (saveResult.success) {
      browserSessionFailed = false;
    }

    return {
      status,
      lane,
      attemptedAt: now,
      authorizationWasActive: true,
      preflightWasEligible: true,
      evidence,
      postSaveSnapshot: postSaveSnapshot ?? undefined,
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

/**
 * Capture a post-save snapshot by reading back Maklumat Am field values
 * from the portal after the save click.
 *
 * This produces a distinct PortalStateSnapshot with source "browser_captured"
 * that represents the portal state AFTER the save — not the pre-save probe state.
 *
 * Non-fatal: if any individual readback fails, it is skipped.
 * Returns null only if no fields could be read back at all.
 */
async function capturePostSaveSnapshot(
  driver: PlaywrightStsdsDriver,
  lane: PortalLane,
  instructions: BrowserAutomationInstruction[],
  notes: string[]
): Promise<PortalStateSnapshot | null> {
  const now = new Date().toISOString();
  const allFields: PortalStateFieldValue[] = [];

  // Readback types — these are the instruction types that correspond
  // to fields we can read back after save
  const readbackTypes = new Set([
    "fill_field",
    "select_dropdown_option",
    "wait_for_read_only_value",
    "assert_read_only_value",
  ]);

  for (const instr of instructions) {
    if (!readbackTypes.has(instr.type)) continue;
    if (instr.blocked) continue;
    if (!instr.target?.fieldKey) continue;

    try {
      // Use waitForReadOnlyValue or assertReadOnlyValue for readback
      // since after save, all fields should be readable
      const result = await driver.waitForReadOnlyValue(
        instr.target,
        [] // no expectations — just reading current value
      );

      if (result.observedValue !== undefined) {
        allFields.push({
          fieldKey: instr.target.fieldKey,
          observedValue: result.observedValue ?? null,
          tab: instr.target.tabKey ?? "maklumat_am",
          portalLabel: instr.target.portalLabel,
          selectorMethod: result.selectorMethod,
          readbackConfidence: result.readbackConfidence,
          readbackNote: result.readbackNote,
          rawObservedValue: result.rawObservedValue,
        });
      }
    } catch {
      // Non-fatal — skip this field in the post-save snapshot
    }
  }

  // Also add the lane selection as an observed field
  allFields.push({
    fieldKey: PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION,
    observedValue: lane,
    tab: "dashboard",
  });

  if (allFields.length <= 1) {
    // Only lane selection — no real field readback succeeded
    notes.push("Post-save snapshot: no Maklumat Am fields could be read back after save.");
    return null;
  }

  notes.push(`Post-save snapshot: ${allFields.length} field(s) read back after save.`);

  // Group by tab
  const tabMap = new Map<string, PortalStateFieldValue[]>();
  for (const field of allFields) {
    if (!tabMap.has(field.tab)) tabMap.set(field.tab, []);
    tabMap.get(field.tab)!.push(field);
  }

  const tabs: PortalStateTabSnapshot[] = [];
  for (const [tabKey, fields] of tabMap) {
    tabs.push({
      tabKey,
      tabLabel: tabKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      fields,
    });
  }

  return {
    lane,
    capturedAt: now,
    source: "browser_captured",
    tabs,
    allFields,
  };
}
