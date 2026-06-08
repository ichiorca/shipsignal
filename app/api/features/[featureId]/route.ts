// T5/T6 (spec 004) — PATCH /api/features/{featureId} (edit a feature at Gate #1, §14.2).
// P5 / constitution §5: zod-validated body; the edit is recorded in the approvals audit
// log with edited_payload_json (AC2 "edits store edited_payload_json"), the narrative
// fields are updated, and the status is set to 'edited' so the edited feature does NOT
// flow downstream until re-approved.

import { NextResponse } from 'next/server';
import { editSchema, parseBody } from '@/app/lib/featureReview.ts';
import { applyFeatureEdit, getFeature, setFeatureStatus } from '@/app/lib/db/features.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ featureId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { featureId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(editSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid edit input', details: parsed.errors },
      { status: 400 },
    );
  }

  const feature = await getFeature(featureId);
  if (feature === null) {
    return NextResponse.json({ error: 'feature not found' }, { status: 404 });
  }

  // Record the edit decision (with the edited payload) before mutating the row.
  await recordApproval({
    target_type: 'feature',
    target_id: featureId,
    decision: 'edited',
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
    edited_payload: parsed.value.edits,
  });
  await applyFeatureEdit(featureId, parsed.value.edits);
  await setFeatureStatus(featureId, 'edited', parsed.value.notes);

  return NextResponse.json({ feature_id: featureId, status: 'edited' }, { status: 200 });
}
