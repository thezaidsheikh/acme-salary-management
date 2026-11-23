import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { applyMigration, MIGRATION_FILE, MIGRATION_PATH } from "../scripts/migrate";

/** A throwaway pg-mem pool — no real Postgres, no psql CLI needed. */
function memPool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new Pool() as unknown as import("pg").Pool;
}

describe("migrate (pg-mem, no real Postgres, no psql)", () => {
  it("creates employees + salary_history from the real 001_init.sql", async () => {
    expect(MIGRATION_FILE).toBe("migrations/001_init.sql");
    expect(MIGRATION_PATH.endsWith("migrations/001_init.sql")).toBe(true);
    const pool = memPool();
    await applyMigration(pool);

    // Tables exist and start empty.
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM employees");
    expect(rows[0].c).toBe(0);

    // The real schema works end to end: insert an employee, then a
    // history row pointing at them (foreign key), and read it back.
    await pool.query(
      `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, date_of_joining, base_salary)
       VALUES ('11111111-1111-1111-1111-111111111111','Priya','Sharma','priya@example.com','Engineering','India','INR','Engineer','Senior','2020-01-01',150000)`,
    );
    await pool.query(
      `INSERT INTO salary_history (id, employee_id, old_salary, new_salary, currency, reason, changed_by)
       VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',150000,165000,'INR','Annual appraisal','HR Manager')`,
    );
    const history = await pool.query("SELECT COUNT(*)::int AS c FROM salary_history");
    expect(history.rows[0].c).toBe(1);

    // The CHECK constraint from the real file is enforced: salary 0 is rejected.
    await expect(
      pool.query(
        `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, date_of_joining, base_salary)
         VALUES ('33333333-3333-3333-3333-333333333333','Asha','Verma','asha@example.com','Engineering','India','INR','Engineer','Junior','2021-01-01',0)`,
      ),
    ).rejects.toThrow();
    await pool.end();
  });

  it("throws a clear error for a missing migration file", async () => {
    const pool = memPool();
    await expect(applyMigration(pool, "/does/not/exist/001_init.sql")).rejects.toThrow(/ENOENT/);
    await pool.end();
  });
});
