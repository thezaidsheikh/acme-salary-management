import { describe, expect, it } from "vitest";
import { memPool } from "./pgmem";
import { generateEmployees, mulberry32 } from "../src/seed/seedData";
import { createSeedEmployee } from "../src/seed/employeeFactory";
import { applyMigration } from "../scripts/migrate";
import { countEmployees, seedEmployees, SEED_TOTAL } from "../scripts/seed";

describe("seed determinism", () => {
  it("same seed => same employees", () => {
    const a = generateEmployees(100, 42);
    const b = generateEmployees(100, 42);
    expect(a).toEqual(b);
  });
  it("different seed => different first employee", () => {
    expect(generateEmployees(10, 42)[0].email).not.toBe(generateEmployees(10, 7)[0].email);
  });
  it("generates exactly 10,000 unique emails with salaries in band", () => {
    const all = generateEmployees(10000, 42);
    expect(all).toHaveLength(10000);
    expect(new Set(all.map((e) => e.email)).size).toBe(10000);
    expect(all.every((e) => e.baseSalary > 0)).toBe(true);
    expect(all.every((e) => ["India", "USA", "UK", "Germany", "Singapore", "Canada", "Australia", "UAE"].includes(e.country))).toBe(true);
  });
  it("mulberry32: same seed => same sequence, different seed => different", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(7)()).not.toBe(mulberry32(42)());
    expect(c()).toBeGreaterThanOrEqual(0);
    expect(c()).toBeLessThan(1);
  });
  it("generateEmployees(0) is empty", () => {
    expect(generateEmployees(0, 42)).toEqual([]);
  });
});

describe("createSeedEmployee factory", () => {
  it("is deterministic for the same RNG seed and registers its manager id", () => {
    const rngA = mulberry32(99);
    const usedA = new Map<string, number>();
    const idsA: string[] = [];
    const first = createSeedEmployee(rngA, 0, usedA, idsA);
    expect(idsA).toEqual(["emp-0"]);
    const rngB = mulberry32(99);
    expect(createSeedEmployee(rngB, 0, new Map(), [])).toEqual(first);
  });
  it("dedupes emails with a numeric suffix", () => {
    // A stub RNG that always picks the same first/last name, department,
    // country, level, title and salary inputs.
    const rng = () => 0;
    const used = new Map<string, number>();
    const ids: string[] = [];
    const a = createSeedEmployee(rng, 0, used, ids);
    const b = createSeedEmployee(rng, 1, used, ids);
    expect(a.email).toBe("aarav.sharma@acme.com");
    expect(b.email).toBe("aarav.sharma2@acme.com");
    expect(a).not.toEqual(b);
  });
  it("first 501 employees have no manager; later ones link only to the first 500", () => {
    const all = generateEmployees(1000, 42);
    expect(all.slice(0, 501).every((e) => e.managerId === null)).toBe(true);
    const managers = all.slice(501).map((e) => e.managerId).filter((m): m is string => m !== null);
    expect(managers.length).toBeGreaterThan(0);
    expect(managers.every((m) => /^emp-([0-4]?\d{1,2}|500)$/.test(m) && Number(m.replace("emp-", "")) < 500)).toBe(true);
  });
});

describe("seed idempotency (pg-mem, no real Postgres)", () => {
  /** Fresh in-memory DB with the real migration applied. */
  async function seededDb() {
    const pool = memPool();
    await applyMigration(pool);
    return pool;
  }

  it("seeds on an empty DB, skips when already seeded, re-seeds with --force", async () => {
    const pool = await seededDb();
    try {
      // Small total keeps this fast; the full 10,000 is covered below.
      const first = await seedEmployees(pool, false, 200);
      expect(first).toEqual({ seeded: true, count: 200 });
      const second = await seedEmployees(pool, false, 200);
      expect(second).toEqual({ seeded: false, count: 200 });
      expect(await countEmployees(pool)).toBe(200);
      const forced = await seedEmployees(pool, true, 200);
      expect(forced).toEqual({ seeded: true, count: 200 });
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("refuses to wipe a partially filled table without --force", async () => {
    const pool = await seededDb();
    try {
      await seedEmployees(pool, false, 200);
      // Remove exactly one employee (fetch its id first: pg-mem
      // mishandles DELETE ... WHERE id IN (SELECT ... LIMIT 1)).
      const { rows } = await pool.query("SELECT id FROM employees LIMIT 1");
      await pool.query("DELETE FROM employees WHERE id = $1", [rows[0].id]);
      expect(await countEmployees(pool)).toBe(199);
      await expect(seedEmployees(pool, false, 200)).rejects.toThrow(/Pass --force/);
      expect(await countEmployees(pool)).toBe(199);
      const forced = await seedEmployees(pool, true, 200);
      expect(forced).toEqual({ seeded: true, count: 200 });
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("seeds exactly SEED_TOTAL (10,000) on an empty DB", async () => {
    expect(SEED_TOTAL).toBe(10_000);
    const pool = await seededDb();
    try {
      const result = await seedEmployees(pool);
      expect(result).toEqual({ seeded: true, count: 10_000 });
      // And a second run skips instead of wiping.
      expect(await seedEmployees(pool)).toEqual({ seeded: false, count: 10_000 });
    } finally {
      await pool.end();
    }
  }, 180_000);
});
