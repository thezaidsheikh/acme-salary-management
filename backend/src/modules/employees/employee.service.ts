import { paginationMeta } from "../../shared/analytics.js";
import { badRequest, notFound } from "../../shared/errors.js";
import type { BandService } from "../bands/index.js";
import type { EmployeeRepository } from "./employee.repository.js";
import type {
  EmployeeDetail,
  EmployeeRow,
  EmployeeWithBand,
} from "./employee.types.js";
import type { CreateEmployeeInput, ListQuery } from "./employee.validation.js";

// Pattern: Service layer — all employee business rules live here, not in
// controllers or repositories. Pattern: DI — the repository and the band
// service arrive via the constructor as interfaces (SOLID Dependency
// Inversion), so this service never knows about Postgres or memory.

/**
 * Employee business logic: listing, lookup, creation. Salary changes
 * live in the salary module's SalaryService, not here — one service,
 * one reason to change (SOLID Single Responsibility). Every employee
 * this service returns carries their salary-band info (band, compa-ratio,
 * position), attached by the injected BandService.
 */
export class EmployeeService {
  /**
   * @param repo Employee store, injected as the interface (Pg or InMemory).
   * @param bands Band logic, injected (built from the same pool/repo by
   *   the module factory when the caller does not pass one).
   */
  constructor(
    private repo: EmployeeRepository,
    private bands: BandService,
  ) {}

  /**
   * List employees, paged, each with their band info. Bands are loaded
   * once for the whole page (enrichMany), not once per row.
   * @param q Validated list query.
   * @returns `{ data, meta }` in the API's success envelope shape.
   */
  async list(q: ListQuery): Promise<{ data: EmployeeWithBand[]; meta: ReturnType<typeof paginationMeta> }> {
    const { items, total } = await this.repo.list(q, q);
    const infos = await this.bands.enrichManyRequired(items);
    return {
      data: items.map((e, i) => ({ ...e, ...infos[i] })),
      meta: paginationMeta(total, q.page, q.pageSize),
    };
  }

  /**
   * Fetch one employee with salary history and band info.
   * @param id Employee id.
   * @returns The employee with history and band info.
   * @throws ApiError 404 when the id does not exist.
   */
  async getById(id: string): Promise<EmployeeDetail> {
    const e = await this.repo.getById(id);
    if (!e) throw notFound("Employee");
    return { ...e, ...(await this.bands.enrichRequired(e)) };
  }

  /**
   * Create an employee. A duplicate email is a client error (400), not a
   * 500: the repository's unique-violation is translated here.
   * @param input Validated create payload.
   * @returns The created employee, with band info.
   * @throws ApiError 400 when the email already exists.
   */
  async create(input: CreateEmployeeInput): Promise<EmployeeWithBand> {
    try {
      const e = await this.repo.create({
        ...input,
        dateOfJoining: new Date(input.dateOfJoining),
        managerId: input.managerId ?? null,
      });
      return { ...e, ...(await this.bands.enrichRequired(e)) };
    } catch (e: unknown) {
      if (e instanceof Error && /unique/i.test(e.message)) {
        throw badRequest("An employee with this email already exists");
      }
      throw e;
    }
  }
}
