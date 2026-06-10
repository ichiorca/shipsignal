// T1 (spec 019) — assemble export documents from the §18.1 publishable truth (pure; unit-tested).
// P5 (Safety rails) / §18.1: ONLY the approved snapshot (the immutable Gate #2 record) is ever
// exported — never the mutable artifacts row, so a post-approval edit can't leak into a published
// document. The JSON export carries claim-level provenance (content hash, claim support, evidence
// ids, model/prompt/skill versions, approval id) per the spec's AC; the reviewer's NAME is
// deliberately absent from every export shape (data minimization — the approval id is the
// auditable reference, resolvable internally). Pure module: the DB read lives in
// app/lib/db/approvedSnapshots.ts; the routes wire the two together.

import { markdownToHtml, escapeHtml } from './markdownToHtml.ts';
import { stampMarkdownLinks } from './utmStamping.ts';
import type { ClaimSupportEntry } from './approvedSnapshot.ts';

/** The approved-snapshot fields the export/distribution surfaces read (reviewer name excluded —
 *  the db read never selects it, so no export/webhook shape can leak it). */
export interface ApprovedSnapshotView {
  readonly artifact_id: string;
  readonly release_run_id: string;
  readonly approval_id: string | null;
  readonly artifact_type: string;
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly skill_versions: Readonly<Record<string, string>>;
  readonly evidence_ids: readonly string[];
  readonly claim_support: readonly ClaimSupportEntry[];
  readonly reviewer_decision: string;
  readonly final_title: string | null;
  readonly final_body_markdown: string;
  readonly content_hash: string;
  readonly generated_at: string | null;
  readonly approved_at: string | null;
}

export const EXPORT_FORMATS = ['markdown', 'html', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** The provenance-bearing JSON export record (spec 019 AC: content hash, claim support,
 *  evidence ids, model/prompt/skill versions, reviewer decision id — not the reviewer). */
export interface ArtifactExportRecord {
  readonly artifact_id: string;
  readonly release_run_id: string;
  readonly artifact_type: string;
  readonly approval_id: string | null;
  readonly reviewer_decision: string;
  readonly final_title: string | null;
  readonly final_body_markdown: string;
  readonly content_hash: string;
  readonly evidence_ids: readonly string[];
  readonly claim_support: readonly ClaimSupportEntry[];
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly skill_versions: Readonly<Record<string, string>>;
  readonly generated_at: string | null;
  readonly approved_at: string | null;
}

/** Project the snapshot view into the JSON export record (field-by-field, so a future column
 *  added to the view never silently flows into exports without a deliberate edit here). */
export function buildExportRecord(snapshot: ApprovedSnapshotView): ArtifactExportRecord {
  return {
    artifact_id: snapshot.artifact_id,
    release_run_id: snapshot.release_run_id,
    artifact_type: snapshot.artifact_type,
    approval_id: snapshot.approval_id,
    reviewer_decision: snapshot.reviewer_decision,
    final_title: snapshot.final_title,
    final_body_markdown: snapshot.final_body_markdown,
    content_hash: snapshot.content_hash,
    evidence_ids: snapshot.evidence_ids,
    claim_support: snapshot.claim_support,
    model_id: snapshot.model_id,
    prompt_version: snapshot.prompt_version,
    skill_versions: snapshot.skill_versions,
    generated_at: snapshot.generated_at,
    approved_at: snapshot.approved_at,
  };
}

/** The markdown export: the approved title as an H1 (when the body doesn't already lead with
 *  one) + the approved body as frozen at Gate #2, with absolute http(s) hyperlink TARGETS
 *  UTM-stamped at export time (T2, spec 021): utm_source=shipsignal, utm_medium=artifact
 *  type, utm_campaign=release run id — deterministic, link-targets-only, and applied to the
 *  rendered document NEVER the snapshot (the immutable §18.3 record + its content_hash are
 *  untouched; the JSON export still carries the approved body verbatim). */
export function renderMarkdownExport(snapshot: ApprovedSnapshotView): string {
  const body = stampMarkdownLinks(snapshot.final_body_markdown, {
    artifact_type: snapshot.artifact_type,
    release_run_id: snapshot.release_run_id,
  });
  const title = snapshot.final_title;
  if (title === null || body.trimStart().startsWith('# ')) return body;
  return `# ${title}\n\n${body}`;
}

/** The HTML export: a complete standalone document (escaped + scheme-safe via markdownToHtml)
 *  carrying the content hash so the file remains traceable to its snapshot. */
export function renderHtmlExport(snapshot: ApprovedSnapshotView): string {
  const title = snapshot.final_title ?? snapshot.artifact_type;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="shipsignal-content-hash" content="${escapeHtml(snapshot.content_hash)}" />`,
    `<meta name="shipsignal-release-run" content="${escapeHtml(snapshot.release_run_id)}" />`,
    '</head>',
    '<body>',
    `<article>${markdownToHtml(renderMarkdownExport(snapshot))}</article>`,
    '</body>',
    '</html>',
  ].join('\n');
}

const FORMAT_EXTENSION: Readonly<Record<ExportFormat, string>> = {
  markdown: 'md',
  html: 'html',
  json: 'json',
};

export const FORMAT_CONTENT_TYPE: Readonly<Record<ExportFormat, string>> = {
  markdown: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/** Deterministic download filename: type + artifact-id prefix (ids are server-generated UUIDs;
 *  nothing user-controlled reaches the header). */
export function exportFilename(snapshot: ApprovedSnapshotView, format: ExportFormat): string {
  const idPrefix = snapshot.artifact_id.replaceAll('-', '').slice(0, 8);
  return `${snapshot.artifact_type}-${idPrefix}.${FORMAT_EXTENSION[format]}`;
}

/** Render one approved snapshot in the requested format. */
export function renderExport(snapshot: ApprovedSnapshotView, format: ExportFormat): string {
  if (format === 'markdown') return renderMarkdownExport(snapshot);
  if (format === 'html') return renderHtmlExport(snapshot);
  return JSON.stringify(buildExportRecord(snapshot), null, 2);
}
