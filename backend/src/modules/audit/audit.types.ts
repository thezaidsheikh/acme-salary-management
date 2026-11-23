/**
 * Audit-log types. The row and filter shapes live with the store that
 * owns them (employees/employee.types.ts — salary_history is that
 * module's table) and are re-exported here, so audit consumers import
 * through this module's public API only.
 */
export type { AuditLogFilters, AuditLogRow } from "../employees/employee.types.js";
