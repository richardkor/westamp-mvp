# Multi-Pass Instruction-Graph Compiler — Scope (2026-04-29)

> Scoping document for the future supervised execution layer that
> turns a `ready_for_supervised_run` tenancy job into a phased portal
> interaction plan.
>
> **Status:** design-only. **Not** an authorization to execute, **not**
> an implementation, **not** a payment / certificate / OCR / user-
> review milestone. Every clause below describes what the future
> compiler should do; nothing in this document grants it permission
> to do anything.

## 1. Purpose and Boundary

### Purpose

The post-A1–A4 + ε-4a/b/c stack now produces a meaningful
`ready_for_supervised_run` verdict for the fixed-rent residential
tenancy happy path. This document defines how WeStamp should move
from that verdict to a **planned, approval-gated, supervised** portal
execution. It scopes:

- The phased instruction graph (Phase 0 → Phase 8).
- The save-and-reinspect checkpoints between phases.
- The per-step data shape the future compiler will emit.
- The operator approval gates that punctuate the plan.
- The safe-diagnostics and fail-closed policies that bound execution.

### Boundary (what this document IS NOT)

- It does **not** authorize live submission to e-Duti Setem.
- It does **not** implement the compiler — `tenancy-browser-instructions.ts`
  remains untouched until a separate implementation milestone (call it
  Milestone B-impl) is scoped, briefed, and approved.
- It does **not** authorize portal mutation, payment, certificate
  retrieval, OCR / AI extraction, or any User Review / Confirmation
  Page.
- It does **not** expand WeStamp's supported path beyond fixed-rent
  residential tenancy. Variable rent (1104), amendment (1105), multi-
  period rent, Penyeteman Am, and unsupported building/furnishing/
  property types remain explicitly out of scope.
- It does **not** modify agreement-generation, agreement-template,
  clause-numbering, Annexure A, lawyer-CTA, or browser-print logic.

When this document is accepted, the next reasonable step is to
**review whether to proceed to Milestone B-impl** — and that review
itself will be a separate, briefed pass.

## 2. Why a Single-Pass Compiler Is Insufficient

The current `tenancy-browser-instructions.ts` (Milestone B from the
A1 followup list) is a single-pass instruction list that assumes the
portal DOM is fully populated once `pds_jenis` is selected on the
Sewa/Pajakan p5 form. The 2026-04-28 ε-3 supervised field-mapping run
(`docs/2026-04-28-tenancy-portal-field-mapping.md`) directly refuted
that assumption. The relevant evidence:

1. **Identical visible-field count for `pds_jenis ∈ {1103, 1104, 1105}`.**
   Snaps of Bahagian B with each of the three pds_jenis values produced
   the same 15-of-69 visible fields. Selecting `pds_jenis = 1104`
   (variable rent) revealed no per-period rent table client-side.
   Selecting `pds_jenis = 1105` (amendment) did NOT reveal `par_id`.
   See field-mapping report §4.1.

2. **`par_id` reveal trigger is server-side, not change-handler-side.**
   With `pds_jenis = 1105` selected on the Bahagian B tab, `par_id`
   remained `[hidden]` in the DOM. Reveal happens only after a server
   round-trip via Simpan Bahagian B. See field-mapping report §5.

3. **Lampiran upload widget is not in the static DOM.** It loads only
   after Bahagian B/C Simpan succeeds (server-side draft creation).
   See field-mapping report §5.

4. **Rumusan duty-calc fields are `readonly+hidden` until computed.**
   `d_sc`, `d_ab`, `dt_kena`, etc. only become visible after the
   server has run the duty calculation post-save. See field-mapping
   report §5.

5. **Modal data is committed locally on Tambah-modal Simpan**, but
   the parent form's commit happens on a separate page-level Simpan.
   Tab switches discard uncommitted modal data. See field-mapping
   report §5.

The compiler must therefore be **multi-pass**: build instructions in
phases, save server state at each phase boundary, then **re-inspect
the DOM** before generating the next phase's instructions. Field-set
discoveries from re-inspection feed forward into subsequent phases.
This is not a refactor of the single-pass compiler; it is a new
shape.

## 3. Supported Path for the First Implementation

The first implementation (B-impl) targets one path only:

- Lane: **Sewa/Pajakan** (`pds_suratcara = 1101`, "Perjanjian Sewa").
- Description type: **`fixed_rent_during_tenancy`** (`pds_jenis = 1103`).
- Rent shape: **single rent period** (`rentSchedule.length === 1`).
- Property type: **Kediaman** (`pds_harta_type = 1107`).
- Building type: one of the five mapped Kediaman values
  (`rumah_teres / rumah_berkembar / rumah_kluster / townhouse /
  kondominium`) — see `tenancy-portal-canonical-maps.ts` post-ε-4a.
- Furnishing: `fully_furnished` or `unfurnished` — see canonical maps
  post-ε-4a.
- State / country: any post-ε-4c-mapped state / Malaysia.
- Party shape: at least one landlord + one tenant. Individual or
  company. Each individual party fully captured per Milestone A4
  (citizenship 3-way + gender + NRIC sub-type when NRIC). Each
  `company_ssm` party fully captured (ROC at-least-one + business
  type + locality + representative identity).

### Excluded by design (Milestone B-impl will reject these)

- `pds_jenis = 1104` (variable rent) — multi-pass, but the per-period
  rent table is not yet captured. Defer until a future milestone
  pairs the multi-pass compiler with a `pds_jenis = 1104` evidence
  capture.
- `pds_jenis = 1105` (amendment) — `par_id` capture not modelled and
  the reveal trigger is server-side.
- `rentSchedule.length > 1` — no per-period table modelled even on
  fixed-rent.
- WeStamp building types `apartment` / `studio` / `lain_lain` /
  `rumah_banglo` on Kediaman — semantic gaps (see canonical-maps).
- WeStamp `partially_furnished` — no portal equivalent.
- Property type `perdagangan` / `perindustrian` — no WeStamp building
  enum maps cleanly.
- Penyeteman Am lane.
- Payment.
- Certificate retrieval.
- OCR / AI extraction.
- User Review / Confirmation Page.

The run-readiness gate (`tenancy-portal-run-readiness.ts`) already
blocks all these — the compiler should treat the gate as the
authority and refuse to compile a graph for a `blocked` job.

## 4. Proposed Phase Graph

The graph runs sequentially Phase 0 → Phase 8. Each phase produces a
list of typed instruction steps (see §6) bounded by save / reinspect
checkpoints (see §5). Phases 1+ may have an explicit operator gate
preceding them (see §7).

### Phase 0 — Preflight (no portal contact)

Performed entirely offline. Verifies the readiness gate, confirms the
source PDF is reachable, confirms operator identity / firm selection
configuration is complete, and confirms no unsupported blockers
remain. Required outputs:

- `verdict === "ready_for_supervised_run"` from the live
  `evaluateTenancyPortalRunReadiness(job)` call.
- `payload.lampiran.readyToUpload === true` (`storagePath` non-empty).
- Operator firm/branch target supplied (consumed later by the
  anchor-matcher in Phase 1).
- No Category A/B/B2/C/D blockers.

**Exit:** explicit operator approval to proceed to Phase 1. No portal
mutation occurs in Phase 0.

### Phase 1 — Session / portal positioning (read-only on the portal)

WeStamp connects to the operator's MyTax / e-Duti Setem session via
the existing supervised-CDP path. Within the session:

1. Confirm the operator is on `/stamps/main/role_change` (the portal
   path the safe firm-anchor matcher targets — see commit `cfdeebc`
   and `src/lib/stsds-firm-anchor-matcher.ts`).
2. Collect role-change anchors using the matcher's existing
   collection contract (`<select>` not used here — the role-change
   entry uses anchor-href navigation).
3. Match against the configured target firm (and optional branch) by
   normalized exact equality. **Index-based selection is not
   permitted.** Zero/no-match/multiple-match all fail closed.
4. Click the unique matched anchor. Verify post-click URL classifies
   as `dashboard` via `classifyPathKind` (also from the firm-anchor
   matcher module).
5. Position the operator on the Sewa/Pajakan p5 entry / draft
   creation step. **No draft is created yet** — that is Phase 2.

**Save checkpoint:** none (this phase is portal-side navigation, not
a portal save).

**Exit:** explicit operator approval to begin Phase 2 (draft creation
is a portal mutation).

### Phase 2 — Draft creation / Maklumat Am save checkpoint

Populates the Maklumat Am tab and triggers the draft-creation server
round-trip. Steps:

1. Fill `pds_suratcara` ← `1101` (Perjanjian Sewa). [select_option]
2. Fill `pds_jenis` ← `1103` (fixed_rent_during_tenancy).
   [select_option]
3. Fill `pds_dutisetem` ← captured `dutyStampType.code` from
   `maklumatAm`. [select_option]
4. Fill `pds_ps` ← captured `instrumentRelationship` portal code (`p`
   or `s`). [select_option]
5. Fill `pds_salinan` ← `String(duplicateCopies)` (the post-ε-4c
   captured 0..20 ladder). [select_option]
6. Fill `pds_date_suratcara` ← `instrument.instrumentDate` (YYYY-MM-DD).
   [fill_field]
7. (Optional, evidence permitting) Fill `pds_remit`, `pds_perjanjian`
   flags. Defer to a future evidence pass if not mapped.
8. Click `Simpan Maklumat Am`. [click_button — `mutation_level:
   server_save`]
9. **Wait for server round-trip.** Expected outcome: portal allocates
   a 13-digit draft ID visible in the edit URL (per ε-3 / passive HAR
   research). Non-`/stamps/formv2/p5/edit` paths after this step fail
   closed.
10. **Re-inspect DOM** for newly-revealed conditional fields.
   Specifically Bahagian B/C field counts may shift; the upload
   widget is NOT yet expected here (that's Phase 6).

**Note on draft creation:** this is **portal draft creation only,
not LHDN submission**. The 13-digit ID identifies a saved draft on
the portal's side; nothing is submitted. (Per ε-4 lane-knowledge
notes already in the repo.)

### Phase 3 — Bahagian A · party modal pass

Adds each party through the correct Tambah modal — Individu /
Syarikat (SSM) / Syarikat (Bukan SSM) — based on `party.type`. For
each party:

1. Click the matching Tambah button. [click_button — `mutation_level:
   read_only` (modal-open is non-portal-mutating)]
2. Fill the modal's party-identity fields including the A4 portal
   fields (`USER_SEX`, `warga`, `EPD_NOKP_TYPE` when NRIC, `tb_roc` /
   `tb_roc_new` for SSM, `jenis_perniagaan` for SSM, `tb_syarikat` for
   SSM, `owner_name` + full natural-person identity for SSM rep).
3. Click the modal's local Simpan. [click_button — `mutation_level:
   local_row_commit`] This commits the row to the local table; it
   does NOT round-trip to the server (per ε-3 §5).
4. After all parties are committed, **verify_row_count** equals
   `parties.length` against the page-level party table.
5. Click page-level Simpan Bahagian A (if present in the lane's flow)
   to round-trip to the server. [click_button — `mutation_level:
   server_save`]
6. **Wait for server round-trip + reinspect.**

**Fail closed** if the local table count does not match expected
party count, or if any modal Simpan throws a portal validation error.

### Phase 4 — Bahagian B · rent / instrument pass

Populates the fixed-rent Bahagian B fields. **Hard-rejects** at
compile-time if `pds_jenis !== 1103` or `rentSchedule.length !== 1`
(both already gated by the readiness layer; this is a defense-in-
depth check at compile-time).

1. Fill `pds_balasan` ← operator-supplied Maklumat Am `balasan`
   value (only meaningful for paths the readiness gate flagged
   `requiredForCurrentJenis`; for fixed-rent path the operator
   supplies it explicitly — never auto-derived from `rentSchedule`,
   per the post-A2-review evidence patch).
2. Fill any rent-period fields exposed by the post-Phase 2 server
   reinspection. (Field set is unconfirmed for the fixed-rent path —
   `pds_balasan` may be the only one.)
3. Click Simpan Bahagian B. [click_button — `mutation_level:
   server_save`]
4. **Wait for server round-trip + reinspect** for any conditional
   fields the server reveals post-Bahagian-B-save.

### Phase 5 — Bahagian C · property / land-registry pass

Populates the address, property, category, furnishing, and
land-registry fields using the post-ε-4c canonical mappings.

1. Fill `pds_alamat_1`, `pds_alamat_2` (optional), `pds_alamat_3`
   (optional), `pds_poskod`, `pds_city` from `property.*`.
   [fill_field]
2. Fill `pds_harta_state` ← canonical-mapper portal code (1..16).
   [select_option]
3. Fill `pds_harta_country` ← canonical-mapper portal code
   (`146` for Malaysia). [select_option]
4. Fill `pds_harta_type` ← `1107` (Kediaman). [select_option]
5. Fill `pds_floor`, `pds_mp`, the per-property-type
   `pds_harta_cat` (`#harta_cat_kediaman` for Kediaman), `pds_lot`,
   `pds_mukim`, `pds_daerah`, `pds_luas`, `pds_luasunit` (1..4) from
   `landRegistry`.
6. Fill `pds_harta_perabot` ← canonical-mapper portal code
   (`1122`/`1123`). [select_option]
7. (Optional) Fill `pds_kegunaan`.
8. Click Simpan Bahagian C. [click_button — `mutation_level:
   server_save`]
9. **Wait for server round-trip + reinspect.**

### Phase 6 — Lampiran · upload pass

Only enters this phase **after** Phase 5 completes — per ε-3 evidence
the Lampiran upload widget loads conditionally on saved Bahagian B/C
state.

1. Reinspect for the upload widget (`<input type="file">` on the
   Lampiran tab). Fail closed if not present after a bounded wait.
2. **Operator gate** before upload (mutation): require explicit
   approval to upload the source PDF.
3. Upload the source PDF via Playwright `setInputFiles`.
   [click_button → file upload — `mutation_level: upload`]
4. Verify the upload row appears (verify_row_count or attachment
   indicator). Fail closed if not.

### Phase 7 — Rumusan Pengiraan readback

After Phases 2–6, the portal computes duty server-side. Phase 7 is a
**readback only** — no fields are filled here.

1. Reinspect Rumusan readonly fields once they unhide (`d_sc`,
   `d_ab`, `dt_kena`, `dt_remit`, `pnlt`, `slnn`, `jslnn`, `jmlh`).
2. Compare portal-computed duty to WeStamp's
   `stampingDetails.calculatedDuty.totalDuty` (already exposed in
   the payload's Rumusan block).
3. **Mismatch is an operator-review blocker, not an auto-fix.** The
   compiler emits a `verify_computed_value` step and the operator
   decides — never the compiler.

### Phase 8 — Perakuan / final Hantar gates

Per ε-3 §5 the Perakuan section exposes a two-stage submission flow:

1. **Operator gate** before declaration: require explicit approval to
   tick the `pds_akuan` declaration checkbox.
2. Tick `pds_akuan`. [click_button — `mutation_level: declaration`]
3. **Operator gate** before pre-Hantar: require explicit approval to
   click `pre_hantar`.
4. Click `#pre_hantar`. [click_button — `mutation_level:
   declaration`] This opens the portal confirmation modal.
5. **Operator gate** before final Hantar: require explicit approval
   to click the modal's confirm button + the now-revealed
   `#pdsL01_button_hantar`.
6. Click confirm modal's accept button.
7. Click `#pdsL01_button_hantar`. [click_button — `mutation_level:
   final_submit`] **Irreversible.**

**Important:** the first implementation milestone (B-impl) MAY
choose to stop at step 3 (post-operator-gate, pre-`pre_hantar`-click)
and require a separate, dedicated final-submission milestone before
ever clicking `pre_hantar`. That separation is recommended for the
first build of the supervised execution layer.

## 5. Save / Reinspect Checkpoints

Each `mutation_level: server_save` step in §4 is a **save
checkpoint**. Per checkpoint, the future compiler must specify:

| Property | Description |
|---|---|
| What is changed | Portal-side server state (e.g. draft creation, Bahagian A row commit, Bahagian B numerics, Bahagian C address+land-registry, Lampiran attachment). |
| Expected URL/state after save | URL classification (e.g. still-on-`/stamps/formv2/p5/edit/<id>`), absence of bootbox modal error, absence of `:invalid` markers on saved fields. |
| What must be re-read | The post-save DOM is re-inspected for: (a) newly-visible conditional fields; (b) newly-rendered widgets (Lampiran upload, Rumusan readonly); (c) updated `:invalid` set; (d) updated party row count. |
| Fail-closed conditions | A bootbox modal with an error message; URL change to an unexpected path; `:invalid` count fails to decrease as expected; widget that should have appeared is still missing after a bounded wait. |
| Safe diagnostics to log | Phase name, step kind, expected/actual `:invalid` count delta, expected/actual row count, redacted draft id. **Never** the raw URL, raw href, query string, hash, cookies, tokens, `lhdnmsstoken`, IC, TIN, or firm IDs. |

The same shape applies to the local-row-commit and upload steps.

## 6. Instruction-Graph Data Shape (design only — no implementation)

Describes the proposed shape of the future compiler's emitted graph.
**This is design only. No TypeScript code is written.**

### Graph-level fields

- `graphId` — stable identifier for this compiled plan; not a portal
  ID.
- `supportedLane` — currently always `"sewa_pajakan"`.
- `jobId` — WeStamp's internal job id (not the portal draft id).
- `compiledAt` — ISO 8601 timestamp.
- `pathKind` — currently always `"fixed_rent_residential_kediaman"`.
- `phases` — ordered array of phase objects.
- `compileResult` — `"compiled"` | `"refused"` (refused when the
  job's verdict is not `ready_for_supervised_run`).
- `refusalReason` — non-null when `compileResult === "refused"`;
  human-readable + safe.

### Phase-level fields

- `phaseId` — stable identifier for the phase (`"phase_0_preflight"`
  through `"phase_8_perakuan"`).
- `requiresOperatorGateBefore` — boolean (when true, no step in this
  phase may execute until the operator approves).
- `mutationSummary` — the highest mutation level any step in this
  phase reaches (see step-level `mutationLevel` below).
- `steps` — ordered array of step objects.
- `saveCheckpoint` — optional object describing the post-phase save
  expectation (per §5).

### Step-level fields

- `stepId` — stable per-graph identifier.
- `stepKind` — one of:
  - `fill_field` — type into an `<input>` or `<textarea>`.
  - `select_option` — set a `<select>` value via the captured portal
    `<option value>` code (never by visible label, never by index).
  - `click_button` — click a button / anchor by stable selector.
  - `wait_for_server` — bounded-time wait for a navigation or DOM
    change after a save.
  - `reinspect_dom` — re-read DOM and refresh the working set used
    by subsequent steps in this phase.
  - `verify_row_count` — assert a given table has an expected
    integer row count; fail closed if not.
  - `verify_computed_value` — read a server-computed value (e.g. duty)
    and compare against the WeStamp expected; emit an
    `operator_gate` if mismatched.
  - `operator_gate` — block until the operator explicitly approves
    proceeding past this step.
  - `fail_closed` — emit a terminal stop with a safe reason string
    (not a stack trace, not a portal URL).
- `selector` — stable selector key. Prefer `name`/`id`-based
  selectors that exist in the portal's static DOM; fall back to
  `data-*` attributes the harness stamps at collection time (see the
  firm-anchor matcher's `data-westamp-firm-cand` pattern). Never
  store raw `href` / portal IDs as selectors.
- `expectedValue` — for `fill_field` and `select_option`: the
  resolved value (canonical-mapper output for enum fields,
  operator-supplied scalar for text fields). For `verify_*`: the
  expected post-condition.
- `mutationLevel` — one of:
  - `read_only` — no portal-side state change (DOM read,
    waitForSelector, verify_row_count, reinspect_dom).
  - `local_row_commit` — modal-internal Simpan that commits a row to
    a local table (per ε-3 §5).
  - `server_save` — page-level Simpan that round-trips to the server
    (Maklumat Am, Bahagian A, Bahagian B, Bahagian C).
  - `upload` — Lampiran file upload.
  - `declaration` — Perakuan declaration tick or `pre_hantar`.
  - `final_submit` — `pdsL01_button_hantar`. **Irreversible.**
- `safeDiagnostics` — keys/values the step is allowed to log
  (per §8).
- `rollbackNotes` — free-text describing whether the step is
  rollbackable, and if so what the rollback action is (most server
  saves are not — the portal's server keeps the saved state until
  the operator deletes the draft via the portal UI).
- `impossibilityNotes` — free-text describing what conditions would
  make this step impossible (e.g. "this step assumes Phase 5 already
  completed and the Lampiran upload widget is in the DOM"; if the
  precondition fails, the compiler should refuse to emit this step
  rather than emitting a `fail_closed` runtime check).

## 7. Operator Gates

Mandatory operator gates the compiler MUST emit:

1. **Before first portal mutation / draft creation** — before Phase 2
   begins. The operator approves the very first server save.
2. **Before Lampiran upload** — Phase 6 step 3.
3. **Before Perakuan declaration** — Phase 8 step 1, before ticking
   `pds_akuan`.
4. **Before `pre_hantar`** — Phase 8 step 3.
5. **Before final Hantar** — Phase 8 step 5, before clicking
   `pdsL01_button_hantar`.
6. **Before any future payment action** — out of scope for B-impl;
   when payment is added in a future milestone, a payment-gate must
   precede every payment-mutation step. Recorded here so the
   compiler's `mutationLevel` enum can grow to `payment` later
   without needing to re-architect operator gating.

Recommended additional gates the compiler MAY emit (operator
preference toggle):

- Before Bahagian A Simpan, Bahagian B Simpan, Bahagian C Simpan if
  the operator wants per-section approval rather than one approval
  before Phase 2.
- Before any `verify_computed_value` mismatch resolution, when the
  server-computed duty does not match WeStamp's expected duty.

## 8. Safe Diagnostics

Allowed diagnostics in compiled-graph metadata, runtime logs, and
markers:

- `phaseId` and `stepId` (stable identifiers, no portal data).
- `stepKind` (fixed enum).
- `mutationLevel` (fixed enum).
- `selector` key — only stable name / id / `data-westamp-*`
  attributes. Never raw `href`, never portal numeric IDs, never
  hashes.
- Expected vs. actual non-sensitive status: row counts, `:invalid`
  set sizes, mapped option statuses, boolean truthy of "did the
  expected widget appear after Simpan."
- `current_path_kind` from `classifyPathKind()` — `role_change` /
  `dashboard` / `other` only. Never the URL itself.
- Redacted draft id where strictly necessary for cross-phase
  correlation: prefix-truncated to a small prefix (e.g. first 4
  digits) or hashed via a stable non-reversible hash. Even this is
  optional — the graph runs single-job by `jobId`, so the portal
  draft id is rarely needed in logs.

Forbidden diagnostics:

- Cookies (any).
- Tokens / SSO values (any).
- `lhdnmsstoken` (any handling — not just logging).
- IC numbers, TINs, firm IDs (any).
- Raw `href` values (any — the portal's role-change href encodes
  several numeric IDs).
- Sensitive portal URLs (full URL, query string, or hash).
- Raw uploaded document contents (path or filename of an
  operator-uploaded PDF is OK; bytes are not).
- HAR payloads or replayed HTTP request bodies.

## 9. Failure Policy

The compiler emits explicit `fail_closed` steps where portal state
diverges from expectation. Each failure category below maps to a
runtime fail-closed step the compiler MUST plan for.

| Failure category | Trigger | Fail-closed action |
|---|---|---|
| Missing selector | DOM does not contain a step's required selector after a bounded wait | Stop the run at this step. Surface a safe diagnostic: phase, stepId, expected selector key, observed `current_path_kind`. Never proceed to the next step. |
| Multiple matching selectors | A selector that should be unique resolves to multiple elements | Stop the run. Refuse to click any of them. Mirrors the firm-anchor matcher's `ambiguous_match` behaviour from `cfdeebc`. |
| Unexpected option list | A `<select>` exposes an option set inconsistent with the canonical-maps seed | Stop the run. Surface a safe diagnostic with the expected/actual option-count delta only — not the option labels themselves. Implies the seed table needs an evidence pass; do not auto-extend. |
| Row count mismatch | Bahagian A party-table row count does not match `parties.length` after the local Simpan(s) | Stop the run. The compiler MUST NOT auto-retry the modal flow. |
| Save error | Bahagian B/C/Maklumat Am Simpan opens a bootbox modal with `Gagal` | Stop the run. Capture only the modal-detected boolean and the phase/step; never the raw modal text (it can echo operator-supplied values). |
| Server validation error | Post-save `:invalid` count fails to decrease as expected | Stop the run. Surface the expected/actual delta only. Never enumerate which `:invalid` fields remain in logs (those names are non-sensitive but enumerating them at runtime risks correlating per-job state to operator). |
| Upload not confirmed | After Phase 6 file-upload, the upload row indicator does not appear within bounded time | Stop the run. Do not proceed to Phase 7. The portal-side draft is intact but unattached to a file; operator may resume manually or restart. |
| Computed duty mismatch | Phase 7 readback finds server duty ≠ WeStamp duty | Emit `operator_gate` rather than `fail_closed`. Operator decides: accept-with-note, abort, or correct. The compiler never silently uses server duty. |
| Declaration gate not approved | Operator declines the Phase 8 declaration gate | Stop cleanly without portal mutation. The draft remains saved but unsubmitted. |
| Final Hantar not approved | Operator declines the final Hantar gate | Stop cleanly. The draft is one click away from submission but uncommitted. |

Crucially, **all fail-closed actions stop the run; none are
auto-retry**. Auto-retry is reserved for a separate future
"resilience" milestone if and when it's needed; first build emits a
clean stop and lets the operator decide.

## 10. What Remains Deferred

These are explicitly **not** in this scope and require their own
scoping passes before any code is written:

- **Variable rent (`pds_jenis = 1104`)** — needs the per-period rent
  field set captured first.
- **Amendment (`pds_jenis = 1105`)** — needs `par_id` data model and
  capture flow.
- **Multi-period rent (`rentSchedule.length > 1`)** — same as
  variable rent.
- **Penyeteman Am lane** — separate readiness gate, separate field
  set, separate compiler.
- **Payment** — only after the supervised execution layer has been
  used end-to-end on a real (test) job and the portal-side payment
  surface is itself field-mapped.
- **Certificate retrieval** — only after payment.
- **Fully unattended execution** — there is no plan to remove the
  operator gates without a separate dedicated risk-review milestone.
- **User Review / Confirmation Page** — out of WeStamp's product
  scope until explicitly briefed.
- **OCR / AI extraction** — not part of any current milestone path.

## 11. Recommended Next Steps (post-acceptance of this scope)

If this document is accepted:

1. Convert the §6 data shape into a TypeScript interface in a new
   file (e.g. `src/lib/tenancy-instruction-graph-types.ts`). **No
   compiler logic yet** — only the type surface.
2. Convert the readiness gate's `evaluateTenancyPortalRunReadiness`
   into the source-of-truth "should we even compile a graph?" check
   — `compileResult: "refused"` when verdict is `blocked`.
3. Implement Phase 0 — purely offline; no portal contact. This is
   the smallest possible code milestone that exercises the data
   shape end-to-end.
4. Implement Phase 1 (read-only portal positioning, anchor-based
   firm matching). Already proven by the existing
   `stsds-firm-anchor-matcher.ts` module.
5. Stop. Review the Phase 0+1 build before authorizing Phase 2 (the
   first portal mutation).

Each of these steps is its own milestone with its own brief.
