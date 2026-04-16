# Persistent PDF Render Token Store — Verification Report

## Files Changed

| File | Reason |
|---|---|
| `src/lib/token-store.ts` | Replaced in-memory `Map` with blob-storage-backed persistence using discriminated result type |
| `src/app/api/generate-pdf/route.ts` | Added `await` to `storeData()` and `removeToken()` calls; updated header comment |
| `src/app/generate/print/page.tsx` | Changed `getData()` to `await`, switched from null-check to discriminated result with two distinct failure paths; updated header comment |

## How the Persisted Token Store Works

`storeData(data)` generates a `crypto.randomUUID()` token, wraps the payload in a JSON envelope with `createdAt` and `expiresAt` timestamps, serializes it to a `Buffer`, and writes it via `blobStore.saveBlob("print-tokens/<token>.json", buffer)`. The blob store resolves to local filesystem or Supabase Storage depending on `STORAGE_BACKEND`.

`getData(token)` reads the blob via `blobStore.readBlob("print-tokens/<token>.json")`, parses the JSON envelope, validates its shape, checks `expiresAt` against `Date.now()`, and returns one of four discriminated statuses.

`removeToken(token)` overwrites the blob with a new envelope whose `expiresAt` is `"1970-01-01T00:00:00.000Z"`, making any subsequent `getData()` return `{ status: "expired" }`.

## Where Token Payloads Are Stored

`print-tokens/<uuid>.json` — under the blob store's root. In local mode: `<project-root>/print-tokens/<uuid>.json`. In Supabase mode: `westamp-files` bucket at key `print-tokens/<uuid>.json`.

## How Expiry Is Represented and Enforced

Each envelope contains `expiresAt` as an ISO 8601 string. Default TTL is 120 seconds. On read, `getData()` parses `expiresAt` to a timestamp and compares with `Date.now()`. If current time exceeds `expiresAt`, returns `{ status: "expired" }`. If `expiresAt` is unparseable, returns `{ status: "corrupt" }`.

## How `removeToken()` Invalidates the Token

Overwrites the blob at `print-tokens/<token>.json` with `{ data: null, createdAt: <now>, expiresAt: "1970-01-01T00:00:00.000Z" }`. This is an epoch-zero timestamp that is always in the past. `blobStore.saveBlob()` naturally overwrites in local mode and uses upsert in Supabase mode. No delete operation needed.

## How the Print/PDF Route Resolves the Token

`src/app/generate/print/page.tsx` calls `await getData(token)` which reads from blob storage. The print page is a Next.js server component, so `await` works at the top level. The result is checked: `"valid"` renders the agreement; `"corrupt"` shows storage-corruption error; anything else (`"not_found"` or `"expired"`) shows token-expired error.

## Actual Verification Results

| Test | Method | Result |
|---|---|---|
| **storeData + persisted file check** | `tsx` script called `storeData()`, then inspected `print-tokens/<token>.json` on disk | File created at expected path. Envelope contains `data`, `createdAt`, `expiresAt`. Data round-trips correctly (`rent: 1500`, `tenant: "Test User"`). |
| **getData resolves from persisted storage** | `tsx` script called `getData()` in same process | Returns `{ status: "valid" }` with correct data payload. |
| **Cross-process token resolution** | Token stored by standalone `tsx` process (PID different from dev server). Hit `http://localhost:3000/generate/print?token=<token>` via curl against dev server. | Dev server resolved the token from blob storage and rendered `PrintAgreement` with data `"Cross Process Test"` and `"Verification"` visible in HTML output. Proves persistence, not same-process memory. |
| **removeToken invalidation** | `tsx` script: `storeData()` then `getData()` returns `valid` then `removeToken()` then `getData()` returns `expired`. Also hit dev server print route with removed token. | `getData()` returns `{ status: "expired" }` after `removeToken()`. Dev server renders "Token expired or invalid." Blob on disk shows `expiresAt: "1970-01-01T00:00:00.000Z"`, `data: null`. |
| **Expired token (short TTL)** | `tsx` script stored token with 1ms TTL, waited 50ms, called `getData()`. Also stored 1ms-TTL token and hit dev server print route. | Returns `{ status: "expired" }`. Dev server renders "Token expired or invalid." |
| **Not-found token** | `tsx` script called `getData("nonexistent-token-uuid-1234")`. Also hit dev server with `?token=completely-nonexistent-uuid-token`. | Returns `{ status: "not_found" }`. Dev server renders "Token expired or invalid." |
| **Corrupt blob (invalid JSON)** | Manually wrote `THIS IS NOT JSON {{{` to `print-tokens/corrupt-verification-test.json`. Hit dev server print route. | Dev server renders "Render data could not be read. Please try generating the PDF again." — distinct from expired message. |
| **Malformed envelope (valid JSON, wrong shape)** | Manually wrote `{"foo": "bar", "notAnEnvelope": true}` to blob. Hit dev server print route. | Dev server renders "Render data could not be read. Please try generating the PDF again." — correctly detected missing required fields. |
| **Missing token parameter** | Hit `/generate/print` with no `?token=`. | Dev server renders "Missing token." |
| **Regression: TypeScript** | `npx tsc --noEmit` | Zero errors. |

## Exact Observed Messages by Condition

| Condition | Rendered Message |
|---|---|
| Valid token (within TTL) | `PrintAgreement` component renders with form data (agreement content visible) |
| Expired token (TTL elapsed or post-`removeToken`) | Token expired or invalid. |
| Not-found token (no blob exists) | Token expired or invalid. |
| Corrupt blob (unparseable JSON) | Render data could not be read. Please try generating the PDF again. |
| Malformed envelope (parseable JSON, wrong shape) | Render data could not be read. Please try generating the PDF again. |
| Missing token parameter | Missing token. |

## Bugs Discovered During Verification

None. No code changes were required during the verification pass.

## Confirmations

- No background cleanup worker was added.
- No agreement-generation/template files were substantively changed.
- No agreement form fields, clause logic, annexure content, or print styling were modified.

## Intentionally Deferred

- Expired token blob cleanup — expired blobs accumulate in storage. No cleanup worker added per milestone scope.
- Supabase upsert verification — `blobStore.saveBlob()` in Supabase mode should be verified during cutover testing.
