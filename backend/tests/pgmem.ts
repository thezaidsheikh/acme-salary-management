import { newDb, type IMemoryDb } from "pg-mem";
import type { Pool } from "pg";

/**
 * Shared in-memory Postgres for tests and scripts/verify-pgmem.ts.
 *
 * pg-mem has no plpgsql, so it cannot run the DO blocks in
 * migrations/001_init.sql on its own. This registers a minimal "plpgsql"
 * language that understands the ONE pattern the migration uses:
 *
 *   IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'X') THEN
 *     CREATE TYPE X AS ENUM (...);
 *   END IF;
 *
 * It interprets that pattern with pg-mem's own registerEnum (the native
 * way to add an enum type) and ignores a duplicate on re-apply — the same
 * outcome as the real guard on Postgres. Any other DO-block shape throws,
 * so a new pattern in the migration fails loudly here instead of being
 * silently skipped. Production code is untouched: on real Postgres the DO
 * blocks run as written.
 */
export function createMemDb(): IMemoryDb {
  const db = newDb();
  db.registerLanguage("plpgsql", ({ code, schema }) => {
    return () => {
      const match = /CREATE TYPE\s+(\w+)\s+AS\s+ENUM\s*\(([^)]*)\)/i.exec(code);
      if (!match) {
        throw new Error(`pg-mem plpgsql shim: unsupported DO block: ${code}`);
      }
      const name = match[1];
      const values = [...match[2].matchAll(/'([^']*)'/g)].map((m) => m[1]);
      try {
        schema.registerEnum(name, values);
      } catch (error) {
        // Re-applying the migration: the enum already exists, which is
        // exactly what the IF NOT EXISTS guard means — ignore it.
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) throw error;
      }
      return null;
    };
  });
  return db;
}

/** A pg-compatible Pool over a fresh in-memory DB (with the shim above). */
export function memPool(db: IMemoryDb = createMemDb()): Pool {
  const { Pool: MemPool } = db.adapters.createPg();
  return new MemPool() as unknown as Pool;
}
