// Seed-on-start — the free-tier workaround for seeding the live database.
//
// Why this exists: on Render's free tier there is no Shell and no one-off
// jobs ("Shell is not supported for free compute plans"), so the seed
// script cannot be run against the live database by hand. Instead, the
// backend seeds itself once, on boot, when SEED_ON_START=true — see
// docs/DEPLOYMENT.md step 2. It uses the existing idempotent seed
// (scripts/seed.ts), so a redeploy never wipes data: it seeds only an
// empty table, skips at exactly 10,000 rows, and refuses any other
// non-zero count. A failure here is never fatal — the server keeps
// serving and the seed can be run later by hand.
import type { Pool } from "pg";
import { seedEmployees } from "../../scripts/seed.js";

/** Outcome of a seed-on-start attempt. */
export interface SeedOnStartResult {
  /** Whether SEED_ON_START was "true" at all. */
  enabled: boolean;
  /** Whether this run inserted rows. */
  seeded: boolean;
  /** Employee count after the attempt, or null when it is unknown. */
  count: number | null;
  /** Failure reason, when the seed was attempted and failed. */
  error?: string;
}

/**
 * Seed the database on server start, but only when asked, and only once.
 *
 * Runs the existing idempotent `seedEmployees` (no --force): an empty
 * table gets exactly 10,000 employees, a table that already holds
 * 10,000 is left alone, and any other non-zero count is refused
 * rather than wiped. Any failure — including a refused seed and a
 * database that is unreachable — is logged and returned, never thrown,
 * so the caller (src/index.ts) can keep the server running.
 * @param db Pool to seed (the process-wide default pool in production).
 * @param total How many employees to seed; defaults to the seed's own
 * 10,000. Tests pass a small number to keep the pg-mem run fast.
 * @returns Whether seeding was enabled, whether it seeded, the count,
 * and any error message.
 */
export async function maybeSeedOnStart(db: Pool, total?: number): Promise<SeedOnStartResult> {
  if (process.env.SEED_ON_START !== "true") {
    return { enabled: false, seeded: false, count: null };
  }
  try {
    const { seeded, count } = await seedEmployees(db, false, total);
    if (seeded) {
      console.log(`Seed on start: seeded ${count} employees.`);
    } else {
      console.log(`Seed on start: already seeded (${count} employees) — skipping.`);
    }
    return { enabled: true, seeded, count };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(
      `Seed on start: failed — ${message} ` +
        "Server keeps running; run the seed later with `npm run seed`.",
    );
    return { enabled: true, seeded: false, count: null, error: message };
  }
}
