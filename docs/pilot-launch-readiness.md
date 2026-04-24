# WeStamp — Pilot Launch Readiness

Internal operational reference for the first controlled pilot. Not a
product requirements doc, not a marketing page, not legal guidance. Read
alongside `docs/pilot-operator-sop.md` and
`docs/pilot-operator-checklist.md`.

Purpose: capture what we have decided is in scope for the first pilot,
what we have decided is out of scope, and what the operator must do
during pilot runs. If any item here disagrees with the SOP or the
checklist, **trust the operator-facing docs** and flag the drift here.

---

## 1. Launch decision

**Ready for a controlled pilot, with stated restrictions.**

Rationale:
- The three currently-supported lanes (tenancy agreement, employment
  contract, statutory declaration) each have an operator-validated
  end-to-end path inside the hosted UI.
- Operator SOP and checklist exist, have been used to shape the
  operator flow over several milestones, and have been stress-tested
  via the runbook-simulation milestone.
- Public-facing copy on the receipt page has been reviewed and minimally
  tightened to avoid over-promising turnaround for non-automated lanes.
- Fulfilment controls (adjudication number → payment → certificate
  upload → mark delivered) are now reachable for all three lanes; the
  public receipt can advance from "Received" to "Completed" in
  every supported lane.

Restrictions are listed in §3 (scope) and §4 (exclusions). The pilot is
not a general-audience launch.

---

## 2. Pilot shape

**User types:**
- Pilot-invited users only. Individually briefed that this is a
  controlled rollout.
- Malaysian residents uploading signed documents they genuinely intend
  to stamp.
- No general public traffic, no paid advertising, no SEO push during
  the pilot.

**Volume assumptions:**
- Low double-digit jobs per day at peak, concentrated across the three
  supported lanes.
- No bulk uploads, no batch intake, no spike handling.
- Operator attention is the bottleneck, not infrastructure.

**Operator model:**
- One operator working jobs synchronously during working hours.
- Operator uses the hosted `/upload/[id]` page as the primary workspace
  and performs the actual e-Duti Setem work manually outside WeStamp.

---

## 3. Pilot scope (what IS in scope)

### In-scope lanes

| Lane | Category key | How it is handled |
|---|---|---|
| **Tenancy agreement** | `tenancy_agreement` | Evidence-backed sewa_pajakan operator flow. Internal advisory stack (Proven Hantar Gate Chain gates 1–2, preparation readiness, resolved tenancy preparation values, stamping details + duty breakdown). Portal work done manually by operator in e-Duti Setem. |
| **Employment contract** | `employment_contract` | Registry-driven assisted handling. Nominal-duty registry entry. Operator verifies per registry bullets, then handles manually in e-Duti Setem. Internal lifecycle state tracks operator progress. |
| **Statutory declaration** | `statutory_declaration` | Registry-driven assisted handling. Same model as employment contract; additional registry bullets cover the Commissioner for Oaths attestation block. |

### In-scope product surface
- Home page calculator (residential tenancy only).
- Tenancy agreement generator (existing flow, unchanged for pilot).
- Upload-for-stamping flow for the three in-scope categories.
- Public receipt page at `/receipt/[id]?token=...`.
- Operator page at `/upload/[id]` behind operator middleware.
- Certificate download on public receipt, once operator marks delivered.

---

## 4. Pilot exclusions (what is NOT in scope)

**Category-level exclusions:**
- **"Other / Not Sure"** uploads are not a supported pilot lane.
  The upload form still offers the option for future use, but during
  the pilot the operator must follow the out-of-scope handling
  procedure in §7 — contact user, explain controlled rollout, do not
  commit to a timeline or turnaround.
- Any document category not currently in `src/lib/nominal-duty-registry.ts`
  and not a residential tenancy agreement. Do not add a registry
  entry on the fly — admission is gated by
  `docs/nominal-duty-admission-rules.md` and requires its own milestone.

**Instrument-shape exclusions (any lane):**
- Commercial tenancy, sublease, novation, or assignment.
- Tenancy agreements with premiums, fines, escalation, rent-free periods,
  or indefinite/periodic terms (sent to manual review by duty engine —
  do not force-fit into the sewa_pajakan lane).
- Mixed instruments (e.g. an employment contract bundled with a separate
  agreement; a declaration block grafted onto a contract or deed).
- Unsigned, redacted, illegible, or partially-scanned uploads.

**Behavioural exclusions:**
- No live portal probing during pilot jobs. Portal probes are their
  own milestone and are not performed on pilot traffic.
- No automation claim on any non-tenancy lane. Operators do not tell
  users the portal work is automated.
- No duty amount quoted to users for any nominal-duty category until
  the operator has confirmed it against the live portal and the
  document itself.
- No payment, submission, or certificate retrieval claim until the
  operator has personally performed it. SOP §2 invariants apply in
  full and are non-negotiable for pilot.
- No batch automation, no queue, no dashboards, no analytics work
  during the pilot. Observation is informal (see §9).

**Out of scope, out of this document:**
- Multi-operator coordination, shift handover, SLA automation.
- Ticketing/comments/chat on jobs.
- Email or WhatsApp notifications from WeStamp to users on status
  change (pilot users get the receipt link; operator initiates any
  contact manually).

---

## 5. Lane-by-lane Day-1 readiness assessment

### 5.1 Tenancy agreement — **Day-1: YES**

- **Ready:** intake flow, category classification, extraction advisory,
  confirmed-input override, stamping details form, duty breakdown,
  resolved tenancy preparation values, portal readiness readout,
  Proven Hantar Gate Chain (gates 1–2), current blocking step, still
  unresolved later gates, untested areas, fulfilment controls,
  public receipt with category-appropriate turnaround bullet.
- **Still manual / operator-dependent:** the entire portal session —
  filling Bahagian A/B/C, Hantar, payment, certificate retrieval —
  is done outside WeStamp by the operator. WeStamp drives no portal
  actions.
- **Could still confuse users:** none identified at this time. Public
  receipt copy is conservative; no automation claim is made.
- **Could still confuse operators:** the sewa_pajakan advisory stack
  is dense. Operators must trust the page over any stale doc wording
  (SOP line 11). Post-gate-2 the gate-chain evidence is unknown, and
  the UI labels this correctly.

### 5.2 Employment contract — **Day-1: YES**

- **Ready:** intake flow accepts the category; operator page renders the
  shared nominal-duty handling panel with registry-sourced confirm
  bullets and stop triggers; operator internal lifecycle control
  (received → under_review → awaiting_user → external_portal_in_progress
  → completed / cannot_proceed) with operator notes and audit log;
  fulfilment controls reachable (post-simulation milestone); public
  receipt shows softened turnaround bullet for nominal-duty categories.
- **Still manual / operator-dependent:** all e-Duti Setem work. Duty
  framing is "Likely nominal/fixed-duty (operator to confirm)" — no
  calculator runs, no amount quoted to user.
- **Could still confuse users:** public receipt says "This document
  type is reviewed by our team" — calm and honest. No confusion
  expected.
- **Could still confuse operators:** minor registry/SOP drift risk if
  we ever edit one without the other. Mitigated by `isNominalDuty`
  rendering the registry content directly; the checklist also points
  the operator to the page for authoritative bullets.

### 5.3 Statutory declaration — **Day-1: YES**

- **Ready:** identical model to employment contract. Registry entry
  covers the Commissioner for Oaths attestation block explicitly.
  Same operator lifecycle controls, same fulfilment path.
- **Still manual / operator-dependent:** same as employment contract.
- **Could still confuse users:** none identified.
- **Could still confuse operators:** none material. Registry bullets
  are specific enough to distinguish a Statutory Declaration from an
  affidavit, witness statement, or declaration-block-on-something-else.

### 5.4 "Other / Not Sure" — **Day-1: NO**

- Out of scope for the controlled pilot per §4.
- Operator handling procedure in §7 applies.

---

## 6. Public promise vs internal reality

Reviewed as of this milestone. No public-facing wording change is
justified inside this review milestone; any gaps identified here are
**below** the launch-blocking threshold and are logged for follow-up.

| Surface | Public wording | Internal reality | Acceptable for pilot? |
|---|---|---|---|
| `/upload` "Before you upload" | "WeStamp will guide your submission and keep you updated along the way. Most submissions are updated within around 2 hours." | Tenancy typically ~2h; nominal-duty may take longer; "Other" is out of scope. | **Yes** — controlled-pilot users are briefed individually; the guidance is conservative and truthful for the pilot's in-scope traffic. |
| `/upload` per-category hint (non-tenancy) | "WeStamp will review your document type and guide the next step if anything needs to be confirmed." | Matches operator flow for employment contract and statutory declaration. For "Other", the operator contacts the user off-platform. | **Yes** — hedged, truthful, does not claim automation. |
| `/receipt/[id]` status label | `Received` / `Awaiting Payment` / `In Progress` / `Under Review` / `Completed` via `derivePublicStatus` | Driven by `status` + `fulfilmentState`, never by nominal-duty internal lifecycle. Advances cleanly for every supported lane now that fulfilment controls are exposed. | **Yes** |
| `/receipt/[id]` "What happens next" turnaround | Tenancy: "around 2 hours". Nominal-duty: softer "reviewed by our team" bullet. "Other": currently shows the 2-hour bullet. | Tenancy ~2h holds; nominal-duty softer bullet is honest; "Other" is excluded from the pilot, so the 2-hour bullet is never actually shown to an in-scope pilot user. | **Yes, given §7 out-of-scope handling.** Post-pilot, consider broadening the softer bullet to cover `other` too. |
| `/receipt/[id]` certificate download | Shown only when `certificateReady` and the operator has uploaded the cert file | Backed by real file attachment + fulfilment-integrity checks | **Yes** |

**Logged for follow-up (not launch-blocking):**
- Receipt turnaround bullet for `other` category shows the ~2-hour line.
  With `other` excluded from the pilot, no pilot user hits this path.
  Post-pilot: consider broadening the softer bullet trigger from
  `isNominalDutyCategory(category)` to "any non-tenancy category".
- SOP §6 rule 2 lists `Employment Contract / Other / Not Sure` together
  as non-tenancy categories. Employment Contract is now a supported
  lane; the rule wording is stale. Not a pilot blocker because §4A
  supersedes it, but worth a doc-cleanup pass after pilot feedback.

---

## 7. Out-of-scope job handling procedure

When an out-of-scope upload lands in the queue during the pilot:

1. Open the job and read the PDF.
2. Confirm it is genuinely out of scope (not a lane simply selected
   incorrectly). If it is actually a supported category selected as
   "Other / Not Sure", follow SOP §3.2 for reclassification instead.
3. If it is genuinely out of scope:
   - Do **not** proceed with any portal work.
   - Contact the user with a short, neutral message: explain we are in
     a controlled rollout, their document type is not yet supported,
     and no charge / no obligation. Offer to keep them on a list to be
     contacted when the lane is added.
   - Update the nominal-duty internal lifecycle (if the job has a
     registry entry) to `cannot_proceed` with an operator note
     explaining the scope decision, or — if the job is not in the
     registry — escalate internally and leave the job untouched
     beyond the user message.
   - Do **not** mark payment, submission, certificate, or delivered.
   - Do **not** quote a timeline.
4. Log the case in the post-pilot notes. Pattern of these cases
   informs future admission proposals under
   `docs/nominal-duty-admission-rules.md`.

---

## 8. Operator readiness

The operator-facing stack is sufficient for the controlled pilot.

- **Authoritative operator docs:** `docs/pilot-operator-sop.md` (full
  procedure) and `docs/pilot-operator-checklist.md` (in-flight). The
  amber "internal advisory view" banner on `/upload/[id]` links to both.
- **Tenancy advisory stack** on the operator page: evidence-backed for
  gates 1–2; everything past gate 2 is labelled as unresolved or
  untested. Operator does not need to memorise the gate chain — the
  page renders it.
- **Nominal-duty panel** on the operator page: registry-driven confirm
  bullets and stop triggers, operator lifecycle state, operator note,
  and a separation note pointing to the SOP §4A. Fulfilment controls
  reachable.
- **Source PDF access:** operator page's "View Uploaded PDF" link on
  the record card opens the signed source document, gated by the
  operator session cookie.
- **No redesign required for pilot.** Further operator-UI work is
  post-pilot concern.

---

## 9. Internal pilot launch checklist

Run through this before Day 1. Do not add items that aren't
operationally necessary; the goal is a short, executable list.

### Product scope gate
- [ ] Confirmed in-scope lanes: tenancy, employment contract,
      statutory declaration. (§3)
- [ ] Confirmed exclusions posted internally. (§4)
- [ ] "Other / Not Sure" handling procedure known to the operator. (§7)
- [ ] No new document categories added since this doc's last update
      without an admission-rules review.

### Operator prep
- [ ] Operator has read `docs/pilot-operator-sop.md` end-to-end.
- [ ] Operator has the `docs/pilot-operator-checklist.md` open or
      printed during each pilot job.
- [ ] Operator can access `/jobs` and `/upload/[id]` with a fresh
      operator session.
- [ ] Operator has an e-Duti Setem working session available
      (credentials, browser profile, current MyTax login) out-of-band
      from WeStamp.
- [ ] Operator knows the four SOP §2 invariants verbatim.

### Test jobs to keep on hand
- [ ] One known-good tenancy PDF (signed, standard rent + lease,
      no premiums, residential) for a happy-path tenancy run.
- [ ] One known-good employment contract PDF (clear employer–employee
      instrument, signed, dated) for a nominal-duty happy-path run.
- [ ] One known-good statutory declaration PDF with a valid
      Commissioner for Oaths attestation block.
- [ ] One deliberately out-of-scope PDF (e.g. a service agreement
      miscategorised as "Other / Not Sure") to rehearse §7.

### What to monitor during first pilot runs
- [ ] Each submitted job's public receipt after the operator advances
      fulfilment — verify the public status mirrors the real operator
      state at each transition (`Received → Awaiting Payment → In
      Progress → Completed`).
- [ ] Fulfilment-integrity warnings on the operator page. Any warning
      is treated as a stop trigger.
- [ ] Operator's time-to-first-touch per job. A quiet early signal
      that the operator is under-capacity.
- [ ] Mismatch signals: category selected by user vs what the PDF
      actually is. A steady stream of mismatches is useful signal for
      future admission proposals; a sudden spike suggests a broken
      upload funnel.
- [ ] Any `cannot_proceed` nominal-duty transition: read the operator
      note, confirm the user was contacted, confirm no downstream
      fulfilment action was taken.

### Out-of-scope job response
- [ ] If an out-of-scope job lands, apply §7 verbatim.
- [ ] Do not extend the pilot scope mid-run by handling an
      out-of-scope case "just this once."

### End-of-pilot wrap
- [ ] Aggregate per-lane counts (started, delivered, stopped, contacted).
- [ ] Note every SOP/checklist wording gap the operator hit.
- [ ] Note every piece of operator-page content that caused hesitation.
- [ ] Feed findings into the next doc-cleanup pass. No code-level
      changes should happen during the pilot run itself.

---

## 10. Changelog

- 2026-04-25 — Initial pilot launch readiness doc. Launch decision:
  ready for controlled pilot with stated restrictions. In-scope lanes:
  tenancy, employment contract, statutory declaration. Out-of-scope:
  "Other / Not Sure" and anything not currently in the nominal-duty
  registry or residential tenancy scope. No code changes in this
  milestone.
