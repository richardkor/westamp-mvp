"use client";

/**
 * PrintAgreement — Client component for the Puppeteer print page.
 *
 * Receives serialized form data (no File objects) and renders the
 * agreement in the exact same structure as the main AgreementPreview.
 *
 * Where uploaded files existed in the original form, this component
 * shows textual placeholders with filenames.
 */

import React from "react";
import { TenancyFormData, TENANCY_FORM_DEFAULTS, InventoryCategory, INVENTORY_CATEGORIES } from "../../../lib/tenancy-types";
import { buildAgreement, AgreementDoc } from "../../../lib/agreement-template";

/**
 * Serialized form data shape — matches TenancyFormData but with
 * File fields replaced by filename metadata.
 */
interface SerializedFormData {
  [key: string]: unknown;
  // File fields are replaced:
  tenantNricFrontName?: string | null;
  tenantNricBackName?: string | null;
  inventoryUploadFileNames?: string[];
  inventoryItemPhotoNames?: Record<string, string[]>; // itemId → filenames
}

/**
 * Reconstruct a TenancyFormData from serialized JSON.
 * File fields become null/empty — the template handles this gracefully.
 */
function deserializeFormData(json: Record<string, unknown>): TenancyFormData {
  return {
    ...TENANCY_FORM_DEFAULTS,
    ...(json as Partial<TenancyFormData>),
    // File fields are always null/empty in the print context
    tenantNricFront: null,
    tenantNricBack: null,
    inventoryUploadFiles: [],
    inventoryItems: ((json.inventoryItems as unknown[]) ?? []).map((item: unknown) => {
      const it = item as Record<string, unknown>;
      return {
        id: (it.id as string) ?? "",
        category: ((it.category as string) ?? "General / Access Items") as InventoryCategory,
        itemName: (it.itemName as string) ?? "",
        quantity: (it.quantity as number) ?? 1,
        photos: [] as File[], // Photos cannot be serialized
      };
    }),
  };
}

// ─── BoldScheduleRefs — same as main page ────────────────────────────

function BoldScheduleRefs({ text }: { text: string }) {
  // "hereto" is intentionally NOT included in the bolded match — it remains
  // in normal weight regardless of whether it follows the reference.
  const pattern =
    /(Section\s+\d+(?:\([a-z]\))?(?:\s*(?:\([a-z]\)\s*(?:and\s*)?)*)?(?:\s*(?:respectively\s+)?of the Schedule))/g;
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

// ─── Inventory Preview for Print ─────────────────────────────────────

function PrintInventoryPreview({
  doc,
  serialized,
}: {
  doc: AgreementDoc;
  serialized: SerializedFormData;
}) {
  if (doc.inventoryMode === "none") {
    return <p className="agreement-nil">No separate inventory provided.</p>;
  }

  if (doc.inventoryMode === "upload_own_inventory") {
    const fileNames = serialized.inventoryUploadFileNames ?? [];
    return (
      <>
        <p className="agreement-placeholder">[Inventory documents uploaded separately]</p>
        {fileNames.length > 0 && (
          <>
            <p className="inventory-attach-note">Uploaded inventory attachments:</p>
            <ul className="inventory-file-list">
              {fileNames.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            <p style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 6 }}>
              Note: Uploaded file content is not included in this PDF version.
            </p>
          </>
        )}
      </>
    );
  }

  // build_inventory_in_app
  if (doc.inventoryGrouped.length === 0) {
    return <p className="agreement-nil">No inventory items added.</p>;
  }

  const photoNames = serialized.inventoryItemPhotoNames ?? {};

  return (
    <>
      {doc.inventoryGrouped.map((group) => (
        <div key={group.category} className="inventory-preview-group">
          <p className="inventory-preview-category">{group.category}</p>
          <table className="inventory-preview-table">
            <tbody>
              {group.items.map((item, i) => {
                // Find photo names for this item (matched by itemName within category)
                const itemPhotos = Object.entries(photoNames).find(
                  ([, names]) => names.length > 0
                );
                return (
                  <tr key={i}>
                    <td>{item.itemName}</td>
                    <td>{item.quantity}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {Object.values(photoNames).some((names) => names.length > 0) && (
        <p style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 8 }}>
          Note: Inventory item photos exist but are not included in this PDF version.
        </p>
      )}
    </>
  );
}

// ─── Annexure A for Print ────────────────────────────────────────────

function PrintAnnexureAContent({ serialized }: { serialized: SerializedFormData }) {
  const frontName = serialized.tenantNricFrontName;
  const backName = serialized.tenantNricBackName;

  if (!frontName && !backName) {
    return <p className="agreement-placeholder">[Tenant NRIC copies to be attached]</p>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="agreement-placeholder">[Tenant NRIC copies to be attached]</p>
      <p style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
        Uploaded NRIC files:
      </p>
      <ul style={{ fontSize: 12, color: "#444", paddingLeft: 20, marginTop: 4 }}>
        {frontName && <li>Front: {frontName}</li>}
        {backName && <li>Back: {backName}</li>}
      </ul>
      <p style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 6 }}>
        Note: NRIC images are not included in this PDF version.
      </p>
    </div>
  );
}

// ─── Main Print Component ────────────────────────────────────────────

export function PrintAgreement({
  formDataJson,
}: {
  formDataJson: Record<string, unknown>;
}) {
  const serialized = formDataJson as SerializedFormData;
  const form = deserializeFormData(formDataJson);
  const doc = buildAgreement(form);

  return (
    <main>
      <div className="agreement-preview">
        {/* ── COVER PAGE ───────────────────────────────────────────── */}
        <section data-section="cover" className="cover-page">
          <div className="cover-spacer" />
          <p className="cover-date">{doc.agreementDateOrdinal}</p>
          <div className="cover-parties">
            <p className="cover-label">BETWEEN</p>
            <p className="cover-party-name">{doc.landlordDescriptor}</p>
            <p className="cover-party-role">(&ldquo;THE LANDLORD&rdquo;)</p>
            <p className="cover-label">AND</p>
            <p className="cover-party-name">{doc.tenantDescriptor}</p>
            <p className="cover-party-role">(&ldquo;THE TENANT&rdquo;)</p>
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

        {/* ── OPERATIVE CLAUSES ────────────────────────────────────── */}
        <section data-section="operative">
          <div className="agreement-operative agreement-justified">
            <p><strong>NOW IT IS HEREBY AGREED AS FOLLOWS :-</strong></p>
            {doc.operativeClauses.map((c) => (
              <div key={c.number} className="operative-clause">
                <span className="operative-number">{c.number}.</span>
                <div className="operative-body">
                  <p className="margin-note"><em>{c.marginNote}</em></p>
                  <p><BoldScheduleRefs text={c.text} /></p>
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
            {doc.tenantCovenants.map((c, idx) => (
              <div key={c.letter} className="covenant-clause">
                <span className="covenant-letter">{doc.tenantCovenantsClauseNum}.{idx + 1}</span>
                <div className="covenant-body">
                  <p className="margin-note"><em>{c.marginNote}</em></p>
                  {c.text.split("\n\n").map((para, pi) => (
                    <p key={pi}><BoldScheduleRefs text={para} /></p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── LANDLORD COVENANTS ───────────────────────────────────── */}
        <section data-section="landlord-covenants">
          <div className="agreement-covenant-section agreement-justified">
            <p className="covenant-heading">
              <strong>{doc.landlordCovenantsClauseNum}. THE LANDLORD HEREBY COVENANTS WITH THE TENANT as follows:-</strong>
            </p>
            {doc.landlordCovenants.map((c, idx) => (
              <div key={c.letter} className="covenant-clause">
                <span className="covenant-letter">{doc.landlordCovenantsClauseNum}.{idx + 1}</span>
                <div className="covenant-body">
                  <p className="margin-note"><em>{c.marginNote}</em></p>
                  {c.text.split("\n\n").map((para, pi) => (
                    <p key={pi}><BoldScheduleRefs text={para} /></p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PROVIDED ALWAYS / PROVISOS ───────────────────────────── */}
        <section data-section="provisos">
          <div className="agreement-provisos agreement-justified">
            <p className="proviso-heading">
              <strong>{doc.provisosClauseNum}. PROVIDED ALWAYS AND IT IS HEREBY EXPRESSLY AGREED BETWEEN BOTH PARTIES as follows:-</strong>
            </p>
            {doc.provisos.map((p, i) => (
              <div key={i} className="proviso-clause">
                <span className="proviso-number">{doc.provisosClauseNum}.{i + 1}</span>
                <div className="proviso-body">
                  <p className="margin-note"><em>{p.marginNote}</em></p>
                  {p.text.split("\n\n").map((para, pi) => (
                    <p key={pi}><BoldScheduleRefs text={para} /></p>
                  ))}
                </div>
              </div>
            ))}
            {/* Special Conditions — ALWAYS rendered at fixed sub-number 7.13 */}
            <div className="proviso-clause">
              <span className="proviso-number">{doc.provisosClauseNum}.{doc.specialConditionsProvisoSubNum}</span>
              <div className="proviso-body">
                <p className="margin-note"><em>{doc.specialConditionsProviso.marginNote}</em></p>
                {doc.specialConditionsProviso.text.split("\n\n").map((para, pi) => (
                  <p key={pi}><BoldScheduleRefs text={para} /></p>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── INTERPRETATION ───────────────────────────────────────── */}
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

        {/* ── INTENTIONALLY LEFT BLANK ────────────────────────────── */}
        <p className="intentionally-blank">
          &mdash;&mdash;&mdash;&mdash;&mdash;&mdash; The rest of this page is intentionally left blank &mdash;&mdash;&mdash;&mdash;&mdash;&mdash;
        </p>

        {/* ── EXECUTION / SIGNING ─────────────────────────────────── */}
        <section data-section="execution">
          <div className="agreement-execution">
            <p className="execution-heading">
              <strong>IN WITNESS WHEREOF</strong> the parties hereto have hereunder set their hands
              the day and year specified in <strong>Section 1 of the Schedule</strong> hereto.
            </p>
            <div className="agreement-signature-block">
              <div className="signature-party">
                <p><strong>SIGNED BY THE SAID LANDLORD</strong></p>
                <p className="signature-line-dotted">&nbsp;</p>
                <p>{doc.landlordName}</p>
                <p className="signature-id">({doc.landlordIdLine})</p>
                <div className="witness-block">
                  <p className="witness-label">In the presence of:</p>
                  <p className="signature-line-dotted">&nbsp;</p>
                  <p className="witness-field">Name: ..........................................................</p>
                  <p className="witness-field">NRIC No.: ..................................................</p>
                </div>
              </div>
              <div className="signature-party">
                <p><strong>SIGNED BY THE SAID TENANT</strong></p>
                <p className="signature-line-dotted">&nbsp;</p>
                <p>{doc.tenantName}</p>
                <p className="signature-id">({doc.tenantIdLine})</p>
                <div className="witness-block">
                  <p className="witness-label">In the presence of:</p>
                  <p className="signature-line-dotted">&nbsp;</p>
                  <p className="witness-field">Name: ..........................................................</p>
                  <p className="witness-field">NRIC No.: ..................................................</p>
                </div>
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

        {/* ── INVENTORY LIST ───────────────────────────────────────── */}
        <section data-section="inventory">
          <div className="agreement-schedule">
            <h3 className="agreement-schedule-heading schedule-centred">INVENTORY LIST</h3>
            <PrintInventoryPreview doc={doc} serialized={serialized} />
          </div>
        </section>

        {/* ── ANNEXURES ────────────────────────────────────────────── */}
        {doc.annexures.map((annexure) => (
          <section key={annexure.id} data-section={`annexure-${annexure.id.toLowerCase()}`}>
            <div className="agreement-annexure">
              <h3 className="agreement-schedule-heading schedule-centred">
                ANNEXURE {annexure.id} &mdash; {annexure.title.toUpperCase()}
              </h3>
              {annexure.id === "A" && form.tenantPartyType === "individual" ? (
                <PrintAnnexureAContent serialized={serialized} />
              ) : (
                <p className="agreement-placeholder">{annexure.placeholder}</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
