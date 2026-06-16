// T5 (spec 009) — Gate #3 proposed-skill review UI (PRD §5.6, §9.5). P6 (Quality bars / WCAG 2.2
// AA): one labelled reviewer field; each candidate is a headed <section> showing the skill, its
// current vs proposed version, confidence + source as TEXT (not colour alone), the likely impact,
// a two-panel current/proposed SKILL.md diff (each panel a labelled region), and the supporting
// signals as a list (PRD §9.5 bottom panel). The action group uses real <button>s — "Approve and
// replace repo skill" / "Reject" / "Request changes" (PRD §9.5) — with a live-region status.
//
// Approve and Reject are guarded by a confirmation dialog because they resume the run, and
// Approve is the single highest-blast action in the product — it OVERWRITES a repo SKILL.md —
// so it additionally requires the reviewer to type a confirmation phrase (UX review B1). The
// reviewer name is required (focus + aria-invalid on omission, UX H5) and persisted across
// gates (L3). constitution §1/§5: the UI NEVER writes the repo file; each action submits the
// run-level decision to the resume route and the WORKER performs the single repo write.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other review components.

'use client';

import { createElement, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  SkillCandidateView,
  SupportingSignalView,
} from '@/app/lib/db/skillCandidates.ts';
import { EMPTY } from '../lib/displayFormat.ts';
import { lineDiff, type DiffLine } from '../lib/lineDiff.ts';
import { ConfirmButton } from './ConfirmButton.ts';
import { useReviewerName } from '../lib/useReviewerName.ts';

export interface SkillCandidateReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly candidates: readonly SkillCandidateView[];
}

type Decision = 'approved' | 'rejected' | 'edited';

/** User-facing message for a failed request — never expose a bare HTTP status (UX review H5). */
function failureMessage(status: number): string {
  if (status === 409) return 'it conflicts with the current state (already decided).';
  if (status >= 500) return 'the server hit an error — please try again.';
  return `the request was rejected (code ${status}).`;
}

// UI tier-2 #6 — a SKILL.md panel with change highlighting. The current panel shows unchanged +
// removed lines (removed wrapped in <del>); the proposed panel shows unchanged + added lines
// (added wrapped in <ins>). <del>/<ins> carry the add/remove meaning to assistive tech natively —
// colour is only a supplement. Lines live in a <pre> so whitespace/structure is preserved.
function diffPanel(label: string, panel: 'current' | 'proposed', diff: readonly DiffLine[]): ReactElement {
  const headingId = `panel-${panel}`;
  const lines: ReactElement[] = [];
  diff.forEach((line, i) => {
    if (line.kind === 'del' && panel === 'proposed') return; // removed lines are not in "proposed"
    if (line.kind === 'add' && panel === 'current') return; // added lines are not in "current"
    // No trailing '\n': each line element is display:block (globals.css), so the block break IS
    // the line break — adding '\n' inside a <pre> would double-space every row. Empty lines keep
    // their height via the ::before marker. Leading whitespace is preserved by the <pre>.
    const text = line.text;
    if (line.kind === 'del') lines.push(createElement('del', { key: i, 'data-diff': 'del' }, text));
    else if (line.kind === 'add') lines.push(createElement('ins', { key: i, 'data-diff': 'add' }, text));
    else lines.push(createElement('span', { key: i, 'data-diff': 'same' }, text));
  });
  return createElement(
    'section',
    { 'aria-labelledby': headingId, 'data-panel': panel },
    createElement('h3', { id: headingId }, label),
    createElement('pre', { 'data-skill-diff': true }, lines.length === 0 ? '(empty)' : lines),
  );
}

function signalItem(signal: SupportingSignalView): ReactElement {
  const headingId = `signal-${signal.id}`;
  return createElement(
    'li',
    { key: signal.id, 'data-signal-id': signal.id, 'aria-labelledby': headingId },
    createElement('p', { id: headingId, 'data-signal-type': signal.signal_type }, signal.signal_type),
    signal.rejection_category
      ? createElement('p', { 'data-rejection-category': signal.rejection_category }, `Category: ${signal.rejection_category}`)
      : null,
    signal.reviewer ? createElement('p', null, `Reviewer: ${signal.reviewer}`) : null,
    createElement('p', null, signal.excerpt),
  );
}

function candidateSection(candidate: SkillCandidateView): ReactElement {
  const headingId = `candidate-${candidate.id}`;
  const currentVersion = candidate.current_version ?? EMPTY;
  const confidence = candidate.confidence === null ? EMPTY : candidate.confidence.toFixed(2);
  // One diff drives both panels, so "current" and "proposed" highlight exactly the same change set.
  const diff = lineDiff(candidate.current_body, candidate.proposed_body);
  return createElement(
    'section',
    {
      key: candidate.id,
      'aria-labelledby': headingId,
      'data-skill-candidate': candidate.id,
      'data-skill-name': candidate.skill_name,
    },
    createElement('h2', { id: headingId }, `Skill: ${candidate.skill_name}`),
    createElement(
      'dl',
      null,
      createElement('dt', { key: 'cvt' }, 'Current version'),
      createElement('dd', { key: 'cvd', 'data-current-version': currentVersion }, currentVersion),
      createElement('dt', { key: 'pvt' }, 'Proposed version'),
      createElement('dd', { key: 'pvd', 'data-proposed-version': candidate.proposed_version }, candidate.proposed_version),
      createElement('dt', { key: 'srt' }, 'Candidate source'),
      createElement('dd', { key: 'srd' }, candidate.miner_type),
      createElement('dt', { key: 'cot' }, 'Confidence'),
      createElement('dd', { key: 'cod', 'data-confidence': confidence }, confidence),
    ),
    createElement('p', { 'data-proposal-reason': 'true' }, `Likely impact: ${candidate.proposal_reason}`),
    diffPanel('Current SKILL.md (removed lines struck through)', 'current', diff),
    diffPanel('Proposed SKILL.md (added lines highlighted)', 'proposed', diff),
    createElement('h3', null, 'Supporting signals'),
    candidate.supporting_signals.length === 0
      ? createElement('p', null, 'No supporting signals recorded.')
      : createElement('ul', null, ...candidate.supporting_signals.map(signalItem)),
  );
}

export function SkillCandidateReview({
  releaseRunId,
  threadId,
  candidates,
}: SkillCandidateReviewProps): ReactElement {
  const [reviewer, setReviewer] = useReviewerName();
  const [reviewerError, setReviewerError] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const reviewerRef = useRef<HTMLInputElement | null>(null);

  const noReviewer = reviewer.trim() === '';
  const cannotDecide = pending || noReviewer || threadId === null;

  function requireReviewer(): boolean {
    if (noReviewer) {
      setReviewerError(true);
      reviewerRef.current?.focus();
      setStatus('Enter your reviewer name before deciding on the skill replacement.');
      return false;
    }
    setReviewerError(false);
    return true;
  }

  async function submitReview(decision: Decision): Promise<void> {
    if (!requireReviewer()) return;
    if (threadId === null) {
      setStatus('This run has no thread to resume yet.');
      return;
    }
    setPending(true);
    setStatus(`Recording ${decision}; the run is resuming…`);
    try {
      const response = await fetch(`/api/releases/${releaseRunId}/resume-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer, decision, thread_id: threadId }),
      });
      setStatus(
        response.ok
          ? `Recorded ${decision}; the skill-learning run is resuming.`
          : `Could not submit the decision: ${failureMessage(response.status)}`,
      );
    } catch {
      setStatus('Could not submit the skill decision — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  if (candidates.length === 0) {
    return createElement(
      'div',
      null,
      createElement('p', null, 'No skill-revision candidates are pending review for this run.'),
    );
  }

  return createElement(
    'div',
    null,
    createElement(
      'p',
      null,
      createElement('label', { htmlFor: 'reviewer' }, 'Reviewer name (required)'),
    ),
    createElement('input', {
      id: 'reviewer',
      name: 'reviewer',
      type: 'text',
      value: reviewer,
      required: true,
      autoComplete: 'name',
      ref: reviewerRef,
      'aria-invalid': reviewerError,
      'aria-describedby': reviewerError ? 'reviewer-error' : undefined,
      onChange: (e: { target: { value: string } }) => {
        setReviewer(e.target.value);
        if (e.target.value.trim() !== '') setReviewerError(false);
      },
    }),
    reviewerError
      ? createElement('p', { id: 'reviewer-error', role: 'alert' }, 'Enter your reviewer name to decide on the skill replacement.')
      : null,
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
    ...candidates.map(candidateSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Decide on the skill replacement' },
      noReviewer
        ? createElement('p', null, 'Enter your reviewer name above to record a decision.')
        : null,
      createElement(ConfirmButton, {
        label: 'Approve and replace repo skill',
        title: 'Overwrite the repository SKILL.md?',
        body:
          'This OVERWRITES the repo SKILL.md with the proposed version and records the ' +
          'resulting commit SHA. It is the single highest-impact action in the product and ' +
          'cannot be undone from here.',
        confirmLabel: 'Overwrite SKILL.md & resume',
        confirmPhrase: 'REPLACE',
        disabled: cannotDecide,
        onConfirm: () => submitReview('approved'),
      }),
      createElement(ConfirmButton, {
        label: 'Reject',
        title: 'Reject the proposed skill revision?',
        body:
          'This rejects the candidate and resumes the run. No repo file is changed and a ' +
          'cooldown suppression is recorded. It cannot be undone from here.',
        confirmLabel: 'Reject & resume',
        disabled: cannotDecide,
        onConfirm: () => submitReview('rejected'),
      }),
      createElement(
        'button',
        { type: 'button', disabled: cannotDecide, onClick: () => submitReview('edited') },
        'Request changes',
      ),
    ),
  );
}
