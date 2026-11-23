/**
 * Public API of the audit module: types, the service and the module
 * factory. The module consumes the employees module only through its
 * public API (the EmployeeRepository interface) — never its repository
 * class or SQL — and reads the salary_history table that module owns;
 * it writes nothing of its own.
 */
export type { AuditLogFilters, AuditLogRow } from "./audit.types.js";
export type { AuditLogQuery } from "./audit.validation.js";
export { AuditService } from "./audit.service.js";
export { createAuditModule } from "./audit.factory.js";
