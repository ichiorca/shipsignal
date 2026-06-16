// POST /api/artifacts/{artifactId}/publish/x (Path B / Phase 3). Publishes ONE approved x_post to
// X, or returns a dry-run preview when X is unconfigured. Thin Vercel route: the gate/idempotency/
// dispatch flow lives in channelPublishRoute.ts; the env-credential read lives in channelDispatch.ts.
// §2: human-gated distribution, not autopublishing.

import { NextResponse } from 'next/server';
import { handleChannelPublish } from '@/app/lib/channelPublishRoute.ts';
import { buildXPost, isXPublishable } from '@/app/lib/channelPublish.ts';
import { publishToX } from '@/app/lib/channelDispatch.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;
  return handleChannelPublish(request, artifactId, {
    channel: 'x',
    label: 'X',
    isPublishable: isXPublishable,
    build: buildXPost,
    dispatch: publishToX,
  });
}
