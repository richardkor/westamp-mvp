/**
 * WeStamp — STSDS Mock Executor
 *
 * Deterministically simulates browser-instruction execution against
 * the compiled instruction set for a stamping job.
 *
 * The mock executor:
 * - Consumes the compiled BrowserAutomationInstructionSet
 * - Evaluates each instruction using precondition.met values resolved
 *   by the instruction compiler (from portal draft data)
 * - Produces a structured BrowserExecutionResult per instruction
 * - Halts at the first blocked instruction or advisory stop
 * - Marks all subsequent instructions as skipped
 *
 * Does NOT interact with the live e-Duti Setem portal.
 * Does NOT import Playwright/Puppeteer.
 * Does NOT advance job status.
 * Does NOT magically mark everything successful — results are derived
 * from existing precondition.met values in the compiled instructions.
 */

import { StampingJob } from "./stamping-types";
import {
  BrowserExecutionResult,
  BrowserExecutionStatus,
  BrowserExecutionInstructionResult,
  BrowserExecutionFailure,
  BrowserExecutionTrace,
} from "./stsds-types";

/**
 * Run a deterministic mock execution against the compiled instruction set.
 *
 * Returns null if there is no compiled instruction set on the job.
 *
 * @param job - The stamping job to execute
 * @returns A BrowserExecutionResult, or null if no instruction set exists
 */
export function runMockExecution(
  job: StampingJob
): BrowserExecutionResult | null {
  if (!job.browserInstructions) return null;
  if (!job.routingSuggestion) return null;

  const { instructions, lane, status: instrSetStatus, knownLaterSurfaces } = job.browserInstructions;
  const now = new Date().toISOString();

  // Short-circuit: instruction set not yet proven for this lane
  if (instrSetStatus === "not_yet_proven") {
    return {
      status: "not_yet_proven",
      lane,
      executedAt: now,
      instructionResults: [],
      trace: { totalInstructions: 0, executedCount: 0, blockedCount: 0, failedCount: 0, skippedCount: 0 },
      failures: [],
      blockedReasons: [],
      failedReasons: [],
      advisoryNotes: ["Mock execution not yet independently proven for this lane."],
      knownLaterSurfaces,
    };
  }

  const instructionResults: BrowserExecutionInstructionResult[] = [];
  const failures: BrowserExecutionFailure[] = [];
  const blockedReasons: string[] = [];
  const failedReasons: string[] = [];
  const advisoryNotes: string[] = [];

  let haltExecution = false;

  for (const instr of instructions) {
    // Advisory instructions (e.g. stop_for_review) — skipped with advisory note
    if (instr.isAdvisory) {
      instructionResults.push({
        seq: instr.seq,
        type: instr.type,
        description: instr.description,
        status: "skipped",
        note: "Advisory — execution halted for human review",
        isAdvisory: true,
      });
      advisoryNotes.push(instr.description);
      haltExecution = true;
      continue;
    }

    // After any halt, remaining instructions are skipped
    if (haltExecution) {
      instructionResults.push({
        seq: instr.seq,
        type: instr.type,
        description: instr.description,
        status: "skipped",
        note: "Skipped — execution halted at a prior step",
      });
      continue;
    }

    // Instruction marked blocked by the compiler
    if (instr.blocked) {
      const reason =
        instr.blockReason ?? `Instruction ${instr.seq} is blocked`;
      instructionResults.push({
        seq: instr.seq,
        type: instr.type,
        description: instr.description,
        status: "blocked",
        note: reason,
      });
      failures.push({ atSeq: instr.seq, reason });
      blockedReasons.push(reason);
      haltExecution = true;
      continue;
    }

    // Evaluate preconditions — all must be met
    const unmetPreconditions = instr.preconditions.filter((p) => !p.met);
    if (unmetPreconditions.length > 0) {
      const reason =
        unmetPreconditions[0].reason ??
        unmetPreconditions[0].description ??
        `Precondition not met for instruction ${instr.seq}`;
      instructionResults.push({
        seq: instr.seq,
        type: instr.type,
        description: instr.description,
        status: "blocked",
        note: reason,
      });
      failures.push({ atSeq: instr.seq, reason });
      blockedReasons.push(reason);
      haltExecution = true;
      continue;
    }

    // All preconditions met — mark as executed
    instructionResults.push({
      seq: instr.seq,
      type: instr.type,
      description: instr.description,
      status: "executed",
    });
  }

  // Aggregate trace
  const trace: BrowserExecutionTrace = {
    totalInstructions: instructionResults.length,
    executedCount: instructionResults.filter((r) => r.status === "executed").length,
    blockedCount: instructionResults.filter((r) => r.status === "blocked").length,
    failedCount: instructionResults.filter((r) => r.status === "failed").length,
    skippedCount: instructionResults.filter((r) => r.status === "skipped").length,
  };

  // Resolve overall status
  let status: BrowserExecutionStatus;
  const hasBlocked = trace.blockedCount > 0;
  const hasFailed = trace.failedCount > 0;
  const hasAdvisory = instructionResults.some((r) => r.isAdvisory);

  if (hasFailed) {
    status = "failed";
  } else if (hasBlocked) {
    status = "blocked";
  } else if (hasAdvisory || instrSetStatus === "review_required") {
    status = "review_required";
  } else if (instrSetStatus === "not_ready") {
    status = "not_ready";
  } else {
    status = "ready_for_internal_review";
  }

  return {
    status,
    lane,
    executedAt: now,
    instructionResults,
    trace,
    failures,
    blockedReasons,
    failedReasons,
    advisoryNotes,
    knownLaterSurfaces,
  };
}
