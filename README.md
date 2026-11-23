# Salary Management — Incubyte Assessment

Web app for an HR Manager to manage salaries for 10,000 employees at ACME
org (currently on Excels), and to answer "how does the org pay people?".
See `docs/REQUIREMENTS.md` first — it was written before any code.

**Stack:** Node.js 24 + TypeScript + Express + `pg` + PostgreSQL 16
(backend, modular monolith), Next.js 14 (App Router) + React 18 +
TypeScript + Tailwind CSS 3 (frontend). Tests: Vitest (+ Supertest,
Testing Library) with v8 coverage.

**Measured (23 Nov 2026):** backend 90/90 tests, 99.74% lines covered;
frontend 62/62 tests, 100% lines covered; seed exactly 10,000 employees
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
npm run migrate   # Node + pg — no psql CLI needed (runs migrations/001_init.sql on the shared pool)
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
`docs/artifacts` → `docs/readme`. Tests travel with the feature they
test, in the same branch.

## Architecture (one paragraph)

A modular monolith: the backend is one deployable Express app made of
three modules — `employees` (list/search/pagination/detail/create/export),
`salary` (salary-change rule + audit) and `analytics` (dashboard numbers)
— plus a `shared` kernel (pool, errors, HTTP helpers, maths). Each module
owns its routes, controller, service and repository and talks to other
modules only through their public interfaces, so any module can later be
extracted into a microservice without a rewrite (the exact extraction
path is in `docs/ARCHITECTURE.md`). The frontend is Next.js App Router
with file routes `/`, `/employees`, `/employees/new`, `/employees/[id]`;
pages are client components fetching from the API at runtime.

```
Next.js 14 (frontend/) ──HTTP/JSON──► Express modular monolith (backend/src)
                                        modules/employees · salary · analytics
                                        ──pg Pool──► PostgreSQL 16
```

## API

- `GET /api/health`
- `GET /api/employees?search=&department=&country=&level=&sortBy=&sortOrder=&page=&pageSize=`
- `GET /api/employees/:id` (with salary history)
- `POST /api/employees`
- `PATCH /api/employees/:id/salary` — `{ newSalary, reason }`, writes a SalaryHistory row in the same transaction
- `GET /api/analytics/summary`
- `GET /api/employees/export?format=csv` (streamed, respects filters)

Every response uses one envelope: success `{ data, meta? }`, error
`{ error: { code, message, details? } }`.

## Folder structure

```
backend/src/
  app.ts                 # composition root (wiring only)
  index.ts               # bootstrap (listen only)
  shared/                # db, errors, http, analytics — cross-cutting only
  modules/employees/     # types, repository, validation, service, controller, routes, factory
  modules/salary/        # salary-change rule + audit
  modules/analytics/     # dashboard maths (pure computeAnalytics)
  seed/                  # deterministic 10,000-employee generator + factory
  ../migrations/001_init.sql
  ../tests/              # 90 tests (Vitest + Supertest + pg-mem)
frontend/src/
  app/                   # Next.js routes: /, /employees, /employees/new, /employees/[id]
  features/employees/    # typed API client + types (single source)
  shared/components/     # StatCard, BarList
  shared/lib/constants.ts
  shared/utils/format.ts
docs/                    # reviewer artifacts (see below)
```

## Tests

```bash
cd backend && npm test && npm run coverage    # 90 tests, 99.74% lines
cd frontend && npm test && npm run coverage   # 62 tests, 100% lines
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

## Docs for the reviewer

- `docs/REQUIREMENTS.md` — one-page requirements (written first)
- `docs/ARCHITECTURE.md` — modular monolith, module boundaries, microservice extraction path
- `docs/DESIGN-PATTERNS.md` — Repository, Service, DI, Factory, SOLID, DRY/KISS/YAGNI — each with file + example
- `docs/TRADEOFFS.md` — every major decision + what was rejected
- `docs/PERFORMANCE.md` — how 10,000 rows stay fast, with measured numbers
- `docs/TESTING.md` — coverage numbers and the exact gaps below 100%
- `docs/VERIFICATION.md` — every requirement checked against the code, with evidence
- `docs/ENGINEERING-REVIEW.md` — how the work was done: review process, design patterns, decisions, manual verification

## Out of scope (deliberate)

Payroll/tax, auth/RBAC, leave/attendance, live FX conversion, AI chatbot
— reasons in `docs/REQUIREMENTS.md`. Deployment + video demo are phase 2
(not done yet); deployment notes are in `docs/ARCHITECTURE.md`.
