// T6 (spec 008) — demo-media preview (PRD §5.4 / §13.1 media review). P6 (Quality bars / WCAG
// 2.2 AA): each asset is a headed <section> with a native, keyboard-operable player —
// <video controls> for demo video, <audio controls> for the audio digest — sourced from the
// short-expiry presigned-URL route (never a raw S3 URL). The player carries an accessible name
// (aria-label). The narration of this media is the Gate#2-approved demo_script it derives from,
// so we link to that source artifact as the media's text alternative/transcript (WCAG 1.2.x)
// rather than fabricating a captions endpoint. The provenance (source artifact, click-path hash,
// narration key, voice/model) is exposed as a description list so a reviewer can trace the
// rendered media to its approved source. constitution §4/§5: the component is typed against
// MediaAsset (key + provenance only) — no raw evidence, no S3 credentials, no s3_uri reaches the
// client; the <source> points at the server-side playback route which 302s to the signed URL.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. No client state is needed (the
// native controls own playback), so this is a plain Server-Component-safe presentational unit.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { MediaAsset } from '@/app/lib/db/mediaAssets.ts';
import { humanizeKey, humanizeStatus } from '../lib/displayFormat.ts';
import { MediaPublishActions } from './MediaPublishActions.ts';

export interface MediaPreviewProps {
  readonly assets: readonly MediaAsset[];
}

/** Human label per media type; an unknown type falls back to its raw id (visible anomaly). */
const MEDIA_TYPE_LABELS: Readonly<Record<string, string>> = {
  demo_video: 'Demo video',
  release_audio_digest: 'Release audio digest',
};

function mediaTypeLabel(mediaType: string): string {
  return MEDIA_TYPE_LABELS[mediaType] ?? mediaType;
}

/** The server-side playback route that 302s to a short-lived presigned URL (never the s3_uri). */
function playbackSrc(assetId: string): string {
  return `/api/media/${assetId}/playback`;
}

function provenanceList(asset: MediaAsset): ReactElement {
  const entries = Object.entries(asset.provenance);
  if (entries.length === 0) {
    return createElement('p', null, 'No provenance recorded.');
  }
  return createElement(
    'dl',
    { 'data-provenance-for': asset.id },
    ...entries.flatMap(([key, value]) => [
      // Humanized label for the reader; the raw value (hash/id) stays verbatim.
      createElement('dt', { key: `${key}-t`, 'data-provenance-key': key }, humanizeKey(key)),
      createElement('dd', { key: `${key}-d` }, value),
    ]),
  );
}

/** The native, keyboard-operable player for one asset. Audio digests get <audio>; everything
 *  else gets <video>. Both carry an accessible name; the text alternative/transcript is the
 *  linked source demo_script (rendered by transcriptLink), not a fabricated captions file. */
function player(asset: MediaAsset): ReactElement {
  const accessibleName = `${mediaTypeLabel(asset.media_type)} player`;
  const src = playbackSrc(asset.id);
  const isAudio = asset.media_type === 'release_audio_digest';
  // content_type is nullable on a broken asset; default to a generic type for the <source>.
  const sourceType = asset.content_type ?? 'application/octet-stream';
  if (isAudio) {
    return createElement(
      'audio',
      { controls: true, preload: 'none', 'aria-label': accessibleName, 'data-media-id': asset.id },
      createElement('source', { src, type: sourceType }),
      'Your browser does not support the audio element.',
    );
  }
  return createElement(
    'video',
    {
      controls: true,
      preload: 'none',
      'aria-label': accessibleName,
      'data-media-id': asset.id,
      width: 640,
    },
    createElement('source', { src, type: sourceType }),
    'Your browser does not support the video element.',
  );
}

/** spec 014 T4 / §16.3 — surface a BROKEN media asset: name the step that failed and the
 *  user-safe reason, instead of a player (there is no playable final media). The broken step is
 *  carried in provenance.broken_step (the §10.6 metadata_json) by the worker. */
function brokenNotice(asset: MediaAsset): ReactElement {
  const rawStep = asset.provenance['broken_step'] ?? 'unknown step';
  const stepLabel = rawStep === 'unknown step' ? rawStep : humanizeStatus(rawStep);
  const hasFailure = asset.provenance['failure'] !== undefined;
  const children: ReactElement[] = [
    createElement(
      'p',
      { key: 'step', 'data-broken-step': rawStep },
      `Demo generation broke at step: ${stepLabel}.`,
    ),
  ];
  if (hasFailure) {
    // User-safe: state that an error occurred without echoing the raw internal failure
    // value (which could carry a stack trace or diagnostic string) (UX review M6).
    children.push(
      createElement(
        'p',
        { key: 'reason' },
        'The media pipeline reported an error while completing this step.',
      ),
    );
  }
  children.push(
    createElement(
      'p',
      { key: 'recover' },
      'Re-trigger generation from the feature once the issue is resolved.',
    ),
  );
  return createElement('div', { 'data-broken-for': asset.id }, ...children);
}

/** spec 014 T4 / §16.3 — the preserved narration transcript, shown as text when captured. */
function transcriptText(asset: MediaAsset): ReactElement | null {
  if (asset.transcript === null || asset.transcript.trim() === '') return null;
  return createElement(
    'details',
    { 'data-transcript-for': asset.id },
    createElement('summary', null, 'Narration transcript'),
    createElement('p', null, asset.transcript),
  );
}

/** The media's text alternative: a link to the Gate#2-approved demo_script it was narrated from
 *  (WCAG 1.2.x). Rendered only when the source artifact is known. */
function transcriptLink(asset: MediaAsset): ReactElement | null {
  if (asset.source_artifact_id === null) return null;
  // Link to the stable per-artifact page (the claim inspector), which exists regardless of
  // the artifact's gate status — unlike a #anchor into the Gate #2 review list, which only
  // holds still-pending artifacts and has no focus target (UX review M3).
  return createElement(
    'p',
    null,
    createElement(
      'a',
      { href: `/artifacts/${asset.source_artifact_id}` },
      'View the demo script this media was narrated from (transcript)',
    ),
  );
}

/** Publish-to-YouTube action for a finished demo video (or a link if already published). Only a
 *  ready demo_video is publishable; anything else returns null. constitution §2: human-gated. */
function publishAction(asset: MediaAsset): ReactElement | null {
  if (asset.media_type !== 'demo_video') return null;
  if (asset.external_url === null && asset.status !== 'ready') return null;
  return createElement(
    'div',
    { 'data-publish-for': asset.id },
    createElement('h3', null, 'Publish'),
    createElement(MediaPublishActions, { mediaId: asset.id, publishedUrl: asset.external_url }),
  );
}

function durationText(asset: MediaAsset): string {
  if (asset.duration_seconds === null) return 'Duration unknown';
  return `Duration: ${Math.round(asset.duration_seconds)}s`;
}

function assetSection(asset: MediaAsset, index: number, total: number): ReactElement {
  const headingId = `media-${asset.id}`;
  const isBroken = asset.status === 'broken';
  // Each headed <section> is a `region` landmark; axe requires a UNIQUE accessible name per
  // landmark, and a run can hold several assets of the same media_type (e.g. two demo videos),
  // so disambiguate the heading with a 1-based ordinal when there is more than one asset.
  const headingText =
    total > 1 ? `${mediaTypeLabel(asset.media_type)} (${index + 1} of ${total})` : mediaTypeLabel(asset.media_type);
  // A broken asset has no playable final media — surface the broken step instead of a player
  // (spec 014 T4 / §16.3). A ready asset plays its final media and shows its duration.
  const body: (ReactElement | null)[] = isBroken
    ? [brokenNotice(asset)]
    : [createElement('p', { key: 'dur' }, durationText(asset)), player(asset)];
  return createElement(
    'section',
    {
      key: asset.id,
      'aria-labelledby': headingId,
      'data-media-id': asset.id,
      'data-media-status': asset.status,
    },
    createElement('h2', { id: headingId }, headingText),
    createElement('p', { 'data-status': asset.status }, `Status: ${humanizeStatus(asset.status)}`),
    ...body,
    transcriptText(asset),
    transcriptLink(asset),
    publishAction(asset),
    createElement('h3', null, 'Provenance'),
    provenanceList(asset),
  );
}

export function MediaPreview({ assets }: MediaPreviewProps): ReactElement {
  if (assets.length === 0) {
    return createElement(
      'div',
      null,
      createElement('p', null, 'No demo media has been generated for this run yet.'),
    );
  }
  return createElement(
    'div',
    null,
    ...assets.map((asset, index) => assetSection(asset, index, assets.length)),
  );
}
