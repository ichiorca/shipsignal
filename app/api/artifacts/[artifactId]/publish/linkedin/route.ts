// POST /api/artifacts/{artifactId}/publish/linkedin (Path B / Phase 3). Publishes ONE approved
// linkedin_post to the configured LinkedIn company page, or returns a dry-run preview when LinkedIn
// is unconfigured. Thin Vercel route over the shared channel-publish handler. §2: human-gated.

import { NextResponse } from 'next/server';
import { handleChannelPublish } from '@/app/lib/channelPublishRoute.ts';
import { buildLinkedInPost, isLinkedInPublishable } from '@/app/lib/channelPublish.ts';
import { publishToLinkedIn } from '@/app/lib/channelDispatch.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;
  return handleChannelPublish(request, artifactId, {
    channel: 'linkedin',
    label: 'LinkedIn',
    isPublishable: isLinkedInPublishable,
    build: buildLinkedInPost,
    dispatch: publishToLinkedIn,
  });
}
