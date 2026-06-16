// T5 (spec 004) — POST /api/features/{featureId}/reject (PRD §14.2).
// P5 / constitution §5: zod-validated body; the rejection is recorded in the approvals
// audit log and the feature status is set to 'rejected' so it does NOT flow downstream
// to content generation (spec 005 loads only 'approved' features).

import { NextResponse } from 'next/server';
import { decisionSchema, parseBody } from '@/app/lib/featureReview.ts';
import { getFeature, setFeatureStatus } from '@/app/lib/db/features.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { withTransaction } from '@/app/lib/aurora.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ featureId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { featureId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(decisionSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid rejection input', details: parsed.errors },
      { status: 400 },
    );
  }

  const feature = await getFeature(featureId);
  if (feature === null) {
    return NextResponse.json({ error: 'feature not found' }, { status: 404 });
  }

  // Record the decision and apply the status ATOMICALLY (mirrors the approve route): the audit
  // row and the status flip commit together, so a crash between them can't leave a 'rejected'
  // audit row on a feature still 'pending_review' that then flows into content generation.
  await withTransaction(async (client) => {
    await recordApproval(
      {
        target_type: 'feature',
        target_id: featureId,
        decision: 'rejected',
        reviewer: parsed.value.reviewer,
        notes: parsed.value.notes,
      },
      client,
    );
    await setFeatureStatus(featureId, 'rejected', parsed.value.notes, client);
  });

  return NextResponse.json({ feature_id: featureId, status: 'rejected' }, { status: 200 });
}
