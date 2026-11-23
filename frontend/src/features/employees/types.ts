/**
 * Shared domain types for employees and analytics.
 * Single source of truth — no other file re-declares these shapes.
 */

/** One salary band: monthly USD [min, mid, max] for a level. */
export interface SalaryBand {
  level: string;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
}

/** Where a salary sits against its band. */
export type BandPosition = "below" | "within" | "above";

/** Employees below / within / above their level's salary band. */
export interface BandSummary {
  below: number;
  within: number;
  above: number;
}

/** An employee record as returned by the backend. */
export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  country: string;
  currency: string;
  jobTitle: string;
  level: string;
  managerId: string | null;
  dateOfJoining: string;
  employmentStatus: string;
  baseSalary: number;
  /** The employee's level band (monthly USD). */
  band: SalaryBand;
  /** Salary / band midpoint, 2 decimals: 1.00 is exactly at midpoint. */
  compaRatio: number;
  /** Where the salary sits against the band. */
  bandPosition: BandPosition;
}

/** One entry in an employee's salary-change history. */
export interface SalaryHistory {
  id: string;
  oldSalary: number;
  newSalary: number;
  currency: string;
  reason: string;
  changedBy: string;
  changedAt: string;
}

/** Pagination metadata returned with employee lists. */
export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Dashboard analytics summary (all USD figures are FX-normalised). */
export interface Analytics {
  totalEmployees: number;
  payrollByCurrency: { currency: string; count: number; total: number; average: number; median: number }[];
  averageSalaryUsd: number;
  medianSalaryUsd: number;
  byDepartment: { name: string; count: number; averageUsd: number; medianUsd: number }[];
  byCountry: { name: string; count: number; averageUsd: number; medianUsd: number }[];
  byLevel: { name: string; count: number; averageUsd: number; medianUsd: number }[];
  distributionUsd: { bucket: string; count: number }[];
  /** Employees below / within / above their level's salary band. */
  bandSummary: BandSummary;
  topEarners: { name: string; jobTitle: string; department: string; country: string; baseSalary: number; currency: string; usd: number }[];
  outliers: { name: string; department: string; baseSalary: number; currency: string; usd: number; departmentMedianUsd: number }[];
}
