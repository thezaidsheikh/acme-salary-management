import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryEmployeeRepository } from "../src/modules/employees/employee.repository";
import { AuditService } from "../src/modules/audit/audit.service";
import { generateEmployees } from "../src/seed/seedData";

/**
 * Audit-log tests (in-memory repo, no DB): the company-wide read over the
 * salary history the salary module writes. Three changes across two
 * employees, with fixed timestamps so newest-first ordering is exact:
 * emp-0 changes on 2026-01-10 and 2026-03-20, emp-1 on 2026-02-15.
 */
function seededApp() {
  const repo = new InMemoryEmployeeRepository();
  repo.employees = generateEmployees(5, 42).map((e, i) => ({
    ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
  }));
  return { app: createApp(repo), repo };
}

/** Create the three history rows and pin their timestamps. */
async function seedHistory(repo: InMemoryEmployeeRepository) {
  const [emp0, emp1] = repo.employees;
  // updateSalary mutates baseSalary in place, so capture the originals.
  const orig0 = emp0.baseSalary;
  const orig1 = emp1.baseSalary;
  const h1 = (await repo.updateSalary(emp0.id, orig0 + 5000, "Annual appraisal", "HR Manager"))!.history;
  const h2 = (await repo.updateSalary(emp1.id, orig1 + 3000, "Promotion", "Anita Desai"))!.history;
  const h3 = (await repo.updateSalary(emp0.id, orig0 + 12000, "Market correction", "HR Manager"))!.history;
  h1.changedAt = new Date("2026-01-10T09:00:00.000Z");
  h2.changedAt = new Date("2026-02-15T09:00:00.000Z");
  h3.changedAt = new Date("2026-03-20T09:00:00.000Z");
  return { emp0, emp1, h1, h2, h3, orig0, orig1 };
}

describe("GET /api/audit-log (in-memory repo, no DB)", () => {
  let app: ReturnType<typeof createApp>;
  let repo: InMemoryEmployeeRepository;

  beforeEach(() => {
    ({ app, repo } = seededApp());
  });

  it("returns an empty list with total 0 when no salary has ever changed", async () => {
    const r = await request(app).get("/api/audit-log");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.meta).toEqual({ total: 0, page: 1, pageSize: 20, totalPages: 1 });
  });

  it("lists every change newest first, with who / whose / old → new / reason / when", async () => {
    const { emp0, emp1, h1, h2, h3, orig0 } = await seedHistory(repo);
    const r = await request(app).get("/api/audit-log");
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBe(3);
    expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([h3.id, h2.id, h1.id]);
    const newest = r.body.data[0];
    expect(newest.employeeId).toBe(emp0.id);
    expect(newest.employeeName).toBe(`${emp0.firstName} ${emp0.lastName}`);
    expect(newest.department).toBe(emp0.department);
    expect(newest.oldSalary).toBe(orig0 + 5000);
    expect(newest.newSalary).toBe(orig0 + 12000);
    expect(newest.currency).toBe(emp0.currency);
    expect(newest.reason).toBe("Market correction");
    expect(newest.changedBy).toBe("HR Manager");
    expect(newest.changedAt).toBe("2026-03-20T09:00:00.000Z");
    const middle = r.body.data[1];
    expect(middle.employeeName).toBe(`${emp1.firstName} ${emp1.lastName}`);
    expect(middle.reason).toBe("Promotion");
    expect(middle.changedBy).toBe("Anita Desai");
  });

  it("paginates: page 2 differs from page 1 and meta totals are correct", async () => {
    await seedHistory(repo);
    const p1 = await request(app).get("/api/audit-log?page=1&pageSize=2");
    const p2 = await request(app).get("/api/audit-log?page=2&pageSize=2");
    expect(p1.body.data).toHaveLength(2);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
    expect(p2.body.data[0].id).not.toBe(p1.body.data[1].id);
    expect(p1.body.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(p2.body.meta).toEqual({ total: 3, page: 2, pageSize: 2, totalPages: 2 });
  });

  it("filters by employee: name substring, email substring, and exact id", async () => {
    const { emp0, emp1 } = await seedHistory(repo);
    const byName = await request(app).get(`/api/audit-log?search=${encodeURIComponent(emp0.firstName)}`);
    expect(byName.body.meta.total).toBe(2);
    expect(byName.body.data.every((x: { employeeId: string }) => x.employeeId === emp0.id)).toBe(true);
    const byEmail = await request(app).get(
      `/api/audit-log?search=${encodeURIComponent(emp1.email.split("@")[0])}`,
    );
    expect(byEmail.body.meta.total).toBe(1);
    expect(byEmail.body.data[0].employeeId).toBe(emp1.id);
    const byId = await request(app).get(`/api/audit-log?search=${encodeURIComponent(emp0.id)}`);
    expect(byId.body.meta.total).toBe(2);
    expect(byId.body.data.every((x: { employeeId: string }) => x.employeeId === emp0.id)).toBe(true);
  });

  it("filters by department", async () => {
    const { emp0 } = await seedHistory(repo);
    const r = await request(app).get(`/api/audit-log?department=${encodeURIComponent(emp0.department)}`);
    expect(r.body.meta.total).toBe(2);
    expect(r.body.data.every((x: { department: string }) => x.department === emp0.department)).toBe(true);
    const none = await request(app).get("/api/audit-log?department=NoSuchDepartment");
    expect(none.body.meta.total).toBe(0);
    expect(none.body.data).toEqual([]);
  });

  it("filters by date range, inclusive on both ends", async () => {
    await seedHistory(repo);
    const feb = await request(app).get("/api/audit-log?from=2026-02-01&to=2026-02-28");
    expect(feb.body.meta.total).toBe(1);
    expect(feb.body.data[0].reason).toBe("Promotion");
    const fromOnly = await request(app).get("/api/audit-log?from=2026-03-01");
    expect(fromOnly.body.meta.total).toBe(1);
    expect(fromOnly.body.data[0].reason).toBe("Market correction");
    const toOnly = await request(app).get("/api/audit-log?to=2026-01-31");
    expect(toOnly.body.meta.total).toBe(1);
    expect(toOnly.body.data[0].reason).toBe("Annual appraisal");
    // A single day matches a change made that day (both ends inclusive).
    const oneDay = await request(app).get("/api/audit-log?from=2026-02-15&to=2026-02-15");
    expect(oneDay.body.meta.total).toBe(1);
    expect(oneDay.body.data[0].reason).toBe("Promotion");
  });

  it("combines filters with AND, and returns empty when nothing matches", async () => {
    const { emp0 } = await seedHistory(repo);
    const combined = await request(app).get(
      `/api/audit-log?search=${encodeURIComponent(emp0.firstName)}&department=${encodeURIComponent(emp0.department)}&from=2026-03-01&to=2026-03-31`,
    );
    expect(combined.body.meta.total).toBe(1);
    expect(combined.body.data[0].reason).toBe("Market correction");
    const noMatch = await request(app).get(
      `/api/audit-log?search=${encodeURIComponent(emp0.firstName)}&from=2026-02-01&to=2026-02-28`,
    );
    expect(noMatch.body.meta.total).toBe(0);
    expect(noMatch.body.data).toEqual([]);
    const unknown = await request(app).get("/api/audit-log?search=zzz-no-such-person");
    expect(unknown.body.meta.total).toBe(0);
    expect(unknown.body.data).toEqual([]);
  });

  it("skips a history row whose employee is gone, and orders equal timestamps by id", async () => {
    const { h1, h2, h3 } = await seedHistory(repo);
    // An orphan row (no matching employee — impossible in Postgres, where
    // the FK cascades, but possible in a hand-built in-memory store) is
    // skipped, never shown with a blank name.
    repo.history.push({ ...h1, id: "h-orphan", employeeId: "missing-employee" });
    // Two changes sharing a timestamp order by id, descending.
    h1.id = "h-a";
    h2.id = "h-b";
    h1.changedAt = new Date("2026-02-15T09:00:00.000Z");
    h2.changedAt = new Date("2026-02-15T09:00:00.000Z");
    const r = await request(app).get("/api/audit-log");
    expect(r.body.meta.total).toBe(3);
    expect(r.body.data.map((x: { id: string }) => x.id)).toEqual([h3.id, "h-b", "h-a"]);
  });

  it("400s on a bad date, a reversed range, and out-of-range paging", async () => {
    await seedHistory(repo);
    expect((await request(app).get("/api/audit-log?from=15-02-2026")).status).toBe(400);
    expect((await request(app).get("/api/audit-log?to=2026/02/15")).status).toBe(400);
    expect((await request(app).get("/api/audit-log?from=2026-03-01&to=2026-01-01")).status).toBe(400);
    expect((await request(app).get("/api/audit-log?page=0")).status).toBe(400);
    expect((await request(app).get("/api/audit-log?pageSize=101")).status).toBe(400);
  });

  it("a salary change made via PATCH appears on the audit page with the right old/new/reason", async () => {
    const emp = repo.employees[2];
    const before = emp.baseSalary;
    const patch = await request(app)
      .patch(`/api/employees/${emp.id}/salary`)
      .send({ newSalary: before + 12000, reason: "Annual appraisal", changedBy: "HR Manager" });
    expect(patch.status).toBe(200);
    const r = await request(app).get(`/api/audit-log?search=${encodeURIComponent(emp.firstName)}`);
    expect(r.body.meta.total).toBe(1);
    const row = r.body.data[0];
    expect(row.employeeId).toBe(emp.id);
    expect(row.employeeName).toBe(`${emp.firstName} ${emp.lastName}`);
    expect(row.oldSalary).toBe(before);
    expect(row.newSalary).toBe(before + 12000);
    expect(row.currency).toBe(emp.currency);
    expect(row.reason).toBe("Annual appraisal");
    expect(row.changedBy).toBe("HR Manager");
  });
});

describe("AuditService", () => {
  it("returns { data, meta } with the shared pagination envelope", async () => {
    const { repo } = seededApp();
    await seedHistory(repo);
    const service = new AuditService(repo);
    const page = await service.list({ page: 1, pageSize: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.meta).toEqual({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(page.data[0].reason).toBe("Market correction");
  });
});
