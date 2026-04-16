/**
 * WeStamp — Portal Lane Knowledge Profile
 *
 * Central source of truth for what WeStamp knows about each portal
 * lane's behavior, based on live exploration evidence.
 *
 * All internal layers (readiness, execution preview, automation plan)
 * should derive lane-specific decisions from this profile rather than
 * hardcoding scattered assumptions.
 *
 * DISCIPLINE: Only encode knowledge that has been independently proven
 * via live portal exploration. Use "unknown" where proof is missing.
 */

import { PortalLane } from "./stsds-types";

export type ProvenState = "proven" | "unknown";

export interface PortalLaneKnowledgeProfile {
  lane: PortalLane;

  /** Whether the lane's automation path has been independently proven. */
  laneAutomationProven: boolean;

  /** Whether the Hantar declaration gate is proven for this lane. */
  declarationGateProven: ProvenState;

  /** Whether the Hantar Bahagian A completeness gate is proven. */
  bahagianAGateProven: ProvenState;

  /** Whether Bahagian B is proven accessible with empty Bahagian A. */
  bahagianBAccessibleWithEmptyA: ProvenState;

  /** Whether Bahagian B save is proven permissive with empty Bahagian A. */
  bahagianBSavePermissive: ProvenState;

  /** Whether Rumusan Pengiraan is proven accessible with empty Bahagian A. */
  rumusanAccessible: ProvenState;

  /** Whether Lampiran tab is proven accessible. */
  lampiranAccessible: ProvenState;

  /** Whether Perakuan tab is proven accessible. */
  perakuanAccessible: ProvenState;

  /** Whether party-entry automation is frozen by identity/TIN dependency. */
  partyEntryFrozen: boolean;

  /** Whether live portal execution is enabled. */
  liveExecutionEnabled: boolean;

  /** Provenance notes. */
  notes: string[];
}

/**
 * Returns the knowledge profile for a given lane.
 *
 * penyeteman_am: extensively proven from live p8 exploration.
 * sewa_pajakan: not yet independently proven.
 */
export function getLaneKnowledgeProfile(
  lane: PortalLane
): PortalLaneKnowledgeProfile {
  if (lane === "penyeteman_am") {
    return {
      lane: "penyeteman_am",
      laneAutomationProven: true,
      declarationGateProven: "proven",
      bahagianAGateProven: "proven",
      bahagianBAccessibleWithEmptyA: "proven",
      bahagianBSavePermissive: "proven",
      rumusanAccessible: "proven",
      lampiranAccessible: "proven",
      perakuanAccessible: "proven",
      partyEntryFrozen: true,
      liveExecutionEnabled: false,
      notes: [
        "Hantar gates proven from live penyeteman_am (p8) exploration.",
        "Bahagian B accessible and saveable with empty Bahagian A (proven).",
        "Rumusan Pengiraan accessible and auto-calculates (proven).",
        "Party entry depends on identity/TIN workflow (frozen).",
      ],
    };
  }

  // sewa_pajakan and any other lane: not yet independently proven
  return {
    lane,
    laneAutomationProven: false,
    declarationGateProven: "unknown",
    bahagianAGateProven: "unknown",
    bahagianBAccessibleWithEmptyA: "unknown",
    bahagianBSavePermissive: "unknown",
    rumusanAccessible: "unknown",
    lampiranAccessible: "unknown",
    perakuanAccessible: "unknown",
    partyEntryFrozen: true,
    liveExecutionEnabled: false,
    notes: [
      `Hantar gates not yet independently proven for ${lane}.`,
      "No real readiness judgment is possible until live exploration confirms the gates for this lane.",
    ],
  };
}
