// Pure decision logic for publishing a media asset to an external platform (e.g. YouTube).
// DB/network-free: every side effect is an injected dep, so the gates + two-phase idempotency +
// dry-run branch are unit-tested without Aurora/S3/YouTube (mirrors channelPublishLogic.ts).
//
// constitution §2 (human-gated distribution, not autopublish) + §5: only a FINISHED demo video can
// be published; the body names an accountable reviewer recorded BEFORE the outward upload.

import type { DispatchAcquire } from '@/app/lib/db/approvals.ts';
import type { MediaForPublish } from '@/app/lib/db/mediaAssets.ts';
import type { YouTubePublishResult, YouTubeUploadInput } from '@/app/lib/youtube.ts';

/** Only a ready demo video is publishable to a video platform. */
export const PUBLISHABLE_MEDIA_TYPE = 'demo_video';
export const PUBLISHABLE_MEDIA_STATUS = 'ready';

export interface MediaPublishCommand {
  readonly mediaId: string;
  readonly platform: 'youtube';
  readonly reviewer: string;
  readonly notes?: string;
  readonly title: string;
  readonly description: string;
}

export interface RouteResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface MediaPublishDeps {
  readonly getMedia: (mediaId: string) => Promise<MediaForPublish | null>;
  readonly willDryRun: () => boolean;
  readonly beginDispatch: (
    args: {
      readonly target_type: 'media_publish';
      readonly target_id: string;
      readonly decision: 'approved';
      readonly reviewer: string;
      readonly notes?: string;
    },
    dedupeKey: string,
  ) => Promise<DispatchAcquire>;
  readonly completeDispatch: (id: string) => Promise<void>;
  readonly deleteApproval: (id: string) => Promise<void>;
  readonly fetchVideoBytes: (
    s3Uri: string,
    fallbackContentType: string,
  ) => Promise<{ readonly bytes: Uint8Array; readonly contentType: string }>;
  readonly publish: (input: YouTubeUploadInput) => Promise<YouTubePublishResult>;
  readonly recordPublication: (
    mediaId: string,
    publication: {
      readonly platform: string;
      readonly url: string;
      readonly videoId: string | null;
      readonly publishedBy: string;
    },
  ) => Promise<void>;
}

/** Decide and (unless dry-run) perform a media publish. Pure control flow over injected effects. */
export async function decideMediaPublish(
  cmd: MediaPublishCommand,
  deps: MediaPublishDeps,
): Promise<RouteResult> {
  const media = await deps.getMedia(cmd.mediaId);
  if (media === null) {
    return { status: 404, body: { error: 'media asset not found' } };
  }
  if (media.media_type !== PUBLISHABLE_MEDIA_TYPE) {
    return {
      status: 409,
      body: {
        error: `only a ${PUBLISHABLE_MEDIA_TYPE} can be published to ${cmd.platform}; this asset is a ${media.media_type}`,
      },
    };
  }
  if (media.status !== PUBLISHABLE_MEDIA_STATUS) {
    return {
      status: 409,
      body: {
        error: `only a finished (status='${PUBLISHABLE_MEDIA_STATUS}') demo video can be published; this one is '${media.status}'`,
      },
    };
  }
  if (media.s3_uri === null) {
    return { status: 409, body: { error: 'media asset has no stored video to publish' } };
  }
  // Already published → idempotent success with the existing link (no re-upload).
  if (media.external_url !== null) {
    return {
      status: 200,
      body: {
        published: true,
        destination: cmd.platform,
        url: media.external_url,
        idempotent: true,
      },
    };
  }

  // Dry-run: report intent without an audit row, idempotency marker, or upload (channel parity).
  if (deps.willDryRun()) {
    return {
      status: 200,
      body: { published: false, dryRun: true, destination: cmd.platform },
    };
  }

  // Two-phase idempotent dispatch: acquire a 'pending' marker BEFORE the upload.
  const acquire = await deps.beginDispatch(
    {
      target_type: 'media_publish',
      target_id: cmd.mediaId,
      decision: 'approved',
      reviewer: cmd.reviewer,
      notes: cmd.notes ?? `${cmd.platform} upload`,
    },
    `media_publish:${cmd.mediaId}:${cmd.platform}`,
  );
  if (acquire.kind === 'completed') {
    return { status: 200, body: { published: true, destination: cmd.platform, idempotent: true } };
  }
  if (acquire.kind === 'in_flight') {
    return {
      status: 409,
      body: {
        error: `a ${cmd.platform} publish for this video is already in progress; refresh to see its result before retrying`,
        inFlight: true,
      },
    };
  }
  const approvalId = acquire.id;

  try {
    const object = await deps.fetchVideoBytes(media.s3_uri, media.content_type ?? 'video/mp4');
    const result = await deps.publish({
      title: cmd.title,
      description: cmd.description,
      privacyStatus: 'unlisted',
      videoBytes: object.bytes,
      contentType: object.contentType,
    });
    if (result.url === null) {
      // Defensive: a non-dry-run publish must return a URL; treat a missing one as a failure.
      throw new Error('publish returned no url');
    }
    await deps.recordPublication(cmd.mediaId, {
      platform: cmd.platform,
      url: result.url,
      videoId: result.videoId,
      publishedBy: cmd.reviewer,
    });
    await deps.completeDispatch(approvalId);
    return {
      status: 200,
      body: { published: true, destination: cmd.platform, url: result.url, videoId: result.videoId },
    };
  } catch (err) {
    // Clear the dedupe marker so a retry can re-acquire it, then report 502 (status-only message).
    await deps.deleteApproval(approvalId).catch((e: unknown) =>
      console.error('failed to clear media-publish dedupe marker; retry may be blocked', {
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    console.error('media publish failed', { mediaId: cmd.mediaId, message: String(err) });
    return {
      status: 502,
      body: { error: `publishing to ${cmd.platform} failed; check the server logs and retry` },
    };
  }
}
