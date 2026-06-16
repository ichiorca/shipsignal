// POST /api/internal/scheduled-publishes/run (Path B / Phase 4). The drain endpoint the GitHub
// Actions cron calls to ship due, approved scheduled posts. NOT a public action: it is gated by a
// shared secret (SCHEDULED_PUBLISH_SECRET). Off by default — when the secret is unset the route
// returns 503 (the same "unset = feature off" posture as Slack), so an unprotected send endpoint is
// never exposed. constitution §1/§2: the cron is the sanctioned runner; this route only drains.

import { NextResponse } from 'next/server';
import { runDueSchedules } from '@/app/lib/scheduledPublishRunner.ts';
import { drainAuthDecision } from '@/app/lib/scheduledPublishLogic.ts';
import { optionalEnv } from '@/app/lib/env.ts';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const decision = drainAuthDecision(
    request.headers.get('authorization'),
    optionalEnv('SCHEDULED_PUBLISH_SECRET', ''),
  );
  if (decision === 'disabled') {
    return NextResponse.json(
      { error: 'scheduled-publish drain is disabled (SCHEDULED_PUBLISH_SECRET is unset)' },
      { status: 503 },
    );
  }
  if (decision === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const summary = await runDueSchedules(new Date());
  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
