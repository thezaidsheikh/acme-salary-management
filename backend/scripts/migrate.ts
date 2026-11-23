// Migration runner — no psql CLI needed.
//
// Why this file exists: `npm run migrate` used to shell out to `psql`,
// but a running Postgres server does NOT mean the `psql` command-line
// tool is on your PATH (common on Mac with Postgres.app, Docker Postgres,
// or Homebrew without its bin dir in PATH). The Node `pg` driver already
// speaks the Postgres wire protocol, so the migration can run through
// the same pool the app itself uses. Same SQL file, same database,
// one less tool to install.
// Usage: cd backend && npm run migrate   (reads DATABASE_URL from .env)
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { pool } from "../src/shared/db.js";

/** Migration file, relative to the backend/ directory. */
export const MIGRATION_FILE = "migrations/001_init.sql";

/** Absolute path of the migration file, resolved from this script's location. */
export const MIGRATION_PATH = fileURLToPath(new URL(`../${MIGRATION_FILE}`, import.meta.url));

/**
 * Every migration file, in the order they must be applied. 002 reuses
 * the `level` enum created by 001, so numeric order is load-bearing —
 * never apply 002 on a database that has not run 001.
 */
export const MIGRATION_FILES = ["migrations/001_init.sql", "migrations/002_salary_bands.sql"];

/** Absolute paths of all migration files, resolved like MIGRATION_PATH. */
export const MIGRATION_PATHS = MIGRATION_FILES.map((f) =>
  fileURLToPath(new URL(`../${f}`, import.meta.url)),
);

/**
 * Apply the SQL migration file to the given pool.
 * The file is read fresh on every call, so tests can point at the real
 * `001_init.sql` and prove the tables it creates actually exist.
 * @param db Pool to run the migration against (real Postgres, or pg-mem in tests).
 * @param migrationPath Absolute path of the .sql file; defaults to the real migration.
 */
export async function applyMigration(db: Pool, migrationPath: string = MIGRATION_PATH): Promise<void> {
  const sql = readFileSync(migrationPath, "utf8");
  await db.query(sql);
}

/**
 * Apply every migration file, in numeric order (001, then 002, …).
 * Each file is idempotent on its own, so re-running the whole set on an
 * already-migrated database is safe. A later file may depend on an
 * earlier one (002 uses 001's `level` enum), which is why the order is
 * fixed here instead of left to the caller.
 * @param db Pool to run the migrations against (real Postgres, or pg-mem in tests).
 * @param migrationPaths Absolute paths of the .sql files; defaults to all real migrations.
 * @returns The relative file names that were applied, in order.
 */
export async function applyMigrations(
  db: Pool,
  migrationPaths: string[] = MIGRATION_PATHS,
): Promise<string[]> {
  const applied: string[] = [];
  for (const p of migrationPaths) {
    await applyMigration(db, p);
    applied.push(path.basename(p));
  }
  return applied;
}

/**
 * One-line description of a failure for the CLI output.
 * `pg` wraps connection failures in an AggregateError whose own message
 * is empty — the real cause (e.g. "connect ECONNREFUSED 127.0.0.1:5432")
 * lives in its `errors` list, so unwrap it instead of printing nothing.
 */
function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
    const code = (error as { code?: string }).code;
    return [code, inner].filter(Boolean).join(": ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * CLI entry point: check DATABASE_URL, run the migration on the shared
 * pool, print what was applied, and exit non-zero on any failure.
 * Only runs when this file is executed directly (`tsx scripts/migrate.ts`);
 * importing it from a test only loads `applyMigration` and never connects.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy backend/.env.example to backend/.env " +
        "and set DATABASE_URL to your running Postgres (e.g. postgres://acme:acme123@localhost:5432/salary_management).",
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }
  try {
    const applied = await applyMigrations(pool);
    for (const f of applied) console.log(`Migration applied: ${f}`);
  } catch (error) {
    console.error(
      "Migration failed: could not apply",
      MIGRATION_FILES.join(", "),
      "— check that Postgres is running and DATABASE_URL is correct.",
      `(${describeError(error)})`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invoked === selfPath) {
  await main();
}
