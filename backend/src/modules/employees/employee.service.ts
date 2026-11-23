import { paginationMeta } from "../../shared/analytics.js";
import { badRequest, notFound } from "../../shared/errors.js";
import type { BandService } from "../bands/index.js";
import { EMPLOYEE_CSV_COLUMNS, parseCsv } from "./employee.csv.js";
import type { EmployeeRepository } from "./employee.repository.js";
import type {
  EmployeeDetail,
  EmployeeRow,
  EmployeeWithBand,
  ImportReport,
  ImportRowFailure,
} from "./employee.types.js";
import { createEmployeeSchema } from "./employee.validation.js";
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

  /**
   * Import employees from CSV text (the Excel-migration path: HR exports
   * the old spreadsheet to CSV and uploads it). Every row is validated
   * with the same `createEmployeeSchema` the single-create endpoint
   * uses — no second validation — and all valid rows are inserted in
   * ONE repository transaction. One bad row never blocks the good ones:
   * every failure is reported with its file row number (header is row
   * 1) and reason, and `imported + failed.length` always equals
   * `totalRows`. Duplicate emails — inside the file or already stored —
   * are reported as failed rows, never a crash.
   * @param csvText Raw CSV text; header must be exactly the export columns.
   * @returns The per-row import report.
   * @throws ApiError 400 when the file is empty or the header is wrong.
   */
  async importEmployees(csvText: string): Promise<ImportReport> {
    const rows = parseCsv(csvText);
    if (rows.length === 0) throw badRequest("CSV file is empty");
    const header = rows[0].map((h) => h.trim());
    if (
      header.length !== EMPLOYEE_CSV_COLUMNS.length ||
      header.some((h, i) => h !== EMPLOYEE_CSV_COLUMNS[i])
    ) {
      throw badRequest(`CSV header must be exactly: ${EMPLOYEE_CSV_COLUMNS.join(",")}`);
    }
    const failures: ImportRowFailure[] = [];
    // Valid rows, kept with their file row number for duplicate reporting.
    const valid: { input: CreateEmployeeInput; row: number }[] = [];
    const seenEmails = new Set<string>();
    rows.slice(1).forEach((fields, i) => {
      const rowNumber = i + 2; // header is row 1
      if (fields.every((f) => f.trim() === "")) return; // blank line: skip
      if (fields.length !== EMPLOYEE_CSV_COLUMNS.length) {
        failures.push({
          row: rowNumber,
          reason: `Expected ${EMPLOYEE_CSV_COLUMNS.length} columns, got ${fields.length}`,
        });
        return;
      }
      // Column 0 is `id`: accepted (export round-trip) but ignored — the
      // repository assigns a fresh id. baseSalary arrives as text, so it
      // is converted to a number for the shared schema ("" -> 0 and
      // "abc" -> NaN both fail the schema's positive-integer rule).
      const parsed = createEmployeeSchema.safeParse({
        firstName: fields[1],
        lastName: fields[2],
        email: fields[3].trim(),
        department: fields[4],
        country: fields[5],
        currency: fields[6],
        jobTitle: fields[7],
        level: fields[8],
        dateOfJoining: fields[10].trim(),
        baseSalary: Number(fields[9].trim()),
      });
      if (!parsed.success) {
        failures.push({
          row: rowNumber,
          reason: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
        return;
      }
      if (seenEmails.has(parsed.data.email)) {
        failures.push({ row: rowNumber, reason: "Duplicate email in file" });
        return;
      }
      seenEmails.add(parsed.data.email);
      valid.push({ input: parsed.data, row: rowNumber });
    });
    // One lookup for all emails: rows that already exist fail here, so
    // the bulk insert below never hits a unique violation mid-batch.
    const existing =
      valid.length > 0
        ? await this.repo.existingEmails(valid.map((v) => v.input.email))
        : new Set<string>();
    const toInsert: { input: CreateEmployeeInput; row: number }[] = [];
    for (const v of valid) {
      if (existing.has(v.input.email)) {
        failures.push({
          row: v.row,
          reason: "An employee with this email already exists",
        });
      } else {
        toInsert.push(v);
      }
    }
    failures.sort((a, b) => a.row - b.row);
    const created =
      toInsert.length > 0
        ? await this.repo.createMany(
            toInsert.map((v) => ({
              ...v.input,
              dateOfJoining: new Date(v.input.dateOfJoining),
              managerId: v.input.managerId ?? null,
            })),
          )
        : [];
    return { totalRows: created.length + failures.length, imported: created.length, failed: failures };
  }
}
