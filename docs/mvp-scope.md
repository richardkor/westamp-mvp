# WeStamp — MVP Scope Definition

This document is the locked reference for what is in and out of scope for the WeStamp MVP.
Before building any new feature, check it against this document.

Last updated: 2026-03-21

---

## Product Summary

WeStamp is a web platform for Malaysian residential tenancy agreement generation and document stamping facilitation.

Users can:
1. Generate a standard residential tenancy agreement from a form
2. Upload an existing document for stamping (Milestone 3)
3. Sign documents electronically with audit trail
4. Pay per transaction
5. Receive a final PDF with the LHDN stamp certificate appended

WeStamp's admin team handles the actual stamping manually via MyTax / e-Duti Setem.

---

## What Is In Scope

### A. Residential Tenancy Agreement Generator
- Malaysia residential tenancy only
- Fixed-term leases only
- No premium or fine
- Simple fields: landlord name, tenant name, IC/passport, property address, rent amount, deposit, lease start date, lease end date
- Generates a draft PDF
- Template requires one-off Malaysian property lawyer review before public launch

### B. Upload Existing Document for Stamping (Milestone 3)
- Supports only: residential tenancy agreements that fit the scope above
- If ambiguous, unsupported, or unusual: flagged for manual review
- No employment contracts in MVP

### C. Stamp Duty Calculation
- Implements the statutory lease duty table from Stamp Act 1949, First Schedule, Item 32(a)
- See "Duty Engine Rules" section below
- Unsupported structures are sent to manual review

### D. Electronic Signature (Milestone 2)
- MVP audit trail: signer name, verified email, timestamp, IP, device info, SHA-256 document hash
- Separate witness attestation record if witness is used
- No claim of legal equivalence to wet-ink signatures
- OTP verification recommended as a later enhancement
- Requires lawyer validation before launch

### E. Payment (Milestone 2)
- Per-transaction payment via Billplz (FPX support)
- No subscription model
- No wallet / credit top-up

### F. Admin Workflow
- Admin views all submitted agreements
- Admin updates status (received, stamping in progress, stamped, delivered)
- Admin uploads stamp certificate from e-Duti Setem
- System appends certificate to original PDF (Milestone 3)
- All admin actions are audit-logged

---

## What Is NOT In Scope

| Excluded | Reason |
|---|---|
| iOS / Android app | Web MVP first |
| LHDN / MyTax / e-Duti Setem automation | Manual stamping for MVP |
| Wallet / credit top-up | Per-transaction is simpler |
| Commercial tenancy | Different rules and risk |
| Employment contracts | Removed from MVP entirely |
| Consultancy / service / non-tenancy contracts | Out of scope |
| Broad multi-document tax engine | Only residential lease duty |
| Multi-user / team accounts | One user per account |
| Email reminders / renewal tracking | Post-MVP |
| Separate backend service | Single Next.js app |
| Branding exploration | "WeStamp" is the working name |

---

## Duty Engine Rules

### Statutory Lease Duty Table (Stamp Act 1949, First Schedule, Item 32(a))

Applies only to residential tenancy agreements without premium or fine.

| Condition | Duty |
|---|---|
| Annual rent <= RM2,400 | Exempt (RM0) |
| Lease term not exceeding 1 year | For every RM250 or part thereof of annual rent in excess of RM2,400: RM1 |
| Lease term exceeding 1 year but not exceeding 3 years | For every RM250 or part thereof of annual rent in excess of RM2,400: RM2 |
| Lease term exceeding 3 years | For every RM250 or part thereof of annual rent in excess of RM2,400: RM4 |

"For every RM250 or part thereof" means ceiling division: if excess is RM300, that is 2 units (RM250 + partial RM50 counts as a full unit).

These rates must be verified against the current e-Duti Setem portal before launch.

---

## Manual Review Triggers

The system flags a case for manual review if ANY of the following are true:

- Premium or fine payments exist
- Rent is variable, percentage-based, or has escalation clauses
- Property is not clearly residential (mixed-use, shophouse, SOHO, serviced apartment on commercial title)
- Lease term is indefinite, rolling, periodic, or has break clauses
- Charges are bundled (maintenance, furnishing, service charges not clearly separated from rent)
- Rent-free period exists
- Multiple landlords or tenants with non-equal splits
- Subletting or assignment clauses that complicate the relationship
- Any field is missing or inconsistent
- Uploaded document is not clearly a residential tenancy agreement (Milestone 3)

**Default rule: if in doubt, send to manual review.**

---

## Operational Assumptions

### Stamping Facilitation
- WeStamp operates through a registered Malaysian business entity
- Customers provide explicit authorization for WeStamp to submit on their behalf
- WeStamp does not claim to be an approved LHDN partner unless formally approved
- Legal review required before launch to confirm this model needs no licence or registration

### Operational Target
- Stamping is submitted via MyTax / e-Duti Setem (LHDN's current online portal)
- Legacy STAMPS system references are background context only

---

## Legal/Compliance Workstream (Required Before Launch)

| Deliverable | Language | Status |
|---|---|---|
| Privacy Notice | English + Bahasa Malaysia | Not started |
| Terms of Use | English (BM recommended) | Not started |
| Data retention and deletion policy | Internal | Not started |
| Access control policy | Internal | Not started |
| Incident / breach response note | Internal | Not started |
| Agreement template lawyer review | N/A | Not started |
| E-signature legal validation | N/A | Not started |
| Stamping facilitator compliance check | N/A | Not started |
