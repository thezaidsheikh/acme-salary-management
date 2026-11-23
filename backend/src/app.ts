import cors from "cors";
import express, { type Express } from "express";
import { createCorsOptions } from "./shared/cors.js";
import { pool } from "./shared/db.js";
import { errorHandler, notFoundHandler } from "./shared/http.js";
import { createAnalyticsModule } from "./modules/analytics/index.js";
import { createAuditModule } from "./modules/audit/index.js";
import { createBandsModule } from "./modules/bands/index.js";
import { createEmployeeModule, type EmployeeRepository } from "./modules/employees/index.js";
import { createSalaryModule } from "./modules/salary/index.js";

// Composition root ONLY: this file wires modules together and mounts
// routes. It holds no business logic, no SQL and no validation — each
// module factory builds its own repository -> service -> router chain
// (Pattern: DI — a repository passed in here flows into every service).

/**
 * Build the Express app.
 * @param repo Optional repository to inject (tests pass InMemory here);
 * when omitted, a PgEmployeeRepository over the default pool is used.
 * @returns The configured Express app (not yet listening).
 */
export function createApp(repo?: EmployeeRepository): Express {
  const app = express();
  // Allowed frontend origins (FRONTEND_URL, comma-separated, plus
  // localhost/127.0.0.1 on 3000 and 3001). See shared/cors.ts.
  app.use(cors(createCorsOptions()));
  app.use(express.json());

  const source = repo ?? pool;
  // Bands are built once and shared: the employee, salary and analytics
  // services all enrich/classify through this one BandService, so every
  // response agrees on the same band numbers.
  const bands = createBandsModule(source);
  const employees = createEmployeeModule(source, bands.service);
  const salary = createSalaryModule(source, bands.service);
  const analytics = createAnalyticsModule(source, bands.service);
  const audit = createAuditModule(source);

  // Health check — no dependencies, always available.
  app.get("/api/health", (_req, res) => res.json({ data: { status: "ok" } }));
  app.use("/api/bands", bands.router);
  app.use("/api/employees", employees.router);
  app.use("/api/employees", salary.router);
  app.use("/api/analytics", analytics.router);
  app.use("/api/audit-log", audit.router);

  app.use(notFoundHandler);
  // Single error envelope for every failure.
  app.use(errorHandler);
  return app;
}
