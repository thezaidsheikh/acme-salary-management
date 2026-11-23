# Engineering Review — how this solution was built, reviewed and verified

This is the candidate's own engineering record: the review process,
the design patterns and where each one is used, the decisions with
their rejected alternatives, and the manual verification that was
actually run. Every claim below points at a file or a measured number.

## 1. Requirements first, checked line by line

- `docs/REQUIREMENTS.md` was written **before any code** — it is the
  first branch (`docs/requirements`) and the first commit after the
  initial commit.
- It was checked against every line of the assessment brief before
  building started: goal, persona (HR Manager), in-scope features,
  out-of-scope items with reasons, data model, and success criteria.
- The brief leaves the feature list, data model, API and screens to
  the candidate, so the scope in that doc is candidate-defined — and
  the doc says so, instead of pretending a spec existed.
- `docs/VERIFICATION.md` re-checks every requirement against the code
  with a file or a measured number as evidence. Nothing is marked
  covered on a claim alone.

## 2. Review process — one branch per feature, reviewed before merge

- Every feature, change, fix and refactor got **its own branch off
  `main`**, merged with `git merge --no-ff`, and the branch deleted
  after merging. No squash, no direct commits to `main` after the
  initial commit.
- Read the history with `git log --graph --oneline` — it reads like
  the build story: requirements first, then scaffold, seed, employees
  module, salary audit, analytics, modular-monolith refactor,
  coverage, Next.js setup, shared UI, dashboard, employees list,
  employee detail, add employee, architecture docs, artifacts, README
  — followed by the later fixes (`fix/migrate-without-psql`,
  `fix/cors-origins`) and doc revisions, each on its own branch.
- Tests travel with the feature they test, in the same branch, so no
  branch is merged with its feature untested.
- Each branch was reviewed before merging: the diff, the tests it
  adds, and the docs it touches. The review questions were always the
  same — does this match the requirements doc, does it break an
  existing test, and is there a simpler way to do it?

## 3. Design patterns — where each one is used, and why

Full detail with examples is in `docs/DESIGN-PATTERNS.md`. This is
the summary, with the exact file for each pattern.

| Pattern | Where | Why it was chosen |
|---|---|---|
| Repository | `backend/src/modules/employees/employee.repository.ts` — `EmployeeRepository` interface, `PgEmployeeRepository`, `InMemoryEmployeeRepository` | Only the repository knows SQL. Services depend on the interface, so the database can be swapped — or faked in tests — without touching business logic. |
| Service layer | `modules/employees/employee.service.ts`, `modules/salary/salary.service.ts`, `modules/analytics/analytics.service.ts` (pure `computeAnalytics`) | A business rule lives in exactly one place. "A salary change must differ from the current salary and must be audited" is enforced in `SalaryService`, so no controller, UI or test can bypass it. |
| Thin Controller | `modules/*/ *.controller.ts` (e.g. `modules/salary/salary.controller.ts`) | A controller only validates input, calls one service method and shapes the response. If a controller grows past that, the rule belongs in the service. |
| Dependency Injection (constructor injection) | All three services take `EmployeeRepository` in the constructor; module factories receive a `Pool \| EmployeeRepository`; `backend/src/app.ts` (composition root) wires them | A class never creates its own dependencies. Production injects the `pg` repository, tests inject the in-memory one — same code, different wiring. |
| Factory | Module factories (`createEmployeeModule`, `createSalaryModule`, `createAnalyticsModule` in `modules/*/ *.factory.ts`) and `backend/src/seed/employeeFactory.ts` (`createSeedEmployee`) | Building a seed employee involves email-uniqueness, level weighting, salary bands and manager links. The factory hides that construction so the generator stays a short loop. |
| Singleton | `backend/src/shared/db.ts` — one shared `pg` Pool (`export const pool`), created once and reused by every module | One connection pool for the whole app: connections are bounded and shared instead of every module opening its own. |

Principles applied, with one example each (full table in
`docs/DESIGN-PATTERNS.md`):

- **SOLID** — S: `modules/salary/` owns only salary changes. O: a new
  repository needs no service change. L: the in-memory repository
  substitutes for the `pg` one in every API/service test. I: services
  depend on the small `EmployeeRepository` interface, not the whole
  `pg` `Pool` API. D: `SalaryService` depends on the interface, never
  on `PgEmployeeRepository` or SQL.
- **DRY** — departments, countries and levels are listed once in
  `frontend/src/shared/lib/constants.ts`; one error envelope in
  `backend/src/shared/http.ts`; median/average/pagination shared in
  `backend/src/shared/analytics.ts`.
- **KISS** — plain tables + CSS bars instead of a chart library; `pg`
  + one SQL migration instead of an ORM; no cache, no auth, no
  microservices (see §4).
- **YAGNI** — nothing was built that the requirements doc does not
  ask for: no auth, no payroll/tax, no leave, no live FX, no chatbot,
  no Redis cache, no materialised views.

## 4. Decisions — what was chosen, and what was rejected

Every decision below has its full reasoning in
`docs/TRADEOFFS.md`. The short version:

| Decision | Chosen | Rejected, and why |
|---|---|---|
| UI framework | Next.js 14 (App Router) + React 18 | Vite SPA — faster dev start, but no file routing/layouts, and the assessment's Next.js option was explicitly chosen. The first build was Vite; it was migrated to Next.js in a dedicated rework, not patched over. |
| Database | PostgreSQL 16 | SQLite — fine for a demo, but salary + audit needs real transactions and indexes at 10,000 rows. |
| Data layer | `pg` + plain SQL migration (`backend/migrations/001_init.sql`) | Prisma — first choice, but its engine binaries could not be downloaded in this environment (`binaries.prisma.sh` returned 404, verified with curl). Same schema, same indexes, same repository interface, so only the repository changed. |
| Architecture | Modular monolith | Microservices — the brief says it is not looking for the most complex system. One deployable app with three modules and clear walls keeps extraction possible later (the exact path is in `docs/ARCHITECTURE.md`) without paying distributed-transaction costs now. |
| Charts | Plain tables + CSS bars | Chart library — prettier, heavier; not needed to answer "how does the org pay people?" |
| Cache | None | Redis — Postgres answers these queries in milliseconds at 10,000 rows; a cache would add stale-data risk for no measured gain. |
| Auth | None (deliberate, documented) | A weak login bolted on — the brief has one persona (HR Manager); auth is listed as the next step instead of a half-built version. |
| AI chatbot | Out of scope | Analytics + filters answer the same HR questions deterministically and testably. |

## 5. Manual verification — run by hand, not trusted on report

The app was run locally (Docker Postgres on the candidate's Mac)
and every number below was measured, not assumed:

- **Seed:** exactly 10,000 employees — `SELECT COUNT(*)` = 10,000,
  10,000 distinct emails, seeded in 0.7–0.9 s. Deterministic: seed 42
  gives the same 10,000 people every time, asserted by a test.
- **Search:** "Priya" = 132 matches; analytics on 10,000 rows: avg
  USD 4,555, median USD 3,587, 10 departments, 8 countries.
- **Salary audit smoke test:** PATCH 11,700 → 999,999 created
  exactly **1** history row with old + new values; bad PATCH → 400,
  unknown id → 404. The database was re-seeded to its pristine state
  afterwards (10,000 rows, max salary 521,500).
- **CSV export:** 10,001 lines (header + 10,000 rows), correct header,
  streamed in pages so the whole export is never held in memory.
- **Tests:** backend 90/90, 99.74% lines / 99.01% branches / 100%
  functions; frontend 62/62, 100% lines. The gaps below 100% are
  documented honestly in `docs/TESTING.md` (a defensive fallback and
  a synthetic V8 branch — both proven unreachable, not hidden).
- **Builds:** `npm run build` clean in both packages; `next build`
  clean (6 routes, First Load JS 90–99 kB).
- **No `any` types:** `grep` for `any` in `backend/src` +
  `frontend/src` returns none (only the word in comments).

### Two real failures found by running the app — and fixed

1. **`psql: command not found` on `npm run migrate`.** The database
   was running (Docker Postgres) but the `psql` CLI was not installed
   on the machine, so the migrate script that shelled out to `psql`
   failed. The fix (branch `fix/migrate-without-psql`) runs the same
   migration through the Node `pg` driver instead —
   `backend/scripts/migrate.ts` — with a clear error if `DATABASE_URL`
   is missing or the connection fails. Two new tests prove the
   migration creates the tables and enforces the constraints.
2. **CORS origin issue.** The backend allowed exactly one origin
   (`http://localhost:3000`), so opening the frontend at
   `http://127.0.0.1:3000` or on port 3001 (when Next.js falls back
   because 3000 is busy) was blocked by the browser. The fix (branch
   `fix/cors-origins`) is an allow-list in
   `backend/src/shared/cors.ts` — `FRONTEND_URL` (comma-separated)
   plus `localhost`/`127.0.0.1` on ports 3000 and 3001 — while unknown
   origins still get no `Access-Control-Allow-Origin` header. Eight
   new tests prove each allowed origin works and an unknown origin is
   blocked.

Both fixes were found by running the app on a real machine, not by
reading the code — which is exactly why local verification is part of
this record.

## 6. Commit history as evidence of incremental work

- `git log --graph --oneline` shows the evolution: requirements
  first, then each layer, then the rework, then the fixes — each on
  its own branch, merged with `--no-ff`, no squash.
- The one big rework commit was split into feature-level commits on
  request, and the repo was then rebuilt from scratch as a new repo
  with a strict branch-per-feature workflow — because a single large
  commit does not show how a solution evolved, and the assessment
  explicitly asks for incremental commits.
- Honest status: deployment + video demo are **phase 2, not done
  yet** — marked as such in `docs/VERIFICATION.md`, not claimed.
