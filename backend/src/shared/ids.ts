/**
 * UUID shape check — one shared definition, so every place that hands an
 * id to Postgres agrees on what "a UUID" looks like.
 *
 * Why a plain regex, not a library: the repo has no UUID-validation
 * dependency, and the check is one line. The pattern accepts versions
 * 1–5 and any variant (the version/variant nibbles are not pinned), so
 * it never rejects a UUID Postgres itself would accept.
 * @param value The string to check.
 * @returns True when the string is a hyphenated 8-4-4-4-12 hex UUID.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
