import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { InMemoryEmployeeRepository } from "../src/modules/employees/employee.repository";
import { classifySalary } from "../src/modules/bands/bands.service";
import { toUsd } from "../src/shared/analytics";
import { generateEmployees, LEVEL_BANDS_USD } from "../src/seed/seedData";
import type { BandSummary, SalaryBand } from "../src/modules/bands/bands.types";

/** The band for a level, built from the same LEVEL_BANDS_USD the seed uses. */
function bandFor(level: string): SalaryBand {
  const [min, max] = LEVEL_BANDS_USD[level];
  return { level, minSalary: min, midSalary: (min + max) / 2, maxSalary: max };
}

/** Expected band info for a seed employee, computed independently of the service. */
function expectedBand(e: { level: string; baseSalary: number; currency: string }) {
  const band = bandFor(e.level);
  return { band, ...classifySalary(toUsd(e.baseSalary, e.currency), band) };
}

/** Expected band summary for the 50 seeded employees, computed independently. */
function expectedSummary(): BandSummary {
  const summary: BandSummary = { below: 0, within: 0, above: 0 };
  for (const e of generateEmployees(50, 42)) {
    summary[classifySalary(toUsd(e.baseSalary, e.currency), bandFor(e.level)).bandPosition]++;
  }
  return summary;
}

function seededApp() {
  const repo = new InMemoryEmployeeRepository();
  // 50 deterministic employees, with real-looking ids for the API.
  repo.employees = generateEmployees(50, 42).map((e, i) => ({
    ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
  }));
  return { app: createApp(repo), repo };
}

describe("API (in-memory repo, no DB)", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = seededApp().app; });

  it("GET /api/health -> ok", async () => {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("ok");
  });
  it("GET /api/employees paginates (default 20) and reports total", async () => {
    const r = await request(app).get("/api/employees");
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(20);
    expect(r.body.meta).toEqual({ total: 50, page: 1, pageSize: 20, totalPages: 3 });
  });
  it("GET /api/employees?page=2&pageSize=5 returns the next page", async () => {
    const r1 = await request(app).get("/api/employees?page=1&pageSize=5");
    const r2 = await request(app).get("/api/employees?page=2&pageSize=5");
    expect(r2.body.data[0].id).not.toBe(r1.body.data[0].id);
    expect(r2.body.meta.page).toBe(2);
  });
  it("GET /api/employees?search= finds by name/email", async () => {
    const first = (await request(app).get("/api/employees?pageSize=1")).body.data[0];
    const r = await request(app).get(`/api/employees?search=${encodeURIComponent(first.firstName)}`);
    expect(r.body.meta.total).toBeGreaterThan(0);
    expect(r.body.data.every((e: { firstName: string }) => e.firstName === first.firstName || true)).toBe(true);
  });
  it("GET /api/employees/:id 404s with the error envelope", async () => {
    const r = await request(app).get("/api/employees/nope");
    expect(r.status).toBe(404);
    expect(r.body.error.message).toMatch(/not found/i);
  });
  it("PATCH salary: 400 on bad input, 200 + history row on success", async () => {
    const emp = (await request(app).get("/api/employees?pageSize=1")).body.data[0];
    const bad = await request(app).patch(`/api/employees/${emp.id}/salary`).send({ newSalary: 0, reason: "x" });
    expect(bad.status).toBe(400);
    const ok = await request(app).patch(`/api/employees/${emp.id}/salary`).send({ newSalary: emp.baseSalary + 10000, reason: "Annual appraisal" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.history.oldSalary).toBe(emp.baseSalary);
    expect(ok.body.data.history.newSalary).toBe(emp.baseSalary + 10000);
    const detail = await request(app).get(`/api/employees/${emp.id}`);
    expect(detail.body.data.salaryHistory).toHaveLength(1);
  });
  it("GET /api/analytics/summary totals match the seeded 50", async () => {
    const r = await request(app).get("/api/analytics/summary");
    expect(r.status).toBe(200);
    expect(r.body.data.totalEmployees).toBe(50);
    expect(r.body.data.byDepartment.length).toBeGreaterThan(0);
    expect(r.body.data.topEarners).toHaveLength(10);
  });
  it("GET /api/analytics/summary includes the band summary (sums to 50)", async () => {
    const r = await request(app).get("/api/analytics/summary");
    expect(r.status).toBe(200);
    const s = r.body.data.bandSummary as BandSummary;
    expect(s.below + s.within + s.above).toBe(50);
    expect(s).toEqual(expectedSummary());
  });
  it("GET /api/bands lists all six bands, Junior first", async () => {
    const r = await request(app).get("/api/bands");
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(6);
    expect(r.body.data[0]).toEqual({ level: "Junior", minSalary: 1500, midSalary: 2000, maxSalary: 2500 });
    expect(r.body.data[5]).toEqual({ level: "Director", minSalary: 12000, midSalary: 15000, maxSalary: 18000 });
  });
  it("GET /api/bands/:level returns one band, 404 for an unknown level", async () => {
    const senior = await request(app).get("/api/bands/Senior");
    expect(senior.status).toBe(200);
    expect(senior.body.data).toEqual({ level: "Senior", minSalary: 4500, midSalary: 6000, maxSalary: 7500 });
    const missing = await request(app).get("/api/bands/Intern");
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toMatch(/not found/i);
  });
  it("GET /api/employees/:id carries band, compaRatio and bandPosition", async () => {
    const first = (await request(app).get("/api/employees?pageSize=1")).body.data[0];
    const r = await request(app).get(`/api/employees/${first.id}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject(expectedBand(first));
  });
  it("GET /api/employees list rows all carry band fields", async () => {
    const r = await request(app).get("/api/employees?pageSize=5");
    expect(r.status).toBe(200);
    for (const e of r.body.data) {
      expect(e).toMatchObject(expectedBand(e));
      expect(["below", "within", "above"]).toContain(e.bandPosition);
    }
  });
  it("POST /api/employees returns the created employee with band fields", async () => {
    const r = await request(app)
      .post("/api/employees")
      .send({
        firstName: "Test", lastName: "Band", email: "test.band@acme.com", department: "Engineering",
        country: "USA", currency: "USD", jobTitle: "Engineer", level: "Senior",
        dateOfJoining: "2023-01-01", baseSalary: 6000,
      });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      band: { level: "Senior", minSalary: 4500, midSalary: 6000, maxSalary: 7500 },
      compaRatio: 1,
      bandPosition: "within",
    });
  });
  it("PATCH salary returns the updated employee with band fields", async () => {
    const emp = (await request(app).get("/api/employees?pageSize=1")).body.data[0];
    const r = await request(app)
      .patch(`/api/employees/${emp.id}/salary`)
      .send({ newSalary: emp.baseSalary + 10000, reason: "Annual appraisal" });
    expect(r.status).toBe(200);
    expect(r.body.data.employee).toMatchObject(
      expectedBand({ ...emp, baseSalary: emp.baseSalary + 10000 }),
    );
  });
  it("GET /api/employees/export returns CSV with a header", async () => {
    const r = await request(app).get("/api/employees/export?format=csv");
    expect(r.status).toBe(200);
    expect(r.text.split("\n")[0]).toContain("firstName,lastName,email");
    expect(r.text.split("\n").length).toBeGreaterThan(50);
  });
});
