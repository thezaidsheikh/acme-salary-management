import type { Request, Response } from "express";
import { parseWithSchema } from "../../shared/http.js";
import type { AuditService } from "./audit.service.js";
import { auditLogQuerySchema } from "./audit.validation.js";

// Pattern: Thin Controller — the handler only validates input, calls the
// service, and shapes the response. No business logic, no SQL here.

/**
 * Build the audit-log HTTP handlers bound to a service.
 * @param service Audit business logic.
 * @returns Handlers for the company-wide audit-log list.
 */
export function createAuditController(service: AuditService) {
  return {
    /**
     * GET /api/audit-log — validated query, then `{ data, meta }`.
     * @param req Request; query holds search/department/date range/page.
     * @param res Response with the paged audit rows.
     */
    list: async (req: Request, res: Response): Promise<void> => {
      const q = parseWithSchema(auditLogQuerySchema, req.query);
      res.json(await service.list(q));
    },
  };
}
