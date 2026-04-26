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
  type TenancyPortalReadinessReport,
  type TenancyPortalReadinessState,
  type TenancyPortalSection,
} from "../../../lib/tenancy-portal-requirements";
import type {
  StampingJob,
  TenancyPortalBuildingType,
  TenancyPortalDescriptionType,
  TenancyPortalDetails,
  TenancyPortalFurnishedStatus,
  TenancyPortalIdentityType,
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
    body.instrument = {
      instrumentDate: d.instrumentDate.trim(),
      duplicateCopies: Number(d.duplicateCopies || "0"),
      portalDescriptionType: d.portalDescriptionType,
      rentSchedule,
    };
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
  /** Subset of the StampingJob the panel actually needs. Type-only. */
  job: Pick<
    StampingJob,
    "tenancyPortalDetails" | "storagePath" | "documentCategory"
  >;
}

export function TenancyPortalPanel({ jobId, job }: PanelProps) {
  const initialReport = useMemo(
    () => evaluateTenancyPortalReadiness(job),
    [job]
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    buildInitialDraft(job.tenancyPortalDetails)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The draft can be evaluated in real time so the operator sees the
  // gap report update as they fill in fields. We feed the live draft
  // into the same evaluator using the same shape the API would persist.
  const liveReport: TenancyPortalReadinessReport = useMemo(() => {
    if (!editing) return initialReport;
    const livePayload = buildSavePayload(draft);
    return evaluateTenancyPortalReadiness({
      tenancyPortalDetails: {
        updatedAt: new Date().toISOString(),
        parties: (livePayload.parties as TenancyPortalParty[]) ?? [],
        instrument: livePayload.instrument as
          | TenancyPortalDetails["instrument"]
          | undefined,
        property: livePayload.property as TenancyPortalProperty | undefined,
      },
      storagePath: job.storagePath,
      documentCategory: job.documentCategory,
    });
  }, [editing, draft, initialReport, job.storagePath, job.documentCategory]);

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
        <span
          className={`tpr-overall tpr-overall-${liveReport.overall}`}
          title={`evaluated ${liveReport.evaluatedAt}`}
        >
          {liveReport.overall === "ready"
            ? "Portal data ready"
            : "Portal data blocked"}
        </span>
      </header>
      <p className="tpr-intro">
        Internal operator view. Captures the structured Sewa/Pajakan
        fields that the e-Duti Setem portal needs. Not surfaced to the
        user. No portal action runs from this panel.
      </p>

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
