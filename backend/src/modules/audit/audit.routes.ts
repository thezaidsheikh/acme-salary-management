import { Router, type Router as ExpressRouter } from "express";
import { asyncHandler } from "../../shared/http.js";
import { createAuditController } from "./audit.controller.js";
import type { AuditService } from "./audit.service.js";

/**
 * Build the audit-log router (mounted at /api/audit-log).
 * @param service Audit business logic, injected into the controller.
 * @returns An Express router with the audit-log list route.
 */
export function createAuditRouter(service: AuditService): ExpressRouter {
  const router = Router();
  const c = createAuditController(service);
  router.get("/", asyncHandler(c.list));
  return router;
}
