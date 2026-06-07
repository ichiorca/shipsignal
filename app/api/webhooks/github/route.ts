// T4 (spec 001) — GitHub release-tag webhook.
// P5 (Safety rails) + github-rules: verify HMAC over the RAW body, dedupe on the
// delivery GUID (idempotent), respond 2xx in well under 10s, and only then create a
// release_run for the tag's compare range. Unsigned → 401; replayed GUID → 200 no-op.

import { NextResponse } from 'next/server';
import { requireEnv } from '@/app/lib/env.ts';
import {
  verifyGithubSignature,
  extractReleaseTagDelivery,
} from '@/app/lib/githubWebhook.ts';
import { AuroraDeliveryGuidStore } from '@/app/lib/db/webhookDeliveries.ts';
import { insertReleaseRun } from '@/app/lib/db/releaseRuns.ts';

// HMAC verification + Aurora require the Node.js runtime (not Edge).
export const runtime = 'nodejs';

const deliveryStore = new AuroraDeliveryGuidStore('github');

export async function POST(request: Request): Promise<NextResponse> {
  // Read the RAW body exactly once; never re-serialize before verifying.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const deliveryGuid = request.headers.get('x-github-delivery');
  const event = request.headers.get('x-github-event');

  const auth = verifyGithubSignature(rawBody, signature, requireEnv('GITHUB_WEBHOOK_SECRET'));
  if (!auth.ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: auth.status });
  }

  if (!deliveryGuid) {
    return NextResponse.json({ error: 'missing delivery id' }, { status: 400 });
  }

  // Replay protection: a redelivered GUID is acknowledged but does no work.
  const isNew = await deliveryStore.markIfNew(deliveryGuid);
  if (!isNew) {
    return NextResponse.json({ status: 'ignored', reason: 'duplicate delivery' }, { status: 200 });
  }

  // Only act on published-release events; ack-and-ignore anything else so GitHub
  // does not redeliver.
  if (event !== 'release') {
    return NextResponse.json({ status: 'ignored', reason: 'unhandled event' }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid JSON payload' }, { status: 400 });
  }

  const delivery = extractReleaseTagDelivery(payload);
  if (delivery === null) {
    return NextResponse.json({ status: 'ignored', reason: 'not a usable release' }, { status: 200 });
  }

  // Compare range: from the previous tag (unknown at the webhook boundary in the
  // skeleton) to the released tag. base_ref defaults to the repo's empty-tree-relative
  // baseline marker until evidence collection resolves the prior tag.
  const run = await insertReleaseRun({
    repo: delivery.repo,
    base_ref: delivery.previousTag ?? `${delivery.tag}^`,
    head_ref: delivery.tag,
    trigger_type: 'release_tag',
    run_metadata: { delivery_guid: deliveryGuid },
  });

  return NextResponse.json({ status: 'created', run_id: run.id }, { status: 201 });
}
