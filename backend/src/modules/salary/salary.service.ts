import { badRequest, notFound } from "../../shared/errors.js";
import type { BandService } from "../bands/index.js";
import type { EmployeeRepository } from "../employees/index.js";
import type { EmployeeWithBand, SalaryHistoryRow } from "../employees/index.js";
import type { UpdateSalaryInput } from "../employees/employee.validation.js";

// Pattern: Service layer + DI — SalaryService depends only on the
// EmployeeRepository interface (imported through the employees module's
// public API), never on its Pg class or SQL (SOLID Dependency Inversion).
// The atomic update + history write is the repository's job; the rule
// "new salary must differ" is this service's job. The returned employee
// carries their band info, attached by the injected BandService.

/**
 * Salary-change business logic: validate the rule, delegate the atomic
 * update to the repository. Kept separate from EmployeeService so each
 * service has one reason to change.
 */
export class SalaryService {
  /**
   * @param repo Employee store, injected as the interface.
   * @param bands Band logic, injected (built from the same pool/repo by
   *   the module factory when the caller does not pass one).
   */
  constructor(
    private repo: EmployeeRepository,
    private bands: BandService,
  ) {}

  /**
   * Change an employee's salary.
   * Why load first: the "must differ" rule needs the current salary, and
   * a missing employee must 404 before any write is attempted.
   * @param id Employee id.
   * @param input Validated payload (newSalary, reason, optional changedBy).
   * @returns The updated employee (with band info) and the new history row.
   * @throws ApiError 404 when the employee does not exist; 400 when the
   * new salary equals the current one.
   */
  async updateSalary(
    id: string,
    input: UpdateSalaryInput,
  ): Promise<{ employee: EmployeeWithBand; history: SalaryHistoryRow }> {
    const current = await this.repo.getById(id);
    if (!current) throw notFound("Employee");
    if (input.newSalary === current.baseSalary) {
      throw badRequest("newSalary must differ from the current salary");
    }
    const result = await this.repo.updateSalary(
      id,
      input.newSalary,
      input.reason,
      input.changedBy ?? "HR Manager",
    );
    if (!result) throw notFound("Employee");
    return {
      employee: { ...result.employee, ...(await this.bands.enrichRequired(result.employee)) },
      history: result.history,
    };
  }
}
