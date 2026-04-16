/**
 * WeStamp — Tenancy Agreement Template Builder (Pavilion-faithful)
 *
 * Generates a tenancy agreement following the Pavilion Embassy Service Suites
 * template structure and wording. User data is inserted into variable
 * placeholders only — no generic redrafting.
 *
 * Structure: Cover → Preamble → WHEREAS → Operative Clauses → Tenant Covenants →
 * Landlord Covenants → PROVIDED ALWAYS → Interpretation → Execution →
 * THE SCHEDULE → Inventory List → Annexures
 *
 * Limited borrowings:
 * - Autorentic: PDPA / personal data
 * - Ritz: utility deposit structure, air-con servicing (if landlord), special conditions (Schedule Section 12)
 */

import { TenancyFormData, InventoryItem, InventoryCategory, INVENTORY_CATEGORIES } from "./tenancy-types";
import { ringgitWords } from "./amount-words";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LetterClause {
  letter: string;
  marginNote: string;
  text: string;
}

export interface Proviso {
  marginNote: string;
  text: string;
}

export interface ScheduleRow {
  section: string;
  item: string;
  value: string;
}

export interface InventoryGrouped {
  category: InventoryCategory;
  items: { itemName: string; quantity: number }[];
}

export interface AgreementDoc {
  // Cover
  agreementDateOrdinal: string;
  landlordDescriptor: string;
  tenantDescriptor: string;
  propertyAddress: string;

  // Body
  preambleText: string;
  recitals: { number: string; text: string }[];
  operativeClauses: { number: number; marginNote: string; text: string }[];
  tenantCovenantsClauseNum: number;
  tenantCovenants: LetterClause[];
  landlordCovenantsClauseNum: number;
  landlordCovenants: LetterClause[];
  provisosClauseNum: number;
  provisos: Proviso[];
  interpretationClauseNum: number;
  interpretation: string[];

  // Schedule
  schedule: ScheduleRow[];

  // Inventory
  inventoryMode: "none" | "upload_own_inventory" | "build_inventory_in_app";
  inventoryUploadFileNames: string[];
  inventoryGrouped: InventoryGrouped[];

  // Annexures
  annexures: { id: string; title: string; placeholder: string }[];

  // Execution block data
  landlordName: string;
  landlordIdLine: string;
  tenantName: string;
  tenantIdLine: string;
}

// ─── Date utilities ───────────────────────────────────────────────────────

function fmtDate(isoStr: string): string {
  if (!isoStr) return "\u2014";
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Ordinal suffix for a day number: 1ST, 2ND, 3RD, 4TH, 11TH, 12TH, 13TH, 21ST, etc.
 */
function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "TH";
  const lastDigit = day % 10;
  if (lastDigit === 1) return "ST";
  if (lastDigit === 2) return "ND";
  if (lastDigit === 3) return "RD";
  return "TH";
}

/**
 * Format ISO date as ordinal cover-page style: "26TH DAY OF MARCH, 2026"
 */
function fmtDateOrdinal(isoStr: string): string {
  if (!isoStr) return "\u2014";
  const [y, m, d] = isoStr.split("-").map(Number);
  const months = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return `${d}${ordinalSuffix(d)} DAY OF ${months[m - 1]}, ${y}`;
}

/**
 * Add N months to an ISO date string using proper month-add logic.
 * Clamps to the last day of the target month if the day overflows.
 */
function addMonths(isoStr: string, months: number): Date {
  const [y, m, d] = isoStr.split("-").map(Number);
  const result = new Date(y, m - 1 + months, d);
  if (result.getDate() !== d) {
    result.setDate(0);
  }
  return result;
}

/**
 * Derive tenancy end date: commencementDate + leaseMonths, minus 1 day.
 */
export function deriveEndDate(commencementDate: string, leaseMonths: string): string {
  const months = parseInt(leaseMonths, 10);
  const end = addMonths(commencementDate, months);
  end.setDate(end.getDate() - 1);
  return end.toLocaleDateString("en-MY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────

function idLabel(partyType: "individual" | "company"): string {
  return partyType === "individual" ? "NRIC NO." : "CO. REG. NO.";
}

// ─── Inventory grouping ──────────────────────────────────────────────────

function groupInventory(items: InventoryItem[]): InventoryGrouped[] {
  const groups: InventoryGrouped[] = [];
  for (const cat of INVENTORY_CATEGORIES) {
    const catItems = items
      .filter((it) => it.category === cat)
      .map((it) => ({ itemName: it.itemName, quantity: it.quantity }));
    if (catItems.length > 0) {
      groups.push({ category: cat, items: catItems });
    }
  }
  return groups;
}

// ─── Clause builders ──────────────────────────────────────────────────────

function buildTenantCovenants(form: TenancyFormData): LetterClause[] {
  const clauses: LetterClause[] = [];
  let letterCode = 97; // 'a'

  function next(marginNote: string, text: string) {
    clauses.push({ letter: `(${String.fromCharCode(letterCode++)})`, marginNote, text });
  }

  // (a) Pay reserved rent — Pavilion verbatim
  next(
    "To Pay Reserved Rent",
    "To pay the reserved rent on the days and in the manner aforesaid without any deductions whatsoever.",
  );

  // (b) Pay utilities — conditional on utilityResponsibility === "tenant"
  if (form.utilityResponsibility === "tenant") {
    next(
      "Payment of Utilities",
      "To pay all charges due and incurred in respect of, electricity, water, sewerage (Indah Water), gas and all other utilities supplied to the Said Premises.",
    );
  }

  // (c) Keep in good condition — fixed wording (Clause 5.3, invariant)
  next(
    "To keep in good condition",
    "To keep the Said Premises, the interior, fixtures, fittings and furniture including but not limiting to those listed in the Inventory hereto (if any) together with any additions thereto in a good and tenantable repair condition (normal wear and tear excepted) and to replace or repair any of the aforesaid items and any part of the Said Premises and the Landlord's fixtures and fittings which shall be damaged.",
  );

  // (d) No alterations — Pavilion verbatim
  next(
    "Not to make alterations and to maintain premises in present state",
    "Not to make or permit to be made any alterations in or additions to the Said Premises or the Landlord's fixtures, fittings, decorations, locks or bolts on the entrance doors or otherwise affecting the surface of wall, ceiling or change the color of walls, ceiling and floor to the premises therein without having first obtained the written license and consent of the Landlord thereof and in the event of such license and consent being given to carry out at the Tenant's own expense such alterations with such materials and such manner and at such times as shall be designated by the Landlord and upon the determination of the term hereby created, if required by the Landlord, to restore the Said Premises to its original state and condition at the expense of the Tenant.",
  );

  // (e) Permit inspection — Pavilion verbatim
  next(
    "To permit entry for inspection and repair purposes",
    "To permit the Landlord and his duly authorised representatives upon at all reasonable times to enter upon and examine the condition of the Said Premises, whereupon the Landlord shall be entitled to serve the Tenant a notice in writing specifying therein any repairs necessary to be carried out and requiring the Tenant to forthwith to execute the same and if the Tenant shall not within fourteen (14) days after service of such notice proceed diligently with the execution of such repairs or works then the Landlord with or without workmen and others shall be entitled to enter upon the Said Premises and execute the repairs and the Tenant agrees that the costs thereof shall be a debt from the Tenant to the Landlord and be forthwith recoverable by action.",
  );

  // (f) Use for stated purpose — Pavilion verbatim
  next(
    "Used for stated purpose only",
    "To use the Said Premises only for the purpose stipulated in the Section 10 of the Schedule hereto and not to use or permit or suffer the use thereof for any other purpose Save and Except for the specific purpose herein stated and further not to do or permit or suffer anything to be done in or about the Said Premises or any part thereof which may become a nuisance or cause damage or inconvenience to the Landlord or the Tenant or occupiers of neighbouring premises.",
  );

  // (g) Not to assign/sublet — Pavilion verbatim
  next(
    "Not to assign and sublet",
    "Not to assign, sublet, or part with the actual or legal possession or the use of the Said Premises for any term whatsoever without first obtaining the previous consent in writing of the Landlord.",
  );

  // (h) Not to affect insurance — Pavilion verbatim
  next(
    "Not to do acts which will affect the Landlord",
    "Not to do or permit to be done on the Said Premises anything which may or will infringe any of the laws, by-laws or regulation made by the Government or any competent authority affecting the Said Premises or whereby the policy or policies of insurance against loss or damage by fire may become void or voidable or whereby the rates of premium payable thereon may be increased to repay the Landlord all sums paid by way of increased premium.",
  );

  // (i) Surrender and reinstatement — REVISED (3 sub-paragraphs)
  // Replaces old Pavilion clause 5.9 per drafting correction #11
  next(
    "To yield up and reinstate Said Premises",
    "(a) On the determination of the term hereby created the Tenant shall yield up the Said Premises, the Landlord's Fixtures and Fittings and all other things therein in any way belonging to the Landlord pertaining to the Said Premises in such good and tenantable condition as shall be in accordance with the covenants of the Tenant hereinbefore contained with all locks and keys complete. The Tenant shall remove from the Demised Premises all fixtures, fittings and installations of the Tenant or any part thereof as may be specified and/or required by the Landlord and any damage arising from such removal shall be made good by the Tenant. Upon determination of the tenancy, the Tenant shall clean the Said Premises and replace fused bulbs (if any) at the Tenant's own cost.\n\n(b) If the Tenant shall fail to reinstate the Said Premises as provided hereinbefore to the satisfaction of the Landlord, the Landlord may reinstate the Said Premises and all costs and expenses thereby incurred by the Landlord shall be reimbursed by the Tenant within seven (7) days of a written notice of the Landlord to the Tenant requiring payment of such monies failing which the Landlord may deduct such sum from the Security Deposit and any balance still due from the Tenant shall be a debt due by the Tenant to the Landlord.\n\n(c) If the Tenant on the determination of the tenancy fails to yield up and vacate the Said Premises as aforesaid, the Tenant shall pay to the Landlord as agreed ascertained and liquidated damages a sum equivalent to double of the Rental for each day's delay without prejudice to the Landlord's right to evict the Tenant or take legal proceedings to enforce the rights of the Landlord contained in this Agreement including forfeiture of Security Deposit and other deposits and any other monies paid under this Tenancy.",
  );

  // (j) Not to store unlawful goods — Pavilion verbatim
  next(
    "Not to store unlawful goods",
    "Not to store or bring upon the Said Premises arms ammunitions or unlawful goods gunpowder or any explosive or any article or articles of a specially combustible inflammable or dangerous nature and unlawful goods in any part of the Said Premises.",
  );

  // (k) Permit viewing — Pavilion verbatim
  next(
    "Permission to view",
    "During the Two (2) months immediately preceding the termination of the tenancy unless the Tenant shall have given notice of his intention to renew the tenancy as hereinafter provided, to permit persons with the written authority from the Landlord at all reasonable times of the day to view the Said Premises for the purpose of letting the same.",
  );

  // (l) Keep drains/pipes — Pavilion verbatim
  next(
    "To keep good condition",
    "To keep in good clean tenantable repair and condition all the drains and pipes in the Premises and to pay to the Landlord on demand all costs incurred by the Landlord in cleansing and clearing any of the drains pipes sanitary or water apparatus choked or stopped up owing to careless or negligent use thereof by the Tenant or his employees, servants, workmen, licensees, customers or any persons authorised by him.",
  );

  // (m) Replace broken fixtures — Pavilion verbatim
  next(
    "To replace broken fixture",
    "To replace all broken or damaged windows, doors, furniture and fixtures of and in the Premises whether the same be broken or damaged due to the negligence or default of the Tenant.",
  );

  // (n) Air-con servicing — conditional on airConServicingResponsibility
  if (form.airConServicingResponsibility === "tenant") {
    next(
      "To maintain air-conditioners and dry clean curtain (If Provided)",
      "To maintain and service all the air-conditioning units and dry clean all curtains (if provided) within the Demised Premises once every six (6) months during the Term of Tenancy at the Tenant's own costs. Provided always nothing herein shall make it incumbent on the Tenant to compensate for any major replacement or extensive repairs to the air-conditioning units save and except where replacement or repairs are caused by negligence of or misuse by the Tenant, its servants and/or agents or through lack of maintenance.",
    );
  }

  // (o) Insurance — REVISED per drafting correction #9
  next(
    "Insurance",
    "To be responsible, at the Tenant's own costs and expenses, to take up insurance against fire, theft and all other risks deemed necessary by the Tenant for its own personal belongings in the Said Premises throughout the Tenancy herein.",
  );

  return clauses;
}

function buildLandlordCovenants(form: TenancyFormData): LetterClause[] {
  const clauses: LetterClause[] = [];
  let letterCode = 97; // 'a'

  function next(marginNote: string, text: string) {
    clauses.push({ letter: `(${String.fromCharCode(letterCode++)})`, marginNote, text });
  }

  // (a) Pay quit rent, assessment, service charges — Pavilion verbatim
  next(
    "To pay quit rent, assessment and service charges",
    "To pay the Quit Rent, assessment, service charges and other outgoings relating to the Said Premises.",
  );

  // (b) Keep insured — Pavilion verbatim
  next(
    "To keep insured and reinstate Said Premises",
    "At all times through the period of this Agreement to keep the Said Premises except the furniture, fixtures therein belonging to the Tenant insured against loss or damage by fire or tempest and in case of destruction by fire or tempest to replace or reinstate the same as speedily as possible.",
  );

  // Conditional: if landlord pays utilities (Ritz borrowing)
  if (form.utilityResponsibility === "landlord") {
    next(
      "Payment of Utilities",
      "To pay all charges due and incurred in respect of, electricity, water, sewerage (Indah Water), gas and all other utilities supplied to the Said Premises.",
    );
  }

  // Maintain structure — fixed wording (Clause 6.3, invariant)
  next(
    "To maintain structure of Said Premises in tenantable repair condition",
    "To maintain and keep the main structure of the Said Premises that is the roof, main walls and timbers, drains, water pipes and electrical wiring in good and tenantable repair condition throughout the term hereby created except as regards damage to the premises caused by or resulting from any act of default or negligence of the Tenant or his servants and except as hereinbefore covenanted to be done by the Tenant, then the Tenant shall carry out such repairs at the Tenant's own cost and expense.",
  );

  // Conditional: if landlord services air-con (Ritz borrowing)
  if (form.airConServicingResponsibility === "landlord") {
    next(
      "To maintain air-conditioners",
      "To maintain and service all the air-conditioning units within the Demised Premises once every six (6) months during the Term of Tenancy at the Landlord's own costs. Provided always nothing herein shall make it incumbent on the Landlord to compensate for any replacement or repairs to the air-conditioning units caused by negligence of or misuse by the Tenant, its servants and/or agents.",
    );
  }

  // Quiet enjoyment — Pavilion verbatim
  next(
    "To allow Tenant to enjoy Said Premises without Landlord's interruption",
    "Upon the Tenant paying the rent hereby reserved and observing and performing the covenants, obligations and stipulations herein on his part contained, to allow the Tenant to peacefully hold and enjoy the Said Premises without interruption from the Landlord or any persons rightfully claiming through under or in trust for him.",
  );

  return clauses;
}

function buildProvisos(form: TenancyFormData): Proviso[] {
  const provisos: Proviso[] = [];

  // Power of re-entry — Pavilion verbatim (7 days)
  provisos.push({
    marginNote: "Power of re-entry",
    text: "If at any time the rent or any part thereof (whether formally demanded or not) shall remain unpaid or unsatisfied for seven (7) days after becoming payable or if any of the Tenant's covenant shall not be performed or observed or if the Tenant shall suffer execution on the Said Premises or if the Tenant shall become a bankrupt or being a company or corporation shall go into liquidation otherwise than for the purpose of amalgamation or reconstruction or if the Tenant for the time being shall enter into any composition with the Tenant's creditors or suffer any distress or execution to be levied on the Tenant's goods then and in any of those events it shall be lawful for the Landlord to immediately terminate this tenancy absolutely without any notice and the Security Deposit shall be forfeited by the Landlord and the Landlord or any persons authorised by the Landlord in that behalf at any time thereafter to re-enter upon the Said Premises or any part thereof in the name of the whole but without prejudice to any other right of action or remedy of the Landlord in respect of any breach of the Tenant's covenants herein contained.",
  });

  // Destruction/fire — Pavilion verbatim
  provisos.push({
    marginNote: "Destruction or damage to Said Premises / Suspension of Reserved Rent",
    text: "In case the Said Premises or any part thereof shall at any time during the term hereby created be destroyed or damaged by fire (except where such fire has been caused by the fault or negligence of the Tenant) or so as to be unfit for occupation or use for a period greater than One (1) month the rent hereby reserved or a fair proportion thereof according to the nature and extent of the damage sustained shall (after the expiration of the aforesaid One (1) month period) be suspended until the Said Premises shall again be rendered fit for occupation and use AND PROVIDED ALWAYS that if the Said Premises or any part thereof shall not be rendered and reinstated and made ready and fit for occupation within a period of Two (2) months from the date of happening of any such event the Tenant shall be at liberty to give to the Landlord One (1) calendar month's notice in writing determining the Tenancy hereby created and thereupon this Tenancy shall absolutely be terminated and the Security Deposit and the Utility Deposits paid by the Tenant hereunder shall be refunded to the Tenant forthwith but without prejudice to the right of action of the Landlord in respect of any antecedent breach of any covenant or condition herein contained.",
  });

  // Premature termination — Clause 7.3: user's exact wording
  provisos.push({
    marginNote: "Premature Termination",
    text: `There shall be no termination of the Tenancy whatsoever during the specified period as mentioned in Section 5(a) of the Schedule. The Landlord shall not be entitled to unilaterally determine and/or terminate the Tenancy Agreement during the term of this Tenancy save and except for default and breach as stipulated under Clause 7.1 failing which, the Landlord shall compensate to the Tenant the rental of the remaining unexpired term of the term of this Tenancy as agreed liquidated damages (without the proof of actual losses) and the Security Deposit and Utility Deposits shall be refunded to the Tenant by the Landlord free of interest but without prejudice to the Tenant\u2019s right to claim in addition thereto damages against the other party. It is hereby agreed that in the event of any premature determination of the term of this Tenancy by the Tenant, the Tenant shall compensate to the Landlord a sum equivalent to the rental payable for the remaining unexpired term of the term of this Tenancy as agreed liquidated damages (without the proof of actual losses) and the Security Deposit and Utility Deposits shall be forfeited by the Landlord.`,
  });

  // Option to renew — Pavilion clause 7.3 style (conditional)
  if (form.hasOptionToRenew && form.optionToRenewTermMonths) {
    const renewalMonths = form.optionToRenewTermMonths;
    provisos.push({
      marginNote: "Option to Renew",
      text: `The Tenant shall have the option to renew the tenancy for a further term of ${renewalMonths} months as stated in Section 9 of the Schedule hereto subject to the Tenant giving the Landlord not less than Two (2) months' written notice prior to the expiration of the term hereby created of the Tenant's desire to take such renewal and provided that all the covenants and stipulations on the part of the Tenant herein contained shall have been duly observed and performed up to the date of such renewal and the renewed tenancy shall be upon the same terms and conditions as herein contained save and except for this option to renew and the monthly rental which shall be mutually agreed upon between the Landlord and the Tenant.`,
    });
  }

  // Sale subject to tenancy — Pavilion verbatim
  provisos.push({
    marginNote: "Sales of Said Premises subject to tenancy",
    text: "In the event the Landlord shall be desirous of selling the Said Premises prior to the expiration of the term hereby created, the Landlord hereby covenants, undertakes and agrees that such sale shall be subject to this tenancy and shall procure the Purchaser to continue with the terms and conditions of this Agreement in lieu of the Landlord.",
  });

  // Costs — Pavilion verbatim
  provisos.push({
    marginNote: "Cost of preparing agreement",
    text: "All costs and incidentals to the preparation and completion of this Agreement including stamp duty shall be borne by the Tenant and each party shall bear their own solicitor's fees.",
  });

  // Service of notice — Pavilion verbatim
  provisos.push({
    marginNote: "Service of notice",
    text: "Any notice in writing under the terms and conditions of this Agreement to be sent to either party hereto on the other shall be by prepaid registered post and shall be deemed to be sufficiently served at the time when the ordinary course of post would have been delivered.",
  });

  // Landlord not liable — Pavilion verbatim
  provisos.push({
    marginNote: "Limitation of Landlord's liability",
    text: "The Landlord shall not be under any liability whatsoever to the Tenant or any other person whomsoever in respect of any damage sustained by the Tenant or such other person as aforesaid caused by or through or in any way owing to the failure or malfunctioning of the air-conditioning system (if any), any appliances (if any), water pumps, drainage system or electrical wiring or equipment of and in the Building or the overflow of water from the unit or caused by the negligence of any tenant of such premises And in any of such events the Tenant shall not be entitled to any abatement of Rent or other charges payable by the Tenant hereunder. The Tenant shall fully indemnify the Landlord against all claims demands actions and legal proceedings whatsoever made upon the Landlord in respect of any damage to any person whomsoever caused by the negligence of the Tenant.",
  });

  // Time of the essence — drafting correction #13
  provisos.push({
    marginNote: "Time of the Essence",
    text: "Time wherever mentioned in this Agreement shall be of the essence of this Agreement.",
  });

  // Indulgence not waiver — drafting correction #14
  provisos.push({
    marginNote: "No Waiver",
    text: "Any indulgence given by the Landlord or its agents to the Tenant shall not constitute a waiver of or prejudice the Landlord's rights and remedies herein contained.",
  });

  // PDPA — Autorentic borrowing
  provisos.push({
    marginNote: "Personal Data Protection",
    text: "Each party acknowledges that personal data collected in connection with this Agreement will be processed in accordance with the Personal Data Protection Act 2010 (Malaysia). The parties consent to the collection, use, and disclosure of their personal data as reasonably necessary for the purposes of this Agreement and for compliance with applicable law.",
  });

  // Execution — counterparts clause (moved into body from signing page)
  provisos.push({
    marginNote: "Execution",
    text: "This Agreement may be executed in counterparts, including electronically or digitally. Each counterpart constitutes an original of this Agreement, all of which together constitute one instrument. A Party who has executed a counterpart of this Agreement may exchange it with another Party by electronic means including Docusign, faxing, or by emailing a pdf (portable document format) copy of, the executed counterpart to that other Party, and if requested by that other Party, will promptly deliver the original by hand or post. Failure to make that delivery by hand or by post will not affect the validity of this Agreement.",
  });

  return provisos;
}

// ─── Main builder ─────────────────────────────────────────────────────────

export function buildAgreement(form: TenancyFormData): AgreementDoc {
  const landlordIdLabel = idLabel(form.landlordPartyType);
  const tenantIdLabel   = idLabel(form.tenantPartyType);

  const landlordDescriptor = `${form.landlordName.toUpperCase()} (${landlordIdLabel}: ${form.landlordIdNumber})`;
  const tenantDescriptor   = `${form.tenantName.toUpperCase()} (${tenantIdLabel}: ${form.tenantIdNumber})`;

  const agreementDateOrdinal = fmtDateOrdinal(form.agreementDate);
  const agreementDateFmt     = fmtDate(form.agreementDate);
  const commencementDateFmt  = fmtDate(form.commencementDate);
  const endDateFmt           = deriveEndDate(form.commencementDate, form.leaseMonths);

  const utilityDepositIsZero = parseFloat(form.utilityDeposit.trim() || "0") === 0;
  const hasAccessCardDep    = form.accessCardDeposit.trim() !== "";

  // ── Preamble text (Pavilion verbatim — refers to Schedule Section 1) ──
  const preambleText = `THIS AGREEMENT is made the day and year stated in Section 1 of the Schedule hereto between the party whose name and description are stated in Section 2 of the Schedule hereto (hereinafter called the \u201CLandlord\u201D) of the one part and the party whose name and description are stated in Section 3 of the Schedule hereto (hereinafter called the \u201CTenant\u201D) of the other part.`;

  // ── Recitals (numbered 1. 2. 3.) ──────────────────────────────────────
  const recitals: { number: string; text: string }[] = [
    {
      number: "1.",
      text: `The Landlord is the registered/beneficial proprietor of the property more particularly referred to and described in Section 4 of the Schedule hereto (hereinafter referred to as the Said Premises). The Landlord warrants that the co-registered/beneficial proprietor (if any) has authorized the Landlord to enter into this Agreement with the Tenant.`,
    },
    {
      number: "2.",
      text: `The Landlord is desirous of letting and the Tenant is desirous of taking the Said Premises together with furniture, fixtures and fittings as described in the Inventory hereto (where applicable) subject to the terms and conditions hereinafter contained.`,
    },
    {
      number: "3.",
      text: `The Tenant has inspected the Said Premises and has agreed to take a tenancy of the Said Premises on an \u201Cas is where is\u201D basis.`,
    },
  ];

  // ── Operative clauses (numbered) ──────────────────────────────────────
  let clauseNum = 1;
  const operativeClauses: { number: number; marginNote: string; text: string }[] = [
    {
      number: clauseNum++,
      marginNote: "Agreement To Rent / Term Of Tenancy",
      text: "Subject to the terms and conditions herein contained the Landlord hereby grants and the Tenant hereby accepts a tenancy of the Said Premises for the term, commencing from the date and terminating on the date stated in Section 5(a) (b) and (c) respectively of the Schedule hereto.",
    },
    {
      number: clauseNum++,
      marginNote: "Monthly Rental and date payable",
      text: "The monthly rental stipulated in Section 6(a) of the Schedule hereto shall be due and payable in advance in the manner and at the time stipulated in Section 6(c) respectively of the Schedule hereto.",
    },
    {
      // Clause 3 — REVISED per drafting correction #7:
      // "the said deposits" → "the Security Deposit", 30 days → 14 days
      number: clauseNum++,
      marginNote: "Security Deposit",
      text: "The Tenant shall upon execution of this Agreement and prior to the occupation of the Said Premises pay the Landlord the deposit stipulated in Section 7 of the Schedule hereto (receipt whereof the Landlord hereby acknowledges) as security for the due observance and performance by the Tenant of all his duties and obligations hereunder and on its part to be performed and fulfilled. The Security Deposit shall be maintained at this figure during the term of this tenancy and the Tenant shall not be entitled to utilise the Security Deposit to off-set any rental due under this Agreement and the same shall be returned to the Tenant free of interest within fourteen (14) days upon expiry or sooner determination of the term hereby created less any sums as may then be due to the Landlord for damage caused to the Said Premises by the Tenant (damage due to normal wear and tear excepted).",
    },
  ];

  // Clause 4: Utility Deposits — ALWAYS present (clause structure locked)
  operativeClauses.push({
    number: clauseNum++,
    marginNote: "Utility Deposits",
    text: "The Tenant shall upon execution of this Agreement and prior to the occupation of the Said Premises pay the Landlord the water and electricity deposits stipulated in Section 8 of the Schedule hereto (collectively as the Utility Deposits). The Tenant shall not be entitled to utilise the Utility Deposits to off-set any rental due under this Agreement and the same shall be refunded to the Tenant free of interest within fourteen (14) days upon expiry or sooner determination of the term hereby created less such sum or sums as may then be due and outstanding.",
  });

  // ── Covenants ────────────────────────────────────────────────────────
  const tenantCovenants  = buildTenantCovenants(form);
  const landlordCovenants = buildLandlordCovenants(form);

  // Clause numbering: operative clauses are 1..N, then tenant covenants, landlord covenants, provisos
  const tenantCovenantsClauseNum  = clauseNum; // next after last operative clause
  const landlordCovenantsClauseNum = tenantCovenantsClauseNum + 1;
  const provisosClauseNum          = landlordCovenantsClauseNum + 1;
  const interpretationClauseNum    = provisosClauseNum + 1;

  // ── Provisos ─────────────────────────────────────────────────────────
  const provisos = buildProvisos(form);

  // ── Interpretation (Pavilion verbatim) ───────────────────────────────
  const interpretation = [
    `The terms \u201CLandlord\u201D and \u201CTenant\u201D shall include their heirs, personal representatives and successors in title.`,
    `Words importing the masculine gender only shall include feminine and neuter genders and vice versa.`,
    `Words importing the singular number only shall include the plural and vice versa.`,
  ];

  // ── The Schedule (amounts now in words + figures) ────────────────────
  const schedule: ScheduleRow[] = [
    { section: "1.",     item: "Date of Agreement",             value: agreementDateFmt },
    { section: "2.",     item: "Description of Landlord",       value: landlordDescriptor },
    { section: "3.",     item: "Description of Tenant",         value: tenantDescriptor },
    { section: "4.",     item: "Description of Said Premises",  value: form.propertyAddress },
    { section: "5(a)",   item: "Term",                          value: `${form.leaseMonths} months` },
    { section: "5(b)",   item: "Commencing",                    value: commencementDateFmt },
    { section: "5(c)",   item: "Terminating",                   value: endDateFmt },
    { section: "6(a)",   item: "Monthly Rental",                value: ringgitWords(form.monthlyRent) },
    { section: "6(b)",   item: "Account No:",                   value: `${form.landlordBankName}: ${form.landlordBankAccountNumber} (${form.landlordBankAccountHolderName})` },
    { section: "6(c)",   item: "Due on:",                       value: "DUE AND PAYABLE ON OR BEFORE THE 7TH DAY OF EACH CALENDAR MONTH" },
    { section: "7.",     item: "Security Deposit",              value: ringgitWords(form.securityDeposit) },
  ];

  // Section 8: Utility Deposits — ALWAYS present
  schedule.push({
    section: "8.",
    item: "Utility Deposits",
    value: utilityDepositIsZero ? "Not Applicable" : ringgitWords(form.utilityDeposit),
  });

  // Section 9: Option to Renew (conditional)
  if (form.hasOptionToRenew && form.optionToRenewTermMonths) {
    schedule.push({
      section: "9.",
      item: "Option to Renew",
      value: `${form.optionToRenewTermMonths} months`,
    });
  }

  // Section 10 — REVISED per drafting correction #6
  schedule.push({ section: "10.", item: "Use of the Said Premises", value: "For residential purposes only" });

  if (hasAccessCardDep) {
    schedule.push({ section: "11.", item: "Access Card Deposit", value: ringgitWords(form.accessCardDeposit) });
  }

  // Section 12: Special Conditions (moved from body provisos to Schedule)
  if (form.specialConditions.trim()) {
    schedule.push({ section: "12.", item: "Special Conditions", value: form.specialConditions.trim() });
  }

  // ── Inventory ────────────────────────────────────────────────────────
  const inventoryUploadFileNames = form.inventoryUploadFiles.map((f) => f.name);
  const inventoryGrouped = groupInventory(form.inventoryItems);

  // ── Annexures ────────────────────────────────────────────────────────
  // Annexure A: Tenant NRIC — only when individual AND at least one side uploaded.
  // There is no Annexure B. Stamp certificate is appended as final page(s), not an annexure.
  const annexures: { id: string; title: string; placeholder: string }[] = [];
  const hasTenantNric = form.tenantNricFront !== null || form.tenantNricBack !== null;
  if (form.tenantPartyType === "individual" && hasTenantNric) {
    annexures.push({
      id: "A",
      title: "Tenant's Identity Documents",
      placeholder: "[To be attached \u2014 Tenant's NRIC (front and back)]",
    });
  }

  return {
    agreementDateOrdinal: agreementDateOrdinal,
    landlordDescriptor,
    tenantDescriptor,
    propertyAddress: form.propertyAddress,
    preambleText,
    recitals,
    operativeClauses,
    tenantCovenantsClauseNum,
    tenantCovenants,
    landlordCovenantsClauseNum,
    landlordCovenants,
    provisosClauseNum,
    provisos,
    interpretationClauseNum,
    interpretation,
    schedule,
    inventoryMode: form.inventoryMode,
    inventoryUploadFileNames,
    inventoryGrouped,
    annexures,
    landlordName: form.landlordName.toUpperCase(),
    landlordIdLine: `${landlordIdLabel}: ${form.landlordIdNumber}`,
    tenantName: form.tenantName.toUpperCase(),
    tenantIdLine: `${tenantIdLabel}: ${form.tenantIdNumber}`,
  };
}
