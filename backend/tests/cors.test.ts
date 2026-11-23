import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { getAllowedOrigins, normalizeOrigin } from "../src/shared/cors";
import { InMemoryEmployeeRepository } from "../src/modules/employees/employee.repository";
import { generateEmployees } from "../src/seed/seedData";

function seededApp() {
  const repo = new InMemoryEmployeeRepository();
  repo.employees = generateEmployees(50, 42).map((e, i) => ({
    ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
  }));
  return createApp(repo);
}

describe("CORS allow-list", () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    // Restore the real env after each test that changes it.
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it("getAllowedOrigins: FRONTEND_URL is split on commas, trailing slashes stripped, defaults kept", () => {
    const origins = getAllowedOrigins("https://app.example.com/, http://localhost:3000/");
    expect(origins).toContain("https://app.example.com");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://127.0.0.1:3000");
    expect(origins).toContain("http://localhost:3001");
    expect(origins).not.toContain("https://app.example.com/");
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("normalizeOrigin strips trailing slashes", () => {
    expect(normalizeOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeOrigin("  http://localhost:3000  ")).toBe("http://localhost:3000");
  });

  it("GET /api/health from http://localhost:3000 is allowed", async () => {
    const r = await request(seededApp()).get("/api/health").set("Origin", "http://localhost:3000");
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("GET /api/health from http://127.0.0.1:3000 is allowed", async () => {
    const r = await request(seededApp()).get("/api/health").set("Origin", "http://127.0.0.1:3000");
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
  });

  it("GET /api/health from http://localhost:3001 is allowed (Next.js fallback port)", async () => {
    const r = await request(seededApp()).get("/api/health").set("Origin", "http://localhost:3001");
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
  });

  it("preflight OPTIONS to /api/employees returns 204 with Allow-Origin + Allow-Methods", async () => {
    const r = await request(seededApp())
      .options("/api/employees")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(r.headers["access-control-allow-methods"]).toMatch(/GET/);
  });

  it("an unknown origin gets NO Allow-Origin header (browser blocks it)", async () => {
    const r = await request(seededApp()).get("/api/health").set("Origin", "http://evil.example");
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("a FRONTEND_URL from env is honoured, with trailing slash stripped", async () => {
    process.env.FRONTEND_URL = "https://app.example.com/, http://localhost:4001";
    const app = seededApp();
    const custom = await request(app).get("/api/health").set("Origin", "https://app.example.com");
    expect(custom.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const extra = await request(app).get("/api/health").set("Origin", "http://localhost:4001");
    expect(extra.headers["access-control-allow-origin"]).toBe("http://localhost:4001");
    // Defaults are still allowed alongside the custom list.
    const local = await request(app).get("/api/health").set("Origin", "http://localhost:3000");
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });
});
