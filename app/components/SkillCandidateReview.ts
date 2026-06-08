// T5 (spec 009) — Gate #3 proposed-skill review UI (PRD §5.6, §9.5). P6 (Quality bars / WCAG 2.2
// AA): one labelled reviewer field; each candidate is a headed <section> showing the skill, its
// current vs proposed version, confidence + source as TEXT (not colour alone), the likely impact,
// a two-panel current/proposed SKILL.md diff (each panel a labelled region), and the supporting
// signals as a list (PRD §9.5 bottom panel). The action group uses real <button>s — "Approve and
// replace repo skill" / "Reject" / "Request changes" (PRD §9.5) — with a live-region status
// message. constitution §1/§5: the UI NEVER writes the repo file; each action submits the
// run-level decision to the resume route, and the WORKER performs the single repo write on the
// runner. Only repo-authored skill text + redacted/internal signal excerpts are shown.
//
// "use client": this is the interactive leaf (ux-react: mark stateful components, keep them small
// and leaf-level). It posts JSON to the §14 resume route; the reviewer identity is required before
// any decision so a skill replacement is never approved anonymously (no self-approval). Authored
// with React.createElement (not JSX) so it renders under the dependency-free `node --test` a11y
// harness, mirroring the other review components.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type {
  SkillCandidateView,
  SupportingSignalView,
} from '@/app/lib/db/skillCandidates.ts';

export interface SkillCandidateReviewProps {
  readonly releaseRunId: string;
  readonly threadId: string | null;
  readonly candidates: readonly SkillCandidateView[];
}

type Decision = 'approved' | 'rejected' | 'edited';

function bodyPanel(label: string, panel: string, body: string): ReactElement {
  const headingId = `panel-${panel}`;
  return createElement(
    'section',
    { 'aria-labelledby': headingId, 'data-panel': panel },
    createElement('h3', { id: headingId }, label),
    createElement('pre', null, body === '' ? '(empty)' : body),
  );
}

function signalItem(signal: SupportingSignalView): ReactElement {
  const headingId = `signal-${signal.id}`;
  // The signal kind + (for a rejection) its category are exposed as TEXT, never colour alone.
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
  const currentVersion = candidate.current_version ?? '—';
  const confidence =
    candidate.confidence === null ? 'n/a' : candidate.confidence.toFixed(2);
  return createElement(
    'section',
    {
      key: candidate.id,
      'aria-labelledby': headingId,
      'data-skill-candidate': candidate.id,
      'data-skill-name': candidate.skill_name,
    },
    createElement('h2', { id: headingId }, `Skill: ${candidate.skill_name}`),
    // Versions + confidence + source as readable text (PRD §9.5 header block).
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
    // Two-panel diff: current SKILL.md (left) vs proposed SKILL.md (right) — PRD §9.5.
    bodyPanel('Current SKILL.md', 'current', candidate.current_body),
    bodyPanel('Proposed SKILL.md', 'proposed', candidate.proposed_body),
    // Supporting signals (PRD §9.5 bottom panel).
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
  const [reviewer, setReviewer] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function submitReview(decision: Decision): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before deciding on the skill replacement.');
      return;
    }
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
          : `Failed to submit decision (status ${response.status}).`,
      );
    } catch {
      setStatus('Failed to submit the skill decision.');
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
      createElement('label', { htmlFor: 'reviewer' }, 'Reviewer name'),
    ),
    createElement('input', {
      id: 'reviewer',
      name: 'reviewer',
      type: 'text',
      value: reviewer,
      autoComplete: 'name',
      onChange: (e: { target: { value: string } }) => setReviewer(e.target.value),
    }),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
    ...candidates.map(candidateSection),
    createElement(
      'div',
      { role: 'group', 'aria-label': 'Decide on the skill replacement' },
      createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => submitReview('approved') },
        'Approve and replace repo skill',
      ),
      createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => submitReview('rejected') },
        'Reject',
      ),
      createElement(
        'button',
        { type: 'button', disabled: pending, onClick: () => submitReview('edited') },
        'Request changes',
      ),
    ),
  );
}
