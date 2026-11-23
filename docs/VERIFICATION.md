# Verification — every requirement checked against the code

Re-checked 23 Nov 2026 for the new branch-per-feature repo (rebuilt from the verified first repo).
"Evidence" is the file or the measured result, not a claim.

## Assessment requirements (from `docs/REQUIREMENTS.md`, written first)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | One-page requirements doc written BEFORE building | ✅ | `docs/REQUIREMENTS.md` — branch `docs/requirements`, merged first, before any code branch |
| 2 | End-to-end backend + UI, fully functional | ✅ | Backend `backend/src/` + Next.js `frontend/src/app/`; smoke-tested below |
| 3 | Backend: Node.js + relational DB | ✅ | Node 24 + TypeScript + Express; PostgreSQL 16 via `pg` + `backend/migrations/001_init.sql` |
| 4 | UI: ReactJS or NextJS | ✅ | Next.js 14 (App Router) + React 18 + Tailwind 3, `frontend/` |
| 5 | Seed script, exactly 10,000 employees | ✅ | `backend/scripts/seed.ts` + `backend/src/seed/`; measured: `SELECT COUNT(*)` = 10,000, 10,000 distinct emails, 0.7–0.9 s; seed is idempotent (skips at 10,000, `--force` re-seeds) |
| 6 | Employees: searchable, filterable, sortable, server-paginated | ✅ | `GET /api/employees` + `frontend/src/app/employees/page.tsx`; 20/page default, max 100; search "Priya" = 132 |
| 7 | Employee detail + full salary history | ✅ | `GET /api/employees/:id`; `frontend/src/app/employees/[id]/page.tsx` |
| 8 | Salary change validated + audited (never silently overwritten) | ✅ | `modules/salary/`; PATCH validated (`newSalary > 0`, reason required), one transaction updates salary + inserts history; API test asserts exactly 1 history row |
| 9 | Add employee (validated create) | ✅ | `POST /api/employees`; `frontend/src/app/employees/new/page.tsx` |
| 10 | Analytics: headcount, payroll, avg/median, by dept/country/level, distribution, top 10, outliers | ✅ | `GET /api/analytics/summary` (`modules/analytics/`); measured on 10,000 rows: avg USD 4,555, median USD 3,587, 10 depts, 8 countries |
| 11 | CSV export respecting filters, streamed | ✅ | `GET /api/employees/export`; measured 10,001 lines (header + 10,000 rows), correct header |
| 12 | Meaningful, fast, deterministic tests | ✅ | Backend 93 tests, frontend 62 tests; see `docs/TESTING.md` (99.74% / 100% lines) |
| 13 | Incremental commits showing evolution | ✅ | Every feature/change/fix has its own branch off `main`, merged with `git merge --no-ff` — see `git log --graph` (no squash, no direct commits to `main` after the initial commit) |
| 14 | Artifacts committed | ✅ | `docs/REQUIREMENTS.md`, `PLANNING.md`, `ARCHITECTURE.md`, `DESIGN-PATTERNS.md`, `ENGINEERING-REVIEW.md`, `TRADEOFFS.md`, `PERFORMANCE.md`, `TESTING.md`, this file |
| 15 | Deployed software + video demo | ⏳ Phase 2 (backend live) | Backend LIVE at `https://acme-salary-api-droy.onrender.com` — `GET /api/health` returns `{"data":{"status":"ok"}}` (verified 23 Nov 2026). Seed NOT yet run (live DB: 0 employees — Render Shell needs a paid plan, free workaround planned next), frontend not yet deployed (Vercel URL TBD), video demo not yet recorded. Blueprint/deployment fixes in `render.yaml` + `docs/DEPLOYMENT.md` (free tier: no pre-deploy command; start command `node backend/dist/src/index.js`; migration now idempotent). The row flips to ✅ only when the live smoke checks in `docs/DEPLOYMENT.md` step 5 pass. |

## Rework verification (measured by hand, 23 Nov 2026)

- Backend: `npm run build` zero errors; `npm test` 93/93; `npm run coverage`
  99.73% lines / 98.97% branches / 100% functions.
- Frontend: `npm run typecheck` zero errors; `npm run build` clean
  (6 routes, First Load JS 90–99 kB); `npm test` 62/62; coverage 100%.
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
spec to "miss". The scope in `docs/REQUIREMENTS.md` (features 1–11
above) is the candidate-defined scope, with reasons for what was left
out. No deadline is stated in the doc; fast submissions are prioritised
per the email. Submission is by replying to the same email with the
repository link. The point-by-point evidence for every assessment
requirement is the table above; the engineering record is in
`docs/ENGINEERING-REVIEW.md`.
