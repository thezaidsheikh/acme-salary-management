import type { Request, Response } from "express";
import { notFound } from "../../shared/errors.js";
import type { BandService } from "./bands.service.js";

// Pattern: Thin Controller — handlers only call the service and shape
// the response. No business logic, no SQL here.

/**
 * Build the salary-band HTTP handlers bound to a service.
 * @param service Band business logic.
 * @returns Handlers for listing all bands and fetching one by level.
 */
export function createBandController(service: BandService) {
  return {
    /**
     * GET /api/bands — all level bands, Junior first.
     * @param _req Request (unused).
     * @param res Response with `{ data: bands }`.
     */
    list: async (_req: Request, res: Response): Promise<void> => {
      res.json({ data: await service.getAll() });
    },

    /**
     * GET /api/bands/:level — one band by level name.
     * @param req Request; `level` is the level name, e.g. "Senior".
     * @param res Response with `{ data: band }`.
     * @throws ApiError 404 when the level has no band.
     */
    getByLevel: async (req: Request, res: Response): Promise<void> => {
      const band = await service.getByLevel(req.params.level as string);
      if (!band) throw notFound("Salary band");
      res.json({ data: band });
    },
  };
}
