import type { Pool } from "pg";
import { LEVEL_BANDS_USD } from "../../seed/seedData.js";
import type { SalaryBand } from "./bands.types.js";

// Pattern: Repository — services depend on this small interface, never on
// SQL or on a concrete class, so a new store needs no service change (SOLID
// Open/Closed + Dependency Inversion).
export interface BandRepository {
  /** All bands, ordered by min salary ascending. */
  getAll(): Promise<SalaryBand[]>;
  /** One band by level name, or null when the level has no band. */
  getByLevel(level: string): Promise<SalaryBand | null>;
}

/**
 * Map one raw Postgres row (snake_case columns) to a SalaryBand.
 * @param r Raw row from pg.
 * @returns The camelCase band.
 */
function mapBand(r: Record<string, unknown>): SalaryBand {
  return {
    level: r.level as string,
    minSalary: Number(r.min_salary),
    midSalary: Number(r.mid_salary),
    maxSalary: Number(r.max_salary),
  };
}

/**
 * Postgres implementation of BandRepository — the only class that knows
 * the salary_bands table. Bands are read-only here: HR changes them
 * directly in the database (a future admin UI can add a write path).
 */
export class PgBandRepository implements BandRepository {
  /**
   * @param pool Postgres pool to run queries against.
   */
  constructor(private pool: Pool) {}

  /**
   * All bands, ordered by min salary ascending (Junior first).
   * @returns The six level bands.
   */
  async getAll(): Promise<SalaryBand[]> {
    const r = await this.pool.query(
      "SELECT level, min_salary, mid_salary, max_salary FROM salary_bands ORDER BY min_salary ASC",
    );
    return r.rows.map(mapBand);
  }

  /**
   * One band by level name. The column is cast to text before comparing:
   * passing an unknown level (e.g. "Intern") as an enum literal would
   * make Postgres reject the query with "invalid input value for enum
   * level" instead of returning no rows; comparing as text returns null.
   * @param level Level name, e.g. "Senior".
   * @returns The band, or null when the level has none.
   */
  async getByLevel(level: string): Promise<SalaryBand | null> {
    const r = await this.pool.query(
      "SELECT level, min_salary, mid_salary, max_salary FROM salary_bands WHERE level::text = $1",
      [level],
    );
    return r.rows.length === 0 ? null : mapBand(r.rows[0]);
  }
}

// Pattern: Repository — InMemoryBandRepository is a second, swappable
// implementation of the same interface. Tests substitute it for Pg (SOLID
// Liskov: any BandRepository works wherever the interface is expected).

/**
 * In-memory implementation of BandRepository — used by unit/API tests,
 * no database needed. Defaults to the same bands the seed generates
 * salaries from (LEVEL_BANDS_USD), so tests and production agree on the
 * numbers; a test can pass its own bands to cover edge cases.
 */
export class InMemoryBandRepository implements BandRepository {
  /** Bands this repository serves; defaults to LEVEL_BANDS_USD. */
  private bands: SalaryBand[];

  /**
   * @param bands Bands to serve; when omitted, built from LEVEL_BANDS_USD
   *   with mid = (min + max) / 2, exactly as the migration seeds them.
   */
  constructor(bands?: SalaryBand[]) {
    this.bands =
      bands ??
      Object.entries(LEVEL_BANDS_USD).map(([level, [min, max]]) => ({
        level,
        minSalary: min,
        midSalary: (min + max) / 2,
        maxSalary: max,
      }));
  }

  /**
   * All bands, ordered by min salary ascending (Junior first).
   * @returns The bands.
   */
  async getAll(): Promise<SalaryBand[]> {
    return [...this.bands].sort((a, b) => a.minSalary - b.minSalary);
  }

  /**
   * One band by level name.
   * @param level Level name, e.g. "Senior".
   * @returns The band, or null when the level has none.
   */
  async getByLevel(level: string): Promise<SalaryBand | null> {
    return this.bands.find((b) => b.level === level) ?? null;
  }
}
