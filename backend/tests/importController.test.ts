import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// Multer is stubbed here so the upload can fail with a non-Error value —
// something the real multer never throws (it always throws Error
// instances), so this arm is defensive and unreachable through HTTP.
// The stub keeps the controller's error mapping honest instead of
// leaving a branch that no HTTP test can ever exercise.
vi.mock("multer", () => {
  const multerFn = (_options: unknown) => ({
    single: () =>
      (_req: unknown, _res: unknown, cb: (err: unknown) => void) => cb("boom"),
  });
  (multerFn as unknown as Record<string, unknown>).memoryStorage = () => ({});
  return { default: multerFn };
});

import { createEmployeeController } from "../src/modules/employees/employee.controller";
import type { EmployeeService } from "../src/modules/employees/employee.service";

describe("importCsv upload-error mapping (mocked multer)", () => {
  it("maps a non-Error upload failure to a 400 'File upload failed'", async () => {
    // The service is never reached: the upload fails first.
    const controller = createEmployeeController({} as unknown as EmployeeService);
    await expect(
      controller.importCsv({} as Request, {} as Response),
    ).rejects.toMatchObject({ status: 400, message: "File upload failed" });
  });
});
