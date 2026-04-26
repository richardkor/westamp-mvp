/**
 * WeStamp — Tenancy Browser Instruction Draft Compiler
 *
 * Deterministic helper that converts the output of
 * `compileTenancyPortalPayload` into a structured *non-mutating*
 * instruction draft showing what browser automation would do later
 * on the e-Duti Setem Sewa/Pajakan flow, section by section.
 *
 * What this module IS
 * ───────────────────
 * - A pure, side-effect-free compiler. Safe to call from server
 *   components, API routes, and the operator panel.
 * - Returns a `TenancyBrowserInstructionDraft` containing per-section
 *   step plans (Maklumat Am, Bahagian A/B/C, Rumusan, Lampiran,
 *   Perakuan) plus aggregate readiness, kind counts, and blocking
 *   reasons.
 * - Each step carries an explicit `kind` (`non_mutating` /
 *   `form_fill_only` / `mutating_requires_authorization` /
 *   `irreversible_requires_final_approval`) and `selectorCertainty`
 *   (`known` / `inferred` / `unknown_needs_live_mapping`).
 * - Reuses the payload compiler's section readiness — no duplicated
 *   readiness logic.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT drive the portal.
 * - It does NOT produce executable Playwright code.
 * - It does NOT submit, save, upload, or pay anything.
 * - It does NOT mutate the job record. The draft is computed in-
 *   memory at preview time and never persisted via this module.
 * - It does NOT fabricate exact CSS / DOM selectors. Where the
 *   underlying portal field key is observably documented (e.g.
 *   `pds_jenis`, `pds_alamat_1`) the step records the field key as
 *   metadata, but the selector certainty is set conservatively.
 *
 * Selector certainty conventions
 * ──────────────────────────────
 * - "known"                       — the portal label and field key
 *                                   were directly observed in a live
 *                                   walk, AND a stable selector
 *                                   strategy is recorded for them.
 * - "inferred"                    — the portal label and / or field
 *                                   key are documented from prior
 *                                   evidence, but the exact DOM
 *                                   selector is not; the live driver
 *                                   would still need to map by label.
 * - "unknown_needs_live_mapping"  — neither label nor field key has
 *                                   been confirmed yet; future
 *                                   supervised walk required.
 */

import type { StampingJob } from "./stamping-types";
import {
  compileTenancyPortalPayload,
  type TenancyPortalPayload,
  type TenancyPortalPayloadJobInput,
  type TenancyPortalPayloadParty,
  type TenancyPortalPayloadRentPeriod,
  type TenancyPortalPayloadSection,
} from "./tenancy-portal-payload";

// ─── Output types ───────────────────────────────────────────────────

/**
 * Portal sections covered by the instruction draft. Mirrors the
 * payload compiler's section enum but adds Maklumat Am as a leading
 * navigation/lane-selection section. (The payload compiler does not
 * have a Maklumat Am section because there is no payload data to
 * carry there — it's purely portal navigation.)
 */
export type TenancyBrowserInstructionSection =
  | "maklumat_am"
  | TenancyPortalPayloadSection;

/**
 * Whether a step mutates state on the live portal. The four values
 * encode an escalating authorization model:
 *   - non_mutating                             : reads / navigation only
 *   - form_fill_only                           : types into form fields, no
 *                                                save / submit (still
 *                                                non-portal-mutating
 *                                                until Simpan/Hantar)
 *   - mutating_requires_authorization          : Simpan / upload / similar
 *                                                operator-authorized step
 *   - irreversible_requires_final_approval     : Hantar / final submit /
 *                                                payment / similar
 *                                                irreversible action
 */
export type TenancyBrowserInstructionKind =
  | "non_mutating"
  | "form_fill_only"
  | "mutating_requires_authorization"
  | "irreversible_requires_final_approval";

/** How well the underlying selector / portal field is known. */
export type TenancyBrowserSelectorCertainty =
  | "known"
  | "inferred"
  | "unknown_needs_live_mapping";

/** Single step in the instruction draft. */
export interface TenancyBrowserInstructionStep {
  /** Sequence within the whole draft (1-based). */
  seq: number;
  /** Which portal section this step belongs to. */
  section: TenancyBrowserInstructionSection;
  /** Authorization class — see `TenancyBrowserInstructionKind`. */
  kind: TenancyBrowserInstructionKind;
  /** Operator-facing description of what this step would do. */
  description: string;
  /**
   * Bahasa Malaysia or English portal label, when known. Used by
   * the operator preview to communicate which portal field is
   * being filled.
   */
  portalLabel?: string;
  /**
   * Documented portal field key (e.g. `pds_jenis`, `pds_alamat_1`).
   * Recorded for steps where the underlying portal field key is
   * observable; null otherwise.
   */
  portalFieldKey?: string;
  /** How confident we are about the selector. */
  selectorCertainty: TenancyBrowserSelectorCertainty;
  /** Value to enter, if applicable. */
  value?: string | number | boolean | null;
  /** Free-text note for the operator preview. */
  notes?: string;
}

/** Per-section instruction plan. */
export interface TenancyBrowserInstructionSectionPlan {
  section: TenancyBrowserInstructionSection;
  state: "ready" | "blocked";
  /**
   * Steps the live driver would execute in order. Empty when the
   * section is blocked AND no informational steps were captured.
   */
  steps: TenancyBrowserInstructionStep[];
  /** Reasons the section is blocked. Empty when state === "ready". */
  blockingReasons: string[];
  /**
   * Whether this section is supported by the current automation
   * surface. Always "blocked" for the four unsupported pds_jenis
   * options on Bahagian B; always "blocked" for unmapped Lampiran /
   * Perakuan execution paths until live evidence is captured.
   */
  automationSupport: "supported" | "blocked";
}

/** Top-level result. */
export interface TenancyBrowserInstructionDraft {
  generatedAt: string;
  overall: "ready" | "blocked";
  blockingReasons: string[];
  unsupportedAutomationReasons: string[];
  totalInstructions: number;
  kindCounts: Record<TenancyBrowserInstructionKind, number>;
  sections: TenancyBrowserInstructionSectionPlan[];
  /** The payload the draft was compiled from — handy for the preview. */
  payload: TenancyPortalPayload;
}

// ─── Internal helpers ──────────────────────────────────────────────

/**
 * Internal step builder that ignores the `seq` field. The compiler
 * assigns sequence numbers in one pass at the end.
 */
type StepDraft = Omit<TenancyBrowserInstructionStep, "seq">;

const NON_EMPTY = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim().length > 0;

// ─── Compiler entry point ──────────────────────────────────────────

/**
 * Compile a non-mutating tenancy browser instruction draft. Accepts
 * either an already-compiled `TenancyPortalPayload` or a job-input
 * shape (in which case the payload is compiled internally).
 *
 * Behaviour highlights
 * ────────────────────
 * - Each section's `state` mirrors the payload compiler's section
 *   readiness. Steps are still surfaced for ready sections and may
 *   be partially surfaced (with blocked annotations) for blocked
 *   sections so the operator can see why.
 * - Bahagian B branches on `pds_jenis`:
 *     fixed_rent_during_tenancy    → one rent-period instruction set
 *     variable_rent_during_tenancy → multiple rent-period sets
 *     other four                   → blocked instruction set with
 *                                    a clear unsupported reason; no
 *                                    rent-period steps are generated
 * - Multiple landlords / tenants are walked in array order. No
 *   positional assumption.
 * - Lampiran upload steps are marked `mutating_requires_authorization`.
 * - Perakuan final-submit step is marked
 *   `irreversible_requires_final_approval` and its description states
 *   submission is forbidden at instruction-draft stage.
 */
export function compileTenancyBrowserInstructions(
  input: TenancyPortalPayload | TenancyPortalPayloadJobInput
): TenancyBrowserInstructionDraft {
  const payload: TenancyPortalPayload =
    "generatedAt" in input
      ? input
      : compileTenancyPortalPayload(input);

  const generatedAt = new Date().toISOString();
  const sections: TenancyBrowserInstructionSectionPlan[] = [];

  // Aggregate readiness lookups from the payload's per-section block.
  const readinessFor = (
    section: TenancyPortalPayloadSection
  ): { state: "ready" | "blocked"; reasons: string[] } => {
    const sr = payload.sectionReadiness.find((s) => s.section === section);
    return {
      state: sr?.state ?? "blocked",
      reasons: sr?.blockingReasons ?? [],
    };
  };

  // ── Maklumat Am ────────────────────────────────────────────────
  // No payload data — Maklumat Am is purely entry-point navigation
  // and the lane choice. Always considered "ready" as long as the
  // overall payload has at least surfaced its lane decision (the
  // sewa_pajakan lane is implicit for tenancy_agreement jobs).
  const maklumatAmSteps = buildMaklumatAmSteps();
  sections.push({
    section: "maklumat_am",
    state: "ready",
    steps: assignSeq(maklumatAmSteps, 1),
    blockingReasons: [],
    automationSupport: "supported",
  });

  // ── Bahagian A ─────────────────────────────────────────────────
  const bahagianARead = readinessFor("bahagian_a");
  const bahagianASteps = buildBahagianASteps(payload.bahagianA.parties);
  sections.push({
    section: "bahagian_a",
    state: bahagianARead.state,
    steps: assignSeq(bahagianASteps, nextSeq(sections)),
    blockingReasons: bahagianARead.reasons,
    automationSupport: "supported",
  });

  // ── Bahagian B ─────────────────────────────────────────────────
  const bahagianBRead = readinessFor("bahagian_b");
  const bahagianB = payload.bahagianB;
  const bahagianBAutomation: "supported" | "blocked" =
    bahagianB.automationSupportStatus;
  const bahagianBSteps = buildBahagianBSteps(bahagianB);
  sections.push({
    section: "bahagian_b",
    state: bahagianBRead.state,
    steps: assignSeq(bahagianBSteps, nextSeq(sections)),
    blockingReasons: bahagianBRead.reasons,
    automationSupport: bahagianBAutomation,
  });

  // ── Bahagian C ─────────────────────────────────────────────────
  const bahagianCRead = readinessFor("bahagian_c");
  const bahagianC = payload.bahagianC;
  const bahagianCSteps = buildBahagianCSteps(bahagianC);
  sections.push({
    section: "bahagian_c",
    state: bahagianCRead.state,
    steps: assignSeq(bahagianCSteps, nextSeq(sections)),
    blockingReasons: bahagianCRead.reasons,
    automationSupport: "supported",
  });

  // ── Rumusan Pengiraan ──────────────────────────────────────────
  // Future-only: read-and-compare. Marked supported (the steps are
  // pure non-mutating reads) but not actionable until live mapping
  // exists. Section state mirrors the payload's rumusan readiness.
  const rumusanRead = readinessFor("rumusan");
  const rumusanSteps = buildRumusanSteps(payload);
  sections.push({
    section: "rumusan",
    state: rumusanRead.state,
    steps: assignSeq(rumusanSteps, nextSeq(sections)),
    blockingReasons: rumusanRead.reasons,
    automationSupport: "supported",
  });

  // ── Lampiran ──────────────────────────────────────────────────
  const lampiranRead = readinessFor("lampiran");
  const lampiranSteps = buildLampiranSteps(payload);
  sections.push({
    section: "lampiran",
    state: lampiranRead.state,
    steps: assignSeq(lampiranSteps, nextSeq(sections)),
    blockingReasons: lampiranRead.reasons,
    // The Lampiran upload action is supported in principle (we have a
    // source PDF) but the actual mutating step requires authorization.
    automationSupport: "supported",
  });

  // ── Perakuan ──────────────────────────────────────────────────
  const perakuanRead = readinessFor("perakuan");
  const perakuanSteps = buildPerakuanSteps();
  sections.push({
    section: "perakuan",
    state: perakuanRead.state,
    steps: assignSeq(perakuanSteps, nextSeq(sections)),
    blockingReasons: perakuanRead.reasons,
    automationSupport: "supported",
  });

  // ── Aggregate ─────────────────────────────────────────────────
  const allSteps = sections.flatMap((s) => s.steps);
  const totalInstructions = allSteps.length;
  const kindCounts: Record<TenancyBrowserInstructionKind, number> = {
    non_mutating: 0,
    form_fill_only: 0,
    mutating_requires_authorization: 0,
    irreversible_requires_final_approval: 0,
  };
  for (const s of allSteps) {
    kindCounts[s.kind]++;
  }

  const blockingReasons: string[] = [];
  for (const sec of sections) {
    for (const r of sec.blockingReasons) blockingReasons.push(r);
  }
  const unsupportedAutomationReasons = [
    ...payload.unsupportedAutomationReasons,
  ];

  const overall: "ready" | "blocked" =
    payload.overall === "ready" &&
    sections.every((s) => s.state === "ready" && s.automationSupport === "supported")
      ? "ready"
      : "blocked";

  return {
    generatedAt,
    overall,
    blockingReasons,
    unsupportedAutomationReasons,
    totalInstructions,
    kindCounts,
    sections,
    payload,
  };
}

// ─── Section builders ──────────────────────────────────────────────

function nextSeq(sections: TenancyBrowserInstructionSectionPlan[]): number {
  let n = 1;
  for (const s of sections) n += s.steps.length;
  return n;
}

function assignSeq(
  drafts: StepDraft[],
  startAt: number
): TenancyBrowserInstructionStep[] {
  return drafts.map((d, i) => ({ ...d, seq: startAt + i }));
}

// ── Maklumat Am ─────────────────────────────────────────────────────

function buildMaklumatAmSteps(): StepDraft[] {
  return [
    {
      section: "maklumat_am",
      kind: "non_mutating",
      description:
        "Navigate to e-Duti Setem application form (Sewa / Pajakan flow).",
      portalLabel: "e-Duti Setem · Maklumat Am",
      selectorCertainty: "inferred",
      notes:
        "Entry-point navigation only. No data is sent to the portal.",
    },
    {
      section: "maklumat_am",
      kind: "form_fill_only",
      description:
        'Select instrument lane: "Sewa / Pajakan" (sewa_pajakan).',
      portalLabel: "Lane / Jenis Surat Cara",
      selectorCertainty: "inferred",
      value: "sewa_pajakan",
      notes:
        "Lane decision is fixed for tenancy_agreement jobs. No save / submit.",
    },
    {
      section: "maklumat_am",
      kind: "non_mutating",
      description:
        "Confirm the Sewa / Pajakan form is loaded before proceeding.",
      selectorCertainty: "inferred",
      notes:
        "Sanity check that the navigation succeeded; reads only.",
    },
  ];
}

// ── Bahagian A ──────────────────────────────────────────────────────

function buildBahagianASteps(
  parties: TenancyPortalPayloadParty[]
): StepDraft[] {
  const out: StepDraft[] = [];
  if (parties.length === 0) {
    out.push({
      section: "bahagian_a",
      kind: "non_mutating",
      description:
        "No parties captured yet. Skip filling Bahagian A — wait for operator capture.",
      selectorCertainty: "unknown_needs_live_mapping",
      notes:
        "Bahagian A requires at least one landlord and one tenant.",
    });
    return out;
  }
  parties.forEach((p, idx) => {
    const partyTag = `${p.role === "landlord" ? "Landlord" : "Tenant"} #${idx + 1}`;
    out.push({
      section: "bahagian_a",
      kind: "form_fill_only",
      description: `${partyTag} · select party category: ${p.portalPartyCategoryLabel}.`,
      portalLabel: "Kategori Pihak (Individu / Syarikat)",
      selectorCertainty: "unknown_needs_live_mapping",
      value: p.portalPartyCategoryLabel,
    });
    out.push({
      section: "bahagian_a",
      kind: "form_fill_only",
      description: `${partyTag} · fill name: ${p.name || "(unnamed)"}.`,
      portalLabel: "Nama mengikut surat cara",
      selectorCertainty: "unknown_needs_live_mapping",
      value: p.name,
    });
    if (p.type === "individual") {
      out.push({
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · select nationality: ${
          p.nationality === "malaysian"
            ? "Warganegara"
            : p.nationality === "non_malaysian"
              ? "Bukan Warganegara"
              : "(missing)"
        }.`,
        portalLabel: "Status Warganegara",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.nationality,
        notes:
          p.nationality === null
            ? "Nationality required for individual parties."
            : undefined,
      });
    }
    if (p.identityType) {
      const idLabel =
        p.identityType === "nric"
          ? "No. Kad Pengenalan"
          : p.identityType === "passport"
            ? "No. Pasport"
            : "No. Pendaftaran Syarikat";
      out.push({
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill ${idLabel}: ${p.identityNumber ?? "(missing)"}.`,
        portalLabel: idLabel,
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.identityNumber,
        notes:
          p.identityNumber === null
            ? "Identity number not captured."
            : undefined,
      });
    }
    // TIN handling — fill if present, else mark for auto-generation
    // expectation. Never fabricate a TIN.
    if (p.tin) {
      out.push({
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill TIN: ${p.tin}.`,
        portalLabel: "Tax Identification Number (TIN)",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.tin,
      });
    } else if (p.tinAutoGenerationExpected) {
      out.push({
        section: "bahagian_a",
        kind: "non_mutating",
        description: `${partyTag} · expect MyTax to auto-generate TIN after identity entry. No value typed.`,
        portalLabel: "Tax Identification Number (TIN)",
        selectorCertainty: "unknown_needs_live_mapping",
        notes:
          "Auto-generation hint set by operator. Live driver should observe the auto-fill rather than typing a value.",
      });
    } else {
      out.push({
        section: "bahagian_a",
        kind: "non_mutating",
        description: `${partyTag} · TIN not yet captured. Step skipped.`,
        portalLabel: "Tax Identification Number (TIN)",
        selectorCertainty: "unknown_needs_live_mapping",
        notes:
          "Set tinAutoGenerationExpected if MyTax will issue one, or capture the value.",
      });
    }
    // Address block
    out.push(
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill address line 1: ${p.addressLine1 || "(missing)"}.`,
        portalLabel: "Alamat (baris 1)",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.addressLine1,
      },
      ...(p.addressLine2
        ? [
            {
              section: "bahagian_a" as const,
              kind: "form_fill_only" as const,
              description: `${partyTag} · fill address line 2: ${p.addressLine2}.`,
              portalLabel: "Alamat (baris 2)",
              selectorCertainty: "unknown_needs_live_mapping" as const,
              value: p.addressLine2,
            },
          ]
        : []),
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill postcode: ${p.postcode || "(missing)"}.`,
        portalLabel: "Poskod",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.postcode,
      },
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill city: ${p.city || "(missing)"}.`,
        portalLabel: "Bandar",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.city,
      },
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · select state: ${p.state || "(missing)"}.`,
        portalLabel: "Negeri",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.state,
      },
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · select country: ${p.country || "(missing)"}.`,
        portalLabel: "Negara",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.country,
      },
      {
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill mobile: ${p.mobile || "(missing)"}.`,
        portalLabel: "No. Telefon Bimbit",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.mobile,
      }
    );
    if (p.phone) {
      out.push({
        section: "bahagian_a",
        kind: "form_fill_only",
        description: `${partyTag} · fill phone: ${p.phone}.`,
        portalLabel: "No. Telefon",
        selectorCertainty: "unknown_needs_live_mapping",
        value: p.phone,
      });
    }
  });
  return out;
}

// ── Bahagian B ──────────────────────────────────────────────────────

function buildBahagianBSteps(
  bahagianB: TenancyPortalPayload["bahagianB"]
): StepDraft[] {
  const out: StepDraft[] = [];
  out.push({
    section: "bahagian_b",
    kind: "form_fill_only",
    description: `Fill instrument date (Tarikh Surat Cara): ${
      bahagianB.instrumentDate ?? "(missing)"
    }.`,
    portalLabel: "Tarikh Surat Cara",
    selectorCertainty: "inferred",
    value: bahagianB.instrumentDate,
  });
  out.push({
    section: "bahagian_b",
    kind: "form_fill_only",
    description: `Fill duplicate copies: ${
      bahagianB.duplicateCopies === null
        ? "(missing)"
        : String(bahagianB.duplicateCopies)
    }.`,
    portalLabel: "Salinan Pendua",
    selectorCertainty: "inferred",
    value: bahagianB.duplicateCopies,
  });

  // pds_suratcara — Hantar gate 1 in the recorded evidence
  // (sewa_pajakan-gate-chain.ts proven gate 1; lane-knowledge note
  // pds_suratcara=1101 accepted). DISTINCT from pds_jenis: see
  // sewa_pajakan-gate-chain.ts FIELD_TABLE lines 98–99 (different
  // labels) and line 192 ("pds_jenis options are static, not
  // cascade-populated from pds_suratcara").
  //
  // The WeStamp data model does NOT yet capture an operator-
  // confirmed value for pds_suratcara. Per the data-gap-closure
  // scope, this step does NOT silently inject a default and does
  // NOT pretend it can be filled. It is an explicit blocker on the
  // Bahagian B section.
  if (
    bahagianB.instrumentName.captured &&
    bahagianB.instrumentName.code !== null
  ) {
    const namedLabel = bahagianB.instrumentName.label ?? "(label missing)";
    out.push({
      section: "bahagian_b",
      kind: "form_fill_only",
      description: `Select Nama Surat Cara (pds_suratcara): ${bahagianB.instrumentName.code} · ${namedLabel}.`,
      portalLabel: "Nama Surat Cara",
      portalFieldKey: "pds_suratcara",
      selectorCertainty: "known",
      value: bahagianB.instrumentName.code,
      notes: `Distinct field from pds_jenis below — both are required at Hantar gate 1. Documented accepted code: ${bahagianB.instrumentName.code} (${namedLabel}).`,
    });
  } else {
    out.push({
      section: "bahagian_b",
      kind: "non_mutating",
      description:
        'Cannot fill Nama Surat Cara (pds_suratcara) — required Hantar gate 1 portal field. WeStamp has no operator-confirmed value for this job. Bahagian B is BLOCKED until the operator captures the field.',
      portalLabel: "Nama Surat Cara",
      portalFieldKey: "pds_suratcara",
      selectorCertainty: "known",
      value: null,
      notes:
        bahagianB.instrumentName.missingReason ??
        "Operator must select pds_suratcara from the documented option list (today: code 1101 / Perjanjian Sewa).",
    });
  }

  // pds_jenis selection — portal field key is documented evidence;
  // the dropdown options are static (7 observed, 6 modelled).
  // SEPARATE from pds_suratcara above — operator must explicitly
  // pick this even after pds_suratcara is selected.
  out.push({
    section: "bahagian_b",
    kind: "form_fill_only",
    description: `Select Jenis Surat Cara (pds_jenis): ${
      bahagianB.portalDescriptionLabel ?? "(not selected)"
    }.`,
    portalLabel: "Jenis Surat Cara",
    portalFieldKey: "pds_jenis",
    selectorCertainty: "known",
    value: bahagianB.portalDescriptionType,
    notes:
      bahagianB.portalDescriptionType === null
        ? "Required. Pick one of the six modelled options. Distinct field from pds_suratcara above."
        : "Distinct field from pds_suratcara — both are required at Hantar gate 1.",
  });

  // Branch on description type for the rent schedule.
  switch (bahagianB.rentScheduleMode) {
    case "fixed":
      out.push(...buildRentPeriodSteps(bahagianB.rentSchedule, "fixed"));
      break;
    case "variable":
      out.push(...buildRentPeriodSteps(bahagianB.rentSchedule, "variable"));
      break;
    case "unsupported":
      out.push({
        section: "bahagian_b",
        kind: "non_mutating",
        description:
          "Bahagian B: pds_jenis selection is not supported by current automation. Instruction draft for rent details is intentionally NOT generated.",
        selectorCertainty: "unknown_needs_live_mapping",
        notes:
          bahagianB.automationSupportReason ??
          "Unsupported pds_jenis option requires data we do not model yet (premium / crop share / amendment reference).",
      });
      break;
    case "not_yet_selected":
      out.push({
        section: "bahagian_b",
        kind: "non_mutating",
        description:
          "Bahagian B: pds_jenis not yet selected. Rent schedule instruction draft is deferred.",
        selectorCertainty: "unknown_needs_live_mapping",
        notes:
          "Operator must pick one of the six modelled pds_jenis options before instruction draft for rent details can be compiled.",
      });
      break;
  }

  return out;
}

function buildRentPeriodSteps(
  schedule: TenancyPortalPayloadRentPeriod[],
  mode: "fixed" | "variable"
): StepDraft[] {
  const out: StepDraft[] = [];
  if (schedule.length === 0) {
    out.push({
      section: "bahagian_b",
      kind: "non_mutating",
      description:
        mode === "fixed"
          ? "Rent schedule expected (one period). None captured — instruction set incomplete."
          : "Rent schedule expected (multiple periods). None captured — instruction set incomplete.",
      selectorCertainty: "inferred",
    });
    return out;
  }
  schedule.forEach((row, idx) => {
    const periodTag = `Rent period #${idx + 1}`;
    out.push({
      section: "bahagian_b",
      kind: "form_fill_only",
      description: `${periodTag} · fill start date: ${row.startDate}.`,
      portalLabel: "Tarikh Mula",
      selectorCertainty: "inferred",
      value: row.startDate,
    });
    out.push({
      section: "bahagian_b",
      kind: "form_fill_only",
      description: `${periodTag} · fill end date: ${row.endDate}.`,
      portalLabel: "Tarikh Tamat",
      selectorCertainty: "inferred",
      value: row.endDate,
    });
    out.push({
      section: "bahagian_b",
      kind: "form_fill_only",
      description: `${periodTag} · fill monthly rent: RM ${row.monthlyRent}.`,
      portalLabel: "Sewa Bulanan",
      selectorCertainty: "inferred",
      value: row.monthlyRent,
    });
  });
  if (mode === "variable" && schedule.length < 2) {
    out.push({
      section: "bahagian_b",
      kind: "non_mutating",
      description:
        "Variable rent schedule requires at least two periods. Only one captured — instruction set incomplete.",
      selectorCertainty: "inferred",
    });
  }
  return out;
}

// ── Bahagian C ──────────────────────────────────────────────────────

function buildBahagianCSteps(
  c: TenancyPortalPayload["bahagianC"]
): StepDraft[] {
  const out: StepDraft[] = [];
  // pds_alamat_1 — Hantar gate 2 in the recorded evidence. Field key
  // and Bahasa Malaysia label are observed; selector itself is not.
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Fill property address line 1: ${
      c.addressLine1 ?? "(missing)"
    }.`,
    portalLabel: "Alamat Harta (baris 1)",
    portalFieldKey: "pds_alamat_1",
    selectorCertainty: "known",
    value: c.addressLine1,
  });
  if (NON_EMPTY(c.addressLine2)) {
    out.push({
      section: "bahagian_c",
      kind: "form_fill_only",
      description: `Fill property address line 2: ${c.addressLine2}.`,
      portalLabel: "Alamat Harta (baris 2)",
      selectorCertainty: "inferred",
      value: c.addressLine2,
    });
  }
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Fill property postcode: ${c.postcode ?? "(missing)"}.`,
    portalLabel: "Poskod Harta",
    portalFieldKey: "pds_poskod",
    selectorCertainty: "inferred",
    value: c.postcode,
  });
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Fill property city: ${c.city ?? "(missing)"}.`,
    portalLabel: "Bandar Harta",
    portalFieldKey: "pds_city",
    selectorCertainty: "inferred",
    value: c.city,
  });
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Select property state: ${c.state ?? "(missing)"}.`,
    portalLabel: "Negeri Harta",
    portalFieldKey: "pds_harta_state",
    selectorCertainty: "inferred",
    value: c.state,
  });
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Select property country: ${c.country ?? "(missing)"}.`,
    portalLabel: "Negara Harta",
    selectorCertainty: "inferred",
    value: c.country,
  });
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Select Jenis Harta: ${
      c.propertyTypeLabel ?? "(missing)"
    }.`,
    portalLabel: "Jenis Harta",
    portalFieldKey: "pds_harta_type",
    selectorCertainty: "inferred",
    value: c.propertyType,
  });
  if (c.propertyType === "kediaman") {
    out.push({
      section: "bahagian_c",
      kind: "form_fill_only",
      description: `Select Jenis Bangunan: ${c.buildingType ?? "(missing)"}.`,
      portalLabel: "Jenis Bangunan",
      portalFieldKey: "pds_harta_cat",
      selectorCertainty: "inferred",
      value: c.buildingType,
      notes: c.buildingTypeRequiredButMissing
        ? "Required when Jenis Harta = Kediaman."
        : undefined,
    });
  }
  if (NON_EMPTY(c.furnishedStatus)) {
    out.push({
      section: "bahagian_c",
      kind: "form_fill_only",
      description: `Select furnished status (Perabot): ${c.furnishedStatus}.`,
      portalLabel: "Perabot",
      portalFieldKey: "pds_harta_perabot",
      selectorCertainty: "inferred",
      value: c.furnishedStatus,
    });
  }
  if (NON_EMPTY(c.floor)) {
    out.push({
      section: "bahagian_c",
      kind: "form_fill_only",
      description: `Fill floor / level: ${c.floor}.`,
      portalLabel: "Tingkat",
      portalFieldKey: "pds_floor",
      selectorCertainty: "inferred",
      value: c.floor,
    });
  }
  if (typeof c.numberOfFloors === "number") {
    out.push({
      section: "bahagian_c",
      kind: "form_fill_only",
      description: `Fill number of floors: ${c.numberOfFloors}.`,
      portalLabel: "Jumlah Tingkat",
      selectorCertainty: "inferred",
      value: c.numberOfFloors,
    });
  }
  out.push({
    section: "bahagian_c",
    kind: "form_fill_only",
    description: `Fill premises area: ${
      c.premisesAreaSqm === null ? "(missing)" : `${c.premisesAreaSqm} m²`
    }.${c.premisesAreaIsZeroFallback ? " (operator-confirmed fallback)" : ""}`,
    portalLabel: "Luas Premis (m²)",
    portalFieldKey: "pds_luas",
    selectorCertainty: "inferred",
    value: c.premisesAreaSqm,
    notes: c.premisesAreaIsZeroFallback
      ? "Operator confirmed: 0 entered as fallback because no value is available on the instrument."
      : undefined,
  });
  return out;
}

// ── Rumusan Pengiraan ──────────────────────────────────────────────

function buildRumusanSteps(
  payload: TenancyPortalPayload
): StepDraft[] {
  return [
    {
      section: "rumusan",
      kind: "non_mutating",
      description:
        "Read portal-calculated duty (Rumusan Pengiraan). Future supervised step — selector not yet mapped.",
      portalLabel: "Duti yang dikira",
      selectorCertainty: "unknown_needs_live_mapping",
      notes:
        "Live driver must observe the portal-displayed duty value at execution time.",
    },
    {
      section: "rumusan",
      kind: "non_mutating",
      description: `Compare portal duty against WeStamp internal duty (${
        payload.rumusan.westampInternalCalculatedDuty === null
          ? "WeStamp value missing"
          : `RM ${payload.rumusan.westampInternalCalculatedDuty}`
      }).`,
      selectorCertainty: "inferred",
      notes:
        "Equality check. Mismatch must block automation at execution time.",
    },
    {
      section: "rumusan",
      kind: "non_mutating",
      description:
        "If portal duty != WeStamp duty, abort automation with a duty-mismatch reason.",
      selectorCertainty: "inferred",
      notes:
        "Decision step — no portal interaction.",
    },
  ];
}

// ── Lampiran ────────────────────────────────────────────────────────

function buildLampiranSteps(payload: TenancyPortalPayload): StepDraft[] {
  return [
    {
      section: "lampiran",
      kind: "non_mutating",
      description: `Locate source PDF (Lampiran): ${
        payload.lampiran.originalFileName ?? "(missing)"
      }${
        payload.lampiran.sourcePdfStoragePath
          ? ` · ${payload.lampiran.sourcePdfStoragePath}`
          : ""
      }.`,
      portalLabel: "Lampiran",
      selectorCertainty: "inferred",
      notes:
        "Future supervised upload step. Preview only — no file movement here.",
    },
    {
      section: "lampiran",
      kind: "mutating_requires_authorization",
      description:
        "Upload instrument PDF to e-Duti Setem Lampiran field. Requires explicit operator authorization at execution time.",
      portalLabel: "Lampiran · upload",
      selectorCertainty: "unknown_needs_live_mapping",
      notes:
        "Mutating action. Not performed at draft compile time.",
    },
    {
      section: "lampiran",
      kind: "non_mutating",
      description:
        "Verify upload success by reading portal acknowledgement. Future supervised step.",
      selectorCertainty: "unknown_needs_live_mapping",
    },
    {
      section: "lampiran",
      kind: "mutating_requires_authorization",
      description:
        "Save Lampiran section. Requires explicit operator authorization at execution time.",
      portalLabel: "Simpan Lampiran",
      selectorCertainty: "unknown_needs_live_mapping",
      notes:
        "Mutating Simpan action. Not performed at draft compile time.",
    },
  ];
}

// ── Perakuan ────────────────────────────────────────────────────────

function buildPerakuanSteps(): StepDraft[] {
  return [
    {
      section: "perakuan",
      kind: "non_mutating",
      description:
        "Review the declaration text (Perakuan). Read-only.",
      portalLabel: "Perakuan",
      selectorCertainty: "inferred",
    },
    {
      section: "perakuan",
      kind: "form_fill_only",
      description:
        "Tick the declaration acknowledgement checkbox. Form-fill only — no submission yet.",
      portalLabel: "Perakuan checkbox",
      selectorCertainty: "unknown_needs_live_mapping",
    },
    {
      section: "perakuan",
      kind: "irreversible_requires_final_approval",
      description:
        "Click Hantar to submit the instrument to LHDN. IRREVERSIBLE. FINAL submission is FORBIDDEN at instruction-draft stage and requires explicit operator final-approval at supervised execution time.",
      portalLabel: "Hantar",
      selectorCertainty: "unknown_needs_live_mapping",
      notes:
        "Final submission is a supervised gate. The instruction draft NEVER triggers Hantar.",
    },
  ];
}

// ─── Convenience guard ─────────────────────────────────────────────

/**
 * Type-guard helper for callers that want to accept either the
 * payload or the raw job input. Useful for the operator panel which
 * can pass either a freshly-compiled payload or a job-input shape.
 */
export function isTenancyPortalPayload(
  v: unknown
): v is TenancyPortalPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    "generatedAt" in (v as Record<string, unknown>) &&
    "bahagianA" in (v as Record<string, unknown>)
  );
}

/** Optional alias for callers wanting an explicit job-input entrypoint. */
export function compileTenancyBrowserInstructionsFromJob(
  job: Pick<
    StampingJob,
    | "tenancyPortalDetails"
    | "storagePath"
    | "originalFileName"
    | "mimeType"
    | "documentCategory"
    | "stampingDetails"
  >
): TenancyBrowserInstructionDraft {
  return compileTenancyBrowserInstructions(job);
}
