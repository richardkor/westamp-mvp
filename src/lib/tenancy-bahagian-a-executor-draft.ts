/**
 * WeStamp — Tenancy Bahagian A · Executor Draft (Milestone B9)
 *
 * Pure planning module that converts a captured WeStamp party record
 * into a sequence of planned executor steps for the Bahagian A
 * Tambah Individu modal flow.
 *
 * What this module IS
 * ───────────────────
 * - The single source of truth for the Bahagian A modal-fill step
 *   sequence and its current evidence-grounded `executableState`.
 * - A pure pre-execution planner — no Playwright, no portal contact,
 *   no DOM mutation, no save click.
 * - The translation seam between the captured `TenancyPortalParty`
 *   data and the live B9-evidenced selectors / option codes from
 *   `tenancy-bahagian-a-field-mapping.ts`.
 *
 * What this module IS NOT
 * ───────────────────────
 * - It does NOT implement the route that runs the steps live.
 * - It does NOT click the modal Simpan button. The Simpan step is
 *   emitted as `step.executableState === "planned_only"` for every
 *   plan; the corresponding selector is the
 *   `BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9` constant
 *   from the field-mapping module.
 * - It does NOT update the run-session stage to a "Bahagian A
 *   saved" state. No event is recorded. No row is persisted.
 *
 * Sensitive-data policy
 * ─────────────────────
 * Per the working-style update, planned steps may carry actual
 * party VALUES (name, IC, address, etc.) drawn from the captured
 * job record — the operator's own internal data feeding into the
 * step plan. Steps still must NOT carry portal-side cookies /
 * tokens / lhdnmsstoken / raw URLs / hrefs.
 */

import type {
  StampingJob,
  TenancyPortalParty,
  TenancyPortalPartyRole,
} from "./stamping-types";
import {
  BAHAGIAN_A_INDIVIDUAL_REGISTRY,
  BAHAGIAN_A_MODAL_CLOSE_SELECTOR,
  BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9,
  BAHAGIAN_A_MODAL_TRIGGERS,
  BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS,
  BAHAGIAN_A_TAB_ANCHOR_TEXT,
  type BahagianAFieldMappingEntry,
  type BahagianAModalTrigger,
} from "./tenancy-bahagian-a-field-mapping";
import { buildTenancyBahagianAPartyPlan } from "./tenancy-bahagian-a-party-plan";

// ─── Public types ──────────────────────────────────────────────────

/** Top-level executor-draft status. */
export type BahagianAExecutorDraftStatus =
  /** Not enough party data captured — plan can't be drafted yet. */
  | "blocked_missing_party_data"
  /**
   * One or more required modal selectors are still unknown — plan
   * exists but isn't fully resolvable. Useful when the SSM modal
   * hasn't been live-captured.
   */
  | "blocked_missing_selector"
  /**
   * Selectors are captured but the executor cannot yet run them
   * (e.g. WeStamp model is missing a required field that's only
   * observed at the portal level — `dateOfBirth` is the canonical
   * example for B9).
   */
  | "selectors_captured"
  /**
   * Plan is complete: every modal field has an observed selector
   * AND the WeStamp model captures the value to write. Still
   * `planned_only` overall because no execution route exists yet.
   */
  | "ready_for_next_execution_milestone"
  /** Used for the Simpan / save step itself — never executable in B9. */
  | "planned_only";

/** Stable enum of step kinds the draft emits. */
export type BahagianAExecutorDraftStepKind =
  | "navigate_to_bahagian_a_tab"
  | "open_party_modal"
  | "select_value"
  | "fill_text"
  | "pick_radio"
  | "verify_required_modal_field_present"
  | "planned_save"
  | "verify_row_count_after_save"
  | "close_modal_without_saving";

/**
 * One executor step. The exact set of fields that's populated
 * depends on `kind`; never throws if a field is undefined.
 */
export interface BahagianAExecutorDraftStep {
  /** 1-based ordinal in the plan. */
  ordinal: number;
  kind: BahagianAExecutorDraftStepKind;
  /** Stable WeStamp-internal field key when the step writes a field. */
  internalKey?: string;
  /** Concrete CSS selector when the step targets a specific element. */
  selector?: string;
  /**
   * For `select_value` / `pick_radio` steps: the portal `<option value>` /
   * radio id the executor must pick.
   */
  portalCode?: string;
  /**
   * For `fill_text` steps: a stable category descriptor (`empty` /
   * `code_like` / `non_canonical` / `numeric`) describing the value
   * shape — the actual operator-captured value is supplied at run
   * time, not stored on the step.
   *
   * Per the working-style update, the value itself MAY appear on
   * the step (`plannedValue`) for operator-only debugging.
   */
  plannedValue?: string;
  /**
   * Step-level executable state. Most fill / pick steps inherit
   * `selectors_captured` from their registry entry; the Simpan /
   * save step is permanently `planned_only`.
   */
  executableState: BahagianAExecutorDraftStatus;
  /** Stable plain-language description for the operator UI. */
  description: string;
  /**
   * Optional list of internal field keys the WeStamp record is
   * missing for this step. When non-empty the step is `blocked_*`.
   */
  missingPartyFields?: string[];
}

/** Composite plan envelope. */
export interface BahagianAExecutorDraftPlan {
  /** Stable identifier for the plan target. */
  jobId: string;
  /** Which role's modal this plan targets. */
  role: TenancyPortalPartyRole;
  /** Party type. Currently only `individual` is supported in B9. */
  partyType: "individual";
  /** Observed trigger anchor used to open the modal. */
  trigger: BahagianAModalTrigger;
  /** Modal title observed live. */
  modalTitleObserved: string | null;
  /** Sequence of planned steps. */
  steps: BahagianAExecutorDraftStep[];
  /**
   * Aggregated draft status. Most-blocking step status wins:
   *   `blocked_missing_party_data` >
   *   `blocked_missing_selector` >
   *   `selectors_captured` >
   *   `ready_for_next_execution_milestone`.
   * The single Simpan step is always `planned_only` and never
   * propagates upward.
   */
  status: BahagianAExecutorDraftStatus;
  /** True iff the plan ends with a `close_modal_without_saving` step. */
  endsWithoutSaving: true;
  /**
   * Sanitized warning that the executor draft never executes a
   * Bahagian A row commit.
   */
  warning: string;
}

// ─── Stable wording ────────────────────────────────────────────────

export const BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING =
  "Plan only. The Bahagian A modal Simpan step is `planned_only` and is never clicked at the B9 evidence level.";

const STEP_DESCRIPTIONS: Record<BahagianAExecutorDraftStepKind, string> = {
  navigate_to_bahagian_a_tab:
    "Click the `Bahagian A` tab anchor on the Sewa/Pajakan p5 form to reveal the role fieldsets.",
  open_party_modal:
    "Click the role-scoped `Individu` add-anchor inside the appropriate fieldset to open a blank Tambah modal.",
  select_value:
    "Set a portal `<select>` to its expected `<option value>` code.",
  fill_text:
    "Fill a portal text input with a value resolved from the captured party record.",
  pick_radio:
    "Click the radio whose `id` matches the captured value (e.g. NRIC sub-type, gender).",
  verify_required_modal_field_present:
    "Verify a required modal field resolves uniquely before any fill / select / radio click.",
  planned_save:
    "PLANNED ONLY — would click the modal Simpan button. Never executed at the B9 evidence level.",
  verify_row_count_after_save:
    "PLANNED ONLY — would re-read the role's Bahagian A table and assert the row count climbed by exactly one.",
  close_modal_without_saving:
    "Click the bootbox close icon on the modal to discard any test fills without committing a row.",
};

// ─── Step builders ─────────────────────────────────────────────────

/**
 * The internal-key → step-builder mapping for individual parties.
 * Keys appear in the order the executor would write them.
 */
interface FieldStepRecipe {
  internalKey: string;
  registryKey: string;
  /** True for fields that are NOT required by the portal (e.g. addressLine2). */
  optional?: boolean;
  /**
   * For radio-group fields, how to resolve the individual radio's
   * portal code from the captured party value. `null` for text /
   * select fields where the registry's option codes are sufficient.
   */
  radioCodeFromPartyValue?: (value: string | undefined) => string | null;
  /** Read the captured value off the party record. */
  readValue: (party: TenancyPortalParty) => string | null;
}

const NRIC_SUBTYPE_TO_PORTAL_RADIO_CODE: Record<string, string> = {
  ic_baru: "IC_BARU",
  ic_lama: "IC_LAMA",
  ic_polis: "IC_POLIS",
  ic_army: "IC_ARMY",
};

const GENDER_TO_PORTAL_RADIO_CODE: Record<string, string> = {
  male: "USER_SEX-1",
  female: "USER_SEX-2",
};

const INDIVIDUAL_FIELD_RECIPES: FieldStepRecipe[] = [
  {
    internalKey: "nameAsPerInstrument",
    registryKey: "nameAsPerInstrument",
    readValue: (p) => (p.nameAsPerInstrument ? p.nameAsPerInstrument : null),
  },
  {
    internalKey: "citizenshipCategory",
    registryKey: "citizenshipCategory",
    readValue: (p) => {
      if (!p.citizenshipCategory) return null;
      // Map WeStamp enum → portal `<option value>` per live B9
      // capture: 1=Citizen, 2=Non-citizen, 3=Permanent Resident.
      const m: Record<string, string> = {
        citizen: "1",
        non_citizen: "2",
        permanent_resident: "3",
      };
      return m[p.citizenshipCategory] ?? null;
    },
  },
  {
    internalKey: "nricSubType",
    registryKey: "nricSubType",
    radioCodeFromPartyValue: (v) =>
      v ? NRIC_SUBTYPE_TO_PORTAL_RADIO_CODE[v] ?? null : null,
    readValue: (p) => p.nricSubType ?? null,
  },
  {
    internalKey: "identityNumber",
    registryKey: "identityNumber",
    readValue: (p) => (p.identityNumber ? p.identityNumber : null),
  },
  {
    internalKey: "gender",
    registryKey: "gender",
    radioCodeFromPartyValue: (v) =>
      v ? GENDER_TO_PORTAL_RADIO_CODE[v] ?? null : null,
    readValue: (p) => p.gender ?? null,
  },
  {
    internalKey: "addressLine1",
    registryKey: "addressLine1",
    readValue: (p) => (p.addressLine1 ? p.addressLine1 : null),
  },
  {
    internalKey: "addressLine2",
    registryKey: "addressLine2",
    optional: true,
    readValue: (p) => p.addressLine2 ?? null,
  },
  {
    internalKey: "postcode",
    registryKey: "postcode",
    readValue: (p) => (p.postcode ? p.postcode : null),
  },
  {
    internalKey: "city",
    registryKey: "city",
    readValue: (p) => (p.city ? p.city : null),
  },
  {
    internalKey: "state",
    registryKey: "state",
    readValue: (p) => {
      if (!p.state) return null;
      // The portal codes are 1..17; WeStamp captures the human-
      // readable name. The executor uses the live `<option>` list
      // to resolve the code at runtime; here we surface the
      // captured value verbatim and let the step's
      // `executableState` flag whether the registry's option list
      // has the matching code.
      return p.state;
    },
  },
  {
    internalKey: "country",
    registryKey: "country",
    readValue: (p) => (p.country ? p.country : null),
  },
  {
    internalKey: "mobile",
    registryKey: "mobile",
    readValue: (p) => (p.mobile ? p.mobile : null),
  },
];

// ─── Plan builder ──────────────────────────────────────────────────

function findRegistryEntry(
  internalKey: string
): BahagianAFieldMappingEntry | null {
  return (
    BAHAGIAN_A_INDIVIDUAL_REGISTRY.entries.find(
      (e) => e.internalKey === internalKey
    ) ?? null
  );
}

function findTrigger(
  role: TenancyPortalPartyRole,
  partyType: "individual" | "company_ssm" | "company_non_ssm"
): BahagianAModalTrigger | null {
  return (
    BAHAGIAN_A_MODAL_TRIGGERS.find(
      (t) => t.role === role && t.partyType === partyType
    ) ?? null
  );
}

interface BuildPlanOptions {
  /** Optional explicit role override. Defaults to first individual party. */
  role?: TenancyPortalPartyRole;
}

/**
 * Build an executor draft plan for the FIRST individual party of
 * the given role on the supplied job. Returns a plan even when the
 * party is missing fields — the plan documents missing internal
 * keys per-step instead of refusing.
 *
 * The plan is deterministic; calling twice with the same job +
 * options yields equivalent step lists.
 */
export function buildBahagianAExecutorDraftPlan(
  job: StampingJob,
  options: BuildPlanOptions = {}
): BahagianAExecutorDraftPlan {
  const role: TenancyPortalPartyRole = options.role ?? "landlord";
  const parties = job.tenancyPortalDetails?.parties ?? [];
  const party =
    parties.find((p) => p.role === role && p.type === "individual") ?? null;

  // Trigger lookup.
  const trigger =
    findTrigger(role, "individual") ??
    // Defensive fallback — should never trigger because the
    // registry is exhaustive for individual triggers, but keeps
    // the plan total in failure-mode tests.
    {
      role,
      partyType: "individual",
      textObserved: "Individu",
      selectorAlgorithm: "fallback (registry incomplete)",
      certainty: "unknown",
    };

  // Modal title observed live (landlord-side captured 2026-04-30):
  //   "Tambah Pemberi Sewa / Pemilik Harta / Landlord (Individu)"
  // The tenant-side title was inferred from naming consistency.
  const modalTitleObserved =
    role === "landlord"
      ? "Tambah Pemberi Sewa / Pemilik Harta / Landlord (Individu)"
      : "Tambah Penyewa / Tenant (Individu)";

  // Cumulative status tracking. Only blocked statuses propagate
  // upward — non-blocked individual statuses (`ready...`,
  // `selectors_captured`, `planned_only`) never downgrade the
  // aggregate. The aggregate starts at `ready_for_next_execution_milestone`
  // and can only escalate to a blocked tier.
  const statusPriority: Record<BahagianAExecutorDraftStatus, number> = {
    blocked_missing_party_data: 4,
    blocked_missing_selector: 3,
    selectors_captured: 1,
    ready_for_next_execution_milestone: 1,
    planned_only: 0,
  };
  let aggregateStatus: BahagianAExecutorDraftStatus =
    "ready_for_next_execution_milestone";
  function bumpStatus(s: BahagianAExecutorDraftStatus): void {
    if (s === "planned_only") return;
    if (statusPriority[s] > statusPriority[aggregateStatus]) {
      aggregateStatus = s;
    }
  }

  const steps: BahagianAExecutorDraftStep[] = [];
  let ord = 1;

  // 1. Navigate to Bahagian A tab. This step does not depend on
  // per-field party data, so it carries the most-positive status
  // and never downgrades the aggregate.
  steps.push({
    ordinal: ord++,
    kind: "navigate_to_bahagian_a_tab",
    plannedValue: BAHAGIAN_A_TAB_ANCHOR_TEXT,
    executableState: "ready_for_next_execution_milestone",
    description: STEP_DESCRIPTIONS.navigate_to_bahagian_a_tab,
  });

  // 2. Open the role-scoped Individu modal.
  const triggerStatus: BahagianAExecutorDraftStatus =
    trigger.certainty === "observed"
      ? "ready_for_next_execution_milestone"
      : "blocked_missing_selector";
  steps.push({
    ordinal: ord++,
    kind: "open_party_modal",
    plannedValue: trigger.textObserved,
    executableState: triggerStatus,
    description: STEP_DESCRIPTIONS.open_party_modal,
  });
  bumpStatus(triggerStatus);

  // 3. Field-by-field steps.
  if (!party) {
    // No individual party for this role — plan is blocked.
    steps.push({
      ordinal: ord++,
      kind: "verify_required_modal_field_present",
      executableState: "blocked_missing_party_data",
      description:
        "Cannot proceed — no individual party of this role is captured on the job.",
      missingPartyFields: ["party"],
    });
    bumpStatus("blocked_missing_party_data");
  } else {
    for (const recipe of INDIVIDUAL_FIELD_RECIPES) {
      const entry = findRegistryEntry(recipe.registryKey);
      const value = recipe.readValue(party);
      const missing = !value;
      const selector = entry?.selector ?? null;
      let kind: BahagianAExecutorDraftStepKind;
      let portalCode: string | undefined;
      if (entry?.fieldKind === "select") {
        kind = "select_value";
        portalCode = value || undefined;
      } else if (entry?.fieldKind === "radio_group") {
        kind = "pick_radio";
        if (recipe.radioCodeFromPartyValue && value) {
          const radioCode = recipe.radioCodeFromPartyValue(value);
          if (radioCode) portalCode = radioCode;
        }
      } else {
        kind = "fill_text";
      }
      let stepStatus: BahagianAExecutorDraftStatus;
      if (missing && !recipe.optional) {
        stepStatus = "blocked_missing_party_data";
      } else if (missing && recipe.optional) {
        // Optional missing field — deliberately omitted, plan
        // remains executable.
        stepStatus = "ready_for_next_execution_milestone";
      } else if (!selector || !entry) {
        stepStatus = "blocked_missing_selector";
      } else if (
        (entry.fieldKind === "select" || entry.fieldKind === "radio_group") &&
        !portalCode
      ) {
        // Selector exists but the captured value couldn't be mapped
        // to a portal code — treat as missing party data.
        stepStatus = "blocked_missing_party_data";
      } else {
        stepStatus = "ready_for_next_execution_milestone";
      }
      bumpStatus(stepStatus);
      steps.push({
        ordinal: ord++,
        kind,
        internalKey: recipe.internalKey,
        ...(selector ? { selector } : {}),
        ...(portalCode ? { portalCode } : {}),
        ...(value ? { plannedValue: value } : {}),
        executableState: stepStatus,
        description: STEP_DESCRIPTIONS[kind],
        ...(missing && !recipe.optional
          ? { missingPartyFields: [recipe.internalKey] }
          : {}),
      });
    }
  }

  // 4. Verify required modal fields step (one summary verify).
  // Infrastructure step — does not gate aggregate readiness.
  steps.push({
    ordinal: ord++,
    kind: "verify_required_modal_field_present",
    executableState: "ready_for_next_execution_milestone",
    description: STEP_DESCRIPTIONS.verify_required_modal_field_present,
  });

  // 5. Planned save — NEVER executable in B9.
  steps.push({
    ordinal: ord++,
    kind: "planned_save",
    selector: BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9,
    executableState: "planned_only",
    description: STEP_DESCRIPTIONS.planned_save,
  });

  // 6. Planned verify-row-count — also NEVER executable in B9.
  steps.push({
    ordinal: ord++,
    kind: "verify_row_count_after_save",
    executableState: "planned_only",
    description: STEP_DESCRIPTIONS.verify_row_count_after_save,
  });

  // 7. Close-without-saving — what the live executor MUST do at the
  // B9 evidence level if the executor were ever invoked. Recorded
  // for completeness; tests assert no test path actually runs this.
  steps.push({
    ordinal: ord++,
    kind: "close_modal_without_saving",
    selector: BAHAGIAN_A_MODAL_CLOSE_SELECTOR,
    executableState: "ready_for_next_execution_milestone",
    description: STEP_DESCRIPTIONS.close_modal_without_saving,
  });

  return {
    jobId: job.id ?? "",
    role,
    partyType: "individual",
    trigger,
    modalTitleObserved,
    steps,
    status: aggregateStatus,
    endsWithoutSaving: true,
    warning: BAHAGIAN_A_EXECUTOR_DRAFT_NO_SAVE_WARNING,
  };
}

/**
 * Convenience wrapper — builds a plan for both landlord and tenant
 * (first individual of each). Useful for the operator UI's preview.
 */
export interface BahagianAExecutorDraftBundle {
  landlord: BahagianAExecutorDraftPlan;
  tenant: BahagianAExecutorDraftPlan;
  /** Aggregate of the two plans' statuses. */
  bundleStatus: BahagianAExecutorDraftStatus;
  /**
   * Cross-plan readiness verdict from `buildTenancyBahagianAPartyPlan`,
   * carried here so the UI can show one unified view.
   */
  partyPlanOverallStatus: ReturnType<
    typeof buildTenancyBahagianAPartyPlan
  >["overallStatus"];
}

export function buildBahagianAExecutorDraftBundle(
  job: StampingJob
): BahagianAExecutorDraftBundle {
  const landlord = buildBahagianAExecutorDraftPlan(job, { role: "landlord" });
  const tenant = buildBahagianAExecutorDraftPlan(job, { role: "tenant" });
  const partyPlan = buildTenancyBahagianAPartyPlan(job);

  const statusPriority: Record<BahagianAExecutorDraftStatus, number> = {
    blocked_missing_party_data: 4,
    blocked_missing_selector: 3,
    selectors_captured: 2,
    ready_for_next_execution_milestone: 1,
    planned_only: 0,
  };
  const bundleStatus =
    statusPriority[landlord.status] >= statusPriority[tenant.status]
      ? landlord.status
      : tenant.status;

  return {
    landlord,
    tenant,
    bundleStatus,
    partyPlanOverallStatus: partyPlan.overallStatus,
  };
}

// ─── Re-exports for the operator UI ────────────────────────────────

export {
  BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS,
  BAHAGIAN_A_MODAL_TRIGGERS,
  BAHAGIAN_A_MODAL_CLOSE_SELECTOR,
  BAHAGIAN_A_MODAL_SAVE_SELECTOR_DO_NOT_CLICK_IN_B9,
};
