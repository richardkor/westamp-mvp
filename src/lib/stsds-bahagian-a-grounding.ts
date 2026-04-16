/**
 * WeStamp — STSDS Bahagian A Entry-State Capture + Schema Grounding
 *
 * Captures the real observed Bahagian A entry-state after the first
 * next-tab progression, then grounds observed fields against the
 * existing internal portal schema.
 *
 * SAFETY:
 * - Does NOT fill any Bahagian A field
 * - Does NOT continue beyond Bahagian A
 * - Does NOT click any further tabs or buttons (beyond observation)
 * - Stops after capture + grounding
 * - Requires the same local/dev environment gate as the portal probe
 */

import { StampingJob } from "./stamping-types";
import {
  PortalTabEntryState,
  PortalObservedField,
  PortalSchemaGroundingEntry,
  PortalSchemaGroundingMatch,
  PortalSchemaGroundingStatus,
  PortalSchemaGroundingSummary,
  PortalLane,
  PortalTabKey,
} from "./stsds-types";
import {
  PlaywrightStsdsDriver,
  launchAuthenticatedSession,
} from "./stsds-playwright-driver";
import { getPortalSchema } from "./stsds-portal-schema";
import { evaluateNextTabProgressionAuthorization } from "./stsds-next-tab-authorization";

/** Local artifact directory convention (shared with probe/save/next-tab). */
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
 * Validate that the job is in the correct state for Bahagian A observation.
 *
 * Because this helper performs a fresh live progression into Bahagian A,
 * it requires the same strict boundary as the next-tab attempt itself:
 * - active, non-stale next-tab authorization
 * - eligible next-tab preflight
 * - completed prior next-tab attempt into Bahagian A (evidence of viability)
 *
 * A historical completed next-tab attempt alone is NOT sufficient.
 *
 * Returns a block reason if not ready, or null if clear.
 */
function validatePreconditions(job: StampingJob): string | null {
  if (!job.routingSuggestion) {
    return "No routing suggestion exists.";
  }

  // Require active, non-stale next-tab authorization
  if (!job.nextTabAuthorization) {
    return "No next-tab authorization exists.";
  }
  const freshAuth = evaluateNextTabProgressionAuthorization(job);
  if (freshAuth.status !== "active") {
    return `Next-tab authorization is "${freshAuth.status}": ${freshAuth.explanation}`;
  }

  // Require eligible next-tab preflight
  if (!job.nextTabPreflight) {
    return "Next-tab preflight has not been evaluated.";
  }
  if (job.nextTabPreflight.status !== "eligible_for_later_attempt") {
    return `Next-tab preflight status is "${job.nextTabPreflight.status}" — must be "eligible_for_later_attempt".`;
  }

  // Require completed prior next-tab attempt into Bahagian A
  if (!job.nextTabAttempt) {
    return "No next-tab attempt has been performed.";
  }
  if (job.nextTabAttempt.status !== "completed_with_stop") {
    return `Next-tab attempt status is "${job.nextTabAttempt.status}" — must be "completed_with_stop".`;
  }
  if (job.nextTabAttempt.toTabKey !== "bahagian_a") {
    return `Next-tab attempt target was "${job.nextTabAttempt.toTabKey}" — expected "bahagian_a".`;
  }
  const outcome = job.nextTabAttempt.evidence?.outcome;
  if (outcome !== "tab_became_active" && outcome !== "tab_content_visible") {
    return `Next-tab attempt outcome was "${outcome ?? "unknown"}" — tab must have appeared active or content visible.`;
  }

  return null;
}

/**
 * Ground observed fields against the existing schema for this tab/lane.
 *
 * For each observed field, attempts to find a matching schema field
 * by comparing portal labels (case-insensitive, whitespace-normalized).
 * For each schema field expected on the tab, checks if it was observed.
 *
 * Does NOT fake certainty. Returns honest classifications.
 */
function groundFieldsAgainstSchema(
  observedFields: PortalObservedField[],
  lane: PortalLane,
  tabKey: PortalTabKey
): {
  entries: PortalSchemaGroundingEntry[];
  summary: PortalSchemaGroundingSummary;
  status: PortalSchemaGroundingStatus;
} {
  const schema = getPortalSchema(lane);
  const tabSchema = schema.find((s) => s.tabKey === tabKey);
  const schemaFields = tabSchema?.fields ?? [];

  const entries: PortalSchemaGroundingEntry[] = [];
  const matchedSchemaKeys = new Set<string>();
  const matchedObservedIndices = new Set<number>();

  // Normalize for comparison
  function normalize(s: string): string {
    return s.toLowerCase().replace(/[*:]/g, "").replace(/\s+/g, " ").trim();
  }

  // Pass 1: Try to match each observed field to a schema field
  for (const observed of observedFields) {
    const normalizedLabel = normalize(observed.labelText);
    let bestMatch: { key: string; label: string } | null = null;

    for (const sf of schemaFields) {
      if (matchedSchemaKeys.has(sf.fieldKey)) continue;
      const normalizedPortalLabel = normalize(sf.portalLabel);
      const normalizedInternalLabel = normalize(sf.label);

      if (
        normalizedLabel === normalizedPortalLabel ||
        normalizedLabel === normalizedInternalLabel ||
        normalizedPortalLabel.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedPortalLabel)
      ) {
        bestMatch = { key: sf.fieldKey, label: sf.label };
        break;
      }
    }

    if (bestMatch) {
      matchedSchemaKeys.add(bestMatch.key);
      matchedObservedIndices.add(observed.index);
      entries.push({
        observedField: observed,
        schemaFieldKey: bestMatch.key,
        schemaFieldLabel: bestMatch.label,
        match: "matched",
        note: `Observed label "${observed.labelText}" matches schema field "${bestMatch.label}".`,
      });
    } else {
      matchedObservedIndices.add(observed.index);
      entries.push({
        observedField: observed,
        match: "unmatched",
        note: `Observed label "${observed.labelText}" has no matching schema field.`,
      });
    }
  }

  // Pass 2: Schema fields expected but not observed
  for (const sf of schemaFields) {
    if (matchedSchemaKeys.has(sf.fieldKey)) continue;
    entries.push({
      schemaFieldKey: sf.fieldKey,
      schemaFieldLabel: sf.label,
      match: "expected_missing",
      note: `Schema field "${sf.label}" (portalLabel: "${sf.portalLabel}") was expected but not observed.`,
    });
  }

  // Compute summary
  const groundedCount = entries.filter((e) => e.match === "matched").length;
  const unmatchedObservedCount = entries.filter((e) => e.match === "unmatched").length;
  const expectedButNotObservedCount = entries.filter((e) => e.match === "expected_missing").length;
  const uncertainCount = entries.filter((e) => e.match === "uncertain").length;

  const qualityNotes: string[] = [];

  if (!tabSchema) {
    qualityNotes.push("No schema definition exists for this tab/lane — all fields are unmatched.");
  } else if (!tabSchema.isFullyMapped) {
    qualityNotes.push(
      "The schema for this tab is not yet fully mapped. " +
      "Unmatched fields are expected and do not indicate errors."
    );
  }

  if (schemaFields.length === 0) {
    qualityNotes.push(
      "The existing schema has zero fields for this tab. " +
      "All observed fields are currently unmatched. " +
      "This is the expected starting state before schema population."
    );
  }

  if (observedFields.length === 0) {
    qualityNotes.push("No fields were observed on this tab. The tab may still be loading or may be empty.");
  }

  if (groundedCount > 0 && unmatchedObservedCount === 0 && expectedButNotObservedCount === 0) {
    qualityNotes.push("All observed fields matched schema entries and all schema entries were observed.");
  }

  const summary: PortalSchemaGroundingSummary = {
    totalObservedFields: observedFields.length,
    groundedCount,
    unmatchedObservedCount,
    expectedButNotObservedCount,
    uncertainCount,
    qualityNotes,
  };

  // Determine status
  let status: PortalSchemaGroundingStatus;
  if (observedFields.length === 0) {
    status = "grounding_incomplete";
  } else if (groundedCount === 0) {
    status = "observed";
  } else if (unmatchedObservedCount > 0 || expectedButNotObservedCount > 0) {
    status = "partially_matched";
  } else {
    status = "ready_for_review";
  }

  return { entries, summary, status };
}

/**
 * Capture the Bahagian A entry-state and ground it against the schema.
 *
 * This is the main entry point. It:
 * 1. Validates preconditions (completed next-tab attempt into Bahagian A)
 * 2. Launches a browser, navigates, selects lane, progresses to Bahagian A
 * 3. Observes visible fields without filling anything
 * 4. Captures a screenshot
 * 5. Grounds observed fields against the existing schema
 * 6. Returns the full entry-state + grounding result
 * 7. Stops — no field filling, no further tabs
 */
export async function captureBahagianAEntryState(
  job: StampingJob
): Promise<PortalTabEntryState> {
  const now = new Date().toISOString();
  const lane: PortalLane =
    job.routingSuggestion?.suggestedLane ?? "sewa_pajakan";
  const tabKey: PortalTabKey = "bahagian_a";
  const tabLabel = "Bahagian A";

  // ── Validate preconditions ──────────────────────────────────────
  const blockReason = validatePreconditions(job);
  if (blockReason) {
    return {
      status: "not_observed",
      tabKey,
      tabLabel,
      lane,
      observedAt: now,
      tabObserved: false,
      observedFields: [],
      groundingEntries: [],
      summary: {
        totalObservedFields: 0,
        groundedCount: 0,
        unmatchedObservedCount: 0,
        expectedButNotObservedCount: 0,
        uncertainCount: 0,
        qualityNotes: [`Blocked: ${blockReason}`],
      },
      notes: [`Bahagian A observation blocked: ${blockReason}`],
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
      status: "not_observed",
      tabKey,
      tabLabel,
      lane,
      observedAt: now,
      tabObserved: false,
      observedFields: [],
      groundingEntries: [],
      summary: {
        totalObservedFields: 0,
        groundedCount: 0,
        unmatchedObservedCount: 0,
        expectedButNotObservedCount: 0,
        uncertainCount: 0,
        qualityNotes: ["Browser session launch failed."],
      },
      artifactDir,
      notes: [
        `Failed to launch browser session: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  const driver = new PlaywrightStsdsDriver(page);
  const notes: string[] = [];

  try {
    // ── Navigate to portal ──────────────────────────────────────
    const navResult = await driver.navigateToPage({});
    if (!navResult.success) {
      return {
        status: "not_observed",
        tabKey,
        tabLabel,
        lane,
        observedAt: now,
        tabObserved: false,
        observedFields: [],
        groundingEntries: [],
        summary: {
          totalObservedFields: 0,
          groundedCount: 0,
          unmatchedObservedCount: 0,
          expectedButNotObservedCount: 0,
          uncertainCount: 0,
          qualityNotes: [`Navigation failed: ${navResult.failureReason}`],
        },
        artifactDir,
        notes: [`Navigation failed: ${navResult.failureReason}`],
      };
    }

    // ── Open application flow ───────────────────────────────────
    const openResult = await driver.openApplicationFlow({});
    if (!openResult.success) {
      return {
        status: "not_observed",
        tabKey,
        tabLabel,
        lane,
        observedAt: now,
        tabObserved: false,
        observedFields: [],
        groundingEntries: [],
        summary: {
          totalObservedFields: 0,
          groundedCount: 0,
          unmatchedObservedCount: 0,
          expectedButNotObservedCount: 0,
          uncertainCount: 0,
          qualityNotes: [`Open application flow failed: ${openResult.failureReason}`],
        },
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
        status: "not_observed",
        tabKey,
        tabLabel,
        lane,
        observedAt: now,
        tabObserved: false,
        observedFields: [],
        groundingEntries: [],
        summary: {
          totalObservedFields: 0,
          groundedCount: 0,
          unmatchedObservedCount: 0,
          expectedButNotObservedCount: 0,
          uncertainCount: 0,
          qualityNotes: [`Lane selection failed: ${laneResult.failureReason}`],
        },
        artifactDir,
        notes: [`Lane selection failed: ${laneResult.failureReason}`],
      };
    }

    // ── Progress to Bahagian A ──────────────────────────────────
    notes.push("Progressing to Bahagian A...");
    const progressResult = await driver.performNextTabProgression(tabLabel);

    if (!progressResult.success) {
      return {
        status: "not_observed",
        tabKey,
        tabLabel,
        lane,
        observedAt: now,
        tabObserved: false,
        observedFields: [],
        groundingEntries: [],
        summary: {
          totalObservedFields: 0,
          groundedCount: 0,
          unmatchedObservedCount: 0,
          expectedButNotObservedCount: 0,
          uncertainCount: 0,
          qualityNotes: [`Tab progression failed: ${progressResult.failureReason}`],
        },
        artifactDir,
        notes: [
          `Bahagian A progression failed: ${progressResult.failureReason}`,
        ],
      };
    }

    const tabObserved = progressResult.targetTabAppearedActive ||
      !!progressResult.observedTabLabel;

    notes.push(
      tabObserved
        ? `Bahagian A tab observed — ${progressResult.observedMessage ?? "active"}`
        : "Bahagian A tab click performed but active state not confirmed."
    );

    // ── Observe fields ──────────────────────────────────────────
    notes.push("Observing Bahagian A fields (read-only scan)...");
    const observation = await driver.observeTabFields();

    if (!observation.success) {
      notes.push(`Field observation failed: ${observation.failureReason}`);
    }

    // Map to PortalObservedField
    const observedFields: PortalObservedField[] = observation.fields.map(
      (f, i) => ({
        index: i,
        labelText: f.labelText,
        mode: f.mode,
        typeHint: f.typeHint,
        visibility: "visible" as const,
        appearsRequired: f.appearsRequired,
        currentValue: f.currentValue,
        locatorNote: f.locatorNote,
        containerContext: f.containerContext,
      })
    );

    notes.push(`Observed ${observedFields.length} field candidates on Bahagian A.`);

    // ── Screenshot ──────────────────────────────────────────────
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotFileName = `bahagian_a_entry_state_${ts}.png`;
    const screenshotPath = `${artifactDir}/${screenshotFileName}`;
    await driver.captureScreenshot(screenshotPath);

    // ── Ground against schema ───────────────────────────────────
    const grounding = groundFieldsAgainstSchema(observedFields, lane, tabKey);

    notes.push(
      `Schema grounding: ${grounding.summary.groundedCount} matched, ` +
      `${grounding.summary.unmatchedObservedCount} unmatched observed, ` +
      `${grounding.summary.expectedButNotObservedCount} expected but not observed.`
    );

    // ── STOP — no field filling, no further tabs ────────────────
    notes.push(
      "STOP: Observation complete. No Bahagian A fields were filled."
    );

    // Grounding is observation-only — if we reached this point,
    // the session completed normally.
    browserSessionFailed = false;

    return {
      status: tabObserved ? grounding.status : "not_observed",
      tabKey,
      tabLabel,
      lane,
      observedAt: now,
      tabObserved,
      observedFields,
      groundingEntries: grounding.entries,
      summary: grounding.summary,
      screenshotFileName,
      artifactDir,
      notes,
    };
  } finally {
    if (cleanup) {
      await cleanup(browserSessionFailed).catch(() => {});
    }
  }
}
