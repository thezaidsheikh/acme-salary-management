import { Router, type Router as ExpressRouter } from "express";
import { asyncHandler } from "../../shared/http.js";
import { createBandController } from "./bands.controller.js";
import type { BandService } from "./bands.service.js";

/**
 * Build the bands router (mounted at /api/bands).
 * @param service Band business logic, injected into the controller.
 * @returns An Express router with the list and get-by-level routes.
 */
export function createBandRouter(service: BandService): ExpressRouter {
  const router = Router();
  const c = createBandController(service);
  router.get("/", asyncHandler(c.list));
  router.get("/:level", asyncHandler(c.getByLevel));
  return router;
}
