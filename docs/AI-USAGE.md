# How AI was used

AI was used as a drafting and acceleration tool, exactly as the assessment requires — it did **not** build this solution unattended. The division of labour was: **AI drafted first versions from the candidate's instructions; the candidate owned the decisions, the review, the local runs, and the verification.** Every AI draft was checked against the brief and run before it was kept. Nothing in this repo was submitted on AI's say-so alone.

## What the candidate did manually

- **Read the assessment and defined the scope.** The candidate read the 3-page "Assessment with Product Framing" doc, then wrote the one-page requirements doc (`docs/REQUIREMENTS.md`, first commit, before any code) — goal, HR Manager persona, scope and features, data model (`Employee` + `SalaryHistory`), and what is deliberately out of scope with reasons (payroll/tax, auth, leave, live FX, AI chatbot).
- **Chose the stack and architecture.** Next.js over Vite, PostgreSQL over SQLite, modular monolith over microservices, `pg` over Prisma — each choice with a written reason and a rejected alternative in `docs/TRADEOFFS.md` and `zaid-docs/01-decisions.md`.
- **Reviewed every AI draft against the brief, line by line.** The requirements doc was checked against each line of the assessment before building started; later drafts were checked the same way (see `docs/VERIFICATION.md`, where no requirement is marked covered without a file or a measured number as evidence).
- **Ran the app locally and directed the fixes for real failures.** On his own Mac (Docker Postgres) the candidate ran the app, hit `psql: command not found` on `npm run migrate` (Postgres was running in Docker, the `psql` CLI was not on PATH), and hit the CORS origin error (frontend opened at `127.0.0.1:3000` / Next.js on port 3001, backend allowed only `localhost:3000`). He directed both fixes — migrate through the Node `pg` driver (`backend/scripts/migrate.ts`, branch `fix/migrate-without-psql`) and a CORS allow-list (`backend/src/shared/cors.ts`, branch `fix/cors-origins`) — and verified each fix by running the app again.
- **Directed the two big pivots.** The Prisma → `pg` pivot, after the binary-download failure was verified with curl (`binaries.prisma.sh` returned 404, `prisma generate` failed with ECONNRESET). And the Vite → Next.js rework, including the decision to split the one 97-file commit into feature-level commits and then rebuild the whole solution as a new branch-per-feature repo (`acme-salary-management`, 17 branches, each merged with `--no-ff`).
- **Reviewed each feature branch before it was merged.** Branch-per-feature history (see `git log --graph`) — no branch was merged without its tests and a build run.
- **Verified by hand, not by trusting a report.** Tests, builds, seed count and smoke tests were run and the numbers checked (see "What was verified by hand" below) — including reading actual test output to fix failures instead of weakening the test (the INR formatting expectation was fixed by reading what the formatter really produced; the `AggregateError` blank-message bug in `migrate.ts` was found during verification and fixed by unwrapping the inner errors).

## What AI did

AI did drafting assistance only, from the candidate's instructions:

- Drafted the first version of the requirements text from the assessment brief, which the candidate then reviewed line by line and corrected.
- Drafted first versions of the repo scaffold, the layered backend, the seed generator, and the pages — each draft was then reviewed, corrected, and verified by running it; several drafts were rejected or reworked (Prisma → `pg`, Vite → Next.js).
- Drafted the first version of the tests; the failing ones (e.g. the INR formatting expectation) were fixed by reading the actual output, not by weakening the test.
- Drafted the docs (architecture, trade-offs, performance, testing) from the candidate's decisions — the decisions themselves were the candidate's (see "What the candidate did manually" above).

## Prompts / instructions used (summary)

- "Build the Incubyte Salary Management assessment end-to-end, Node.js + TypeScript + Express + PostgreSQL, React + Vite, with a one-page requirements doc first, incremental git commits, deterministic seed of exactly 10,000 employees, salary changes always audited, server pagination, and fast deterministic tests."
- "Document every decision with WHY, not just WHAT, so the candidate can answer recruiter questions."
- "Keep scope tight: payroll, auth, leave and live FX are out — with reasons."
- Rework (23 Nov): "Migrate the frontend from Vite to Next.js (App Router) — the assessment allows ReactJS or NextJS and the user chose Next.js. Restructure the backend as a modular monolith (modules/employees, salary, analytics + shared kernel) so a module can later be extracted into a microservice. Coverage 90%+ (core 100%), JSDoc on every public method, design patterns/principles implemented and documented, README + docs complete, everything cross-verified. Keep the candidate in the loop with short gitignored notes (`zaid-docs/`) explaining every decision with an example."
- "Clarify EVERY point of the assessment document in `zaid-docs/09-assessment-points-clarified.md` — what the doc says, what it means, what was done for it (file/feature), and what to say if a recruiter asks. Mark honestly what is phase 2 (deployment + video demo)."

## What was verified by hand (not trusted from AI)

- `npm test` in backend (90 tests) and frontend (62 tests) — run, green.
  Coverage re-run after the rework: backend 99.74% lines / 99.01%
  branches / 100% functions; frontend 100% (see `docs/TESTING.md` for
  the exact gaps below 100%).
- `npm run build` in both packages — run, green (Next.js: 6 routes,
  First Load JS 90–99 kB).
- Seed count and determinism — asserted in tests (`generateEmployees(10000, 42)` = 10,000 unique emails; same seed = same output) and by
  `SELECT COUNT(*)` = 10,000 on real Postgres 16.
- Salary audit — API test asserts a PATCH creates exactly one history row with old + new values; smoke-tested live (11,700 → 999,999, 1 history row).
- The Prisma → `pg` pivot: Prisma's engine binaries could not be downloaded in this VM (`binaries.prisma.sh` returned 404 via the egress proxy, verified with curl). The decision was to switch the data layer to `pg` (same Postgres, same schema/indexes, same repository interface) rather than pretend Prisma worked. See `docs/TRADEOFFS.md`.
- The Vite → Next.js migration was verified the same way: `next build`,
  62 frontend tests, and an `next start` smoke test (all four routes 200).
- The migrate fix was verified by running `npm run migrate` with no `DATABASE_URL` (clear error, exit 1), with an unreachable database (clear `ECONNREFUSED` reason, exit 1), and by 2 pg-mem tests that run the real `001_init.sql` and check the tables and constraints.
- The CORS fix was verified by curl against a real built backend: `OPTIONS` from `http://127.0.0.1:3000` → 204 with `Access-Control-Allow-Origin`, and an unknown origin (`http://evil.example`) gets no such header.
- Every claim in `docs/VERIFICATION.md` was re-checked against the
  actual code and measured output on 23 Nov 2026 — no requirement is
  marked covered without a file or a number as evidence.

## What AI did not do

- AI did not decide the scope, the stack, or the architecture — those were the candidate's decisions, written up with reasons in `docs/TRADEOFFS.md`.
- AI did not run the app on the candidate's machine, and did not diagnose the local Docker Postgres / `psql` failure or the CORS failure — the candidate found those by running the app and directed the fixes.
- AI did not choose to rebuild the repo branch-per-feature, split the big commit, or pick the branch names — the candidate directed that rebuild.
- No feature was added that is not in the requirements doc.
- No test was written to pass without asserting real behaviour.
- No credentials, no deployment, and no email were sent by AI.
- AI did not submit anything.

## This repo (acme-salary-management): branch-per-feature rebuild

The first repo was rebuilt from scratch as a new repo with a strict
branch-per-feature workflow: every feature, change, fix and refactor got
its own branch off `main`, was merged with `git merge --no-ff`, and the
branch was then deleted. The candidate directed the rebuild and the split
of the work into branches; AI drafted the branch plan outline, which the
candidate reviewed and corrected. Each merge was verified by running the
builds and tests. No code was copied as a whole tree — each branch copied
only the files that feature owns, from the verified first repo, file by file.

## Summary

**AI accelerated the drafting; the candidate owned the decisions, the review, the local runs, and the verification.**
