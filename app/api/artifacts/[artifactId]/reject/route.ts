// T5 (spec 006) — POST /api/artifacts/{artifactId}/reject (PRD §14.3, Gate #2).
// P1: thin Vercel route. P5 / constitution §5: zod-validated body; the rejection is recorded
// in the approvals audit log with the reviewer BEFORE the status flips to 'rejected', so a
// rejected (incl. blocked) artifact is accountably recorded and does not publish.

import { NextResponse } from 'next/server';
import { artifactDecisionSchema, parseBody } from '@/app/lib/artifactReview.ts';
import { getArtifactWithClaims, setArtifactStatus } from '@/app/lib/db/claims.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { cancelSchedulesForArtifact } from '@/app/lib/db/scheduledPublishes.ts';
import { withTransaction } from '@/app/lib/aurora.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(artifactDecisionSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid rejection input', details: parsed.errors },
      { status: 400 },
    );
  }

  const artifact = await getArtifactWithClaims(artifactId);
  if (artifact === null) {
    return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
  }

  // Record the rejection, flip the status, and cancel any queued schedules ATOMICALLY — so a crash
  // can't leave a "rejected" audit row with a still-publishable status (or a pending schedule that
  // the drain would later ship).
  await withTransaction(async (client) => {
    await recordApproval(
      {
        target_type: 'artifact',
        target_id: artifactId,
        decision: 'rejected',
        reviewer: parsed.value.reviewer,
        notes: parsed.value.notes,
      },
      client,
    );
    await setArtifactStatus(artifactId, 'rejected', client);
    await cancelSchedulesForArtifact(artifactId, client);
  });

  return NextResponse.json({ artifact_id: artifactId, status: 'rejected' }, { status: 200 });
}
