// UI tier-1 #2 — the run lifecycle stepper. Replaces the flat "every screen, equal weight" link
// list on the run-detail page with an at-a-glance view of WHERE the run is and WHAT is next:
// each stage reads done / in-progress / awaiting-you / upcoming, and only reachable stages link
// out (no dead links to not-yet-reached screens). P6 (WCAG 2.2 AA): a semantic ordered list with
// `aria-current="step"` on the active stage; the state is carried by TEXT (the icon + colour are
// supplements). Pipeline shape is computed once in app/lib/runProgress.ts (buildPipeline).
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { PipelineStageView, StageState } from '@/app/lib/runProgress.ts';
import { Icon, type IconName } from './icons.ts';

export interface RunPipelineProps {
  readonly stages: readonly PipelineStageView[];
}

const STATE_LABEL: Readonly<Record<StageState, string>> = {
  done: 'Done',
  current: 'In progress',
  awaiting: 'Awaiting you',
  upcoming: 'Upcoming',
  halted: 'Halted',
};

const STATE_ICON: Readonly<Record<StageState, IconName>> = {
  done: 'check',
  current: 'current',
  awaiting: 'alert',
  upcoming: 'upcoming',
  halted: 'halted',
};

function stageBody(stage: PipelineStageView): ReactElement[] {
  const parts: ReactElement[] = [
    createElement(Icon, { key: 'icon', name: STATE_ICON[stage.state] }),
    createElement('span', { key: 'label', 'data-stage-label': true }, stage.label),
  ];
  if (stage.gate !== null) {
    parts.push(createElement('span', { key: 'gate', 'data-gate-badge': true }, `Gate #${stage.gate}`));
  }
  // The state word is the accessible signal (icon + colour merely reinforce it).
  parts.push(
    createElement('span', { key: 'state', 'data-stage-state': stage.state }, STATE_LABEL[stage.state]),
  );
  return parts;
}

function stageItem(stage: PipelineStageView): ReactElement {
  const active = stage.state === 'current' || stage.state === 'awaiting';
  const body = stageBody(stage);
  // Reachable stages are links; upcoming/halted stages are inert spans (no dead links).
  const inner =
    stage.href !== null
      ? createElement('a', { href: stage.href }, ...body)
      : createElement('span', null, ...body);
  return createElement(
    'li',
    {
      key: stage.key,
      'data-stage': stage.key,
      'data-state': stage.state,
      ...(active ? { 'aria-current': 'step' } : {}),
    },
    inner,
  );
}

/** The run lifecycle stepper. Renders an ordered list of stages with their current state. */
export function RunPipeline({ stages }: RunPipelineProps): ReactElement {
  return createElement(
    'nav',
    { 'aria-label': 'Run pipeline', 'data-run-pipeline': true },
    createElement('ol', null, ...stages.map(stageItem)),
  );
}
