# Supabase Cutover Runbook

Operational guide for migrating WeStamp from local storage to Supabase and switching the active backend.

This is a manual, operator-driven process. There is no automated cutover.

---

## Prerequisites

- Access to the Supabase project dashboard
- The Supabase project URL and service-role key
- Operator passphrase for WeStamp (set via `OPERATOR_PASSPHRASE`)
- The app running and accessible (local dev or deployed)
- An active operator session (logged in via `/operator/login`)

---

## 1. Required Environment Variables

Set these in `.env.local` (never commit real values):

```
OPERATOR_PASSPHRASE=<your-passphrase>
STORAGE_BACKEND=local
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

`STORAGE_BACKEND` stays `local` during migration. It only changes to `supabase` after verification passes.

---

## 2. Supabase Table Setup

Create the `westamp_jobs` table in your Supabase project. Run this SQL in the Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS westamp_jobs (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

No additional indexes are required for this milestone.

---

## 3. Supabase Bucket Setup

Create a private Storage bucket named `westamp-files` in the Supabase dashboard:

1. Go to **Storage** in the Supabase dashboard
2. Click **New bucket**
3. Name: `westamp-files`
4. Public: **No** (private bucket)
5. Click **Create bucket**

No RLS policies are needed — the app uses the service-role key which bypasses RLS.

---

## 4. Storage Smoke Check

Verify that Supabase connectivity works before attempting migration.

**Log in as operator first**, then run:

```bash
curl -b cookies.txt http://localhost:3000/api/operator/storage-smoke
```

Expected response when `STORAGE_BACKEND=local` and Supabase env is set:

```json
{
  "backend": "local",
  "supabaseConfigured": true,
  "checks": {
    "jobStore": { "ok": true, "jobCount": 45 },
    "blobStore": null
  }
}
```

The smoke route checks the active backend only. In local mode it confirms local job store reads work. Supabase-specific smoke checks run only when `STORAGE_BACKEND=supabase`.

---

## 5. Migration — Dry Run

Run the migration in dry-run mode first. This reads local data and reports what would be migrated without writing anything.

```bash
curl -X POST -b cookies.txt http://localhost:3000/api/operator/migrate-to-supabase
```

No `?mode=live` means dry-run (the safe default).

Expected response:

```json
{
  "mode": "dry-run",
  "jobs": {
    "total": 45,
    "migrated": 0,
    "failed": 0,
    "errors": []
  },
  "blobs": {
    "total": 50,
    "exists": 48,
    "missing": 2,
    "migrated": 0,
    "failed": 0,
    "missingKeys": ["uploads/abc.pdf"],
    "errors": []
  }
}
```

Review the report. `missing` blobs are local files referenced by jobs but not found on disk. These cannot be migrated.

---

## 6. Migration — Live Mode

Once the dry-run report looks acceptable, run the live migration:

```bash
curl -X POST -b cookies.txt "http://localhost:3000/api/operator/migrate-to-supabase?mode=live"
```

This reads all local jobs and blobs, then writes them to Supabase with idempotent upserts. Safe to re-run.

Expected response:

```json
{
  "mode": "live",
  "jobs": {
    "total": 45,
    "migrated": 45,
    "failed": 0,
    "errors": []
  },
  "blobs": {
    "total": 50,
    "exists": 48,
    "missing": 2,
    "migrated": 48,
    "failed": 0,
    "missingKeys": ["uploads/abc.pdf"],
    "errors": []
  }
}
```

Check that `failed` is 0 for both jobs and blobs. If any failures, review the `errors` array.

---

## 7. Post-Migration Verification

After live migration, verify that Supabase contains all expected data:

```bash
curl -b cookies.txt http://localhost:3000/api/operator/verify-supabase-migration
```

Expected response for a successful migration:

```json
{
  "verdict": "match",
  "jobs": {
    "localCount": 45,
    "supabaseCount": 45,
    "missingInSupabaseCount": 0,
    "extraInSupabaseCount": 0,
    "missingInSupabaseSample": [],
    "missingInSupabaseSampleTruncated": false,
    "extraInSupabaseSample": [],
    "extraInSupabaseSampleTruncated": false
  },
  "blobs": {
    "totalReferenced": 50,
    "existInSupabase": 50,
    "missingInSupabaseCount": 0,
    "missingInSupabaseSample": [],
    "missingInSupabaseSampleTruncated": false
  }
}
```

**Proceed to cutover only if `verdict` is `"match"`.**

If `verdict` is `"mismatch"`, review the missing/extra counts and samples before deciding how to proceed.

---

## 8. Backend Switch (Cutover)

Once verification passes, switch the backend:

1. Set `STORAGE_BACKEND=supabase` in `.env.local`
2. Restart the app
3. Run the storage smoke check again to confirm Supabase is now active:

```bash
curl -b cookies.txt http://localhost:3000/api/operator/storage-smoke
```

Expected response after cutover:

```json
{
  "backend": "supabase",
  "supabaseConfigured": true,
  "checks": {
    "jobStore": { "ok": true, "jobCount": 45 },
    "blobStore": { "ok": true, "smokeKey": "smoke-tests/2026-04-14T12-00-00-000Z.txt" }
  }
}
```

Both `jobStore` and `blobStore` should report `ok: true`.

---

## 9. Rollback to Local Mode

If Supabase mode has problems after cutover:

1. Set `STORAGE_BACKEND=local` in `.env.local`
2. Restart the app

This immediately switches all reads and writes back to local storage. No data is deleted from either backend.

**Limitations of rollback:**
- Any jobs created or updated **after** cutover (while `STORAGE_BACKEND=supabase`) will exist only in Supabase, not in local storage.
- There is no reverse migration (Supabase-to-local). If you need data created post-cutover, it must be retrieved from Supabase manually.
- Local data from before cutover remains intact on disk.

---

## PDF Generation Runtime Prerequisite

Lane 1 (Generate Tenancy Agreement) uses Puppeteer to render PDFs. This requires a Chrome or Chromium executable available to the app at runtime.

- On macOS/Linux development machines, the app auto-detects Chrome in standard locations.
- On production servers, containers, or VPS deployments, Chrome may not be installed or may be in a non-standard path.
- Set `CHROME_EXECUTABLE_PATH` or `CHROME_PATH` in your environment to point to the executable if auto-detection fails.
- Example for a typical Linux server: `CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable`
- If Chrome is not available, the `/api/generate-pdf` endpoint will return a 500 error with a message listing the paths it searched.

This is a runtime system dependency, not an app configuration issue. Install Chrome/Chromium on the deployment target before using PDF generation.

**Print URL override (`APP_BASE_URL`):**

PDF generation works by Puppeteer visiting the app's own `/generate/print` page. By default, the URL is derived from the incoming request's `x-forwarded-proto` and `host` headers. This works on Vercel and standard nginx setups.

If request headers are unreliable in your deployment (e.g. internal container networking, non-standard reverse proxy), set `APP_BASE_URL` to the app's reachable base URL:

```
APP_BASE_URL=https://app.example.com
```

This is optional. If unset, the app falls back to request headers. If set to a malformed value, PDF generation will fail with a clear error.

---

## Known Limitations

- **No automatic cutover.** Every step is manual and operator-driven.
- **No field-level diff.** Verification checks job ID coverage and blob existence only. It does not compare every field of every job payload.
- **No blob content comparison.** Verification checks whether blob keys exist in Supabase, not whether the file contents match byte-for-byte.
- **No reverse migration.** There is no built-in Supabase-to-local migration route.
- **No zero-downtime switch.** Changing `STORAGE_BACKEND` requires an app restart. Requests during restart will fail.
- **No dual-write.** After cutover, all new data goes only to Supabase. Local storage is not kept in sync.
- **Missing local blobs cannot be migrated.** If a local file referenced by a job does not exist on disk, it will not appear in Supabase after migration.
- **Smoke blob cleanup.** Each smoke check in Supabase mode writes a small disposable blob to `smoke-tests/`. These are not automatically deleted.
