"use client";

import React, { useState } from "react";
import {
  TenancyFormData,
  TENANCY_FORM_DEFAULTS,
  PartyType,
  LandlordParty,
  TenantParty,
  BLANK_LANDLORD_PARTY,
  BLANK_TENANT_PARTY,
  MAX_PARTIES_PER_SIDE,
  UtilityResponsibility,
  AirConServicingResponsibility,
  InventoryMode,
  InventoryCategory,
  InventoryItem,
  INVENTORY_CATEGORIES,
  SUGGESTED_ITEMS,
} from "../../lib/tenancy-types";
import { buildAgreement, AgreementDoc } from "../../lib/agreement-template";
import {
  buildWhatsAppUrl,
  generatePageMessage,
  previewPageMessage,
} from "../../lib/whatsapp";

/**
 * Generate Tenancy Agreement — Form + Review + Agreement Preview
 *
 * view === "form"      → input form
 * view === "review"    → structured data review
 * view === "agreement" → Pavilion-faithful agreement preview
 */
export default function GeneratePage() {
  const [form, setForm] = useState<TenancyFormData>({
    ...TENANCY_FORM_DEFAULTS,
  });

  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [view, setView] = useState<"form" | "review" | "agreement">("form");

  // ─── Helpers ──────────────────────────────────────────────────────

  function setField<K extends keyof TenancyFormData>(
    key: K,
    value: TenancyFormData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function nameLabel(partyType: PartyType): string {
    return partyType === "individual" ? "Full Name" : "Company Name";
  }

  function idLabel(partyType: PartyType): string {
    return partyType === "individual" ? "NRIC No." : "Company Registration No.";
  }

  /**
   * Auto-format NRIC input as YYMMDD-PB-###G (e.g. 880101-14-5678).
   * Strips non-digits, caps at 12 digits, inserts hyphens at positions 6 and 8.
   * Applied only when party type is individual; company reg numbers pass through untouched.
   */
  function formatNricInput(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 12);
    if (digits.length <= 6) return digits;
    if (digits.length <= 8) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
    return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  }

  // ─── Party count + field helpers ──────────────────────────────────

  /**
   * Change the landlord count. Grows the array with blank parties or
   * truncates from the end. Always keeps at least 1 entry.
   */
  function setLandlordCount(n: number) {
    const target = Math.max(1, Math.min(MAX_PARTIES_PER_SIDE, n));
    setForm((prev) => {
      const current = prev.landlords;
      if (target === current.length) return prev;
      if (target > current.length) {
        const added = Array.from({ length: target - current.length }, () => ({ ...BLANK_LANDLORD_PARTY }));
        return { ...prev, landlords: [...current, ...added] };
      }
      return { ...prev, landlords: current.slice(0, target) };
    });
  }

  /** Change the tenant count. Same semantics as setLandlordCount. */
  function setTenantCount(n: number) {
    const target = Math.max(1, Math.min(MAX_PARTIES_PER_SIDE, n));
    setForm((prev) => {
      const current = prev.tenants;
      if (target === current.length) return prev;
      if (target > current.length) {
        const added = Array.from({ length: target - current.length }, () => ({ ...BLANK_TENANT_PARTY }));
        return { ...prev, tenants: [...current, ...added] };
      }
      return { ...prev, tenants: current.slice(0, target) };
    });
  }

  /** Update one field on one landlord party by index. */
  function setLandlordField<K extends keyof LandlordParty>(
    idx: number,
    key: K,
    value: LandlordParty[K],
  ) {
    setForm((prev) => {
      const next = prev.landlords.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      return { ...prev, landlords: next };
    });
  }

  /** Update one field on one tenant party by index. */
  function setTenantField<K extends keyof TenantParty>(
    idx: number,
    key: K,
    value: TenantParty[K],
  ) {
    setForm((prev) => {
      const next = prev.tenants.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      return { ...prev, tenants: next };
    });
  }

  // ─── Inventory helpers ────────────────────────────────────────────

  function addInventoryItem(category: InventoryCategory, itemName: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setForm((prev) => ({
      ...prev,
      inventoryItems: [
        ...prev.inventoryItems,
        { id, category, itemName, quantity: 1, photos: [] },
      ],
    }));
  }

  function removeInventoryItem(id: string) {
    setForm((prev) => ({
      ...prev,
      inventoryItems: prev.inventoryItems.filter((it) => it.id !== id),
    }));
  }

  function updateInventoryItemQty(id: string, qty: number) {
    setForm((prev) => ({
      ...prev,
      inventoryItems: prev.inventoryItems.map((it) =>
        it.id === id ? { ...it, quantity: Math.max(1, qty) } : it
      ),
    }));
  }

  function updateInventoryItemPhotos(id: string, files: FileList | null) {
    if (!files) return;
    setForm((prev) => ({
      ...prev,
      inventoryItems: prev.inventoryItems.map((it) =>
        it.id === id ? { ...it, photos: [...it.photos, ...Array.from(files)] } : it
      ),
    }));
  }

  function addUploadFile(files: FileList | null) {
    if (!files) return;
    setForm((prev) => ({
      ...prev,
      inventoryUploadFiles: [...prev.inventoryUploadFiles, ...Array.from(files)],
    }));
  }

  function removeUploadFile(index: number) {
    setForm((prev) => ({
      ...prev,
      inventoryUploadFiles: prev.inventoryUploadFiles.filter((_, i) => i !== index),
    }));
  }

  // ─── Validation ───────────────────────────────────────────────────

  function validate(): Partial<Record<string, string>> {
    const e: Partial<Record<string, string>> = {};

    // Agreement date
    if (!form.agreementDate.trim()) e.agreementDate = "Required.";

    // Property
    if (!form.propertyAddress.trim()) e.propertyAddress = "Required.";

    // Landlords (dynamic — one validation set per party)
    form.landlords.forEach((p, i) => {
      if (!p.name.trim()) e[`landlord${i}Name`] = "Required.";
      if (!p.idNumber.trim()) e[`landlord${i}IdNumber`] = "Required.";
      if (!p.address.trim()) e[`landlord${i}Address`] = "Required.";
    });
    if (!form.landlordBankName.trim()) e.landlordBankName = "Required.";
    if (!form.landlordBankAccountNumber.trim()) e.landlordBankAccountNumber = "Required.";
    if (!form.landlordBankAccountHolderName.trim()) e.landlordBankAccountHolderName = "Required.";

    // Tenants (dynamic — one validation set per party)
    form.tenants.forEach((p, i) => {
      if (!p.name.trim()) e[`tenant${i}Name`] = "Required.";
      if (!p.idNumber.trim()) e[`tenant${i}IdNumber`] = "Required.";
      if (!p.address.trim()) e[`tenant${i}Address`] = "Required.";
    });

    // Tenant NRIC uploads are optional — Annexure A is included only when at least one side is uploaded.

    // Tenancy terms
    if (!form.monthlyRent.trim()) {
      e.monthlyRent = "Required.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.monthlyRent.trim())) {
      e.monthlyRent = "Enter a valid amount (e.g. 1500 or 1500.50).";
    }

    if (!form.leaseMonths.trim()) {
      e.leaseMonths = "Required.";
    } else if (!/^\d+$/.test(form.leaseMonths.trim())) {
      e.leaseMonths = "Enter a whole number of months.";
    } else if (parseInt(form.leaseMonths.trim(), 10) === 0) {
      e.leaseMonths = "Must be at least 1 month.";
    }

    if (!form.commencementDate.trim()) e.commencementDate = "Required.";

    if (!form.securityDeposit.trim()) {
      e.securityDeposit = "Required.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.securityDeposit.trim())) {
      e.securityDeposit = "Enter a valid amount (e.g. 3000 or 3000.00).";
    }

    if (!form.utilityDeposit.trim()) {
      e.utilityDeposit = "Required (enter 0 if not applicable).";
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.utilityDeposit.trim())) {
      e.utilityDeposit = "Enter a valid amount (e.g. 500 or 0).";
    }
    if (form.accessCardDeposit.trim() && !/^\d+(\.\d{1,2})?$/.test(form.accessCardDeposit.trim())) {
      e.accessCardDeposit = "Enter a valid amount or leave blank.";
    }

    // Renewal
    if (form.hasOptionToRenew) {
      if (form.optionToRenewTermMonths === null || form.optionToRenewTermMonths < 1) {
        e.optionToRenewTermMonths = "Enter a positive number of months.";
      }
    }

    return e;
  }

  // ─── Submit ───────────────────────────────────────────────────────

  function handleSubmit() {
    const validationErrors = validate();
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setView("review");
  }

  // ─── Render ───────────────────────────────────────────────────────

  if (view === "review") {
    return (
      <main>
        <ReviewView
          form={form}
          onBack={() => setView("form")}
          onGeneratePreview={() => setView("agreement")}
        />
      </main>
    );
  }

  if (view === "agreement") {
    return (
      <main>
        <AgreementPreview form={form} onBack={() => setView("review")} />
      </main>
    );
  }

  return (
    <main>
      <h1>WeStamp — Generate Tenancy Agreement</h1>
      <p className="subtitle">
        Residential tenancy agreement · Fill in all required fields below
      </p>

      <a href="/" className="back-link">
        &larr; Back to Stamp Duty Calculator
      </a>

      <div className="cta-lawyer-inline">
        Need custom clauses or flexible terms?{" "}
        <a
          href={buildWhatsAppUrl(
            generatePageMessage(form.propertyAddress, form.monthlyRent)
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          Speak to a lawyer on WhatsApp &rarr;
        </a>
      </div>

      {/* ── Agreement Date ───────────────────────────────────────── */}
      <fieldset>
        <legend>Agreement Date</legend>
        <div className="form-group">
          <label htmlFor="agreementDate">
            Date of Agreement
            <span className="label-hint"> (defaults to today — editable)</span>
          </label>
          <input
            id="agreementDate"
            type="date"
            value={form.agreementDate}
            onChange={(e) => setField("agreementDate", e.target.value)}
            className={errors.agreementDate ? "input-error" : ""}
          />
          {errors.agreementDate && <p className="field-error">{errors.agreementDate}</p>}
        </div>
      </fieldset>

      {/* ── Property ─────────────────────────────────────────────── */}
      <fieldset>
        <legend>Property Details</legend>
        <div className="form-group">
          <label htmlFor="propertyAddress">
            Property Address
            <span className="label-hint"> (full address of the premises)</span>
          </label>
          <input
            id="propertyAddress"
            type="text"
            value={form.propertyAddress}
            onChange={(e) => setField("propertyAddress", e.target.value)}
            placeholder="e.g. No. 12, Jalan Example 1, Taman Example, 50450 Kuala Lumpur"
            className={errors.propertyAddress ? "input-error" : ""}
          />
          <p className="field-note">Use the property address stated in the sale and purchase agreement or other title/source document.</p>
          {errors.propertyAddress && <p className="field-error">{errors.propertyAddress}</p>}
        </div>
      </fieldset>

      {/* ── Landlords (1..MAX) ───────────────────────────────────── */}
      <fieldset>
        <legend>Landlord Details</legend>

        <div className="form-group">
          <label htmlFor="landlordCount">
            Number of Landlords
            <span className="label-hint"> (for co-owners / joint landlords)</span>
          </label>
          <select
            id="landlordCount"
            value={form.landlords.length}
            onChange={(e) => setLandlordCount(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: MAX_PARTIES_PER_SIDE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {form.landlords.map((party, idx) => (
          <LandlordPartyFields
            key={idx}
            index={idx}
            total={form.landlords.length}
            party={party}
            errors={errors}
            setLandlordField={setLandlordField}
            formatNricInput={formatNricInput}
            nameLabel={nameLabel}
            idLabel={idLabel}
          />
        ))}
      </fieldset>

      {/* ── Bank Account for Rent ────────────────────────────────── */}
      <fieldset>
        <legend>Bank Account for Rent</legend>
        <p className="fieldset-note">Rent is paid into one nominated account.</p>

        <div className="form-group">
          <label htmlFor="landlordBankName">Bank Name</label>
          <input
            id="landlordBankName"
            type="text"
            value={form.landlordBankName}
            onChange={(e) => setField("landlordBankName", e.target.value)}
            placeholder="e.g. Maybank"
            className={errors.landlordBankName ? "input-error" : ""}
          />
          {errors.landlordBankName && <p className="field-error">{errors.landlordBankName}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="landlordBankAccountNumber">Bank Account Number</label>
          <input
            id="landlordBankAccountNumber"
            type="text"
            value={form.landlordBankAccountNumber}
            onChange={(e) => setField("landlordBankAccountNumber", e.target.value)}
            placeholder="e.g. 1234567890"
            className={errors.landlordBankAccountNumber ? "input-error" : ""}
          />
          {errors.landlordBankAccountNumber && <p className="field-error">{errors.landlordBankAccountNumber}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="landlordBankAccountHolderName">
            Account Holder Name
            <span className="label-hint"> (as it appears on the bank account)</span>
          </label>
          <input
            id="landlordBankAccountHolderName"
            type="text"
            value={form.landlordBankAccountHolderName}
            onChange={(e) => setField("landlordBankAccountHolderName", e.target.value)}
            placeholder="e.g. Ahmad bin Abdullah"
            className={errors.landlordBankAccountHolderName ? "input-error" : ""}
          />
          {errors.landlordBankAccountHolderName && <p className="field-error">{errors.landlordBankAccountHolderName}</p>}
        </div>
      </fieldset>

      {/* ── Tenants (1..MAX) ─────────────────────────────────────── */}
      <fieldset>
        <legend>Tenant Details</legend>

        <div className="form-group">
          <label htmlFor="tenantCount">
            Number of Tenants
            <span className="label-hint"> (for joint tenants)</span>
          </label>
          <select
            id="tenantCount"
            value={form.tenants.length}
            onChange={(e) => setTenantCount(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: MAX_PARTIES_PER_SIDE }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {form.tenants.map((party, idx) => (
          <TenantPartyFields
            key={idx}
            index={idx}
            total={form.tenants.length}
            party={party}
            errors={errors}
            setTenantField={setTenantField}
            formatNricInput={formatNricInput}
            nameLabel={nameLabel}
            idLabel={idLabel}
          />
        ))}
      </fieldset>

      {/* ── Tenancy Terms ────────────────────────────────────────── */}
      <fieldset>
        <legend>Tenancy Terms</legend>

        <div className="form-group">
          <label htmlFor="monthlyRent">
            Monthly Rent
            <span className="label-hint"> (RM, e.g. 1500 or 1500.50)</span>
          </label>
          <input
            id="monthlyRent"
            type="text"
            inputMode="decimal"
            value={form.monthlyRent}
            onChange={(e) => setField("monthlyRent", e.target.value)}
            placeholder="e.g. 1500"
            className={errors.monthlyRent ? "input-error" : ""}
          />
          {errors.monthlyRent && <p className="field-error">{errors.monthlyRent}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="leaseMonths">
            Lease Duration
            <span className="label-hint"> (months, e.g. 12)</span>
          </label>
          <input
            id="leaseMonths"
            type="text"
            inputMode="numeric"
            value={form.leaseMonths}
            onChange={(e) => setField("leaseMonths", e.target.value)}
            placeholder="e.g. 12"
            className={errors.leaseMonths ? "input-error" : ""}
          />
          {errors.leaseMonths && <p className="field-error">{errors.leaseMonths}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="commencementDate">Commencement Date</label>
          <input
            id="commencementDate"
            type="date"
            value={form.commencementDate}
            onChange={(e) => setField("commencementDate", e.target.value)}
            className={errors.commencementDate ? "input-error" : ""}
          />
          {errors.commencementDate && (
            <p className="field-error">{errors.commencementDate}</p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="rentDueDayOfMonth">
            Rent Due Date
            <span className="label-hint"> (recurring day of each month)</span>
          </label>
          <select
            id="rentDueDayOfMonth"
            value={form.rentDueDayOfMonth}
            onChange={(e) => setField("rentDueDayOfMonth", parseInt(e.target.value, 10))}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <p className="field-note">The 7th day of each month is commonly used.</p>
        </div>

        <div className="form-group">
          <label htmlFor="securityDeposit">
            Security Deposit
            <span className="label-hint"> (RM)</span>
          </label>
          <input
            id="securityDeposit"
            type="text"
            inputMode="decimal"
            value={form.securityDeposit}
            onChange={(e) => setField("securityDeposit", e.target.value)}
            placeholder="e.g. 3000"
            className={errors.securityDeposit ? "input-error" : ""}
          />
          {errors.securityDeposit && <p className="field-error">{errors.securityDeposit}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="utilityDeposit">
            Utility Deposit
            <span className="label-hint"> (RM — enter 0 if not applicable)</span>
          </label>
          <input
            id="utilityDeposit"
            type="text"
            inputMode="decimal"
            value={form.utilityDeposit}
            onChange={(e) => setField("utilityDeposit", e.target.value)}
            placeholder="e.g. 500"
            className={errors.utilityDeposit ? "input-error" : ""}
          />
          {errors.utilityDeposit && <p className="field-error">{errors.utilityDeposit}</p>}
        </div>

        <div className="form-group">
          <label htmlFor="accessCardDeposit">
            Access Card Deposit
            <span className="label-hint"> (RM, optional — leave blank if not applicable)</span>
          </label>
          <input
            id="accessCardDeposit"
            type="text"
            inputMode="decimal"
            value={form.accessCardDeposit}
            onChange={(e) => setField("accessCardDeposit", e.target.value)}
            placeholder="e.g. 100"
            className={errors.accessCardDeposit ? "input-error" : ""}
          />
          {errors.accessCardDeposit && <p className="field-error">{errors.accessCardDeposit}</p>}
        </div>
      </fieldset>

      {/* ── Option to Renew ──────────────────────────────────────── */}
      <fieldset>
        <legend>Option to Renew</legend>
        <div className="renewal-toggle">
          <input
            id="hasOptionToRenew"
            type="checkbox"
            checked={form.hasOptionToRenew}
            onChange={(e) => {
              setField("hasOptionToRenew", e.target.checked);
              if (!e.target.checked) {
                setField("optionToRenewTermMonths", null);
              }
            }}
          />
          <label htmlFor="hasOptionToRenew">Include option to renew</label>
        </div>
        {form.hasOptionToRenew && (
          <div className="form-group">
            <label htmlFor="optionToRenewTermMonths">
              Renewal Term
              <span className="label-hint"> (months, e.g. 12)</span>
            </label>
            <input
              id="optionToRenewTermMonths"
              type="text"
              inputMode="numeric"
              value={form.optionToRenewTermMonths !== null ? String(form.optionToRenewTermMonths) : ""}
              onChange={(e) => {
                const val = e.target.value.trim();
                if (val === "") {
                  setField("optionToRenewTermMonths", null);
                } else {
                  const n = parseInt(val, 10);
                  if (!isNaN(n)) setField("optionToRenewTermMonths", n);
                }
              }}
              placeholder="e.g. 12"
              className={errors.optionToRenewTermMonths ? "input-error" : ""}
            />
            {errors.optionToRenewTermMonths && <p className="field-error">{errors.optionToRenewTermMonths}</p>}
          </div>
        )}
      </fieldset>

      {/* ── Responsibilities ─────────────────────────────────────── */}
      <fieldset>
        <legend>Responsibilities</legend>

        <div className="form-group">
          <label htmlFor="utilityResponsibility">
            Utility Payments
            <span className="label-hint"> (who pays water, electricity, gas, internet)</span>
          </label>
          <select
            id="utilityResponsibility"
            value={form.utilityResponsibility}
            onChange={(e) => setField("utilityResponsibility", e.target.value as UtilityResponsibility)}
          >
            <option value="tenant">Tenant</option>
            <option value="landlord">Landlord</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="airConServicingResponsibility">
            Air-Con Servicing
            <span className="label-hint"> (periodic servicing responsibility)</span>
          </label>
          <select
            id="airConServicingResponsibility"
            value={form.airConServicingResponsibility}
            onChange={(e) => setField("airConServicingResponsibility", e.target.value as AirConServicingResponsibility)}
          >
            <option value="tenant">Tenant</option>
            <option value="landlord">Landlord</option>
          </select>
        </div>
      </fieldset>

      {/* ── Inventory ────────────────────────────────────────────── */}
      <fieldset>
        <legend>Inventory</legend>

        <div className="form-group inventory-mode-select">
          <label htmlFor="inventoryMode">Inventory</label>
          <select
            id="inventoryMode"
            value={form.inventoryMode}
            onChange={(e) => setField("inventoryMode", e.target.value as InventoryMode)}
          >
            <option value="none">No inventory</option>
            <option value="upload_own_inventory">Upload own inventory</option>
            <option value="build_inventory_in_app">Build inventory in app</option>
          </select>
        </div>

        {/* Upload mode */}
        {form.inventoryMode === "upload_own_inventory" && (
          <div className="form-group">
            <label>Upload inventory files (images, PDFs)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={(e) => addUploadFile(e.target.files)}
            />
            {form.inventoryUploadFiles.length > 0 && (
              <ul className="inventory-upload-list">
                {form.inventoryUploadFiles.map((f, i) => (
                  <li key={i}>
                    <span>{f.name}</span>
                    <button type="button" onClick={() => removeUploadFile(i)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Build-in-app mode */}
        {form.inventoryMode === "build_inventory_in_app" && (
          <InventoryBuilder
            items={form.inventoryItems}
            onAdd={addInventoryItem}
            onRemove={removeInventoryItem}
            onUpdateQty={updateInventoryItemQty}
            onUpdatePhotos={updateInventoryItemPhotos}
          />
        )}
      </fieldset>

      {/* ── Additional ───────────────────────────────────────────── */}
      <fieldset>
        <legend>Additional</legend>
        <div className="form-group">
          <label htmlFor="specialConditions">
            Special Conditions
            <span className="label-hint"> (optional — any additional terms)</span>
          </label>
          <textarea
            id="specialConditions"
            value={form.specialConditions}
            onChange={(e) => setField("specialConditions", e.target.value)}
            placeholder="e.g. No pets allowed. Tenant may not sublet any portion of the premises."
            rows={4}
            className={errors.specialConditions ? "input-error" : ""}
          />
          {errors.specialConditions && <p className="field-error">{errors.specialConditions}</p>}
        </div>
      </fieldset>

      {/* ── Submit ───────────────────────────────────────────────── */}
      <button type="button" onClick={handleSubmit}>
        Review Agreement Details
      </button>

      {Object.keys(errors).length > 0 && (
        <div className="result-section result-error">
          <p className="result-title">Please fix the errors above</p>
          <p className="result-reason">
            {Object.keys(errors).length} field(s) need attention.
          </p>
        </div>
      )}
    </main>
  );
}

// ─── Landlord Party Fields (per-party input block) ────────────────────

/**
 * Renders the input fields for ONE landlord party. Keys errors under
 * `landlord{index}{Field}` so each party has its own field-level errors
 * without collisions.
 */
function LandlordPartyFields({
  index,
  total,
  party,
  errors,
  setLandlordField,
  formatNricInput,
  nameLabel,
  idLabel,
}: {
  index: number;
  total: number;
  party: LandlordParty;
  errors: Partial<Record<string, string>>;
  setLandlordField: <K extends keyof LandlordParty>(idx: number, key: K, value: LandlordParty[K]) => void;
  formatNricInput: (raw: string) => string;
  nameLabel: (pt: PartyType) => string;
  idLabel: (pt: PartyType) => string;
}) {
  const prefix = `landlord${index}`;
  return (
    <div className="party-block">
      {total > 1 && <p className="party-block-heading">Landlord {index + 1}</p>}

      <div className="form-group">
        <label htmlFor={`${prefix}PartyType`}>Party Type</label>
        <select
          id={`${prefix}PartyType`}
          value={party.partyType}
          onChange={(e) => setLandlordField(index, "partyType", e.target.value as PartyType)}
        >
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}Name`}>{nameLabel(party.partyType)}</label>
        <input
          id={`${prefix}Name`}
          type="text"
          value={party.name}
          onChange={(e) => setLandlordField(index, "name", e.target.value)}
          placeholder={party.partyType === "individual" ? "e.g. Ahmad bin Abdullah" : "e.g. ABC Properties Sdn Bhd"}
          className={errors[`${prefix}Name`] ? "input-error" : ""}
        />
        {errors[`${prefix}Name`] && <p className="field-error">{errors[`${prefix}Name`]}</p>}
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}IdNumber`}>{idLabel(party.partyType)}</label>
        <input
          id={`${prefix}IdNumber`}
          type="text"
          inputMode={party.partyType === "individual" ? "numeric" : "text"}
          value={party.idNumber}
          onChange={(e) => {
            const next = party.partyType === "individual"
              ? formatNricInput(e.target.value)
              : e.target.value;
            setLandlordField(index, "idNumber", next);
          }}
          placeholder={party.partyType === "individual" ? "880101-14-5678" : "e.g. 202001012345 (1234567-A)"}
          maxLength={party.partyType === "individual" ? 14 : undefined}
          className={errors[`${prefix}IdNumber`] ? "input-error" : ""}
        />
        {errors[`${prefix}IdNumber`] && <p className="field-error">{errors[`${prefix}IdNumber`]}</p>}
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}Address`}>Correspondence Address</label>
        <input
          id={`${prefix}Address`}
          type="text"
          value={party.address}
          onChange={(e) => setLandlordField(index, "address", e.target.value)}
          placeholder="e.g. 10, Jalan Bukit Bintang, 55100 Kuala Lumpur"
          className={errors[`${prefix}Address`] ? "input-error" : ""}
        />
        {errors[`${prefix}Address`] && <p className="field-error">{errors[`${prefix}Address`]}</p>}
      </div>
    </div>
  );
}

// ─── Tenant Party Fields (per-party input block) ──────────────────────

/**
 * Renders the input fields for ONE tenant party. Keys errors under
 * `tenant{index}{Field}` so each party has its own field-level errors
 * without collisions. NRIC upload fields are rendered only when the
 * party is an individual; they remain optional for Annexure A inclusion.
 */
function TenantPartyFields({
  index,
  total,
  party,
  errors,
  setTenantField,
  formatNricInput,
  nameLabel,
  idLabel,
}: {
  index: number;
  total: number;
  party: TenantParty;
  errors: Partial<Record<string, string>>;
  setTenantField: <K extends keyof TenantParty>(idx: number, key: K, value: TenantParty[K]) => void;
  formatNricInput: (raw: string) => string;
  nameLabel: (pt: PartyType) => string;
  idLabel: (pt: PartyType) => string;
}) {
  const prefix = `tenant${index}`;
  return (
    <div className="party-block">
      {total > 1 && <p className="party-block-heading">Tenant {index + 1}</p>}

      <div className="form-group">
        <label htmlFor={`${prefix}PartyType`}>Party Type</label>
        <select
          id={`${prefix}PartyType`}
          value={party.partyType}
          onChange={(e) => setTenantField(index, "partyType", e.target.value as PartyType)}
        >
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}Name`}>{nameLabel(party.partyType)}</label>
        <input
          id={`${prefix}Name`}
          type="text"
          value={party.name}
          onChange={(e) => setTenantField(index, "name", e.target.value)}
          placeholder={party.partyType === "individual" ? "e.g. Lim Wei Ling" : "e.g. XYZ Trading Sdn Bhd"}
          className={errors[`${prefix}Name`] ? "input-error" : ""}
        />
        {errors[`${prefix}Name`] && <p className="field-error">{errors[`${prefix}Name`]}</p>}
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}IdNumber`}>{idLabel(party.partyType)}</label>
        <input
          id={`${prefix}IdNumber`}
          type="text"
          inputMode={party.partyType === "individual" ? "numeric" : "text"}
          value={party.idNumber}
          onChange={(e) => {
            const next = party.partyType === "individual"
              ? formatNricInput(e.target.value)
              : e.target.value;
            setTenantField(index, "idNumber", next);
          }}
          placeholder={party.partyType === "individual" ? "880101-14-5678" : "e.g. 202301054321 (5432109-B)"}
          maxLength={party.partyType === "individual" ? 14 : undefined}
          className={errors[`${prefix}IdNumber`] ? "input-error" : ""}
        />
        {errors[`${prefix}IdNumber`] && <p className="field-error">{errors[`${prefix}IdNumber`]}</p>}
      </div>

      <div className="form-group">
        <label htmlFor={`${prefix}Address`}>
          Correspondence Address
          <span className="label-hint"> (pre-tenancy address)</span>
        </label>
        <input
          id={`${prefix}Address`}
          type="text"
          value={party.address}
          onChange={(e) => setTenantField(index, "address", e.target.value)}
          placeholder="e.g. 5, Lorong Setapak, 53000 Kuala Lumpur"
          className={errors[`${prefix}Address`] ? "input-error" : ""}
        />
        {errors[`${prefix}Address`] && <p className="field-error">{errors[`${prefix}Address`]}</p>}
      </div>

      {party.partyType === "individual" && (
        <>
          <div className="form-group">
            <label htmlFor={`${prefix}NricFront`}>
              NRIC Front (image or PDF) <span className="label-hint">(optional)</span>
            </label>
            <input
              id={`${prefix}NricFront`}
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setTenantField(index, "nricFront", file);
              }}
            />
            {party.nricFront && (
              <p className="file-selected">Selected: {party.nricFront.name}</p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor={`${prefix}NricBack`}>
              NRIC Back (image or PDF) <span className="label-hint">(optional)</span>
            </label>
            <input
              id={`${prefix}NricBack`}
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setTenantField(index, "nricBack", file);
              }}
            />
            {party.nricBack && (
              <p className="file-selected">Selected: {party.nricBack.name}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Inventory Builder Component ──────────────────────────────────────

function InventoryBuilder({
  items,
  onAdd,
  onRemove,
  onUpdateQty,
  onUpdatePhotos,
}: {
  items: InventoryItem[];
  onAdd: (category: InventoryCategory, itemName: string) => void;
  onRemove: (id: string) => void;
  onUpdateQty: (id: string, qty: number) => void;
  onUpdatePhotos: (id: string, files: FileList | null) => void;
}) {
  const [customInputs, setCustomInputs] = useState<Partial<Record<InventoryCategory, string>>>({});

  function isItemSelected(category: InventoryCategory, itemName: string): boolean {
    return items.some((it) => it.category === category && it.itemName === itemName);
  }

  function getItem(category: InventoryCategory, itemName: string): InventoryItem | undefined {
    return items.find((it) => it.category === category && it.itemName === itemName);
  }

  function toggleItem(category: InventoryCategory, itemName: string) {
    const existing = getItem(category, itemName);
    if (existing) {
      onRemove(existing.id);
    } else {
      onAdd(category, itemName);
    }
  }

  function handleAddCustom(category: InventoryCategory) {
    const name = (customInputs[category] || "").trim();
    if (!name) return;
    onAdd(category, name);
    setCustomInputs((prev) => ({ ...prev, [category]: "" }));
  }

  return (
    <>
      {INVENTORY_CATEGORIES.map((cat) => {
        const suggested = SUGGESTED_ITEMS[cat];
        const customItems = items.filter(
          (it) => it.category === cat && !suggested.includes(it.itemName)
        );

        return (
          <div key={cat} className="inventory-category-section">
            <p className="inventory-category-title">{cat}</p>

            {/* Suggested items as checklist */}
            {suggested.map((itemName) => {
              const selected = isItemSelected(cat, itemName);
              const item = getItem(cat, itemName);
              return (
                <div key={itemName} className="inventory-checklist-item">
                  <input
                    type="checkbox"
                    id={`inv-${cat}-${itemName}`}
                    checked={selected}
                    onChange={() => toggleItem(cat, itemName)}
                  />
                  <label htmlFor={`inv-${cat}-${itemName}`}>{itemName}</label>
                  {selected && item && (
                    <>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="inventory-qty-input"
                        value={item.quantity}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (!isNaN(n)) onUpdateQty(item.id, n);
                        }}
                      />
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="inventory-photo-input"
                        onChange={(e) => onUpdatePhotos(item.id, e.target.files)}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {/* Custom items already added */}
            {customItems.map((item) => (
              <div key={item.id} className="inventory-item-row">
                <span>{item.itemName}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="inventory-qty-input"
                  value={item.quantity}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n)) onUpdateQty(item.id, n);
                  }}
                />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="inventory-photo-input"
                  onChange={(e) => onUpdatePhotos(item.id, e.target.files)}
                />
                <button type="button" className="btn-remove" onClick={() => onRemove(item.id)}>
                  Remove
                </button>
              </div>
            ))}

            {/* Add custom item */}
            <div className="inventory-item-row" style={{ marginTop: "4px" }}>
              <input
                type="text"
                className="custom-item-input"
                placeholder="Add custom item..."
                value={customInputs[cat] || ""}
                onChange={(e) =>
                  setCustomInputs((prev) => ({ ...prev, [cat]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustom(cat);
                  }
                }}
              />
              <button
                type="button"
                className="btn-add-custom"
                onClick={() => handleAddCustom(cat)}
              >
                + Add
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Review View ─────────────────────────────────────────────────────

function fmtRM(amountStr: string): string {
  const n = parseFloat(amountStr);
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a day-of-month number as a natural-case ordinal (e.g. 1→"1st",
 * 7→"7th", 23→"23rd"). Used on the review page — lowercase to read
 * naturally in prose. The agreement Schedule uses an uppercase variant.
 */
function fmtOrdinalDay(day: number): string {
  const n = Math.max(1, Math.min(31, Math.round(day)));
  let suffix: string;
  if (n >= 11 && n <= 13) {
    suffix = "th";
  } else {
    const last = n % 10;
    suffix = last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  }
  return `${n}${suffix}`;
}

function fmtDate(isoStr: string): string {
  if (!isoStr) return "—";
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ReviewView({
  form,
  onBack,
  onGeneratePreview,
}: {
  form: TenancyFormData;
  onBack: () => void;
  onGeneratePreview: () => void;
}) {

  const inventoryModeLabel =
    form.inventoryMode === "none"
      ? "No inventory"
      : form.inventoryMode === "upload_own_inventory"
      ? "Upload own inventory"
      : "Build inventory in app";

  return (
    <>
      <h1>WeStamp — Agreement Details Review</h1>
      <p className="subtitle">
        Residential tenancy agreement · Please review all details carefully
      </p>

      {/* ── 1. Agreement Date ──────────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">Agreement Date</p>
        <table className="review-table">
          <tbody>
            <tr><td>Date of Agreement</td><td>{fmtDate(form.agreementDate)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 2. Parties ─────────────────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">1. Parties</p>

        {form.landlords.map((party, idx) => {
          const idL = party.partyType === "individual" ? "NRIC No." : "Co. Reg. No.";
          const heading = form.landlords.length > 1 ? `Landlord ${idx + 1}` : "Landlord";
          return (
            <React.Fragment key={`landlord-${idx}`}>
              <p className="review-party-heading">{heading}</p>
              <table className="review-table">
                <tbody>
                  <tr><td>Type</td><td>{party.partyType === "individual" ? "Individual" : "Company"}</td></tr>
                  <tr><td>Name</td><td>{party.name}</td></tr>
                  <tr><td>{idL}</td><td>{party.idNumber}</td></tr>
                  <tr><td>Address</td><td>{party.address}</td></tr>
                </tbody>
              </table>
            </React.Fragment>
          );
        })}

        <p className="review-party-heading">Bank Account for Rent</p>
        <table className="review-table">
          <tbody>
            <tr><td>Bank</td><td>{form.landlordBankName}</td></tr>
            <tr><td>Account No.</td><td>{form.landlordBankAccountNumber}</td></tr>
            <tr><td>Account Name</td><td>{form.landlordBankAccountHolderName}</td></tr>
          </tbody>
        </table>

        {form.tenants.map((party, idx) => {
          const idL = party.partyType === "individual" ? "NRIC No." : "Co. Reg. No.";
          const heading = form.tenants.length > 1 ? `Tenant ${idx + 1}` : "Tenant";
          return (
            <React.Fragment key={`tenant-${idx}`}>
              <p className="review-party-heading">{heading}</p>
              <table className="review-table">
                <tbody>
                  <tr><td>Type</td><td>{party.partyType === "individual" ? "Individual" : "Company"}</td></tr>
                  <tr><td>Name</td><td>{party.name}</td></tr>
                  <tr><td>{idL}</td><td>{party.idNumber}</td></tr>
                  <tr><td>Address</td><td>{party.address}</td></tr>
                </tbody>
              </table>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── 3. Premises ────────────────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">2. Premises</p>
        <table className="review-table">
          <tbody>
            <tr><td>Property Address</td><td>{form.propertyAddress}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 4. Term ────────────────────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">3. Term</p>
        <table className="review-table">
          <tbody>
            <tr><td>Commencement Date</td><td>{fmtDate(form.commencementDate)}</td></tr>
            <tr><td>Lease Duration</td><td>{form.leaseMonths} months</td></tr>
            <tr>
              <td>Option to Renew</td>
              <td>
                {form.hasOptionToRenew && form.optionToRenewTermMonths
                  ? `Yes — ${form.optionToRenewTermMonths} months`
                  : "No"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── 5. Rent and Deposits ───────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">4. Rent and Deposits</p>
        <table className="review-table">
          <tbody>
            <tr><td>Monthly Rent</td><td>{fmtRM(form.monthlyRent)}</td></tr>
            <tr><td>Rent Due Date</td><td>{fmtOrdinalDay(form.rentDueDayOfMonth)} day of each month</td></tr>
            <tr><td>Security Deposit</td><td>{fmtRM(form.securityDeposit)}</td></tr>
            <tr><td>Utility Deposit</td><td>{parseFloat(form.utilityDeposit.trim()) === 0 ? "Not Applicable" : fmtRM(form.utilityDeposit)}</td></tr>
            {form.accessCardDeposit.trim() && (
              <tr><td>Access Card Deposit</td><td>{fmtRM(form.accessCardDeposit)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 6. Utilities and Maintenance ───────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">5. Utilities and Maintenance</p>
        <table className="review-table">
          <tbody>
            <tr>
              <td>Utility Payments</td>
              <td>{form.utilityResponsibility === "tenant" ? "Tenant" : "Landlord"}</td>
            </tr>
            <tr>
              <td>Air-Con Servicing</td>
              <td>{form.airConServicingResponsibility === "tenant" ? "Tenant" : "Landlord"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── 7. Inventory ───────────────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">6. Inventory</p>
        <table className="review-table">
          <tbody>
            <tr><td>Inventory Mode</td><td>{inventoryModeLabel}</td></tr>
            {form.inventoryMode === "upload_own_inventory" && form.inventoryUploadFiles.length > 0 && (
              <tr>
                <td>Uploaded Files</td>
                <td>{form.inventoryUploadFiles.map((f) => f.name).join(", ")}</td>
              </tr>
            )}
            {form.inventoryMode === "build_inventory_in_app" && (
              <tr>
                <td>Items</td>
                <td>{form.inventoryItems.length} item(s)</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── 8. Special Conditions ──────────────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">7. Special Conditions</p>
        {form.specialConditions.trim() ? (
          <p className="review-freetext">{form.specialConditions}</p>
        ) : (
          <p className="review-nil">None.</p>
        )}
      </div>

      {/* ── 9. Annexures and Attachments ───────────────────────────── */}
      <div className="review-section">
        <p className="review-section-title">8. Annexures and Attachments</p>
        <table className="review-table">
          <tbody>
            {form.tenants.map((party, idx) => {
              if (party.partyType !== "individual") return null;
              const label = form.tenants.length > 1 ? `Tenant ${idx + 1}` : "Tenant";
              return (
                <React.Fragment key={`nric-${idx}`}>
                  <tr>
                    <td>{label} NRIC Front</td>
                    <td>{party.nricFront ? party.nricFront.name : <span className="review-nil">Not uploaded</span>}</td>
                  </tr>
                  <tr>
                    <td>{label} NRIC Back</td>
                    <td>{party.nricBack ? party.nricBack.name : <span className="review-nil">Not uploaded</span>}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className="review-actions">
        <button type="button" className="btn-secondary" onClick={onBack}>
          &larr; Back to Edit
        </button>
        <button type="button" onClick={onGeneratePreview}>
          Generate Agreement Preview &rarr;
        </button>
      </div>
    </>
  );
}

// ─── Bold Schedule References ─────────────────────────────────────────

/**
 * Renders text with "Section X of the Schedule" references bolded.
 * Matches patterns like "Section 1 of the Schedule", "Section 5(a) (b) and (c)...of the Schedule",
 * "Section 6(a) of the Schedule", "Section 10 of the Schedule".
 *
 * The word "hereto" is intentionally NOT included in the bolded match — it
 * remains in normal weight regardless of whether it follows the reference.
 */
function BoldScheduleRefs({ text }: { text: string }) {
  const pattern = /Section\s+\d+(?:\([a-z]\))?(?:\s*(?:\([a-z]\)\s*(?:and\s*)?)*)?(?:\s*(?:respectively\s+)?of the Schedule)/g;
  const parts: { text: string; bold: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    parts.push({ text: match[0], bold: true });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), bold: false });
  }
  if (parts.length === 0) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}

// ─── Agreement Preview ────────────────────────────────────────────────

function AgreementPreview({
  form,
  onBack,
}: {
  form: TenancyFormData;
  onBack: () => void;
}) {
  const doc = buildAgreement(form);

  // ── Check whether uploaded files exist (for limitation note) ──
  const hasUploadedFiles =
    form.tenants.some((t) => t.partyType === "individual" && (t.nricFront !== null || t.nricBack !== null)) ||
    (form.inventoryMode === "upload_own_inventory" && form.inventoryUploadFiles.length > 0) ||
    (form.inventoryMode === "build_inventory_in_app" && form.inventoryItems.some((it) => it.photos.length > 0));

  return (
    <>
      <div className="agreement-actions">
        <button type="button" className="btn-secondary" onClick={onBack}>
          &larr; Back to Review
        </button>
        <button type="button" onClick={() => window.print()}>
          Download / Save Unsigned Agreement PDF
        </button>
      </div>
      {hasUploadedFiles && (
        <p className="print-hint no-print">
          Note: Uploaded files (NRIC images, inventory photos, and inventory attachments) are not
          yet included in the downloaded unsigned PDF. Use browser Print / Save as PDF to include them, or
          attach them separately.
        </p>
      )}
      <p className="print-hint no-print">
        Tip: In the Chrome print dialog, uncheck &ldquo;Headers and footers&rdquo; for a clean PDF without browser text.
      </p>
      <div className="bridge-cta no-print">
        <p className="bridge-cta-warning">
          Please download or save the unsigned agreement before proceeding. Leaving this page may cause you to lose the current generated document.
        </p>
        <a
          href="/upload"
          target="_blank"
          rel="noopener noreferrer"
          className="bridge-cta-link"
        >
          Upload Signed Document for Stamping &rarr;
        </a>
      </div>

      <div className="agreement-preview">
        {/* ── COVER PAGE ───────────────────────────────────────────── */}
        <section data-section="cover" className="cover-page">
          <div className="cover-spacer" />
          <p className="cover-date">{doc.agreementDateOrdinal}</p>
          <div className="cover-parties">
            <p className="cover-label">BETWEEN</p>
            {doc.landlordDescriptors.map((d, i) => (
              <p key={`ll-${i}`} className="cover-party-name">
                {doc.landlordDescriptors.length > 1 ? `(${i + 1}) ${d}` : d}
              </p>
            ))}
            <p className="cover-party-role">
              (&ldquo;{doc.landlordDescriptors.length > 1 ? "THE LANDLORDS" : "THE LANDLORD"}&rdquo;)
            </p>
            <p className="cover-label">AND</p>
            {doc.tenantDescriptors.map((d, i) => (
              <p key={`tt-${i}`} className="cover-party-name">
                {doc.tenantDescriptors.length > 1 ? `(${i + 1}) ${d}` : d}
              </p>
            ))}
            <p className="cover-party-role">
              (&ldquo;{doc.tenantDescriptors.length > 1 ? "THE TENANTS" : "THE TENANT"}&rdquo;)
            </p>
          </div>
          <div className="cover-title-box">
            <p>TENANCY AGREEMENT</p>
          </div>
          <p className="cover-property">{doc.propertyAddress}</p>
        </section>

        {/* ── PREAMBLE ─────────────────────────────────────────────── */}
        <section data-section="preamble">
          <div className="agreement-preamble agreement-justified">
            <p><BoldScheduleRefs text={doc.preambleText} /></p>
          </div>
        </section>

        {/* ── WHEREAS / RECITALS ───────────────────────────────────── */}
        <section data-section="recitals">
          <div className="agreement-recital agreement-justified">
            <p><strong>WHEREAS :-</strong></p>
            {doc.recitals.map((r, i) => (
              <div key={i} className="agreement-recital-item">
                <span className="recital-number">{r.number}</span>
                <div className="recital-body">
                  <p><BoldScheduleRefs text={r.text} /></p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── NOW IT IS HEREBY AGREED / OPERATIVE CLAUSES ──────────── */}
        <section data-section="operative">
          <div className="agreement-operative agreement-justified">
            <p><strong>NOW IT IS HEREBY AGREED AS FOLLOWS :-</strong></p>
            {doc.operativeClauses.map((c) => (
              <div key={c.number} className="operative-clause">
                <span className="operative-number">{c.number}.</span>
                <div className="operative-body">
                  <div className="clause-head-pair">
                    <p className="margin-note"><em>{c.marginNote}</em></p>
                    <p><BoldScheduleRefs text={c.text} /></p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TENANT COVENANTS ─────────────────────────────────────── */}
        <section data-section="tenant-covenants">
          <div className="agreement-covenant-section agreement-justified">
            <p className="covenant-heading">
              <strong>{doc.tenantCovenantsClauseNum}. THE TENANT HEREBY COVENANTS WITH THE LANDLORD as follows:-</strong>
            </p>
            {doc.tenantCovenants.map((c, idx) => {
              const paras = c.text.split("\n\n");
              return (
                <div key={c.letter} className="covenant-clause">
                  <span className="covenant-letter">{doc.tenantCovenantsClauseNum}.{idx + 1}</span>
                  <div className="covenant-body">
                    <div className="clause-head-pair">
                      <p className="margin-note"><em>{c.marginNote}</em></p>
                      {paras[0] && <p><BoldScheduleRefs text={paras[0]} /></p>}
                    </div>
                    {paras.slice(1).map((para, pi) => (
                      <p key={pi}><BoldScheduleRefs text={para} /></p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── LANDLORD COVENANTS ───────────────────────────────────── */}
        <section data-section="landlord-covenants">
          <div className="agreement-covenant-section agreement-justified">
            <p className="covenant-heading">
              <strong>{doc.landlordCovenantsClauseNum}. THE LANDLORD HEREBY COVENANTS WITH THE TENANT as follows:-</strong>
            </p>
            {doc.landlordCovenants.map((c, idx) => {
              const paras = c.text.split("\n\n");
              return (
                <div key={c.letter} className="covenant-clause">
                  <span className="covenant-letter">{doc.landlordCovenantsClauseNum}.{idx + 1}</span>
                  <div className="covenant-body">
                    <div className="clause-head-pair">
                      <p className="margin-note"><em>{c.marginNote}</em></p>
                      {paras[0] && <p><BoldScheduleRefs text={paras[0]} /></p>}
                    </div>
                    {paras.slice(1).map((para, pi) => (
                      <p key={pi}><BoldScheduleRefs text={para} /></p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── PROVIDED ALWAYS / PROVISOS ───────────────────────────── */}
        <section data-section="provisos">
          <div className="agreement-provisos agreement-justified">
            <p className="proviso-heading">
              <strong>{doc.provisosClauseNum}. PROVIDED ALWAYS AND IT IS HEREBY EXPRESSLY AGREED BETWEEN BOTH PARTIES as follows:-</strong>
            </p>
            {doc.provisos.map((p, i) => {
              const paras = p.text.split("\n\n");
              return (
                <div key={i} className="proviso-clause">
                  <span className="proviso-number">{doc.provisosClauseNum}.{i + 1}</span>
                  <div className="proviso-body">
                    <div className="clause-head-pair">
                      <p className="margin-note"><em>{p.marginNote}</em></p>
                      {paras[0] && <p><BoldScheduleRefs text={paras[0]} /></p>}
                    </div>
                    {paras.slice(1).map((para, pi) => (
                      <p key={pi}><BoldScheduleRefs text={para} /></p>
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Special Conditions — rendered at dynamic sub-number (7.12 or 7.13) */}
            {(() => {
              const scParas = doc.specialConditionsProviso.text.split("\n\n");
              return (
                <div className="proviso-clause">
                  <span className="proviso-number">{doc.provisosClauseNum}.{doc.specialConditionsProvisoSubNum}</span>
                  <div className="proviso-body">
                    <div className="clause-head-pair">
                      <p className="margin-note"><em>{doc.specialConditionsProviso.marginNote}</em></p>
                      {scParas[0] && <p><BoldScheduleRefs text={scParas[0]} /></p>}
                    </div>
                    {scParas.slice(1).map((para, pi) => (
                      <p key={pi}><BoldScheduleRefs text={para} /></p>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* ── INTERPRETATION (Clause 8) ────────────────────────────── */}
        <section data-section="interpretation">
          <div className="agreement-section agreement-justified">
            <p><strong>{doc.interpretationClauseNum}. IN THIS AGREEMENT:-</strong></p>
            {doc.interpretation.map((t, i) => (
              <div key={i} className="interpretation-item">
                <span className="interpretation-number">{doc.interpretationClauseNum}.{i + 1}</span>
                <div className="interpretation-body">
                  <p>{t}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── INTENTIONALLY LEFT BLANK ──────────────────────────────── */}
        <p className="intentionally-blank">
          &mdash;&mdash;&mdash;&mdash;&mdash;&mdash; The rest of this page is intentionally left blank &mdash;&mdash;&mdash;&mdash;&mdash;&mdash;
        </p>

        {/* ── EXECUTION / SIGNING ──────────────────────────────────── */}
        <section data-section="execution">
          <div className="agreement-execution">
            <p className="execution-heading">
              <strong>IN WITNESS WHEREOF</strong> the parties hereto have hereunder set their hands
              the day and year specified in <strong>Section 1 of the Schedule</strong> hereto.
            </p>

            <div className="agreement-signature-block">
              <div className="signature-row">
                {doc.landlordSignatories.map((s, i) => (
                  <div key={`ll-sig-${i}`} className="signature-party">
                    <p><strong>SIGNED BY THE SAID LANDLORD</strong></p>
                    <p className="signature-line-dotted">&nbsp;</p>
                    <p>{s.name}</p>
                    <p className="signature-id">({s.idLine})</p>
                    <div className="witness-block">
                      <p className="witness-label">In the presence of:</p>
                      <p className="signature-line-dotted">&nbsp;</p>
                      <p className="witness-field">Name: ..........................................................</p>
                      <p className="witness-field">NRIC No.: ..................................................</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="signature-row">
                {doc.tenantSignatories.map((s, i) => (
                  <div key={`tt-sig-${i}`} className="signature-party">
                    <p><strong>SIGNED BY THE SAID TENANT</strong></p>
                    <p className="signature-line-dotted">&nbsp;</p>
                    <p>{s.name}</p>
                    <p className="signature-id">({s.idLine})</p>
                    <div className="witness-block">
                      <p className="witness-label">In the presence of:</p>
                      <p className="signature-line-dotted">&nbsp;</p>
                      <p className="witness-field">Name: ..........................................................</p>
                      <p className="witness-field">NRIC No.: ..................................................</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── THE SCHEDULE ─────────────────────────────────────────── */}
        <section data-section="schedule">
          <div className="agreement-schedule">
            <h3 className="agreement-schedule-heading schedule-centred">THE SCHEDULE</h3>
            <p className="schedule-preamble schedule-centred">
              (Which is to be taken, read and construed as an essential part of this Agreement)
            </p>
            <table className="agreement-schedule-table">
              <thead>
                <tr>
                  <th>SECTION</th>
                  <th>ITEMS</th>
                  <th>PARTICULARS</th>
                </tr>
              </thead>
              <tbody>
                {doc.schedule.map((row, i) => (
                  <tr key={i}>
                    <td className="schedule-sect">{row.section}</td>
                    <td className="schedule-item">{row.item}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── INVENTORY LIST (always present) ──────────────────────── */}
        <section data-section="inventory">
          <div className="agreement-schedule">
            <h3 className="agreement-schedule-heading schedule-centred">INVENTORY LIST</h3>
            <InventoryPreview form={form} />
          </div>
        </section>

        {/* ── ANNEXURES ────────────────────────────────────────────── */}
        {doc.annexures.map((annexure) => (
          <section key={annexure.id} data-section={`annexure-${annexure.id.toLowerCase()}`}>
            <div className="agreement-annexure">
              <h3 className="agreement-schedule-heading schedule-centred">
                ANNEXURE {annexure.id} &mdash; {annexure.title.toUpperCase()}
              </h3>
              {annexure.id === "A" ? (
                <AnnexureAContent form={form} />
              ) : (
                <p className="agreement-placeholder">{annexure.placeholder}</p>
              )}
            </div>
          </section>
        ))}

      </div>

      {/* ── Lawyer CTA ─────────────────────────────────────────────── */}
      <div className="cta-lawyer-card">
        <p className="cta-lawyer-heading">Need custom clauses or flexible terms?</p>
        <p className="cta-lawyer-body">
          WeStamp generates standard fixed-term residential tenancy agreements. If you need
          non-standard terms, a customised agreement, or legal advice, you may choose to speak
          directly to a lawyer.
        </p>
        <a
          className="cta-lawyer-btn"
          href={buildWhatsAppUrl(
            previewPageMessage(form.propertyAddress, form.monthlyRent)
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          💬 Speak to a Lawyer on WhatsApp
        </a>
        <p className="cta-lawyer-disclosure">
          This connects you to an independent Malaysian advocate &amp; solicitor. WeStamp is a
          self-serve software platform and does not provide legal advice or legal services.
        </p>
      </div>

      <div className="agreement-actions">
        <button type="button" className="btn-secondary" onClick={onBack}>
          &larr; Back to Review
        </button>
      </div>
    </>
  );
}

// ─── Image helpers ────────────────────────────────────────────────────

/**
 * Downscale a File to a data URL with a max dimension using the browser
 * Canvas API. Keeps aspect ratio. Falls back to a plain object URL if
 * canvas is unavailable.
 *
 * MAX_PX caps the longest edge — chosen so a full-page A4 print image
 * stays sharp without bloating the PDF with raw phone photos.
 */
const MAX_PX = 1400;

function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, MAX_PX / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(objectUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { resolve(objectUrl); };
    img.src = objectUrl;
  });
}

/** Renders a single image file — downscaled if it is an image type. */
function AnnexureImage({ file, className }: { file: File; className?: string }) {
  const [src, setSrc] = React.useState<string>("");
  React.useEffect(() => {
    let active = true;
    downscaleImage(file).then((url) => { if (active) setSrc(url); });
    return () => { active = false; };
  }, [file]);
  if (!src) return null;
  return <img src={src} alt={file.name} className={className ?? "annexure-image"} />;
}

// ─── Inventory Preview (inside agreement) ─────────────────────────────

function InventoryPreview({ form }: { form: TenancyFormData }) {
  if (form.inventoryMode === "none") {
    return <p className="agreement-nil">No separate inventory provided.</p>;
  }

  if (form.inventoryMode === "upload_own_inventory") {
    const files = form.inventoryUploadFiles;
    if (files.length === 0) {
      return <p className="agreement-placeholder">[Inventory documents to be attached]</p>;
    }
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const otherFiles = files.filter((f) => !f.type.startsWith("image/"));
    return (
      <>
        {imageFiles.length > 0 && (
          <div className="annexure-image-grid">
            {imageFiles.map((f, i) => (
              <AnnexureImage key={i} file={f} className="inventory-upload-image" />
            ))}
          </div>
        )}
        {otherFiles.length > 0 && (
          <>
            <p className="inventory-attach-note">
              The following documents are attached separately:
            </p>
            <ul className="inventory-file-list">
              {otherFiles.map((f, i) => (
                <li key={i}>{f.name}</li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  // build_inventory_in_app
  const grouped = INVENTORY_CATEGORIES
    .map((cat) => ({
      category: cat,
      items: form.inventoryItems.filter((it) => it.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  if (grouped.length === 0) {
    return <p className="agreement-nil">No inventory items added.</p>;
  }

  return (
    <>
      {grouped.map((group) => (
        <div key={group.category} className="inventory-preview-group">
          <p className="inventory-preview-category">{group.category}</p>
          <table className="inventory-preview-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <React.Fragment key={item.id}>
                  <tr>
                    <td>{item.itemName}</td>
                    <td>{item.quantity}</td>
                  </tr>
                  {item.photos.length > 0 && (
                    <tr className="inventory-photo-row">
                      <td colSpan={2}>
                        <div className="inventory-photo-grid">
                          {item.photos.map((photo, pi) => (
                            <AnnexureImage
                              key={pi}
                              file={photo}
                              className="inventory-item-photo"
                            />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// ─── Annexure A: Tenant NRIC ───────────────────────────────────────────

function AnnexureAContent({ form }: { form: TenancyFormData }) {
  // Rendered only when at least one individual tenant has at least one NRIC
  // side uploaded. Iterates over all individual tenants so each tenant's
  // identity documents appear in Annexure A.
  const individualTenants = form.tenants
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => t.partyType === "individual");

  const showTenantHeading = individualTenants.length > 1;

  return (
    <>
      {individualTenants.map(({ t, idx }) => {
        const hasAny = t.nricFront !== null || t.nricBack !== null;
        if (!hasAny) return null;
        return (
          <div key={`nric-${idx}`} className="nric-image-block">
            {showTenantHeading && (
              <p className="nric-tenant-heading">Tenant {idx + 1}</p>
            )}
            <div className="nric-image-wrap">
              <p className="nric-image-label">Identity Card (Front)</p>
              {t.nricFront ? (
                <AnnexureImage file={t.nricFront} className="nric-image" />
              ) : (
                <p className="nric-not-provided">Identity Card (Front) &mdash; not provided</p>
              )}
            </div>
            <div className="nric-image-wrap">
              <p className="nric-image-label">Identity Card (Back)</p>
              {t.nricBack ? (
                <AnnexureImage file={t.nricBack} className="nric-image" />
              ) : (
                <p className="nric-not-provided">Identity Card (Back) &mdash; not provided</p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
