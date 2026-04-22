# WeStamp — Nominal Fixed-Duty Registry Admission Rules

Decision-discipline document for the nominal fixed-duty registry at
`src/lib/nominal-duty-registry.ts`. This document controls which
document categories may be added to that registry, and therefore
which categories receive the shared "Nominal Duty Handling" operator
panel on `/upload/[id]`.

This is not legal advice, not a tax opinion, not public-facing copy,
and not a scope-expansion plan. It is an internal gate that prevents
the registry from becoming a dumping ground for every instrument
that "looks simple."

Paired with:

- `src/lib/nominal-duty-registry.ts` — the registry itself.
- `docs/pilot-operator-sop.md` §4A — the operator flow that applies
  once a category is in the registry.
- `docs/pilot-operator-checklist.md` — the in-flight operator
  checklist for nominal-duty categories.

If you are tempted to add a category to the registry, read this
document first and answer every rule below with a concrete yes/no.
If you cannot answer, the category does not get admitted.

---

## 1. What "nominal fixed-duty" means in this registry

For the purposes of the registry, a category is "nominal fixed-duty
candidate" only if **every** of the following is true:

- The category is, in the substantial majority of real-world
  instances, chargeable with a nominal / fixed stamp duty under the
  Stamp Act 1949 (typically RM10), rather than ad valorem duty.
- The duty treatment does not depend on the value recited inside
  the instrument.
- The duty treatment does not depend on whether the instrument was
  granted for consideration.
- The category is not a tenancy / lease — tenancies are handled via
  the separate sewa_pajakan advisory stack, not the nominal-duty
  registry.

"Commonly nominal-duty" is not enough. If the same category
frequently flips to ad valorem under common real-world variations,
it is out (see §5).

---

## 2. Admission criteria — ALL must be satisfied

A category may be admitted to the registry only if **all** of the
following rules hold. If even one rule cannot be answered with a
confident "yes," the category is not admitted.

### 2.1 Face-of-document identifiability

The category must be identifiable from the uploaded instrument
without legal gymnastics:

- The document title, standard headings, party labels, or standard
  boilerplate make the category obvious on a normal read of the
  first one or two pages.
- An operator without specialised legal training can confirm the
  category by reading the PDF — not by cross-referencing other
  documents, not by guessing intent, and not by reasoning about
  obscure clauses.

### 2.2 Concrete confirm / stop rule

The category must admit a short, concrete "confirm this / stop if
that" rule set, expressed as registry `operatorConfirmationBullets`
and `stopTriggers`:

- Each confirm bullet must be directly checkable against the PDF.
- Each stop trigger must be something the operator can notice
  without expert interpretation.
- No bullet may require the operator to reason about edge cases the
  pilot is not equipped to handle.

If the confirm/stop rules start sprawling, the category is too
complex for this registry in its current form.

### 2.3 Handleable through the assisted path

The category must be handleable end-to-end by an operator in
e-Duti Setem without WeStamp pretending to automate any part of
submission, payment, or certificate retrieval.

- No bespoke backend logic must be required to draft the portal
  form.
- No category-specific calculator must be required.
- No category-specific portal probe must be required.

### 2.4 Sewa/Pajakan independence

The category must not rely on any sewa_pajakan-specific evidence:

- No reuse of the Proven Hantar Gate Chain.
- No reuse of Bahagian C preflight panels.
- No reuse of the tenancy preparation resolver.

If a category's handling feels easier "because we already proved
sewa_pajakan Gate 2," that is a signal it is tenancy-adjacent and
does not belong here.

### 2.5 Pilot-consistent interpretation load

The category must not require bespoke interpretation so complex
that it breaks pilot consistency across jobs:

- No multi-factor legal tests (e.g. binding vs non-binding intent,
  secured vs unsecured status, consideration present vs absent
  depending on nuance).
- No dependency on document value fields that change duty class.
- No dependency on specialised domain knowledge (corporate law,
  securities, estate planning, etc.).

### 2.6 Clear user communication path

If the operator cannot confirm the category from the PDF, there
must be a clear, short, neutral user-contact path per SOP §7:

- The question to the user must be answerable without the user
  describing their own legal analysis.
- The question must not require the user to know internal WeStamp
  mechanics.
- The question must not commit WeStamp to a duty figure before the
  operator has confirmed it.

### 2.7 Non-misleading duty framing holds

The registry's standard "Likely nominal/fixed-duty document
(operator to confirm)" framing must remain honest for this
category. If adding the category would force us to caveat the
framing further (e.g. "except when X," "only when Y"), the category
is not a clean registry candidate.

---

## 3. Exclusion criteria — ANY one excludes

A category is excluded from the registry if **any** of the following
apply. These are not tie-breakers; any single match is a hard no.

### 3.1 Face-of-document ambiguity

The category cannot be reliably identified from the uploaded PDF
alone. Examples: documents whose duty class depends on whether they
are "binding" or "in principle," or which require reading clauses
buried deep in the instrument.

### 3.2 Duty class flips on common real-world variation

The category commonly flips between nominal/fixed and ad valorem
duty depending on facts a pilot operator cannot reliably confirm
(consideration presence, monetary value, secured vs unsecured,
domestic vs cross-border, etc.).

### 3.3 Bespoke legal interpretation required

The category needs legal interpretation beyond pilot operator
handling — corporate law, trusts, securities, restructuring,
insolvency, probate, strata-specific covenants, family law
instruments, etc.

### 3.4 Would mislead users without deeper document intelligence

Offering the category under the nominal-duty registry would imply
a duty treatment that does not actually hold for a meaningful
fraction of real user uploads, even after operator confirmation
bullets. In other words: the operator cannot "save" the case from
the PDF alone.

### 3.5 Better kept under "Other / Not Sure"

The category is too niche, too rare in the pilot, or too
high-consequence to be worth registry inclusion right now. It can
still be handled per `§3.2` of the SOP's "Other / Not Sure" row
(read the file, contact the user if needed, handle manually).

### 3.6 High downside on misclassification

Getting the category wrong would produce a significant duty
shortfall, penalty, rejection, or user-facing damage. Nominal duty
is low-stakes; ad valorem documents are not — and this registry is
designed around low-stakes nominal cases. Any category with serious
downside on misclassification is excluded by default.

### 3.7 Already covered under a different internal lane

If a category is properly the domain of the sewa_pajakan tenancy
lane (or any future evidence-backed lane), it does not belong in
this registry.

---

## 4. Operator certainty requirement

Before a category is admitted:

- The pilot operator team must be confident, in writing, that a
  reasonable operator can apply the proposed confirm / stop rules
  consistently across at least a small seed sample of real
  documents.
- "Probably fine" is not good enough. The expected operator
  decision for borderline cases must be explicit before admission.
- If the team cannot state "here is exactly what the operator
  should do when X," the category is not admitted.

This is deliberately higher friction than "is this a fixed-duty
instrument under the Stamp Act?" Legal-theoretical fit is
necessary but not sufficient.

---

## 5. Internal handling clarity requirement

Before a category is admitted, WeStamp's internal handling for
that category must be clear:

- The SOP (`docs/pilot-operator-sop.md` §4A.2) must be updated in
  the same change that adds the registry entry, to list the new
  category and its concrete confirm / stop rules.
- The operator checklist (`docs/pilot-operator-checklist.md`) must
  work for that category without special-casing.
- The shared "Nominal Duty Handling" panel on `/upload/[id]` must
  render correctly for the category using only the registry fields
  (no new UI branches allowed).
- The public upload flow must not need changes for the category to
  be accepted.

If any of the above requires new UI logic or a new backend branch,
the category is not a nominal-duty registry candidate; it is a
separate milestone.

---

## 6. What must NOT be assumed

Registry admission is **not**:

- A statement that WeStamp automates the category.
- A guaranteed duty amount.
- A claim that operator confirmation equals legal certainty.
- A promise to the user.
- A signal that the category is "easy." Many fixed-duty
  instruments are trivially simple in form but easy to misclassify
  in practice.

Admitting a category says only: *the pilot is willing to run the
assisted manual path for this category, bounded by explicit
confirm / stop rules, subject to operator confirmation, with no
automation.*

Never frame registry inclusion as more than that in public, to
users, or in operator handoffs.

---

## 7. Initial expansion proposal — recommendation only

The following is **a recommendation**. No category below is added
to the registry by this document. Admission requires a separate
approved milestone that edits `src/lib/nominal-duty-registry.ts`,
the SOP, and the checklist together, and that satisfies §2–§5
above.

### 7.1 Proposed next candidate — qualified

#### Statutory Declaration (Surat Akuan Berkanun)

- **Why a candidate:** On face, the document is titled
  "Statutory Declaration" or "Surat Akuan Berkanun" and carries
  the standard Commissioner for Oaths attestation block. The
  instrument does not recite a value that changes duty class, and
  is commonly chargeable with nominal duty under the Stamp Act.
- **Why admissible under §2:** Face-of-document identifiability is
  strong (2.1 pass). The confirm/stop rules are short and binary
  (2.2 pass). No backend or calculator needed (2.3 pass). Not
  tenancy (2.4 pass). No multi-factor legal test (2.5 pass).
  Operator-to-user communication path is direct (2.6 pass).
- **Gating before actual admission:** pilot operator team must
  agree on a specific confirm bullet set — at minimum "the
  document is titled as a Statutory Declaration / Surat Akuan
  Berkanun," "the Commissioner for Oaths attestation block is
  present and signed," and stop triggers for partially-executed
  or draft declarations.
- **Recommendation:** Consider for admission in a follow-up
  milestone, not this one.

### 7.2 Conditional candidate — only under a strict narrowing

#### General Power of Attorney granted WITHOUT consideration

- **Why a candidate in principle:** A general, non-consideration
  Power of Attorney is commonly treated as a nominal-duty
  instrument.
- **Why it fails §2 in its general form:** PoAs frequently flip
  between nominal and ad valorem duty depending on whether they
  are granted for consideration (Rule 3.2 match). That kind of
  flip is exactly what the exclusion criteria are designed to
  reject.
- **Conditional-admission path:** Only consider if the registry
  entry's confirm bullets explicitly require the operator to
  verify "this PoA is not granted for any valuable consideration"
  **and** there is a crisp stop rule for any consideration clause.
  Without that narrowing, this category is a clean §3.2 exclusion.
- **Recommendation:** Do not admit in its general form. Revisit
  only if the pilot operator team commits, in writing, to the
  strict non-consideration narrowing and its confirm/stop rules.

### 7.3 Not proposed for admission at this stage

Any other category not explicitly listed above is, for the
purposes of this milestone, **not proposed** for admission.
Expansion beyond §7.1 and §7.2 must begin with an updated
admission analysis against §2–§5, not with a pull request that
adds entries to the registry.

---

## 8. Recommended to stay out of the registry (for now)

The following categories should **not** be admitted, at least not
in their general form. Each entry lists the controlling exclusion
rule from §3. This list is not exhaustive — anything not
explicitly admitted is out by default.

| Category | Why out | Controlling rule |
|---|---|---|
| Loan / Facility Agreements | Duty is ad valorem on the principal sum. Nominal duty is not the norm. | §3.2, §3.6 |
| Sale and Purchase Agreements (real property, shares, businesses) | Ad valorem on consideration or market value; high downside on misclassification. | §3.2, §3.6 |
| Assignment / Surat Serah Hak | Can be ad valorem when for consideration; nominal only in narrow cases. | §3.2 |
| Service / Consultancy / Secondment / Internship Agreements | Duty treatment depends on consideration and clauses, not document title. Already explicitly excluded by the Employment Contract entry's confirm bullets. | §3.2, §3.7 |
| Deed of Mutual Covenant and strata-specific covenants | Require strata/property legal interpretation beyond pilot operator handling. | §3.3 |
| Trust Deeds / estate-planning instruments | Bespoke interpretation (trusts, probate, family-law facts). | §3.3 |
| Corporate restructuring documents (MOUs, shareholder agreements, share transfer forms) | Ad valorem possible; duty class depends on consideration, valuation, and counterparty facts. | §3.2, §3.3 |
| Security instruments (debentures, charges, guarantees) | Ad valorem on secured amount; high downside. | §3.2, §3.6 |
| Letters of Intent / Term Sheets / MOUs | Binding-vs-non-binding interpretation required; ambiguous on face. | §3.1, §3.3 |
| Any document whose duty class depends on a monetary value recited inside it | Mechanically ad valorem; nominal-duty framing would mislead. | §3.4 |
| Any category where the duty class depends on counterparty facts the operator cannot verify from the PDF | Face-of-document ambiguity. | §3.1, §3.2 |

For anything in this table, the correct handling is the SOP's
"Other / Not Sure" row in §3.2, not a registry entry.

---

## 9. Process to admit a new category

To admit a category, a separate milestone must:

1. Reference this admission-rules document by name.
2. For each §2 rule, record a specific "yes / evidence" answer.
3. For each §3 rule, record a specific "no / why not" answer.
4. Supply the concrete registry entry payload (category key,
   internal label, handling mode label, duty framing label,
   operator confirmation bullets, stop triggers).
5. Include the SOP §4A.2 and checklist updates in the same change.
6. Include a public-copy review confirming nothing new needs to be
   said publicly about the category.
7. Ship as a narrow, approved milestone. No "registry clean-up"
   or "add a batch of categories" milestones.

One category per milestone is the default. Batching requires an
explicit justification that each category independently passes
§2–§5.

---

## 10. Changelog

- 2026-04-22 — Initial admission-rules document. Paired with
  `src/lib/nominal-duty-registry.ts` at commit `8a07cf0`. Registry
  currently contains one entry (`employment_contract`). No
  categories added by this document.
