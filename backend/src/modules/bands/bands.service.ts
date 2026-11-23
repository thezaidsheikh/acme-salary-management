import { toUsd } from "../../shared/analytics.js";
import { ApiError } from "../../shared/errors.js";
import type { BandRepository } from "./bands.repository.js";
import type {
  BandPosition,
  BandSalaryPoint,
  BandSummary,
  EmployeeBandInfo,
  SalaryBand,
} from "./bands.types.js";

// Pattern: Service layer — all band business rules live here, not in
// controllers or repositories. Pattern: DI — the repository arrives via
// the constructor as the BandRepository interface (SOLID Dependency
// Inversion), so this service never knows about Postgres or memory.

/**
 * Round to 2 decimals (compa-ratio precision). Math.round on the scaled
 * value avoids the string round-trip of toFixed.
 * @param n Number to round.
 * @returns The number rounded to 2 decimal places.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The fail-fast error for a level with no band: the database was not
 * migrated (migration 002 seeds all six levels), so returning employees
 * without band fields would silently hide a broken deploy.
 * @param level Level name with no band.
 * @returns An ApiError with status 500.
 */
function missingBandError(level: string): ApiError {
  return new ApiError(
    500,
    `No salary band for level "${level}" — salary_bands is missing this level (run migration 002).`,
  );
}

/**
 * Classify a USD salary against its band — pure function, no I/O, so it
 * is unit-testable on its own. Compa-ratio is salary / band midpoint:
 * 1.00 means exactly at midpoint, below 1.00 under it, above 1.00 over
 * it. Position is "below" under the band minimum, "above" over the band
 * maximum, and "within" everywhere in between (edges included: a salary
 * exactly at min or max is within the band).
 * @param salaryUsd Monthly salary converted to USD.
 * @param band The level's band (USD).
 * @returns The compa-ratio (2 decimals) and the band position.
 */
export function classifySalary(
  salaryUsd: number,
  band: SalaryBand,
): { compaRatio: number; bandPosition: BandPosition } {
  const compaRatio = round2(salaryUsd / band.midSalary);
  const bandPosition: BandPosition =
    salaryUsd < band.minSalary ? "below" : salaryUsd > band.maxSalary ? "above" : "within";
  return { compaRatio, bandPosition };
}

/** The employee fields band enrichment needs (no names, no ids). */
export type BandEmployeeInput = Pick<BandSalaryPoint, "level" | "baseSalary" | "currency">;

/**
 * Salary-band business logic: look bands up, convert a local salary to
 * USD at the fixed FX rate, and classify it against its level's band.
 * The conversion reuses the same fixed rates the seed used to generate
 * salaries (shared/analytics.ts), so compa-ratio compares like for like:
 * a Senior in India earning band-minimum in INR converts back to the
 * band minimum in USD. See docs/TRADEOFFS.md for why the rates are fixed.
 */
export class BandService {
  /**
   * @param repo Band store, injected as the interface (Pg or InMemory).
   */
  constructor(private repo: BandRepository) {}

  /**
   * All bands, ordered by min salary ascending.
   * @returns The level bands.
   */
  getAll(): Promise<SalaryBand[]> {
    return this.repo.getAll();
  }

  /**
   * One band by level name.
   * @param level Level name, e.g. "Senior".
   * @returns The band, or null when the level has none.
   */
  getByLevel(level: string): Promise<SalaryBand | null> {
    return this.repo.getByLevel(level);
  }

  /**
   * Band info for one employee: convert their local salary to USD, then
   * classify it against their level's band.
   * @param employee The employee's level, salary and currency.
   * @returns The band, compa-ratio and position — or null when the level
   *   has no band (unknown level), so the caller can omit band fields
   *   instead of inventing numbers.
   */
  async enrich(employee: BandEmployeeInput): Promise<EmployeeBandInfo | null> {
    const band = await this.repo.getByLevel(employee.level);
    if (!band) return null;
    const salaryUsd = toUsd(employee.baseSalary, employee.currency);
    return { band, ...classifySalary(salaryUsd, band) };
  }

  /**
   * Band info for many employees with a single band lookup: loads all
   * bands once, then classifies each employee in memory. Used by the
   * employee list, where one query per row would be N+1.
   * @param employees Employees to enrich.
   * @returns One band info per employee (null where the level has no band).
   */
  async enrichMany(employees: BandEmployeeInput[]): Promise<(EmployeeBandInfo | null)[]> {
    const bands = await this.repo.getAll();
    const byLevel = new Map(bands.map((b) => [b.level, b]));
    return employees.map((e) => {
      const band = byLevel.get(e.level);
      if (!band) return null;
      return { band, ...classifySalary(toUsd(e.baseSalary, e.currency), band) };
    });
  }

  /**
   * Band info for one employee, failing fast when the level has no band.
   * @param employee The employee's level, salary and currency.
   * @returns The band, compa-ratio and position.
   * @throws ApiError 500 when the level has no band.
   */
  async enrichRequired(employee: BandEmployeeInput): Promise<EmployeeBandInfo> {
    const info = await this.enrich(employee);
    if (!info) throw missingBandError(employee.level);
    return info;
  }

  /**
   * Band info for many employees with a single band lookup, failing fast
   * when any level has no band (same reason as enrichRequired).
   * @param employees Employees to enrich.
   * @returns One band info per employee, in the same order.
   * @throws ApiError 500 when any level has no band.
   */
  async enrichManyRequired(employees: BandEmployeeInput[]): Promise<EmployeeBandInfo[]> {
    const infos = await this.enrichMany(employees);
    return infos.map((info, i) => {
      if (!info) throw missingBandError(employees[i].level);
      return info;
    });
  }

  /**
   * Count how many salary points sit below / within / above their band.
   * Points whose level has no band are skipped (they cannot be classified,
   * and guessing would corrupt the counts).
   * @param points Salary points to classify (level, salary, currency).
   * @returns The below / within / above counts.
   */
  async summarize(points: BandSalaryPoint[]): Promise<BandSummary> {
    const bands = await this.repo.getAll();
    const byLevel = new Map(bands.map((b) => [b.level, b]));
    const summary: BandSummary = { below: 0, within: 0, above: 0 };
    for (const p of points) {
      const band = byLevel.get(p.level);
      if (!band) continue;
      summary[classifySalary(toUsd(p.baseSalary, p.currency), band).bandPosition]++;
    }
    return summary;
  }
}
