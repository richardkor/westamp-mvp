"use client";

/**
 * TenancyPortalPanel — Operator capture/review panel for the
 * tenancy portal-required details (Bahagian A / B / C).
 *
 * Internal operator UI only. Not surfaced on the public receipt.
 *
 * Renders three things, top to bottom:
 *   1. Readiness summary header — counts and overall ready/blocked
 *      decision derived by `evaluateTenancyPortalReadiness`.
 *   2. Portal execution payload / gap preview table — every required
 *      field, its current WeStamp value, target portal section, and
 *      readiness state.
 *   3. Inline edit form for parties, instrument, and property — the
 *      bridge through which the operator captures missing data. Saves
 *      via `POST /api/intake/[id]/tenancy-portal-details`. On success
 *      the page reloads so the server-side details / readiness are
 *      re-derived against the freshly persisted value.
 *
 * No portal automation. No portal probing. No payment.
 */

import { useCallback, useMemo, useState } from "react";
import {
  evaluateTenancyPortalReadiness,
  INSTRUMENT_NAME_OPTIONS,
  type TenancyPortalReadinessReport,
  type TenancyPortalReadinessState,
  type TenancyPortalSection,
} from "../../../lib/tenancy-portal-requirements";
import {
  compileTenancyPortalPayload,
  type TenancyPortalPayload,
} from "../../../lib/tenancy-portal-payload";
import {
  compileTenancyBrowserInstructions,
  type TenancyBrowserInstructionDraft,
  type TenancyBrowserInstructionKind,
  type TenancyBrowserInstructionSection,
} from "../../../lib/tenancy-browser-instructions";
import {
  evaluateTenancyPortalRunReadiness,
  groupTenancyPortalFieldMappingGaps,
  TENANCY_PORTAL_FIELD_MAPPING_GAPS_EXPLANATION,
  TENANCY_PORTAL_FIELD_MAPPING_GAPS_HEADER,
  type TenancyPortalFieldMappingGapCategory,
  type TenancyPortalRunReadinessReport,
} from "../../../lib/tenancy-portal-run-readiness";
import {
  buildTenancyInstructionGraph,
  type TenancyInstructionGraph,
} from "../../../lib/tenancy-instruction-graph";
import {
  buildInstructionGraphPreviewViewModel,
  type InstructionGraphPreviewViewModel,
} from "../../../lib/tenancy-instruction-graph-preview";
import {
  buildSupervisedRunConsoleViewModel,
  type SupervisedRunConsoleViewModel,
} from "../../../lib/tenancy-supervised-run-console";
import {
  buildBrowserSessionStatusCardViewModel,
  type BrowserSessionStatusCardLifecycle,
} from "../../../lib/tenancy-supervised-session-card";
import type { SupervisedSessionReport } from "../../../lib/tenancy-supervised-session-shell";
import {
  buildSupervisedRunSessionViewModel,
  PHASE_2_EXECUTE_BUTTON_LABEL,
  PHASE_2_EXECUTE_SUCCESS,
  PHASE_2_EXECUTE_WARNING,
  PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL,
  PHASE_3_LANDLORD_EXECUTE_SUCCESS,
  PHASE_3_LANDLORD_EXECUTE_WARNING,
  PHASE_3_TENANT_EXECUTE_BUTTON_LABEL,
  PHASE_3_TENANT_EXECUTE_SUCCESS,
  PHASE_3_TENANT_EXECUTE_WARNING,
  PHASE_4_BAHAGIAN_B_EXECUTE_BUTTON_LABEL,
  PHASE_4_BAHAGIAN_B_EXECUTE_SUCCESS,
  PHASE_4_BAHAGIAN_B_EXECUTE_WARNING,
  type SupervisedRunSessionViewModel,
  type TenancyRunSessionState,
} from "../../../lib/tenancy-supervised-run-session";
import {
  PHASE_2_REASON_LABELS,
  type Phase2ExecutionResult,
  type Phase2RefusalReason,
} from "../../../lib/tenancy-phase-2-executor";
import {
  PHASE_3_LANDLORD_REASON_LABELS,
  type Phase3LandlordExecutionResult,
  type Phase3LandlordRefusalReason,
} from "../../../lib/tenancy-phase-3-landlord-executor";
import {
  PHASE_3_TENANT_REASON_LABELS,
  type Phase3TenantExecutionResult,
  type Phase3TenantRefusalReason,
} from "../../../lib/tenancy-phase-3-tenant-executor";
import {
  PHASE_4_BAHAGIAN_B_REASON_LABELS,
  type Phase4BahagianBExecutionResult,
  type Phase4BahagianBRefusalReason,
} from "../../../lib/tenancy-phase-4-bahagian-b-executor";
import {
  buildTenancyBahagianAPartyPlan,
  type TenancyBahagianAPartyPlan,
} from "../../../lib/tenancy-bahagian-a-party-plan";
import {
  BAHAGIAN_A_INDIVIDUAL_REGISTRY,
  BAHAGIAN_A_COMPANY_SSM_REGISTRY,
  BAHAGIAN_A_MODAL_TRIGGERS,
  BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS,
  summarizeBahagianAFieldMapping,
  type BahagianAMappingCertaintySummary,
} from "../../../lib/tenancy-bahagian-a-field-mapping";
import {
  buildBahagianAExecutorDraftBundle,
  type BahagianAExecutorDraftBundle,
  type BahagianAExecutorDraftStatus,
} from "../../../lib/tenancy-bahagian-a-executor-draft";
import type {
  StampingJob,
  TenancyPortalBuildingType,
  TenancyPortalCitizenshipCategory,
  TenancyPortalCompanyLocality,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalGender,
  TenancyPortalIdentityType,
  TenancyPortalInstrumentNameCode,
  TenancyPortalInstrumentRelationship,
  TenancyPortalLandAreaUnit,
  TenancyPortalNationality,
  TenancyPortalNricSubType,
  TenancyPortalParty,
  TenancyPortalPartyRole,
  TenancyPortalPartyType,
  TenancyPortalProperty,
  TenancyPortalPropertyType,
} from "../../../lib/stamping-types";
import {
  TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_LABELS,
  TENANCY_PORTAL_LAND_AREA_UNIT_LABELS,
} from "../../../lib/stamping-types";

/**
 * Operator-facing labels for the six observed Bahagian B description
 * types. Mirrors the labels used by the readiness evaluator. A
 * seventh option exists in the live portal but its label has not yet
 * been recorded — it is intentionally absent here.
 */
const DESCRIPTION_TYPE_OPTIONS: { value: TenancyPortalDescriptionType; label: string; note?: string }[] = [
  {
    value: "fixed_rent_during_tenancy",
    label:
      "Perjanjian Sewa/Pajakan · Bayaran Sewa Tetap Dalam Tempoh Penyewaan",
    note: "Single rent across the whole tenancy.",
  },
  {
    value: "variable_rent_during_tenancy",
    label:
      "Perjanjian Sewa/Pajakan · Bayaran Sewa Berbeza Dalam Tempoh Penyewaan",
    note: "Different rent across periods. Add at least two schedule rows below.",
  },
  {
    value: "amendment_to_original_tenancy",
    label:
      "Perjanjian Sewa/Pajakan · Terdapat Pindaan Ke Atas Perjanjian Sewa/Pajakan Yang Asal",
    note: "Not supported by current automation — record value but handle stamping outside the assisted path.",
  },
  {
    value: "other_item_49f",
    label: "Lain-lain (BUTIRAN 49(f), Jadual Pertama Akta Setem 1949)",
    note: "Not supported by current automation — record value but handle stamping outside the assisted path.",
  },
  {
    value: "premium_only",
    label: "Premium atau balasan sahaja",
    note: "Not supported by current automation — premium amount is not modelled yet.",
  },
  {
    value: "crop_share_only",
    label: "Nisbah hasil tanaman sahaja",
    note: "Not supported by current automation — crop share ratio is not modelled yet.",
  },
];

const SECTION_LABELS: Record<TenancyPortalSection, string> = {
  bahagian_a: "Bahagian A · Parties",
  bahagian_b: "Bahagian B · Instrument & Rent",
  bahagian_c: "Bahagian C · Property",
  rumusan: "Rumusan",
  lampiran: "Lampiran",
  perakuan: "Perakuan",
};

const STATE_LABELS: Record<TenancyPortalReadinessState, string> = {
  ready: "Ready",
  missing: "Missing",
  conditional_missing: "Conditional",
  operator_fallback: "Fallback",
};

/**
 * Local mutable draft type. Mirrors `TenancyPortalDetails` but allows
 * partial / loose fields during user editing (everything stringy until
 * save).
 */
interface DraftParty
  extends Omit<TenancyPortalParty, "tinAutoGenerationExpected"> {
  tinAutoGenerationExpected: boolean;
}

interface DraftRentPeriod {
  startDate: string;
  endDate: string;
  monthlyRent: string; // string while editing; coerced on save
}

interface Draft {
  parties: DraftParty[];
  // Bahagian B
  instrumentDate: string;
  duplicateCopies: string;
  /**
   * Bahagian B · Section 1 — pds_suratcara / Nama Surat Cara.
   * Empty string when not yet selected. Distinct from
   * `portalDescriptionType` (pds_jenis) below.
   */
  portalInstrumentNameCode: TenancyPortalInstrumentNameCode | "";
  portalDescriptionType: TenancyPortalDescriptionType | "";
  rentSchedule: DraftRentPeriod[];
  // Bahagian C
  propertyAddressLine1: string;
  propertyAddressLine2: string;
  propertyPostcode: string;
  propertyCity: string;
  propertyState: string;
  propertyCountry: string;
  propertyType: TenancyPortalPropertyType | "";
  buildingType: TenancyPortalBuildingType | "";
  furnishedStatus: TenancyPortalFurnishedStatus | "";
  floor: string;
  numberOfFloors: string;
  premisesAreaSqm: string;
  premisesAreaIsZeroFallback: boolean;
  // Bahagian C · land-registry sub-block (Milestone A1, 2026-04-29).
  // String-typed at the draft level so the operator can edit freely;
  // coerced + validated server-side via `validateTenancyPortalDetailsInput`.
  landRegistryMilikPenuh: string;
  landRegistryLot: string;
  landRegistryMukim: string;
  landRegistryDaerah: string;
  landRegistryLuas: string;
  landRegistryLuasUnit: TenancyPortalLandAreaUnit | "";
  landRegistryKegunaan: string;
  // Maklumat Am sub-block (Milestone A2, 2026-04-29).
  maklumatAmDutyStampCode: string;
  maklumatAmDutyStampLabel: string;
  maklumatAmInstrumentRelationship: TenancyPortalInstrumentRelationship | "";
  maklumatAmBalasan: string;
  maklumatAmRemissionCode: string;
  maklumatAmRemissionLabel: string;
  maklumatAmTreatyKmkt: boolean;
  maklumatAmTreatyKlnm: boolean;
  maklumatAmTreatyVienna: boolean;
  operatorNote: string;
}

const EMPTY_PARTY: DraftParty = {
  role: "landlord",
  type: "individual",
  nameAsPerInstrument: "",
  nationality: null,
  identityType: undefined,
  identityNumber: "",
  tin: "",
  tinAutoGenerationExpected: false,
  addressLine1: "",
  addressLine2: "",
  postcode: "",
  city: "",
  state: "",
  country: "Malaysia",
  mobile: "",
  phone: "",
  // Bahagian A party identity sub-fields (Milestone A4). Undefined
  // means "not yet captured"; the readiness gate blocks until the
  // operator selects a value.
  citizenshipCategory: undefined,
  nricSubType: undefined,
  gender: undefined,
  rocOld: undefined,
  rocNew: undefined,
  businessType: undefined,
  companyLocality: undefined,
  companyRepresentative: undefined,
  operatorNote: "",
};

function buildInitialDraft(existing?: TenancyPortalDetails): Draft {
  const parties: DraftParty[] =
    existing?.parties && existing.parties.length > 0
      ? existing.parties.map((p) => ({
          ...EMPTY_PARTY,
          ...p,
          tinAutoGenerationExpected:
            p.tinAutoGenerationExpected === true,
        }))
      : [
          { ...EMPTY_PARTY, role: "landlord" },
          { ...EMPTY_PARTY, role: "tenant" },
        ];
  const sched =
    existing?.instrument?.rentSchedule.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
      monthlyRent: String(r.monthlyRent),
    })) ?? [{ startDate: "", endDate: "", monthlyRent: "" }];
  const property = existing?.property;
  const lr = property?.landRegistry;
  return {
    parties,
    instrumentDate: existing?.instrument?.instrumentDate ?? "",
    duplicateCopies:
      typeof existing?.instrument?.duplicateCopies === "number"
        ? String(existing.instrument.duplicateCopies)
        : "0",
    portalInstrumentNameCode:
      existing?.instrument?.portalInstrumentName?.code ?? "",
    portalDescriptionType:
      existing?.instrument?.portalDescriptionType ?? "",
    rentSchedule: sched,
    propertyAddressLine1: property?.addressLine1 ?? "",
    propertyAddressLine2: property?.addressLine2 ?? "",
    propertyPostcode: property?.postcode ?? "",
    propertyCity: property?.city ?? "",
    propertyState: property?.state ?? "",
    propertyCountry: property?.country ?? "Malaysia",
    propertyType: property?.propertyType ?? "",
    buildingType: property?.buildingType ?? "",
    furnishedStatus: property?.furnishedStatus ?? "",
    floor: property?.floor ?? "",
    numberOfFloors:
      typeof property?.numberOfFloors === "number"
        ? String(property.numberOfFloors)
        : "",
    premisesAreaSqm:
      typeof property?.premisesAreaSqm === "number"
        ? String(property.premisesAreaSqm)
        : "",
    premisesAreaIsZeroFallback:
      property?.premisesAreaIsZeroFallback === true,
    landRegistryMilikPenuh: lr?.milikPenuh ?? "",
    landRegistryLot: lr?.lot ?? "",
    landRegistryMukim: lr?.mukim ?? "",
    landRegistryDaerah: lr?.daerah ?? "",
    landRegistryLuas:
      typeof lr?.luas === "number" ? String(lr.luas) : "",
    landRegistryLuasUnit: lr?.luasUnit ?? "",
    landRegistryKegunaan: lr?.kegunaan ?? "",
    // Maklumat Am — seed from persisted state. Each field is
    // independently optional in storage; the draft mirrors that.
    maklumatAmDutyStampCode: existing?.maklumatAm?.dutyStampType?.code ?? "",
    maklumatAmDutyStampLabel: existing?.maklumatAm?.dutyStampType?.label ?? "",
    maklumatAmInstrumentRelationship:
      existing?.maklumatAm?.instrumentRelationship ?? "",
    maklumatAmBalasan:
      typeof existing?.maklumatAm?.balasan === "number"
        ? String(existing.maklumatAm.balasan)
        : "",
    maklumatAmRemissionCode: existing?.maklumatAm?.remission?.code ?? "",
    maklumatAmRemissionLabel: existing?.maklumatAm?.remission?.label ?? "",
    maklumatAmTreatyKmkt: existing?.maklumatAm?.treatyExemption?.kmkt === true,
    maklumatAmTreatyKlnm: existing?.maklumatAm?.treatyExemption?.klnm === true,
    maklumatAmTreatyVienna:
      existing?.maklumatAm?.treatyExemption?.vienna === true,
    operatorNote: existing?.operatorNote ?? "",
  };
}

/**
 * Convert the draft into a JSON body suitable for
 * `validateTenancyPortalDetailsInput`. Strings are trimmed; empty
 * optional fields are dropped; numerics are coerced. The server-side
 * validator is the source of truth for shape correctness — this is
 * just a pre-flight massage.
 */
function buildSavePayload(d: Draft): Record<string, unknown> {
  const parties = d.parties.map((p) => {
    const out: Record<string, unknown> = {
      role: p.role,
      type: p.type,
      nameAsPerInstrument: p.nameAsPerInstrument.trim(),
      addressLine1: p.addressLine1.trim(),
      postcode: p.postcode.trim(),
      city: p.city.trim(),
      state: p.state.trim(),
      country: p.country.trim(),
      mobile: p.mobile.trim(),
    };
    if (p.type === "individual" && p.nationality) {
      out.nationality = p.nationality;
    }
    if (p.identityType) out.identityType = p.identityType;
    if (p.identityNumber && p.identityNumber.trim())
      out.identityNumber = p.identityNumber.trim();
    if (p.tin && p.tin.trim()) out.tin = p.tin.trim();
    if (p.tinAutoGenerationExpected) out.tinAutoGenerationExpected = true;
    if (p.addressLine2 && p.addressLine2.trim())
      out.addressLine2 = p.addressLine2.trim();
    if (p.phone && p.phone.trim()) out.phone = p.phone.trim();

    // ── Bahagian A party identity sub-fields (Milestone A4) ──
    // Only emit fields the operator actually selected/typed. No
    // defaults invented. The server validator accepts partial
    // captures and the readiness gate blocks until complete.
    if (p.citizenshipCategory) out.citizenshipCategory = p.citizenshipCategory;
    if (p.nricSubType) out.nricSubType = p.nricSubType;
    if (p.gender) out.gender = p.gender;
    if (p.rocOld && p.rocOld.trim()) out.rocOld = p.rocOld.trim();
    if (p.rocNew && p.rocNew.trim()) out.rocNew = p.rocNew.trim();
    if (p.businessType?.code && p.businessType.code.trim()) {
      const btOut: Record<string, unknown> = {
        code: p.businessType.code.trim(),
      };
      if (p.businessType.label && p.businessType.label.trim()) {
        btOut.label = p.businessType.label.trim();
      }
      out.businessType = btOut;
    }
    if (p.companyLocality) out.companyLocality = p.companyLocality;
    if (p.companyRepresentative) {
      const r = p.companyRepresentative;
      const repOut: Record<string, unknown> = {};
      if (r.ownerName && r.ownerName.trim())
        repOut.ownerName = r.ownerName.trim();
      if (r.citizenshipCategory)
        repOut.citizenshipCategory = r.citizenshipCategory;
      if (r.identityType) repOut.identityType = r.identityType;
      if (r.identityNumber && r.identityNumber.trim())
        repOut.identityNumber = r.identityNumber.trim();
      if (r.nricSubType) repOut.nricSubType = r.nricSubType;
      if (r.gender) repOut.gender = r.gender;
      if (r.nationality) repOut.nationality = r.nationality;
      if (Object.keys(repOut).length > 0) {
        out.companyRepresentative = repOut;
      }
    }

    if (p.operatorNote && p.operatorNote.trim())
      out.operatorNote = p.operatorNote.trim();
    return out;
  });
  const body: Record<string, unknown> = { parties };

  // Instrument block — only if we have at least an instrument date and
  // a description type. Without the description type we have no idea
  // how to interpret the rent schedule.
  if (d.instrumentDate.trim() && d.portalDescriptionType !== "") {
    const rentSchedule = d.rentSchedule
      .filter((r) => r.startDate.trim() || r.endDate.trim() || r.monthlyRent.trim())
      .map((r) => ({
        startDate: r.startDate.trim(),
        endDate: r.endDate.trim(),
        monthlyRent: Number(r.monthlyRent),
      }));
    const instrumentBody: Record<string, unknown> = {
      instrumentDate: d.instrumentDate.trim(),
      duplicateCopies: Number(d.duplicateCopies || "0"),
      portalDescriptionType: d.portalDescriptionType,
      rentSchedule,
    };
    if (d.portalInstrumentNameCode !== "") {
      // Look up the canonical label for the selected code from the
      // shared option table; the validator normalises labels too,
      // but supplying the canonical label up-front keeps the
      // round-trip stable.
      const opt = INSTRUMENT_NAME_OPTIONS.find(
        (o) => o.code === d.portalInstrumentNameCode
      );
      if (opt) {
        instrumentBody.portalInstrumentName = {
          code: opt.code,
          label: opt.label,
        };
      }
    }
    body.instrument = instrumentBody;
  }

  // Property block — only if we have at least propertyType and address line 1.
  if (d.propertyType !== "" && d.propertyAddressLine1.trim()) {
    const property: Record<string, unknown> = {
      addressLine1: d.propertyAddressLine1.trim(),
      postcode: d.propertyPostcode.trim(),
      city: d.propertyCity.trim(),
      state: d.propertyState.trim(),
      country: d.propertyCountry.trim(),
      propertyType: d.propertyType,
      premisesAreaSqm: Number(d.premisesAreaSqm || "0"),
    };
    if (d.propertyAddressLine2.trim())
      property.addressLine2 = d.propertyAddressLine2.trim();
    if (d.buildingType) property.buildingType = d.buildingType;
    if (d.furnishedStatus) property.furnishedStatus = d.furnishedStatus;
    if (d.floor.trim()) property.floor = d.floor.trim();
    if (d.numberOfFloors.trim()) {
      const n = Number(d.numberOfFloors);
      if (Number.isInteger(n) && n > 0) property.numberOfFloors = n;
    }
    if (d.premisesAreaIsZeroFallback) {
      property.premisesAreaIsZeroFallback = true;
    }

    // Bahagian C · land-registry sub-block.
    //
    // Partial-save semantics (post-A1-review patch): only emit fields
    // the operator has actually filled. Blanks are NOT sent — sending
    // an empty string would cause the server validator to reject the
    // whole save under the old strict-completeness rule and lose the
    // values the operator did fill. The server now accepts partial
    // captures (see `validateTenancyPortalDetailsInput`) and the
    // readiness gate keeps blocking until every required portal
    // field is captured and valid, so partial saves are safe.
    //
    // We deliberately do NOT default `luas` to 0 — that would invent
    // a value the operator never typed. Same rule for every other
    // field. A field is only sent when the operator typed it.
    const lrTextFields = {
      milikPenuh: d.landRegistryMilikPenuh.trim(),
      lot: d.landRegistryLot.trim(),
      mukim: d.landRegistryMukim.trim(),
      daerah: d.landRegistryDaerah.trim(),
    };
    const luasRaw = d.landRegistryLuas.trim();
    const luasNum = luasRaw === "" ? null : Number(luasRaw);
    const luasIsValid =
      luasNum !== null && Number.isFinite(luasNum) && luasNum > 0;
    const luasUnit = d.landRegistryLuasUnit;
    const lrKegunaan = d.landRegistryKegunaan.trim();
    const lrAnyTouched =
      lrTextFields.milikPenuh !== "" ||
      lrTextFields.lot !== "" ||
      lrTextFields.mukim !== "" ||
      lrTextFields.daerah !== "" ||
      luasRaw !== "" ||
      luasUnit !== "" ||
      lrKegunaan !== "";
    if (lrAnyTouched) {
      const lr: Record<string, unknown> = {};
      if (lrTextFields.milikPenuh !== "") lr.milikPenuh = lrTextFields.milikPenuh;
      if (lrTextFields.lot !== "") lr.lot = lrTextFields.lot;
      if (lrTextFields.mukim !== "") lr.mukim = lrTextFields.mukim;
      if (lrTextFields.daerah !== "") lr.daerah = lrTextFields.daerah;
      if (luasIsValid) lr.luas = luasNum;
      if (luasUnit !== "") lr.luasUnit = luasUnit;
      if (lrKegunaan !== "") lr.kegunaan = lrKegunaan;
      // Only attach the sub-block if at least one value made it through.
      // An all-blank touched-but-empty form does not need an empty
      // sub-block on the server.
      if (Object.keys(lr).length > 0) {
        property.landRegistry = lr;
      }
    }

    body.property = property;
  }

  // Maklumat Am sub-block (Milestone A2). Same partial-save rule as
  // landRegistry: only emit fields the operator actually filled. No
  // fabricated defaults. Sub-block omitted entirely if every field
  // is empty / unchecked. Booleans are emitted only when `true` —
  // false / unchecked keys are simply absent.
  const maDutyCode = d.maklumatAmDutyStampCode.trim();
  const maDutyLabel = d.maklumatAmDutyStampLabel.trim();
  const maRel = d.maklumatAmInstrumentRelationship;
  const maBalasanRaw = d.maklumatAmBalasan.trim();
  const maBalasanNum =
    maBalasanRaw === "" ? null : Number(maBalasanRaw);
  const maBalasanIsValid =
    maBalasanNum !== null &&
    Number.isFinite(maBalasanNum) &&
    maBalasanNum > 0;
  const maRemitCode = d.maklumatAmRemissionCode.trim();
  const maRemitLabel = d.maklumatAmRemissionLabel.trim();
  const maAnyTouched =
    maDutyCode !== "" ||
    maRel !== "" ||
    maBalasanRaw !== "" ||
    maRemitCode !== "" ||
    d.maklumatAmTreatyKmkt ||
    d.maklumatAmTreatyKlnm ||
    d.maklumatAmTreatyVienna;
  if (maAnyTouched) {
    const ma: Record<string, unknown> = {};
    if (maDutyCode !== "") {
      const dutyStampType: Record<string, unknown> = { code: maDutyCode };
      if (maDutyLabel !== "") dutyStampType.label = maDutyLabel;
      ma.dutyStampType = dutyStampType;
    }
    if (maRel !== "") ma.instrumentRelationship = maRel;
    if (maBalasanIsValid) ma.balasan = maBalasanNum;
    if (maRemitCode !== "") {
      const remission: Record<string, unknown> = { code: maRemitCode };
      if (maRemitLabel !== "") remission.label = maRemitLabel;
      ma.remission = remission;
    }
    const treaty: Record<string, unknown> = {};
    if (d.maklumatAmTreatyKmkt) treaty.kmkt = true;
    if (d.maklumatAmTreatyKlnm) treaty.klnm = true;
    if (d.maklumatAmTreatyVienna) treaty.vienna = true;
    if (Object.keys(treaty).length > 0) ma.treatyExemption = treaty;
    if (Object.keys(ma).length > 0) body.maklumatAm = ma;
  }

  if (d.operatorNote.trim()) body.operatorNote = d.operatorNote.trim();
  return body;
}

interface PanelProps {
  jobId: string;
  /**
   * Subset of the StampingJob the panel actually needs.
   * - `tenancyPortalDetails` — primary data source.
   * - `storagePath` — drives the Lampiran payload.
   * - `originalFileName` / `mimeType` — surfaced in Lampiran preview.
   * - `documentCategory` — gate (panel only renders for tenancy).
   * - `stampingDetails` — already-calculated duty for Rumusan
   *   preview. The compiler reuses the existing duty value verbatim;
   *   it never recalculates.
   */
  job: Pick<
    StampingJob,
    | "tenancyPortalDetails"
    | "storagePath"
    | "originalFileName"
    | "mimeType"
    | "documentCategory"
    | "stampingDetails"
    | "supervisedRunSession"
  >;
}

export function TenancyPortalPanel({ jobId, job }: PanelProps) {
  const initialReport = useMemo(
    () => evaluateTenancyPortalReadiness(job),
    [job]
  );
  const initialPayload = useMemo(
    () => compileTenancyPortalPayload(job),
    [job]
  );
  const initialInstructionDraft = useMemo(
    () => compileTenancyBrowserInstructions(initialPayload),
    [initialPayload]
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    buildInitialDraft(job.tenancyPortalDetails)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build a synthetic job-input from the live draft so the readiness
  // report and payload preview update in real time as the operator
  // edits. Both the readiness evaluator and the payload compiler
  // accept the same minimal `Pick<>` shape.
  const liveJobInput = useMemo(() => {
    if (!editing) return job;
    const livePayload = buildSavePayload(draft);
    const liveTpd: TenancyPortalDetails = {
      updatedAt: new Date().toISOString(),
      parties: (livePayload.parties as TenancyPortalParty[]) ?? [],
      instrument: livePayload.instrument as
        | TenancyPortalDetails["instrument"]
        | undefined,
      property: livePayload.property as TenancyPortalProperty | undefined,
    };
    return { ...job, tenancyPortalDetails: liveTpd };
  }, [editing, draft, job]);

  const liveReport: TenancyPortalReadinessReport = useMemo(() => {
    if (!editing) return initialReport;
    return evaluateTenancyPortalReadiness(liveJobInput);
  }, [editing, liveJobInput, initialReport]);

  const livePayload: TenancyPortalPayload = useMemo(() => {
    if (!editing) return initialPayload;
    return compileTenancyPortalPayload(liveJobInput);
  }, [editing, liveJobInput, initialPayload]);

  // Browser instruction draft is downstream of the payload — it
  // reuses the same payload object, so cheap to recompile in tandem.
  const liveInstructionDraft: TenancyBrowserInstructionDraft = useMemo(() => {
    if (!editing) return initialInstructionDraft;
    return compileTenancyBrowserInstructions(livePayload);
  }, [editing, livePayload, initialInstructionDraft]);

  // Consolidated readiness gate. Reuses the same `liveJobInput` so
  // the verdict updates live as the operator edits — the gate
  // internally calls the same evaluator / payload / instruction-draft
  // helpers we already render below, but folds them into one verdict
  // for the operator's primary decision point.
  const liveRunReadiness: TenancyPortalRunReadinessReport = useMemo(() => {
    return evaluateTenancyPortalRunReadiness(liveJobInput);
  }, [liveJobInput]);

  // Offline instruction graph (Milestone B-impl Phase 0). The graph
  // is purely planned — no portal contact, no execution. We pass the
  // pre-computed `liveRunReadiness` report so the builder does not
  // re-call the readiness gate; this keeps the readiness verdict and
  // the graph in lockstep as the operator edits.
  const liveInstructionGraph: TenancyInstructionGraph = useMemo(() => {
    return buildTenancyInstructionGraph({
      job: liveJobInput,
      jobId,
      readinessReport: liveRunReadiness,
    });
  }, [jobId, liveJobInput, liveRunReadiness]);

  const liveInstructionGraphPreview: InstructionGraphPreviewViewModel =
    useMemo(
      () => buildInstructionGraphPreviewViewModel(liveInstructionGraph),
      [liveInstructionGraph]
    );

  // Supervised Run Console (Milestone B2). Pure adapter — no portal
  // contact, no execution. Computed last so it has access to the
  // already-derived readiness report + graph + preview.
  const liveSupervisedRunConsole: SupervisedRunConsoleViewModel = useMemo(
    () =>
      buildSupervisedRunConsoleViewModel({
        job: liveJobInput,
        readinessReport: liveRunReadiness,
        graph: liveInstructionGraph,
        graphPreview: liveInstructionGraphPreview,
      }),
    [
      liveJobInput,
      liveRunReadiness,
      liveInstructionGraph,
      liveInstructionGraphPreview,
    ]
  );

  // Bahagian A Party Entry Plan (Milestone B8). Pure helper — no
  // portal contact, no execution, no row save. Updates live as the
  // operator edits party data above. Renders below the supervised-
  // run session card so the operator can see what comes after the
  // Maklumat Am draft save.
  const liveBahagianAPartyPlan: TenancyBahagianAPartyPlan = useMemo(
    () => buildTenancyBahagianAPartyPlan(liveJobInput),
    [liveJobInput]
  );

  // Bahagian A executor-draft bundle (Milestone B9). Pure planner.
  // Emits per-role planned step lists from the live B9-evidenced
  // selectors / option codes captured in the field-mapping registry.
  // Plans never include a click on the modal Simpan button; the
  // bundle's `bundleStatus` aggregates per-role readiness.
  const liveBahagianAExecutorDraft: BahagianAExecutorDraftBundle = useMemo(
    () =>
      buildBahagianAExecutorDraftBundle({
        ...job,
        ...liveJobInput,
      } as StampingJob),
    [job, liveJobInput]
  );

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body = buildSavePayload(draft);
      const res = await fetch(
        `/api/intake/${jobId}/tenancy-portal-details`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // ignore JSON parse error; keep HTTP code
        }
        throw new Error(msg);
      }
      // Reload so the server-rendered shell + downstream readiness
      // checks pick up the freshly persisted value.
      window.location.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      setSaving(false);
    }
  }

  function updatePartyField<K extends keyof DraftParty>(
    idx: number,
    key: K,
    value: DraftParty[K]
  ): void {
    setDraft((d) => {
      const parties = d.parties.slice();
      parties[idx] = { ...parties[idx], [key]: value };
      return { ...d, parties };
    });
  }

  function addParty(role: TenancyPortalPartyRole) {
    setDraft((d) => ({
      ...d,
      parties: [...d.parties, { ...EMPTY_PARTY, role }],
    }));
  }

  function removeParty(idx: number) {
    setDraft((d) => ({
      ...d,
      parties: d.parties.filter((_, i) => i !== idx),
    }));
  }

  function updateRentRow(idx: number, key: keyof DraftRentPeriod, value: string) {
    setDraft((d) => {
      const rentSchedule = d.rentSchedule.slice();
      rentSchedule[idx] = { ...rentSchedule[idx], [key]: value };
      return { ...d, rentSchedule };
    });
  }

  function addRentRow() {
    setDraft((d) => ({
      ...d,
      rentSchedule: [
        ...d.rentSchedule,
        { startDate: "", endDate: "", monthlyRent: "" },
      ],
    }));
  }

  function removeRentRow(idx: number) {
    setDraft((d) => ({
      ...d,
      rentSchedule: d.rentSchedule.filter((_, i) => i !== idx),
    }));
  }

  return (
    <section
      id="tenancy-portal-required"
      className="tpr-panel"
      aria-label="Tenancy Portal Required Details — internal operator capture"
    >
      <header className="tpr-panel-header">
        <h2>Tenancy Portal Required Details</h2>
        {/* Narrower badge: reflects only the legacy required-details
            layer (parties / instrument / property fields). It does
            NOT speak to the field-mapping safety gaps surfaced by
            the consolidated Portal Run Readiness section above. */}
        <span
          className={`tpr-overall tpr-overall-${liveReport.overall}`}
          title={`evaluated ${liveReport.evaluatedAt}`}
        >
          {liveReport.overall === "ready"
            ? "Required-details captured"
            : "Required-details blocked"}
        </span>
      </header>
      <p className="tpr-intro">
        Internal operator view. Captures the structured Sewa/Pajakan
        fields that the e-Duti Setem portal needs. Not surfaced to the
        user. No portal action runs from this panel.
      </p>

      {/* ── Portal Run Readiness (consolidated verdict) ──────────
          Single decision-point block that folds the three existing
          layers (required-details readiness, payload compiler,
          instruction-draft compiler) plus the source-PDF check into
          one verdict the operator can act on. Sits ABOVE the
          existing gap / payload / instruction-draft previews — those
          remain intact below for detail. */}
      <RunReadinessSummary report={liveRunReadiness} />

      {/* ── Instruction Graph Preview (Milestone B1) ─────────────
          Operator-side, read-only preview of the offline instruction
          graph (Milestone B-impl Phase 0). Displays planned phases,
          per-phase mutation level / step count / operator-gate flag,
          and the canonical 5 operator-gate labels. The graph never
          executes; this preview is design-only. All wording is
          sourced from the pure preview helper, never composed
          inline, so the sensitive-data and forbidden-wording
          invariants tested in
          `tenancy-instruction-graph-preview.test.ts` apply to the
          rendered surface verbatim. */}
      <InstructionGraphPreview viewModel={liveInstructionGraphPreview} />

      {/* ── Supervised Run Console (Milestone B2) ────────────────
          Operator-facing, non-mutating console that prepares the
          internal run plan for a future supervised e-Duti Setem
          session. Reuses the readiness report + offline instruction
          graph + preview view-model computed above; it does not
          recompute readiness or rebuild the graph. The console is
          design-only: it renders an eligibility verdict, a graph
          summary, an 8-item preflight checklist, and a blocked
          summary when applicable. It NEVER renders a Start / Submit
          / Execute / Send / Pay / Upload-to-portal / Hantar
          affordance. */}
      <SupervisedRunConsole viewModel={liveSupervisedRunConsole} />

      {/* ── Browser Session Status (Milestone B4) ────────────────
          Operator-side, read-only card that calls the local
          operator API route /api/operator/cdp-inspect to inspect
          whether the operator's existing Chrome session is
          positioned correctly for the planned supervised run. The
          API route delegates to the B3 read-only inspector; no
          portal mutation, no field fill, no upload, no submission
          ever runs from this card. */}
      <BrowserSessionStatusCard />

      {/* ── Supervised Run Session (Milestone B6) ────────────────
          Operator-side internal control surface for the
          supervised-run lifecycle. Calls the operator-protected
          /api/intake/[id]/supervised-run/prepare and
          /api/intake/[id]/supervised-run/approve-first-mutation
          routes. Records WeStamp's internal readiness to begin a
          future supervised portal run; never executes any portal
          action. The "Approve First Portal Mutation" button writes
          an internal flag only — the next milestone is required
          before WeStamp can create a portal draft. */}
      <SupervisedRunSessionCard
        jobId={jobId}
        initialState={job.supervisedRunSession ?? null}
      />

      {/* ── Bahagian A Party Entry Plan (Milestone B8 + B9) ──────
          Internal preview of the next supervised execution phase.
          Pure planning surface — no portal contact, no row save,
          no Hantar / payment / certificate action. Updates live as
          the operator edits party data above. The B9 patch adds
          the executor-draft bundle showing observed modal selectors,
          per-role trigger observation, and overall executor-draft
          status. */}
      <BahagianAPartyEntryPlanCard
        plan={liveBahagianAPartyPlan}
        executorDraft={liveBahagianAExecutorDraft}
      />

      {/* ── Readiness summary counts ────────────────────────────── */}
      <div className="tpr-summary">
        <span className="tpr-summary-cell tpr-summary-ready">
          Ready: <strong>{liveReport.summary.ready}</strong>
        </span>
        <span className="tpr-summary-cell tpr-summary-missing">
          Missing: <strong>{liveReport.summary.missing}</strong>
        </span>
        <span className="tpr-summary-cell tpr-summary-conditional">
          Conditional: <strong>{liveReport.summary.conditional_missing}</strong>
        </span>
        <span className="tpr-summary-cell tpr-summary-fallback">
          Fallback: <strong>{liveReport.summary.operator_fallback}</strong>
        </span>
      </div>

      {/* ── Gap preview table ──────────────────────────────────── */}
      <details className="tpr-gap-disclosure" open>
        <summary>Portal execution payload / gap preview</summary>
        <div className="tpr-table-wrap">
          <table className="tpr-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Field</th>
                <th>Current value</th>
                <th>State</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {liveReport.fields.map((f) => (
                <tr key={f.fieldKey} className={`tpr-row tpr-row-${f.state}`}>
                  <td>
                    <span className="tpr-section-tag">
                      {SECTION_LABELS[f.section]}
                    </span>
                  </td>
                  <td>
                    {f.label}
                    {f.portalMeaning && (
                      <span className="tpr-portal-meaning">
                        {" — "}
                        {f.portalMeaning}
                      </span>
                    )}
                  </td>
                  <td>
                    {f.currentValue ? (
                      <span className="tpr-current-value">
                        {f.currentValue}
                      </span>
                    ) : (
                      <span className="tpr-no-value">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`tpr-state-badge tpr-state-${f.state}`}
                    >
                      {STATE_LABELS[f.state]}
                    </span>
                  </td>
                  <td>
                    {f.notes ? (
                      <span className="tpr-note">{f.notes}</span>
                    ) : (
                      <span className="tpr-no-value">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* ── Portal payload preview ─────────────────────────────
          Shows the structured payload WeStamp would send to e-Duti
          Setem if the job were ready, section by section. Distinct
          from the gap preview above: that one answers "what is
          missing"; this one answers "what would be sent". Updates
          live as the operator edits. */}
      <PayloadPreview payload={livePayload} />

      {/* ── Browser instruction draft preview ──────────────────
          Non-mutating, non-executable draft of the browser steps
          WeStamp would perform later on the e-Duti Setem
          Sewa/Pajakan flow. Distinct from the payload preview
          above: that one answers "what would be sent"; this one
          answers "how would those values be filled in". Compiled
          in-memory only — never saved to the job, never executed,
          never sends anything to the portal. */}
      <InstructionDraftPreview draft={liveInstructionDraft} />

      {/* ── Edit form ──────────────────────────────────────────── */}
      <div className="tpr-edit-toggle">
        {!editing ? (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setEditing(true)}
          >
            {job.tenancyPortalDetails ? "Edit details" : "Capture details"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setEditing(false);
              setDraft(buildInitialDraft(job.tenancyPortalDetails));
              setSaveError(null);
            }}
            disabled={saving}
          >
            Cancel
          </button>
        )}
      </div>

      {editing && (
        <div className="tpr-form">
          {/* ── Bahagian A — Parties ─────────────────────────── */}
          <div className="tpr-form-section">
            <div className="tpr-form-section-header">
              <h3>Bahagian A — Parties</h3>
              <div className="tpr-form-section-add">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => addParty("landlord")}
                >
                  + Add landlord
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => addParty("tenant")}
                >
                  + Add tenant
                </button>
              </div>
            </div>
            {draft.parties.map((p, idx) => (
              <div key={idx} className="tpr-party-card">
                <div className="tpr-party-card-header">
                  <strong>
                    {p.role === "landlord" ? "Landlord" : "Tenant"} #{idx + 1}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeParty(idx)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
                <div className="tpr-grid">
                  <Field label="Role">
                    <select
                      value={p.role}
                      onChange={(e) =>
                        updatePartyField(
                          idx,
                          "role",
                          e.target.value as TenancyPortalPartyRole
                        )
                      }
                    >
                      <option value="landlord">Landlord</option>
                      <option value="tenant">Tenant</option>
                    </select>
                  </Field>
                  <Field label="Type">
                    <select
                      value={p.type}
                      onChange={(e) =>
                        updatePartyField(
                          idx,
                          "type",
                          e.target.value as TenancyPortalPartyType
                        )
                      }
                    >
                      <option value="individual">Individual</option>
                      <option value="company_ssm">Company / SSM-registered</option>
                      <option value="company_non_ssm">
                        Company / Not SSM-registered
                      </option>
                    </select>
                  </Field>
                  <Field label="Name as per instrument">
                    <input
                      type="text"
                      value={p.nameAsPerInstrument}
                      onChange={(e) =>
                        updatePartyField(
                          idx,
                          "nameAsPerInstrument",
                          e.target.value
                        )
                      }
                    />
                  </Field>
                  {p.type === "individual" && (
                    <Field label="Nationality">
                      <select
                        value={p.nationality ?? ""}
                        onChange={(e) =>
                          updatePartyField(
                            idx,
                            "nationality",
                            (e.target.value as TenancyPortalNationality) || null
                          )
                        }
                      >
                        <option value="">— select —</option>
                        <option value="malaysian">Malaysian</option>
                        <option value="non_malaysian">Non-Malaysian</option>
                      </select>
                    </Field>
                  )}
                  <Field label="ID type">
                    <select
                      value={p.identityType ?? ""}
                      onChange={(e) =>
                        updatePartyField(
                          idx,
                          "identityType",
                          (e.target.value as TenancyPortalIdentityType) ||
                            undefined
                        )
                      }
                    >
                      <option value="">— select —</option>
                      <option value="nric">NRIC</option>
                      <option value="passport">Passport</option>
                      <option value="company_registration">
                        Company registration
                      </option>
                    </select>
                  </Field>
                  <Field label="ID number">
                    <input
                      type="text"
                      value={p.identityNumber ?? ""}
                      onChange={(e) =>
                        updatePartyField(idx, "identityNumber", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="TIN (optional)">
                    <input
                      type="text"
                      value={p.tin ?? ""}
                      onChange={(e) =>
                        updatePartyField(idx, "tin", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="TIN auto-generated by MyTax?">
                    <label className="tpr-checkbox-inline">
                      <input
                        type="checkbox"
                        checked={p.tinAutoGenerationExpected}
                        onChange={(e) =>
                          updatePartyField(
                            idx,
                            "tinAutoGenerationExpected",
                            e.target.checked
                          )
                        }
                      />
                      Yes
                    </label>
                  </Field>
                  <Field label="Address line 1">
                    <input
                      type="text"
                      value={p.addressLine1}
                      onChange={(e) =>
                        updatePartyField(idx, "addressLine1", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Address line 2 (optional)">
                    <input
                      type="text"
                      value={p.addressLine2 ?? ""}
                      onChange={(e) =>
                        updatePartyField(idx, "addressLine2", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Postcode">
                    <input
                      type="text"
                      value={p.postcode}
                      onChange={(e) =>
                        updatePartyField(idx, "postcode", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="City">
                    <input
                      type="text"
                      value={p.city}
                      onChange={(e) =>
                        updatePartyField(idx, "city", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="State">
                    <input
                      type="text"
                      value={p.state}
                      onChange={(e) =>
                        updatePartyField(idx, "state", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Country">
                    <input
                      type="text"
                      value={p.country}
                      onChange={(e) =>
                        updatePartyField(idx, "country", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Mobile">
                    <input
                      type="text"
                      value={p.mobile}
                      onChange={(e) =>
                        updatePartyField(idx, "mobile", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Phone (optional)">
                    <input
                      type="text"
                      value={p.phone ?? ""}
                      onChange={(e) =>
                        updatePartyField(idx, "phone", e.target.value)
                      }
                    />
                  </Field>
                </div>

                {/* ── Bahagian A Party Identity Fields (Milestone A4) ──
                    Captures the portal-required identity sub-fields
                    discovered during the ε-3 supervised field-mapping
                    run. Internal operator capture only — NOT a
                    public review page. */}
                <div className="tpr-form-subsection">
                  <h4>Bahagian A Party Identity Fields</h4>
                  <p className="tpr-form-helper">
                    These fields were observed during the
                    Sewa/Pajakan field-mapping run and are required
                    before WeStamp can truthfully prepare a
                    supervised portal run.
                  </p>
                  {p.type === "individual" ? (
                    <div className="tpr-grid">
                      <Field label="Citizenship · Warga (warga)">
                        <select
                          value={p.citizenshipCategory ?? ""}
                          onChange={(e) =>
                            updatePartyField(
                              idx,
                              "citizenshipCategory",
                              (e.target.value as
                                | TenancyPortalCitizenshipCategory
                                | "") || undefined
                            )
                          }
                        >
                          <option value="">— select —</option>
                          <option value="citizen">Citizen</option>
                          <option value="non_citizen">Non-citizen</option>
                          <option value="permanent_resident">
                            Permanent Resident
                          </option>
                        </select>
                        <span className="tpr-field-helper-note">
                          Required. Never inferred from nationality.
                        </span>
                      </Field>
                      <Field label="Gender (USER_SEX)">
                        <select
                          value={p.gender ?? ""}
                          onChange={(e) =>
                            updatePartyField(
                              idx,
                              "gender",
                              (e.target.value as TenancyPortalGender | "") ||
                                undefined
                            )
                          }
                        >
                          <option value="">— select —</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                        <span className="tpr-field-helper-note">
                          Required. Never inferred from name or IC
                          number.
                        </span>
                      </Field>
                      {p.identityType === "nric" && (
                        <Field label="NRIC sub-type (EPD_NOKP_TYPE)">
                          <select
                            value={p.nricSubType ?? ""}
                            onChange={(e) =>
                              updatePartyField(
                                idx,
                                "nricSubType",
                                (e.target.value as
                                  | TenancyPortalNricSubType
                                  | "") || undefined
                              )
                            }
                          >
                            <option value="">— select —</option>
                            <option value="ic_baru">
                              IC Baru (post-1990)
                            </option>
                            <option value="ic_lama">
                              IC Lama (pre-1990)
                            </option>
                            <option value="ic_polis">IC Polis</option>
                            <option value="ic_army">IC Army (Tentera)</option>
                          </select>
                          <span className="tpr-field-helper-note">
                            Required when identity type is NRIC.
                            Never inferred from IC number.
                          </span>
                        </Field>
                      )}
                    </div>
                  ) : null}
                  {p.type === "company_ssm" ? (
                    <>
                      <div className="tpr-grid">
                        <Field label="Old ROC (tb_roc)">
                          <input
                            type="text"
                            value={p.rocOld ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "rocOld", e.target.value)
                            }
                            placeholder="Pre-2017 ROC number"
                          />
                        </Field>
                        <Field label="New ROC (tb_roc_new)">
                          <input
                            type="text"
                            value={p.rocNew ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "rocNew", e.target.value)
                            }
                            placeholder="Post-2017 ROC number"
                          />
                          <span className="tpr-field-helper-note">
                            Capture either old or new ROC. WeStamp
                            never fabricates one from the other.
                          </span>
                        </Field>
                        <Field label="Business type code (jenis_perniagaan)">
                          <input
                            type="text"
                            value={p.businessType?.code ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "businessType", {
                                code: e.target.value,
                                label: p.businessType?.label,
                              })
                            }
                            placeholder="Portal option code"
                          />
                          <span className="tpr-field-helper-note">
                            6-option dropdown observed; full enum not
                            yet catalogued. Required.
                          </span>
                        </Field>
                        <Field label="Business type label (optional)">
                          <input
                            type="text"
                            value={p.businessType?.label ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "businessType", {
                                code: p.businessType?.code ?? "",
                                label: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Company locality (tb_syarikat)">
                          <select
                            value={p.companyLocality ?? ""}
                            onChange={(e) =>
                              updatePartyField(
                                idx,
                                "companyLocality",
                                (e.target.value as
                                  | TenancyPortalCompanyLocality
                                  | "") || undefined
                              )
                            }
                          >
                            <option value="">— select —</option>
                            <option value="local_company">
                              Local company
                            </option>
                            <option value="foreign_company">
                              Foreign company
                            </option>
                          </select>
                          <span className="tpr-field-helper-note">
                            Required. Never inferred from country.
                          </span>
                        </Field>
                      </div>
                      <h5>SSM Representative Identity</h5>
                      <p className="tpr-form-helper">
                        Natural-person identity captured by the SSM
                        Tambah modal alongside the company entity.
                      </p>
                      <div className="tpr-grid">
                        <Field label="Representative name (owner_name)">
                          <input
                            type="text"
                            value={p.companyRepresentative?.ownerName ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "companyRepresentative", {
                                ...(p.companyRepresentative ?? {}),
                                ownerName: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Representative citizenship (warga)">
                          <select
                            value={
                              p.companyRepresentative?.citizenshipCategory ??
                              ""
                            }
                            onChange={(e) =>
                              updatePartyField(idx, "companyRepresentative", {
                                ...(p.companyRepresentative ?? {}),
                                citizenshipCategory:
                                  (e.target.value as
                                    | TenancyPortalCitizenshipCategory
                                    | "") || undefined,
                              })
                            }
                          >
                            <option value="">— select —</option>
                            <option value="citizen">Citizen</option>
                            <option value="non_citizen">Non-citizen</option>
                            <option value="permanent_resident">
                              Permanent Resident
                            </option>
                          </select>
                        </Field>
                        <Field label="Representative identity type">
                          <select
                            value={
                              p.companyRepresentative?.identityType ?? ""
                            }
                            onChange={(e) =>
                              updatePartyField(idx, "companyRepresentative", {
                                ...(p.companyRepresentative ?? {}),
                                identityType:
                                  (e.target.value as
                                    | TenancyPortalIdentityType
                                    | "") || undefined,
                              })
                            }
                          >
                            <option value="">— select —</option>
                            <option value="nric">NRIC</option>
                            <option value="passport">Passport</option>
                          </select>
                        </Field>
                        <Field label="Representative identity number">
                          <input
                            type="text"
                            value={
                              p.companyRepresentative?.identityNumber ?? ""
                            }
                            onChange={(e) =>
                              updatePartyField(idx, "companyRepresentative", {
                                ...(p.companyRepresentative ?? {}),
                                identityNumber: e.target.value,
                              })
                            }
                          />
                        </Field>
                        {p.companyRepresentative?.identityType === "nric" && (
                          <Field label="Representative NRIC sub-type (EPD_NOKP_TYPE)">
                            <select
                              value={
                                p.companyRepresentative?.nricSubType ?? ""
                              }
                              onChange={(e) =>
                                updatePartyField(
                                  idx,
                                  "companyRepresentative",
                                  {
                                    ...(p.companyRepresentative ?? {}),
                                    nricSubType:
                                      (e.target.value as
                                        | TenancyPortalNricSubType
                                        | "") || undefined,
                                  }
                                )
                              }
                            >
                              <option value="">— select —</option>
                              <option value="ic_baru">IC Baru</option>
                              <option value="ic_lama">IC Lama</option>
                              <option value="ic_polis">IC Polis</option>
                              <option value="ic_army">IC Army</option>
                            </select>
                          </Field>
                        )}
                        <Field label="Representative gender (USER_SEX)">
                          <select
                            value={p.companyRepresentative?.gender ?? ""}
                            onChange={(e) =>
                              updatePartyField(idx, "companyRepresentative", {
                                ...(p.companyRepresentative ?? {}),
                                gender:
                                  (e.target.value as
                                    | TenancyPortalGender
                                    | "") || undefined,
                              })
                            }
                          >
                            <option value="">— select —</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </Field>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* ── Bahagian B — Instrument & Rent ───────────────── */}
          <div className="tpr-form-section">
            <h3>Bahagian B — Instrument & Rent</h3>
            <div className="tpr-grid">
              <Field label="Instrument date (Tarikh Surat Cara)">
                <input
                  type="date"
                  value={draft.instrumentDate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, instrumentDate: e.target.value }))
                  }
                />
              </Field>
              <Field label="Duplicate copies">
                <input
                  type="number"
                  min={0}
                  value={draft.duplicateCopies}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      duplicateCopies: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Instrument name (Bahagian B · pds_suratcara)">
                <select
                  value={draft.portalInstrumentNameCode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      portalInstrumentNameCode: e.target.value as
                        | TenancyPortalInstrumentNameCode
                        | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  {INSTRUMENT_NAME_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.code} · {opt.label}
                    </option>
                  ))}
                </select>
                <span className="tpr-field-helper-note">
                  Distinct from pds_jenis. Hantar gate 1 portal field.
                  Today the documented option list contains a single
                  entry — additional codes will be added as further
                  live-walk evidence is captured.
                </span>
              </Field>
              <Field label="Instrument description (Bahagian B · pds_jenis)">
                <select
                  value={draft.portalDescriptionType}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      portalDescriptionType: e.target.value as
                        | TenancyPortalDescriptionType
                        | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  {DESCRIPTION_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {(() => {
                  // When the operator picks an unsupported portal
                  // option (anything other than fixed_rent or
                  // variable_rent), show an inline note so the choice
                  // is not silently treated as automation-ready.
                  const selected = DESCRIPTION_TYPE_OPTIONS.find(
                    (o) => o.value === draft.portalDescriptionType
                  );
                  if (!selected?.note) return null;
                  return (
                    <span className="tpr-field-helper-note">
                      {selected.note}
                    </span>
                  );
                })()}
              </Field>
            </div>

            <div className="tpr-rent-schedule">
              <div className="tpr-form-section-header">
                <h4>Rent schedule</h4>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={addRentRow}
                >
                  + Add period
                </button>
              </div>
              {draft.rentSchedule.map((row, idx) => (
                <div key={idx} className="tpr-rent-row">
                  <Field label={`Period ${idx + 1} — start`}>
                    <input
                      type="date"
                      value={row.startDate}
                      onChange={(e) =>
                        updateRentRow(idx, "startDate", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="end">
                    <input
                      type="date"
                      value={row.endDate}
                      onChange={(e) =>
                        updateRentRow(idx, "endDate", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="monthly rent (RM)">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.monthlyRent}
                      onChange={(e) =>
                        updateRentRow(idx, "monthlyRent", e.target.value)
                      }
                    />
                  </Field>
                  {draft.rentSchedule.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeRentRow(idx)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Bahagian C — Property ────────────────────────── */}
          <div className="tpr-form-section">
            <h3>Bahagian C — Property</h3>
            <div className="tpr-grid">
              <Field label="Address line 1">
                <input
                  type="text"
                  value={draft.propertyAddressLine1}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      propertyAddressLine1: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Address line 2 (optional)">
                <input
                  type="text"
                  value={draft.propertyAddressLine2}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      propertyAddressLine2: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Postcode">
                <input
                  type="text"
                  value={draft.propertyPostcode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      propertyPostcode: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="City">
                <input
                  type="text"
                  value={draft.propertyCity}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, propertyCity: e.target.value }))
                  }
                />
              </Field>
              <Field label="State">
                <input
                  type="text"
                  value={draft.propertyState}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, propertyState: e.target.value }))
                  }
                />
              </Field>
              <Field label="Country">
                <input
                  type="text"
                  value={draft.propertyCountry}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      propertyCountry: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Property type (Jenis Harta)">
                <select
                  value={draft.propertyType}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      propertyType: e.target.value as
                        | TenancyPortalPropertyType
                        | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  <option value="kediaman">Kediaman</option>
                  <option value="perdagangan">Perdagangan</option>
                  <option value="perindustrian">Perindustrian</option>
                  <option value="tanah_kosong">Tanah Kosong</option>
                </select>
              </Field>
              <Field label="Building type (Jenis Bangunan)">
                <select
                  value={draft.buildingType}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      buildingType: e.target.value as
                        | TenancyPortalBuildingType
                        | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  <option value="rumah_teres">Rumah Teres</option>
                  <option value="rumah_banglo">Rumah Banglo</option>
                  <option value="rumah_berkembar">Rumah Berkembar</option>
                  <option value="rumah_kluster">Rumah Kluster</option>
                  <option value="townhouse">Townhouse</option>
                  <option value="apartment">Apartment</option>
                  <option value="kondominium">Kondominium</option>
                  <option value="studio">Studio</option>
                  <option value="lain_lain">Lain-lain</option>
                </select>
              </Field>
              <Field label="Furnished status (Perabot)">
                <select
                  value={draft.furnishedStatus}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      furnishedStatus: e.target.value as
                        | TenancyPortalFurnishedStatus
                        | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  <option value="fully_furnished">Fully furnished</option>
                  <option value="partially_furnished">
                    Partially furnished
                  </option>
                  <option value="unfurnished">Unfurnished</option>
                </select>
              </Field>
              <Field label="Floor / level (optional)">
                <input
                  type="text"
                  value={draft.floor}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, floor: e.target.value }))
                  }
                />
              </Field>
              <Field label="Number of floors (optional)">
                <input
                  type="number"
                  min={1}
                  value={draft.numberOfFloors}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      numberOfFloors: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Premises area (m²)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.premisesAreaSqm}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      premisesAreaSqm: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="0 area is explicit operator fallback">
                <label className="tpr-checkbox-inline">
                  <input
                    type="checkbox"
                    checked={draft.premisesAreaIsZeroFallback}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        premisesAreaIsZeroFallback: e.target.checked,
                      }))
                    }
                  />
                  Confirm — instrument has no value
                </label>
              </Field>
            </div>

            {/* ── Bahagian C · Land-Registry Fields ──────────────
                Milestone A1 (2026-04-29). Captures the seven
                Bahagian C land-registry portal fields discovered
                during the ε-3 supervised field-mapping run. Six
                are required; pds_kegunaan is optional. Internal
                operator capture only — NOT a public review page.

                NOTE: pds_luas (land-title area) is intentionally
                separate from the Premises area (Luas Premis) above.
                The portal treats them as different fields and
                WeStamp must not auto-fill one from the other. */}
            <div className="tpr-form-subsection">
              <h4>Bahagian C Land-Registry Fields</h4>
              <p className="tpr-form-helper">
                These fields were observed during the Sewa/Pajakan
                field-mapping run and are required before WeStamp can
                truthfully prepare a supervised portal run.
              </p>
              <div className="tpr-grid">
                <Field label="Milik Penuh (pds_mp)">
                  <input
                    type="text"
                    value={draft.landRegistryMilikPenuh}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryMilikPenuh: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Lot number (pds_lot)">
                  <input
                    type="text"
                    value={draft.landRegistryLot}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryLot: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Mukim (pds_mukim)">
                  <input
                    type="text"
                    value={draft.landRegistryMukim}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryMukim: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Daerah (pds_daerah)">
                  <input
                    type="text"
                    value={draft.landRegistryDaerah}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryDaerah: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Land area · Luas Tanah (pds_luas)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.landRegistryLuas}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryLuas: e.target.value,
                      }))
                    }
                  />
                  <span className="tpr-field-helper-note">
                    Land-title area. Distinct from Premises area
                    (Luas Premis) above — never auto-filled from it.
                    Must be a positive number.
                  </span>
                </Field>
                <Field label="Land-area unit (pds_luasunit)">
                  <select
                    value={draft.landRegistryLuasUnit}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryLuasUnit: e.target.value as
                          | TenancyPortalLandAreaUnit
                          | "",
                      }))
                    }
                  >
                    <option value="">— select —</option>
                    <option value="ekar">
                      {TENANCY_PORTAL_LAND_AREA_UNIT_LABELS.ekar}
                    </option>
                    <option value="hektar">
                      {TENANCY_PORTAL_LAND_AREA_UNIT_LABELS.hektar}
                    </option>
                    <option value="kps">
                      {TENANCY_PORTAL_LAND_AREA_UNIT_LABELS.kps}
                    </option>
                    <option value="mps">
                      {TENANCY_PORTAL_LAND_AREA_UNIT_LABELS.mps}
                    </option>
                  </select>
                </Field>
                <Field label="Property usage (pds_kegunaan, optional)">
                  <input
                    type="text"
                    value={draft.landRegistryKegunaan}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        landRegistryKegunaan: e.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* ── Maklumat Am Portal Fields ─────────────────────
              Milestone A2 (2026-04-29). Captures the Maklumat Am
              portal metadata observed during the ε-3 supervised
              field-mapping run. Internal operator capture only —
              NOT a public review page.

              NOTE: pds_balasan is captured as a separate operator
              entry. WeStamp NEVER auto-fills it from the rent
              schedule — the portal treats it as a distinct field.

              NOTE: pds_radio_ya / pds_radio_tidak are observed in
              the portal DOM but the field-mapping run did not
              confirm what they control. They are intentionally
              NOT captured until mapped. */}
          <div className="tpr-form-section">
            <h3>Maklumat Am Portal Fields</h3>
            <p className="tpr-form-helper">
              These fields were observed during the Sewa/Pajakan
              field-mapping run and are captured separately from the
              tenancy rent schedule and property details.
            </p>
            <div className="tpr-grid">
              <Field label="Duty type · Jenis Duti Setem (pds_dutisetem)">
                <input
                  type="text"
                  value={draft.maklumatAmDutyStampCode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmDutyStampCode: e.target.value,
                    }))
                  }
                  placeholder="Portal option code"
                />
                <span className="tpr-field-helper-note">
                  17-option dropdown observed; full enum not yet
                  catalogued. Enter the portal option value (e.g.
                  the numeric code shown in the portal HTML).
                </span>
              </Field>
              <Field label="Duty type label (optional)">
                <input
                  type="text"
                  value={draft.maklumatAmDutyStampLabel}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmDutyStampLabel: e.target.value,
                    }))
                  }
                  placeholder="e.g. Sewa / Pajakan"
                />
              </Field>
              <Field label="Instrument relationship (pds_ps)">
                <select
                  value={draft.maklumatAmInstrumentRelationship}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmInstrumentRelationship: e.target
                        .value as TenancyPortalInstrumentRelationship | "",
                    }))
                  }
                >
                  <option value="">— select —</option>
                  <option value="principal">
                    {TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_LABELS.principal} (p)
                  </option>
                  <option value="related_lease_49e">
                    {
                      TENANCY_PORTAL_INSTRUMENT_RELATIONSHIP_LABELS.related_lease_49e
                    }{" "}
                    (s)
                  </option>
                </select>
              </Field>
              <Field label="Consideration · Balasan (pds_balasan)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.maklumatAmBalasan}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmBalasan: e.target.value,
                    }))
                  }
                />
                <span className="tpr-field-helper-note">
                  Operator-supplied consideration / premium amount.
                  Never auto-derived from the rent schedule. Required
                  only for portal paths where WeStamp has evidence
                  that Balasan is mandatory; otherwise captured when
                  applicable. Must be a positive number when supplied.
                </span>
              </Field>
              <Field label="Remission code (pds_remit, optional)">
                <input
                  type="text"
                  value={draft.maklumatAmRemissionCode}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmRemissionCode: e.target.value,
                    }))
                  }
                  placeholder="Portal option code"
                />
                <span className="tpr-field-helper-note">
                  16-option dropdown observed; full enum not yet
                  catalogued. Optional in this milestone.
                </span>
              </Field>
              <Field label="Remission label (optional)">
                <input
                  type="text"
                  value={draft.maklumatAmRemissionLabel}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maklumatAmRemissionLabel: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Treaty / diplomatic exemption flags (pds_perjanjian)">
                <div className="tpr-checkbox-group">
                  <label className="tpr-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={draft.maklumatAmTreatyKmkt}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          maklumatAmTreatyKmkt: e.target.checked,
                        }))
                      }
                    />
                    kmkt
                  </label>
                  <label className="tpr-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={draft.maklumatAmTreatyKlnm}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          maklumatAmTreatyKlnm: e.target.checked,
                        }))
                      }
                    />
                    klnm
                  </label>
                  <label className="tpr-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={draft.maklumatAmTreatyVienna}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          maklumatAmTreatyVienna: e.target.checked,
                        }))
                      }
                    />
                    vienna
                  </label>
                </div>
                <span className="tpr-field-helper-note">
                  Optional. Unchecked is the normal case — never
                  blocks readiness.
                </span>
              </Field>
            </div>
          </div>

          <div className="tpr-form-actions">
            {saveError && (
              <p className="field-error" role="alert">
                {saveError}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save tenancy portal details"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="tpr-field">
      <span className="tpr-field-label">{label}</span>
      {children}
    </label>
  );
}

// ─── Portal payload preview ────────────────────────────────────────

const PAYLOAD_SECTION_LABELS: Record<
  TenancyPortalPayload["sectionReadiness"][number]["section"],
  string
> = {
  bahagian_a: "Bahagian A · Parties",
  bahagian_b: "Bahagian B · Instrument & Rent",
  bahagian_c: "Bahagian C · Property",
  rumusan: "Rumusan Pengiraan",
  lampiran: "Lampiran",
  perakuan: "Perakuan",
};

const RENT_MODE_LABELS: Record<
  TenancyPortalPayload["bahagianB"]["rentScheduleMode"],
  string
> = {
  fixed: "Fixed (single period)",
  variable: "Variable (multiple periods)",
  unsupported: "Unsupported (current automation cannot represent this)",
  not_yet_selected: "Not yet selected",
};

function formatRm(value: number | null): string {
  if (value === null) return "—";
  return `RM ${value.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatScalar(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return String(v);
  return v.trim() === "" ? "—" : v;
}

function PayloadPreview({ payload }: { payload: TenancyPortalPayload }) {
  const a = payload.bahagianA;
  const b = payload.bahagianB;
  const c = payload.bahagianC;
  return (
    <section
      className="tpr-payload-preview"
      aria-label="Tenancy portal payload preview"
    >
      <header className="tpr-payload-header">
        <h3>Portal Payload Preview</h3>
        {/* Narrower badge: speaks only to the structural shape of
            the compiled payload — does NOT mean the run is safe to
            execute. The consolidated Portal Run Readiness section
            above is the only place a true "ready for supervised
            portal run" verdict appears. */}
        <span
          className={`tpr-overall tpr-overall-${payload.overall}`}
          title={`generated ${payload.generatedAt}`}
        >
          {payload.overall === "ready"
            ? "Payload structurally ready"
            : "Payload blocked"}
        </span>
      </header>
      <p className="tpr-payload-intro">
        What WeStamp would send to e-Duti Setem, section by section,
        if the job were portal-data-ready. This is NOT an automation
        run — final submission remains a supervised gate.
      </p>

      {/* Aggregate blocking reasons */}
      {payload.overall === "blocked" && payload.blockingReasons.length > 0 && (
        <div className="tpr-payload-blockers">
          <p className="tpr-payload-blockers-title">Why blocked</p>
          <ul>
            {payload.blockingReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          {payload.unsupportedAutomationReasons.length > 0 && (
            <p className="tpr-payload-unsupported">
              <strong>Automation unsupported:</strong>{" "}
              {payload.unsupportedAutomationReasons.join(" · ")}
            </p>
          )}
        </div>
      )}

      {/* Bahagian A */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.bahagian_a}
          state={
            payload.sectionReadiness.find((s) => s.section === "bahagian_a")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            <strong>{a.landlordCount}</strong> landlord
            {a.landlordCount === 1 ? "" : "s"}
            {" · "}
            <strong>{a.tenantCount}</strong> tenant
            {a.tenantCount === 1 ? "" : "s"}
          </p>
          {a.parties.length === 0 ? (
            <p className="tpr-payload-empty">No parties captured yet.</p>
          ) : (
            <ul className="tpr-payload-parties">
              {a.parties.map((p, i) => (
                <li key={i}>
                  <strong>
                    {p.role === "landlord" ? "Landlord" : "Tenant"}
                  </strong>{" "}
                  · {p.portalPartyCategoryLabel} ·{" "}
                  {p.name || <em>(unnamed)</em>}
                  <div className="tpr-payload-party-detail">
                    {p.identityType ? (
                      <>
                        {p.identityType === "nric"
                          ? "NRIC"
                          : p.identityType === "passport"
                            ? "Passport"
                            : "Co. reg."}
                        : {formatScalar(p.identityNumber)}{" "}
                      </>
                    ) : (
                      <>ID type: — </>
                    )}
                    · TIN:{" "}
                    {p.tin
                      ? p.tin
                      : p.tinAutoGenerationExpected
                        ? "(auto-generated by MyTax)"
                        : "—"}{" "}
                    · Mobile: {formatScalar(p.mobile)}
                  </div>
                  <div className="tpr-payload-party-detail">
                    {formatScalar(p.addressLine1)}
                    {p.addressLine2 ? `, ${p.addressLine2}` : ""},{" "}
                    {formatScalar(p.postcode)} {formatScalar(p.city)},{" "}
                    {formatScalar(p.state)}, {formatScalar(p.country)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Bahagian B */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.bahagian_b}
          state={
            payload.sectionReadiness.find((s) => s.section === "bahagian_b")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            Tarikh Surat Cara: <strong>{formatScalar(b.instrumentDate)}</strong>{" "}
            · Salinan Pendua:{" "}
            <strong>{formatScalar(b.duplicateCopies)}</strong>
          </p>
          <p className="tpr-payload-line">
            <strong>pds_suratcara (Nama Surat Cara):</strong>{" "}
            {b.instrumentName.captured && b.instrumentName.code ? (
              <>
                {b.instrumentName.code} ·{" "}
                {b.instrumentName.label ?? "(label missing)"}
              </>
            ) : (
              <em>not captured</em>
            )}
          </p>
          <p className="tpr-payload-line">
            <strong>pds_jenis (Jenis Surat Cara):</strong>{" "}
            {b.portalDescriptionLabel ?? <em>not selected</em>}
          </p>
          <p className="tpr-payload-line">
            Rent schedule mode: <strong>{RENT_MODE_LABELS[b.rentScheduleMode]}</strong>
          </p>
          {b.automationSupportStatus === "blocked" && (
            <p className="tpr-payload-warn">
              Automation: blocked.{" "}
              {b.automationSupportReason ?? "See blockers above."}
            </p>
          )}
          {b.rentSchedule.length === 0 ? (
            <p className="tpr-payload-empty">No rent schedule rows captured.</p>
          ) : (
            <table className="tpr-payload-rent-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Monthly rent</th>
                  <th>Months</th>
                </tr>
              </thead>
              <tbody>
                {b.rentSchedule.map((r, i) => (
                  <tr key={i}>
                    <td>#{i + 1}</td>
                    <td>{r.startDate}</td>
                    <td>{r.endDate}</td>
                    <td>{formatRm(r.monthlyRent)}</td>
                    <td>{r.durationMonths ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Maklumat Am sub-block (Milestone A2). Always rendered
              so the operator can see whether each portal field is
              captured. Per-field portal-field-key shown verbatim. */}
          <div className="tpr-payload-maklumat-am">
            <p className="tpr-payload-line">
              <strong>Maklumat Am</strong>{" "}
              {payload.maklumatAm.captured ? (
                <span className="tpr-payload-line-ok">— captured</span>
              ) : (
                <span className="tpr-payload-warn-inline">
                  — incomplete (required fields missing)
                </span>
              )}
            </p>
            <ul className="tpr-payload-maklumat-am-list">
              <li>
                <code>pds_dutisetem</code> · Duty type:{" "}
                <strong>
                  {payload.maklumatAm.dutyStampType.code === null
                    ? "—"
                    : payload.maklumatAm.dutyStampType.label
                      ? `${payload.maklumatAm.dutyStampType.code} · ${payload.maklumatAm.dutyStampType.label}`
                      : payload.maklumatAm.dutyStampType.code}
                </strong>
              </li>
              <li>
                <code>pds_ps</code> · Instrument relationship:{" "}
                <strong>
                  {payload.maklumatAm.instrumentRelationship.label ?? "—"}
                  {payload.maklumatAm.instrumentRelationship.portalCode
                    ? ` (portal code "${payload.maklumatAm.instrumentRelationship.portalCode}")`
                    : ""}
                </strong>
              </li>
              <li>
                <code>pds_balasan</code> · Balasan:{" "}
                <strong>
                  {payload.maklumatAm.balasan.value === null
                    ? "—"
                    : formatRm(payload.maklumatAm.balasan.value)}
                </strong>
                {payload.maklumatAm.balasan.requiredForCurrentJenis && (
                  <span className="tpr-payload-warn-inline">
                    {" "}
                    — required for current pds_jenis
                  </span>
                )}
              </li>
              <li>
                <code>pds_remit</code> · Remission (optional):{" "}
                <strong>
                  {payload.maklumatAm.remission.code === null
                    ? "—"
                    : payload.maklumatAm.remission.label
                      ? `${payload.maklumatAm.remission.code} · ${payload.maklumatAm.remission.label}`
                      : payload.maklumatAm.remission.code}
                </strong>
              </li>
              <li>
                <code>pds_perjanjian</code> · Treaty exemption flags:{" "}
                <strong>
                  {(() => {
                    const t = payload.maklumatAm.treatyExemption;
                    const flags = [
                      t.kmkt ? "kmkt" : null,
                      t.klnm ? "klnm" : null,
                      t.vienna ? "vienna" : null,
                    ].filter((x): x is string => x !== null);
                    return flags.length === 0 ? "none" : flags.join(", ");
                  })()}
                </strong>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bahagian C */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.bahagian_c}
          state={
            payload.sectionReadiness.find((s) => s.section === "bahagian_c")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            {formatScalar(c.addressLine1)}
            {c.addressLine2 ? `, ${c.addressLine2}` : ""},{" "}
            {formatScalar(c.postcode)} {formatScalar(c.city)},{" "}
            {formatScalar(c.state)}, {formatScalar(c.country)}
          </p>
          <p className="tpr-payload-line">
            Jenis Harta: <strong>{formatScalar(c.propertyTypeLabel)}</strong>
            {" · "}
            Jenis Bangunan:{" "}
            <strong>{formatScalar(c.buildingType)}</strong>
            {c.buildingTypeRequiredButMissing && (
              <span className="tpr-payload-warn-inline">
                {" "}
                — required when Jenis Harta = Kediaman
              </span>
            )}
            {" · "}
            Perabot: <strong>{formatScalar(c.furnishedStatus)}</strong>
          </p>
          <p className="tpr-payload-line">
            Floor: <strong>{formatScalar(c.floor)}</strong> · Number of floors:{" "}
            <strong>{formatScalar(c.numberOfFloors)}</strong> · Luas Premis:{" "}
            <strong>
              {c.premisesAreaSqm === null ? "—" : `${c.premisesAreaSqm} m²`}
            </strong>
            {c.premisesAreaIsZeroFallback && (
              <span className="tpr-payload-warn-inline">
                {" "}
                — operator-confirmed fallback (no value on instrument)
              </span>
            )}
          </p>
          {/* Bahagian C land-registry sub-block (Milestone A1).
              Always rendered when the property block exists so the
              operator can see whether each portal field is captured.
              Per-field portal-field-key is shown verbatim so the
              operator preview matches what a future automation step
              would send. */}
          <div className="tpr-payload-land-registry">
            <p className="tpr-payload-line">
              <strong>Land registry</strong>{" "}
              {c.landRegistry.captured ? (
                <span className="tpr-payload-line-ok">— captured</span>
              ) : (
                <span className="tpr-payload-warn-inline">
                  — incomplete (required fields missing)
                </span>
              )}
            </p>
            <ul className="tpr-payload-land-registry-list">
              <li>
                <code>pds_mp</code> · Milik Penuh:{" "}
                <strong>
                  {formatScalar(c.landRegistry.milikPenuh.value)}
                </strong>
              </li>
              <li>
                <code>pds_lot</code> · Lot:{" "}
                <strong>{formatScalar(c.landRegistry.lot.value)}</strong>
              </li>
              <li>
                <code>pds_mukim</code> · Mukim:{" "}
                <strong>{formatScalar(c.landRegistry.mukim.value)}</strong>
              </li>
              <li>
                <code>pds_daerah</code> · Daerah:{" "}
                <strong>{formatScalar(c.landRegistry.daerah.value)}</strong>
              </li>
              <li>
                <code>pds_luas</code> · Luas Tanah:{" "}
                <strong>
                  {c.landRegistry.luas.value === null
                    ? "—"
                    : String(c.landRegistry.luas.value)}
                </strong>
                {" · "}
                <code>pds_luasunit</code>:{" "}
                <strong>
                  {c.landRegistry.luasUnit.label ?? "—"}
                  {c.landRegistry.luasUnit.portalCode
                    ? ` (portal code ${c.landRegistry.luasUnit.portalCode})`
                    : ""}
                </strong>
              </li>
              <li>
                <code>pds_kegunaan</code> · Kegunaan (optional):{" "}
                <strong>
                  {formatScalar(c.landRegistry.kegunaan.value)}
                </strong>
              </li>
            </ul>
          </div>

          {/* ── Portal Enum Mapping (Milestone A3) ────────────
              Surfaces the canonical-mapping status for the five
              Sewa/Pajakan portal enum / canonical fields. Each row
              shows: portal field name, WeStamp value, portal label
              (when known), portal code (when known), status, and
              reason. Renders status counts only — no raw href, no
              numeric IDs. */}
          <div className="tpr-payload-portal-enum-mapping">
            <p className="tpr-payload-line">
              <strong>Portal Enum Mapping</strong>
            </p>
            <p className="tpr-payload-portal-enum-mapping-helper">
              These mappings translate WeStamp values into the exact
              e-Duti Setem dropdown values observed for the
              Sewa/Pajakan portal. Unknown or ambiguous mappings
              remain blocked.
            </p>
            <ul className="tpr-payload-portal-enum-mapping-list">
              <PortalEnumMappingRow
                label="Duplicate copies"
                mapping={b.duplicateCopiesMapping}
              />
              <PortalEnumMappingRow
                label="Property state"
                mapping={c.stateMapping}
              />
              <PortalEnumMappingRow
                label="Property country"
                mapping={c.countryMapping}
              />
              <PortalEnumMappingRow
                label="Property category / building type"
                mapping={c.propertyCategoryMapping}
              />
              <PortalEnumMappingRow
                label="Furnishing"
                mapping={c.furnishedMapping}
              />
            </ul>
          </div>
        </div>
      </div>

      {/* Rumusan */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.rumusan}
          state={
            payload.sectionReadiness.find((s) => s.section === "rumusan")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            WeStamp internal calculated duty:{" "}
            <strong>{formatRm(payload.rumusan.westampInternalCalculatedDuty)}</strong>
          </p>
          {payload.rumusan.rentTotalSummary ? (
            <p className="tpr-payload-line">
              Rent total summary:{" "}
              <strong>
                {payload.rumusan.rentTotalSummary.totalMonths} months ·{" "}
                {formatRm(payload.rumusan.rentTotalSummary.totalRent)}
              </strong>
            </p>
          ) : (
            <p className="tpr-payload-empty">
              Rent total summary not yet derivable.
            </p>
          )}
          <p className="tpr-payload-line">
            Comparison status:{" "}
            <strong>
              {payload.rumusan.comparisonStatus === "ready_for_future_comparison"
                ? "Ready for future portal-vs-WeStamp comparison"
                : "Not compared"}
            </strong>
          </p>
        </div>
      </div>

      {/* Lampiran */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.lampiran}
          state={
            payload.sectionReadiness.find((s) => s.section === "lampiran")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            Source PDF:{" "}
            <strong>{formatScalar(payload.lampiran.originalFileName)}</strong>{" "}
            ({formatScalar(payload.lampiran.mimeType)})
          </p>
          <p className="tpr-payload-line">
            Storage path:{" "}
            <code>{formatScalar(payload.lampiran.sourcePdfStoragePath)}</code>
          </p>
          <p className="tpr-payload-line">
            Ready to upload at execution time:{" "}
            <strong>{payload.lampiran.readyToUpload ? "yes" : "no"}</strong>
          </p>
        </div>
      </div>

      {/* Perakuan */}
      <div className="tpr-payload-section">
        <PayloadSectionHeader
          title={PAYLOAD_SECTION_LABELS.perakuan}
          state={
            payload.sectionReadiness.find((s) => s.section === "perakuan")
              ?.state ?? "blocked"
          }
        />
        <div className="tpr-payload-section-body">
          <p className="tpr-payload-line">
            Final submission gate: <strong>supervised</strong>
          </p>
          <p className="tpr-payload-line">
            Final submission allowed at payload stage: <strong>no</strong>
          </p>
          <p className="tpr-payload-note">{payload.perakuan.note}</p>
        </div>
      </div>

      {/* Raw payload (collapsed) */}
      <details className="tpr-payload-raw">
        <summary>Raw payload (JSON)</summary>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </section>
  );
}

function PayloadSectionHeader({
  title,
  state,
}: {
  title: string;
  state: TenancyPortalPayload["sectionReadiness"][number]["state"];
}) {
  return (
    <div className="tpr-payload-section-header">
      <h4>{title}</h4>
      <span
        className={`tpr-overall tpr-overall-${state}`}
        title={`section state: ${state}`}
      >
        {state === "ready" ? "Ready" : "Blocked"}
      </span>
    </div>
  );
}

// ─── Portal Enum Mapping row (Milestone A3) ────────────────────────
//
// Renders one canonical-mapping status row in the operator preview.
// Surfaces the portal field key, status, portal label (when known),
// portal code (when known), and reason. Never logs or stores the
// underlying value beyond what the operator already sees in the
// Bahagian B/C blocks above.
function PortalEnumMappingRow({
  label,
  mapping,
}: {
  label: string;
  mapping: TenancyPortalPayload["bahagianB"]["duplicateCopiesMapping"];
}) {
  const statusLabel =
    mapping.status === "mapped"
      ? "Mapped"
      : mapping.status === "unknown_code"
        ? "Label known · code not yet captured"
        : mapping.status === "unsupported"
          ? "Unsupported"
          : "Ambiguous";
  return (
    <li className="tpr-payload-portal-enum-mapping-row">
      <strong>{label}</strong>{" "}
      (<code>{mapping.portalFieldKey}</code>):{" "}
      <span
        className={`tpr-payload-mapping-status tpr-payload-mapping-status-${mapping.status}`}
      >
        {statusLabel}
      </span>
      {mapping.portalLabel ? (
        <>
          {" · portal label: "}
          <strong>{mapping.portalLabel}</strong>
        </>
      ) : null}
      {mapping.portalCode ? (
        <>
          {" · portal code: "}
          <code>{mapping.portalCode}</code>
        </>
      ) : null}
      {mapping.reason ? (
        <p className="tpr-payload-mapping-reason">{mapping.reason}</p>
      ) : null}
    </li>
  );
}

// ─── Browser instruction draft preview ─────────────────────────────

const INSTRUCTION_SECTION_LABELS: Record<
  TenancyBrowserInstructionSection,
  string
> = {
  maklumat_am: "Maklumat Am · Lane Selection",
  bahagian_a: "Bahagian A · Parties",
  bahagian_b: "Bahagian B · Instrument & Rent",
  bahagian_c: "Bahagian C · Property",
  rumusan: "Rumusan Pengiraan",
  lampiran: "Lampiran",
  perakuan: "Perakuan",
};

const INSTRUCTION_KIND_LABELS: Record<
  TenancyBrowserInstructionKind,
  string
> = {
  non_mutating: "Read / navigate",
  form_fill_only: "Fill field",
  mutating_requires_authorization: "Mutating · authorization required",
  irreversible_requires_final_approval:
    "Irreversible · final approval required",
};

function formatStepValue(
  v: string | number | boolean | null | undefined
): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (v.trim() === "") return "—";
  return v;
}

function InstructionDraftPreview({
  draft,
}: {
  draft: TenancyBrowserInstructionDraft;
}) {
  return (
    <details className="tpr-instr-draft" aria-label="Browser instruction draft">
      <summary className="tpr-instr-draft-summary">
        <span className="tpr-instr-draft-summary-title">
          Browser Instruction Draft
        </span>
        <span
          className={`tpr-overall tpr-overall-${draft.overall}`}
          title={`generated ${draft.generatedAt}`}
        >
          {draft.overall === "ready"
            ? "Draft ready (non-executed)"
            : "Draft blocked"}
        </span>
      </summary>
      <div className="tpr-instr-draft-body">
        <p className="tpr-instr-draft-warning">
          <strong>Not executed.</strong> This draft does NOT save,
          submit, upload, pay, or retrieve anything. It is a deterministic
          plan of what browser automation would do later, generated from
          the compiled tenancy portal payload above.
        </p>

        {/* Aggregate kind counts */}
        <div className="tpr-instr-counts">
          <span className="tpr-instr-count-cell">
            Total: <strong>{draft.totalInstructions}</strong>
          </span>
          <span className="tpr-instr-count-cell">
            Read / navigate:{" "}
            <strong>{draft.kindCounts.non_mutating}</strong>
          </span>
          <span className="tpr-instr-count-cell">
            Fill field:{" "}
            <strong>{draft.kindCounts.form_fill_only}</strong>
          </span>
          <span className="tpr-instr-count-cell tpr-instr-count-mutating">
            Mutating:{" "}
            <strong>
              {draft.kindCounts.mutating_requires_authorization}
            </strong>
          </span>
          <span className="tpr-instr-count-cell tpr-instr-count-final">
            Irreversible:{" "}
            <strong>
              {draft.kindCounts.irreversible_requires_final_approval}
            </strong>
          </span>
        </div>

        {/* Aggregate blocking / unsupported reasons */}
        {draft.overall === "blocked" && draft.blockingReasons.length > 0 && (
          <div className="tpr-payload-blockers">
            <p className="tpr-payload-blockers-title">Why blocked</p>
            <ul>
              {draft.blockingReasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            {draft.unsupportedAutomationReasons.length > 0 && (
              <p className="tpr-payload-unsupported">
                <strong>Automation unsupported:</strong>{" "}
                {draft.unsupportedAutomationReasons.join(" · ")}
              </p>
            )}
          </div>
        )}

        {/* Section plans */}
        {draft.sections.map((section) => (
          <div key={section.section} className="tpr-instr-section">
            <div className="tpr-instr-section-header">
              <h4>{INSTRUCTION_SECTION_LABELS[section.section]}</h4>
              <div className="tpr-instr-section-header-right">
                <span className="tpr-instr-section-count">
                  {section.steps.length} step
                  {section.steps.length === 1 ? "" : "s"}
                </span>
                <span
                  className={`tpr-overall tpr-overall-${section.state}`}
                  title={`section state: ${section.state}`}
                >
                  {section.state === "ready" ? "Ready" : "Blocked"}
                </span>
                {section.automationSupport === "blocked" && (
                  <span
                    className="tpr-overall tpr-overall-blocked"
                    title="automation support: blocked"
                  >
                    Automation unsupported
                  </span>
                )}
              </div>
            </div>
            {section.steps.length === 0 ? (
              <p className="tpr-payload-empty">No steps generated.</p>
            ) : (
              <ol className="tpr-instr-steps">
                {section.steps.map((step) => (
                  <li
                    key={step.seq}
                    className={`tpr-instr-step tpr-instr-step-${step.kind}`}
                  >
                    <div className="tpr-instr-step-line">
                      <span className="tpr-instr-step-seq">
                        #{step.seq}
                      </span>
                      <span
                        className={`tpr-instr-step-kind tpr-instr-step-kind-${step.kind}`}
                        title={INSTRUCTION_KIND_LABELS[step.kind]}
                      >
                        {INSTRUCTION_KIND_LABELS[step.kind]}
                      </span>
                      <span className="tpr-instr-step-desc">
                        {step.description}
                      </span>
                    </div>
                    <div className="tpr-instr-step-meta">
                      {step.portalLabel && (
                        <span className="tpr-instr-step-meta-cell">
                          Portal label:{" "}
                          <strong>{step.portalLabel}</strong>
                        </span>
                      )}
                      {step.portalFieldKey && (
                        <span className="tpr-instr-step-meta-cell">
                          Field key:{" "}
                          <code>{step.portalFieldKey}</code>
                        </span>
                      )}
                      <span className="tpr-instr-step-meta-cell">
                        Selector:{" "}
                        <em
                          className={`tpr-instr-selector tpr-instr-selector-${step.selectorCertainty}`}
                        >
                          {step.selectorCertainty}
                        </em>
                      </span>
                      {step.value !== undefined && (
                        <span className="tpr-instr-step-meta-cell">
                          Value:{" "}
                          <span className="tpr-instr-step-value">
                            {formatStepValue(step.value)}
                          </span>
                        </span>
                      )}
                    </div>
                    {step.notes && (
                      <p className="tpr-instr-step-notes">{step.notes}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {section.blockingReasons.length > 0 && (
              <ul className="tpr-instr-section-blockers">
                {section.blockingReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {/* Raw draft (collapsed) */}
        <details className="tpr-payload-raw">
          <summary>Raw instruction draft (JSON)</summary>
          <pre>{JSON.stringify(draft, null, 2)}</pre>
        </details>
      </div>
    </details>
  );
}

// ─── Consolidated Portal Run Readiness summary ─────────────────────

/**
 * Operator-facing labels for the four field-mapping gap categories
 * surfaced under "Portal field mapping gaps discovered". Stable
 * labels — the codes themselves come from the readiness lib.
 */
const GAP_CATEGORY_LABELS: Record<
  TenancyPortalFieldMappingGapCategory,
  string
> = {
  multi_pass_unsupported: "Multi-pass not supported",
  land_registry_not_modelled: "Bahagian C land-registry fields not modelled",
  maklumat_am_not_captured: "Maklumat Am portal fields not yet captured",
  portal_enum_mismatch: "Portal enum / dropdown mismatch",
  party_model_not_modelled: "Party model gaps (gender / PR / NRIC sub-type / SSM rep)",
};

function RunReadinessSummary({
  report,
}: {
  report: TenancyPortalRunReadinessReport;
}) {
  const isReady = report.verdict === "ready_for_supervised_run";
  // Group the field-mapping gaps for the dedicated heading. When
  // present, this list is the operator's primary triage surface —
  // these are structural gaps that cannot be resolved by capturing
  // more data on the current job; the data model / compiler must be
  // extended in a separate milestone.
  const groupedGaps = groupTenancyPortalFieldMappingGaps(
    report.portalFieldMappingGaps
  );
  return (
    <section
      className={`tpr-run-readiness tpr-run-readiness-${report.verdict}`}
      aria-label="Portal run readiness — consolidated verdict"
    >
      <header className="tpr-run-readiness-header">
        <h3>Portal Run Readiness</h3>
        <span
          className={`tpr-overall tpr-overall-${isReady ? "ready" : "blocked"}`}
          title={`generated ${report.generatedAt}`}
        >
          {isReady
            ? "Ready for supervised portal run"
            : "Not ready for supervised portal run"}
        </span>
      </header>

      <p className="tpr-run-readiness-action">
        <span className="tpr-run-readiness-action-label">
          Next recommended action
        </span>
        <span className="tpr-run-readiness-action-text">
          {report.nextRecommendedAction}
        </span>
      </p>

      <div className="tpr-run-readiness-layers">
        <span
          className={`tpr-run-readiness-layer tpr-run-readiness-layer-${report.requiredDetailsStatus}`}
        >
          Required details: <strong>{report.requiredDetailsStatus}</strong>
        </span>
        <span
          className={`tpr-run-readiness-layer tpr-run-readiness-layer-${report.payloadStatus}`}
        >
          Payload: <strong>{report.payloadStatus}</strong>
        </span>
        <span
          className={`tpr-run-readiness-layer tpr-run-readiness-layer-${report.instructionDraftStatus}`}
        >
          Instruction draft: <strong>{report.instructionDraftStatus}</strong>
        </span>
        <span
          className={`tpr-run-readiness-layer tpr-run-readiness-layer-${
            report.sourcePdfReady ? "ready" : "blocked"
          }`}
        >
          Source PDF: <strong>{report.sourcePdfReady ? "ready" : "missing"}</strong>
        </span>
        <span className="tpr-run-readiness-layer tpr-run-readiness-layer-mutating">
          Mutating steps: <strong>{report.mutatingStepsCount}</strong>
        </span>
        <span className="tpr-run-readiness-layer tpr-run-readiness-layer-irreversible">
          Irreversible steps: <strong>{report.irreversibleStepsCount}</strong>
        </span>
      </div>

      {/* ── Portal field mapping gaps (2026-04-28 safety) ──────
          These are STRUCTURAL gaps the operator cannot fix from the
          job alone — they reflect newly discovered portal fields the
          WeStamp model / compiler does not yet handle. Surfaced
          ABOVE the legacy "Top blocking reasons" list so operators
          read the structural blocker first. */}
      {groupedGaps.length > 0 && (
        <div className="tpr-run-readiness-gaps" role="alert">
          <p className="tpr-run-readiness-gaps-title">
            <strong>{TENANCY_PORTAL_FIELD_MAPPING_GAPS_HEADER}</strong>
          </p>
          <p className="tpr-run-readiness-gaps-explanation">
            {TENANCY_PORTAL_FIELD_MAPPING_GAPS_EXPLANATION}
          </p>
          {groupedGaps.map((g) => (
            <div key={g.category} className="tpr-run-readiness-gap-group">
              <p className="tpr-run-readiness-gap-group-title">
                {GAP_CATEGORY_LABELS[g.category]}
                {" · "}
                <span className="tpr-run-readiness-gap-group-count">
                  {g.gaps.length} blocker{g.gaps.length === 1 ? "" : "s"}
                </span>
              </p>
              <ul className="tpr-run-readiness-gap-group-list">
                {g.gaps.map((gap) => (
                  <li key={gap.code}>
                    <code className="tpr-run-readiness-gap-code">
                      {gap.code}
                    </code>{" "}
                    — {gap.reason}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!isReady && report.blockingReasons.length > 0 && (
        <div className="tpr-run-readiness-blockers">
          <p className="tpr-run-readiness-blockers-title">Top blocking reasons</p>
          <ul>
            {/* Cap to a sane number — the gap preview below shows the
                full list. The summary is for at-a-glance triage. */}
            {report.blockingReasons.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
            {report.blockingReasons.length > 6 && (
              <li className="tpr-run-readiness-blockers-more">
                +{report.blockingReasons.length - 6} more — see detailed
                previews below.
              </li>
            )}
          </ul>
        </div>
      )}

      {report.warnings.length > 0 && (
        <ul className="tpr-run-readiness-warnings">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Instruction Graph Preview (Milestone B1) ──────────────────────

/**
 * Read-only render of the offline instruction graph view-model.
 *
 * This component is a thin renderer — every string it shows is read
 * verbatim from `viewModel`, which is built by the pure helper
 * `buildInstructionGraphPreviewViewModel`. The helper enforces the
 * B1 wording rules and the sensitive-data invariant; the React
 * component must not introduce its own wording or compose its own
 * strings from raw job values.
 *
 * The component does NOT render any "Run" / "Execute" / "Submit"
 * affordance and does NOT trigger any side-effect.
 */
function InstructionGraphPreview({
  viewModel,
}: {
  viewModel: InstructionGraphPreviewViewModel;
}) {
  const isReady = viewModel.banner.tone === "ready";
  return (
    <section
      className={`tpr-igp tpr-igp-${viewModel.banner.tone}`}
      aria-label={viewModel.heading}
      data-graph-id={viewModel.graphId}
    >
      <header className="tpr-igp-header">
        <h3>{viewModel.heading}</h3>
        <span
          className={`tpr-igp-banner tpr-igp-banner-${viewModel.banner.tone}`}
        >
          {viewModel.banner.text}
        </span>
      </header>

      <p className="tpr-igp-helper">{viewModel.helperText}</p>

      <div className="tpr-igp-meta">
        <span className="tpr-igp-meta-cell">
          Lane: <strong>{viewModel.laneLabel}</strong>
        </span>
        <span className="tpr-igp-meta-cell">
          Supported path: <strong>{viewModel.supportedPathLabel}</strong>
        </span>
        <span className="tpr-igp-meta-cell">
          Future execution:{" "}
          <strong>{viewModel.futureExecutionLabel}</strong>
        </span>
      </div>

      {isReady ? (
        <>
          <div className="tpr-igp-table-wrap">
            <table className="tpr-igp-phase-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Mutation level</th>
                  <th>Execution status</th>
                  <th>Steps</th>
                  <th>Operator gate</th>
                </tr>
              </thead>
              <tbody>
                {viewModel.phases.map((row) => (
                  <tr key={row.phaseId} className="tpr-igp-phase-row">
                    <td className="tpr-igp-phase-name">{row.phaseName}</td>
                    <td>
                      <span className="tpr-igp-mutation">
                        {row.mutationLevelLabel}
                      </span>
                    </td>
                    <td>
                      <span className="tpr-igp-status tpr-igp-status-planned">
                        {row.executionStatusLabel}
                      </span>
                    </td>
                    <td className="tpr-igp-step-count">{row.stepCount}</td>
                    <td>
                      {row.hasOperatorGate ? (
                        <span className="tpr-igp-gate-yes">Required</span>
                      ) : (
                        <span className="tpr-igp-gate-no">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="tpr-igp-gates">
            <p className="tpr-igp-gates-title">
              <strong>Operator gates</strong>
            </p>
            <ul className="tpr-igp-gates-list">
              {viewModel.operatorGates.map((g) => (
                <li key={g.key}>
                  <span className="tpr-igp-gate-label">{g.label}</span>
                  <span className="tpr-igp-gate-phase"> · {g.phaseName}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        viewModel.blockedSummary && (
          <div className="tpr-igp-blocked" role="alert">
            <p className="tpr-igp-blocked-action">
              <strong>{viewModel.blockedSummary.safeActionText}</strong>
            </p>
            {viewModel.blockedSummary.groups.length > 0 && (
              <ul className="tpr-igp-blocked-groups">
                {viewModel.blockedSummary.groups.map((g) => (
                  <li key={g.category} className="tpr-igp-blocked-group">
                    <span className="tpr-igp-blocked-category">
                      {g.categoryLabel}
                    </span>
                    <span className="tpr-igp-blocked-count">
                      {" "}
                      · {g.count} blocker{g.count === 1 ? "" : "s"}
                    </span>
                    {g.representativeCodes.length > 0 && (
                      <ul className="tpr-igp-blocked-codes">
                        {g.representativeCodes.map((c) => (
                          <li key={c}>
                            <code>{c}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      <footer className="tpr-igp-footer">
        <p>{viewModel.authorizationCaveat}</p>
        <p>{viewModel.finalHantarCaveat}</p>
      </footer>
    </section>
  );
}

// ─── Supervised Run Console (Milestone B2) ─────────────────────────

/**
 * Read-only operator-facing console that turns the readiness +
 * instruction-graph + graph-preview state into a single decision
 * surface for "is this job eligible for a future supervised run?".
 *
 * This component is a thin renderer — every string it shows is read
 * verbatim from `viewModel`, which is built by the pure helper
 * `buildSupervisedRunConsoleViewModel`. The helper enforces the B2
 * wording rules and the sensitive-data invariant; the React
 * component must not introduce its own wording or compose its own
 * strings from raw job values.
 *
 * It does NOT render Start / Submit / Execute / Send / Pay /
 * Upload-to-portal / Hantar affordances. The only action it exposes
 * is the approved non-mutating "Refresh Run Plan" button, which
 * triggers `window.location.reload()` to re-fetch the server-rendered
 * job and recompute every derived view-model from a fresh source.
 */
function SupervisedRunConsole({
  viewModel,
}: {
  viewModel: SupervisedRunConsoleViewModel;
}) {
  const isReady = viewModel.eligibility === "eligible";
  function handleRefresh() {
    // Non-mutating refresh — re-fetches the page, which forces
    // every server-rendered piece of state (job, readiness inputs)
    // to be re-read. No portal action is triggered.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }
  return (
    <section
      className={`tpr-src tpr-src-${viewModel.banner.tone}`}
      aria-label={viewModel.heading}
      data-graph-id={viewModel.graphId}
    >
      <header className="tpr-src-header">
        <h3>{viewModel.heading}</h3>
        <span
          className={`tpr-src-banner tpr-src-banner-${viewModel.banner.tone}`}
        >
          {viewModel.banner.text}
        </span>
      </header>

      <p className="tpr-src-helper">{viewModel.helperText}</p>

      <div className="tpr-src-info-grid">
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Readiness verdict</span>
          <strong
            className={`tpr-src-info-value tpr-src-info-value-${
              viewModel.readinessVerdict === "ready_for_supervised_run"
                ? "ready"
                : "blocked"
            }`}
          >
            {viewModel.readinessVerdictLabel}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Instruction graph verdict</span>
          <strong
            className={`tpr-src-info-value tpr-src-info-value-${viewModel.graphSummary.verdictTone}`}
          >
            {viewModel.graphSummary.verdictLabel}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Lane</span>
          <strong className="tpr-src-info-value">
            {viewModel.graphSummary.laneLabel}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Supported path</span>
          <strong className="tpr-src-info-value">
            {viewModel.graphSummary.supportedPathLabel}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Phase count</span>
          <strong className="tpr-src-info-value tpr-src-info-numeric">
            {viewModel.graphSummary.phaseCount}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Operator gates</span>
          <strong className="tpr-src-info-value tpr-src-info-numeric">
            {viewModel.graphSummary.operatorGateCount}
          </strong>
        </div>
        <div className="tpr-src-info-cell">
          <span className="tpr-src-info-label">Eligibility</span>
          <strong
            className={`tpr-src-info-value tpr-src-info-value-${viewModel.banner.tone}`}
          >
            {viewModel.eligibilityLabel}
          </strong>
        </div>
      </div>

      <div className="tpr-src-checklist">
        <p className="tpr-src-checklist-title">
          <strong>Preflight checklist</strong>
        </p>
        <ul className="tpr-src-checklist-list">
          {viewModel.preflightChecklist.map((item) => (
            <li
              key={item.id}
              className={`tpr-src-checklist-item tpr-src-checklist-item-${item.status}`}
            >
              <span
                className={`tpr-src-checklist-marker tpr-src-checklist-marker-${item.status}`}
                aria-hidden="true"
              >
                {item.status === "pass" ? "✓" : "✗"}
              </span>
              <span className="tpr-src-checklist-label">{item.label}</span>
              {item.failReason && (
                <span className="tpr-src-checklist-reason">
                  {" "}
                  · {item.failReason}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {!isReady && viewModel.blockedSummary && (
        <div className="tpr-src-blocked" role="alert">
          <p className="tpr-src-blocked-action">
            <strong>{viewModel.blockedSummary.safeActionText}</strong>
          </p>
          {viewModel.blockedSummary.groups.length > 0 && (
            <ul className="tpr-src-blocked-groups">
              {viewModel.blockedSummary.groups.map((g) => (
                <li key={g.key} className="tpr-src-blocked-group">
                  <span className="tpr-src-blocked-category">{g.label}</span>
                  <span className="tpr-src-blocked-count">
                    {" "}
                    · {g.count} blocker{g.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="tpr-src-action-row">
        <button
          type="button"
          className="tpr-src-refresh-button"
          onClick={handleRefresh}
        >
          {viewModel.refreshActionLabel}
        </button>
        <span className="tpr-src-action-note">
          {viewModel.nonExecutionNote}
        </span>
      </div>

      <footer className="tpr-src-footer">
        <p>{viewModel.futureGateNote}</p>
        <p>{viewModel.authorizationCaveat}</p>
      </footer>
    </section>
  );
}

// ─── Browser Session Status Card (Milestone B4) ────────────────────

/**
 * Read-only operator-facing card that calls
 * `/api/operator/cdp-inspect` (operator-protected) and renders the
 * sanitized session report.
 *
 * Behavioural contract:
 *   - Initial render → "Not checked yet" / idle state.
 *   - Click `Check Browser Session` → POSTs to the local operator
 *     API route, transitions to loading, then ready / error.
 *   - The card NEVER mutates the portal — the route delegates to
 *     the B3 read-only inspector which only reads `page.url()` and
 *     `page.locator(name).count()`.
 *   - All wording is sourced from the pure card view-model helper,
 *     which is invariant-tested for forbidden wording and
 *     sensitive-data leaks.
 */
function BrowserSessionStatusCard() {
  const [lifecycle, setLifecycle] =
    useState<BrowserSessionStatusCardLifecycle>("idle");
  const [report, setReport] = useState<SupervisedSessionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const viewModel = useMemo(
    () =>
      buildBrowserSessionStatusCardViewModel({
        state: lifecycle,
        report,
        errorMessage,
      }),
    [lifecycle, report, errorMessage]
  );

  const handleCheck = useCallback(async () => {
    setLifecycle("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/operator/cdp-inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Default to the first phase that needs portal contact;
          // gives the operator immediately-actionable phase
          // compatibility info on the card.
          targetPhaseId: "phase_1_session_positioning",
        }),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "report" in json
      ) {
        setReport((json as { report: SupervisedSessionReport }).report);
        setLifecycle("ready");
        return;
      }
      const errMsg =
        json &&
        typeof json === "object" &&
        "error" in json &&
        typeof (json as { error: unknown }).error === "string"
          ? ((json as { error: string }).error)
          : "Inspection failed.";
      setErrorMessage(errMsg);
      setLifecycle("error");
    } catch {
      // Network failure / offline — fall back to the safe default
      // wording. Never surface raw exception text into the UI.
      setErrorMessage("Network failure. Please try again.");
      setLifecycle("error");
    }
  }, []);

  return (
    <section
      className={`tpr-bss tpr-bss-${lifecycle}`}
      aria-label={viewModel.heading}
    >
      <header className="tpr-bss-header">
        <h3>{viewModel.heading}</h3>
        <span
          className={`tpr-bss-badge tpr-bss-badge-${lifecycle}`}
        >
          {viewModel.statusText}
        </span>
      </header>

      <p className="tpr-bss-helper">{viewModel.helperText}</p>

      <div className="tpr-bss-info-grid">
        <div className="tpr-bss-info-cell">
          <span className="tpr-bss-info-label">Page kind</span>
          <strong className="tpr-bss-info-value">
            {viewModel.pageKindLabel}
          </strong>
        </div>
        <div className="tpr-bss-info-cell">
          <span className="tpr-bss-info-label">Candidate page count</span>
          <strong className="tpr-bss-info-value tpr-bss-info-numeric">
            {viewModel.candidatePageCount}
          </strong>
        </div>
        <div className="tpr-bss-info-cell">
          <span className="tpr-bss-info-label">Phase compatibility</span>
          <strong className="tpr-bss-info-value">
            {viewModel.phaseCompatibilityLabel}
          </strong>
        </div>
        <div className="tpr-bss-info-cell">
          <span className="tpr-bss-info-label">Marker summary</span>
          <strong className="tpr-bss-info-value tpr-bss-info-numeric">
            {viewModel.markerSummary.presentCount} /{" "}
            {viewModel.markerSummary.totalCount}
          </strong>
          <span className="tpr-bss-info-sub">
            P5 selects {viewModel.markerSummary.p5SelectsPresent}/
            {viewModel.markerSummary.p5SelectsTotal} · tabs{" "}
            {viewModel.markerSummary.tabsPresent}/
            {viewModel.markerSummary.tabsTotal}
          </span>
        </div>
      </div>

      {viewModel.recommendedOperatorAction && (
        <p className="tpr-bss-action">
          <strong>Recommended action: </strong>
          {viewModel.recommendedOperatorAction}
        </p>
      )}

      {viewModel.phasePositioningSummary && (
        <div className="tpr-bss-positioning">
          <p className="tpr-bss-positioning-summary">
            <strong>{viewModel.phasePositioningSummary.overallSummary}</strong>
          </p>
          <ul className="tpr-bss-positioning-rows">
            {viewModel.phasePositioningSummary.rows.map((row) => (
              <li
                key={row.phaseGroupId}
                className={`tpr-bss-positioning-row tpr-bss-positioning-row-${row.compatibility}`}
              >
                <span className="tpr-bss-positioning-phase">
                  {row.phaseLabel}
                </span>
                <span className="tpr-bss-positioning-compat">
                  {row.compatibilityLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewModel.errorMessage && (
        <p className="tpr-bss-error" role="alert">
          {viewModel.errorMessage}
        </p>
      )}

      <div className="tpr-bss-action-row">
        <button
          type="button"
          className="tpr-bss-check-button"
          onClick={handleCheck}
          disabled={viewModel.buttonDisabled}
        >
          {lifecycle === "loading"
            ? viewModel.loadingLabel
            : viewModel.buttonLabel}
        </button>
        <span className="tpr-bss-non-execution-note">
          {viewModel.nonExecutionNote}
        </span>
      </div>
    </section>
  );
}

// ─── Supervised Run Session Card (Milestone B6) ────────────────────

/**
 * Operator-side internal control surface for the supervised-run
 * lifecycle. Reads / writes the `supervisedRunSession` block on
 * the StampingJob via two operator-protected routes:
 *   - POST /api/intake/[id]/supervised-run/prepare
 *   - POST /api/intake/[id]/supervised-run/approve-first-mutation
 *
 * The component is a thin renderer over
 * `buildSupervisedRunSessionViewModel`, which carries every B6
 * approved string as exported constants. The component never
 * composes its own wording, never accesses the raw job, and never
 * exposes a Start / Submit / Execute / Send / Pay / Upload / Hantar
 * affordance.
 *
 * Approval is internal only — clicking "Approve First Portal
 * Mutation" sets a flag; no Playwright API is called, no portal
 * URL is hit, no field is filled.
 */
function SupervisedRunSessionCard({
  jobId,
  initialState,
}: {
  jobId: string;
  initialState: TenancyRunSessionState | null;
}) {
  const [state, setState] = useState<TenancyRunSessionState | null>(
    initialState
  );
  const [busy, setBusy] = useState<
    | "prepare"
    | "approve"
    | "phase2"
    | "phase3-landlord"
    | "phase3-tenant"
    | "phase4-bahagian-b"
    | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);
  const [phase2Refusal, setPhase2Refusal] =
    useState<Phase2RefusalReason | null>(null);
  const [phase3LandlordRefusal, setPhase3LandlordRefusal] =
    useState<Phase3LandlordRefusalReason | null>(null);
  const [phase3TenantRefusal, setPhase3TenantRefusal] =
    useState<Phase3TenantRefusalReason | null>(null);
  const [phase4BahagianBRefusal, setPhase4BahagianBRefusal] =
    useState<Phase4BahagianBRefusalReason | null>(null);

  const viewModel: SupervisedRunSessionViewModel = useMemo(
    () => buildSupervisedRunSessionViewModel(state),
    [state]
  );

  const handlePrepare = useCallback(
    async (inspectBrowser: boolean) => {
      setBusy("prepare");
      setErrorMessage(null);
      setCompletedNotice(null);
      try {
        const res = await fetch(
          `/api/intake/${encodeURIComponent(jobId)}/supervised-run/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inspectBrowserSession: inspectBrowser }),
          }
        );
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (
          res.ok &&
          json &&
          typeof json === "object" &&
          "ok" in json &&
          (json as { ok: unknown }).ok === true &&
          "state" in json
        ) {
          setState((json as { state: TenancyRunSessionState }).state);
        } else {
          const errMsg =
            json &&
            typeof json === "object" &&
            "error" in json &&
            typeof (json as { error: unknown }).error === "string"
              ? (json as { error: string }).error
              : "Failed to prepare run session.";
          setErrorMessage(errMsg);
        }
      } catch {
        setErrorMessage("Network failure. Please try again.");
      } finally {
        setBusy(null);
      }
    },
    [jobId]
  );

  const handleApprove = useCallback(async () => {
    setBusy("approve");
    setErrorMessage(null);
    setCompletedNotice(null);
    try {
      const res = await fetch(
        `/api/intake/${encodeURIComponent(jobId)}/supervised-run/approve-first-mutation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "state" in json
      ) {
        const successJson = json as {
          state: TenancyRunSessionState;
          notice?: string;
        };
        setState(successJson.state);
        if (typeof successJson.notice === "string") {
          setCompletedNotice(successJson.notice);
        }
      } else {
        const errMsg =
          json &&
          typeof json === "object" &&
          "error" in json &&
          typeof (json as { error: unknown }).error === "string"
            ? (json as { error: string }).error
            : "Failed to approve first mutation.";
        setErrorMessage(errMsg);
      }
    } catch {
      setErrorMessage("Network failure. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [jobId]);

  // Phase 2 (Milestone B7) — controlled Maklumat Am draft creation.
  // Disabled unless the run session is in `first_mutation_approved`
  // stage; the route enforces the same gate server-side. The button
  // never triggers any later-phase action; the route's executor
  // surface is locked to the Phase 2 selector allow-list.
  const phase2ButtonEnabled =
    state !== null &&
    state.currentRunStage === "first_mutation_approved";

  // Phase 3 landlord-individual (Milestone B10) — controlled
  // Bahagian A landlord row save. Disabled unless:
  //   - Maklumat Am has been saved (`phase_2_maklumat_am_saved`)
  //   - the landlord row hasn't already been saved
  // The route enforces the same gates server-side.
  const phase3LandlordButtonEnabled =
    state !== null &&
    state.currentRunStage === "phase_2_maklumat_am_saved";

  const phase3LandlordRowAlreadySaved =
    state !== null &&
    state.currentRunStage === "phase_3_landlord_individual_saved";

  // Phase 3 tenant-individual (Milestone B11). Disabled unless:
  //   - landlord row has been saved (`phase_3_landlord_individual_saved`)
  //   - the tenant row hasn't already been saved
  const phase3TenantButtonEnabled =
    state !== null &&
    state.currentRunStage === "phase_3_landlord_individual_saved";

  const phase3TenantRowAlreadySaved =
    state !== null &&
    state.currentRunStage === "phase_3_tenant_individual_saved";

  // Phase 4 Bahagian B fixed-rent (Milestone B12). Disabled unless:
  //   - tenant row has been saved (`phase_3_tenant_individual_saved`)
  //   - Bahagian B hasn't already been saved
  // The fixed-rent / single-period rent-type check lives in the
  // route's pure preflight; the UI button only gates on stage.
  const phase4BahagianBButtonEnabled =
    state !== null &&
    state.currentRunStage === "phase_3_tenant_individual_saved";
  const phase4BahagianBAlreadySaved =
    state !== null &&
    state.currentRunStage === "phase_4_bahagian_b_fixed_rent_saved";

  const handleExecutePhase2 = useCallback(async () => {
    setBusy("phase2");
    setErrorMessage(null);
    setCompletedNotice(null);
    setPhase2Refusal(null);
    try {
      const res = await fetch(
        `/api/intake/${encodeURIComponent(jobId)}/supervised-run/execute-phase-2-maklumat-am`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "result" in json
      ) {
        const successJson = json as {
          result: Phase2ExecutionResult;
        };
        // Refresh the run-session state after a successful save.
        if (successJson.result.status === "saved") {
          setCompletedNotice(PHASE_2_EXECUTE_SUCCESS);
          // Optimistic local-state transition. The next page
          // reload will re-fetch the persisted state from the
          // server, but transitioning here keeps the UI
          // immediately accurate.
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  currentRunStage: "phase_2_maklumat_am_saved",
                  updatedAt: new Date().toISOString(),
                }
              : prev
          );
        }
      } else {
        const failureJson =
          json && typeof json === "object" && "result" in json
            ? (json as { result: Phase2ExecutionResult }).result
            : null;
        if (failureJson?.refusalReason) {
          setPhase2Refusal(failureJson.refusalReason);
        }
        const errMsg =
          failureJson?.reason ?? "Phase 2 Maklumat Am attempt failed.";
        setErrorMessage(errMsg);
      }
    } catch {
      setErrorMessage("Network failure. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [jobId]);

  // Phase 4 Bahagian B fixed-rent handler (Milestone B12).
  const handleExecutePhase4BahagianB = useCallback(async () => {
    setBusy("phase4-bahagian-b");
    setErrorMessage(null);
    setCompletedNotice(null);
    setPhase4BahagianBRefusal(null);
    try {
      const res = await fetch(
        `/api/intake/${encodeURIComponent(jobId)}/supervised-run/execute-phase-4-bahagian-b-fixed-rent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      let json: unknown;
      try { json = await res.json(); } catch { json = null; }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "result" in json
      ) {
        const successJson = json as {
          result: Phase4BahagianBExecutionResult;
        };
        if (successJson.result.status === "saved") {
          setCompletedNotice(PHASE_4_BAHAGIAN_B_EXECUTE_SUCCESS);
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  currentRunStage: "phase_4_bahagian_b_fixed_rent_saved",
                  updatedAt: new Date().toISOString(),
                }
              : prev
          );
        }
      } else {
        const failureJson =
          json && typeof json === "object" && "result" in json
            ? (json as { result: Phase4BahagianBExecutionResult }).result
            : null;
        if (failureJson?.refusalReason) {
          setPhase4BahagianBRefusal(failureJson.refusalReason);
        }
        const errMsg =
          failureJson?.reason ?? "Phase 4 Bahagian B save failed.";
        setErrorMessage(errMsg);
      }
    } catch {
      setErrorMessage("Network failure. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [jobId]);

  // Phase 3 tenant-individual handler (Milestone B11).
  const handleExecutePhase3Tenant = useCallback(async () => {
    setBusy("phase3-tenant");
    setErrorMessage(null);
    setCompletedNotice(null);
    setPhase3TenantRefusal(null);
    try {
      const res = await fetch(
        `/api/intake/${encodeURIComponent(jobId)}/supervised-run/execute-phase-3-tenant-individual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "result" in json
      ) {
        const successJson = json as {
          result: Phase3TenantExecutionResult;
        };
        if (successJson.result.status === "saved") {
          setCompletedNotice(PHASE_3_TENANT_EXECUTE_SUCCESS);
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  currentRunStage: "phase_3_tenant_individual_saved",
                  updatedAt: new Date().toISOString(),
                }
              : prev
          );
        }
      } else {
        const failureJson =
          json && typeof json === "object" && "result" in json
            ? (json as { result: Phase3TenantExecutionResult }).result
            : null;
        if (failureJson?.refusalReason) {
          setPhase3TenantRefusal(failureJson.refusalReason);
        }
        const errMsg =
          failureJson?.reason ?? "Phase 3 tenant-individual save failed.";
        setErrorMessage(errMsg);
      }
    } catch {
      setErrorMessage("Network failure. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [jobId]);

  // Phase 3 landlord-individual handler (Milestone B10).
  const handleExecutePhase3Landlord = useCallback(async () => {
    setBusy("phase3-landlord");
    setErrorMessage(null);
    setCompletedNotice(null);
    setPhase3LandlordRefusal(null);
    try {
      const res = await fetch(
        `/api/intake/${encodeURIComponent(jobId)}/supervised-run/execute-phase-3-landlord-individual`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (
        res.ok &&
        json &&
        typeof json === "object" &&
        "ok" in json &&
        (json as { ok: unknown }).ok === true &&
        "result" in json
      ) {
        const successJson = json as {
          result: Phase3LandlordExecutionResult;
        };
        if (successJson.result.status === "saved") {
          setCompletedNotice(PHASE_3_LANDLORD_EXECUTE_SUCCESS);
          // Optimistic local-state transition.
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  currentRunStage: "phase_3_landlord_individual_saved",
                  updatedAt: new Date().toISOString(),
                }
              : prev
          );
        }
      } else {
        const failureJson =
          json && typeof json === "object" && "result" in json
            ? (json as { result: Phase3LandlordExecutionResult }).result
            : null;
        if (failureJson?.refusalReason) {
          setPhase3LandlordRefusal(failureJson.refusalReason);
        }
        const errMsg =
          failureJson?.reason ?? "Phase 3 landlord-individual save failed.";
        setErrorMessage(errMsg);
      }
    } catch {
      setErrorMessage("Network failure. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [jobId]);

  const stageClass = `tpr-srs-stage-${viewModel.runStage}`;
  return (
    <section
      className={`tpr-srs ${stageClass}`}
      aria-label={viewModel.heading}
    >
      <header className="tpr-srs-header">
        <h3>{viewModel.heading}</h3>
        <span className={`tpr-srs-stage-badge ${stageClass}-badge`}>
          {viewModel.runStageLabel}
        </span>
      </header>

      <p className="tpr-srs-helper">{viewModel.helperText}</p>

      <div className="tpr-srs-info-grid">
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">Readiness verdict</span>
          <strong className="tpr-srs-info-value">
            {viewModel.readinessVerdictLabel}
          </strong>
        </div>
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">Instruction graph</span>
          <strong className="tpr-srs-info-value">
            {viewModel.instructionGraphVerdictLabel}
          </strong>
        </div>
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">Browser phase compatibility</span>
          <strong className="tpr-srs-info-value">
            {viewModel.browserPhaseCompatibilityLabel ?? "—"}
          </strong>
        </div>
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">First mutation approval</span>
          <strong className="tpr-srs-info-value">
            {viewModel.approvalStatusLabel}
          </strong>
        </div>
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">Last updated</span>
          <strong className="tpr-srs-info-value">
            {viewModel.lastUpdatedAt ?? "—"}
          </strong>
        </div>
        <div className="tpr-srs-info-cell">
          <span className="tpr-srs-info-label">Blocker codes</span>
          <strong className="tpr-srs-info-value">
            {viewModel.blockerCount}
          </strong>
        </div>
      </div>

      {viewModel.blockerCodes.length > 0 && (
        <ul className="tpr-srs-blocker-codes">
          {viewModel.blockerCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
      )}

      {viewModel.approveRefusalLabel && (
        <p className="tpr-srs-refusal" role="alert">
          {viewModel.approveRefusalLabel}
        </p>
      )}

      {viewModel.approvalCompletedNotice && (
        <p className="tpr-srs-approved-notice">
          <strong>{viewModel.approvalCompletedNotice}</strong>
        </p>
      )}

      {completedNotice && completedNotice !== viewModel.approvalCompletedNotice && (
        <p className="tpr-srs-approved-notice">
          <strong>{completedNotice}</strong>
        </p>
      )}

      {errorMessage && (
        <p className="tpr-srs-error" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="tpr-srs-action-row">
        <button
          type="button"
          className="tpr-srs-prepare-button"
          onClick={() => handlePrepare(false)}
          disabled={busy !== null}
        >
          {busy === "prepare"
            ? "Preparing…"
            : viewModel.prepareButtonLabel}
        </button>
        <button
          type="button"
          className="tpr-srs-prepare-with-browser-button"
          onClick={() => handlePrepare(true)}
          disabled={busy !== null}
          title="Prepare run session and snapshot the browser session via read-only CDP attach."
        >
          {busy === "prepare"
            ? "Preparing…"
            : `${viewModel.prepareButtonLabel} (with browser check)`}
        </button>
        <button
          type="button"
          className="tpr-srs-approve-button"
          onClick={handleApprove}
          disabled={busy !== null || !viewModel.approveButtonEnabled}
          title={
            viewModel.approveRefusalLabel ??
            viewModel.approvalButtonHelperWarning
          }
        >
          {busy === "approve"
            ? "Recording approval…"
            : viewModel.approveButtonLabel}
        </button>
      </div>

      <p className="tpr-srs-helper-warning">
        {viewModel.approvalButtonHelperWarning}
      </p>

      {/* ── Phase 2 Maklumat Am execution (Milestone B7) ─────────
          The first portal-mutating control. Tightly gated server-
          side AND client-side: button enabled only when the run
          session is in `first_mutation_approved` stage. The route
          re-enforces every precondition before any portal contact.
          The warning above the button is the brief's exact
          approved wording. */}
      <div className="tpr-srs-phase2">
        <p className="tpr-srs-phase2-warning" role="note">
          {PHASE_2_EXECUTE_WARNING}
        </p>
        <button
          type="button"
          className="tpr-srs-phase2-button"
          onClick={handleExecutePhase2}
          disabled={busy !== null || !phase2ButtonEnabled}
          title={
            phase2ButtonEnabled
              ? PHASE_2_EXECUTE_WARNING
              : "Approve First Portal Mutation before creating the portal draft."
          }
        >
          {busy === "phase2"
            ? "Creating portal draft…"
            : PHASE_2_EXECUTE_BUTTON_LABEL}
        </button>
        {state?.currentRunStage === "phase_2_maklumat_am_saved" && (
          <p className="tpr-srs-phase2-success" role="status">
            <strong>{PHASE_2_EXECUTE_SUCCESS}</strong>
          </p>
        )}
        {phase2Refusal && (
          <p className="tpr-srs-phase2-refusal" role="alert">
            <strong>Phase 2 Maklumat Am refused: </strong>
            <code>{phase2Refusal}</code> ·{" "}
            {PHASE_2_REASON_LABELS[phase2Refusal]}
          </p>
        )}
      </div>

      {/* ── Phase 3 landlord-individual row save (Milestone B10) ─
          The SECOND portal-mutating control. Disabled until
          Maklumat Am has been saved AND the landlord row hasn't
          already been saved. The route enforces the same gates
          server-side. The button NEVER triggers tenant rows,
          company rows, Bahagian B/C, Lampiran, Perakuan, Hantar,
          payment, or certificate retrieval — the route's executor
          surface is locked to the landlord-individual selectors. */}
      <div className="tpr-srs-phase3-landlord">
        <p className="tpr-srs-phase3-warning" role="note">
          {PHASE_3_LANDLORD_EXECUTE_WARNING}
        </p>
        <button
          type="button"
          className="tpr-srs-phase3-button"
          onClick={handleExecutePhase3Landlord}
          disabled={busy !== null || !phase3LandlordButtonEnabled}
          title={
            phase3LandlordRowAlreadySaved
              ? "Landlord row already saved."
              : phase3LandlordButtonEnabled
                ? PHASE_3_LANDLORD_EXECUTE_WARNING
                : "Save the Maklumat Am draft (Phase 2) before attempting the landlord row."
          }
        >
          {busy === "phase3-landlord"
            ? "Saving landlord row…"
            : PHASE_3_LANDLORD_EXECUTE_BUTTON_LABEL}
        </button>
        {phase3LandlordRowAlreadySaved && (
          <p className="tpr-srs-phase3-success" role="status">
            <strong>{PHASE_3_LANDLORD_EXECUTE_SUCCESS}</strong>
          </p>
        )}
        {phase3LandlordRefusal && (
          <p className="tpr-srs-phase3-refusal" role="alert">
            <strong>Phase 3 landlord-individual refused: </strong>
            <code>{phase3LandlordRefusal}</code> ·{" "}
            {PHASE_3_LANDLORD_REASON_LABELS[phase3LandlordRefusal]}
          </p>
        )}
      </div>

      {/* ── Phase 3 tenant-individual row save (Milestone B11) ───
          The THIRD portal-mutating control. Disabled until the
          landlord row has been saved AND the tenant row hasn't
          already been saved. The route enforces the same gates
          server-side. The button NEVER triggers another landlord
          row, company rows, Bahagian B/C, Lampiran, Perakuan,
          Hantar, payment, or certificate retrieval — the route's
          executor surface is locked to the tenant-individual
          selectors via the role-scoped resolution algorithm. */}
      <div className="tpr-srs-phase3-tenant">
        <p className="tpr-srs-phase3-warning" role="note">
          {PHASE_3_TENANT_EXECUTE_WARNING}
        </p>
        <button
          type="button"
          className="tpr-srs-phase3-button"
          onClick={handleExecutePhase3Tenant}
          disabled={busy !== null || !phase3TenantButtonEnabled}
          title={
            phase3TenantRowAlreadySaved
              ? "Tenant row already saved."
              : phase3TenantButtonEnabled
                ? PHASE_3_TENANT_EXECUTE_WARNING
                : "Save the landlord row before attempting the tenant row."
          }
        >
          {busy === "phase3-tenant"
            ? "Saving tenant row…"
            : PHASE_3_TENANT_EXECUTE_BUTTON_LABEL}
        </button>
        {phase3TenantRowAlreadySaved && (
          <p className="tpr-srs-phase3-success" role="status">
            <strong>{PHASE_3_TENANT_EXECUTE_SUCCESS}</strong>
          </p>
        )}
        {phase3TenantRefusal && (
          <p className="tpr-srs-phase3-refusal" role="alert">
            <strong>Phase 3 tenant-individual refused: </strong>
            <code>{phase3TenantRefusal}</code> ·{" "}
            {PHASE_3_TENANT_REASON_LABELS[phase3TenantRefusal]}
          </p>
        )}
      </div>

      {/* ── Phase 4 Bahagian B fixed-rent save (Milestone B12) ───
          The FOURTH portal-mutating control. Disabled until the
          tenant row has been saved AND Bahagian B hasn't already
          been saved AND the job is on the fixed-rent single-period
          path. The route enforces the same gates server-side. */}
      <div className="tpr-srs-phase4">
        <p className="tpr-srs-phase3-warning" role="note">
          {PHASE_4_BAHAGIAN_B_EXECUTE_WARNING}
        </p>
        <button
          type="button"
          className="tpr-srs-phase3-button"
          onClick={handleExecutePhase4BahagianB}
          disabled={busy !== null || !phase4BahagianBButtonEnabled}
          title={
            phase4BahagianBAlreadySaved
              ? "Bahagian B already saved."
              : phase4BahagianBButtonEnabled
                ? PHASE_4_BAHAGIAN_B_EXECUTE_WARNING
                : "Save the tenant row before attempting Bahagian B (fixed-rent single-period only)."
          }
        >
          {busy === "phase4-bahagian-b"
            ? "Saving Bahagian B…"
            : PHASE_4_BAHAGIAN_B_EXECUTE_BUTTON_LABEL}
        </button>
        {phase4BahagianBAlreadySaved && (
          <p className="tpr-srs-phase3-success" role="status">
            <strong>{PHASE_4_BAHAGIAN_B_EXECUTE_SUCCESS}</strong>
          </p>
        )}
        {phase4BahagianBRefusal && (
          <p className="tpr-srs-phase3-refusal" role="alert">
            <strong>Phase 4 Bahagian B refused: </strong>
            <code>{phase4BahagianBRefusal}</code> ·{" "}
            {PHASE_4_BAHAGIAN_B_REASON_LABELS[phase4BahagianBRefusal]}
          </p>
        )}
      </div>

      <footer className="tpr-srs-footer">
        <p>{viewModel.nonExecutionNote}</p>
      </footer>
    </section>
  );
}

// ─── Bahagian A Party Entry Plan Card (Milestone B8) ───────────────

const BAHAGIAN_A_PLAN_STATUS_LABEL: Record<
  TenancyBahagianAPartyPlan["overallStatus"],
  string
> = {
  ready_for_modal_mapping: "Ready for modal mapping",
  blocked_missing_party_data: "Blocked — party data missing",
  unsupported_party_type: "Unsupported party type",
  mapping_unknown: "Mapping unknown",
};

const BAHAGIAN_A_EXECUTOR_DRAFT_STATUS_LABEL: Record<
  BahagianAExecutorDraftStatus,
  string
> = {
  blocked_missing_party_data: "Blocked — party data missing",
  blocked_missing_selector: "Blocked — selector missing",
  selectors_captured: "Selectors captured",
  ready_for_next_execution_milestone: "Ready for next execution milestone",
  planned_only: "Planned only",
};

const BAHAGIAN_A_NO_ROW_SAVED_NOTE =
  "No Bahagian A party row has been saved to e-Duti Setem.";

/**
 * Compact internal preview of the next supervised execution phase.
 * Operator-only; not surfaced on the public receipt.
 *
 * Reads:
 *   - The party plan from `buildTenancyBahagianAPartyPlan` (pure).
 *   - The B8 field-mapping certainty summary for the two registries
 *     present at this evidence level.
 *
 * Renders:
 *   - Expected party count + role split (L · T).
 *   - Plan status (overall verdict).
 *   - Per-party plan rows with row-count expectation and missing
 *     internal field count (clicking opens a details disclosure
 *     listing the missing keys).
 *   - Selector certainty summary across both party-type registries.
 *   - The closed-vocabulary "no row saved" note.
 *
 * Never executes any portal action.
 */
function BahagianAPartyEntryPlanCard({
  plan,
  executorDraft,
}: {
  plan: TenancyBahagianAPartyPlan;
  executorDraft: BahagianAExecutorDraftBundle;
}) {
  const individualSummary: BahagianAMappingCertaintySummary = useMemo(
    () => summarizeBahagianAFieldMapping(BAHAGIAN_A_INDIVIDUAL_REGISTRY),
    []
  );
  const ssmSummary: BahagianAMappingCertaintySummary = useMemo(
    () => summarizeBahagianAFieldMapping(BAHAGIAN_A_COMPANY_SSM_REGISTRY),
    []
  );
  const missingMappingCategories: string[] = useMemo(() => {
    const cats: string[] = [];
    if (individualSummary.unknownSelectors > 0) {
      cats.push(
        `Individual: ${individualSummary.unknownSelectors} unknown selectors`
      );
    }
    if (individualSummary.unknownOptionValueLists > 0) {
      cats.push(
        `Individual: ${individualSummary.unknownOptionValueLists} unknown option-value lists`
      );
    }
    if (ssmSummary.unknownSelectors > 0) {
      cats.push(
        `SSM: ${ssmSummary.unknownSelectors} unknown selectors`
      );
    }
    if (ssmSummary.unknownOptionValueLists > 0) {
      cats.push(
        `SSM: ${ssmSummary.unknownOptionValueLists} unknown option-value lists`
      );
    }
    return cats;
  }, [individualSummary, ssmSummary]);

  const nextOperatorAction: string = useMemo(() => {
    if (plan.overallStatus === "blocked_missing_party_data") {
      return "Capture the missing party fields above (gender, citizenship, NRIC sub-type, etc.) before Bahagian A execution can proceed.";
    }
    if (plan.overallStatus === "unsupported_party_type") {
      return "One or more parties is `company_non_ssm` — currently unsupported by the Bahagian A planner. Convert the party to `individual` or `company_ssm`, or wait for a future milestone.";
    }
    if (
      executorDraft.bundleStatus === "ready_for_next_execution_milestone"
    ) {
      return "Individual-party modal mapping is complete and the executor draft is ready. The next milestone may wire a controlled Bahagian A row-save route. SSM modal selectors are still pending live capture.";
    }
    if (executorDraft.bundleStatus === "blocked_missing_selector") {
      return "Some Bahagian A selectors are still missing. Capture the SSM modal live before promoting executor-draft entries to executable.";
    }
    return "Capture the missing party data so the executor draft can advance to ready_for_next_execution_milestone.";
  }, [plan.overallStatus, executorDraft.bundleStatus]);

  return (
    <section className="tpr-bahagian-a-plan" aria-label="Bahagian A Party Entry Plan">
      <header>
        <h3>Bahagian A Party Entry Plan</h3>
        <p className="tpr-bahagian-a-plan-note" role="note">
          {BAHAGIAN_A_NO_ROW_SAVED_NOTE}
        </p>
      </header>

      <dl className="tpr-bahagian-a-plan-meta">
        <div>
          <dt>Expected party count</dt>
          <dd>{plan.expectedPartyCount}</dd>
        </div>
        <div>
          <dt>Landlord(s)</dt>
          <dd>{plan.landlordCount}</dd>
        </div>
        <div>
          <dt>Tenant(s)</dt>
          <dd>{plan.tenantCount}</dd>
        </div>
        <div>
          <dt>Plan status</dt>
          <dd>
            <code>{plan.overallStatus}</code> ·{" "}
            {BAHAGIAN_A_PLAN_STATUS_LABEL[plan.overallStatus]}
          </dd>
        </div>
      </dl>

      {plan.parties.length > 0 ? (
        <table className="tpr-bahagian-a-plan-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Role</th>
              <th>Type</th>
              <th>Name</th>
              <th>Row after</th>
              <th>Status</th>
              <th>Missing fields</th>
            </tr>
          </thead>
          <tbody>
            {plan.parties.map((p) => (
              <tr key={p.ordinal}>
                <td>{p.ordinal}</td>
                <td>{p.role}</td>
                <td>
                  <code>{p.type}</code>
                </td>
                <td>{p.partyName ?? "—"}</td>
                <td>{p.expectedRowCountAfter}</td>
                <td>
                  <code>{p.planStatus}</code>
                </td>
                <td>
                  {p.missingInternalFields.length === 0 ? (
                    "—"
                  ) : (
                    <details>
                      <summary>{p.missingInternalFields.length}</summary>
                      <ul>
                        {p.missingInternalFields.map((k) => (
                          <li key={k}>
                            <code>{k}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tpr-bahagian-a-plan-empty">
          No parties captured yet. Bahagian A requires at least one
          party.
        </p>
      )}

      <details className="tpr-bahagian-a-plan-mapping">
        <summary>Selector certainty summary</summary>
        <ul>
          <li>
            <strong>Individual:</strong> {individualSummary.totalEntries}{" "}
            entries · selectors observed/inferred/unknown ={" "}
            {individualSummary.observedSelectors}/
            {individualSummary.inferredSelectors}/
            {individualSummary.unknownSelectors} · option-value lists
            observed/inferred/unknown ={" "}
            {individualSummary.observedOptionValueLists}/
            {individualSummary.inferredOptionValueLists}/
            {individualSummary.unknownOptionValueLists} · executable ={" "}
            {individualSummary.executableEntries}
          </li>
          <li>
            <strong>Company SSM:</strong> {ssmSummary.totalEntries} entries ·
            selectors observed/inferred/unknown ={" "}
            {ssmSummary.observedSelectors}/{ssmSummary.inferredSelectors}/
            {ssmSummary.unknownSelectors} · option-value lists
            observed/inferred/unknown ={" "}
            {ssmSummary.observedOptionValueLists}/
            {ssmSummary.inferredOptionValueLists}/
            {ssmSummary.unknownOptionValueLists} · executable ={" "}
            {ssmSummary.executableEntries}
          </li>
        </ul>
        {missingMappingCategories.length > 0 && (
          <>
            <p>
              <strong>Missing mapping categories:</strong>
            </p>
            <ul>
              {missingMappingCategories.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </details>

      {plan.blockers.length > 0 && (
        <details className="tpr-bahagian-a-plan-blockers" open>
          <summary>Blockers ({plan.blockers.length})</summary>
          <ul>
            {plan.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ── B9 modal-mapping summary ─────────────────────────────
          Reports how much of the live Tambah Individu modal we've
          mapped, which role-scoped triggers are observed, and the
          executor-draft readiness. */}
      <details className="tpr-bahagian-a-plan-modal-mapping" open>
        <summary>
          Modal mapping ·{" "}
          <code>
            {BAHAGIAN_A_EXECUTOR_DRAFT_STATUS_LABEL[
              executorDraft.bundleStatus
            ] ?? executorDraft.bundleStatus}
          </code>
        </summary>
        <ul>
          <li>
            <strong>Observed selectors (individual modal):</strong>{" "}
            {individualSummary.observedSelectors}/
            {individualSummary.totalEntries}
          </li>
          <li>
            <strong>Executable individual-modal entries:</strong>{" "}
            {individualSummary.executableEntries}/
            {individualSummary.totalEntries}
          </li>
          <li>
            <strong>Landlord add trigger observed:</strong>{" "}
            {BAHAGIAN_A_MODAL_TRIGGERS.some(
              (t) =>
                t.role === "landlord" &&
                t.partyType === "individual" &&
                t.certainty === "observed"
            )
              ? "yes"
              : "no"}
          </li>
          <li>
            <strong>Tenant add trigger observed:</strong>{" "}
            {BAHAGIAN_A_MODAL_TRIGGERS.some(
              (t) =>
                t.role === "tenant" &&
                t.partyType === "individual" &&
                t.certainty === "observed"
            )
              ? "yes"
              : "no"}
          </li>
          <li>
            <strong>Executor-draft landlord plan:</strong>{" "}
            <code>{executorDraft.landlord.status}</code> ·{" "}
            {executorDraft.landlord.steps.length} planned steps
          </li>
          <li>
            <strong>Executor-draft tenant plan:</strong>{" "}
            <code>{executorDraft.tenant.status}</code> ·{" "}
            {executorDraft.tenant.steps.length} planned steps
          </li>
          <li>
            <strong>Observed-but-unmapped portal fields:</strong>{" "}
            {BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS.length} (e.g.{" "}
            {BAHAGIAN_A_OBSERVED_UNMAPPED_FIELDS.slice(0, 3)
              .map((f) => f.portalFieldKey)
              .join(", ")}
            )
          </li>
        </ul>
        <p>
          <em>{executorDraft.landlord.warning}</em>
        </p>
      </details>

      <footer className="tpr-bahagian-a-plan-footer">
        <p>
          <strong>Next required action:</strong> {nextOperatorAction}
        </p>
        <p className="tpr-bahagian-a-plan-no-save-warning" role="note">
          <strong>{BAHAGIAN_A_NO_ROW_SAVED_NOTE}</strong>
        </p>
      </footer>
    </section>
  );
}
