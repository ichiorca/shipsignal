// T3/T4 (spec 015) — shared helpers for the PRD §14 GET read APIs.
// P5 (Safety rails) + constitution §5: the read routes are thin adapters over the
// already-tested Aurora db helpers; this module owns the resource-resolution logic
// (200 with typed data vs 404 when the resource — or its owning run — does not exist)
// as a runtime-free, unit-testable surface. The route handler is a 2-line adapter that
// maps a `ReadResult` onto `NextResponse.json`, so the behaviour the operator invokes is
// exactly what these helpers (and their tests) exercise (anti-pattern #4).

/** A runtime-agnostic HTTP read outcome: the status code and the JSON body to send. */
export interface ReadResult {
  readonly status: number;
  readonly body: unknown;
}

export function ok(body: unknown): ReadResult {
  return { status: 200, body };
}

export function notFound(message: string): ReadResult {
  return { status: 404, body: { error: message } };
}

/** Parse a clamped `?limit` query param (default `def`, hard-capped at `max`) so a list
 *  endpoint never returns an unbounded result set. Invalid/absent → `def`. */
export function parseLimit(url: string, def: number, max: number): number {
  const raw = new URL(url).searchParams.get('limit');
  if (raw === null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/** Resolve a single resource: 404 when the loader yields `null`, else 200 with the
 *  shaped body. `shape` builds the response envelope from the loaded value. */
export async function resolveOne<T>(
  load: () => Promise<T | null>,
  notFoundMessage: string,
  shape: (value: T) => unknown,
): Promise<ReadResult> {
  const value = await load();
  return value === null ? notFound(notFoundMessage) : ok(shape(value));
}

/** Resolve a list scoped to a parent resource: 404 when the parent does not exist (so a
 *  bogus run id is distinguishable from a run with no children), else 200 with the list.
 *  The list is loaded lazily — only after the parent is confirmed — to avoid a wasted
 *  query on the 404 path. */
export async function resolveScopedList<P, L>(
  loadParent: () => Promise<P | null>,
  parentNotFoundMessage: string,
  loadList: () => Promise<L>,
  shape: (list: L) => unknown,
): Promise<ReadResult> {
  const parent = await loadParent();
  if (parent === null) {
    return notFound(parentNotFoundMessage);
  }
  return ok(shape(await loadList()));
}
