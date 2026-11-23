// Seed script — inserts exactly 10,000 deterministic employees.
//
// Idempotent on purpose: a redeploy (or a second run) must NOT wipe data
// a recruiter may have changed. Without --force, the script skips when
// the employees table already holds exactly 10,000 rows, and refuses
// when it holds a different non-zero count (e.g. 10,001 after someone
// added an employee) — pass --force to wipe and re-seed in that case.
// Usage: cd backend && npm run seed [-- --force]
//        (the extra `--` forwards the flag through npm to this script)
// The seed is deterministic (seed 42), so a re-seed reproduces the same
// 10,000 employees every time.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { pool } from "../src/shared/db.js";
import { generateEmployees } from "../src/seed/seedData.js";

/** How many employees the seed creates (the assessment requires 10,000). */
export const SEED_TOTAL = 10_000;

/**
 * Count the rows currently in the employees table.
 * @param db Pool to query (real Postgres, or pg-mem in tests).
 * @returns The current employee count.
 */
export async function countEmployees(db: Pool): Promise<number> {
  const { rows } = await db.query("SELECT COUNT(*)::int AS c FROM employees");
  return rows[0].c as number;
}

/**
 * Seed the employees table — or skip, if it is already seeded.
 * @param db Pool to seed (real Postgres, or pg-mem in tests).
 * @param force When true, wipe (DELETE) and re-seed even if data exists.
 * @param total How many employees to create; defaults to SEED_TOTAL (10,000).
 * @returns Whether a seed happened, and the final employee count.
 * @throws When the table holds a non-zero count other than `total` and
 * `force` is false — refusing is safer than silently wiping edits.
 */
export async function seedEmployees(
  db: Pool,
  force = false,
  total: number = SEED_TOTAL,
): Promise<{ seeded: boolean; count: number }> {
  const existing = await countEmployees(db);
  if (existing === total && !force) {
    console.log(
      `Already seeded: ${existing} employees — skipping (pass --force to re-seed).`,
    );
    return { seeded: false, count: existing };
  }
  if (existing > 0 && existing !== total && !force) {
    throw new Error(
      `employees table has ${existing} rows (expected 0 or ${total}). ` +
        "Pass --force to wipe and re-seed.",
    );
  }
  const started = Date.now();
  const employees = generateEmployees(total, 42);
  const ids = employees.map(() => randomUUID());
  console.log(`Generated ${employees.length} employees, clearing old data…`);
  // DELETE, not TRUNCATE: employees is self-referencing (manager_id
  // points at employees), so TRUNCATE needs CASCADE — and pg-mem, used
  // by the tests, recurses forever on CASCADE for a self-referencing
  // table (and does not support multi-table TRUNCATE either). DELETE
  // is FK-safe because salary_history (the child) is emptied first,
  // and it is behaviourally identical here: both tables use UUID keys,
  // so there is no identity sequence for TRUNCATE to reset.
  await db.query("DELETE FROM salary_history");
  await db.query("DELETE FROM employees");
  const BATCH = 1000;
  for (let i = 0; i < employees.length; i += BATCH) {
    const batch = employees.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders = batch
      .map((e, j) => {
        const o = j * 12;
        values.push(
          ids[i + j],
          e.firstName,
          e.lastName,
          e.email,
          e.department,
          e.country,
          e.currency,
          e.jobTitle,
          e.level,
          e.managerId ? ids[Number(e.managerId.replace("emp-", ""))] : null,
          e.dateOfJoining,
          e.baseSalary,
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
      })
      .join(",");
    await db.query(
      `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, manager_id, date_of_joining, base_salary) VALUES ${placeholders}`,
      values,
    );
    console.log(`  inserted ${Math.min(i + BATCH, employees.length)}/${employees.length}`);
  }
  const count = await countEmployees(db);
  console.log(`Seeded ${count} employees in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (count !== total) throw new Error(`Expected ${total} employees, got ${count}`);
  return { seeded: true, count };
}

/**
 * CLI entry point: `--force` wipes and re-seeds; without it, an already
 * seeded database is left untouched. Only runs when this file is executed
 * directly (`npm run seed`); importing it from a test never connects.
 */
async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  try {
    await seedEmployees(pool, force);
  } catch (e) {
    console.error(e);
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
