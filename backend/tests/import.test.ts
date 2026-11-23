import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { BandService } from "../src/modules/bands/bands.service";
import { InMemoryBandRepository } from "../src/modules/bands/bands.repository";
import { EMPLOYEE_CSV_COLUMNS, parseCsv } from "../src/modules/employees/employee.csv";
import { InMemoryEmployeeRepository } from "../src/modules/employees/employee.repository";
import { EmployeeService } from "../src/modules/employees/employee.service";
import { generateEmployees } from "../src/seed/seedData";

/** The export header, as one CSV line — the import must accept exactly this. */
const HEADER = EMPLOYEE_CSV_COLUMNS.join(",");
/** One valid data row (id column empty: the import assigns a fresh id). */
const ASHA = `,Asha,Patel,asha.patel@acme.com,Engineering,India,INR,Software Engineer,Senior,150000,2022-03-01`;
const ROHAN = `,Rohan,Mehta,rohan.mehta@acme.com,Design,USA,USD,"Engineer, Platform",Mid,90000,2021-06-15`;

function serviceWith(repo: InMemoryEmployeeRepository) {
  return new EmployeeService(repo, new BandService(new InMemoryBandRepository()));
}

function seededApp() {
  const repo = new InMemoryEmployeeRepository();
  repo.employees = generateEmployees(50, 42).map((e, i) => ({
    ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
  }));
  return { app: createApp(repo), repo };
}

describe("parseCsv", () => {
  it("splits plain rows and strips a BOM", () => {
    expect(parseCsv(`\uFEFF${HEADER}\n${ASHA}\n`)).toEqual([
      [...EMPLOYEE_CSV_COLUMNS],
      ["", "Asha", "Patel", "asha.patel@acme.com", "Engineering", "India", "INR", "Software Engineer", "Senior", "150000", "2022-03-01"],
    ]);
  });
  it("handles quoted commas, doubled quotes and CRLF", () => {
    const rows = parseCsv(`a,"b,c","d""e"\r\n"f\ng",h\r\n`);
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["f\ng", "h"],
    ]);
  });
  it("treats a lone CR as a row separator and keeps blank lines as []", () => {
    expect(parseCsv("a,b\rc,d\n\ne,f")).toEqual([["a", "b"], ["c", "d"], [], ["e", "f"]]);
  });
  it("keeps a quote in the middle of a field literal, and an unterminated quote to EOF", () => {
    expect(parseCsv('a"b,c')).toEqual([['a"b', "c"]]);
    expect(parseCsv('"abc\ndef')).toEqual([["abc\ndef"]]);
  });
  it("returns [] for empty text and for a file of only newlines", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([[], []]);
  });
});

describe("EmployeeService.importEmployees", () => {
  let repo: InMemoryEmployeeRepository;
  let service: EmployeeService;
  beforeEach(() => {
    repo = new InMemoryEmployeeRepository();
    service = serviceWith(repo);
  });

  it("imports an all-valid file: every row, fresh ids, empty failed list", async () => {
    const report = await service.importEmployees(`${HEADER}\n${ASHA}\n${ROHAN}\n`);
    expect(report).toEqual({ totalRows: 2, imported: 2, failed: [] });
    expect(repo.employees).toHaveLength(2);
    // The CSV's id column is ignored: both rows got repository ids.
    expect(repo.employees.map((e) => e.id)).toEqual(["test-1", "test-2"]);
    expect(repo.employees[1].jobTitle).toBe("Engineer, Platform");
    expect(repo.employees[0].managerId).toBeNull();
  });

  it("mixed file: imports only the good rows, reports every bad row by number + reason", async () => {
    const existing = generateEmployees(50, 42)[0];
    repo.employees = generateEmployees(50, 42).map((e, i) => ({
      ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
    }));
    const csv = [
      HEADER,
      ASHA, // row 2: valid
      `,Bad,Salary,bad.salary@acme.com,Engineering,India,INR,Engineer,Senior,abc,2022-03-01`, // row 3: bad salary
      `,Bad,Level,bad.level@acme.com,Engineering,India,INR,Engineer,Intern,50000,2022-03-01`, // row 4: bad level
      `,Asha,Again,asha.patel@acme.com,Engineering,India,INR,Engineer,Senior,150000,2022-03-01`, // row 5: duplicate in file
      `,Copy,Existing,${existing.email},Engineering,India,INR,Engineer,Senior,150000,2022-03-01`, // row 6: already stored
      `,Short,Row`, // row 7: too few columns
      ROHAN, // row 8: valid (quoted comma in job title)
      `,Bad,Date,bad.date@acme.com,Engineering,India,INR,Engineer,Senior,50000,01-03-2022`, // row 9: bad date
    ].join("\n");
    const report = await service.importEmployees(csv);
    expect(report.imported).toBe(2);
    expect(report.totalRows).toBe(8);
    expect(report.failed.map((f) => f.row)).toEqual([3, 4, 5, 6, 7, 9]);
    expect(report.failed.find((f) => f.row === 3)?.reason).toMatch(/baseSalary/);
    expect(report.failed.find((f) => f.row === 4)?.reason).toMatch(/level/);
    expect(report.failed.find((f) => f.row === 5)?.reason).toMatch(/Duplicate email in file/);
    expect(report.failed.find((f) => f.row === 6)?.reason).toMatch(/already exists/);
    expect(report.failed.find((f) => f.row === 7)?.reason).toMatch(/Expected 11 columns, got 3/);
    expect(report.failed.find((f) => f.row === 9)?.reason).toMatch(/dateOfJoining/);
    // Only the two good rows were added; none of the bad ones is stored.
    expect(repo.employees).toHaveLength(52);
    expect(repo.employees.some((e) => e.email === "bad.salary@acme.com")).toBe(false);
  });

  it("blank lines are skipped without shifting later row numbers", async () => {
    const report = await service.importEmployees(`${HEADER}\n\n${ASHA}\n\n`);
    expect(report).toEqual({ totalRows: 1, imported: 1, failed: [] });
    const bad = await service.importEmployees(`${HEADER}\n\n,Bad,Salary,bad@acme.com,Engineering,India,INR,Engineer,Senior,abc,2022-03-01`);
    expect(bad.failed).toEqual([{ row: 3, reason: expect.stringContaining("baseSalary") }]);
  });

  it("a file where every row fails imports nothing and reports each row", async () => {
    const report = await service.importEmployees(
      `${HEADER}\n,Bad,Salary,bad@acme.com,Engineering,India,INR,Engineer,Senior,abc,2022-03-01`,
    );
    expect(report).toEqual({
      totalRows: 1,
      imported: 0,
      failed: [{ row: 2, reason: expect.stringContaining("baseSalary") }],
    });
    expect(repo.employees).toHaveLength(0);
  });

  it("a file where every valid row already exists imports nothing", async () => {
    const existing = generateEmployees(50, 42)[0];
    repo.employees = generateEmployees(50, 42).map((e, i) => ({
      ...e, id: `emp-${i}`, employmentStatus: "Active", createdAt: new Date(), updatedAt: new Date(),
    }));
    const report = await service.importEmployees(
      `${HEADER}\n,Copy,Existing,${existing.email},Engineering,India,INR,Engineer,Senior,150000,2022-03-01`,
    );
    expect(report.imported).toBe(0);
    expect(report.failed).toEqual([{ row: 2, reason: "An employee with this email already exists" }]);
    expect(repo.employees).toHaveLength(50);
  });

  it("rejects an empty file and a wrong header; a header-only file imports 0 rows", async () => {
    await expect(service.importEmployees("")).rejects.toThrow(/CSV file is empty/);
    await expect(service.importEmployees("firstName,lastName\nAsha,Patel")).rejects.toThrow(
      /CSV header must be exactly: id,firstName,lastName,email/,
    );
    await expect(service.importEmployees("id,firstName\n1,Asha")).rejects.toThrow(/CSV header must be exactly/);
    await expect(service.importEmployees(`${HEADER}\n`)).resolves.toEqual({
      totalRows: 0, imported: 0, failed: [],
    });
  });

  it("round-trips the export: an exported file (with ids) imports back, ids ignored", async () => {
    const exported = `${HEADER}\nemp-9,Asha,Patel,asha.patel@acme.com,Engineering,India,INR,Software Engineer,Senior,150000,2022-03-01`;
    const report = await service.importEmployees(exported);
    expect(report).toEqual({ totalRows: 1, imported: 1, failed: [] });
    expect(repo.employees[0].id).not.toBe("emp-9");
  });
});

describe("POST /api/employees/import", () => {
  let app: ReturnType<typeof createApp>;
  let repo: InMemoryEmployeeRepository;
  beforeEach(() => {
    ({ app, repo } = seededApp());
  });

  it("imports an all-valid file and grows the list (uppercase .CSV accepted)", async () => {
    const r = await request(app)
      .post("/api/employees/import")
      .attach("file", Buffer.from(`${HEADER}\n${ASHA}\n${ROHAN}\n`), "import.CSV");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ totalRows: 2, imported: 2, failed: [] });
    expect(repo.employees).toHaveLength(52);
    const list = await request(app).get("/api/employees?search=asha.patel@acme.com");
    expect(list.body.meta.total).toBe(1);
  });

  it("mixed file via API: good rows import, bad rows reported, nothing else stored", async () => {
    const existing = repo.employees[0];
    const csv = [
      HEADER,
      ASHA,
      `,Bad,Salary,bad.salary@acme.com,Engineering,India,INR,Engineer,Senior,abc,2022-03-01`,
      `,Copy,Existing,${existing.email},Engineering,India,INR,Engineer,Senior,150000,2022-03-01`,
    ].join("\n");
    const r = await request(app)
      .post("/api/employees/import")
      .attach("file", Buffer.from(csv), "import.csv");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      totalRows: 3,
      imported: 1,
      failed: [
        { row: 3, reason: expect.stringContaining("baseSalary") },
        { row: 4, reason: "An employee with this email already exists" },
      ],
    });
    expect(repo.employees).toHaveLength(51);
  });

  it("rejects a non-CSV file, a missing file and a wrong field name (400s)", async () => {
    const txt = await request(app)
      .post("/api/employees/import")
      .attach("file", Buffer.from("hello"), "notes.txt");
    expect(txt.status).toBe(400);
    expect(txt.body.error.message).toMatch(/Only \.csv files/);
    const none = await request(app).post("/api/employees/import");
    expect(none.status).toBe(400);
    expect(none.body.error.message).toMatch(/No CSV file uploaded/);
    const wrongField = await request(app)
      .post("/api/employees/import")
      .attach("data", Buffer.from(`${HEADER}\n${ASHA}`), "import.csv");
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.message).toMatch(/field 'file'/);
  });

  it("rejects an empty CSV and a wrong-header CSV (400s from the service)", async () => {
    const empty = await request(app)
      .post("/api/employees/import")
      .attach("file", Buffer.from(""), "empty.csv");
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toMatch(/CSV file is empty/);
    const wrongHeader = await request(app)
      .post("/api/employees/import")
      .attach("file", Buffer.from("name,email\nAsha,a@acme.com"), "import.csv");
    expect(wrongHeader.status).toBe(400);
    expect(wrongHeader.body.error.message).toMatch(/CSV header must be exactly/);
  });

  it("rejects a file over the 5 MB limit", async () => {
    const big = Buffer.from(`${HEADER}\n${`${ASHA}\n`.repeat(60_000)}`);
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    const r = await request(app)
      .post("/api/employees/import")
      .attach("file", big, "big.csv");
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/too large.*5 MB/);
    expect(repo.employees).toHaveLength(50);
  });
});
