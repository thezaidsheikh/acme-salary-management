# Design Patterns & Principles — where each one lives

Every pattern below is implemented in the code, not just named. Each entry
gives the location, why it was used, and a short example.

## Repository pattern

- **Where:** `backend/src/modules/employees/employee.repository.ts` —
  `EmployeeRepository` (interface), `PgEmployeeRepository`,
  `InMemoryEmployeeRepository`; `backend/src/modules/bands/bands.repository.ts` —
  `BandRepository` (interface), `PgBandRepository`,
  `InMemoryBandRepository` (defaults to the same bands the seed uses).
  The employees interface also carries the two bulk methods the CSV
  import needs — `existingEmails` (one lookup for the duplicate check)
  and `createMany` (one multi-row INSERT, all rows or none) — so the
  import's transaction behaviour is a repository contract, not a
  service workaround, and both implementations (Pg + InMemory) prove
  the same atomicity in tests. It also carries `listAuditLog`, the
  company-wide audit read: one `JOIN salary_history + employees`,
  newest first, paged — because the history table's owner is this
  repository, the audit module reads through it instead of growing a
  second repository over the same table. There is deliberately no
  `AuditRepository` class: the audit module writes nothing, so a
  second store would only be a second place to keep the same truth.
- **Why:** only the repository knows SQL. Services and tests depend on the
  interface, so the database can change (or be faked in tests) without
  touching business logic. The bands repository is the same pattern a
  second time: `BandService` never knows whether bands come from the
  `salary_bands` table or from memory.
- **Example:**
  ```ts
  // Service code never sees SQL — it only sees the interface:
  constructor(private repo: EmployeeRepository) {}
  const employee = await this.repo.getById(id);
  ```

## Service layer

- **Where:** `modules/employees/employee.service.ts` (`EmployeeService`),
  `modules/salary/salary.service.ts` (`SalaryService`),
  `modules/analytics/analytics.service.ts` (`AnalyticsService`,
  pure `computeAnalytics`), `modules/bands/bands.service.ts`
  (`BandService`, pure `classifySalary`),
  `modules/audit/audit.service.ts` (`AuditService`).
- **Why:** business rules live in exactly one place. Example: "a salary
  change must differ from the current salary and must be audited" is
  enforced in `SalaryService`, so no controller, UI or test can bypass it.
  The band rule is the same shape: "compa-ratio is salary ÷ band
  midpoint, classified below/within/above" lives in `classifySalary`,
  so the employee list, the detail page, the salary change and the
  analytics summary can never disagree about a position.
  The import rule is the same shape: "every CSV row is validated with
  the single-create schema, duplicates are reported, valid rows insert
  together" lives in `EmployeeService.importEmployees`, so no
  controller, UI or test can import a row the create endpoint would
  reject. The audit rule is the same shape again: "the company-wide log
  is newest first, server-paged, in the same `{ data, meta }` envelope
  as the employee list" lives in `AuditService.list`, so the page and
  the API can never disagree about ordering or paging.
- **Example:**
  ```ts
  if (input.newSalary === current.baseSalary)
    throw badRequest("newSalary must differ from the current salary");
  ```

## Thin Controller

- **Where:** `modules/*/ *.controller.ts` (e.g.
  `modules/salary/salary.controller.ts`).
- **Why:** a controller only validates input, calls one service method and
  shapes the response. If a controller grows past that, the rule belongs
  in the service.
- **Example:**
  ```ts
  updateSalary: async (req, res) => {
    const input = parseWithSchema(updateSalarySchema, req.body);
    res.json({ data: await service.updateSalary(req.params.id, input) });
  }
  ```

## Dependency Injection (constructor injection)

- **Where:** all five services take their repositories in the
  constructor, and the employees, salary and analytics services also
  take a `BandService`; module factories (`modules/*/ *.factory.ts`)
  receive a `Pool | EmployeeRepository` and build a bands service from
  the same input when the caller does not pass one; `app.ts`
  (composition root) builds one bands module and shares its service.
  The audit service takes only the `EmployeeRepository` — it needs no
  band data, so it takes no `BandService` (a dependency it does not
  use would be a lie about what the module needs).
- **Why:** a class never creates its own dependencies, so tests can inject
  `InMemoryEmployeeRepository` and production injects the `pg` one — same
  code, different wiring. Sharing one `BandService` (instead of each
  module building its own) means every response classifies against the
  same band rows.
- **Example:**
  ```ts
  // modules/employees/employee.factory.ts (actual code):
  export function createEmployeeModule(poolOrRepo: Pool | EmployeeRepository, bandsService?: BandService) {
    const repository = resolveRepository(poolOrRepo); // Pool -> Pg repo, or use the given repo
    const bands = bandsService ?? createBandsModule(poolOrRepo).service;
    const service = new EmployeeService(repository, bands);
    return { router: createEmployeeRouter(service), service };
  }
  ```

## Factory pattern

- **Where:** `backend/src/seed/employeeFactory.ts` —
  `createSeedEmployee(rng, index, usedEmails, managerIds)`; and the
  module factories above (`createEmployeeModule`, `createSalaryModule`,
  `createAnalyticsModule`, `createBandsModule`, `createAuditModule`).
- **Why:** creating a seed employee involves email-uniqueness, level
  weighting, salary bands and manager links. The factory hides that
  construction so `generateEmployees` stays a short loop.
- **Example:**
  ```ts
  const employee = createSeedEmployee(rng, i, usedEmails, managerIds);
  ```

## SOLID — one example per letter, all in this codebase

| Letter | Principle | Where + example |
|---|---|---|
| S | Single Responsibility | `modules/salary/` owns only salary changes; `modules/analytics/` owns only dashboard maths; `modules/bands/` owns only bands and compa-ratio; `modules/audit/` owns only the company-wide read of the history — it writes nothing, so a write rule change touches the salary module and never the audit one. A salary rule change touches one module. |
| O | Open/Closed | Add a new repository (e.g. a cached one) by implementing `EmployeeRepository` — `EmployeeService` does not change. |
| L | Liskov Substitution | `InMemoryEmployeeRepository` substitutes for `PgEmployeeRepository` in every API/service test (`createApp(new InMemoryEmployeeRepository())`) with no test-code change. |
| I | Interface Segregation | Services depend on the small `EmployeeRepository` interface (list/get/create/createMany/existingEmails/updateSalary/points/export/listAuditLog), not on the whole `pg` `Pool` API. |
| D | Dependency Inversion | `SalaryService` depends on the `EmployeeRepository` interface (imported via `modules/employees/index.ts`), never on `PgEmployeeRepository` or SQL. `EmployeeService`, `SalaryService` and `AnalyticsService` all depend on the `BandService` interface the same way — none of them knows the `salary_bands` table exists. |

## DRY — Don't Repeat Yourself

- **Where:** `frontend/src/shared/lib/constants.ts` (departments,
  countries, levels listed once, imported by Employees + AddEmployee);
  `backend/src/shared/analytics.ts` (median/average/pagination used by
  services and tests); one error envelope in `shared/http.ts`; one
  `BandService` shared by the employees, salary and analytics services
  instead of three copies of the compa-ratio maths.
- **Example:** the country→currency map exists once in `constants.ts`;
  AddEmployee derives the currency from it instead of hard-coding it.
  The CSV side is the same idea twice over: one column list
  (`EMPLOYEE_CSV_COLUMNS` in `modules/employees/employee.csv.ts`) is
  shared by the export header and the import header check, so the two
  can never drift apart; and one Zod schema (`createEmployeeSchema`)
  validates the single-create body and every import row, so there is
  no second validation to keep in sync. The audit side is the same idea
  a third time: one pagination helper (`paginationMeta` in
  `shared/analytics.ts`) builds the `{ total, page, pageSize, totalPages }`
  envelope for the employee list and the audit log, and one history
  table serves both the per-employee history and the company-wide log —
  there is no second audit store to keep in sync with the first.

## KISS — Keep It Simple, Stupid

- **Where:** plain tables + CSS bars instead of a chart library;
  `pg` + one SQL migration instead of an ORM; client components in
  Next.js instead of SSR data fetching for dynamic HR data; a ~70-line
  RFC 4180 CSV parser (`modules/employees/employee.csv.ts`) instead of
  a CSV library — quoted commas, doubled quotes, CRLF and blank lines
  are the whole problem, and a library would be a dependency for a
  solved 70 lines. The one new dependency is multer (multipart upload),
  the standard Express choice — see `docs/TRADEOFFS.md`.
- **Why:** every added dependency is a failure mode and a thing to learn.
  The brief explicitly says it is not looking for the most complex system.

## YAGNI — You Aren't Gonna Need It

- **Where:** no auth, no payroll/tax, no leave, no live FX, no chatbot,
  no Redis cache, no materialised views — all listed as out of scope in
  `docs/REQUIREMENTS.md` with reasons.
- **Example:** a cache was not added because Postgres answers these
  queries in milliseconds at 10k rows; it would add stale-data risk for
  no measured gain.
