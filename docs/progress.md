# WeStamp — Progress Checklist

This is the running checklist for the WeStamp MVP build.
Updated after each step is completed.

Last updated: 2026-03-21

---

## Pre-Development

- [x] Restate MVP in plain English
- [x] Define what is NOT in scope
- [x] Propose folder structure
- [x] Propose milestones
- [x] Propose tech stack
- [x] Define local setup steps
- [x] Document legal/tax assumptions
- [x] Revise assumptions per founder feedback (e-sign, PDPA, facilitator, template, duty engine)
- [x] Create docs/mvp-scope.md
- [x] Create docs/progress.md (this file)
- [x] Create docs/setup.md
- [x] Create docs/glossary.md
- [x] Create docs/troubleshooting.md
- [ ] Founder approves documentation
- [ ] Local environment setup (Node.js, PostgreSQL, Git, VS Code)
- [ ] Scaffold Next.js project

---

## Milestone 1 — Core Flow

- [ ] User sign-up and login (NextAuth.js, email + password)
- [ ] Dashboard page
- [ ] Tenancy agreement form (landlord, tenant, property, rent, deposit, term)
- [ ] Stamp duty calculator (statutory lease table, Item 32(a))
- [ ] Manual review flag logic
- [ ] PDF generation of draft tenancy agreement
- [ ] Draft template disclaimer/watermark
- [ ] Admin view: list all submitted agreements
- [ ] Admin audit logs (action, admin ID, timestamp)
- [ ] File-access logs (view/download events)
- [ ] Database schema (users, agreements, audit_logs, file_access_logs)
- [ ] End-to-end test: sign up -> form -> calculate duty -> download PDF -> admin sees it

---

## Milestone 2 — E-Sign + Payment

- [ ] E-signature workflow with audit trail
- [ ] Signature data capture (name, email, timestamp, IP, device, document hash)
- [ ] Witness attestation (separate record)
- [ ] Signature certificate page appended to PDF
- [ ] Billplz payment integration (FPX)
- [ ] Admin status updates (received, stamping in progress, stamped, delivered)
- [ ] Email delivery of final document
- [ ] End-to-end test: generate -> sign -> pay -> admin stamps -> user receives PDF

---

## Milestone 3 — Upload Existing Documents

- [ ] Document upload flow (PDF)
- [ ] Supported vs. manual-review classification logic
- [ ] Upload enters normal duty + stamping flow if supported
- [ ] Unsupported/ambiguous -> manual review queue
- [ ] Certificate append flow (admin uploads cert, system appends to PDF)
- [ ] End-to-end test: upload -> classify -> pay -> stamp -> deliver

---

## Legal/Compliance Workstream (Pre-Launch)

- [ ] Privacy Notice (English + Bahasa Malaysia)
- [ ] Terms of Use
- [ ] Data retention and deletion policy
- [ ] Access control policy
- [ ] Incident / breach response note
- [ ] Agreement template lawyer review
- [ ] E-signature legal validation
- [ ] Stamping facilitator compliance check
