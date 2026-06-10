// T2 (spec 021) — deterministic UTM stamping for exported artifact links (PRD §17.1
// outcome loop). At EXPORT time only — the approved snapshot (the §18.1/§18.3 immutable
// Gate #2 record) is never mutated; the stamped URLs exist solely in the rendered
// markdown/HTML documents, tying inbound traffic back to (release run, artifact type).
//
// Scope rails (spec AC): only the TARGET of a markdown hyperlink is touched, and only when
// it is an absolute http(s) URL — link text, relative/mailto/anchor targets, inline code,
// and fenced code blocks pass through byte-identical. Deterministic and idempotent: the
// same artifact always yields the same URLs, and re-stamping a stamped document converges
// (existing utm_source/utm_medium/utm_campaign values are REPLACED, other query params and
// the fragment are preserved in place). Pure module (no server imports) — unit-tested
// directly. No URL() round-trip is used so a target is never re-normalised beyond the
// three utm params (the AC: stamping never otherwise alters a link).

/** The three deterministic parameters (spec AC): source is the product, medium is the
 *  artifact type, campaign is the release run. */
export interface UtmParams {
  readonly artifact_type: string;
  readonly release_run_id: string;
}

const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/** Matches the markdown link form the export renderer understands ([text](target) — see
 *  markdownToHtml.renderInline); the same shape, so stamper and renderer agree on what a
 *  link is. */
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function isAbsoluteHttpUrl(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

/** Stamp one URL: drop any existing utm_source/medium/campaign pair, keep every other
 *  query param in place, append the three deterministic params, keep the fragment last. */
export function stampUrl(url: string, params: UtmParams): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex);

  const queryIndex = base.indexOf('?');
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : base.slice(queryIndex + 1);

  const kept = query
    .split('&')
    .filter((pair) => pair !== '')
    .filter((pair) => !UTM_KEYS.has((pair.split('=')[0] ?? '').toLowerCase()));

  kept.push(
    'utm_source=shipsignal',
    `utm_medium=${encodeURIComponent(params.artifact_type)}`,
    `utm_campaign=${encodeURIComponent(params.release_run_id)}`,
  );
  return `${path}?${kept.join('&')}${fragment}`;
}

/** Stamp the [text](target) links inside one already-code-free text segment. */
function stampLinksInText(text: string, params: UtmParams): string {
  return text.replace(MARKDOWN_LINK, (whole, label: string, target: string) =>
    isAbsoluteHttpUrl(target) ? `[${label}](${stampUrl(target, params)})` : whole,
  );
}

/** Stamp a text block, leaving inline code spans (`...`) untouched: split on code spans,
 *  stamp only the segments between them (mirrors renderInline's code-spans-first rule). */
function stampOutsideCodeSpans(line: string, params: UtmParams): string {
  return line
    .split(/(`[^`]*`)/)
    .map((segment) =>
      segment.startsWith('`') && segment.endsWith('`') && segment.length >= 2
        ? segment
        : stampLinksInText(segment, params),
    )
    .join('');
}

/** Stamp every absolute http(s) markdown link in `markdown`, skipping fenced code blocks
 *  (mirrors markdownToHtml.splitFences: a ``` line toggles, an unclosed fence runs to the
 *  end). Everything that is not a stamped link target is emitted byte-identical. */
export function stampMarkdownLinks(markdown: string, params: UtmParams): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : stampOutsideCodeSpans(line, params);
    })
    .join('\n');
}
