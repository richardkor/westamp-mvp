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
        "Hantar (id=pre_hantar) gate 1: bootbox modal 'Gagal — Sila pilih Nama Surat Cara' (pds_suratcara required).",
        "Pre-resolution :invalid set at gate 1 (16): pds_suratcara, pds_jenis, pds_alamat_1, pds_poskod, pds_city, pds_harta_state, pds_harta_type, pds_floor, pds_mp, pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim, pds_daerah, pds_luas, par_id.",
        "Gate-chain walk (2026-04-22, Phase 7b): pds_suratcara=1101 (Perjanjian Sewa) accepted. Cascade: pds_jenis options are static (7 options present pre- and post-select, no auto-population); :invalid count 16→15 with only pds_suratcara removed.",
        "Hantar gate 2 proven: bootbox modal 'Gagal — Sila masukkan Alamat Harta di Bahagian C terlebih dahulu' (pds_alamat_1 required on Bahagian C). URL unchanged, no dialog, no submission.",
        "Post-resolution :invalid set at gate 2 (15): pds_jenis, pds_alamat_1, pds_poskod, pds_city, pds_harta_state, pds_harta_type, pds_floor, pds_mp, pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim, pds_daerah, pds_luas, par_id. Gate ordering between these 15 fields beyond pds_alamat_1 not yet enumerated.",
        "Harta detail fields (alamat_1, poskod, city, harta_state, harta_type, floor, mp, harta_cat, harta_perabot, lot, mukim, daerah, luas) live on Bahagian C per the gate 2 modal text — not Bahagian B as earlier advisory text assumed.",
        "A tab-scoped 'Simpan Maklumat Am' button surfaces once the Maklumat Am tab is active (observed post-pds_suratcara). The page-level 'Simpan' and 'Hantar' remain always present.",
        "Lampiran tab renders with 0 file inputs on default view — upload requirement conditions not yet determined.",
        "Perakuan tab has pds_akuan checkbox (HTML required=false); its role as a Hantar gate not yet proven because Hantar still blocks earlier on pds_alamat_1.",
        "Hantar validation surfaces as a bootbox modal (not a native confirm) — dismiss-guard remains a secondary safety net.",
        "Party entry depends on identity/TIN workflow (still frozen).",
        // ─── Browser reliability — role/firm selection (passive HAR research) ───
        // The notes below capture design facts confirmed by a passive
        // HAR research capture. Treated as DESIGN evidence only — the
        // raw HAR is NOT stored in this repo. No raw firm IDs,
        // cookies, tokens, SSO values, or sensitive URLs are recorded
        // here.
        "Role/firm selection on /stamps/main/role_change is anchor-href navigation, not a form POST. The intended firm anchor's href contains '/stamps/main/role_change/' and clicking it redirects to '/stamps/utama/dashboard'. WeStamp's driver collects candidate anchors with that href fragment and matches them against the configured target firm (and optional branch) by normalized exact equality on visible text and URL path segments. Selection is never by index. Zero, no-exact, or multiple plausible matches all fail closed. See `src/lib/stsds-firm-anchor-matcher.ts`.",
        "lhdnmsstoken appears only after the dashboard loads and is embedded in the dashboard HTML; it is used by later AJAX requests. WeStamp must NOT log, store, persist, or treat it as an API credential — the helper layer never reads it.",
        "p5 draft creation uses pds_id=0 in simpan_dutisetem; the server then allocates a 13-digit portal draft ID visible in the edit URL. This is portal draft creation only, NOT LHDN submission.",
        "Passive observation: YA confirmation appears to be represented by GET query parameters on /stamps/formv2/p5 rather than a separate YA POST. Recorded for future verification; no automation built around it.",
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
