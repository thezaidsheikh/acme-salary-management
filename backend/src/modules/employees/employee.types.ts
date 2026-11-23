import type { EmployeeBandInfo } from "../bands/index.js";

/** One employee row as the rest of the app sees it (camelCase, app types). */
export interface EmployeeRow {
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
  dateOfJoining: Date;
  employmentStatus: string;
  baseSalary: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One salary-change audit row from salary_history. */
export interface SalaryHistoryRow {
  id: string;
  employeeId: string;
  oldSalary: number;
  newSalary: number;
  currency: string;
  reason: string;
  changedBy: string;
  changedAt: Date;
}

/**
 * One company-wide audit-log row: a salary-history row joined with the
 * employee it belongs to, so the log can say who changed whose salary.
 * `employeeName` is "First Last"; `department` is the employee's
 * department at read time (the history table stores no department).
 */
export interface AuditLogRow {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  oldSalary: number;
  newSalary: number;
  currency: string;
  reason: string;
  changedBy: string;
  changedAt: Date;
}

/**
 * Filters an audit-log query can apply; all optional, combined with AND.
 * `search` matches an employee id exactly, or a name/email substring.
 * `from`/`to` are YYYY-MM-DD dates, inclusive on both ends.
 */
export interface AuditLogFilters {
  search?: string;
  department?: string;
  from?: string;
  to?: string;
}

/** Filters a list/export query can apply; all optional, combined with AND. */
export interface EmployeeFilters {
  search?: string;
  department?: string;
  country?: string;
  level?: string;
}

/** Minimal salary data point used by analytics (no names, no ids). */
export interface SalaryPoint {
  department: string;
  country: string;
  level: string;
  baseSalary: number;
  currency: string;
}

/** Fields a caller supplies to create an employee (id/timestamps assigned). */
export type EmployeeCreateData = Omit<EmployeeRow, "id" | "createdAt" | "updatedAt" | "employmentStatus">;

/** An employee plus their salary history, as GET /api/employees/:id returns. */
export type EmployeeWithHistory = EmployeeRow & { salaryHistory: SalaryHistoryRow[] };

/** An employee plus their salary-band info, as list/create return. */
export type EmployeeWithBand = EmployeeRow & EmployeeBandInfo;

/** An employee with history plus band info, as GET /api/employees/:id returns. */
export type EmployeeDetail = EmployeeWithHistory & EmployeeBandInfo;

/** One row the CSV import could not import: its file row number + why. */
export interface ImportRowFailure {
  row: number;
  reason: string;
}

/**
 * Per-row report of a CSV import: how many data rows the file held, how
 * many were imported, and every failed row with its number and reason.
 * `imported + failed.length` always equals `totalRows`.
 */
export interface ImportReport {
  totalRows: number;
  imported: number;
  failed: ImportRowFailure[];
}
