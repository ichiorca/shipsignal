// Frontend audit — custom 404 surface. Several pages call `notFound()` (e.g. a run/artifact id
// that doesn't resolve) but previously rendered the framework default. This gives a branded,
// keyboard-operable not-found page inside the app shell. P6 (WCAG 2.2 AA): one <main> landmark +
// heading and a real link back to the run feed. Server component (no interactivity needed).

export default function NotFound() {
  return (
    <main id="main">
      <h1>Not found</h1>
      <p role="alert">
        We couldn’t find that page. It may have been removed, or the link is incorrect.
      </p>
      <p>
        <a href="/">Back to all runs</a>
      </p>
    </main>
  );
}
