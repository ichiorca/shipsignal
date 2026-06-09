// T5 (spec 004) — POST /api/features/{featureId}/approve (PRD §14.2).
// P1: thin Vercel route — it only validates, records the decision, and sets status.
// P5 / constitution §5: the body is zod-validated; the approval is recorded in the
// audit log (approvals row) BEFORE the feature status flips to 'approved' — there is no
// path that approves without an accountable reviewer (no self-approval).

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
      { error: 'invalid approval input', details: parsed.errors },
      { status: 400 },
    );
  }

  const feature = await getFeature(featureId);
  if (feature === null) {
    return NextResponse.json({ error: 'feature not found' }, { status: 404 });
  }

  // Record the decision and apply the status ATOMICALLY, so the audit row and the status flip
  // commit together (no approved feature without its audit record, and no audit record without
  // the status). The per-feature status stays freely re-decidable before the manifest gate.
  await withTransaction(async (client) => {
    await recordApproval(
      {
        target_type: 'feature',
        target_id: featureId,
        decision: 'approved',
        reviewer: parsed.value.reviewer,
        notes: parsed.value.notes,
      },
      client,
    );
    await setFeatureStatus(featureId, 'approved', parsed.value.notes, client);
  });

  return NextResponse.json({ feature_id: featureId, status: 'approved' }, { status: 200 });
}
