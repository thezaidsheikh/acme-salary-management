import type { Pool } from "pg";
import type { Router as ExpressRouter } from "express";
import type { EmployeeRepository } from "../employees/index.js";
import {
  InMemoryBandRepository,
  PgBandRepository,
  type BandRepository,
} from "./bands.repository.js";
import { BandService } from "./bands.service.js";
import { createBandRouter } from "./bands.routes.js";

// Pattern: Factory + DI — the module factory wires repository -> service
// -> router from one input, so the composition root never news up
// internals. It accepts a Pool (production), a ready BandRepository
// (tests injecting their own bands), or an EmployeeRepository (tests
// injecting an in-memory employee store, which implies in-memory bands).

/**
 * Resolve the factory input to a repository: a Pool becomes a
 * PgBandRepository; a BandRepository is used as-is; anything else (an
 * in-memory employee repository) gets default in-memory bands.
 * @param poolOrRepo Pool, BandRepository, or EmployeeRepository.
 * @returns A BandRepository.
 */
function resolveRepository(poolOrRepo: Pool | BandRepository | EmployeeRepository): BandRepository {
  if ("query" in poolOrRepo && "connect" in poolOrRepo) {
    return new PgBandRepository(poolOrRepo as Pool);
  }
  if ("getAll" in poolOrRepo && "getByLevel" in poolOrRepo) {
    return poolOrRepo as BandRepository;
  }
  return new InMemoryBandRepository();
}

/**
 * Build the bands module: repository, service and router.
 * @param poolOrRepo Postgres pool, a BandRepository, or an
 *   EmployeeRepository (tests).
 * @returns The wired `{ router, service }` for the composition root.
 */
export function createBandsModule(poolOrRepo: Pool | BandRepository | EmployeeRepository): {
  router: ExpressRouter;
  service: BandService;
} {
  const repository = resolveRepository(poolOrRepo);
  const service = new BandService(repository);
  return { router: createBandRouter(service), service };
}
