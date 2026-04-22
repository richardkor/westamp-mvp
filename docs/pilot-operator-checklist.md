# WeStamp — Pilot Operator Checklist

Quick in-flight reference while handling a single pilot job. Pair with
the full SOP at `docs/pilot-operator-sop.md`.

Run top to bottom. If any item is unchecked, stop or contact the user
before continuing.

---

## Per-job checklist

### Open the job
- [ ] Opened `/upload/[id]` for the correct Intake Reference.
- [ ] Amber "Internal advisory view — no live portal actions" banner
      is visible. (If missing, stop — deploy issue.)

### Document sanity
- [ ] Category matches document (Tenancy Agreement ↔ actual tenancy
      PDF; nominal-duty registry category ↔ actual matching PDF).
      If mismatched: contact user.
- [ ] PDF opens, is legible, not redacted, not upside-down.
- [ ] Document appears signed / complete enough to stamp.

### Nominal-duty category (registry-driven, if applicable)
Applies to any category present in
`src/lib/nominal-duty-registry.ts`. Current registry: Employment
Contract. These jobs do not use the sewa_pajakan advisory stack.

- [ ] "Nominal Duty Handling" panel is visible on `/upload/[id]`
      with the category shown in the heading. (If missing for a
      registered category: stop — deploy or registry issue.)
- [ ] The shown category is present in the nominal-duty registry.
      (If a category is not in the registry, do not invent
      handling — follow §3.2's "Other / Not Sure" row. Admission
      of new categories is gated by
      `docs/nominal-duty-admission-rules.md`, not by in-flight
      operator decisions.)
- [ ] PDF really is the registered category (for Employment
      Contract: an employer–employee employment contract, not a
      service, secondment, internship, or consultancy agreement).
- [ ] PDF is signed and complete (signatures, dates, parties).
- [ ] Nothing about the document suggests it should be
      reclassified (for example, it is actually a tenancy).
- [ ] Duty profile reads "Likely nominal/fixed-duty document
      (operator to confirm)" — treat this as tentative, not a
      quotable duty.
- [ ] Each "Operator must confirm" bullet on the panel has been
      personally verified against the PDF.
- [ ] None of the panel's "Stop and contact user if" triggers apply.
- [ ] Sewa/Pajakan advisory panels (Proven Hantar Gate Chain, lane
      readiness, Bahagian C preflight) are ignored for this job.
- [ ] Proceed only via manual handling in e-Duti Setem per SOP §4A.

### Tenancy preparation values (tenancy jobs only)
- [ ] `instrumentDate` resolved from confirmed or extraction source
      — not `none`.
- [ ] `monthlyRent` resolved from stamping_details or confirmed —
      **not** from `extraction_suggestion`. (If it is, report it.)
- [ ] `leaseMonths` resolved from stamping_details or confirmed —
      **not** from `extraction_suggestion`.
- [ ] Duty breakdown present and consistent with rent + lease months.

### Readiness (tenancy jobs only)
- [ ] "Portal Submission Readiness" badge is "Ready (with caveats)".
      (If "Blocked" or "Assessment Limited": stop.)
- [ ] "Proven Submit Blockers" — every row reads Satisfied.
- [ ] "Proven Hantar Gate Chain" shows Gate 1 and Gate 2 as Proven.
- [ ] "Current Blocking Step" is read and understood — currently
      Bahagian C → `pds_alamat_1` (Alamat Harta).
- [ ] "Still Unresolved Later Gates" is read as **open**, not
      proven-safe.
- [ ] "Untested Areas" is read — do not treat as resolved.

*(Nominal-duty registry jobs skip this section entirely — the
sewa_pajakan readiness and gate-chain signals do not apply.)*

### Decide
- [ ] Any stop condition from SOP §6 matched? If yes: do not proceed.
- [ ] Any missing value from the user? If yes: contact user per SOP
      §7 and stop.

### User contact (only if needed)
- [ ] Message is short, specific, no backend mechanics.
- [ ] No claim that submission, payment, or certificate retrieval
      has already happened.
- [ ] No timeline promise beyond the public "around 2 hours"
      guidance.

### Manual portal work (outside WeStamp)
- [ ] Portal work is performed directly in e-Duti Setem, using
      WeStamp advisory state as input only.
- [ ] Payment, submission, and certificate retrieval are done
      manually and recorded against the WeStamp job as the hosted
      flow permits.

### Close-out
- [ ] The WeStamp job reflects actual state — do not mark anything
      "done" that has not actually been done in the portal.
- [ ] Public receipt page status matches reality.

---

## Stop triggers — do not proceed past these

- Missing or implausible tenancy preparation value (tenancy jobs).
- Readiness = "Blocked" or "Assessment Limited" (tenancy jobs).
- Any panel output you do not understand.
- Document sanity check failed.
- Category shown does not match the document contents (for example,
  a nominal-duty registry category selected but the PDF is a
  tenancy, or vice versa).
- Nominal-duty registry job where the PDF is unsigned, redacted,
  illegible, or clearly a mixed/different instrument.
- Category appears to need nominal-duty handling but is not in
  `src/lib/nominal-duty-registry.ts` — do not invent handling.
- Any UI state that disagrees with this checklist or the SOP.

When a stop trigger hits: contact the user if user-fixable, otherwise
escalate internally. Do not guess.

---

## Hard invariants — never communicate to a user

- "Submitted to LHDN" unless you personally submitted.
- "Paid" unless you personally paid.
- "Certificate retrieved" unless you hold the certificate PDF.
- "Guaranteed in N hours" — no guaranteed turnaround.
- Any description of internal advisory panels as already-done actions.
- For nominal-duty registry categories (including Employment
  Contract): "Duty of RMX confirmed" or "Calculated by WeStamp"
  unless the operator has personally confirmed the duty against
  the live portal and the document.
