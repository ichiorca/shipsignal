// T1 (spec 019) — minimal, escape-first Markdown→HTML renderer for the artifact export API.
// P3 (Primitives) / dependency-policy: no markdown dependency is added — approved artifacts are
// generated against this project's own format skills (headings, paragraphs, lists, links, code),
// so a small deterministic renderer over that subset beats a new attack-surface dependency.
// P5 (Safety rails): ALL text is HTML-escaped BEFORE any markup is emitted, and link hrefs are
// scheme-allowlisted (http/https/mailto/relative), so model-generated content can never inject
// script into an exported document. Pure module (no server imports) — unit-tested directly.

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape the five HTML-special characters. Applied to every piece of source text first. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** A link target is allowed only with a safe scheme or as a relative/anchor path —
 *  `javascript:` (and anything else) is rendered as plain text, never as an href. */
function isSafeLinkTarget(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (/^(https?:|mailto:)/.test(trimmed)) return true;
  // Relative paths, anchors and query-only targets carry no scheme at all.
  return !/^[a-z][a-z0-9+.-]*:/.test(trimmed);
}

/** Inline markdown over ALREADY-ESCAPED text: code spans, links, bold, italic. */
function renderInline(escaped: string): string {
  let out = escaped;
  // Code spans first so their contents are exempt from emphasis/link rewriting.
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (whole: string, text: string, href: string) =>
      isSafeLinkTarget(href) ? `<a href="${href}">${text}</a>` : whole,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

type Block =
  | { readonly kind: 'code'; readonly lines: readonly string[] }
  | { readonly kind: 'text'; readonly lines: readonly string[] };

/** Split source into fenced-code blocks and ordinary text blocks (fences are literal). */
function splitFences(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      blocks.push({ kind: inFence ? 'code' : 'text', lines: current });
      current = [];
      inFence = !inFence;
      continue;
    }
    current.push(line);
  }
  // An unclosed fence is treated as code to the end (never silently dropped).
  blocks.push({ kind: inFence ? 'code' : 'text', lines: current });
  return blocks;
}

function renderTextBlock(lines: readonly string[]): string {
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list !== null) {
      const tag = list.ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = escapeHtml(raw.trimEnd());
    const trimmed = line.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);

    if (trimmed === '') {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
    } else if (bullet !== null || numbered !== null) {
      flushParagraph();
      const ordered = numbered !== null;
      const item = renderInline((ordered ? numbered?.[1] : bullet?.[1]) ?? '');
      if (list === null || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [item] };
      } else {
        list.items.push(item);
      }
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}

/** Render the supported markdown subset to HTML. Deterministic: same input → same output. */
export function markdownToHtml(markdown: string): string {
  return splitFences(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`
        : renderTextBlock(block.lines),
    )
    .filter((html) => html !== '')
    .join('\n');
}
