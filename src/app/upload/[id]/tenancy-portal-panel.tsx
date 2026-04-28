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

import { useMemo, useState } from "react";
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
import type {
  StampingJob,
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalIdentityType,
  TenancyPortalInstrumentNameCode,
  TenancyPortalNationality,
  TenancyPortalParty,
  TenancyPortalPartyRole,
  TenancyPortalPartyType,
  TenancyPortalProperty,
  TenancyPortalPropertyType,
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
    body.property = property;
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
