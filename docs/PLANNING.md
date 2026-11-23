# Planning & design notes

How this solution was planned, in the order the work actually happened.
Each step maps to a branch in `git log --graph` — one branch per feature,
merged into `main` with `--no-ff`, so the history shows the evolution.

## 1. Read the brief first (before any code)

The assessment doc ("Assessment with Product Framing") asks for salary
management software for 10,000 employees, HR Manager persona, ACME org
currently on Excels. It does NOT give a feature list, data model, fields,
API endpoints or UI screens — the candidate defines the scope. It DOES
require: a one-page requirements doc written BEFORE building, backend +
UI end to end, a relational DB, a seed script with 10,000 employees,
incremental commits, meaningful fast/deterministic tests, and artifacts.
No deadline is stated; fast submissions are prioritised. Deployment +
video demo are part of "readiness" (phase 2 here, honestly marked).

## 2. Decide the scope (candidate-defined)

Core question the software must answer: "how does the org pay people?"
So the scope is: employees list (search/filter/sort/paginate), employee
detail + salary history, salary change (validated + audited), add
employee, analytics dashboard (headcount, payroll, avg/median, breakdowns
by dept/country/level, distribution, top earners, outliers), CSV export.
Deliberately OUT (with reasons in `docs/REQUIREMENTS.md`): payroll
processing/tax, auth/RBAC, leave/attendance, live currency conversion,
AI chatbot. Reason: the assessment is about salary *management and
insight*, not a full HRMS — extra surface would lower quality.

## 3. Choose the stack (why, in one line each)

- **Backend Node.js + TypeScript + Express** — the role applied for is
  Node/React/TypeScript; Express is the smallest thing that fits, with a
  clean layered structure on top of it.
- **PostgreSQL 16 via `pg` + plain SQL migration** — relational, indexed
  filtering over 10,000 rows, transactions for salary+history. Prisma was
  the first choice but its engine binaries are unreachable in this VM
  (see `docs/TRADEOFFS.md`); `pg` keeps the same schema and indexes.
- **Frontend Next.js 14 (App Router) + React 18 + Tailwind** — the doc
  allows ReactJS or NextJS; Next.js was chosen for file routing, layouts,
  metadata and production conventions.
- **Vitest (+ Supertest, Testing Library), v8 coverage, 90% threshold**
  — fast, deterministic, no live DB needed for the unit/API suites.

## 4. Design the architecture (modular monolith)

One repo, two packages, one Postgres, one deployable backend. Backend
split into modules (`employees`, `salary`, `analytics`) + a shared kernel
(`db`, `errors`, `http`, `analytics`) + `seed/`. Each module owns its
routes/controller/service/repository and is imported only via its
`index.ts` public API; modules talk through interfaces, never another
module's tables. That is what makes a module extractable into a
microservice later without a rewrite (see `docs/ARCHITECTURE.md`).
Frontend mirrors it: `app/` routes, `features/employees/` (typed API
client), `shared/` (components, constants, utils).

## 5. Data model (before the seed)

- `employees`: id, first/last name, email (unique), department, country,
  currency, job title, level, manager (self-ref), date of joining,
  employment status, current base salary.
- `salary_history`: employee, old salary, new salary, currency, reason,
  changed by, changed at. Every salary change writes one row here in the
  same transaction as the salary update — never a silent overwrite.
- Indexes on department, country, level, base salary, email and name,
  because those are exactly the list/search/sort paths.

## 6. Build order (branches, in dependency order)

Requirements → scaffold → seed (10,000, deterministic) → employees
module → salary module → analytics module → composition root (wires the
modules) → coverage check → Next.js setup → shared UI + API client →
dashboard → employees list → employee detail → add employee →
architecture/patterns docs → artifacts → README. Tests travel with the
feature they test, in the same branch. Each branch is merged with
`--no-ff` so the branch stays visible in history.

## 7. Risks that were checked, not assumed

- Seed must be exactly 10,000 with unique emails — asserted in tests
  and by `SELECT COUNT(*)`.
- Salary update must be atomic — transaction tested with pg-mem,
  including rollback on failure.
- 10,000 rows must never load into the browser at once — server-side
  pagination (20/page) + debounced search, tested.
- Coverage must be real, not inflated — no core file excluded; the two
  sub-100% spots are documented with reasons in `docs/TESTING.md`.
- History must show evolution — branch-per-feature merges, no squash,
  no single giant commit; the one big commit from the first repo was
  deliberately split into 12 feature commits there, and this repo was
  built branch-per-feature from the start.
