import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { memPool } from "./pgmem";
import { applyMigration } from "../scripts/migrate";
import { countEmployees } from "../scripts/seed";
import { createApp } from "../src/app";
import { PgEmployeeRepository } from "../src/modules/employees/employee.repository";
import { maybeSeedOnStart } from "../src/shared/seedOnStart";

describe("seed on start (pg-mem, no real Postgres)", () => {
  const original = process.env.SEED_ON_START;

  afterEach(() => {
    // Restore whatever the environment had (usually unset) so no test
    // leaks the flag into the next one.
    if (original === undefined) delete process.env.SEED_ON_START;
    else process.env.SEED_ON_START = original;
  });

  /** Fresh in-memory DB with the real migration applied. */
  async function migratedDb() {
    const pool = memPool();
    await applyMigration(pool);
    return pool;
  }

  it("does nothing when SEED_ON_START is not 'true'", async () => {
    delete process.env.SEED_ON_START;
    const pool = await migratedDb();
    try {
      const result = await maybeSeedOnStart(pool);
      expect(result).toEqual({ enabled: false, seeded: false, count: null });
      expect(await countEmployees(pool)).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("seeds exactly 10,000 on an empty DB, then skips on the second boot", async () => {
    process.env.SEED_ON_START = "true";
    const pool = await migratedDb();
    try {
      const first = await maybeSeedOnStart(pool);
      expect(first).toEqual({ enabled: true, seeded: true, count: 10_000 });
      const second = await maybeSeedOnStart(pool);
      expect(second).toEqual({ enabled: true, seeded: false, count: 10_000 });
      expect(await countEmployees(pool)).toBe(10_000);
    } finally {
      await pool.end();
    }
  }, 180_000);

  it("seeds a small total and skips when it is already there", async () => {
    process.env.SEED_ON_START = "true";
    const pool = await migratedDb();
    try {
      expect(await maybeSeedOnStart(pool, 200)).toEqual({
        enabled: true,
        seeded: true,
        count: 200,
      });
      expect(await maybeSeedOnStart(pool, 200)).toEqual({
        enabled: true,
        seeded: false,
        count: 200,
      });
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("refuses a partially filled table and does not wipe it", async () => {
    process.env.SEED_ON_START = "true";
    const pool = await migratedDb();
    try {
      await maybeSeedOnStart(pool, 200);
      // Remove exactly one employee (fetch its id first: pg-mem
      // mishandles DELETE ... WHERE id IN (SELECT ... LIMIT 1)).
      const { rows } = await pool.query("SELECT id FROM employees LIMIT 1");
      await pool.query("DELETE FROM employees WHERE id = $1", [rows[0].id]);
      expect(await countEmployees(pool)).toBe(199);
      const result = await maybeSeedOnStart(pool, 200);
      expect(result.enabled).toBe(true);
      expect(result.seeded).toBe(false);
      expect(result.error).toMatch(/Pass --force/);
      // Nothing was wiped: the 199 rows are still there.
      expect(await countEmployees(pool)).toBe(199);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("never throws when the database is unreachable — it logs and returns the error", async () => {
    process.env.SEED_ON_START = "true";
    // No migration applied: the employees table does not exist, so the
    // seed fails at the first COUNT — exactly like a live database
    // that is down or unmigrated.
    const pool = memPool();
    try {
      const result = await maybeSeedOnStart(pool);
      expect(result.enabled).toBe(true);
      expect(result.seeded).toBe(false);
      expect(result.count).toBeNull();
      expect(result.error).toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it("handles a non-Error failure without throwing", async () => {
    process.env.SEED_ON_START = "true";
    // A pool that throws a bare string, not an Error — the failure path
    // must still log it and return it, never crash the server.
    const throwingPool = {
      query: async () => {
        throw "database is down";
      },
    } as unknown as Pool;
    const result = await maybeSeedOnStart(throwingPool);
    expect(result).toEqual({
      enabled: true,
      seeded: false,
      count: null,
      error: "database is down",
    });
  });

  it("server listens first: health answers while the seed runs in the background", async () => {
    process.env.SEED_ON_START = "true";
    const pool = await migratedDb();
    // Real HTTP server over the same pool, exactly like src/index.ts:
    // listen first, then seed in the background (not awaited here).
    const app = createApp(new PgEmployeeRepository(pool));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const base = `http://localhost:${port}`;
    try {
      const seedPromise = maybeSeedOnStart(pool, 200);
      // Health must answer immediately, while the seed is still running.
      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ data: { status: "ok" } });
      const first = await seedPromise;
      expect(first).toEqual({ enabled: true, seeded: true, count: 200 });
      const list = await fetch(`${base}/api/employees?page=1&pageSize=1`);
      const listBody = (await list.json()) as { meta?: { total?: number } };
      expect(listBody.meta?.total).toBe(200);
      expect(await maybeSeedOnStart(pool, 200)).toEqual({
        enabled: true,
        seeded: false,
        count: 200,
      });
    } finally {
      server.close();
      await pool.end();
    }
  }, 120_000);
});
