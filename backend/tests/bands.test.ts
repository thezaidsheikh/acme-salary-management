import request from "supertest";
import { describe, expect, it } from "vitest";
import { LEVEL_BANDS_USD, generateEmployees } from "../src/seed/seedData";
import { applyMigrations } from "../scripts/migrate";
import { memPool } from "./pgmem";
import { createApp } from "../src/app";
import { BandService, classifySalary } from "../src/modules/bands/bands.service";
import { createBandsModule } from "../src/modules/bands/bands.factory";
import {
  InMemoryBandRepository,
  PgBandRepository,
} from "../src/modules/bands/bands.repository";
import { InMemoryEmployeeRepository, PgEmployeeRepository } from "../src/modules/employees/employee.repository";
import { EmployeeService } from "../src/modules/employees/employee.service";
import type { SalaryBand } from "../src/modules/bands/bands.types";

/** The Senior band from LEVEL_BANDS_USD: [4500, 7500], mid 6000. */
const SENIOR: SalaryBand = { level: "Senior", minSalary: 4500, midSalary: 6000, maxSalary: 7500 };

describe("classifySalary (pure)", () => {
  it("exact midpoint -> compa-ratio 1.00, within", () => {
    expect(classifySalary(6000, SENIOR)).toEqual({ compaRatio: 1, bandPosition: "within" });
  });
  it("below the minimum -> below", () => {
    expect(classifySalary(4499, SENIOR)).toEqual({ compaRatio: 0.75, bandPosition: "below" });
  });
  it("above the maximum -> above", () => {
    expect(classifySalary(9000, SENIOR)).toEqual({ compaRatio: 1.5, bandPosition: "above" });
  });
  it("exactly at min and max is still within (edges included)", () => {
    expect(classifySalary(4500, SENIOR).bandPosition).toBe("within");
    expect(classifySalary(7500, SENIOR).bandPosition).toBe("within");
  });
  it("rounds the compa-ratio to 2 decimals", () => {
    // 6123 / 6000 = 1.0205 -> 1.02 (rounds down); 6300 / 6000 = 1.05 exact.
    expect(classifySalary(6123, SENIOR).compaRatio).toBe(1.02);
    expect(classifySalary(6300, SENIOR).compaRatio).toBe(1.05);
  });
});

describe("BandService (in-memory repo)", () => {
  const service = new BandService(new InMemoryBandRepository());

  it("getAll returns the six LEVEL_BANDS_USD bands, Junior first", async () => {
    const bands = await service.getAll();
    expect(bands).toHaveLength(6);
    expect(bands[0]).toEqual({ level: "Junior", minSalary: 1500, midSalary: 2000, maxSalary: 2500 });
    expect(bands[5]).toEqual({ level: "Director", minSalary: 12000, midSalary: 15000, maxSalary: 18000 });
    for (const b of bands) {
      const [min, max] = LEVEL_BANDS_USD[b.level];
      expect([b.minSalary, b.maxSalary]).toEqual([min, max]);
      expect(b.midSalary).toBe((min + max) / 2);
    }
  });
  it("getByLevel returns null for an unknown level", async () => {
    expect(await service.getByLevel("Intern")).toBeNull();
  });
  it("enrich converts local salary to USD before classifying (INR 83 per USD)", async () => {
    // Senior in India on ₹150,000/mo: 150000 / 83 ≈ $1,807 — below the $4,500 min.
    const info = await service.enrich({ level: "Senior", baseSalary: 150000, currency: "INR" });
    expect(info?.bandPosition).toBe("below");
    expect(info?.compaRatio).toBe(0.3);
    expect(info?.band).toEqual(SENIOR);
  });
  it("enrich: USD salary at the midpoint is within at 1.00", async () => {
    const info = await service.enrich({ level: "Senior", baseSalary: 6000, currency: "USD" });
    expect(info).toEqual({ band: SENIOR, compaRatio: 1, bandPosition: "within" });
  });
  it("enrich returns null for an unknown level instead of inventing a band", async () => {
    expect(await service.enrich({ level: "Intern", baseSalary: 1000, currency: "USD" })).toBeNull();
  });
  it("enrichMany classifies a batch with one lookup and keeps nulls in place", async () => {
    const infos = await service.enrichMany([
      { level: "Junior", baseSalary: 1000, currency: "USD" },
      { level: "Intern", baseSalary: 1000, currency: "USD" },
      { level: "Director", baseSalary: 20000, currency: "USD" },
    ]);
    expect(infos[0]?.bandPosition).toBe("below");
    expect(infos[1]).toBeNull();
    expect(infos[2]?.bandPosition).toBe("above");
  });
  it("summarize counts below / within / above and skips unknown levels", async () => {
    const summary = await service.summarize([
      { level: "Senior", baseSalary: 1000, currency: "USD" },
      { level: "Senior", baseSalary: 6000, currency: "USD" },
      { level: "Senior", baseSalary: 9000, currency: "USD" },
      { level: "Intern", baseSalary: 1000, currency: "USD" },
    ]);
    expect(summary).toEqual({ below: 1, within: 1, above: 1 });
  });
  it("InMemoryBandRepository serves custom bands when given them", async () => {
    const repo = new InMemoryBandRepository([
      { level: "Custom", minSalary: 100, midSalary: 200, maxSalary: 300 },
    ]);
    expect(await repo.getAll()).toHaveLength(1);
    expect(await repo.getByLevel("Custom")).toEqual({
      level: "Custom",
      minSalary: 100,
      midSalary: 200,
      maxSalary: 300,
    });
  });
});

describe("createBandsModule (factory)", () => {
  it("accepts a ready BandRepository and uses it as-is", async () => {
    const { service, router } = createBandsModule(new InMemoryBandRepository());
    expect(await service.getAll()).toHaveLength(6);
    expect(router).toBeDefined();
  });
  it("builds an in-memory band service from an employee repository", async () => {
    const { service } = createBandsModule(new InMemoryEmployeeRepository());
    expect(await service.getByLevel("Senior")).toEqual({
      level: "Senior",
      minSalary: 4500,
      midSalary: 6000,
      maxSalary: 7500,
    });
  });
});

describe("BandService fail-fast (empty band store)", () => {
  it("getById/list throw 500 when the level has no band (unmigrated DB)", async () => {
    const repo = new InMemoryEmployeeRepository();
    repo.employees = generateEmployees(1, 42).map((e, i) => ({
      ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
    }));
    const service = new EmployeeService(repo, new BandService(new InMemoryBandRepository([])));
    await expect(service.getById("emp-0")).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("No salary band"),
    });
    await expect(
      service.list({ page: 1, pageSize: 10, sortBy: "lastName", sortOrder: "asc" }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("bands API (pg-mem, real migrations)", () => {
  it("GET /api/bands, employee detail and analytics bandSummary over Postgres", async () => {
    const pool = memPool();
    try {
      await applyMigrations(pool);
      // One Senior in India on ₹498,000/mo: 498000 / 83 = $6,000 exactly —
      // the Senior midpoint, so compa-ratio 1.00 and within.
      await pool.query(
        `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, date_of_joining, base_salary)
         VALUES ('11111111-1111-1111-1111-111111111111','Priya','Sharma','priya@example.com','Engineering','India','INR','Engineer','Senior','2020-01-01',498000)`,
      );
      const app = createApp(new PgEmployeeRepository(pool));
      const bands = await request(app).get("/api/bands");
      expect(bands.status).toBe(200);
      expect(bands.body.data).toHaveLength(6);
      const detail = await request(app).get("/api/employees/11111111-1111-1111-1111-111111111111");
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        band: { level: "Senior", minSalary: 4500, midSalary: 6000, maxSalary: 7500 },
        compaRatio: 1,
        bandPosition: "within",
      });
      const summary = await request(app).get("/api/analytics/summary");
      expect(summary.status).toBe(200);
      expect(summary.body.data.bandSummary).toEqual({ below: 0, within: 1, above: 0 });
      const missing = await request(app).get("/api/bands/Intern");
      expect(missing.status).toBe(404);
    } finally {
      await pool.end();
    }
  });
});
describe("PgBandRepository (pg-mem, real migrations)", () => {
  it("reads the six seeded bands from salary_bands", async () => {
    const pool = memPool();
    try {
      await applyMigrations(pool);
      const repo = new PgBandRepository(pool);
      const bands = await repo.getAll();
      expect(bands).toHaveLength(6);
      expect(bands[0].level).toBe("Junior");
      expect(await repo.getByLevel("Manager")).toEqual({
        level: "Manager",
        minSalary: 9000,
        midSalary: 11000,
        maxSalary: 13000,
      });
      expect(await repo.getByLevel("Intern")).toBeNull();
      // The service over the real table classifies the same as in memory.
      const service = new BandService(repo);
      const info = await service.enrich({ level: "Lead", baseSalary: 8750, currency: "USD" });
      expect(info).toEqual({
        band: { level: "Lead", minSalary: 7500, midSalary: 8750, maxSalary: 10000 },
        compaRatio: 1,
        bandPosition: "within",
      });
    } finally {
      await pool.end();
    }
  });
});
