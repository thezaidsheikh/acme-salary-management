# Deployment runbook (Phase 2)

Status: **configs ready, not yet deployed.** The live URLs below are
TBD — this file is the exact checklist to create them. Nothing here is
claimed as done until the smoke checks in step 5 pass on the live URLs.

Target (from `docs/ARCHITECTURE.md`): backend + Postgres on **Render**,
frontend on **Vercel**. All config for the backend side is in
`render.yaml` at the repo root (a Render Blueprint).

## 0. What you need first

- A Render account (free) and a Vercel account (free), both able to
  import from GitHub.
- This repo pushed to GitHub (`main` branch, branch `deploy/phase-2`
  merged). No secrets are committed anywhere — the only credentials
  are the ones Render/Vercel generate or you paste into their
  dashboards.

## 1. Backend + Postgres on Render (from `render.yaml`)

1. Render dashboard → **New → Blueprint** → connect the GitHub repo
   `thezaidsheikh/acme-salary-management` → pick `render.yaml`.
2. Render creates two resources:
   - **Web service `acme-salary-api`** (Node, free plan). Build:
     `cd backend && npm install --include=dev && npm run build`
     (`--include=dev` is deliberate: `tsc` for the build and `tsx`
     for migrate/seed are devDependencies, and a production install
     would skip them). Start: `cd backend && node dist/src/index.js`.
   - **Postgres `acme-salary-db`** (free plan). `DATABASE_URL` is
     wired from it automatically — never paste a database URL by hand.
3. Before the new code starts, Render runs the **preDeployCommand**
   `cd backend && npm run migrate` — it creates the tables/indexes
   from `backend/migrations/001_init.sql`. Safe to re-run on every
   deploy.
4. Wait for the deploy to go green, then open the backend URL Render
   shows (TBD, looks like `https://acme-salary-api.onrender.com`)
   and check `GET /api/health` returns `{"data":{"status":"ok"}}`.

Free-plan limits to know about:
- The web service **sleeps after ~15 minutes without traffic** — the
  first load after that can take up to ~1 minute while it wakes up.
  That is normal on the free plan, not a bug. (For the video demo,
  open the backend URL once a minute before recording so it is warm.)
- The free Postgres **expires after 90 days**. For an assessment demo
  that is fine; if the database ever disappears, re-create it from
  the blueprint and re-run the seed (step 2).

## 2. One-time seed (10,000 employees)

The seed is **deliberately NOT in `preDeployCommand`**: it wipes the
tables, so running it on every deploy would erase any salary edits a
recruiter made. Run it once, from the Render dashboard → the
`acme-salary-api` service → **Shell**:

```bash
cd backend && npm run seed -- --force
```

- The `--force` is required on a fresh database only because the
  script is idempotent: without `--force` it skips when the table
  already holds exactly 10,000 rows, and refuses when it holds a
  different non-zero count (e.g. 10,001 after someone added an
  employee). `--force` wipes and re-seeds. The seed is deterministic
  (seed 42), so a re-seed reproduces the same 10,000 employees.
- The `npm run seed -- --force` form matters: the extra `--`
  forwards `--force` through npm to the script (`npm run seed
  --force` alone would be swallowed by npm itself).
- Expected output ends with `Seeded 10000 employees in …s`.
- If you ever need pristine demo data again (e.g. after testing
  salary edits on the live app), run the same command again.

## 3. Frontend on Vercel

1. Vercel dashboard → **Add New → Project** → import the same
   GitHub repo.
2. **Root Directory: `frontend`** (not the repo root — the Next.js
   app lives in `frontend/`; deploying from the root would fail).
3. Framework preset: Next.js (auto-detected). Build command and
   output are the defaults (`next build`).
4. Environment variable (Production):
   - `NEXT_PUBLIC_API_URL` = the Render backend URL from step 1
     (TBD, e.g. `https://acme-salary-api.onrender.com` — **no
     trailing slash, no `/api` suffix**; the frontend appends
     `/api/...` itself).
5. Deploy. Vercel shows the frontend URL (TBD, looks like
   `https://acme-salary-management.vercel.app`).

## 4. Point the backend at the frontend (CORS)

The backend's CORS allow-list (`backend/src/shared/cors.ts`) reads
`FRONTEND_URL` **at startup**, so the backend must be restarted
after this change:

1. Render dashboard → `acme-salary-api` → **Environment** → set
   `FRONTEND_URL` to the real Vercel URL from step 3 (replace the
   `https://YOUR-VERCEL-URL.vercel.app` placeholder that
   `render.yaml` ships with).
2. **Manual Deploy → Deploy latest commit** (or "Restart") so the
   backend picks it up. A redeploy re-runs the migration
   (harmless) but does **not** re-seed (see step 2).
3. Open the Vercel URL and confirm the dashboard loads with data.
   If it shows a loading/error state, see "What breaks" below.

## 5. Smoke checks on the live URLs (do these before the video)

Backend (`https://acme-salary-api.onrender.com` — TBD):

```bash
curl <BACKEND>/api/health
# → {"data":{"status":"ok"}}
curl "<BACKEND>/api/employees?search=Priya&pageSize=1"
# → meta.total = 132
curl <BACKEND>/api/analytics/summary
# → data.totalEmployees = 10000, medianSalaryUsd = 3587
```

Frontend (Vercel URL — TBD):

- Dashboard shows **headcount 10,000**, average/median pay,
  breakdowns by department/country/level.
- Employees page: search **"Priya" → 132 results**, filter
  Engineering, sort by salary descending.
- Open one employee, change the salary with reason "Annual
  appraisal" → the history shows exactly **1 new row** with the old
  and new salary.
- Export CSV → 10,001 lines (header + 10,000 rows).
- After the smoke checks, re-seed (step 2) if you want pristine
  demo data for the video, so the salary edit from the smoke check
  does not show up in the recording.

Only when every check above passes do the live URLs go into the
submission email and `docs/VERIFICATION.md` row 15 flips from
⏳ Phase 2 to ✅.

## Environment variables

| Variable | Where | Value | What breaks if wrong |
|---|---|---|---|
| `DATABASE_URL` | Render web service (from `acme-salary-db`) | Render sets it — never paste by hand | Backend cannot start / every request 500s ("connection refused" in logs) |
| `FRONTEND_URL` | Render web service | Real Vercel URL, no trailing slash | Browser blocks all API calls with a CORS error; the frontend shows loading/error forever |
| `NEXT_PUBLIC_API_URL` | Vercel (Production) | Real Render backend URL, no trailing slash, no `/api` | Frontend calls the wrong host (or localhost) — dashboard never loads data |
| `PORT` | Render web service | Render sets it — do not set by hand | App listens on the wrong port; Render health check fails and the deploy never goes live |
| `NODE_ENV` | Render web service | `production` (in `render.yaml`) | Only affects Express defaults; harmless if unset |

## What breaks (troubleshooting)

- **CORS error in the browser** (`…has been blocked by CORS policy`):
  `FRONTEND_URL` on Render does not match the URL you opened
  (check for a trailing slash, `http` vs `https`, or a Vercel
  preview URL instead of the production URL). Fix the value and
  redeploy/restart the backend — CORS is read at startup.
- **Dashboard loads but shows no data / "Failed to fetch":**
  `NEXT_PUBLIC_API_URL` is wrong or the backend is asleep (free
  plan — wait up to ~1 minute and retry) or the backend deploy
  failed (check Render logs).
- **Backend deploy fails at build:** the build log shows whether
  `npm install --include=dev` ran — without it, `tsc`/`tsx` are
  missing. Both builds were verified locally before this runbook
  was written (`npm run build` clean in backend and frontend).
- **`/api/health` returns 500:** the database is unreachable —
  check `DATABASE_URL` is still wired to `acme-salary-db` and the
  database is not paused/expired.
- **Headcount is not 10,000:** the seed did not run (or ran before
  the migration). Run step 2 again from the Render shell.
- **`npm run seed` locally says "Already seeded — skipping":**
  that is the idempotent seed working as designed (see
  `backend/scripts/seed.ts`). Add `-- --force` to wipe and re-seed.
