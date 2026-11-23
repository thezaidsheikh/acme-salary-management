// Live-SQL verification without a Postgres server: runs the real migrations
// + seed + HTTP smoke test against pg-mem (pg-compatible, in-memory).
// Usage: npx tsx scripts/verify-pgmem.ts
import { memPool } from "../tests/pgmem.js";
import { generateEmployees } from "../src/seed/seedData.js";
import { createApp } from "../src/app.js";
import { PgEmployeeRepository } from "../src/modules/employees/employee.repository.js";
import { applyMigrations } from "./migrate.js";

async function main() {
  const started = Date.now();
  // Shared pg-mem setup (tests/pgmem.ts): registers the minimal plpgsql
  // shim the migration's DO blocks need — pg-mem has no plpgsql itself.
  const pool = memPool();
  const applied = await applyMigrations(pool);
  console.log(`migrations: ok (${applied.join(", ")})`);
  const { rows: bandRows } = await pool.query("SELECT COUNT(*)::int AS c FROM salary_bands");
  console.log(`salary_bands: ${bandRows[0].c} rows`);
  if (bandRows[0].c !== 6) throw new Error(`band count wrong: ${bandRows[0].c}`);

  const employees = generateEmployees(10_000, 42);
  const { randomUUID } = await import("node:crypto");
  const ids = employees.map(() => randomUUID());
  const BATCH = 1000;
  for (let i = 0; i < employees.length; i += BATCH) {
    const batch = employees.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders = batch.map((e, j) => {
      const o = j * 12;
      values.push(ids[i + j], e.firstName, e.lastName, e.email, e.department, e.country, e.currency, e.jobTitle, e.level,
        e.managerId ? ids[Number(e.managerId.replace("emp-", ""))] : null, e.dateOfJoining, e.baseSalary);
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
    }).join(",");
    await pool.query(
      `INSERT INTO employees (id, first_name, last_name, email, department, country, currency, job_title, level, manager_id, date_of_joining, base_salary) VALUES ${placeholders}`, values);
  }
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM employees");
  console.log(`seed: ${rows[0].c} employees in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (rows[0].c !== 10_000) throw new Error(`seed count wrong: ${rows[0].c}`);

  const app = createApp(new PgEmployeeRepository(pool));
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}`;
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() as Record<string, any> }; };
  const health = await get("/api/health");
  console.log("GET /api/health:", health.status, JSON.stringify(health.body));
  const list = await get("/api/employees?page=1&pageSize=5");
  console.log("GET /api/employees?page=1&pageSize=5:", list.status, "rows:", list.body.data?.length, "total:", list.body.meta?.total);
  const search = await get("/api/employees?search=Priya&pageSize=3");
  console.log("GET /api/employees?search=Priya:", search.status, "total:", search.body.meta?.total);
  const analytics = await get("/api/analytics/summary");
  console.log("GET /api/analytics/summary:", analytics.status, "totalEmployees:", analytics.body.data?.totalEmployees, "medianUsd:", analytics.body.data?.medianSalaryUsd);
  const firstId = list.body.data[0].id as string;
  const patch = await fetch(`${base}/api/employees/${firstId}/salary`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newSalary: 999999, reason: "Verification check" }) });
  const patchBody = await patch.json() as Record<string, any>;
  console.log("PATCH salary:", patch.status, "old:", patchBody.data?.history?.oldSalary, "new:", patchBody.data?.history?.newSalary);
  const detail = await get(`/api/employees/${firstId}`);
  console.log("GET /api/employees/:id history rows:", detail.body.data?.salaryHistory?.length);
  // Audit log: the PATCH change must appear company-wide, newest first,
  // with the right old/new/reason — the same read the /audit page uses.
  const firstName = (list.body.data[0].firstName as string).split(" ")[0];
  const audit = await get(`/api/audit-log?search=${encodeURIComponent(firstName)}`);
  const auditRow = (audit.body.data as Record<string, unknown>[] | undefined)?.find(
    (x) => x.reason === "Verification check",
  ) as Record<string, any> | undefined;
  console.log("GET /api/audit-log?search=…:", audit.status, "total:", audit.body.meta?.total, "row:", JSON.stringify(auditRow));
  if (audit.status !== 200 || !auditRow || auditRow.oldSalary !== patchBody.data?.history?.oldSalary || auditRow.newSalary !== 999999) {
    throw new Error(`audit log missing the PATCH change: ${JSON.stringify(audit.body)}`);
  }
  const csv = await fetch(`${base}/api/employees/export?format=csv`);
  const csvText = await csv.text();
  console.log("GET export CSV:", csv.status, "lines:", csvText.split("\n").length, "header:", csvText.split("\n")[0]);
  // CSV import: a mixed file (2 good + 1 bad salary + 1 duplicate of the
  // first employee) must import only the good rows and report the rest.
  const existingEmail = list.body.data[0].email as string;
  const mixed = [
    "id,firstName,lastName,email,department,country,currency,jobTitle,level,baseSalary,dateOfJoining",
    ",Import,One,import.one@acme.com,Engineering,India,INR,Software Engineer,Senior,150000,2022-03-01",
    ",Bad,Salary,bad.salary@acme.com,Engineering,India,INR,Engineer,Senior,abc,2022-03-01",
    `,Copy,Existing,${existingEmail},Engineering,India,INR,Engineer,Senior,150000,2022-03-01`,
    ",Import,Two,import.two@acme.com,Design,USA,USD,Designer,Mid,90000,2021-06-15",
  ].join("\n");
  const form = new FormData();
  form.append("file", new Blob([mixed], { type: "text/csv" }), "import.csv");
  const imp = await fetch(`${base}/api/employees/import`, { method: "POST", body: form });
  const impBody = (await imp.json()) as Record<string, any>;
  console.log("POST import CSV:", imp.status, JSON.stringify(impBody.data));
  if (imp.status !== 200 || impBody.data?.imported !== 2 || impBody.data?.failed?.length !== 2) {
    throw new Error(`import report wrong: ${JSON.stringify(impBody.data)}`);
  }
  if (impBody.data.failed.map((f: { row: number }) => f.row).join(",") !== "3,4") {
    throw new Error(`import failed rows wrong: ${JSON.stringify(impBody.data.failed)}`);
  }
  const afterImport = await get("/api/employees?page=1&pageSize=1");
  console.log("total after import:", afterImport.body.meta?.total);
  if (afterImport.body.meta?.total !== 10_002) throw new Error(`total after import wrong: ${afterImport.body.meta?.total}`);
  server.close();
  await pool.end();
  console.log("verify-pgmem: ALL OK");
}
main().catch((e) => { console.error("verify-pgmem FAILED:", e); process.exit(1); });
