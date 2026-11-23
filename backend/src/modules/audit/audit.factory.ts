import type { Pool } from "pg";
import type { Router as ExpressRouter } from "express";
import { PgEmployeeRepository } from "../employees/employee.repository.js";
import type { EmployeeRepository } from "../employees/index.js";
import { AuditService } from "./audit.service.js";
import { createAuditRouter } from "./audit.routes.js";

// Pattern: Factory + DI — the module factory wires repository -> service
// -> router from one input, so the composition root never news up
// internals. It accepts a Pool (production) or a ready repository
// (tests injecting InMemory), keeping both call sites identical.
// Unlike the bands module, there is no AuditRepository class: the audit
// log reads the salary_history table owned by EmployeeRepository, so
// this factory resolves to that same repository (see the service).

/**
 * Resolve the factory input to a repository: a Pool becomes a
 * PgEmployeeRepository; an already-built repository is used as-is.
 * @param poolOrRepo Pool to build a Postgres repository from, or a repository.
 * @returns An EmployeeRepository.
 */
function resolveRepository(poolOrRepo: Pool | EmployeeRepository): EmployeeRepository {
  return "query" in poolOrRepo && "connect" in poolOrRepo
    ? new PgEmployeeRepository(poolOrRepo as Pool)
    : (poolOrRepo as EmployeeRepository);
}

/**
 * Build the audit module: service and router.
 * @param poolOrRepo Postgres pool, or an EmployeeRepository (tests).
 * @returns The wired `{ router, service }` for the composition root.
 */
export function createAuditModule(poolOrRepo: Pool | EmployeeRepository): {
  router: ExpressRouter;
  service: AuditService;
} {
  const repository = resolveRepository(poolOrRepo);
  const service = new AuditService(repository);
  return { router: createAuditRouter(service), service };
}
