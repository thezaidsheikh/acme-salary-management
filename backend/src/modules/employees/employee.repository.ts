import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ListQuery } from "./employee.validation.js";
import type { AuditLogQuery } from "../audit/audit.validation.js";
import type {
  AuditLogFilters,
  AuditLogRow,
  EmployeeCreateData,
  EmployeeFilters,
  EmployeeRow,
  EmployeeWithHistory,
  SalaryHistoryRow,
  SalaryPoint,
} from "./employee.types.js";

// Pattern: Repository — services depend on this small interface, never on
// SQL or on a concrete class, so a new store needs no service change (SOLID
// Open/Closed + Dependency Inversion).
export interface EmployeeRepository {
  /** Paged, filtered, sorted employee list plus the un-paged total. */
  list(filters: EmployeeFilters, q: ListQuery): Promise<{ items: EmployeeRow[]; total: number }>;
  /** One employee with salary history, or null when the id does not exist. */
  getById(id: string): Promise<EmployeeWithHistory | null>;
  /** Insert an employee; rejects on a duplicate email (unique violation). */
  create(data: EmployeeCreateData): Promise<EmployeeRow>;
  /** Emails from the list that already exist (CSV import duplicate check). */
  existingEmails(emails: string[]): Promise<Set<string>>;
  /**
   * Insert many employees in ONE transaction; all or nothing — any
   * failure (e.g. a duplicate email) rolls the whole batch back, so no
   * partial silent state is ever left behind.
   */
  createMany(data: EmployeeCreateData[]): Promise<EmployeeRow[]>;
  /** Atomically set a salary and append a history row; null when id missing. */
  updateSalary(
    id: string,
    newSalary: number,
    reason: string,
    changedBy: string,
  ): Promise<{ employee: EmployeeRow; history: SalaryHistoryRow } | null>;
  /** Every employee's salary point, for analytics (no paging). */
  salaryPoints(): Promise<SalaryPoint[]>;
  /** Every employee matching the filters, for the CSV export. */
  allForExport(filters: EmployeeFilters): Promise<EmployeeRow[]>;
  /**
   * Company-wide salary-change audit log: salary_history joined with
   * employees, newest first, paged. This is the audit module's read —
   * the history table has exactly one owner (this repository), so the
   * audit log reads it here instead of through a second store.
   */
  listAuditLog(
    filters: AuditLogFilters,
    q: AuditLogQuery,
  ): Promise<{ items: AuditLogRow[]; total: number }>;
}

/**
 * Map one raw Postgres row (snake_case columns) to an EmployeeRow.
 * @param r Raw row from pg.
 * @returns The camelCase employee.
 */
function mapEmployee(r: Record<string, unknown>): EmployeeRow {
  return {
    id: r.id as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: r.email as string,
    department: r.department as string,
    country: r.country as string,
    currency: r.currency as string,
    jobTitle: r.job_title as string,
    level: r.level as string,
    managerId: (r.manager_id as string | null) ?? null,
    dateOfJoining: new Date(r.date_of_joining as string),
    employmentStatus: r.employment_status as string,
    baseSalary: Number(r.base_salary),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

/**
 * Map one raw salary_history row to a SalaryHistoryRow.
 * @param r Raw row from pg.
 * @returns The camelCase history row.
 */
function mapHistory(r: Record<string, unknown>): SalaryHistoryRow {
  return {
    id: r.id as string,
    employeeId: r.employee_id as string,
    oldSalary: Number(r.old_salary),
    newSalary: Number(r.new_salary),
    currency: r.currency as string,
    reason: r.reason as string,
    changedBy: r.changed_by as string,
    changedAt: new Date(r.changed_at as string),
  };
}

/**
 * Map one joined salary_history + employees row to an AuditLogRow.
 * @param r Raw row from pg (history columns + employee name/department).
 * @returns The camelCase audit row.
 */
function mapAuditLog(r: Record<string, unknown>): AuditLogRow {
  return {
    id: r.id as string,
    employeeId: r.employee_id as string,
    employeeName: `${r.first_name as string} ${r.last_name as string}`,
    department: r.department as string,
    oldSalary: Number(r.old_salary),
    newSalary: Number(r.new_salary),
    currency: r.currency as string,
    reason: r.reason as string,
    changedBy: r.changed_by as string,
    changedAt: new Date(r.changed_at as string),
  };
}

const COLS =
  "id, first_name, last_name, email, department, country, currency, job_title, level, manager_id, date_of_joining, employment_status, base_salary, created_at, updated_at";
/** Query sort keys the API accepts, mapped to real column names. */
const SORTABLE: Record<string, string> = {
  baseSalary: "base_salary",
  lastName: "last_name",
  dateOfJoining: "date_of_joining",
};

/**
 * Minimal query surface shared by a Pool and a checked-out PoolClient,
 * so one insert helper serves both single inserts and transactions.
 */
interface QueryExecutor {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Postgres implementation of EmployeeRepository — the only class that
 * knows SQL. All values are bound parameters; sort column/direction come
 * from the allow-listed SORTABLE map, never from raw user input.
 */
export class PgEmployeeRepository implements EmployeeRepository {
  /**
   * @param pool Postgres pool to run queries against.
   */
  constructor(private pool: Pool) {}

  /**
   * Build the WHERE clause for list/export filters, appending bound
   * values to `params` in placeholder order.
   * @param f Filters to apply.
   * @param params Bound values, extended in place.
   * @returns The WHERE clause, or "" when no filter is set.
   */
  private where(f: EmployeeFilters, params: unknown[]): string {
    const clauses: string[] = [];
    if (f.department) {
      params.push(f.department);
      clauses.push(`department = $${params.length}`);
    }
    if (f.country) {
      params.push(f.country);
      clauses.push(`country = $${params.length}`);
    }
    if (f.level) {
      params.push(f.level);
      clauses.push(`level = $${params.length}`);
    }
    if (f.search) {
      params.push(`%${f.search}%`);
      clauses.push(
        `(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`,
      );
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  /**
   * List employees with filters, sorting and paging.
   * @param f Filters (department/country/level/search).
   * @param q Validated list query (sort, page, pageSize).
   * @returns The page of employees and the total matching count.
   */
  async list(f: EmployeeFilters, q: ListQuery): Promise<{ items: EmployeeRow[]; total: number }> {
    const params: unknown[] = [];
    const where = this.where(f, params);
    const sortCol = SORTABLE[q.sortBy] ?? "last_name";
    const sortDir = q.sortOrder === "desc" ? "DESC" : "ASC";
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.pool.query(
      `SELECT ${COLS} FROM employees ${where} ORDER BY ${sortCol} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, offset],
    );
    const total = await this.pool.query(
      `SELECT COUNT(*)::int AS c FROM employees ${where}`,
      params,
    );
    return { items: rows.rows.map(mapEmployee), total: total.rows[0].c as number };
  }

  /**
   * Fetch one employee plus their salary history (newest first).
   * @param id Employee UUID.
   * @returns The employee with history, or null when not found.
   */
  async getById(id: string): Promise<EmployeeWithHistory | null> {
    const e = await this.pool.query(`SELECT ${COLS} FROM employees WHERE id = $1`, [id]);
    if (e.rows.length === 0) return null;
    const h = await this.pool.query(
      "SELECT id, employee_id, old_salary, new_salary, currency, reason, changed_by, changed_at FROM salary_history WHERE employee_id = $1 ORDER BY changed_at DESC",
      [id],
    );
    return { ...mapEmployee(e.rows[0]), salaryHistory: h.rows.map(mapHistory) };
  }

  /**
   * Insert one employee through a pool or a checked-out transaction
   * client. Kept as a helper (rather than inlined in `create`) so the
   * single-row INSERT lives beside `createMany`'s multi-row one.
   * @param executor Pool (single insert) or client (inside a transaction).
   * @param data Employee fields (no id/timestamps/status).
   * @returns The inserted employee row.
   */
  private async insert(
    executor: QueryExecutor,
    data: EmployeeCreateData,
  ): Promise<EmployeeRow> {
    const r = await executor.query(
      `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, manager_id, date_of_joining, base_salary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLS}`,
      [
        randomUUID(),
        data.firstName,
        data.lastName,
        data.email,
        data.department,
        data.country,
        data.currency,
        data.jobTitle,
        data.level,
        data.managerId,
        data.dateOfJoining,
        data.baseSalary,
      ],
    );
    return mapEmployee(r.rows[0]);
  }

  /**
   * Insert an employee. The database enforces the unique email; a
   * duplicate surfaces as a Postgres unique-violation error, which the
   * service maps to a 400.
   * @param data Employee fields (no id/timestamps/status).
   * @returns The inserted employee row.
   */
  async create(data: EmployeeCreateData): Promise<EmployeeRow> {
    return this.insert(this.pool, data);
  }

  /**
   * Which of the given emails already exist (one query, for the CSV
   * import's duplicate check — the service reports those rows as failed
   * instead of letting the insert crash). One `IN` placeholder per
   * email: pg-mem does not resolve `= ANY($1)` over an array parameter.
   * @param emails Emails to look up; empty list needs no query.
   * @returns The subset that already exists.
   */
  async existingEmails(emails: string[]): Promise<Set<string>> {
    if (emails.length === 0) return new Set();
    const placeholders = emails.map((_, i) => `$${i + 1}`).join(",");
    const r = await this.pool.query(
      `SELECT email FROM employees WHERE email IN (${placeholders})`,
      emails,
    );
    return new Set(r.rows.map((x) => x.email as string));
  }

  /**
   * Insert many employees as ONE multi-row INSERT statement. A single
   * statement runs in a single implicit transaction, so every row
   * commits together or a failure anywhere (e.g. a duplicate email)
   * inserts nothing — no partial silent state, and no explicit
   * BEGIN/COMMIT round-trips.
   * @param data Employees to insert; empty list inserts nothing.
   * @returns The inserted rows.
   */
  async createMany(data: EmployeeCreateData[]): Promise<EmployeeRow[]> {
    if (data.length === 0) return [];
    const values: unknown[] = [];
    const tuples = data
      .map((d, j) => {
        const o = j * 12;
        values.push(
          randomUUID(),
          d.firstName,
          d.lastName,
          d.email,
          d.department,
          d.country,
          d.currency,
          d.jobTitle,
          d.level,
          d.managerId,
          d.dateOfJoining,
          d.baseSalary,
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
      })
      .join(",");
    const r = await this.pool.query(
      `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, manager_id, date_of_joining, base_salary)
       VALUES ${tuples} RETURNING ${COLS}`,
      values,
    );
    return r.rows.map(mapEmployee);
  }

  /**
   * Atomically update a salary and append its history row in one
   * transaction, locking the employee row so two concurrent updates
   * cannot interleave. Rolls back on any failure.
   * @param id Employee UUID.
   * @param newSalary New monthly base salary.
   * @param reason Why the salary changed (audit trail).
   * @param changedBy Who made the change.
   * @returns Updated employee + history row, or null when id is missing.
   */
  async updateSalary(
    id: string,
    newSalary: number,
    reason: string,
    changedBy: string,
  ): Promise<{ employee: EmployeeRow; history: SalaryHistoryRow } | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const emp = await client.query(
        `SELECT ${COLS} FROM employees WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (emp.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const current = mapEmployee(emp.rows[0]);
      const updated = await client.query(
        `UPDATE employees SET base_salary = $1, updated_at = now() WHERE id = $2 RETURNING ${COLS}`,
        [newSalary, id],
      );
      const hist = await client.query(
        `INSERT INTO salary_history (id, employee_id, old_salary, new_salary, currency, reason, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, employee_id, old_salary, new_salary, currency, reason, changed_by, changed_at`,
        [randomUUID(), id, current.baseSalary, newSalary, current.currency, reason, changedBy],
      );
      await client.query("COMMIT");
      return { employee: mapEmployee(updated.rows[0]), history: mapHistory(hist.rows[0]) };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * All salary points for analytics.
   * @returns One point per employee.
   */
  async salaryPoints(): Promise<SalaryPoint[]> {
    const r = await this.pool.query(
      "SELECT department, country, level, base_salary, currency FROM employees",
    );
    return r.rows.map((x) => ({
      department: x.department as string,
      country: x.country as string,
      level: x.level as string,
      baseSalary: Number(x.base_salary),
      currency: x.currency as string,
    }));
  }

  /**
   * All employees matching the filters, ordered by last name, for export.
   * @param f Filters to apply.
   * @returns The matching employees (no paging).
   */
  async allForExport(f: EmployeeFilters): Promise<EmployeeRow[]> {
    const params: unknown[] = [];
    const where = this.where(f, params);
    const r = await this.pool.query(
      `SELECT ${COLS} FROM employees ${where} ORDER BY last_name ASC`,
      params,
    );
    return r.rows.map(mapEmployee);
  }

  /**
   * Build the WHERE clause for the audit log, appending bound values to
   * `params` in placeholder order. Search matches an employee id exactly
   * (`id::text`, so a non-UUID search string never errors on the UUID
   * column) or a first/last-name or email substring. The date range is
   * inclusive on both ends: `from` is the start of that day, `to` the
   * end of that day, so a change at any time on the `to` date counts.
   * @param f Audit filters to apply.
   * @param params Bound values, extended in place.
   * @returns The WHERE clause, or "" when no filter is set.
   */
  private auditWhere(f: AuditLogFilters, params: unknown[]): string {
    const clauses: string[] = [];
    if (f.search) {
      params.push(f.search);
      const idParam = params.length;
      params.push(`%${f.search}%`);
      const likeParam = params.length;
      clauses.push(
        `(e.id::text = $${idParam} OR e.first_name ILIKE $${likeParam} OR e.last_name ILIKE $${likeParam} OR e.email ILIKE $${likeParam})`,
      );
    }
    if (f.department) {
      params.push(f.department);
      clauses.push(`e.department = $${params.length}`);
    }
    if (f.from) {
      params.push(`${f.from}T00:00:00.000Z`);
      clauses.push(`h.changed_at >= $${params.length}`);
    }
    if (f.to) {
      params.push(`${f.to}T23:59:59.999Z`);
      clauses.push(`h.changed_at <= $${params.length}`);
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  /**
   * Company-wide audit log: every salary change, newest first. The JOIN
   * brings in the employee name and department; the history table itself
   * stores neither. Ordering is `changed_at DESC, id DESC` — the id
   * tie-break keeps the order deterministic when two changes share a
   * timestamp (same-millisecond writes). The existing
   * `idx_salary_history_employee (employee_id, changed_at)` index serves
   * the per-employee case; the company-wide scan reads the small
   * history table, not the 10,000-row employee table.
   * @param f Audit filters (search/department/date range).
   * @param q Validated audit query (page, pageSize).
   * @returns The page of audit rows and the total matching count.
   */
  async listAuditLog(
    f: AuditLogFilters,
    q: AuditLogQuery,
  ): Promise<{ items: AuditLogRow[]; total: number }> {
    const params: unknown[] = [];
    const where = this.auditWhere(f, params);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await this.pool.query(
      `SELECT h.id, h.employee_id, e.first_name, e.last_name, e.department, h.old_salary, h.new_salary, h.currency, h.reason, h.changed_by, h.changed_at
       FROM salary_history h JOIN employees e ON e.id = h.employee_id ${where}
       ORDER BY h.changed_at DESC, h.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, offset],
    );
    const total = await this.pool.query(
      `SELECT COUNT(*)::int AS c FROM salary_history h JOIN employees e ON e.id = h.employee_id ${where}`,
      params,
    );
    return { items: rows.rows.map(mapAuditLog), total: total.rows[0].c as number };
  }
}

// Pattern: Repository — InMemoryEmployeeRepository is a second, swappable
// implementation of the same interface. Tests substitute it for Pg (SOLID
// Liskov: any EmployeeRepository works wherever the interface is expected),
// and no service code changes between the two.

/**
 * In-memory implementation of EmployeeRepository — used by unit/API tests,
 * no database needed. Mirrors the Postgres semantics, including the
 * unique-email rule (throws an error mentioning "unique").
 */
export class InMemoryEmployeeRepository implements EmployeeRepository {
  /** Seeded employees; tests assign this directly. */
  employees: EmployeeRow[] = [];
  /** Salary history rows, appended by updateSalary. */
  history: SalaryHistoryRow[] = [];

  /**
   * Apply department/country/level/search filters (AND) to a list.
   * Search is a case-insensitive substring over name + email, matching
   * the ILIKE behaviour of the Postgres implementation.
   * @param items Employees to filter.
   * @param f Filters to apply.
   * @returns The filtered employees.
   */
  private applyFilters(items: EmployeeRow[], f: EmployeeFilters): EmployeeRow[] {
    return items.filter(
      (e) =>
        (!f.department || e.department === f.department) &&
        (!f.country || e.country === f.country) &&
        (!f.level || e.level === f.level) &&
        (!f.search ||
          `${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(f.search.toLowerCase())),
    );
  }

  /**
   * List employees with filters, sorting and paging (same contract as Pg).
   * @param f Filters to apply.
   * @param q Validated list query (sort, page, pageSize).
   * @returns The page of employees and the total matching count.
   */
  async list(
    f: EmployeeFilters,
    q: ListQuery,
  ): Promise<{ items: EmployeeRow[]; total: number }> {
    const filtered = this.applyFilters(this.employees, f);
    const sorted = [...filtered].sort((a, b) => {
      const av = a[q.sortBy as keyof EmployeeRow] as string | number | Date;
      const bv = b[q.sortBy as keyof EmployeeRow] as string | number | Date;
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return q.sortOrder === "desc" ? -c : c;
    });
    return {
      items: sorted.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: filtered.length,
    };
  }

  /**
   * Fetch one employee plus their salary history (newest first).
   * @param id Employee id.
   * @returns The employee with history, or null when not found.
   */
  async getById(id: string): Promise<EmployeeWithHistory | null> {
    const e = this.employees.find((x) => x.id === id);
    if (!e) return null;
    return {
      ...e,
      salaryHistory: this.history
        .filter((h) => h.employeeId === id)
        .sort((a, b) => +b.changedAt - +a.changedAt),
    };
  }

  /**
   * Build the stored row for new data (fresh id, Active status, now
   * timestamps) — the same shape for `create` and `createMany`.
   * @param data Employee fields (no id/timestamps/status).
   * @returns The row to store.
   */
  private toRow(data: EmployeeCreateData): EmployeeRow {
    return {
      ...data,
      id: `test-${this.employees.length + 1}`,
      employmentStatus: "Active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Insert an employee, rejecting a duplicate email like Postgres does.
   * @param data Employee fields (no id/timestamps/status).
   * @returns The inserted employee row.
   * @throws Error mentioning "unique" when the email already exists.
   */
  async create(data: EmployeeCreateData): Promise<EmployeeRow> {
    if (this.employees.some((x) => x.email === data.email)) {
      throw new Error(
        `duplicate key value violates unique constraint "employees_email_key"`,
      );
    }
    const e = this.toRow(data);
    this.employees.push(e);
    return e;
  }

  /**
   * Which of the given emails already exist (same contract as Pg).
   * @param emails Emails to look up.
   * @returns The subset that already exists.
   */
  async existingEmails(emails: string[]): Promise<Set<string>> {
    const wanted = new Set(emails);
    return new Set(
      this.employees.filter((e) => wanted.has(e.email)).map((e) => e.email),
    );
  }

  /**
   * Insert many employees atomically: the whole batch is checked first,
   * then inserted — a duplicate anywhere (against stored rows or inside
   * the batch) inserts nothing, mirroring the Postgres transaction's
   * rollback.
   * @param data Employees to insert; empty list inserts nothing.
   * @returns The inserted rows, in input order.
   * @throws Error mentioning "unique" when any email already exists.
   */
  async createMany(data: EmployeeCreateData[]): Promise<EmployeeRow[]> {
    const seen = new Set<string>();
    for (const d of data) {
      if (seen.has(d.email) || this.employees.some((e) => e.email === d.email)) {
        throw new Error(
          `duplicate key value violates unique constraint "employees_email_key"`,
        );
      }
      seen.add(d.email);
    }
    const created: EmployeeRow[] = [];
    for (const d of data) {
      const e = this.toRow(d);
      this.employees.push(e);
      created.push(e);
    }
    return created;
  }

  /**
   * Update a salary and append a history row (atomic in memory: a single
   * synchronous mutation, so no partial state is observable).
   * @param id Employee id.
   * @param newSalary New monthly base salary.
   * @param reason Why the salary changed.
   * @param changedBy Who made the change.
   * @returns Updated employee + history row, or null when id is missing.
   */
  async updateSalary(
    id: string,
    newSalary: number,
    reason: string,
    changedBy: string,
  ): Promise<{ employee: EmployeeRow; history: SalaryHistoryRow } | null> {
    const e = this.employees.find((x) => x.id === id);
    if (!e) return null;
    const history: SalaryHistoryRow = {
      id: `h-${this.history.length + 1}`,
      employeeId: id,
      oldSalary: e.baseSalary,
      newSalary,
      currency: e.currency,
      reason,
      changedBy,
      changedAt: new Date(),
    };
    e.baseSalary = newSalary;
    e.updatedAt = new Date();
    this.history.push(history);
    return { employee: e, history };
  }

  /**
   * All salary points for analytics.
   * @returns One point per employee.
   */
  async salaryPoints(): Promise<SalaryPoint[]> {
    return this.employees.map((e) => ({
      department: e.department,
      country: e.country,
      level: e.level,
      baseSalary: e.baseSalary,
      currency: e.currency,
    }));
  }

  /**
   * All employees matching the filters, for export.
   * @param f Filters to apply.
   * @returns The matching employees (no paging).
   */
  async allForExport(f: EmployeeFilters): Promise<EmployeeRow[]> {
    return this.applyFilters(this.employees, f);
  }

  /**
   * Company-wide audit log (same contract as Pg): history rows joined
   * with their employee, newest first, paged. Search matches an employee
   * id exactly or a name/email substring (case-insensitive, matching the
   * ILIKE behaviour of the Postgres implementation); the date range is
   * inclusive on both ends.
   * @param f Audit filters to apply.
   * @param q Validated audit query (page, pageSize).
   * @returns The page of audit rows and the total matching count.
   */
  async listAuditLog(
    f: AuditLogFilters,
    q: AuditLogQuery,
  ): Promise<{ items: AuditLogRow[]; total: number }> {
    const byId = new Map(this.employees.map((e) => [e.id, e]));
    const from = f.from ? new Date(`${f.from}T00:00:00.000Z`) : null;
    const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : null;
    const needle = f.search?.toLowerCase();
    const rows: AuditLogRow[] = [];
    for (const h of this.history) {
      const e = byId.get(h.employeeId);
      if (!e) continue;
      if (
        needle &&
        e.id !== f.search &&
        !`${e.firstName} ${e.lastName} ${e.email}`.toLowerCase().includes(needle)
      ) {
        continue;
      }
      if (f.department && e.department !== f.department) continue;
      if (from && h.changedAt < from) continue;
      if (to && h.changedAt > to) continue;
      rows.push({
        id: h.id,
        employeeId: h.employeeId,
        employeeName: `${e.firstName} ${e.lastName}`,
        department: e.department,
        oldSalary: h.oldSalary,
        newSalary: h.newSalary,
        currency: h.currency,
        reason: h.reason,
        changedBy: h.changedBy,
        changedAt: h.changedAt,
      });
    }
    rows.sort((a, b) => +b.changedAt - +a.changedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return {
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: rows.length,
    };
  }
}
