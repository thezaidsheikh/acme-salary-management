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

## Coverage — measured 23 Nov 2026 (re-run after the rework)

| Package | Tests | Lines | Branches | Functions | Statements |
|---|---|---|---|---|---|
| Backend | 103 passed, 14 files | 99.75% | 99.06% | 100% | 99.75% |
| Frontend (Next.js) | 62 passed, 9 files | 100% | 100% | 100% | 100% |

Thresholds are enforced at 90% in both `vitest.config.ts` files — the
run fails if coverage drops below them.

## What is tested

**Backend (103 tests):**
- Validation — every Zod schema error path (bad email/level/date,
  salary ≤ 0, missing/short reason, page 0, pageSize > 100, bad sort).
- Analytics maths — median (odd/even/empty/single), average, `toUsd`
  (including unknown currency), distribution buckets, outliers
  (none/some), top earners with fewer than 10 employees.
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
  edges, missing ids); Pg repository against pg-mem (real migration +
  real SQL: create, list, get, salary update with history).
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

**Frontend (62 tests):**
- Utils — `formatMoney`/`formatDate` (including unknown-currency
  fallback), constants.
- Components — `StatCard`, `BarList` (rows, widths, empty list).
- API client — all endpoints, error-envelope handling, export URL.
- Pages (mocked API) — Dashboard loading/error/loaded; Employees
  loading/empty/error, filters, sort, pagination buttons; EmployeeDetail
  loading/error, every salary-form validation error, success path;
  AddEmployee validation errors and success navigation.

## Gaps — exactly what is below 100% and why

**Backend (99.75% lines):**
- `src/seed/employeeFactory.ts` 96.82% lines / 91.66% branches —
  lines 45–46, the `pickWeighted` fallback `return weights.length - 1`:
  genuinely unreachable. `LEVEL_WEIGHTS` sums to exactly 1.0 and
  `rng()` is in [0, 1), so an index is always picked inside the loop.
  Defensive code only.
- `src/modules/employees/employee.repository.ts` 100% lines / 98.38%
  branches — line 238, the synthetic V8 branch on `} finally {` in
  `PgEmployeeRepository.updateSalary`. Both paths execute
  `client.release()` (success via pg-mem COMMIT; failure via a fake-pool
  test asserting release after UPDATE + ROLLBACK both throw). V8 never
  counts this synthetic branch; it is not a real gap.
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
