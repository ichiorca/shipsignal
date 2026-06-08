// T5 (spec 006) — PATCH /api/artifacts/{artifactId} (edit an artifact at Gate #2, §14.3).
// P5 / constitution §5: zod-validated body; the edit is recorded in the approvals audit log
// with edited_payload_json, the narrative fields (title/body) are updated, and the status is
// set to 'edited' so the edited artifact does NOT publish until re-reviewed. Editing never
// touches the deterministic claims/support status.

import { NextResponse } from 'next/server';
import { artifactEditSchema, parseBody } from '@/app/lib/artifactReview.ts';
import {
  applyArtifactEdit,
  getArtifactWithClaims,
  setArtifactStatus,
} from '@/app/lib/db/claims.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const parsed = parseBody(artifactEditSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid edit input', details: parsed.errors },
      { status: 400 },
    );
  }

  const artifact = await getArtifactWithClaims(artifactId);
  if (artifact === null) {
    return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
  }

  // Record the edit decision (with the edited payload) before mutating the row.
  await recordApproval({
    target_type: 'artifact',
    target_id: artifactId,
    decision: 'edited',
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
    edited_payload: parsed.value.edits,
  });
  await applyArtifactEdit(artifactId, parsed.value.edits);
  await setArtifactStatus(artifactId, 'edited');

  return NextResponse.json({ artifact_id: artifactId, status: 'edited' }, { status: 200 });
}
