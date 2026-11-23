# Testing & Coverage

Tests are fast, deterministic and easy to understand — no live database
is needed for the unit/API suites. The live-Postgres path is verified
separately by the seed + smoke test (see `docs/VERIFICATION.md`).

## How to run

```bash
cd backend && npm test              # unit + API tests
cd backend && npm run coverage      # same, with a coverage report
cd frontend && npm test             # component + util tests (jsdom)
cd frontend && npm run coverage     # same, with a coverage report
cd backend && npx tsx scripts/verify-pgmem.ts   # migration + 10k seed + HTTP smoke, no Postgres server
```

## Coverage — measured 23 Nov 2026 (re-measured after the audit-log feature)

| Package | Tests | Lines | Branches | Functions | Statements |
|---|---|---|---|---|---|
| Backend | 174 passed, 20 files | 99.85% | 99.53% | 100% | 99.85% |
| Frontend (Next.js) | 88 passed, 11 files | 100% | 100% | 100% | 100% |

Thresholds are enforced at 90% in both `vitest.config.ts` files — the
run fails if coverage drops below them.

## What is tested

**Backend (174 tests):**
- Audit log — `GET /api/audit-log` over the in-memory repo (empty log;
  newest-first ordering with who / whose / old → new / reason / when;
  pagination with page 2 differing from page 1 and correct meta;
  employee filter by name, email and exact id; department filter;
  date-range filter inclusive on both ends, from-only, to-only and a
  single day; combined filters with AND; empty result; 400s for a bad
  date, a reversed range and out-of-range paging; a salary change made
  via PATCH appears on the log with the right old/new/reason); the same
  read over pg-mem with the real migration and real SQL (JOIN ordering,
  filters, pagination, and the PATCH → audit proof end to end);
  `AuditService.list` returns the shared `{ data, meta }` envelope;
  the audit module is built by both factory branches (Pool and injected
  repository); the in-memory read skips an orphan history row and
  orders equal timestamps by id.
- Malformed employee id — `PgEmployeeRepository.getById` returns null
  for a non-UUID id (shared `isUuid` in `src/shared/ids.ts`), so
  `GET /api/employees/:id` and `PATCH /api/employees/:id/salary`
  answer 404 "Employee not found" instead of the 500 Postgres used
  to throw for `WHERE id = $1` with a non-UUID string (regression
  test `tests/invalidId.test.ts`, pg-mem with real SQL); a
  well-formed but absent UUID still 404s, and a valid id still
  resolves. The in-memory suite already covered "nope" -> 404 — it
  never caught this, because the in-memory repository compares
  strings and never touches Postgres.
- CSV import — `parseCsv` (quoted commas, doubled quotes, CRLF + lone
  CR, BOM, blank lines kept as `[]`, unterminated quote to EOF);
  `EmployeeService.importEmployees` (all-valid file imports every row
  with fresh ids; mixed file imports only the good rows and reports
  each bad row with its exact file row number + reason — bad salary,
  bad level, bad date, too few columns, duplicate inside the file,
  duplicate already stored; blank lines skipped without shifting later
  row numbers; all-rows-bad and all-duplicates files import nothing;
  empty file and wrong header rejected; header-only file imports 0;
  an exported file round-trips, its `id` column ignored);
  `POST /api/employees/import` (multipart upload, uppercase `.CSV`
  accepted; non-CSV / missing file / wrong field name / over-5 MB file
  all 400 with no rows stored); repository `createMany` atomicity —
  Pg over pg-mem and InMemory both insert nothing when one row in the
  batch is a duplicate — plus `existingEmails` on both; the
  controller's defensive non-Error upload branch via a mocked-multer
  test (`tests/importController.test.ts`).
- Validation — every Zod schema error path (bad email/level/date,
  salary ≤ 0, missing/short reason, page 0, pageSize > 100, bad sort).
- Analytics maths — median (odd/even/empty/single), average, `toUsd`
  (including unknown currency), distribution buckets, outliers
  (none/some), top earners with fewer than 10 employees.
- Salary bands — `classifySalary` (below/within/above, exact min/max
  edges included, exact midpoint → 1.00, rounding to 2 decimals);
  `BandService` over the in-memory repo (FX conversion before
  classifying, unknown level → null, batch enrich, summary counts);
  `PgBandRepository` over pg-mem with the real migrations (six seeded
  bands, `getByLevel` for a known and an unknown level); the bands API
  (`GET /api/bands`, `GET /api/bands/:level`, 404 for an unknown
  level); band fields on employee detail/list/create/PATCH responses
  (checked against an independent computation from the seed data);
  `bandSummary` in the analytics summary (sums to the employee count);
  fail-fast 500 when a level has no band (unmigrated DB).
- Migrations — `applyMigrations` applies 001 then 002 in order and
  seeds the six bands with the exact values; re-running 002's seed
  insert adds no duplicates (`ON CONFLICT DO NOTHING`); 002's guards
  (`IF NOT EXISTS`, `ON CONFLICT`) asserted from the file text.
  (Re-applying a whole `CREATE TABLE` in pg-mem is a known pg-mem
  limitation — see `migrate-idempotent.test.ts` — not a problem in
  the SQL; on real Postgres the whole set re-runs.)
- Seed determinism — same seed → same employees; 10,000 rows, 10,000
  unique emails; salaries in band.
- Seed idempotency — seeds on an empty DB, skips when already seeded
  at 10,000, re-seeds with `--force`, refuses to wipe a partially
  filled table without `--force` (pg-mem, real migration + real SQL).
- Seed-on-start — does nothing unless `SEED_ON_START=true`; seeds
  exactly 10,000 on an empty DB and skips on the second boot; refuses
  a partially filled table without wiping it; never throws when the
  database is unreachable (logs and returns the error); and a real
  HTTP server answers `/api/health` while the seed runs in the
  background (`src/shared/seedOnStart.ts`, 100% covered).
- Salary rules — same salary rejected, unknown employee 404, duplicate
  email 400, PATCH creates exactly one history row with old + new.
- Repository — InMemory all methods (filters, sorts asc/desc, pagination
  edges, missing ids) plus `existingEmails`/`createMany` (whole batch,
  empty batch, duplicate stored or in-batch inserts nothing) and
  `listAuditLog` (all filters, orphan row skipped, equal-timestamp
  ordering); Pg repository against pg-mem (real migration +
  real SQL: create, list, get, salary update with history, `createMany`
  atomicity, `existingEmails`, `listAuditLog` JOIN).
- HTTP/app — asyncHandler error forwarding, error envelope (ApiError vs
  500), unknown route 404, CSV export content + empty export, POST
  create success.
- Pagination edges — page beyond the last page returns an empty list
  with correct meta; pageSize 100 accepted, 101 rejected.
- CORS allow-list — `localhost:3000`, `127.0.0.1:3000` and
  `localhost:3001` get `Access-Control-Allow-Origin`; preflight OPTIONS
  returns 204 with Allow-Origin + Allow-Methods; an unknown origin
  gets no Allow-Origin header; a custom `FRONTEND_URL` list (commas,
  trailing slashes stripped) is honoured alongside the defaults.

**Frontend (88 tests):**
- Utils — `formatMoney`/`formatDate` (including unknown-currency
  fallback), constants.
- Components — `StatCard`, `BarList` (rows, widths, empty list);
  `ImportEmployees` (button + sample-CSV link; picked file uploads and
  the report shows imported count + failed rows with row numbers;
  all-imported message with no failed list; backend error shown, list
  not refreshed; non-Error throw shows the generic message; uploading
  state disables the button; cancelled picker uploads nothing;
  clicking the button opens the file picker).
- API client — all endpoints, error-envelope handling, export URL,
  `importEmployees` posts the file as FormData (no JSON Content-Type)
  and returns the report; error paths fall back to "Failed to import CSV";
  `listAuditLog` sends the search/department/date-range/page params and
  returns data + meta; its error paths throw the envelope message, or
  "Failed to load audit log" without one.
- Pages (mocked API) — Dashboard loading/error/loaded, including the
  salary-band position counts; Employees loading/empty/error, filters,
  sort, pagination buttons, import controls present and list refetched
  after a successful import; EmployeeDetail loading/error, every
  salary-form validation error, success path, and the salary-band card
  for all three positions (Below / Within / Above badge); AddEmployee
  validation errors and success navigation; Audit log loading/empty/
  error, rows with who / old → new / reason / when, search + department
  + from/to filters each sending their param, pagination forward and
  back with buttons disabled at the ends.

## Gaps — exactly what is below 100% and why

**Backend (99.85% lines):**
- `src/modules/audit/` is 100% across the board — service, controller,
  routes, factory and validation, including the `from ≤ to` refine.
- `src/modules/employees/` is 100% lines / 100% functions across the
  board — `employee.csv.ts`, `employee.service.ts` and
  `employee.controller.ts` are fully covered, including the import's
  error mapping (the defensive non-Error arm is covered by the
  mocked-multer controller test, not by HTTP).
- `src/modules/bands/` is 100% across the board (the factory's
  BandRepository passthrough branch is covered by a dedicated test).
- `src/seed/employeeFactory.ts` 96.82% lines / 91.66% branches —
  lines 45–46, the `pickWeighted` fallback `return weights.length - 1`:
  genuinely unreachable. `LEVEL_WEIGHTS` sums to exactly 1.0 and
  `rng()` is in [0, 1), so an index is always picked inside the loop.
  Defensive code only.
- `src/modules/employees/employee.repository.ts` 100% lines / 99.16%
  branches — line 360, the synthetic V8 branch on `} finally {` in
  `PgEmployeeRepository.updateSalary`. Both paths execute
  `client.release()` (success via pg-mem COMMIT; failure via a fake-pool
  test asserting release after UPDATE + ROLLBACK both throw). V8 never
  counts this synthetic branch; it is not a real gap. The audit read's
  own branches are all covered: the in-memory orphan-row guard by the
  orphan test, and the equal-timestamp tie-break by the equal-timestamp
  test (the comparator uses `localeCompare` precisely so it has no
  third, uncoverable arm).
- Excluded from coverage, with reasons in `vitest.config.ts`:
  `src/index.ts` (listen-only bootstrap) and `src/**/*.types.ts`
  (interfaces only — they emit no JavaScript, nothing to measure).
  No core file is excluded.

**Frontend (100%):** the per-file table shows
`src/features/employees/types.ts` at 0% — it is a type-only file with
zero executable statements; v8 reports a synthetic empty entry for it.
It contributes nothing to the totals. The only exclusion is
`src/app/layout.tsx` (untestable Next.js root-layout boilerplate:
metadata + static nav, no application logic).
