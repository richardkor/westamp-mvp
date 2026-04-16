/**
 * WeStamp — STSDS Document Catalogue
 *
 * Loads and provides access to the internal STSDS document catalogue.
 *
 * Loading strategy:
 * 1. If `data/stsds_document_catalogue.json` exists, load and normalize it.
 * 2. Otherwise, fall back to a hardcoded seed subset based on
 *    evidence-backed observed portal mappings.
 *
 * Seed entries include:
 * - 1 sewa_pajakan entry (tenancy)
 * - 7 penyeteman_am entries with observed derived group + editable category
 * - Additional partially-known entries
 *
 * Architecture allows later enrichment by dropping a fuller JSON file.
 */

import * as fs from "fs";
import * as path from "path";
import {
  StsdsDocumentCatalogueItem,
  PortalLane,
  ObservedMappingEvidence,
} from "./stsds-types";

// ─── Catalogue Singleton ─────────────────────────────────────────────

let _catalogue: StsdsDocumentCatalogueItem[] | null = null;

export function getCatalogue(): StsdsDocumentCatalogueItem[] {
  if (!_catalogue) {
    _catalogue = loadCatalogue();
  }
  return _catalogue;
}

export function reloadCatalogue(): void {
  _catalogue = null;
}

// ─── Loading ─────────────────────────────────────────────────────────

const CATALOGUE_FILE = "data/stsds_document_catalogue.json";

interface RawCatalogueEntry {
  portalDocumentName?: string;
  portalLane?: string;
  expectedDerivedDocumentGroup?: string | null;
  observedEditableInstrumentCategory?: string | null;
  // Legacy field name from previous milestone — accepted during normalization
  expectedDerivedCategory?: string | null;
  aliases?: string[];
  supportedForAutomation?: boolean;
  mappingEvidence?: Partial<ObservedMappingEvidence>;
  notes?: string;
}

function loadCatalogue(): StsdsDocumentCatalogueItem[] {
  const filePath = path.join(process.cwd(), CATALOGUE_FILE);

  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(raw)) {
        return normalizeRawEntries(raw as RawCatalogueEntry[]);
      }
    } catch {
      // Fall through to seed data
    }
  }

  return SEED_CATALOGUE;
}

function normalizeRawEntries(
  entries: RawCatalogueEntry[]
): StsdsDocumentCatalogueItem[] {
  const seen = new Set<string>();
  const items: StsdsDocumentCatalogueItem[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.portalDocumentName || typeof e.portalDocumentName !== "string")
      continue;

    const portalLane: PortalLane =
      e.portalLane === "sewa_pajakan" ? "sewa_pajakan" : "penyeteman_am";
    const normalizedName = e.portalDocumentName.trim().toLowerCase();

    const dedupeKey = `${portalLane}:${normalizedName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Accept both new and legacy field names for derived group
    const derivedGroup =
      e.expectedDerivedDocumentGroup?.trim() ??
      e.expectedDerivedCategory?.trim() ??
      null;

    const editableCat =
      e.observedEditableInstrumentCategory?.trim() ?? null;

    // Determine mapping confidence from evidence or infer from data
    const evidence: ObservedMappingEvidence = e.mappingEvidence
      ? {
          confidence: e.mappingEvidence.confidence ?? "unknown",
          source: e.mappingEvidence.source ?? "assumed",
          observedAt: e.mappingEvidence.observedAt,
          note: e.mappingEvidence.note,
        }
      : {
          confidence:
            derivedGroup && editableCat
              ? "observed"
              : derivedGroup || editableCat
                ? "partial"
                : "unknown",
          source: "assumed",
        };

    items.push({
      id: `cat-${String(i + 1).padStart(4, "0")}`,
      portalLane,
      portalDocumentName: e.portalDocumentName.trim(),
      expectedDerivedDocumentGroup: derivedGroup,
      observedEditableInstrumentCategory: editableCat,
      normalizedName,
      aliases: Array.isArray(e.aliases)
        ? e.aliases
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim().toLowerCase())
        : [],
      supportedForAutomation: e.supportedForAutomation === true,
      mappingEvidence: evidence,
      notes: typeof e.notes === "string" ? e.notes : undefined,
    });
  }

  return items;
}

// ─── Evidence-backed convenience ─────────────────────────────────────

const OBSERVED: ObservedMappingEvidence = {
  confidence: "observed",
  source: "live_p8_verification",
  observedAt: "2026-04",
  note:
    "Live-verified on p8: namaperjanjian typed, blur triggered, " +
    "profile_desc populated by portal, pds_ps confirmed",
};

const OBSERVED_P5: ObservedMappingEvidence = {
  confidence: "observed",
  source: "live_p5_observation",
  observedAt: "2026-04",
  note:
    "Live-observed on p5 post-save page. pds_suratcara dropdown option " +
    "confirmed with exact value and label. pds_ps option set confirmed. " +
    "The required category choice per document is NOT yet proven — only " +
    "the current post-selection default (Prinsipal) was observed.",
};

const UNKNOWN_MAPPING: ObservedMappingEvidence = {
  confidence: "unknown",
  source: "assumed",
};

// ─── Seed Catalogue ──────────────────────────────────────────────────

const SEED_CATALOGUE: StsdsDocumentCatalogueItem[] = [
  // ── sewa_pajakan lane — 6 live-observed p5 Nama Surat Cara options ─
  // These are the exact options from the <select id="pds_suratcara">
  // dropdown on the p5 post-save page. Each option value is the portal's
  // internal code. The p5 lane does NOT have a profile_desc read-only
  // field — there is no server-derived classification string on p5.
  // The pds_ps options on p5 are: Prinsipal (p), Surat Cara berkaitan
  // Pajakan 49(e) (s).
  {
    id: "seed-sewa-001",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Perjanjian Sewa",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "perjanjian sewa",
    aliases: [
      "tenancy agreement",
      "perjanjian penyewaan",
      "rental agreement",
      "lease agreement",
    ],
    supportedForAutomation: true,
    mappingEvidence: OBSERVED_P5,
    notes:
      "pds_suratcara value=1101. Post-selection default pds_ps readback " +
      "was Prinsipal (p), but the required category rule is not yet proven.",
  },
  {
    id: "seed-sewa-002",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Borang Pajakan Tanah",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "borang pajakan tanah",
    aliases: ["land lease form"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED_P5,
    notes: "pds_suratcara value=1102",
  },
  {
    id: "seed-sewa-003",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Perjanjian Pajakan",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "perjanjian pajakan",
    aliases: ["lease agreement", "pajakan"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED_P5,
    notes: "pds_suratcara value=1330",
  },
  {
    id: "seed-sewa-004",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Novation Agreement",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "novation agreement",
    aliases: ["novasi", "perjanjian novasi"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED_P5,
    notes: "pds_suratcara value=1332",
  },
  {
    id: "seed-sewa-005",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Perjanjian Sub-Sewa",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "perjanjian sub-sewa",
    aliases: ["sub-tenancy agreement", "sublease agreement"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED_P5,
    notes: "pds_suratcara value=1333",
  },
  {
    id: "seed-sewa-006",
    portalLane: "sewa_pajakan",
    portalDocumentName: "Perjanjian Sub-Pajakan",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "perjanjian sub-pajakan",
    aliases: ["sub-lease agreement"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED_P5,
    notes: "pds_suratcara value=1334",
  },

  // ── penyeteman_am lane — 7 evidence-backed observed mappings ───────

  {
    id: "seed-am-001",
    portalLane: "penyeteman_am",
    portalDocumentName:
      "Acknowledgement Of Anti-Bribery And Corruption Policy",
    expectedDerivedDocumentGroup: "Akuan Berkanun",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName:
      "acknowledgement of anti-bribery and corruption policy",
    aliases: [
      "anti-bribery acknowledgement",
      "anti-corruption policy acknowledgement",
      "abc policy",
    ],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-002",
    portalLane: "penyeteman_am",
    portalDocumentName: "Letter of Authorisation and Indemnity",
    expectedDerivedDocumentGroup: "Authorisation Letter",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "letter of authorisation and indemnity",
    aliases: [
      "letter of authorization and indemnity",
      "authorisation letter",
      "authorization letter",
      "indemnity letter",
      "loi",
    ],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-003",
    portalLane: "penyeteman_am",
    portalDocumentName: "Proclamation of Sale",
    expectedDerivedDocumentGroup: "Kontrak Perisytiharan Jualan",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "proclamation of sale",
    aliases: ["proclamation sale", "perisytiharan jualan"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-004",
    portalLane: "penyeteman_am",
    portalDocumentName: "Employment Contract",
    expectedDerivedDocumentGroup: "Perjanjian Pekerjaan",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "employment contract",
    aliases: [
      "kontrak pekerjaan",
      "employment agreement",
      "kontrak kerja",
    ],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-005",
    portalLane: "penyeteman_am",
    portalDocumentName: "Employee Non-Disclosure Agreement",
    expectedDerivedDocumentGroup: "Perjanjian Pekerjaan",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "employee non-disclosure agreement",
    aliases: ["employee nda", "nda pekerjaan", "staff nda"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-006",
    portalLane: "penyeteman_am",
    portalDocumentName: "Receipt and Reassignment",
    expectedDerivedDocumentGroup:
      "Reconveyance, Discharged and Re assignment",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "receipt and reassignment",
    aliases: ["reassignment receipt"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },
  {
    id: "seed-am-007",
    portalLane: "penyeteman_am",
    portalDocumentName: "Deed Of Mutual Covenants",
    expectedDerivedDocumentGroup: "Covenants",
    observedEditableInstrumentCategory: "Prinsipal",
    normalizedName: "deed of mutual covenants",
    aliases: ["dmc", "mutual covenants deed"],
    supportedForAutomation: false,
    mappingEvidence: OBSERVED,
  },

  // ── penyeteman_am lane — partially-known entries ───────────────────

  {
    id: "seed-am-008",
    portalLane: "penyeteman_am",
    portalDocumentName: "Power of Attorney",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "power of attorney",
    aliases: ["poa", "surat kuasa"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
  {
    id: "seed-am-009",
    portalLane: "penyeteman_am",
    portalDocumentName: "Loan Agreement",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "loan agreement",
    aliases: ["perjanjian pinjaman", "loan facility agreement"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
  {
    id: "seed-am-010",
    portalLane: "penyeteman_am",
    portalDocumentName: "Sale and Purchase Agreement",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "sale and purchase agreement",
    aliases: ["spa", "snp", "s&p agreement", "perjanjian jual beli"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
  {
    id: "seed-am-011",
    portalLane: "penyeteman_am",
    portalDocumentName: "Deed of Assignment",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "deed of assignment",
    aliases: ["assignment deed", "surat ikatan penyerahan hak"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
  {
    id: "seed-am-012",
    portalLane: "penyeteman_am",
    portalDocumentName: "Memorandum of Transfer",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "memorandum of transfer",
    aliases: ["mot", "transfer memorandum"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
  {
    id: "seed-am-013",
    portalLane: "penyeteman_am",
    portalDocumentName: "Service Agreement",
    expectedDerivedDocumentGroup: null,
    observedEditableInstrumentCategory: null,
    normalizedName: "service agreement",
    aliases: ["perjanjian perkhidmatan"],
    supportedForAutomation: false,
    mappingEvidence: UNKNOWN_MAPPING,
  },
];
