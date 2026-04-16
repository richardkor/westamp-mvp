/**
 * WeStamp — STSDS Bahagian A First Single-Field Fill Attempt
 *
 * Executes the first real local/dev-only guarded Bahagian A single-field
 * fill attempt. Fills exactly ONE grounded editable field, captures
 * immediate post-fill evidence and readback, then stops.
 *
 * SAFETY:
 * - Fills exactly ONE field — not two, not all
 * - Requires active Bahagian A fill authorization
 * - Requires eligible Bahagian A fill preflight
 * - Captures post-fill screenshot and readback
 * - Stops immediately after single-field outcome
 * - No further fields are filled
 * - No further tabs are clicked
 * - No upload, payment, certificate, or submission
 */

import { StampingJob } from "./stamping-types";
import {
  PortalBahagianAFillAttempt,
  PortalBahagianAFillAttemptStatus,
  PortalBahagianAFillAttemptEvidence,
  PortalBahagianAFillAttemptOutcome,
  PortalBahagianAFillTarget,
  PortalLane,
  PortalTabKey,
  PortalObservedField,
  PortalSchemaGroundingEntry,
} from "./stsds-types";
import {
  PlaywrightStsdsDriver,
  launchAuthenticatedSession,
} from "./stsds-playwright-driver";
import { evaluateBahagianAFillAuthorization } from "./stsds-bahagian-a-fill-authorization";

/** Local artifact directory convention (shared with probe/save/next-tab/grounding). */
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

// ─── Fill Target Selection ────────────────────────────────────────

/**
 * Select the first suitable grounded editable field from the Bahagian A
 * entry-state for the single-field fill attempt.
 *
 * Selection criteria:
 * - Must be grounded (matched in schema grounding)
 * - Must be observed as editable
 * - Must have a type hint of text_input (safest for first fill)
 * - Prefers fields that are currently empty (no existing value)
 *
 * Returns null if no suitable field is found.
 */
export function selectBahagianAFirstFillTarget(
  job: StampingJob
): PortalBahagianAFillTarget | null {
  if (!job.bahagianAEntryState) return null;

  const { observedFields, groundingEntries } = job.bahagianAEntryState;

  // Find all grounded editable text_input fields
  const candidates: {
    observed: PortalObservedField;
    grounding: PortalSchemaGroundingEntry;
  }[] = [];

  for (const entry of groundingEntries) {
    if (entry.match !== "matched") continue;
    if (!entry.observedField) continue;
    if (entry.observedField.mode !== "editable") continue;
    if (entry.observedField.typeHint !== "text_input") continue;

    candidates.push({
      observed: entry.observedField,
      grounding: entry,
    });
  }

  if (candidates.length === 0) return null;

  // Prefer fields that are currently empty
  const emptyFirst = candidates.sort((a, b) => {
    const aEmpty = !a.observed.currentValue || a.observed.currentValue.trim() === "";
    const bEmpty = !b.observed.currentValue || b.observed.currentValue.trim() === "";
    if (aEmpty && !bEmpty) return -1;
    if (!aEmpty && bEmpty) return 1;
    return a.observed.index - b.observed.index;
  });

  const selected = emptyFirst[0];

  // Determine a test value for the fill
  // Use a safe, recognizable test marker
  const intendedValue = "WeStamp-Test-Fill";

  return {
    observedFieldIndex: selected.observed.index,
    labelText: selected.observed.labelText,
    schemaFieldKey: selected.grounding.schemaFieldKey,
    schemaFieldLabel: selected.grounding.schemaFieldLabel,
    intendedValue,
    valueSource: "test_marker",
    selectionReason:
      `First grounded editable text_input field: "${selected.observed.labelText}" ` +
      `(schema: "${selected.grounding.schemaFieldLabel ?? "unknown"}"). ` +
      ((!selected.observed.currentValue || selected.observed.currentValue.trim() === "")
        ? "Field is currently empty."
        : `Field has existing value: "${selected.observed.currentValue}".`),
  };
}

// ─── Precondition Validation ──────────────────────────────────────

/**
 * Validate all preconditions before attempting the Bahagian A fill.
 * Returns a block reason string if blocked, or null if clear to proceed.
 */
function validatePreconditions(job: StampingJob): string | null {
  // Require routing suggestion
  if (!job.routingSuggestion) {
    return "No routing suggestion exists.";
  }

  // Require Bahagian A entry-state
  if (!job.bahagianAEntryState) {
    return "No Bahagian A entry-state exists.";
  }
  if (!job.bahagianAEntryState.tabObserved) {
    return "Bahagian A tab was not observed in entry-state.";
  }

  // Require eligible fill preflight
  if (!job.bahagianAFillPreflight) {
    return "Bahagian A fill preflight has not been evaluated.";
  }
  if (job.bahagianAFillPreflight.status !== "eligible_for_later_fill_attempt") {
    return `Bahagian A fill preflight status is "${job.bahagianAFillPreflight.status}" — must be "eligible_for_later_fill_attempt".`;
  }

  // Require fill guard not refused
  if (job.bahagianAFillPreflight.guard.decision === "refused") {
    return `Fill guard refuses: ${job.bahagianAFillPreflight.guard.explanation}`;
  }

  // Require active non-stale fill authorization
  if (!job.bahagianAFillAuthorization) {
    return "No Bahagian A fill authorization exists.";
  }

  // Re-evaluate authorization freshness
  const freshAuth = evaluateBahagianAFillAuthorization(job);
  if (freshAuth.status !== "active") {
    return `Bahagian A fill authorization is "${freshAuth.status}": ${freshAuth.explanation}`;
  }

  // Require completed next-tab attempt into Bahagian A
  if (!job.nextTabAttempt) {
    return "No next-tab attempt exists.";
  }
  if (job.nextTabAttempt.status !== "completed_with_stop") {
    return `Next-tab attempt status is "${job.nextTabAttempt.status}" — must be "completed_with_stop".`;
  }
  if (job.nextTabAttempt.toTabKey !== "bahagian_a") {
    return `Next-tab attempt target was "${job.nextTabAttempt.toTabKey}" — expected "bahagian_a".`;
  }

  return null;
}

// ─── Main Entry Point ─────────────────────────────────────────────

/**
 * Run the first Bahagian A single-field fill attempt.
 *
 * This is the main entry point for the local/dev fill attempt.
 *
 * It:
 * 1. Validates all authorization and preflight preconditions
 * 2. Selects a fill target from the grounded entry-state
 * 3. Launches a browser session
 * 4. Navigates to the portal, selects lane, progresses to Bahagian A
 * 5. Fills exactly ONE field
 * 6. Captures post-fill evidence (screenshot, readback)
 * 7. Stops immediately — no further fields, no further tabs
 */
export async function runBahagianAFirstFieldFillAttempt(
  job: StampingJob
): Promise<PortalBahagianAFillAttempt> {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";
  const tabLabel = "Bahagian A";

  // ── Validate preconditions ──────────────────────────────────────
  const blockReason = validatePreconditions(job);
  if (blockReason) {
    return {
      status: "blocked",
      lane,
      attemptedAt: now,
      authorizationWasActive:
        job.bahagianAFillAuthorization?.status === "active",
      preflightWasEligible:
        job.bahagianAFillPreflight?.status === "eligible_for_later_fill_attempt",
      blockReason,
      notes: [`Bahagian A fill attempt blocked: ${blockReason}`],
    };
  }

  // ── Select fill target ──────────────────────────────────────────
  const target = selectBahagianAFirstFillTarget(job);
  if (!target) {
    return {
      status: "blocked",
      lane,
      attemptedAt: now,
      authorizationWasActive: true,
      preflightWasEligible: true,
      blockReason:
        "No suitable grounded editable text_input field found in Bahagian A entry-state for fill attempt.",
      notes: [
        "Fill target selection found no candidates. " +
        "All grounded fields may be read-only, non-text, or not matched in schema.",
      ],
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
      target,
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
        target,
        artifactDir,
        blockReason: navResult.failureReason,
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
        target,
        artifactDir,
        blockReason: openResult.failureReason,
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
        target,
        artifactDir,
        blockReason: laneResult.failureReason,
        notes: [`Lane selection failed: ${laneResult.failureReason}`],
      };
    }

    // ── Progress to Bahagian A ──────────────────────────────────
    notes.push("Progressing to Bahagian A...");
    const progressResult = await driver.performNextTabProgression(tabLabel);

    if (!progressResult.success) {
      return {
        status: "failed",
        lane,
        attemptedAt: now,
        authorizationWasActive: true,
        preflightWasEligible: true,
        target,
        artifactDir,
        blockReason: `Tab progression failed: ${progressResult.failureReason}`,
        notes: [
          `Bahagian A progression failed: ${progressResult.failureReason}`,
        ],
      };
    }

    notes.push("Bahagian A tab reached. Proceeding to single-field fill...");

    // ── Fill exactly ONE field ───────────────────────────────────
    notes.push(
      `Filling field: "${target.labelText}" with value: "${target.intendedValue}"`
    );

    const fillResult = await driver.fillField(
      {
        fieldKey: target.schemaFieldKey ?? "unknown",
        tabKey: "bahagian_a" as PortalTabKey,
        portalLabel: target.labelText,
        selectorHint: {
          labelText: target.labelText,
          inputType: "text",
          interactionType: "type",
        },
      },
      {
        value: target.intendedValue,
        source: "none",
      }
    );

    // ── Post-fill screenshot ────────────────────────────────────
    const postFillTs = new Date().toISOString().replace(/[:.]/g, "-");
    const postFillFileName = `bahagian_a_fill_attempt_${postFillTs}.png`;
    const postFillPath = `${artifactDir}/${postFillFileName}`;
    await driver.captureScreenshot(postFillPath);

    // ── Readback: re-observe fields to capture post-fill state ──
    let readbackValue: string | null = null;
    let readbackMatch = false;

    try {
      const postFillObservation = await driver.observeTabFields();
      if (postFillObservation.success && postFillObservation.fields.length > 0) {
        // Find the same field by label match
        const matchingField = postFillObservation.fields.find(
          (f) => f.labelText === target.labelText
        );
        if (matchingField) {
          readbackValue = matchingField.currentValue ?? null;
          readbackMatch = readbackValue === target.intendedValue;
          notes.push(
            `Readback for "${target.labelText}": "${readbackValue}" — ` +
            (readbackMatch ? "MATCH" : "MISMATCH")
          );
        } else {
          notes.push(
            `Readback: could not find field "${target.labelText}" in post-fill observation.`
          );
        }
      } else {
        notes.push("Readback: post-fill field observation returned no fields.");
      }
    } catch (readbackErr) {
      notes.push(
        `Readback failed: ${readbackErr instanceof Error ? readbackErr.message : String(readbackErr)}`
      );
    }

    // ── Determine outcome ───────────────────────────────────────
    let outcome: PortalBahagianAFillAttemptOutcome;
    if (!fillResult.success) {
      if (fillResult.failureReason?.includes("Could not locate")) {
        outcome = "field_not_found";
      } else {
        outcome = "field_fill_failed";
      }
    } else if (readbackValue !== null && !readbackMatch) {
      outcome = "readback_mismatch";
    } else {
      outcome = "field_filled_successfully";
    }

    // ── Build evidence ──────────────────────────────────────────
    const evidence: PortalBahagianAFillAttemptEvidence = {
      screenshotFilePath: postFillPath,
      screenshotFileName: postFillFileName,
      readbackValue,
      readbackMatch,
      selectorMethod: fillResult.selectorMethod,
      outcome,
      notes: [
        ...notes,
        fillResult.success
          ? `Field "${target.labelText}" filled successfully via ${fillResult.selectorMethod ?? "unknown"}.`
          : `Field fill failed: ${fillResult.failureReason}`,
      ],
    };

    // ── HARD STOP — no further fields, no further tabs ──────────
    notes.push(
      "STOP: Automation stopped after single-field fill outcome observation. " +
      "No further Bahagian A fields were filled. No further tabs were clicked."
    );

    const status: PortalBahagianAFillAttemptStatus = fillResult.success
      ? "completed_with_stop"
      : "failed";

    // Only clear failure flag if the fill actually succeeded
    if (fillResult.success) {
      browserSessionFailed = false;
    }

    return {
      status,
      lane,
      attemptedAt: now,
      authorizationWasActive: true,
      preflightWasEligible: true,
      target,
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
