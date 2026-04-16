/**
 * WeStamp — Tenancy Agreement Form Types
 *
 * TypeScript interfaces for all fields captured in the tenancy agreement
 * generation form. These types define the data shape only — no business
 * logic, no validation, no PDF generation.
 */

// ─── Party Types ──────────────────────────────────────────────────────

/** Individual or company — controls label text and NRIC requirement. */
export type PartyType = "individual" | "company";

// ─── Responsibility Enums ─────────────────────────────────────────────

/**
 * Who is responsible for utility payments.
 * - "tenant"   → Tenant Covenant included, Landlord Covenant omitted
 * - "landlord" → Tenant Covenant omitted, Landlord Covenant included
 */
export type UtilityResponsibility = "tenant" | "landlord";

/**
 * Who is responsible for periodic air-conditioning servicing.
 * - "tenant"   (default) → Tenant must service air-con at specified intervals
 * - "landlord"            → Landlord must service air-con
 */
export type AirConServicingResponsibility = "tenant" | "landlord";

// ─── Inventory Types ──────────────────────────────────────────────────

export type InventoryMode = "none" | "upload_own_inventory" | "build_inventory_in_app";

export type InventoryCategory =
  | "Living Room"
  | "Dining Area"
  | "Kitchen"
  | "Bedroom"
  | "Bathroom"
  | "General / Access Items";

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  "Living Room",
  "Dining Area",
  "Kitchen",
  "Bedroom",
  "Bathroom",
  "General / Access Items",
];

/** Predefined common items per category. */
export const SUGGESTED_ITEMS: Record<InventoryCategory, string[]> = {
  "Living Room": ["Sofa", "Coffee Table", "TV", "TV Cabinet", "Curtains", "Air-Conditioner"],
  "Dining Area": ["Dining Table", "Dining Chairs"],
  "Kitchen": ["Refrigerator", "Hob", "Hood", "Microwave", "Oven", "Kitchen Cabinet", "Washing Machine"],
  "Bedroom": ["Bed Frame", "Mattress", "Wardrobe", "Bedside Table", "Curtains", "Air-Conditioner"],
  "Bathroom": ["Water Heater", "Mirror"],
  "General / Access Items": ["Keys", "Access Cards", "Remote Controls", "Light Fittings"],
};

export interface InventoryItem {
  /** Simple unique ID (Date.now + random suffix). */
  id: string;
  category: InventoryCategory;
  itemName: string;
  quantity: number;
  /** In-memory photo attachments — no backend persistence. */
  photos: File[];
}

// ─── Form Data ────────────────────────────────────────────────────────

export interface TenancyFormData {
  // ── Agreement Date ────────────────────────────────────────────────
  /** Date of agreement (ISO date string, YYYY-MM-DD). Defaults to today. User-editable. */
  agreementDate: string;

  // ── Property ────────────────────────────────────────────────────────
  /** Full address of the premises. Required. */
  propertyAddress: string;

  // ── Landlord ────────────────────────────────────────────────────────
  /** Individual or company. Required. */
  landlordPartyType: PartyType;
  landlordName: string;
  landlordIdNumber: string;
  landlordAddress: string;
  landlordPhone: string;
  landlordEmail: string;
  landlordBankName: string;
  landlordBankAccountNumber: string;
  landlordBankAccountHolderName: string;

  // ── Tenant ──────────────────────────────────────────────────────────
  tenantPartyType: PartyType;
  tenantName: string;
  tenantIdNumber: string;
  tenantAddress: string;
  tenantPhone: string;
  tenantEmail: string;
  tenantNricFront: File | null;
  tenantNricBack: File | null;

  // ── Tenancy Terms ───────────────────────────────────────────────────
  monthlyRent: string;
  leaseMonths: string;
  commencementDate: string;
  securityDeposit: string;
  utilityDeposit: string;
  accessCardDeposit: string;

  // ── Renewal ─────────────────────────────────────────────────────────
  /** Whether the agreement includes an option to renew. */
  hasOptionToRenew: boolean;
  /** Renewal term in months. Only relevant when hasOptionToRenew is true. */
  optionToRenewTermMonths: number | null;

  // ── Responsibilities ────────────────────────────────────────────────
  utilityResponsibility: UtilityResponsibility;
  airConServicingResponsibility: AirConServicingResponsibility;

  // ── Handover & Inventory ────────────────────────────────────────────
  handoverDate: string;
  inventoryMode: InventoryMode;
  /** Files uploaded by user for inventory (in-memory only). */
  inventoryUploadFiles: File[];
  /** Items built in the in-app inventory builder. */
  inventoryItems: InventoryItem[];

  // ── Additional ──────────────────────────────────────────────────────
  specialConditions: string;

  // ── System / Fixed ──────────────────────────────────────────────────
  agreementType: "residential_tenancy";
}

// ─── Defaults ─────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Sensible defaults for a new blank form. */
export const TENANCY_FORM_DEFAULTS: TenancyFormData = {
  agreementDate: todayISO(),
  propertyAddress: "",
  landlordPartyType: "individual",
  landlordName: "",
  landlordIdNumber: "",
  landlordAddress: "",
  landlordPhone: "",
  landlordEmail: "",
  landlordBankName: "",
  landlordBankAccountNumber: "",
  landlordBankAccountHolderName: "",
  tenantPartyType: "individual",
  tenantName: "",
  tenantIdNumber: "",
  tenantAddress: "",
  tenantPhone: "",
  tenantEmail: "",
  tenantNricFront: null,
  tenantNricBack: null,
  monthlyRent: "",
  leaseMonths: "",
  commencementDate: "",
  securityDeposit: "",
  utilityDeposit: "",
  accessCardDeposit: "",
  hasOptionToRenew: false,
  optionToRenewTermMonths: null,
  utilityResponsibility: "tenant",
  airConServicingResponsibility: "tenant",
  handoverDate: "",
  inventoryMode: "none",
  inventoryUploadFiles: [],
  inventoryItems: [],
  specialConditions: "",
  agreementType: "residential_tenancy",
};
