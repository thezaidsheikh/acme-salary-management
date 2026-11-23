# Testing & Coverage — backend (measured at this point in history)

Tests are fast, deterministic and easy to understand — no live database
is needed for the unit/API suites. The live-Postgres path is verified
separately by the seed + smoke test (see `docs/VERIFICATION.md`).

## How to run

```bash
cd backend && npm test              # unit + API tests
cd backend && npm run coverage      # same, with a coverage report
cd backend && npx tsx scripts/verify-pgmem.ts   # migration + 10k seed + HTTP smoke, no Postgres server
```

## Coverage — backend, measured on this branch

| Package | Tests | Lines | Branches | Functions | Statements |
|---|---|---|---|---|---|
| Backend | 80 passed, 10 files | 99.73% | 98.97% | 100% | 99.73% |

Thresholds are enforced at 90% in `backend/vitest.config.ts` — the run
fails if coverage drops below them.

Frontend coverage is measured after the frontend branches land; the full
table (backend + frontend) is in the final version of this file, committed
with the artifacts. See `git log` for the branch that updates it.

## What is tested (backend, 80 tests)

- Validation — every Zod schema error path (bad email/level/date,
  salary ≤ 0, missing/short reason, page 0, pageSize > 100, bad sort).
- Analytics maths — median (odd/even/empty/single), average, `toUsd`
  (including unknown currency), distribution buckets, outliers
  (none/some), top earners with fewer than 10 employees.
- Seed determinism — same seed → same employees; 10,000 rows, 10,000
  unique emails; salaries in band.
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

## Gaps — exactly what is below 100% and why

- `src/seed/employeeFactory.ts` 96.82% lines / 91.66% branches —
  lines 45–46, the `pickWeighted` fallback: genuinely unreachable.
  `LEVEL_WEIGHTS` sums to exactly 1.0 and `rng()` is in [0, 1), so an
  index is always picked inside the loop. Defensive code only.
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
