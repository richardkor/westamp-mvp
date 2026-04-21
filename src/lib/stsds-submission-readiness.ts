/**
 * WeStamp — Portal Submission Readiness Evaluator
 *
 * Evaluates internal readiness for portal submission (Hantar) based on
 * the central lane knowledge profile and internal preparation inputs.
 *
 * Advisory-only layer. Does NOT submit anything.
 */

import { StampingJob } from "./stamping-types";
import {
  PortalSubmissionReadiness,
  PortalSubmissionReadinessCheck,
  PortalSubmissionReadinessStatus,
} from "./stsds-types";
import { getLaneKnowledgeProfile } from "./stsds-lane-knowledge";

export function evaluateSubmissionReadiness(
  job: StampingJob
): PortalSubmissionReadiness | null {
  const now = new Date().toISOString();

  if (!job.routingSuggestion) return null;

  const lane = job.routingSuggestion.suggestedLane;
  const profile = getLaneKnowledgeProfile(lane);
  const prep = job.preparationInputs;
  const notes: string[] = [...profile.notes];

  const unresolvedChecks: string[] = lane === "sewa_pajakan"
    ? [
        "Lampiran tab renders with 0 file inputs on default view — upload requirement conditions not yet determined",
        "Hantar gate chain beyond first-error 'Sila pilih Nama Surat Cara' (pds_suratcara) not yet enumerated; 15 additional fields were in :invalid set at that point (pds_jenis, pds_alamat_1, pds_poskod, pds_city, pds_harta_state, pds_harta_type, pds_floor, pds_mp, pds_harta_cat, pds_harta_perabot, pds_lot, pds_mukim, pds_daerah, pds_luas, par_id)",
        "Perakuan (pds_akuan) role as a Hantar gate not yet proven — Hantar blocked earlier by pds_suratcara",
        "Bahagian B save permissiveness with empty Bahagian A not yet tested for this lane",
      ]
    : [
        "Lampiran (document uploads) may be required — not yet confirmed as a Hantar gate",
        "Additional server-side validation may exist beyond the proven gates",
      ];

  // ── Lane where gates are NOT proven ───────────────────────────────
  if (!profile.laneAutomationProven) {
    if (!job.portalDraft) {
      notes.push("Portal draft has not been created yet.");
    }

    return {
      status: "assessment_limited",
      lane,
      evaluatedAt: now,
      gatesProvenForLane: false,
      provenBlockers: [],
      unresolvedChecks,
      notes,
    };
  }

  // ── Lane where gates ARE proven ───────────────────────────────────
  const provenBlockers: PortalSubmissionReadinessCheck[] = [];

  if (profile.declarationGateProven === "proven") {
    provenBlockers.push({
      key: "declaration",
      description: "Declaration (Perakuan) must be completed",
      satisfied: prep?.declarationPrepared === true,
    });
  }

  if (profile.bahagianAGateProven === "proven") {
    provenBlockers.push({
      key: "bahagian_a_completeness",
      description: "Bahagian A parties (Pihak Pertama / Pihak Kedua) must be added",
      satisfied:
        prep?.bahagianAFirstPartyPrepared === true &&
        prep?.bahagianASecondPartyPrepared === true,
    });
  }

  if (!job.portalDraft) {
    notes.push("Portal draft has not been created yet.");
  } else if (job.portalDraft.status !== "ready_for_review") {
    notes.push("Portal draft is incomplete — required Maklumat Am fields are still missing.");
  }

  const anyBlocked = provenBlockers.some((b) => !b.satisfied);
  const status: PortalSubmissionReadinessStatus = anyBlocked
    ? "blocked"
    : "ready_with_caveats";

  return {
    status,
    lane,
    evaluatedAt: now,
    gatesProvenForLane: true,
    provenBlockers,
    unresolvedChecks,
    notes,
  };
}
