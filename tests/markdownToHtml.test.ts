// T1/T5 (spec 019) — unit coverage for the escape-first markdown renderer the HTML export uses.
// P5 (Safety rails): the load-bearing assertions are the injection ones — model-generated artifact
// content is untrusted input, so raw HTML and javascript: links must come out inert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, markdownToHtml } from '../app/lib/markdownToHtml.ts';

test('escapes all five HTML-special characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('raw HTML in markdown is escaped, never emitted as markup', () => {
  const html = markdownToHtml('hello <script>alert(1)</script> world');
  assert.ok(!html.includes('<script>'), 'script tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'script tag is escaped text');
});

test('javascript: links render as plain text, not as an href', () => {
  const html = markdownToHtml('[click](javascript:alert(1))');
  assert.ok(!html.includes('href='), 'no href for an unsafe scheme');
  assert.ok(html.includes('javascript:alert(1)'), 'left visible as text');
});

test('http, https, mailto and relative links render as anchors', () => {
  assert.ok(markdownToHtml('[a](https://example.com)').includes('<a href="https://example.com">a</a>'));
  assert.ok(markdownToHtml('[b](http://example.com)').includes('href="http://example.com"'));
  assert.ok(markdownToHtml('[c](mailto:x@example.com)').includes('href="mailto:x@example.com"'));
  assert.ok(markdownToHtml('[d](/releases/1)').includes('href="/releases/1"'));
});

test('headings h1–h6 render at their level', () => {
  assert.equal(markdownToHtml('# Title'), '<h1>Title</h1>');
  assert.equal(markdownToHtml('###### Deep'), '<h6>Deep</h6>');
});

test('paragraphs split on blank lines; single newlines join', () => {
  assert.equal(markdownToHtml('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
});

test('unordered and ordered lists render as ul/ol', () => {
  assert.equal(markdownToHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(markdownToHtml('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

test('fenced code blocks are literal (no inline markdown inside)', () => {
  const html = markdownToHtml('```\n**not bold** <tag>\n```');
  assert.equal(html, '<pre><code>**not bold** &lt;tag&gt;</code></pre>');
});

test('an unclosed fence is preserved as code to the end, not dropped', () => {
  const html = markdownToHtml('```\ntrailing');
  assert.equal(html, '<pre><code>trailing</code></pre>');
});

test('bold, italic and code spans render inline', () => {
  assert.equal(
    markdownToHtml('**b** and *i* and `c`'),
    '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>',
  );
});

test('deterministic: same input, same output', () => {
  const src = '# T\n\n- a\n- b\n\n[l](https://example.com)';
  assert.equal(markdownToHtml(src), markdownToHtml(src));
});
