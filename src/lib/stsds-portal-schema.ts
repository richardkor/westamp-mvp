/**
 * WeStamp — STSDS Portal Page Schema + Selector Foundation
 *
 * Structured internal schema for the known e-Duti Setem portal areas.
 * Grounded only in observed portal screens and known field concepts.
 *
 * This is a static internal reference layer:
 * - Pages/tabs are modelled with their known fields
 * - Fields carry selector/config hints for later automation wiring
 * - Read-only vs editable vs derived distinctions are explicit
 * - Unknown or partially-observed tabs are marked accordingly
 *
 * Does NOT contain browser driver code.
 * Does NOT interact with the live e-Duti Setem portal.
 */

import {
  PortalLane,
  PortalPageSchema,
  PortalFieldSchema,
  PortalReadbackSchema,
} from "./stsds-types";

// ─── Stable Field Key Constants ──────────────────────────────────────

/**
 * Stable internal field key identifiers.
 * Used to link automation plan steps and validation checkpoints
 * to specific portal field schema entries.
 */
export const PORTAL_FIELD_KEYS = {
  // Shared Maklumat Am
  STAMP_OFFICE: "stamp_office",
  INSTRUMENT_DATE: "instrument_date",
  RECEIVED_IN_MALAYSIA_DATE: "received_in_malaysia_date",

  // Penyeteman Am — Maklumat Am
  PORTAL_DOCUMENT_NAME: "portal_document_name",
  EXPECTED_DERIVED_DOCUMENT_GROUP: "expected_derived_document_group",
  EDITABLE_INSTRUMENT_CATEGORY: "editable_instrument_category",

  // Navigation / entry
  PORTAL_LANE_SELECTION: "portal_lane_selection",

  // Rumusan Pengiraan (duty summary readback)
  DUTY_PAYABLE: "duty_payable",
  DUTY_DUPLICATE_COPY: "duty_duplicate_copy",
  DUTY_TOTAL_PAYABLE: "duty_total_payable",
} as const;

export type PortalFieldKey =
  (typeof PORTAL_FIELD_KEYS)[keyof typeof PORTAL_FIELD_KEYS];

// ─── Shared Maklumat Am Field Schemas ───────────────────────────────

const FIELD_STAMP_OFFICE: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
  tab: "maklumat_am",
  lane: "shared",
  mode: "editable",
  kind: "dropdown",
  label: "Stamp Office",
  portalLabel: "Pejabat Setem",
  isKnown: true,
  selectorHint: {
    labelText: "Pejabat Setem",
    inputType: "select",
    isRequired: true,
    interactionType: "select",
    observedAt: "2025-03",
  },
};

const FIELD_INSTRUMENT_DATE: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.INSTRUMENT_DATE,
  tab: "maklumat_am",
  lane: "shared",
  mode: "editable",
  kind: "date_input",
  label: "Instrument Date",
  portalLabel: "Tarikh Surat Cara",
  isKnown: true,
  selectorHint: {
    labelText: "Tarikh Surat Cara",
    inputType: "date",
    isRequired: true,
    interactionType: "type",
    observedAt: "2025-03",
  },
};

const FIELD_RECEIVED_IN_MALAYSIA_DATE: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.RECEIVED_IN_MALAYSIA_DATE,
  tab: "maklumat_am",
  lane: "shared",
  mode: "editable",
  kind: "date_input",
  label: "Received in Malaysia Date",
  portalLabel: "Tarikh Diterima di Malaysia",
  isKnown: true,
  notes: "Only required when instrument was signed outside Malaysia.",
  selectorHint: {
    labelText: "Tarikh Diterima di Malaysia",
    inputType: "date",
    isRequired: false,
    interactionType: "type",
    observedAt: "2025-03",
  },
};

// ─── Penyeteman Am — Maklumat Am Fields ─────────────────────────────

const FIELD_PORTAL_DOCUMENT_NAME: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME,
  tab: "maklumat_am",
  lane: "penyeteman_am",
  mode: "editable",
  kind: "dropdown",
  label: "Portal Document Name",
  portalLabel: "Nama Surat Cara",
  isKnown: true,
  notes: "Searchable dropdown. Selection triggers auto-population of derived document group.",
  selectorHint: {
    labelText: "Nama Surat Cara",
    inputType: "select",
    isRequired: true,
    interactionType: "select",
    observedAt: "2025-03",
  },
};

const FIELD_EXPECTED_DERIVED_DOCUMENT_GROUP: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
  tab: "maklumat_am",
  lane: "penyeteman_am",
  mode: "derived",
  kind: "derived_display",
  label: "Expected Derived Document Group",
  portalLabel: "Kumpulan Dokumen",
  isKnown: true,
  notes:
    "Auto-populated by the portal after Nama Surat Cara is selected. " +
    "Greyed-out and not directly editable. " +
    "Must be validated against WeStamp's expected value.",
  selectorHint: {
    labelText: "Kumpulan Dokumen",
    inputType: "display",
    isRequired: false,
    interactionType: "validate",
    observedAt: "2025-03",
  },
};

const FIELD_EDITABLE_INSTRUMENT_CATEGORY: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY,
  tab: "maklumat_am",
  lane: "penyeteman_am",
  mode: "editable",
  kind: "dropdown",
  label: "Editable Instrument Category",
  portalLabel: "Kategori Surat Cara",
  isKnown: true,
  notes:
    "Separate from the derived document group. " +
    "Editable field. Observed default for many instruments: Prinsipal.",
  selectorHint: {
    labelText: "Kategori Surat Cara",
    inputType: "select",
    isRequired: false,
    interactionType: "select",
    observedAt: "2025-03",
  },
};

// ─── Rumusan Pengiraan (Duty Summary) Fields ─────────────────────────

const FIELD_DUTY_PAYABLE: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.DUTY_PAYABLE,
  tab: "rumusan_pengiraan",
  lane: "shared",
  mode: "derived",
  kind: "currency_display",
  label: "Payable Duty",
  portalLabel: "Duti Setem Patut Dibayar",
  isKnown: true,
  notes: "Computed by the portal after instrument details are entered.",
  selectorHint: {
    labelText: "Duti Setem Patut Dibayar",
    inputType: "display",
    isRequired: false,
    interactionType: "read_back",
    observedAt: "2025-03",
  },
};

const FIELD_DUTY_DUPLICATE_COPY: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.DUTY_DUPLICATE_COPY,
  tab: "rumusan_pengiraan",
  lane: "sewa_pajakan",
  mode: "derived",
  kind: "currency_display",
  label: "Duplicate Copy Amount",
  portalLabel: "Duti Salinan",
  isKnown: true,
  notes: "Present only when duplicate copies are included.",
  selectorHint: {
    labelText: "Duti Salinan",
    inputType: "display",
    isRequired: false,
    interactionType: "read_back",
    observedAt: "2025-03",
  },
};

const FIELD_DUTY_TOTAL_PAYABLE: PortalFieldSchema = {
  fieldKey: PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE,
  tab: "rumusan_pengiraan",
  lane: "shared",
  mode: "derived",
  kind: "currency_display",
  label: "Total Payable",
  portalLabel: "Jumlah Bayaran",
  isKnown: true,
  notes: "Total duty payable as computed by the portal.",
  selectorHint: {
    labelText: "Jumlah Bayaran",
    inputType: "display",
    isRequired: false,
    interactionType: "read_back",
    observedAt: "2025-03",
  },
};

// ─── Tab Schemas ─────────────────────────────────────────────────────

/**
 * Maklumat Am tab schema for penyeteman_am lane.
 */
const MAKLUMAT_AM_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "maklumat_am",
  tabLabel: "Maklumat Am",
  lane: "penyeteman_am",
  isFullyMapped: true,
  observationNote: "Fields observed from e-Duti Setem portal screenshots (approx. 2025-03).",
  fields: [
    FIELD_STAMP_OFFICE,
    FIELD_INSTRUMENT_DATE,
    FIELD_RECEIVED_IN_MALAYSIA_DATE,
    FIELD_PORTAL_DOCUMENT_NAME,
    FIELD_EXPECTED_DERIVED_DOCUMENT_GROUP,
    FIELD_EDITABLE_INSTRUMENT_CATEGORY,
  ],
};

/**
 * Maklumat Am tab schema for sewa_pajakan lane.
 */
const MAKLUMAT_AM_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "maklumat_am",
  tabLabel: "Maklumat Am",
  lane: "sewa_pajakan",
  isFullyMapped: true,
  observationNote: "Fields observed from e-Duti Setem portal screenshots (approx. 2025-03).",
  fields: [
    FIELD_STAMP_OFFICE,
    FIELD_INSTRUMENT_DATE,
    FIELD_RECEIVED_IN_MALAYSIA_DATE,
  ],
};

/** Placeholder schema for Bahagian A — penyeteman_am. */
const BAHAGIAN_A_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "bahagian_a",
  tabLabel: "Bahagian A",
  lane: "penyeteman_am",
  isFullyMapped: false,
  observationNote: "Tab structure observed but individual fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Bahagian B — penyeteman_am. */
const BAHAGIAN_B_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "bahagian_b",
  tabLabel: "Bahagian B",
  lane: "penyeteman_am",
  isFullyMapped: false,
  observationNote: "Tab structure observed but individual fields not yet mapped.",
  fields: [],
};

/** Rumusan Pengiraan for penyeteman_am. */
const RUMUSAN_PENGIRAAN_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "rumusan_pengiraan",
  tabLabel: "Rumusan Pengiraan",
  lane: "penyeteman_am",
  isFullyMapped: false,
  observationNote: "Duty summary fields observed. Party/instrument detail fields not yet mapped.",
  fields: [FIELD_DUTY_PAYABLE, FIELD_DUTY_TOTAL_PAYABLE],
};

/** Placeholder schema for Lampiran — penyeteman_am. */
const LAMPIRAN_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "lampiran",
  tabLabel: "Lampiran",
  lane: "penyeteman_am",
  isFullyMapped: false,
  observationNote: "Document upload tab. Fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Perakuan — penyeteman_am. */
const PERAKUAN_PENYETEMAN_AM: PortalPageSchema = {
  tabKey: "perakuan",
  tabLabel: "Perakuan",
  lane: "penyeteman_am",
  isFullyMapped: false,
  observationNote: "Declaration/confirmation tab. Fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Bahagian A — sewa_pajakan. */
const BAHAGIAN_A_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "bahagian_a",
  tabLabel: "Bahagian A",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Tab structure observed. Tenancy-specific fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Bahagian B — sewa_pajakan. */
const BAHAGIAN_B_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "bahagian_b",
  tabLabel: "Bahagian B",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Tab structure observed but fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Bahagian C — sewa_pajakan only. */
const BAHAGIAN_C_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "bahagian_c",
  tabLabel: "Bahagian C",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Tab structure observed (sewa_pajakan only). Fields not yet mapped.",
  fields: [],
};

/** Rumusan Pengiraan for sewa_pajakan. */
const RUMUSAN_PENGIRAAN_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "rumusan_pengiraan",
  tabLabel: "Rumusan Pengiraan",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Duty summary fields observed. Full field mapping pending.",
  fields: [FIELD_DUTY_PAYABLE, FIELD_DUTY_DUPLICATE_COPY, FIELD_DUTY_TOTAL_PAYABLE],
};

/** Placeholder schema for Lampiran — sewa_pajakan. */
const LAMPIRAN_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "lampiran",
  tabLabel: "Lampiran",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Document upload tab. Fields not yet mapped.",
  fields: [],
};

/** Placeholder schema for Perakuan — sewa_pajakan. */
const PERAKUAN_SEWA_PAJAKAN: PortalPageSchema = {
  tabKey: "perakuan",
  tabLabel: "Perakuan",
  lane: "sewa_pajakan",
  isFullyMapped: false,
  observationNote: "Declaration/confirmation tab. Fields not yet mapped.",
  fields: [],
};

// ─── Lane Schema Registry ────────────────────────────────────────────

const SCHEMA_PENYETEMAN_AM: PortalPageSchema[] = [
  MAKLUMAT_AM_PENYETEMAN_AM,
  BAHAGIAN_A_PENYETEMAN_AM,
  BAHAGIAN_B_PENYETEMAN_AM,
  RUMUSAN_PENGIRAAN_PENYETEMAN_AM,
  LAMPIRAN_PENYETEMAN_AM,
  PERAKUAN_PENYETEMAN_AM,
];

const SCHEMA_SEWA_PAJAKAN: PortalPageSchema[] = [
  MAKLUMAT_AM_SEWA_PAJAKAN,
  BAHAGIAN_A_SEWA_PAJAKAN,
  BAHAGIAN_B_SEWA_PAJAKAN,
  BAHAGIAN_C_SEWA_PAJAKAN,
  RUMUSAN_PENGIRAAN_SEWA_PAJAKAN,
  LAMPIRAN_SEWA_PAJAKAN,
  PERAKUAN_SEWA_PAJAKAN,
];

// ─── Readback Schemas ────────────────────────────────────────────────

const READBACK_PENYETEMAN_AM: PortalReadbackSchema = {
  lane: "penyeteman_am",
  entries: [
    {
      fieldKey: PORTAL_FIELD_KEYS.PORTAL_DOCUMENT_NAME,
      tab: "maklumat_am",
      description: "Selected portal document name must match intended Nama Surat Cara",
      readbackType: "exact_match",
      isValidationTarget: true,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.EXPECTED_DERIVED_DOCUMENT_GROUP,
      tab: "maklumat_am",
      description: "Derived document group auto-populated by portal must match expected value",
      readbackType: "exact_match",
      isValidationTarget: true,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.EDITABLE_INSTRUMENT_CATEGORY,
      tab: "maklumat_am",
      description: "Editable instrument category value after entry",
      readbackType: "exact_match",
      isValidationTarget: false,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
      tab: "maklumat_am",
      description: "Stamp office selection must match intended value",
      readbackType: "exact_match",
      isValidationTarget: true,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE,
      tab: "rumusan_pengiraan",
      description: "Total payable duty as computed by portal",
      readbackType: "numeric_match",
      isValidationTarget: false,
    },
  ],
};

const READBACK_SEWA_PAJAKAN: PortalReadbackSchema = {
  lane: "sewa_pajakan",
  entries: [
    {
      fieldKey: PORTAL_FIELD_KEYS.STAMP_OFFICE,
      tab: "maklumat_am",
      description: "Stamp office selection must match intended value",
      readbackType: "exact_match",
      isValidationTarget: true,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.INSTRUMENT_DATE,
      tab: "maklumat_am",
      description: "Instrument date must match intended value",
      readbackType: "exact_match",
      isValidationTarget: true,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.DUTY_PAYABLE,
      tab: "rumusan_pengiraan",
      description: "Payable duty as computed by portal",
      readbackType: "numeric_match",
      isValidationTarget: false,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.DUTY_DUPLICATE_COPY,
      tab: "rumusan_pengiraan",
      description: "Duplicate copy duty as computed by portal (if applicable)",
      readbackType: "numeric_match",
      isValidationTarget: false,
    },
    {
      fieldKey: PORTAL_FIELD_KEYS.DUTY_TOTAL_PAYABLE,
      tab: "rumusan_pengiraan",
      description: "Total payable duty as computed by portal",
      readbackType: "numeric_match",
      isValidationTarget: false,
    },
  ],
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Return the full ordered tab schema for a portal lane.
 */
export function getPortalSchema(lane: PortalLane): PortalPageSchema[] {
  return lane === "penyeteman_am" ? SCHEMA_PENYETEMAN_AM : SCHEMA_SEWA_PAJAKAN;
}

/**
 * Return the Maklumat Am tab schema for a portal lane.
 */
export function getMaklumatAmSchema(lane: PortalLane): PortalPageSchema {
  return lane === "penyeteman_am"
    ? MAKLUMAT_AM_PENYETEMAN_AM
    : MAKLUMAT_AM_SEWA_PAJAKAN;
}

/**
 * Return the readback schema for a portal lane.
 */
export function getReadbackSchema(lane: PortalLane): PortalReadbackSchema {
  return lane === "penyeteman_am"
    ? READBACK_PENYETEMAN_AM
    : READBACK_SEWA_PAJAKAN;
}

/**
 * Look up a field schema by key within a lane's schema.
 * Returns null if the key is not found.
 */
export function getFieldSchema(
  lane: PortalLane,
  fieldKey: string
): PortalFieldSchema | null {
  const allTabs = getPortalSchema(lane);
  for (const tab of allTabs) {
    const field = tab.fields.find((f) => f.fieldKey === fieldKey);
    if (field) return field;
  }
  return null;
}
