import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigration, MIGRATION_PATH } from "../scripts/migrate";
import { memPool } from "./pgmem";

/**
 * Regression test for the live-deploy failure (Nov 2026): re-running
 * migrations/001_init.sql failed with `type "level" already exists`
 * because the CREATE TYPE statements had no guard — the file claimed to
 * be safe to re-run, but it was not. The types are now created inside
 * DO blocks that check pg_type first.
 *
 * Why this test does NOT apply the whole file twice: pg-mem cannot
 * re-plan `CREATE TABLE IF NOT EXISTS` for a table whose columns use
 * enum types with DEFAULT/CHECK constraints — verified by experiment
 * (a bare CREATE TABLE IF NOT EXISTS re-apply fails in pg-mem even
 * with plain CREATE TYPE statements and no DO blocks at all). That is
 * a pg-mem limitation, not a problem in the SQL: on real Postgres
 * `CREATE TABLE IF NOT EXISTS` re-runs fine, and every table/index
 * statement in the file already carries IF NOT EXISTS (asserted below).
 * So this test re-applies the part that actually broke — the type
 * guards — and proves the tables still work afterwards.
 */
describe("migration is idempotent (pg-mem, real 001_init.sql)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("guards both enums with an IF NOT EXISTS check on pg_type", () => {
    for (const type of ["level", "employment_status"]) {
      expect(sql).toContain(`WHERE typname = '${type}'`);
      expect(sql).toContain(`CREATE TYPE ${type} AS ENUM`);
    }
    // Both guards live in DO blocks (CREATE TYPE has no IF NOT EXISTS
    // in Postgres, so a DO block is the only way to guard it in SQL).
    expect(sql.match(/DO \$\$/g)?.length).toBe(2);
  });

  it("every CREATE TABLE and CREATE INDEX uses IF NOT EXISTS", () => {
    const bareTable = /^CREATE TABLE (?!IF NOT EXISTS)/m.test(sql);
    const bareIndex = /^CREATE INDEX (?!IF NOT EXISTS)/m.test(sql);
    expect(bareTable).toBe(false);
    expect(bareIndex).toBe(false);
  });

  it("re-applying the type guards succeeds and the tables still work", async () => {
    const pool = memPool();
    try {
      // Full migration, once — the baseline every other test relies on.
      await applyMigration(pool);

      // The exact failure from the deploy: run the type-creating part
      // of the file a second time. Before the DO-block fix this threw
      // `type "level" already exists`; now the guards skip the create.
      const doBlocks = sql.match(/DO \$\$[\s\S]*?END \$\$;/g);
      expect(doBlocks).toHaveLength(2);
      for (const block of doBlocks!) {
        await pool.query(block);
      }

      // Tables still work after the re-applied guards: insert an
      // employee using both enum types, plus one history row, and read
      // them back.
      await pool.query(
        `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, employment_status, date_of_joining, base_salary)
         VALUES ('11111111-1111-1111-1111-111111111111','Priya','Sharma','priya@example.com','Engineering','India','INR','Engineer','Director','OnLeave','2020-01-01',250000)`,
      );
      await pool.query(
        `INSERT INTO salary_history (id, employee_id, old_salary, new_salary, currency, reason, changed_by)
         VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',250000,275000,'INR','Annual appraisal','HR Manager')`,
      );
      const { rows } = await pool.query(
        "SELECT level, employment_status FROM employees WHERE email = 'priya@example.com'",
      );
      expect(rows[0]).toEqual({ level: "Director", employment_status: "OnLeave" });
      const history = await pool.query("SELECT COUNT(*)::int AS c FROM salary_history");
      expect(history.rows[0].c).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
