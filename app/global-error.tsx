// Frontend audit — last-resort boundary for errors thrown in the root layout itself (which the
// segment-level error.tsx cannot catch, because it renders *inside* that layout). It must supply
// its own <html>/<body> because it REPLACES the root layout when it activates. P6 (WCAG 2.2 AA):
// declares the document language, exposes a <main> landmark + heading and an assertive alert, and
// offers a keyboard-operable retry. constitution §5: generic message + digest only, never raw
// error text. Client component, per Next's global-error contract.

'use client';

export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main id="main">
          <h1>Something went wrong</h1>
          <p role="alert">The dashboard failed to load. The error has been logged.</p>
          {error.digest ? (
            <p>
              Reference code: <code>{error.digest}</code>
            </p>
          ) : null}
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
