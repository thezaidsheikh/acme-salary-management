import type { Request, Response } from "express";
import multer from "multer";
import { parseWithSchema } from "../../shared/http.js";
import { badRequest } from "../../shared/errors.js";
import { EMPLOYEE_CSV_COLUMNS, MAX_IMPORT_FILE_BYTES } from "./employee.csv.js";
import { createEmployeeSchema, listQuerySchema } from "./employee.validation.js";
import type { EmployeeService } from "./employee.service.js";

// Pattern: Thin Controller — handlers only validate input, call the
// service, and shape the response. No business logic, no SQL here.

/**
 * Multer upload for the CSV import: the file is held in memory (never
 * written to disk), capped at MAX_IMPORT_FILE_BYTES, and only a `.csv`
 * filename is accepted — anything else is rejected before the handler
 * runs, so a wrong file never reaches the service.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".csv")) cb(null, true);
    else cb(new Error("Only .csv files are accepted"));
  },
});

/**
 * Run the multer single-file upload as a promise, so the handler can
 * `await` it and map upload failures to 400s.
 * @param req Request carrying the multipart body (field `file`).
 * @param res Response (passed through to multer).
 */
function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Build the employee HTTP handlers bound to a service.
 * Why a factory: the service is injected, so tests can pass a fake
 * service and exercise handlers without a repository or database.
 * @param service Employee business logic.
 * @returns Handlers for list, getById, create, CSV export and CSV import.
 */
export function createEmployeeController(service: EmployeeService) {
  return {
    /**
     * GET /api/employees — validated query, then `{ data, meta }`.
     * @param req Request; query holds search/filters/sort/page.
     * @param res Response with the paged list.
     */
    list: async (req: Request, res: Response): Promise<void> => {
      const q = parseWithSchema(listQuerySchema, req.query);
      res.json(await service.list(q));
    },

    /**
     * GET /api/employees/:id — one employee with salary history.
     * @param req Request; `id` is the employee id.
     * @param res Response with `{ data: employee }`.
     */
    getById: async (req: Request, res: Response): Promise<void> => {
      res.json({ data: await service.getById(req.params.id as string) });
    },

    /**
     * POST /api/employees — validated body, 201 on success.
     * @param req Request; body is the new employee.
     * @param res Response with `{ data: employee }` and status 201.
     */
    create: async (req: Request, res: Response): Promise<void> => {
      const input = parseWithSchema(createEmployeeSchema, req.body);
      res.status(201).json({ data: await service.create(input) });
    },

    /**
     * GET /api/employees/export — stream the (filtered) employee list as
     * CSV in pages of 1,000, so a 10k export never sits fully in RAM.
     * The `format` query param is accepted for API symmetry and ignored:
     * CSV is the only export format.
     * @param req Request; query holds the same filters as the list.
     * @param res Response streaming `text/csv` with a download filename.
     */
    exportCsv: async (req: Request, res: Response): Promise<void> => {
      const q = parseWithSchema(listQuerySchema, {
        ...(req.query as Record<string, unknown>),
        page: 1,
        pageSize: 100,
      });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="employees.csv"');
      // Header is the shared column list — the import accepts exactly this.
      res.write(`${EMPLOYEE_CSV_COLUMNS.join(",")}\n`);
      let page = 1;
      for (;;) {
        const { data } = await service.list({ ...q, page, pageSize: 1000 });
        if (data.length === 0) break;
        for (const e of data) {
          res.write(
            `${e.id},${e.firstName},${e.lastName},${e.email},${e.department},${e.country},${e.currency},${e.jobTitle},${e.level},${e.baseSalary},${new Date(e.dateOfJoining).toISOString().slice(0, 10)}\n`,
          );
        }
        if (data.length < 1000) break;
        page++;
      }
      res.end();
    },

    /**
     * POST /api/employees/import — multipart upload (field `file`), at
     * most 5 MB, `.csv` only. Upload problems are 400s (too large, not a
     * CSV, wrong field, no file); the service's per-row report is
     * returned as `{ data: { totalRows, imported, failed } }` with
     * status 200 — a file with some bad rows is a partial success, not
     * an error, and the report names every failed row.
     * @param req Request; `req.file` is the uploaded CSV (in memory).
     * @param res Response with `{ data: import report }`.
     */
    importCsv: async (req: Request, res: Response): Promise<void> => {
      try {
        await runUpload(req, res);
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === "LIMIT_FILE_SIZE") {
          throw badRequest("CSV file is too large — maximum 5 MB");
        }
        if (code === "LIMIT_UNEXPECTED_FILE") {
          throw badRequest("Upload the CSV file as field 'file'");
        }
        throw badRequest(e instanceof Error ? e.message : "File upload failed");
      }
      if (!req.file) throw badRequest("No CSV file uploaded — attach a file as field 'file'");
      res.json({ data: await service.importEmployees(req.file.buffer.toString("utf-8")) });
    },
  };
}
