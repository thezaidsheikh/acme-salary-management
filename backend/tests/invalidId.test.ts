import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import { memPool } from "./pgmem";
import { applyMigrations } from "../scripts/migrate";
import { createApp } from "../src/app";
import { PgEmployeeRepository } from "../src/modules/employees/employee.repository";
import type { Pool } from "pg";

// Regression test for the live 500 on a malformed employee id: Postgres
// rejects any non-UUID string in `WHERE id = $1` with "invalid input
// syntax for type uuid", and the shared error handler turned that into a
// generic 500. PgEmployeeRepository.getById now returns null for a
// non-UUID id, so the API answers 404 "Employee not found" instead —
// the same answer a well-formed but absent UUID already got. The guard
// runs before any query, so the test proves the guard itself, not
// pg-mem's UUID handling. The in-memory suite (api.test.ts) already
// covers "nope" -> 404; this file covers the real Postgres repository
// and both id routes (GET detail and PATCH salary) through it.
describe("malformed employee id -> 404, never 500 (pg-mem, real SQL)", () => {
  let app: ReturnType<typeof createApp>;
  let repo: PgEmployeeRepository;

  beforeAll(async () => {
    const pool: Pool = memPool();
    await applyMigrations(pool);
    repo = new PgEmployeeRepository(pool);
    app = createApp(repo);
    await repo.create({
      firstName: "Priya",
      lastName: "Sharma",
      email: "priya.sharma@acme.com",
      department: "Engineering",
      country: "India",
      currency: "INR",
      jobTitle: "Software Engineer",
      level: "Senior",
      managerId: null,
      dateOfJoining: new Date("2022-03-01"),
      baseSalary: 150000,
    });
  });

  it("repo getById returns null for a non-UUID id", async () => {
    await expect(repo.getById("not-a-uuid")).resolves.toBeNull();
    await expect(repo.getById("123")).resolves.toBeNull();
  });

  it("repo getById still returns null for a well-formed but absent UUID", async () => {
    await expect(repo.getById("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("GET /api/employees/not-a-uuid -> 404 Employee not found", async () => {
    const r = await request(app).get("/api/employees/not-a-uuid");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "API_ERROR", message: "Employee not found" } });
  });

  it("PATCH /api/employees/123/salary -> 404 Employee not found", async () => {
    const r = await request(app)
      .patch("/api/employees/123/salary")
      .send({ newSalary: 160000, reason: "Annual appraisal" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: { code: "API_ERROR", message: "Employee not found" } });
  });
});
