/** One salary band: monthly USD [min, mid, max] for a level. */
export interface SalaryBand {
  level: string;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
}

/** Where a salary sits against its band. */
export type BandPosition = "below" | "within" | "above";

/** Band info attached to an employee response. */
export interface EmployeeBandInfo {
  band: SalaryBand;
  compaRatio: number;
  bandPosition: BandPosition;
}

/** Counts of employees below / within / above their band. */
export interface BandSummary {
  below: number;
  within: number;
  above: number;
}

/** Minimal salary data a band classification needs (no names, no ids). */
export interface BandSalaryPoint {
  level: string;
  baseSalary: number;
  currency: string;
}
