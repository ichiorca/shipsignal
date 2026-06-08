// T5 (spec 015) — Skill-admin screen (PRD §13.1): shows the active repo skills and their
// Aurora snapshot/candidate provenance. P6 (Quality bars / WCAG 2.2 AA): two semantic
// <table>s, each with a <caption> and column <th scope="col">; the candidate lifecycle
// status is rendered as TEXT (data-attribute is enhancement only, never colour alone).
// constitution §9.2: Aurora is the provenance ledger — this surfaces snapshot metadata
// (version, short commit SHA + content hash, snapshot count) of the repo-canonical
// SKILL.md files plus the staged candidate queue; no secret or raw evidence is shown.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring EvidenceTable / RunListTable. Purely
// presentational (no hooks/state), so it is a server-renderable component.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { SkillSummary } from '@/app/lib/db/skills.ts';
import type { SkillCandidateSummary } from '@/app/lib/db/skillCandidates.ts';

export interface SkillAdminProps {
  readonly skills: readonly SkillSummary[];
  readonly candidates: readonly SkillCandidateSummary[];
}

const SKILL_HEADERS = [
  'Skill',
  'Path',
  'Active version',
  'Commit',
  'Content hash',
  'Snapshots',
];

const CANDIDATE_HEADERS = ['Skill', 'Proposed version', 'Source', 'Confidence', 'Status'];

function shortHash(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

function skillRow(skill: SkillSummary): ReactElement {
  return createElement(
    'tr',
    { key: `${skill.repo}:${skill.skill_path}`, 'data-skill-name': skill.skill_name },
    createElement('td', null, skill.skill_name),
    createElement('td', null, skill.skill_path),
    createElement('td', null, skill.active_version ?? '—'),
    // Short, monospace-friendly identifiers; the full values live in Aurora.
    createElement('td', null, createElement('code', null, shortHash(skill.active_commit_sha, 7))),
    createElement('td', null, createElement('code', null, shortHash(skill.active_content_hash, 12))),
    createElement(
      'td',
      { 'data-snapshot-count': skill.snapshot_count },
      String(skill.snapshot_count),
    ),
  );
}

function candidateRow(candidate: SkillCandidateSummary): ReactElement {
  const confidence = candidate.confidence === null ? 'n/a' : candidate.confidence.toFixed(2);
  return createElement(
    'tr',
    { key: candidate.id, 'data-candidate-id': candidate.id },
    createElement('td', null, candidate.skill_name),
    createElement('td', null, candidate.proposed_version),
    createElement('td', null, candidate.miner_type),
    createElement('td', { 'data-confidence': confidence }, confidence),
    // Lifecycle status as readable text (PRD §13.3), not colour alone.
    createElement('td', { 'data-status': candidate.status }, createElement('span', null, candidate.status)),
  );
}

function skillsTable(skills: readonly SkillSummary[]): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Active repo skills'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...SKILL_HEADERS.map((label) => createElement('th', { key: label, scope: 'col' }, label)),
      ),
    ),
    createElement(
      'tbody',
      null,
      skills.length === 0
        ? createElement(
            'tr',
            null,
            createElement('td', { colSpan: SKILL_HEADERS.length }, 'No skill snapshots recorded yet.'),
          )
        : skills.map(skillRow),
    ),
  );
}

function candidatesTable(candidates: readonly SkillCandidateSummary[]): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Skill-revision candidates'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        ...CANDIDATE_HEADERS.map((label) =>
          createElement('th', { key: label, scope: 'col' }, label),
        ),
      ),
    ),
    createElement(
      'tbody',
      null,
      candidates.length === 0
        ? createElement(
            'tr',
            null,
            createElement(
              'td',
              { colSpan: CANDIDATE_HEADERS.length },
              'No skill-revision candidates recorded yet.',
            ),
          )
        : candidates.map(candidateRow),
    ),
  );
}

export function SkillAdmin({ skills, candidates }: SkillAdminProps): ReactElement {
  return createElement(
    'div',
    null,
    createElement('section', { 'aria-labelledby': 'skills-heading' },
      createElement('h2', { id: 'skills-heading' }, 'Active repo skills'),
      skillsTable(skills),
    ),
    createElement('section', { 'aria-labelledby': 'candidates-heading' },
      createElement('h2', { id: 'candidates-heading' }, 'Skill-revision candidates'),
      candidatesTable(candidates),
    ),
  );
}
