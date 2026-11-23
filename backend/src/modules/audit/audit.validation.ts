import { z } from "zod";

/**
 * Query string of GET /api/audit-log. Query values arrive as strings, so
 * page/pageSize are coerced to numbers; page starts at 1 and pageSize is
 * capped at 100 to bound result size (same envelope as the employee
 * list). `search` matches an employee id exactly or a name/email
 * substring; `from`/`to` are YYYY-MM-DD dates, inclusive on both ends,
 * and `from` must not be after `to`.
 */
export const auditLogQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    department: z.string().trim().max(50).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
