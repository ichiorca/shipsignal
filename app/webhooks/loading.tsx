// Route-level loading skeleton for the webhook dashboard (force-dynamic, blocks on two Aurora
// reads). Streamed instantly while they resolve. P6 (WCAG 2.2 AA): a polite live region announces
// the load; the placeholder blocks are aria-hidden (purely visual).

export default function Loading() {
  return (
    <main id="main">
      <h1>Webhook deliveries</h1>
      <p role="status" aria-live="polite">
        Loading webhook deliveries…
      </p>
      <div data-skeleton aria-hidden="true">
        <div className="skeleton-block" style={{ height: '4.5rem' }} />
        <div className="skeleton-block" style={{ height: '12rem' }} />
      </div>
    </main>
  );
}
