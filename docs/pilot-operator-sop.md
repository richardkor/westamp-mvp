# WeStamp — Pilot Operator SOP

Operational playbook for running WeStamp during the controlled tenancy
pilot. This is an internal document for WeStamp operators only. It is
not legal advice, not a policy manual, and not public-facing.

Read alongside `docs/pilot-operator-checklist.md`. The checklist is the
in-flight reference; this document is the explanation.

Paired commit: `00e28a9`. If any advisory UI section names below do not
match what you see on `/upload/[id]`, **trust the page, not this
document**, and flag the drift.

---

## 1. Scope of this SOP

What operators actually do right now:

- Intake triage — decide if an uploaded job fits the pilot's automated
  tenancy path, needs user contact, or should be handled entirely out
  of band.
- Interpret the hosted `/upload/[id]` advisory stack for sewa_pajakan
  tenancy jobs.
- Decide when to pause and contact the user vs. proceed.
- Perform the actual portal work in LHDN e-Duti Setem **outside**
  WeStamp. WeStamp does not submit, pay, or retrieve certificates.

What this SOP deliberately does **not** cover:

- Legal interpretation of tenancy documents.
- Manual calculation of stamp duty beyond what the duty engine already
  computes.
- Any payment, banking, or certificate retrieval procedure.
- Non-tenancy lanes beyond a single-sentence handling rule.

---

## 2. Invariants — never tell a pilot user any of these

These are absolute. If you cannot say something truthfully, do not say
it.

- **Do not** tell a user their document has been submitted to LHDN
  unless you have personally completed the submission in e-Duti Setem.
- **Do not** tell a user payment has been made unless you have
  personally paid.
- **Do not** tell a user a certificate has been retrieved unless you
  hold the certificate PDF.
- **Do not** quote a guaranteed turnaround. The public copy says
  "most submissions are updated within around 2 hours" — that is
  guidance, not a promise.
- **Do not** describe any of the WeStamp internal advisory panels
  (Portal Draft, Automation Plan, Browser Instruction Set, Mock
  Execution, Gate Chain, etc.) as things that have "been done." They
  describe internal preparation state only.
- **Do not** claim the MVP supports non-tenancy categories
  automatically. It does not.

If a user asks a question that would require breaking any of the above
to answer, stop and escalate.

---

## 3. Intake triage

Triggered when a new job lands in the `/jobs` queue.

### 3.1 Open the job

1. Open `/jobs`, click the new intake.
2. Confirm the persistent amber "Internal advisory view — no live
   portal actions" banner is visible at the top of the job page. If
   it is missing, stop — something is wrong with the deploy.

### 3.2 Classify the category

Category is set by the uploader on `/upload`:

| Category shown | Handling |
|---|---|
| Tenancy Agreement | Proceed with the sewa_pajakan operator flow (§4). |
| Employment Contract | Out of scope for the pilot. Contact the user (§7) and explain WeStamp cannot process it right now. |
| Other / Not Sure | Read the file. If it is clearly a residential tenancy agreement, re-handle as Tenancy. Otherwise, contact the user and ask what they need. |

Do not re-route a non-tenancy job through the tenancy advisory stack
just because the operator advisory is available. The advisory stack
is sewa_pajakan-only.

### 3.3 Document sanity (all categories)

Before touching any advisory panel:

- Open the PDF.
- Confirm it looks signed (signatures, initials, dates present on the
  relevant pages).
- Confirm it is not redacted, partially scanned, upside-down, or a
  non-agreement document (e.g. a photo ID by mistake).
- Confirm the pages are legible — OCR/extraction errors tend to
  compound silently on bad scans.

If any of the above fails, contact the user (§7) before proceeding.

---

## 4. Sewa/Pajakan tenancy operator flow

For jobs where category = Tenancy Agreement. Follow in order. Do not
skip steps because a panel "looks fine."

### 4.1 Record summary

Confirm the top record card:
- Intake Reference — note it for any user contact.
- File, Format, Category — must match what the user uploaded.
- Status — used downstream; do not transition manually unless the
  page offers the transition button.

### 4.2 Extracted values (tenancy)

Section: the advisory extraction suggestions shown on the page.

- Extraction is a hint, not truth.
- Treat any extracted value as **suggested** until the user confirms
  it or an operator-verified override is entered.
- If extraction is empty or visibly wrong, that is expected on
  lower-quality scans. Do not force values in.

### 4.3 Confirmed tenancy preparation values

Section: "Resolved tenancy preparation values" / confirmed inputs.

- Three fields matter: `instrumentDate`, `monthlyRent`,
  `leaseMonths`.
- Source provenance per field is shown — `confirmed_input`,
  `stamping_details`, `extraction_suggestion`, or `none`.
- **Provenance hierarchy** (already enforced by
  `tenancy-preparation-resolver.ts`):
  - `instrumentDate`: confirmed → extraction → none.
  - `monthlyRent`: stamping_details → confirmed → none.
    Extraction is **never** used directly for rent.
  - `leaseMonths`: stamping_details → confirmed → none.
    Extraction is **never** used directly for lease months.
- If `monthlyRent` or `leaseMonths` shows source `extraction_suggestion`,
  that is a bug — report it; do not proceed.
- If any field resolves to `none`, the preparation is not complete.
  Stop and either confirm with the user or enter stamping details.

### 4.4 Preparation readiness

Section: "Portal Submission Readiness".

Status badges and their meaning:

| Badge | What it actually means |
|---|---|
| Ready (with caveats) | Internal preparation inputs WeStamp checks look complete. **It does not mean the portal will accept the submission.** Later gates may still block. |
| Blocked | At least one proven blocker is not satisfied. Do not proceed. |
| Assessment Limited | This lane's gates are not independently proven. Treat all readiness signal as absent. |

Always re-read the "Proven Submit Blockers" and "Still Unresolved
Later Gates" sections below the badge. The badge alone is not
enough.

### 4.5 Proven Hantar gate chain (sewa_pajakan)

Section: "Proven Hantar Gate Chain (Sewa/Pajakan)".

- Gate 1 proven: `pds_suratcara` — "Nama Surat Cara" (Maklumat Am).
- Gate 2 proven: `pds_alamat_1` — "Alamat Harta" on **Bahagian C**
  (not Bahagian B).
- This is the only part of the gate chain we have direct evidence
  for. Everything past gate 2 is unresolved.

### 4.6 Current blocking step

Section: "Current Blocking Step".

- As of the 2026-04-22 evidence: Bahagian C → `pds_alamat_1`
  (Alamat Harta). A fresh Hantar attempt with `pds_suratcara`
  resolved but the property address empty will reproduce the gate-2
  modal.
- Treat this as the next thing that would stop you on the live
  portal. Prepare inputs accordingly before attempting portal work.

### 4.7 Unresolved later gates

Section: "Still Unresolved Later Gates".

- 14 fields remain in the post-gate-2 `:invalid` set (mostly
  Bahagian C harta fields; `par_id` on Bahagian A; `pds_jenis` on
  Maklumat Am).
- Their Hantar gate order has **not** been enumerated. Do not assume
  a particular ordering. Do not tell a user which field will block
  next — we do not know.

### 4.8 Untested areas

Section: "Untested Areas".

Current items:

- Lampiran: 0 file inputs on default view; upload conditions unknown.
- Perakuan (`pds_akuan`): checkbox visible, not yet proven as a
  Hantar gate.
- Bahagian B save permissiveness with an empty Bahagian A: not
  tested.
- `pds_jenis` options are static; cascade from `pds_suratcara` not
  present.

These are **open questions**, not preparation blockers. Do not act on
them as if they are known facts. Do not run a new probe as part of a
pilot job — probes are their own milestone, handled separately.

---

## 5. Stamping details and duty calculator

Section: "Stamping Details" / "Stamp Duty Breakdown".

- If the user has provided rent + lease months, confirm the
  breakdown matches the public calculator output for the same inputs.
- If the duty breakdown is missing because details were not entered,
  do not guess — contact the user (§7).
- If the duty result shows `manual_review`, read the reason and
  treat it as a hard stop.

---

## 6. Decision: proceed, contact user, or stop

Use the following rules. They are in priority order — the first
matching rule wins.

1. **Document unreadable, unsigned, clearly wrong category, or
   extraction is nonsense beyond minor errors.**
   → Contact the user (§7). Do not proceed.

2. **Non-tenancy category (Employment Contract / Other / Not Sure)
   with a non-tenancy document.**
   → Contact the user. Explain this is outside current automated
   handling. Do not commit to a timeline.

3. **Readiness status = "Blocked" or "Assessment Limited".**
   → Do not proceed. If blockers are user-fixable (missing inputs),
   contact the user. Otherwise, stop and escalate internally.

4. **Any resolved preparation field shows source `none`.**
   → Contact the user for the missing value, or enter it from a
   verified source (e.g. stamping details already on file).

5. **Readiness = "Ready (with caveats)" AND preparation values all
   resolved AND document sanity checks passed.**
   → You may proceed to manual portal handling in e-Duti Setem,
   outside WeStamp. Use the WeStamp advisory state as input, not as
   a substitute for actually looking at the portal form.

6. **Anything else — unfamiliar state, unexplained panel output,
   stale data, unexpected statuses.**
   → Stop. Do not guess. Escalate internally before touching the
   portal.

---

## 7. When and how to contact the user

Contact the user when:

- You need a missing rent, lease-months, or instrument-date value.
- The uploaded document is ambiguous, unsigned, or not a tenancy
  agreement.
- The category selected does not match the document contents.
- Any detail needs confirmation before it can be used for stamping.

Do not contact the user to:

- Explain WeStamp's internal advisory panels.
- Walk them through portal gate evidence.
- Describe internal statuses or preparation steps.
- Promise timelines beyond the public "most submissions are updated
  within around 2 hours" guidance.

Keep user messages short, specific, and free of backend mechanics.

---

## 8. What "done" looks like for a pilot job

A pilot tenancy job is done when all of the following are true:

- The document has been manually submitted through e-Duti Setem by
  the operator.
- Payment has been completed in e-Duti Setem.
- The stamped certificate PDF has been retrieved.
- The certificate has been uploaded/attached to the WeStamp job per
  whatever the current hosted flow supports for that step.
- The public receipt page reflects a terminal state.

Until **all** of those are true, the job is not done. Do not mark it
as done in any external communication.

---

## 9. Changelog

- 2026-04-22 — Initial SOP. Reflects the post-sewa_pajakan gate-2
  evidence state (`00e28a9`). Update this file whenever a milestone
  changes operator-visible behavior.
