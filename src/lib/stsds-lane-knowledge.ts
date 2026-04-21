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

  if (lane === "sewa_pajakan") {
    return {
      lane: "sewa_pajakan",
      // Gate structure proven via the Apr-22 live discovery probe.
      // End-to-end Hantar submission is NOT proven (the probe stopped
      // at the pre_hantar modal); but MA→P5 advance, the seven P5
      // tabs' accessibility, and the Hantar first-error gate are all
      // observed directly.
      laneAutomationProven: true,
      // Hantar was blocked by pds_suratcara before Perakuan could be
      // tested — declaration enforcement unobserved.
      declarationGateProven: "unknown",
      // par_id appears in the Hantar :invalid set — Bahagian A is
      // required for submission.
      bahagianAGateProven: "proven",
      // Bahagian B tab clicked successfully while Bahagian A was
      // empty; panel rendered.
      bahagianBAccessibleWithEmptyA: "proven",
      // Save of Bahagian B was not attempted in this probe.
      bahagianBSavePermissive: "unknown",
      // Rumusan Pengiraan tab clicked successfully; panel rendered.
      rumusanAccessible: "proven",
      // Lampiran tab clicked successfully; panel rendered (0 file
      // inputs surfaced on default view — upload conditions unknown).
      lampiranAccessible: "proven",
      // Perakuan tab clicked successfully; pds_akuan checkbox visible.
      perakuanAccessible: "proven",
      // Identity/TIN workflow unchanged from penyeteman_am.
      partyEntryFrozen: true,
      liveExecutionEnabled: false,
      notes: [
        "Hantar gate structure proven via live sewa_pajakan discovery (2026-04-22).",
        "MA → P5 advance proven: Sewa/Pajakan lane + Pejabat Setem + Tarikh Surat Cara (YYYY-MM-DD input) + Seterusnya.",
        "P5 exposes 7 tabs: Maklumat Am, Bahagian A, Bahagian B, Bahagian C, Rumusan Pengiraan, Lampiran, Perakuan — all accessible.",
        "Hantar (id=pre_hantar) first-error gate: bootbox modal 'Gagal — Sila pilih Nama Surat Cara' (pds_suratcara required).",
        "Hantar invalid-field set at first gate: pds_suratcara, pds_jenis, pds_alamat_1, pds_poskod, pds_city, pds_harta_state, pds_harta_type, pds_floor, pds_mp, pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim, pds_daerah, pds_luas, par_id. Gate chain beyond this first error not yet enumerated.",
        "Lampiran tab renders with 0 file inputs on default view — upload requirement conditions not yet determined.",
        "Perakuan tab has pds_akuan checkbox (HTML required=false); its role as a Hantar gate not yet proven because Hantar blocked earlier.",
        "Hantar validation surfaces as a bootbox modal (not a native confirm) — dismiss-guard remains a secondary safety net.",
        "Party entry depends on identity/TIN workflow (still frozen).",
      ],
    };
  }

  // any other lane: not yet independently proven
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
