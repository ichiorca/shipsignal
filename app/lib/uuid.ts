// Shared UUID shape check. Path-param ids are UUIDs backed by `uuid` DB columns; validating
// the shape lets the DB getters return null (→ 404) for a malformed id instead of passing it
// to Postgres and surfacing an unhandled `22P02 invalid input syntax for type uuid` as a 500.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
