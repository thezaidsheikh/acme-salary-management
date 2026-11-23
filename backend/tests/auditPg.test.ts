import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { memPool } from "./pgmem";
import { createApp } from "../src/app";
import { PgEmployeeRepository } from "../src/modules/employees/employee.repository";
import type { Pool } from "pg";

// Live-SQL coverage of the audit-log read without a server: the real
// migration runs in pg-mem, history is written through the same
// updateSalary the PATCH endpoint uses, and the audit endpoint reads it
// back — the same JOIN the production database runs.
describe("GET /api/audit-log (pg-mem, real migration + real SQL)", () => {
  let app: ReturnType<typeof createApp>;
  let pool: Pool;
  let repo: PgEmployeeRepository;
  let priyaId: string;
  let rahulId: string;
  let meeraId: string;

  beforeAll(async () => {
    pool = memPool();
    const migration = readFileSync(new URL("../migrations/001_init.sql", import.meta.url), "utf8");
    await pool.query(migration);
    repo = new PgEmployeeRepository(pool);
    const priya = await repo.create({
      firstName: "Priya", lastName: "Sharma", email: "priya.sharma@acme.com", department: "Engineering",
      country: "India", currency: "INR", jobTitle: "Software Engineer", level: "Senior",
      managerId: null, dateOfJoining: new Date("2022-03-01"), baseSalary: 150000,
    });
    const rahul = await repo.create({
      firstName: "Rahul", lastName: "Verma", email: "rahul.verma@acme.com", department: "Design",
      country: "USA", currency: "USD", jobTitle: "Designer", level: "Mid",
      managerId: null, dateOfJoining: new Date("2021-06-15"), baseSalary: 8000,
    });
    const meera = await repo.create({
      firstName: "Meera", lastName: "Iyer", email: "meera.iyer@acme.com", department: "Engineering",
      country: "India", currency: "INR", jobTitle: "Software Engineer", level: "Mid",
      managerId: null, dateOfJoining: new Date("2023-01-09"), baseSalary: 110000,
    });
    priyaId = priya.id;
    rahulId = rahul.id;
    meeraId = meera.id;
    // Three changes through the real write path, then pin their
    // timestamps so newest-first ordering is exact (same-millisecond
    // writes would otherwise tie on changed_at).
    const h1 = (await repo.updateSalary(priyaId, 155000, "Annual appraisal", "HR Manager"))!.history;
    const h2 = (await repo.updateSalary(rahulId, 8300, "Promotion", "Anita Desai"))!.history;
    const h3 = (await repo.updateSalary(priyaId, 162000, "Market correction", "HR Manager"))!.history;
    await pool.query("UPDATE salary_history SET changed_at = $1 WHERE id = $2", ["2026-01-10T09:00:00.000Z", h1.id]);
    await pool.query("UPDATE salary_history SET changed_at = $1 WHERE id = $2", ["2026-02-15T09:00:00.000Z", h2.id]);
    await pool.query("UPDATE salary_history SET changed_at = $1 WHERE id = $2", ["2026-03-20T09:00:00.000Z", h3.id]);
    app = createApp(repo);
  });

  it("lists every change newest first with the joined employee name and department", async () => {
    const r = await request(app).get("/api/audit-log");
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBe(3);
    expect(r.body.data.map((x: { reason: string }) => x.reason)).toEqual([
      "Market correction",
      "Promotion",
      "Annual appraisal",
    ]);
    const newest = r.body.data[0];
    expect(newest.employeeName).toBe("Priya Sharma");
    expect(newest.department).toBe("Engineering");
    expect(newest.oldSalary).toBe(155000);
    expect(newest.newSalary).toBe(162000);
    expect(newest.currency).toBe("INR");
    expect(newest.changedBy).toBe("HR Manager");
  });

  it("paginates and filters by employee id, name and department", async () => {
    const p1 = await request(app).get("/api/audit-log?page=1&pageSize=2");
    const p2 = await request(app).get("/api/audit-log?page=2&pageSize=2");
    expect(p1.body.data).toHaveLength(2);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.data[0].reason).toBe("Annual appraisal");
    const byId = await request(app).get(`/api/audit-log?search=${priyaId}`);
    expect(byId.body.meta.total).toBe(2);
    const byName = await request(app).get("/api/audit-log?search=rahul");
    expect(byName.body.meta.total).toBe(1);
    expect(byName.body.data[0].employeeName).toBe("Rahul Verma");
    const byDept = await request(app).get("/api/audit-log?department=Design");
    expect(byDept.body.meta.total).toBe(1);
    expect(byDept.body.data[0].employeeName).toBe("Rahul Verma");
  });

  it("filters by date range, combined with the other filters", async () => {
    const feb = await request(app).get("/api/audit-log?from=2026-02-01&to=2026-02-28");
    expect(feb.body.meta.total).toBe(1);
    expect(feb.body.data[0].reason).toBe("Promotion");
    const combined = await request(app).get(
      `/api/audit-log?search=Priya&department=Engineering&from=2026-03-01&to=2026-03-31`,
    );
    expect(combined.body.meta.total).toBe(1);
    expect(combined.body.data[0].reason).toBe("Market correction");
    const none = await request(app).get("/api/audit-log?from=2025-01-01&to=2025-12-31");
    expect(none.body.meta.total).toBe(0);
    expect(none.body.data).toEqual([]);
  });

  it("a salary change made via PATCH appears on the audit page with the right old/new/reason", async () => {
    const patch = await request(app)
      .patch(`/api/employees/${meeraId}/salary`)
      .send({ newSalary: 125000, reason: "Annual appraisal", changedBy: "HR Manager" });
    expect(patch.status).toBe(200);
    expect(patch.body.data.history.oldSalary).toBe(110000);
    expect(patch.body.data.history.newSalary).toBe(125000);
    const r = await request(app).get("/api/audit-log?search=Meera");
    expect(r.body.meta.total).toBe(1);
    const row = r.body.data[0];
    expect(row.employeeId).toBe(meeraId);
    expect(row.employeeName).toBe("Meera Iyer");
    expect(row.department).toBe("Engineering");
    expect(row.oldSalary).toBe(110000);
    expect(row.newSalary).toBe(125000);
    expect(row.currency).toBe("INR");
    expect(row.reason).toBe("Annual appraisal");
    expect(row.changedBy).toBe("HR Manager");
    // The PATCH change is the newest row overall (its changed_at is now).
    const all = await request(app).get("/api/audit-log?pageSize=1");
    expect(all.body.meta.total).toBe(4);
    expect(all.body.data[0].employeeName).toBe("Meera Iyer");
  });
});
