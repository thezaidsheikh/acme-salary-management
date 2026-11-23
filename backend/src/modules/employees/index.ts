/**
 * Public API of the employees module. Other modules import through this
 * file only — never through the module's internal files — so the module's
 * boundary stays explicit and refactorable. Only types, the repository
 * interface and the module factory are public; concrete repository
 * classes live in employee.repository.ts.
 */
export type {
  AuditLogFilters,
  AuditLogRow,
  EmployeeCreateData,
  EmployeeDetail,
  EmployeeFilters,
  EmployeeRow,
  EmployeeWithBand,
  EmployeeWithHistory,
  ImportReport,
  ImportRowFailure,
  SalaryHistoryRow,
  SalaryPoint,
} from "./employee.types.js";
export { EMPLOYEE_CSV_COLUMNS, MAX_IMPORT_FILE_BYTES, parseCsv } from "./employee.csv.js";
export type { EmployeeRepository } from "./employee.repository.js";
export { createEmployeeModule } from "./employee.factory.js";
