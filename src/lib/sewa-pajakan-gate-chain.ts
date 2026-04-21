/**
 * WeStamp — Sewa/Pajakan Gate Chain View
 *
 * Pure, read-only helper that structures the proven Hantar gate chain
 * for the sewa_pajakan lane, based on live discovery evidence captured
 * 2026-04-22 (walked two gates deep on id=pre_hantar):
 *
 *   Gate 1 (proven)  : pds_suratcara   — "Sila pilih Nama Surat Cara"
 *                                         (Maklumat Am)
 *   Gate 2 (proven)  : pds_alamat_1    — "Sila masukkan Alamat Harta di
 *                                         Bahagian C terlebih dahulu"
 *                                         (Bahagian C)
 *
 * After gate 2 the :invalid set still contained 14 additional fields
 * (listed in `laterInvalidFields`) whose gate ordering was NOT
 * enumerated — the probe stopped without resolving them. They are
 * therefore `unresolved` — known to be required by HTML constraint
 * validation, but not proven to be the next Hantar gate in any
 * particular order.
 *
 * Advisory-only. Produces no side effects and does not touch the live
 * portal. Returns null for non-sewa_pajakan lanes.
 */

import type { PortalLane } from "./stsds-types";

export interface ProvenGate {
  /** 1-indexed position in the walked gate chain. */
  index: number;
  /** HTML field name that the modal pointed at. */
  field: string;
  /** Portal section where the field lives. */
  section: string;
  /** Short human label for the field. */
  fieldLabel: string;
  /** Exact bootbox modal text observed at this gate. */
  modalMessage: string;
}

export interface CurrentBlockingStep {
  /** Section the operator needs to act in. */
  section: string;
  /** Field the next Hantar attempt would fail on (empirically last-proven gate). */
  field: string;
  /** Human label for the field. */
  fieldLabel: string;
  /** What satisfying this step requires, in operator terms. */
  requirement: string;
  /**
   * Why this is the current blocker: the modal text proven at the last
   * walked gate. Hantar was observed to stop here.
   */
  basis: string;
}

export interface LaterUnresolvedGate {
  field: string;
  section: string;
  fieldLabel: string;
}

export interface SewaPajakanGateChainView {
  /** Gates proven in order during live discovery. */
  provenGates: ProvenGate[];
  /**
   * The Hantar gate the next operator submission would most plausibly
   * hit next, based on the last proven modal. Null if no gate is
   * currently empirically identified as the blocker.
   */
  currentBlockingStep: CurrentBlockingStep | null;
  /**
   * Fields still in the post-gate-2 :invalid set whose gate ordering
   * was not enumerated by the probe. Listed as requirements, not as
   * proven gates.
   */
  laterUnresolvedGates: LaterUnresolvedGate[];
  /**
   * Untested areas captured alongside the gate walk. Kept separate
   * from `laterUnresolvedGates` because these are not :invalid-list
   * fields — they are side branches the probe did not exercise.
   */
  untestedAreas: string[];
}

const SECTION_BAHAGIAN_C = "Bahagian C (Maklumat Harta)";
const SECTION_MAKLUMAT_AM = "Maklumat Am";
const SECTION_BAHAGIAN_A = "Bahagian A (Pihak-Pihak)";
const SECTION_LAMPIRAN = "Lampiran";
const SECTION_PERAKUAN = "Perakuan";

/**
 * Field-name → {label, section} table for the sewa_pajakan P5 form.
 * Section assignments come directly from the gate 2 modal text
 * ("Alamat Harta di Bahagian C") and the pre_hantar :invalid set
 * observed on 2026-04-22.
 */
const FIELD_TABLE: Record<string, { label: string; section: string }> = {
  pds_suratcara: { label: "Nama Surat Cara", section: SECTION_MAKLUMAT_AM },
  pds_jenis: { label: "Jenis Surat Cara", section: SECTION_MAKLUMAT_AM },
  pds_alamat_1: { label: "Alamat Harta", section: SECTION_BAHAGIAN_C },
  pds_poskod: { label: "Poskod", section: SECTION_BAHAGIAN_C },
  pds_city: { label: "Bandar", section: SECTION_BAHAGIAN_C },
  pds_harta_state: { label: "Negeri Harta", section: SECTION_BAHAGIAN_C },
  pds_harta_type: { label: "Jenis Harta", section: SECTION_BAHAGIAN_C },
  pds_floor: { label: "Tingkat", section: SECTION_BAHAGIAN_C },
  pds_mp: { label: "Milik Penuh / Pegangan", section: SECTION_BAHAGIAN_C },
  pds_harta_cat: { label: "Kategori Harta", section: SECTION_BAHAGIAN_C },
  pds_harta_perabot: { label: "Perabot", section: SECTION_BAHAGIAN_C },
  pds_lot: { label: "No. Lot", section: SECTION_BAHAGIAN_C },
  pds_mukim: { label: "Mukim", section: SECTION_BAHAGIAN_C },
  pds_daerah: { label: "Daerah", section: SECTION_BAHAGIAN_C },
  pds_luas: { label: "Keluasan", section: SECTION_BAHAGIAN_C },
  par_id: { label: "Identiti Pihak (Pihak Pertama / Pihak Kedua)", section: SECTION_BAHAGIAN_A },
};

/**
 * Ordered list of fields that remained :invalid at the end of the walk
 * (post-gate-2), excluding pds_alamat_1 which is the last proven gate
 * itself. Ordering here reflects the order the fields appeared in the
 * captured :invalid set — NOT a proven Hantar gate ordering.
 */
const LATER_INVALID_FIELDS: string[] = [
  "pds_jenis",
  "pds_poskod",
  "pds_city",
  "pds_harta_state",
  "pds_harta_type",
  "pds_floor",
  "pds_mp",
  "pds_harta_cat",
  "pds_harta_perabot",
  "pds_lot",
  "pds_mukim",
  "pds_daerah",
  "pds_luas",
  "par_id",
];

/**
 * Build the structured gate-chain view for a lane. Returns null for
 * lanes other than sewa_pajakan — this helper is deliberately scoped
 * to the lane whose gate chain has been walked.
 */
export function getSewaPajakanGateChainView(
  lane: PortalLane
): SewaPajakanGateChainView | null {
  if (lane !== "sewa_pajakan") return null;

  const provenGates: ProvenGate[] = [
    {
      index: 1,
      field: "pds_suratcara",
      section: SECTION_MAKLUMAT_AM,
      fieldLabel: FIELD_TABLE.pds_suratcara.label,
      modalMessage: "Sila pilih Nama Surat Cara.",
    },
    {
      index: 2,
      field: "pds_alamat_1",
      section: SECTION_BAHAGIAN_C,
      fieldLabel: FIELD_TABLE.pds_alamat_1.label,
      modalMessage:
        "Sila masukkan Alamat Harta di Bahagian C terlebih dahulu.",
    },
  ];

  // The current blocking step is the last walked gate: a fresh Hantar
  // attempt with pds_suratcara resolved but pds_alamat_1 still empty
  // would reproduce this modal.
  const currentBlockingStep: CurrentBlockingStep = {
    section: SECTION_BAHAGIAN_C,
    field: "pds_alamat_1",
    fieldLabel: FIELD_TABLE.pds_alamat_1.label,
    requirement:
      "Enter a non-empty Alamat Harta on Bahagian C before the next Hantar attempt will advance.",
    basis:
      "Last proven Hantar gate (2026-04-22): bootbox modal 'Sila masukkan Alamat Harta di Bahagian C terlebih dahulu'. URL unchanged, no submission.",
  };

  const laterUnresolvedGates: LaterUnresolvedGate[] = LATER_INVALID_FIELDS.map(
    (field) => ({
      field,
      section: FIELD_TABLE[field]?.section ?? "Unknown section",
      fieldLabel: FIELD_TABLE[field]?.label ?? field,
    })
  );

  const untestedAreas: string[] = [
    "Lampiran: tab renders with 0 file inputs on the default view — upload requirement conditions not yet determined.",
    "Perakuan (pds_akuan): checkbox visible but its role as a Hantar gate is not yet proven — Hantar still blocks on earlier gates.",
    "Bahagian B save permissiveness with an empty Bahagian A: not tested for this lane in the 2026-04-22 probe.",
    "pds_jenis options are static (not cascade-populated from pds_suratcara) — operator must explicitly choose Jenis Surat Cara.",
  ];

  return {
    provenGates,
    currentBlockingStep,
    laterUnresolvedGates,
    untestedAreas,
  };
}
