// UI tier-3 #10 — route-level loading skeleton for the run-detail hub, which fans out several
// Aurora reads (evidence, cost, artifacts, engagement). Streamed instantly while they resolve.
// P6 (WCAG 2.2 AA): a polite live region announces the load; placeholder blocks are aria-hidden.

export default function Loading() {
  return (
    <main id="main">
      <p role="status" aria-live="polite">
        Loading release run…
      </p>
      <div data-skeleton aria-hidden="true">
        <div className="skeleton-block" style={{ height: '2.5rem', maxWidth: '24rem' }} />
        <div className="skeleton-block" style={{ height: '4rem' }} />
        <div className="skeleton-block" style={{ height: '10rem' }} />
      </div>
    </main>
  );
}
