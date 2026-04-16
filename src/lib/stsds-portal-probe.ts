/**
 * WeStamp — STSDS Maklumat Am Portal Probe
 *
 * A dev/local-only probe that runs real Playwright automation against
 * the e-Duti Setem portal for the Maklumat Am stage only.
 *
 * The probe:
 * - Consumes the compiled browser instruction set from a job
 * - Launches a headed Chromium browser with manual login support
 * - Executes only the supported Maklumat Am instruction types
 * - Reads back actual observed portal values
 * - Builds a real observed portal-state snapshot
 * - Runs the existing assertion evaluator against observed values
 * - STOPS before save/continue/submit — never creates a portal record
 *
 * This is a LOCAL/DEV tool only.
 * NOT for serverless/Vercel production deployment.
 * NOT a background automation path.
 */

import { StampingJob } from "./stamping-types";
import {
  BrowserAutomationInstruction,
  BrowserExecutionInstructionResult,
  PortalStateSnapshot,
  PortalStateFieldValue,
  PortalStateTabSnapshot,
  PortalLane,
  SelectorResolutionMethod,
  ReadbackConfidence,
  PortalProbeArtifact,
  PortalProbeArtifactCollection,
  PortalProbeFieldEvidence,
} from "./stsds-types";
import { BrowserDriverOperationResult } from "./stsds-browser-driver";
import {
  PlaywrightStsdsDriver,
  launchAuthenticatedSession,
} from "./stsds-playwright-driver";
import { evaluatePortalAssertions } from "./stsds-assertions";
import { PORTAL_FIELD_KEYS } from "./stsds-portal-schema";

/**
 * Instruction types that the Maklumat Am probe is permitted to execute.
 * All others are stopped/refused.
 */
const PROBE_ALLOWED_TYPES = new Set([
  "navigate_to_page",
  "open_application_flow",
  "select_lane",
  "fill_field",
  "select_dropdown_option",
  "wait_for_read_only_value",
  "assert_read_only_value",
]);

/**
 * Instruction types that must be refused (safety boundary).
 */
const PROBE_REFUSED_TYPES = new Set([
  "save_current_section",
  "continue_to_tab",
]);

/**
 * Status of the portal probe.
 */
export type PortalProbeStatus =
  | "not_ready"
  | "ready_for_local_run"
  | "completed"
  | "blocked"
  | "failed";

/**
 * Result of a single probe step.
 */
export interface PortalProbeStepResult {
  seq: number;
  type: string;
  description: string;
  status: "executed" | "blocked" | "failed" | "skipped" | "refused";
  observedValue?: string | null;
  note?: string;
  /** Which selector strategy succeeded for this step, if applicable. */
  selectorMethod?: SelectorResolutionMethod;
  /** Readback confidence level, if applicable. */
  readbackConfidence?: ReadbackConfidence;
  /** Readback diagnostic note, if applicable. */
  readbackNote?: string;
  /** Raw observed value before normalization, if normalization was applied. */
  rawObservedValue?: string | null;
}

/**
 * The full result of a Maklumat Am portal probe.
 */
export interface PortalProbeResult {
  /** Overall probe status. */
  status: PortalProbeStatus;
  /** Which portal lane was probed. */
  lane: PortalLane;
  /** ISO 8601 timestamp. */
  probedAt: string;
  /** Per-instruction step results. */
  stepResults: PortalProbeStepResult[];
  /** The real observed portal-state snapshot. */
  observedSnapshot: PortalStateSnapshot | null;
  /** Assertion evaluation against the observed snapshot, if available. */
  assertionEvaluationStatus: string | null;
  /** Count of instructions executed. */
  executedCount: number;
  /** Count of instructions refused (safety stop). */
  refusedCount: number;
  /** Count of instructions that failed. */
  failedCount: number;
  /** Human-readable notes. */
  notes: string[];
  /** Captured artifacts (screenshots + field evidence). Metadata only. */
  artifactCollection?: PortalProbeArtifactCollection;
}

// ─── Artifact Capture ──────────────────────────────────────────────

/**
 * Local/dev-only artifact directory convention.
 * Screenshots and diagnostic files are stored here per-job.
 * NOT a production storage path.
 */
const ARTIFACT_BASE_DIR = "data/portal-probe-artifacts";

/**
 * Checkpoint identifiers for screenshot capture.
 * Screenshots are taken only at these meaningful safe points.
 */
const SCREENSHOT_CHECKPOINTS = {
  AFTER_LANDING: "after_landing",
  AFTER_LANE_SELECTION: "after_lane_selection",
  AFTER_DOCUMENT_SELECTION: "after_document_selection",
  AFTER_DERIVED_GROUP_VISIBLE: "after_derived_group_visible",
  BEFORE_SAFETY_STOP: "before_safety_stop",
} as const;

/**
 * Ensure the artifact directory exists for a given job.
 * Returns the directory path (relative to project root).
 */
async function ensureArtifactDir(jobId: string): Promise<string> {
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(ARTIFACT_BASE_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Capture a screenshot at a named checkpoint.
 * Returns the artifact metadata if successful, null otherwise.
 */
async function captureCheckpointScreenshot(
  driver: PlaywrightStsdsDriver,
  artifactDir: string,
  checkpoint: string,
  note?: string
): Promise<PortalProbeArtifact | null> {
  const now = new Date().toISOString();
  const safeTimestamp = now.replace(/[:.]/g, "-");
  const fileName = `${checkpoint}_${safeTimestamp}.png`;
  const path = await import("path");
  const filePath = path.join(artifactDir, fileName);

  const result = await driver.captureScreenshot(filePath);
  if (!result.success) {
    return null;
  }

  return {
    type: "screenshot",
    checkpoint,
    capturedAt: now,
    filePath,
    fileName,
    note: note ?? `Screenshot at checkpoint: ${checkpoint}`,
  };
}

/**
 * Build a field evidence artifact from a step result and its instruction.
 */
function buildFieldEvidence(
  stepResult: PortalProbeStepResult,
  instr: BrowserAutomationInstruction
): PortalProbeArtifact | null {
  if (stepResult.status !== "executed") return null;
  if (!instr.target?.fieldKey) return null;

  const evidence: PortalProbeFieldEvidence = {
    fieldKey: instr.target.fieldKey,
    portalLabel: instr.target.portalLabel,
    rawObservedValue: stepResult.rawObservedValue,
    normalizedValue: stepResult.observedValue,
    selectorMethod: stepResult.selectorMethod,
    readbackConfidence: stepResult.readbackConfidence,
    readbackNote: stepResult.readbackNote,
  };

  return {
    type: "field_evidence",
    checkpoint: `field_${instr.target.fieldKey}`,
    capturedAt: new Date().toISOString(),
    fieldEvidence: evidence,
    note: `Field evidence for ${instr.target.portalLabel ?? instr.target.fieldKey}`,
  };
}

/**
 * Execute an instruction via the Playwright driver.
 */
async function executeInstruction(
  driver: PlaywrightStsdsDriver,
  instr: BrowserAutomationInstruction
): Promise<BrowserDriverOperationResult> {
  switch (instr.type) {
    case "navigate_to_page":
      return driver.navigateToPage(instr.target ?? {});

    case "open_application_flow":
      return driver.openApplicationFlow(instr.target ?? {});

    case "select_lane":
      return driver.selectLane(
        instr.target ?? {},
        instr.payload ?? { value: null, source: "none" }
      );

    case "fill_field":
      return driver.fillField(
        instr.target ?? {},
        instr.payload ?? { value: null, source: "none" }
      );

    case "select_dropdown_option":
      return driver.selectDropdownOption(
        instr.target ?? {},
        instr.payload ?? { value: null, source: "none" }
      );

    case "wait_for_read_only_value":
      return driver.waitForReadOnlyValue(
        instr.target ?? {},
        instr.expectations
      );

    case "assert_read_only_value":
      return driver.assertReadOnlyValue(
        instr.target ?? {},
        instr.payload ?? { value: null, source: "none" },
        instr.expectations
      );

    case "save_current_section":
      return driver.saveCurrentSection(instr.target ?? {});

    case "continue_to_tab":
      return driver.continueToTab(instr.target ?? {});

    case "stop_for_review":
      return driver.stopForReview();

    default:
      return {
        success: false,
        failureReason: `Unknown instruction type: ${instr.type}`,
      };
  }
}

/**
 * Build a real observed portal-state snapshot from the step results.
 */
function buildObservedSnapshot(
  lane: PortalLane,
  stepResults: PortalProbeStepResult[],
  instructions: BrowserAutomationInstruction[]
): PortalStateSnapshot {
  const now = new Date().toISOString();
  const allFields: PortalStateFieldValue[] = [];

  for (const result of stepResults) {
    if (result.status !== "executed") continue;
    if (result.observedValue === undefined) continue;

    // Find the corresponding instruction to get the field key
    const instr = instructions.find((i) => i.seq === result.seq);
    if (!instr?.target?.fieldKey) continue;

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

  // Also add the lane selection as an observed field
  const laneStep = stepResults.find(
    (r) => r.type === "select_lane" && r.status === "executed"
  );
  if (laneStep) {
    allFields.push({
      fieldKey: PORTAL_FIELD_KEYS.PORTAL_LANE_SELECTION,
      observedValue: laneStep.observedValue ?? lane,
      tab: "dashboard",
    });
  }

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

/**
 * Run the Maklumat Am portal probe for a stamping job.
 *
 * This is the main entry point for the local/dev probe.
 * It launches a real browser, runs through the Maklumat Am instructions,
 * captures observed values, and evaluates assertions.
 *
 * STOPS before save/submit — never creates a portal record.
 *
 * @param job - The stamping job with compiled browser instructions
 * @returns The probe result including observed snapshot and assertions
 */
export async function runStsdsMaklumatAmProbe(
  job: StampingJob
): Promise<PortalProbeResult> {
  const now = new Date().toISOString();

  // Validate prerequisites
  if (!job.browserInstructions) {
    return {
      status: "not_ready",
      lane: job.routingSuggestion?.suggestedLane ?? "sewa_pajakan",
      probedAt: now,
      stepResults: [],
      observedSnapshot: null,
      assertionEvaluationStatus: null,
      executedCount: 0,
      refusedCount: 0,
      failedCount: 0,
      notes: ["Browser instructions must be compiled before running the portal probe."],
    };
  }

  if (!job.routingSuggestion) {
    return {
      status: "not_ready",
      lane: "sewa_pajakan",
      probedAt: now,
      stepResults: [],
      observedSnapshot: null,
      assertionEvaluationStatus: null,
      executedCount: 0,
      refusedCount: 0,
      failedCount: 0,
      notes: ["Routing suggestion is required."],
    };
  }

  const lane = job.routingSuggestion.suggestedLane;
  const instructions = job.browserInstructions.instructions;
  const stepResults: PortalProbeStepResult[] = [];
  const notes: string[] = [];
  const artifacts: PortalProbeArtifact[] = [];
  let executedCount = 0;
  let refusedCount = 0;
  let failedCount = 0;
  let haltProbe = false;

  // Ensure artifact directory exists
  let artifactDir: string;
  try {
    artifactDir = await ensureArtifactDir(job.id);
  } catch {
    artifactDir = `${ARTIFACT_BASE_DIR}/${job.id}`;
    notes.push("Could not create artifact directory — screenshots will be skipped.");
  }

  // Launch browser session
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
      probedAt: now,
      stepResults: [],
      observedSnapshot: null,
      assertionEvaluationStatus: null,
      executedCount: 0,
      refusedCount: 0,
      failedCount: 0,
      notes: [
        `Failed to launch browser session: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  const driver = new PlaywrightStsdsDriver(page);

  try {
    // Checkpoint: after authenticated landing
    const landingScreenshot = await captureCheckpointScreenshot(
      driver,
      artifactDir,
      SCREENSHOT_CHECKPOINTS.AFTER_LANDING,
      "Portal state after authenticated landing / application-flow entry"
    );
    if (landingScreenshot) artifacts.push(landingScreenshot);

    for (const instr of instructions) {
      // If probe is halted, skip remaining
      if (haltProbe) {
        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "skipped",
          note: "Skipped — probe halted at a prior step",
        });
        continue;
      }

      // Safety boundary — refuse save/continue/submit
      if (PROBE_REFUSED_TYPES.has(instr.type)) {
        // Checkpoint: before safety stop
        const safetyScreenshot = await captureCheckpointScreenshot(
          driver,
          artifactDir,
          SCREENSHOT_CHECKPOINTS.BEFORE_SAFETY_STOP,
          "Portal state before safety stop boundary"
        );
        if (safetyScreenshot) artifacts.push(safetyScreenshot);

        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "refused",
          note: `SAFETY STOP: ${instr.type} is not permitted in the Maklumat Am probe.`,
        });
        refusedCount++;
        haltProbe = true;
        notes.push(
          `Probe stopped at instruction ${instr.seq} (${instr.type}) — safety boundary.`
        );
        continue;
      }

      // Advisory / stop_for_review — skip with note
      if (instr.isAdvisory || instr.type === "stop_for_review") {
        // Checkpoint: before safety stop (stop_for_review is also a safe stop)
        const reviewScreenshot = await captureCheckpointScreenshot(
          driver,
          artifactDir,
          SCREENSHOT_CHECKPOINTS.BEFORE_SAFETY_STOP,
          "Portal state at stop-for-review checkpoint"
        );
        if (reviewScreenshot) artifacts.push(reviewScreenshot);

        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "skipped",
          note: "Advisory step — probe paused for review",
        });
        haltProbe = true;
        continue;
      }

      // Check if instruction type is allowed
      if (!PROBE_ALLOWED_TYPES.has(instr.type)) {
        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "refused",
          note: `Instruction type "${instr.type}" is not supported in the Maklumat Am probe.`,
        });
        refusedCount++;
        continue;
      }

      // Check preconditions (compiler-resolved)
      if (instr.blocked) {
        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "blocked",
          note: instr.blockReason ?? "Instruction blocked by compiler",
        });
        haltProbe = true;
        continue;
      }

      const unmet = instr.preconditions.filter((p) => !p.met);
      if (unmet.length > 0) {
        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "blocked",
          note: unmet[0].reason ?? unmet[0].description,
        });
        haltProbe = true;
        continue;
      }

      // Execute the instruction via the real Playwright driver
      const result = await executeInstruction(driver, instr);

      if (result.success) {
        const stepRes: PortalProbeStepResult = {
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "executed",
          observedValue: result.observedValue,
          selectorMethod: result.selectorMethod,
          readbackConfidence: result.readbackConfidence,
          readbackNote: result.readbackNote,
          rawObservedValue: result.rawObservedValue,
        };
        stepResults.push(stepRes);
        executedCount++;

        // ── Milestone boundary: halt after select_lane ──────────────
        // The current approved milestone ends at lane selection +
        // field inventory capture. Do not continue into fill_field
        // or any later steps.
        if (instr.type === "select_lane") {
          haltProbe = true;
          notes.push(
            `Probe halted after select_lane (lane selection boundary). ` +
            `Outcome: ${result.readbackNote?.substring(0, 300) ?? "success"}`
          );
          continue;
        }

        // Checkpoint screenshots after key steps
        if (
          instr.type === "select_dropdown_option" &&
          instr.target?.fieldKey === PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME
        ) {
          const docScreenshot = await captureCheckpointScreenshot(
            driver,
            artifactDir,
            SCREENSHOT_CHECKPOINTS.AFTER_DOCUMENT_SELECTION,
            "Portal state after document name selection (penyeteman_am)"
          );
          if (docScreenshot) artifacts.push(docScreenshot);
        }

        if (
          instr.type === "wait_for_read_only_value" &&
          instr.target?.fieldKey === PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP
        ) {
          const derivedScreenshot = await captureCheckpointScreenshot(
            driver,
            artifactDir,
            SCREENSHOT_CHECKPOINTS.AFTER_DERIVED_GROUP_VISIBLE,
            "Portal state after derived document group became visible"
          );
          if (derivedScreenshot) artifacts.push(derivedScreenshot);
        }

        // Collect field evidence for executed steps with field keys
        const fieldArtifact = buildFieldEvidence(stepRes, instr);
        if (fieldArtifact) artifacts.push(fieldArtifact);
      } else {
        stepResults.push({
          seq: instr.seq,
          type: instr.type,
          description: instr.description,
          status: "failed",
          observedValue: result.observedValue,
          note: result.failureReason,
          selectorMethod: result.selectorMethod,
          readbackConfidence: result.readbackConfidence,
          readbackNote: result.readbackNote,
          rawObservedValue: result.rawObservedValue,
        });
        failedCount++;
        haltProbe = true;
        notes.push(
          `Probe failed at instruction ${instr.seq}: ${result.failureReason}`
        );
      }
    }
    // Only mark session as non-failed if no instruction failures and
    // no halt — i.e., the probe ran its course without fatal issues.
    if (failedCount === 0 && !haltProbe) {
      browserSessionFailed = false;
    }
  } finally {
    // Always clean up the browser session.
    // When browserSessionFailed is true (logical probe failure, not just
    // thrown exception), the headed browser stays open for local/dev
    // inspection before closing.
    if (cleanup) {
      await cleanup(browserSessionFailed).catch(() => {});
    }
  }

  // Build the observed snapshot
  const observedSnapshot = buildObservedSnapshot(lane, stepResults, instructions);

  // Evaluate assertions against the observed snapshot
  const assertionResult = evaluatePortalAssertions(job, observedSnapshot);
  const assertionEvaluationStatus = assertionResult?.status ?? null;

  // Build artifact collection
  const screenshotCount = artifacts.filter((a) => a.type === "screenshot").length;
  const fieldEvidenceCount = artifacts.filter((a) => a.type === "field_evidence").length;
  const artifactCollection: PortalProbeArtifactCollection = {
    artifacts,
    artifactDir,
    screenshotCount,
    fieldEvidenceCount,
    collectedAt: new Date().toISOString(),
  };

  // Resolve overall probe status
  let status: PortalProbeStatus;
  if (failedCount > 0) {
    status = "failed";
  } else if (stepResults.some((r) => r.status === "blocked")) {
    status = "blocked";
  } else {
    status = "completed";
  }

  if (refusedCount > 0) {
    notes.push(
      `${refusedCount} instruction(s) were refused by the safety boundary (save/continue not permitted).`
    );
  }

  // Truthful reporting for bootstrap-related failures
  if (status === "failed" && failedCount > 0) {
    const bootstrapStep = stepResults.find(
      (r) => r.type === "navigate_to_page" && r.status === "failed"
    );
    if (bootstrapStep) {
      notes.push(
        "MyTax to e-Duti Setem handoff was not completed. " +
        "Probe stopped before reaching the authenticated portal."
      );
    }
    const openAppStep = stepResults.find(
      (r) => r.type === "open_application_flow" && r.status === "failed"
    );
    if (openAppStep) {
      notes.push(
        "Could not open application flow — bootstrap did not reach the correct portal dashboard."
      );
    }
    if (browserSessionFailed) {
      notes.push(
        "Headed browser kept open for local inspection (120s delay before close)."
      );
    }
  }

  return {
    status,
    lane,
    probedAt: now,
    stepResults,
    observedSnapshot,
    assertionEvaluationStatus,
    executedCount,
    refusedCount,
    failedCount,
    notes,
    artifactCollection,
  };
}
