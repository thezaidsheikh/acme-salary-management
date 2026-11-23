import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMigration, applyMigrations, MIGRATION_FILE, MIGRATION_FILES, MIGRATION_PATH, MIGRATION_PATHS } from "../scripts/migrate";
import { memPool } from "./pgmem";

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

describe("applyMigrations (pg-mem, real 001 + 002)", () => {
  it("applies 001 then 002 in order and seeds the six salary bands", async () => {
    expect(MIGRATION_FILES).toEqual(["migrations/001_init.sql", "migrations/002_salary_bands.sql"]);
    const pool = memPool();
    try {
      const applied = await applyMigrations(pool);
      expect(applied).toEqual(["001_init.sql", "002_salary_bands.sql"]);
      const { rows } = await pool.query(
        "SELECT level, min_salary, mid_salary, max_salary FROM salary_bands ORDER BY min_salary ASC",
      );
      expect(rows).toEqual([
        { level: "Junior", min_salary: 1500, mid_salary: 2000, max_salary: 2500 },
        { level: "Mid", min_salary: 2500, mid_salary: 3500, max_salary: 4500 },
        { level: "Senior", min_salary: 4500, mid_salary: 6000, max_salary: 7500 },
        { level: "Lead", min_salary: 7500, mid_salary: 8750, max_salary: 10000 },
        { level: "Manager", min_salary: 9000, mid_salary: 11000, max_salary: 13000 },
        { level: "Director", min_salary: 12000, mid_salary: 15000, max_salary: 18000 },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("002 is idempotent: re-running its seed insert adds no duplicate bands", async () => {
    // Same pg-mem limitation as 001 (see migrate-idempotent.test.ts):
    // pg-mem cannot re-plan a CREATE TABLE IF NOT EXISTS for a table
    // with an enum column + CHECK constraints, so the whole file cannot
    // be re-applied here. On real Postgres the whole file re-runs fine
    // (IF NOT EXISTS + ON CONFLICT DO NOTHING). What this test proves
    // is the part that matters for data: re-running the seed INSERT
    // inserts nothing new, because of ON CONFLICT (level) DO NOTHING.
    const pool = memPool();
    try {
      await applyMigrations(pool);
      const sql = readFileSync(MIGRATION_PATHS[1], "utf8");
      const insert = sql.match(/INSERT INTO salary_bands[\s\S]*?ON CONFLICT \(level\) DO NOTHING;/);
      expect(insert).not.toBeNull();
      await pool.query(insert![0]);
      const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM salary_bands");
      expect(rows[0].c).toBe(6);
    } finally {
      await pool.end();
    }
  });

  it("002 guards its table and seed rows (IF NOT EXISTS + ON CONFLICT DO NOTHING)", () => {
    const sql = readFileSync(MIGRATION_PATHS[1], "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS salary_bands");
    expect(sql).toContain("ON CONFLICT (level) DO NOTHING");
  });
});
