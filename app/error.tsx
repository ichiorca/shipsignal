// Frontend audit — route-level error boundary. Twelve of the dashboard's routes are
// force-dynamic and block on Aurora reads; before this, a server-read failure fell through to
// the framework's default error page. This catches any error thrown while rendering a route
// segment (or its children) and shows a recoverable, user-safe surface with a `reset()` retry.
// P6 (WCAG 2.2 AA): a single <main> landmark + heading, an assertive live region so the failure
// is announced, and a real keyboard-operable <button> to retry. constitution §5 (Safety rails):
// we render a generic message and only the error's `digest` (a non-PII correlation id) — never
// the raw error text, which could carry internal detail. Client component: error boundaries must
// run on the client and receive the `reset` callback.

'use client';

import { useEffect } from 'react';

export default function RouteError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure to the browser console for the operator; the scrubbed server logs hold
    // the real stack. We never persist or display the raw message (it may carry internal detail).
    console.error('Route render failed', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <main id="main">
      <h1>Something went wrong</h1>
      <p role="alert">
        This screen failed to load. The error has been logged. You can retry, or head back to the
        run feed.
      </p>
      {error.digest ? (
        <p>
          Reference code: <code>{error.digest}</code>
        </p>
      ) : null}
      <div role="group" aria-label="Recovery actions">
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
        <a href="/">Back to all runs</a>
      </div>
    </main>
  );
}
