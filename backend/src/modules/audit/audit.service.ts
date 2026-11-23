import { paginationMeta } from "../../shared/analytics.js";
import type { EmployeeRepository } from "../employees/index.js";
import type { AuditLogRow } from "./audit.types.js";
import type { AuditLogQuery } from "./audit.validation.js";

// Pattern: Service layer — the audit read's only rule (newest first,
// server-paged, same `{ data, meta }` envelope as the employee list)
// lives here, not in the controller or repository. Pattern: DI — the
// repository arrives via the constructor as the EmployeeRepository
// interface (SOLID Dependency Inversion), so this service never knows
// about Postgres or memory. The audit log is a READ of the salary
// history the salary module already writes: this service writes
// nothing, and no second audit store exists.

/**
 * Company-wide audit-log business logic: one paged, filtered read over
 * every salary change in the org. Kept separate from SalaryService (one
 * service, one reason to change): SalaryService owns the write + its
 * rule, this one owns the company-wide read.
 */
export class AuditService {
  /**
   * @param repo Employee store, injected as the interface (Pg or InMemory).
   *   Its listAuditLog is the single read over the salary_history table.
   */
  constructor(private repo: EmployeeRepository) {}

  /**
   * List audit rows, newest first, paged. Filters and paging ride on the
   * same validated query object the repository takes (the employee list
   * does the same with its ListQuery).
   * @param q Validated audit query (search/department/date range/page).
   * @returns `{ data, meta }` in the API's success envelope shape.
   */
  async list(q: AuditLogQuery): Promise<{ data: AuditLogRow[]; meta: ReturnType<typeof paginationMeta> }> {
    const { items, total } = await this.repo.listAuditLog(q, q);
    return { data: items, meta: paginationMeta(total, q.page, q.pageSize) };
  }
}
