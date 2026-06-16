// UI tier-3 #10 — route-level loading skeleton for the run feed. The home page is force-dynamic
// and blocks on Aurora (run feed + hero aggregates); Next streams this instantly while the data
// resolves, so navigation feels immediate. P6 (WCAG 2.2 AA): a polite live-region announces the
// load for screen readers; the placeholder blocks are aria-hidden (purely visual).

export default function Loading() {
  return (
    <main id="main">
      <h1>Launches</h1>
      <p role="status" aria-live="polite">
        Loading launches…
      </p>
      <div data-skeleton aria-hidden="true">
        <div className="skeleton-block" style={{ height: '4.5rem' }} />
        <div className="skeleton-block" style={{ height: '3rem', maxWidth: '20rem' }} />
        <div className="skeleton-block" style={{ height: '14rem' }} />
      </div>
    </main>
  );
}
