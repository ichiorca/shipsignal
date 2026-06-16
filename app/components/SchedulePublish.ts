// Path B / Phase 4 — schedule an approved post for later ("ship when your audience is awake"). The
// channel is derived from the artifact type (x_post → X, linkedin_post → LinkedIn); Hacker News is
// assisted-only, so it never schedules. Only shown when PUBLISH_MODE=scheduled; otherwise a short
// hint explains how to enable it.
//
// P6 (WCAG 2.2 AA): a real <form> with a labelled datetime + reviewer input, real <button>s, and a
// polite live region. "use client": owns the form state and posts to the schedule route; no secret
// is involved. Authored with React.createElement so it renders under the dependency-free harness.

'use client';

import { createElement, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';
import { useReviewerName } from '../lib/useReviewerName.ts';
import { formatTimestamp } from '../lib/displayFormat.ts';
import type { ScheduledPublishView, ScheduleChannel } from '../lib/scheduledPublish.ts';

export interface SchedulePublishProps {
  readonly artifactId: string;
  readonly artifactType: string;
  /** PUBLISH_MODE=scheduled — when false, the UI explains how to turn scheduling on. */
  readonly schedulingEnabled: boolean;
  /** Suggested next good window (ISO) used as the input default. */
  readonly suggestedTimeIso: string;
  /** Existing schedules for this artifact (both channels). */
  readonly schedules: readonly ScheduledPublishView[];
}

/** The channel this artifact type schedules to, or null when it isn't schedulable. */
function channelFor(artifactType: string): ScheduleChannel | null {
  if (artifactType === 'x_post') return 'x';
  if (artifactType === 'linkedin_post') return 'linkedin';
  return null;
}

/** ISO (UTC) → the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in the BROWSER's local zone.
 *  A datetime-local value is interpreted as local time on submit (`new Date(value).toISOString()`),
 *  so the default must be the suggested instant expressed in local wall-clock — otherwise the
 *  round-trip silently shifts the schedule by the reviewer's UTC offset. Must run client-side
 *  (getTimezoneOffset is the browser's), so it's applied in an effect, not the SSR initial value. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.length >= 16 ? iso.slice(0, 16) : iso;
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function SchedulePublish({
  artifactId,
  artifactType,
  schedulingEnabled,
  suggestedTimeIso,
  schedules,
}: SchedulePublishProps): ReactElement | null {
  const channel = channelFor(artifactType);
  const [when, setWhen] = useState('');
  const [reviewer, setReviewer] = useReviewerName();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // Seed the datetime-local default in the browser's local zone once mounted (client-only, so the
  // local offset is the reviewer's, not the SSR server's). The user can change it freely.
  useEffect(() => {
    setWhen((current) => (current === '' ? toLocalInputValue(suggestedTimeIso) : current));
  }, [suggestedTimeIso]);

  // Not a schedulable type (e.g. a blog or a Hacker News post) → render nothing.
  if (channel === null) return null;

  const existing = schedules.find((s) => s.channel === channel) ?? null;

  // Unique heading id per artifact — several SchedulePublish instances render on the Gate #2 page.
  const headingId = `schedule-heading-${artifactId}`;

  if (!schedulingEnabled) {
    return createElement(
      'section',
      { 'aria-labelledby': headingId, 'data-schedule-publish': artifactId },
      createElement('h2', { id: headingId }, 'Schedule'),
      createElement(
        'p',
        null,
        'Scheduling is off. Set PUBLISH_MODE=scheduled to queue approved posts to ship at a chosen time.',
      ),
    );
  }

  async function submit(): Promise<void> {
    if (reviewer.trim() === '') {
      setStatus('Enter your reviewer name before scheduling.');
      return;
    }
    let iso: string;
    try {
      iso = new Date(when).toISOString();
    } catch {
      setStatus('Pick a valid date and time.');
      return;
    }
    setBusy(true);
    setStatus('Scheduling…');
    try {
      const response = await clientFetch(`/api/artifacts/${artifactId}/schedule/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: reviewer.trim(), scheduledAt: iso }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (response.ok) {
        setStatus(`Scheduled for ${formatTimestamp(iso)}. Reloading…`);
        window.location.reload();
      } else {
        setStatus(typeof body.error === 'string' ? body.error : `Scheduling failed (status ${response.status}).`);
      }
    } catch {
      setStatus('Scheduling failed — could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    setBusy(true);
    setStatus('Cancelling…');
    try {
      const response = await clientFetch(`/api/artifacts/${artifactId}/schedule/${channel}`, { method: 'DELETE' });
      if (response.ok) {
        setStatus('Cancelled. Reloading…');
        window.location.reload();
      } else {
        setStatus('Could not cancel the schedule.');
      }
    } catch {
      setStatus('Could not cancel — could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const inputId = `schedule-time-${artifactId}`;
  const reviewerId = `schedule-reviewer-${artifactId}`;

  return createElement(
    'section',
    { 'aria-labelledby': headingId, 'data-schedule-publish': artifactId },
    createElement('h2', { id: headingId }, `Schedule to ${channel === 'x' ? 'X' : 'LinkedIn'}`),
    existing !== null && existing.status === 'pending'
      ? createElement(
          'p',
          { 'data-existing-schedule': existing.id, role: 'status' },
          `Currently scheduled for ${formatTimestamp(existing.scheduled_at)}. `,
          createElement(
            'button',
            { type: 'button', disabled: busy, 'data-secondary': true, onClick: () => void cancel() },
            'Cancel schedule',
          ),
        )
      : null,
    createElement(
      'form',
      { onSubmit: (e: { preventDefault: () => void }) => e.preventDefault() },
      createElement('label', { htmlFor: inputId }, 'Publish at'),
      createElement('input', {
        id: inputId,
        type: 'datetime-local',
        value: when,
        onChange: (e: { target: { value: string } }) => setWhen(e.target.value),
      }),
      createElement('label', { htmlFor: reviewerId }, 'Reviewer name (required to schedule)'),
      createElement('input', {
        id: reviewerId,
        type: 'text',
        value: reviewer,
        autoComplete: 'name',
        onChange: (e: { target: { value: string } }) => setReviewer(e.target.value),
      }),
      createElement(
        'button',
        { type: 'button', disabled: busy, onClick: () => void submit() },
        existing !== null && existing.status === 'pending' ? 'Reschedule' : 'Schedule post',
      ),
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, status),
  );
}
