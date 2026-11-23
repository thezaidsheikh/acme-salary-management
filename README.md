# Salary Management — Incubyte Assessment

Web app for an HR Manager to manage salaries for 10,000 employees at ACME
org (currently on Excels), and to answer "how does the org pay people?".
See `docs/REQUIREMENTS.md` first — it was written before any code.

**Stack:** Node.js 24 + TypeScript + Express + `pg` + PostgreSQL 16
(backend, modular monolith), Next.js 14 (App Router) + React 18 +
TypeScript + Tailwind CSS 3 (frontend). Tests: Vitest (+ Supertest,
Testing Library) with v8 coverage.

**Measured (23 Nov 2026):** backend 170/170 tests, 99.85% lines covered;
frontend 88/88 tests, 100% lines covered; seed exactly 10,000 employees
in ~0.8 s. Full numbers in `docs/TESTING.md` and `docs/VERIFICATION.md`.

**How it was engineered:** requirements written first and checked
line-by-line against the assessment brief, then built as a modular
monolith with named design patterns (Repository, Service, Dependency
Injection, Factory, Singleton — each with its file in
`docs/DESIGN-PATTERNS.md`), every feature reviewed on its own branch
before merging, and everything verified by running the app locally
(seed count, salary-audit smoke test, full test suites). The full
engineering record is in `docs/ENGINEERING-REVIEW.md`.

## Quick start

```bash
# 1. Database (needs Docker, or a local Postgres 16)
docker compose up -d
# 2. Backend
cd backend && cp .env.example .env && npm install
npm run migrate   # Node + pg — no psql CLI needed (runs migrations/001_init.sql, then 002_salary_bands.sql, in order)
npm run seed      # exactly 10,000 employees
npm run dev       # http://localhost:4000
# 3. Frontend (new terminal)
cd frontend && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

## Branch & commit history (how to read it)

Every feature, change, fix and refactor has its own branch off `main`,
merged with `git merge --no-ff` — never a direct commit to `main` after
the initial commit, never a squash. Read it with:

```bash
git log --graph --oneline   # branches and merges, in order
git branch -r               # branches were deleted after merging; the merges keep them visible
```

Order: `docs/requirements` → `chore/scaffold` → `feat/seed-10000` →
`feat/employees-module` → `feat/salary-audit` → `feat/analytics` →
`refactor/modular-monolith` → `test/coverage-90` → `feat/nextjs-setup` →
`feat/shared-ui` → `feat/dashboard` → `feat/employees-list` →
`feat/employee-detail` → `feat/add-employee` → `docs/architecture` →
`docs/artifacts` → `docs/readme` → `feat/salary-bands` (migration +
bands module, API wiring, UI) → `feat/csv-import` (API + tests, UI +
sample CSV, coverage test, docs) → `feat/audit-log` (API + tests, UI,
verify-script + coverage fix, docs). Tests travel with the feature they
test, in the same branch.

## Architecture (one paragraph)

A modular monolith: the backend is one deployable Express app made of
five modules — `employees` (list/search/pagination/detail/create/export/import),
`salary` (salary-change rule + audit), `analytics` (dashboard numbers),
`bands` (salary bands + compa-ratio, shared by the other three) and
`audit` (company-wide audit log, newest first — a read-only view over
the salary history the salary module writes, no second store) —
plus a `shared` kernel (pool, errors, HTTP helpers, maths). Each module
owns its routes, controller, service and repository and talks to other
modules only through their public interfaces, so any module can later be
extracted into a microservice without a rewrite (the exact extraction
path is in `docs/ARCHITECTURE.md`). The frontend is Next.js App Router
with file routes `/`, `/employees`, `/employees/new`, `/employees/[id]`,
`/audit`; pages are client components fetching from the API at runtime.

```
Next.js 14 (frontend/) ──HTTP/JSON──► Express modular monolith (backend/src)
                                        modules/employees · salary · analytics · bands · audit
                                        ──pg Pool──► PostgreSQL 16
```

## API

- `GET /api/health`
- `GET /api/employees?search=&department=&country=&level=&sortBy=&sortOrder=&page=&pageSize=` — every row carries `band` (min/mid/max USD), `compaRatio` and `bandPosition`
- `GET /api/employees/:id` (with salary history + band info)
- `POST /api/employees` (returns the created employee with band info)
- `PATCH /api/employees/:id/salary` — `{ newSalary, reason }`, writes a SalaryHistory row in the same transaction; the returned employee carries band info
- `GET /api/bands` — all six level bands, Junior first
- `GET /api/bands/:level` — one band (404 for an unknown level)
- `GET /api/analytics/summary` — includes `bandSummary` (below / within / above counts)
- `GET /api/employees/export?format=csv` (streamed, respects filters)
- `POST /api/employees/import` (multipart CSV upload, max 5 MB, `.csv` only) — returns `{ data: { totalRows, imported, failed: [{ row, reason }] } }`; every row is validated with the same rules as single create, all valid rows insert in one transaction, and every failed row (bad value, duplicate email) is named with its file row number and reason. Sample CSV: `frontend/public/sample-employees.csv`
- `GET /api/audit-log?search=&department=&from=&to=&page=&pageSize=` — every salary change in the company, newest first, server-paginated like the employee list; each row carries `employeeName`, `department`, `oldSalary`, `newSalary`, `currency`, `reason`, `changedBy`, `changedAt`. `search` matches an employee id exactly or a name/email substring; `from`/`to` are YYYY-MM-DD dates, inclusive. The page lives at `/audit` (linked from the nav and the dashboard).

Every response uses one envelope: success `{ data, meta? }`, error
`{ error: { code, message, details? } }`.

## Folder structure

```
backend/src/
  app.ts                 # composition root (wiring only)
  index.ts               # bootstrap (listen only)
  shared/                # db, errors, http, analytics — cross-cutting only
  modules/employees/     # types, repository, validation, csv, service, controller, routes, factory
  modules/salary/        # salary-change rule + audit
  modules/analytics/     # dashboard maths (pure computeAnalytics)
  modules/bands/         # salary bands + compa-ratio (pure classifySalary)
  modules/audit/         # company-wide audit log (read-only, over salary_history)
  seed/                  # deterministic 10,000-employee generator + factory
  ../migrations/001_init.sql
  ../migrations/002_salary_bands.sql
  ../tests/              # 170 tests (Vitest + Supertest + pg-mem)
frontend/src/
  app/                   # Next.js routes: /, /employees, /employees/new, /employees/[id], /audit
  features/employees/    # typed API client + types (single source)
  shared/components/     # StatCard, BarList
  shared/lib/constants.ts
  shared/utils/format.ts
docs/                    # reviewer artifacts (see below)
```

## Tests

```bash
cd backend && npm test && npm run coverage    # 170 tests, 99.85% lines
cd frontend && npm test && npm run coverage   # 88 tests, 100% lines
cd backend && npx tsx scripts/verify-pgmem.ts # migration + 10k seed + HTTP smoke, no Postgres server
```

## Troubleshooting

**CORS error in the browser** (`Access to fetch at 'http://localhost:4000/…' from origin '…' has been blocked by CORS policy`)?
The backend allows a list of origins (`backend/src/shared/cors.ts`):
`FRONTEND_URL` from `backend/.env` (comma-separated) plus
`http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:3001`
and `http://127.0.0.1:3001`. Check three things:
1. Open the frontend at `http://localhost:3000` — not `127.0.0.1`, and
   not port `3001` unless you also set `FRONTEND_URL` to include it.
2. `FRONTEND_URL` in `backend/.env` must have no trailing slash
   (`http://localhost:3000`, not `http://localhost:3000/`).
3. Restart the backend after editing `.env` — env vars are read at startup.

**`psql: command not found` on `npm run migrate`?** Migrate no longer
needs the `psql` CLI — it runs through the Node `pg` driver. Just
`git pull` and run `npm run migrate` again.

**`npm run seed` says "Already seeded — skipping"?** That is the
idempotent seed working as designed (`backend/scripts/seed.ts`): it
skips when the table already holds 10,000 employees, and refuses when
it holds a different non-zero count. Add `-- --force` to wipe and
re-seed: `npm run seed -- --force`.

**Live database is empty (0 employees) on Render?** Render's free tier
has no Shell, so the seed cannot be run by hand there. The backend
seeds itself on boot when `SEED_ON_START=true` — set it on the Render
web service (it triggers a redeploy) and watch the logs for
`Seed on start: seeded 10000 employees.` It only seeds an empty table,
skips at 10,000, and never crashes the server if it fails — full steps
in `docs/DEPLOYMENT.md` step 2.

## Docs for the reviewer

- `docs/REQUIREMENTS.md` — one-page requirements (written first)
- `docs/DEPLOYMENT.md` — deploy runbook: Render + Vercel steps, env vars, live smoke checks
- `docs/ARCHITECTURE.md` — modular monolith, module boundaries, microservice extraction path
- `docs/DESIGN-PATTERNS.md` — Repository, Service, DI, Factory, SOLID, DRY/KISS/YAGNI — each with file + example
- `docs/TRADEOFFS.md` — every major decision + what was rejected
- `docs/PERFORMANCE.md` — how 10,000 rows stay fast, with measured numbers
- `docs/TESTING.md` — coverage numbers and the exact gaps below 100%
- `docs/VERIFICATION.md` — every requirement checked against the code, with evidence
- `docs/ENGINEERING-REVIEW.md` — how the work was done: review process, design patterns, decisions, manual verification

## Out of scope (deliberate)

Payroll/tax, auth/RBAC, leave/attendance, live FX conversion, AI chatbot
— reasons in `docs/REQUIREMENTS.md`. Deployment + video demo are phase 2:
backend is live at `https://acme-salary-api-droy.onrender.com`
(health verified); the live seed is still pending — the boot-time
auto-seed is built, set `SEED_ON_START=true` on Render (see
`docs/DEPLOYMENT.md` step 2); frontend and video demo are still pending.
