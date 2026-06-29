// T5 (spec 005) — draft-artifact preview list (PRD §13.1 artifact review surface; §8.1
// blog/changelog). P6 (Quality bars / WCAG 2.2 AA): each artifact is an <article> with a
// heading (so it is a navigable landmark for AT), its type/status exposed as text (not
// colour-alone), a <dl> of the §18.3 audit trail (model, prompt version, skills used), and
// the Markdown body in a labelled region with preserved whitespace. constitution §5: only
// redacted/approved-derived draft content is shown — there is no raw text on this surface.
//
// Static (no "use client"): this is read-only preview; Gate #2 approval controls arrive in
// a later spec. Authored with React.createElement (not JSX) so it renders under the
// dependency-free `node --test` a11y harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { ArtifactDraft } from '@/app/lib/db/artifacts.ts';
import { typeLabel } from '../lib/artifactTypes.ts';

export interface ArtifactDraftListProps {
  readonly artifacts: readonly ArtifactDraft[];
}

function auditTrail(artifact: ArtifactDraft): ReactElement {
  const skills = Object.keys(artifact.skill_versions);
  return createElement(
    'dl',
    null,
    createElement('dt', { key: 'mt' }, 'Type'),
    createElement('dd', { key: 'md' }, typeLabel(artifact.artifact_type)),
    createElement('dt', { key: 'st' }, 'Status'),
    createElement('dd', { key: 'sd', 'data-status': artifact.status }, artifact.status),
    createElement('dt', { key: 'mit' }, 'Model'),
    createElement('dd', { key: 'mid' }, artifact.model_id ?? '—'),
    createElement('dt', { key: 'pt' }, 'Prompt version'),
    createElement('dd', { key: 'pd' }, artifact.prompt_version ?? '—'),
    createElement('dt', { key: 'skt' }, 'Skills used'),
    createElement('dd', { key: 'skd' }, skills.length === 0 ? '—' : skills.join(', ')),
  );
}

function artifactArticle(artifact: ArtifactDraft): ReactElement {
  const headingId = `artifact-${artifact.id}`;
  const bodyId = `artifact-body-${artifact.id}`;
  return createElement(
    'article',
    {
      key: artifact.id,
      'aria-labelledby': headingId,
      'data-artifact-id': artifact.id,
      'data-artifact-type': artifact.artifact_type,
    },
    createElement('h2', { id: headingId }, artifact.title ?? typeLabel(artifact.artifact_type)),
    auditTrail(artifact),
    createElement('h3', { id: bodyId }, 'Draft'),
    // Preserve Markdown whitespace; render as text (no HTML injection from model output).
    // R7 — `data-artifact-body` styles generated copy in the editorial serif so a draft reads as
    // finished collateral, not form data. Whitespace stays preserved via CSS (not an inline style).
    createElement(
      'div',
      {
        'aria-labelledby': bodyId,
        'data-testid': 'artifact-body',
        'data-artifact-body': '',
      },
      artifact.body_markdown ?? '',
    ),
  );
}

export function ArtifactDraftList({ artifacts }: ArtifactDraftListProps): ReactElement {
  if (artifacts.length === 0) {
    return createElement(
      'p',
      null,
      'No draft artifacts have been generated for this run yet.',
    );
  }
  return createElement('div', null, ...artifacts.map(artifactArticle));
}
