import type { CorsOptions } from "cors";

/**
 * CORS allow-list for the backend.
 *
 * Why a list, not one origin: the browser blocks a page on one origin
 * calling an API on another origin unless the API explicitly allows it.
 * The old code allowed exactly one origin (FRONTEND_URL, default
 * http://localhost:3000), so the frontend broke when it was opened at
 * http://127.0.0.1:3000, when Next.js fell back to port 3001 because
 * 3000 was busy, or when FRONTEND_URL had a trailing slash.
 * Example: page at http://localhost:3000 fetches
 * http://localhost:4000/api/employees — different port = different
 * origin, so the browser needs Access-Control-Allow-Origin back.
 */

// Local dev origins. 3001 is included because Next.js silently moves
// there when port 3000 is already in use.
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

/**
 * Normalise one origin for comparison: trim whitespace and strip
 * trailing slashes, so "http://localhost:3000/" matches
 * "http://localhost:3000".
 * @param origin Raw origin string (e.g. from FRONTEND_URL or a header).
 * @returns The origin with no trailing slash.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/**
 * Build the allow-list: FRONTEND_URL first (comma-separated, so a
 * deploy can list several frontends), then the local defaults.
 * Duplicates are removed; an empty/unset FRONTEND_URL just yields
 * the defaults.
 * @param frontendUrl Value of FRONTEND_URL; defaults to the env var.
 * @returns Deduplicated list of allowed origins, env entries first.
 */
export function getAllowedOrigins(
  frontendUrl: string | undefined = process.env.FRONTEND_URL,
): string[] {
  const fromEnv = (frontendUrl ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter((o) => o.length > 0);
  return [...new Set([...fromEnv, ...DEFAULT_ALLOWED_ORIGINS])];
}

/**
 * Decide whether one origin may call the API.
 * Requests with no Origin header (curl, Postman, server-to-server)
 * are not browser cross-origin requests, so they are allowed.
 * @param origin The request's Origin header, if any.
 * @param allowedOrigins Allow-list; defaults to getAllowedOrigins().
 * @returns True when the origin is allowed (or absent).
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: string[] = getAllowedOrigins(),
): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
}

/**
 * Build the cors options for Express. The allow-list is read fresh
 * on every call (not once at import time) so a changed FRONTEND_URL
 * takes effect when the app is (re)created — and so tests can set
 * FRONTEND_URL before calling createApp.
 * Unknown origins get `false`, not an error: cors then sends no
 * Access-Control-Allow-Origin header and the browser blocks the
 * response, while the request itself is not turned into a 500.
 * Arbitrary origins are never reflected back.
 * @returns Cors options with an allow-list origin callback.
 */
export function createCorsOptions(): CorsOptions {
  const allowed = getAllowedOrigins();
  return {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, allowed));
    },
  };
}
