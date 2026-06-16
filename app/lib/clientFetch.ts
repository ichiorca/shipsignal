// Client-side fetch with a default timeout. Staff-review fix (P3): the gate-approval and publish
// components fetch without a timeout, so a stalled server (Vercel cold start, exhausted Aurora
// pool) leaves the `pending` spinner stuck forever with no recovery but a hard reload. This wraps
// fetch with an AbortSignal.timeout default so those calls fail fast and the existing catch blocks
// clear `pending`. The long worker job is dispatched asynchronously by the route, so the UI call
// itself is short — 15s comfortably covers a cold start + the route's own work.
//
// Server-side dispatch helpers already bound their fetches (AbortSignal.timeout(10_000)); this is
// the client-side equivalent. A caller may still pass its own `signal` to override the default.

export const CLIENT_FETCH_TIMEOUT_MS = 15_000;

export function clientFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
  });
}
