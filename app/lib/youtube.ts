// Pure YouTube types + the videos.insert resource builder — NO 'server-only', NO env, NO network,
// so it is importable by the node --test unit harness (the server-only upload + OAuth live in
// youtubePublish.ts). Mirrors the codebase split between pure builders (channelPublish.ts) and the
// server-only dispatch (channelDispatch.ts).

// YouTube field limits (snippet.title ≤ 100, snippet.description ≤ 5000).
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;

export type YouTubePrivacyStatus = 'unlisted' | 'private' | 'public';

export interface YouTubeUploadInput {
  readonly title: string;
  readonly description: string;
  readonly privacyStatus: YouTubePrivacyStatus;
  readonly videoBytes: Uint8Array;
  readonly contentType: string;
}

export interface YouTubePublishResult {
  readonly videoId: string | null;
  readonly url: string | null;
  readonly dryRun: boolean;
}

export interface YouTubeVideoResource {
  readonly snippet: { readonly title: string; readonly description: string };
  readonly status: {
    readonly privacyStatus: YouTubePrivacyStatus;
    readonly selfDeclaredMadeForKids: boolean;
  };
}

/** The `videos.insert` resource body (snippet + status), with title/description clamped to the
 *  YouTube limits. Pure, so it is unit-testable without a network call. */
export function buildVideoResource(input: {
  readonly title: string;
  readonly description: string;
  readonly privacyStatus: YouTubePrivacyStatus;
}): YouTubeVideoResource {
  return {
    snippet: {
      title: input.title.slice(0, YOUTUBE_TITLE_MAX),
      description: input.description.slice(0, YOUTUBE_DESCRIPTION_MAX),
    },
    status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: false },
  };
}
