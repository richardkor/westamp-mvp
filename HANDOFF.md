# WeStamp — Session Handoff

_Last updated: 2026-04-21_

## How to use this file
New Claude: read this file and `CLAUDE.md` (at project root, auto-loaded). Then wait for the user's next milestone instruction. Do **not** start any new work without explicit approval — strict milestone control is in force.

---

## Control rules (standing)
- **Milestone-gated.** Never start a new milestone without an explicit instruction.
- Never touch live e-Duti Setem submission, browser/session automation, payment integration, or certificate retrieval.
- Never touch agreement generation / template files (`src/app/generate/**`, `src/lib/agreement-template.ts`, `src/lib/tenancy-types.ts`) unless the user names those files.
- Never run destructive git ops or push without explicit instruction.
- Obey `CLAUDE.md`: re-read changed files before finishing; run `npx tsc --noEmit`; state files changed + issues found at end.

---

## Current status
**Last milestone completed:** `Tenancy Extraction Review + Confirmed Preparation Inputs` — **done & verified, not committed.**

**Uncommitted working tree** (as of handoff):
```
modified:   src/app/upload/[id]/page.tsx
modified:   src/lib/stamping-types.ts
modified:   src/lib/stsds-portal-draft.ts
new file:   src/app/api/intake/[id]/confirm-tenancy/route.ts
modified:   src/lib/tenancy-extraction.ts     (from prior milestone, also uncommitted)
```
Untracked noise (ignore / not for commit): `pilot-cookies.txt`, `tsconfig.tsbuildinfo`.

The user tried to run `git add . && git commit && git push origin main` once but canceled. Commit has **not** happened. Do not commit unless the user asks again.

---

## Milestone 1 (prior) — Tenancy PDF extraction fix
**Problem:** hosted tenancy job returned `textLengthChars: 0, fieldsExtracted: 0` for a WeStamp-generated PDF.

**Root cause:** `pdf-parse@1.1.1/index.js` has a module-level debug block (`if (!module.parent) { Fs.readFileSync('./test/data/05-versions-space.pdf') }`) that fires when `module.parent` is falsy (Next.js server-bundled / serverless). Throws `ENOENT` → caught by outer `try/catch` in `extractTenancyDetails` → silent empty result.

**Fix:** `src/lib/tenancy-extraction.ts` now does `require("pdf-parse/lib/pdf-parse.js")` (bypasses the debug block). Also added two date regex patterns for Schedule-form `Date of Agreement` and cover-form `Xth day of Month Year`.

**Verification (real PDF):** textLen `0 → 23255`, fields `0 → 3`, rent/lease/date all populated.

---

## Milestone 2 (just completed) — Tenancy extraction review + confirmed inputs
**Goal:** persist operator-confirmed tenancy values separately from raw extraction, with UI to confirm/override, and a downstream precedence rule.

### Types added (`src/lib/stamping-types.ts`)
```ts
type TenancyReviewStatus = "not_reviewed" | "reviewed_confirmed" | "reviewed_overridden";
type ConfirmedTenancyInputSource = "extraction_confirmed" | "operator_override" | "operator_entered";
interface ConfirmedTenancyInputs {
  confirmedAt: string;
  reviewStatus: "reviewed_confirmed" | "reviewed_overridden";
  confirmedMonthlyRent: number | null;
  confirmedLeaseMonths: number | null;
  confirmedAgreementDate: string | null;  // YYYY-MM-DD
  confirmedBySource: {
    monthlyRent: ConfirmedTenancyInputSource | null;
    leaseMonths: ConfirmedTenancyInputSource | null;
    agreementDate: ConfirmedTenancyInputSource | null;
  };
}
// New JobEventType: "tenancy_inputs_confirmed"
// New StampingJob field: confirmedTenancyInputs?: ConfirmedTenancyInputs
```

### New route (`src/app/api/intake/[id]/confirm-tenancy/route.ts`)
- `POST` operator-only (protected by existing `/api/intake/:path*` middleware).
- Tenancy-only (400 for other categories).
- Validates each field (bounds + strict `YYYY-MM-DD` calendar check).
- Rejects empty payload (400).
- Derives per-field `confirmedBySource` by comparing submitted value vs current `extractionResult` suggestion.
- Derives `reviewStatus`: `reviewed_confirmed` iff every submitted value matches its suggestion; else `reviewed_overridden`.
- Appends `tenancy_inputs_confirmed` event with a compact note.
- Uses `updateJobOrConflict` (409-aware).

### Precedence rule (`src/lib/stsds-portal-draft.ts` — `buildSewaPajakanDraft` only)
- `instrumentDate`: `confirmedTenancyInputs.confirmedAgreementDate` → `extractionResult.suggestedAgreementDate.value` → unset.
- `monthlyRent` / `leaseMonths`: `stampingDetails.*` → `confirmedTenancyInputs.*` → unset. Raw extraction suggestions are **never** written directly into the draft for these two fields.
- `penyeteman_am` lane has no rent/months/date fields — no change there.

### UI (`src/app/upload/[id]/page.tsx`)
- Existing extraction panel heading changed to `Extracted tenancy details`.
- Approved two-line note rendered (unverified / please confirm).
- New review state: `reviewOpen`, `reviewRentStr`, `reviewMonthsStr`, `reviewDateStr`, `reviewSaving`, `reviewError`.
- New "Review & confirm / override" button opens an inline form prefilled from suggestions.
- On save → POSTs to `/api/intake/[id]/confirm-tenancy`, refreshes `job` from response.
- Post-review summary panel shows `Reviewed — confirmed/overridden` + per-field source, with `Edit confirmed values` to re-enter the form.
- Existing "Apply Suggested Values" flow (which prefills the Stamping Details form) was preserved.

### Verification performed (dev server, real generated PDF)
- Extraction: `textLen=23255, fields=3, rent=2500, months=12, date=2026-04-20`.
- Confirm unchanged → `reviewed_confirmed`, all sources `extraction_confirmed`, event logged.
- Override rent+months → `reviewed_overridden`, sources `operator_override`/`operator_override`/`extraction_confirmed`.
- Rejections: non-tenancy → 400, empty → 400, bad date → 400, unauthenticated → 401.
- Precedence unit-verified with three cases (extraction-only, confirmed-overrides-extraction, stampingDetails+confirmed).

---

## Known tech notes / gotchas
- Dev server picks port **3001** (3000 is taken on this machine). Operator passphrase in `.env.local`: `OPERATOR_PASSPHRASE=westamp-dev-ops`.
- To generate a fresh tenancy PDF for verification: POST sample `TenancyFormData` to `/api/generate-pdf`. A working sample payload lives at `/tmp/formdata.json` from the last session (may be gone after reboot — regenerate if needed).
- `/upload/[id]/page.tsx` is 7700+ lines. Always grep first; avoid large rewrites.
- The client `StampingJob` type in that page is **hand-mirrored** from `src/lib/stamping-types.ts`. When you add a new server-side type, also add it to the client interface or the UI will silently ignore it.
- `pdf-parse` must always be required as `pdf-parse/lib/pdf-parse.js` — never `pdf-parse` at the package root.
- Lease-extraction regex has a pre-existing precedence quirk: when both a main-term (`Term 24 months`, concatenated in PDF text) and a renewal clause (`period of 12 months`) are present, it finds the renewal first. Known, out of scope; flagged as "pre-existing" in Milestone 1 report.

## Intentionally deferred (do not start without approval)
- Consuming `confirmedTenancyInputs` in readiness / dry-run / browser-instructions / mock-execution / automation-plan / assertion-evaluation layers (only the sewa-pajakan portal draft was updated this pass).
- Auto-advancing status `uploaded → intake_reviewed` on confirmation.
- Any live portal, browser automation, payment, certificate, OCR expansion, saved parties, dashboards, multi-org work.
- Committing the above changes to git / pushing to `main`.

## Suggested first turn for the new Claude
> "Run `git status` and `npx tsc --noEmit` to confirm the working tree matches HANDOFF.md. Do not make changes. Wait for my next instruction."
