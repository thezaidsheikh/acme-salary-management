# Verification — every requirement checked against the code

Re-checked 23 Nov 2026 for the new branch-per-feature repo (rebuilt from the verified first repo).
"Evidence" is the file or the measured result, not a claim.

## Assessment requirements (from `docs/REQUIREMENTS.md`, written first)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | One-page requirements doc written BEFORE building | ✅ | `docs/REQUIREMENTS.md` — branch `docs/requirements`, merged first, before any code branch |
| 2 | End-to-end backend + UI, fully functional | ✅ | Backend `backend/src/` + Next.js `frontend/src/app/`; smoke-tested below |
| 3 | Backend: Node.js + relational DB | ✅ | Node 24 + TypeScript + Express; PostgreSQL 16 via `pg` + `backend/migrations/001_init.sql` and `002_salary_bands.sql` |
| 4 | UI: ReactJS or NextJS | ✅ | Next.js 14 (App Router) + React 18 + Tailwind 3, `frontend/` |
| 5 | Seed script, exactly 10,000 employees | ✅ | `backend/scripts/seed.ts` + `backend/src/seed/`; measured: `SELECT COUNT(*)` = 10,000, 10,000 distinct emails, 0.7–0.9 s; seed is idempotent (skips at 10,000, `--force` re-seeds) |
| 6 | Employees: searchable, filterable, sortable, server-paginated | ✅ | `GET /api/employees` + `frontend/src/app/employees/page.tsx`; 20/page default, max 100; search "Priya" = 132 |
| 7 | Employee detail + full salary history | ✅ | `GET /api/employees/:id`; `frontend/src/app/employees/[id]/page.tsx` |
| 8 | Salary change validated + audited (never silently overwritten) | ✅ | `modules/salary/`; PATCH validated (`newSalary > 0`, reason required), one transaction updates salary + inserts history; API test asserts exactly 1 history row |
| 9 | Add employee (validated create) | ✅ | `POST /api/employees`; `frontend/src/app/employees/new/page.tsx` |
| 10 | Analytics: headcount, payroll, avg/median, by dept/country/level, distribution, top 10, outliers | ✅ | `GET /api/analytics/summary` (`modules/analytics/`); measured on 10,000 rows: avg USD 4,555, median USD 3,587, 10 depts, 8 countries; band summary below 3,005 / within 6,995 / above 0 (see § Salary bands below) |
| 11 | CSV export respecting filters, streamed | ✅ | `GET /api/employees/export`; measured 10,001 lines (header + 10,000 rows), correct header |
| 12 | Meaningful, fast, deterministic tests | ✅ | Backend 174 tests, frontend 88 tests; see `docs/TESTING.md` (99.85% / 100% lines) |
| 13 | Incremental commits showing evolution | ✅ | Every feature/change/fix has its own branch off `main`, merged with `git merge --no-ff` — see `git log --graph` (no squash, no direct commits to `main` after the initial commit) |
| 14 | Artifacts committed | ✅ | `docs/REQUIREMENTS.md`, `PLANNING.md`, `ARCHITECTURE.md`, `DESIGN-PATTERNS.md`, `ENGINEERING-REVIEW.md`, `TRADEOFFS.md`, `PERFORMANCE.md`, `TESTING.md`, this file |
| 15 | Deployed software + video demo | ⏳ Phase 2 (backend live) | Backend LIVE at `https://acme-salary-api-droy.onrender.com` — `GET /api/health` returns `{"data":{"status":"ok"}}` (verified 23 Nov 2026). Seed NOT yet run on the live DB (0 employees — Render Shell needs a paid plan; the free workaround is BUILT on branch `feat/seed-on-start`: set `SEED_ON_START=true` on the Render service and it seeds itself on boot, then verify the live total is 10,000), frontend not yet deployed (Vercel URL TBD), video demo not yet recorded. Blueprint/deployment fixes in `render.yaml` + `docs/DEPLOYMENT.md` (free tier: no pre-deploy command; start command `node backend/dist/src/index.js`; migration now idempotent). The row flips to ✅ only when the live smoke checks in `docs/DEPLOYMENT.md` step 5 pass. |

## Salary bands — feature added after the core build (23 Nov 2026)

Candidate-added feature (branch `feat/salary-bands`, three commits:
migration + bands module, API wiring, UI), not an assessment
requirement — the brief leaves the feature list to the candidate, and
a pay-band view is what an HR Manager checks first when a salary
looks wrong.

| Check | Status | Evidence |
|---|---|---|
| `salary_bands` table, one row per level | ✅ | `backend/migrations/002_salary_bands.sql`; `SELECT COUNT(*)` = 6; values match `LEVEL_BANDS_USD` (Junior 1500/2000/2500 … Director 12000/15000/18000) |
| Migrations apply in order, idempotent | ✅ | `scripts/migrate.ts` `applyMigrations()` (001, then 002); re-running 002's seed insert adds no rows (`ON CONFLICT DO NOTHING`); tests in `tests/migrate.test.ts` |
| Every employee response carries band info | ✅ | `GET /api/employees/:id`, list, `POST`, `PATCH /salary` return `band` + `compaRatio` + `bandPosition`; API tests check them against an independent computation from the seed data |
| Compa-ratio maths | ✅ | Senior on ₹498,000/mo: 498000 ÷ 83 = $6,000 = midpoint → compa-ratio 1.00, within (pg-mem API test). Senior on ₹150,000/mo: ≈ $1,807 → 0.30, below. |
| Analytics band summary | ✅ | `GET /api/analytics/summary` returns `bandSummary`; measured on the 10,000 seed: below 3,005 / within 6,995 / above 0 (sums to 10,000; above is 0 because the seed never pays over the band max — a raise past the max is what makes it non-zero) |
| Bands API | ✅ | `GET /api/bands` returns 6 bands, Junior first; `GET /api/bands/Senior` returns 4500/6000/7500; `GET /api/bands/Intern` → 404 |
| UI | ✅ | Detail page shows band min–mid–max, compa-ratio and a Below/Within/Above badge (all three positions tested); dashboard shows the three counts |
| Seed still exactly 10,000 | ✅ | `npx tsx scripts/verify-pgmem.ts` — ALL OK (migration, seed 10,000, health, search, analytics, PATCH audit, CSV) |

## CSV bulk import — feature added after the core build (23 Nov 2026)

Candidate-added feature (branch `feat/csv-import`, four commits:
API + tests, UI + sample CSV, coverage test, docs), not an assessment
requirement — the brief leaves the feature list to the candidate, and
ACME currently lives on Excels, so the first load into the app has to
come from a file, not from 10,000 form submissions.

| Check | Status | Evidence |
|---|---|---|
| `POST /api/employees/import` (multipart, field `file`) | ✅ | `modules/employees/employee.controller.ts` (`importCsv` + multer: memory storage, 5 MB cap, `.csv` only); `employee.routes.ts` |
| Same validation as single create, no second schema | ✅ | `EmployeeService.importEmployees` calls `createEmployeeSchema.safeParse` per row (`employee.service.ts`); a row with `baseSalary: abc` fails with `baseSalary: Expected number, received nan` |
| Header must be exactly the export columns | ✅ | One shared constant `EMPLOYEE_CSV_COLUMNS` (`employee.csv.ts`) drives the export header and the import check; wrong header → 400 naming the expected header; an exported file round-trips |
| All valid rows in one transaction, no partial silent state | ✅ | `createMany` is one multi-row INSERT (single implicit transaction) in `PgEmployeeRepository` and check-then-insert in `InMemoryEmployeeRepository`; a duplicate mid-batch inserts nothing (tests on both, pg-mem + in-memory) |
| Per-row report: every failed row by number + reason | ✅ | Response `{ data: { totalRows, imported, failed: [{ row, reason }] } }`; mixed-file test asserts failed rows [3, 4, 5, 6, 7, 9] with reasons; `imported + failed.length` always equals `totalRows` |
| Duplicate emails reported, never a crash | ✅ | In-file duplicate → "Duplicate email in file"; already stored → "An employee with this email already exists" (one `existingEmails` lookup before inserting) |
| Upload limits enforced | ✅ | Non-CSV file, missing file, wrong field name and > 5 MB file all → 400 with no rows stored (API tests, incl. a ~6.6 MB file) |
| UI: Import button + report + sample CSV | ✅ | `ImportEmployees.tsx` on the Employees page (file picker, "Imported X of Y rows", failed-row list, list refreshes after import); `frontend/public/sample-employees.csv` linked from the UI (exact export columns, 3 rows) |
| Seed still exactly 10,000 | ✅ | `npx tsx scripts/verify-pgmem.ts` — ALL OK (migration, seed 10,000, health, search, analytics, PATCH audit, CSV export, CSV import: mixed file imports 2, reports rows 3–4, total becomes 10,002) |

## Company-wide audit log — feature added after the core build (23 Nov 2026)

Candidate-added feature (branch `feat/audit-log`, four commits:
API + tests, UI, verify-script + coverage fix, docs), not an assessment
requirement — the brief leaves the feature list to the candidate, and
the HR Manager's first question after "who changed this salary?" is
"show me every change", not one employee at a time.

| Check | Status | Evidence |
|---|---|---|
| `GET /api/audit-log`, newest first, server-paginated | ✅ | `modules/audit/` (`audit.service.ts`, `audit.controller.ts`, `audit.routes.ts`, `audit.factory.ts`); same `{ data, meta }` envelope as the employee list — `paginationMeta` shared, not re-implemented |
| One row says who / whose / old → new / reason / when | ✅ | `AuditLogRow` (`employeeName`, `department`, `oldSalary`, `newSalary`, `currency`, `reason`, `changedBy`, `changedAt`); API test asserts every field on the newest row |
| Filters: employee, department, date range | ✅ | `search` (exact employee id, or name/email substring), `department`, `from`/`to` YYYY-MM-DD inclusive; each filter alone, combined with AND, and empty result all tested (in-memory + pg-mem) |
| Reads the same history the PATCH writes — no second store | ✅ | `EmployeeRepository.listAuditLog` (one `JOIN salary_history + employees` in `PgEmployeeRepository`, same contract in `InMemoryEmployeeRepository`); no `AuditRepository` class, no new table, no new migration; `scripts/verify-pgmem.ts` PATCHes a salary then GETs the audit log and asserts the row appears with the right old/new/reason (measured: Lukas Ahmed, 6,200 → 999,999 AED, "Verification check") |
| Invalid input rejected | ✅ | Bad date format, `from` after `to`, `page=0`, `pageSize=101` all → 400 (API tests) |
| UI: `/audit` page with the same filters + pagination | ✅ | `frontend/src/app/audit/page.tsx` (search, department, from/to date inputs, 20 rows/page, Previous/Next); linked from the header nav and the dashboard; 7 page tests incl. each filter sending its param and pagination both ways |
| Seed still exactly 10,000 | ✅ | `npx tsx scripts/verify-pgmem.ts` — ALL OK (migration, seed 10,000, health, search, analytics, PATCH audit, audit-log check, CSV export, CSV import) |

## Rework verification (measured by hand, 23 Nov 2026)

- Backend: `npm run build` zero errors; `npm test` 174/174; `npm run coverage`
  99.85% lines / 99.53% branches / 100% functions.
- Frontend: `npm run typecheck` zero errors; `npm run build` clean
  (7 routes, First Load JS 90–100 kB); `npm test` 88/88; coverage 100%.
- Seed: exactly 10,000 employees in 0.7 s; `COUNT(DISTINCT email)` = 10,000;
  search "Priya" = 132; min salary 1,000, max 521,500.
- Backend smoke (built server, real Postgres 16): health 200 (~12 ms);
  list 200; analytics 200 (total 10,000, avg 4,555, median 3,587);
  PATCH 11,700 → 999,999 with 1 history row; bad PATCH 400; unknown
  id 404; unknown route 404; `page=0` 400; CSV 10,001 lines. DB re-seeded
  to pristine state afterwards (10,000 rows, max salary 521,500).
- Frontend smoke (`next start`, port 3000): `/`, `/employees`,
  `/employees/new`, `/employees/abc` all 200, HTML contains
  "Salary Management" / "ACME". Backend was not running for that check —
  pages fetch client-side, so loading state + HTTP 200 is the correct
  outcome. Servers stopped afterwards; ports 3000/4000 free.
- Private interview notes are gitignored and never referenced from any public doc (verified by searching `docs/` and `README.md` for the notes folder name — no matches).
- `grep` for `any` types in `backend/src` + `frontend/src` → none
  (only the word "any" in comments).

## Assessment doc points — honest status

The assessment doc itself leaves the feature list, data model, fields,
API endpoints and UI screens to the candidate — there is no detailed
spec to "miss". The scope in `docs/REQUIREMENTS.md` (features 1–10
above) is the candidate-defined scope, with reasons for what was left
out. No deadline is stated in the doc; fast submissions are prioritised
per the email. Submission is by replying to the same email with the
repository link. The point-by-point evidence for every assessment
requirement is the table above; the engineering record is in
`docs/ENGINEERING-REVIEW.md`.
