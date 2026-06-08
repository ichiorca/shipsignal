// T5 (spec 006) — POST /api/artifacts/{artifactId}/approve (PRD §14.3, Gate #2).
// P1: thin Vercel route — validate, enforce the safety gate, record the decision, set status.
// P5 / constitution §5: the body is zod-validated; an artifact that a check BLOCKED, or that
// still carries any unsupported claim, CANNOT be approved (409) — "an unsupported/high-risk
// claim cannot reach an approved state" and "every approved claim has >=1 evidence link".
// The approval is recorded in the audit log (approvals row) BEFORE the status flips, so there
// is no path that approves without an accountable reviewer (no self-approval).

import { NextResponse } from 'next/server';
import { artifactDecisionSchema, parseBody } from '@/app/lib/artifactReview.ts';
import {
  getArtifactWithClaims,
  isApprovable,
  setArtifactStatus,
} from '@/app/lib/db/claims.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { snapshotApprovedArtifact } from '@/app/lib/db/approvedSnapshots.ts';

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
      { error: 'invalid approval input', details: parsed.errors },
      { status: 400 },
    );
  }

  const artifact = await getArtifactWithClaims(artifactId);
  if (artifact === null) {
    return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
  }

  // The hard gate: a blocked artifact or one with an unlinkable/unsupported claim is never
  // approvable (constitution §5). Reject/edit it instead.
  if (!isApprovable(artifact)) {
    return NextResponse.json(
      {
        error:
          'artifact cannot be approved: it is blocked or has unsupported claims; ' +
          'reject or edit it instead',
        status: artifact.status,
      },
      { status: 409 },
    );
  }

  // Record the human decision first (immutable audit trail), then snapshot the approved content,
  // then flip the status. T2 (spec 016) / §18.3: the approved content is captured into the
  // immutable approved_artifact_snapshots record (distinct from the mutable artifact row) BEFORE
  // the status flips — if the snapshot write fails the request fails (500) and the artifact is
  // never marked approved, so an approval can never exist without its tamper-evident audit record
  // (fail closed, constitution §5).
  const approvalId = await recordApproval({
    target_type: 'artifact',
    target_id: artifactId,
    decision: 'approved',
    reviewer: parsed.value.reviewer,
    notes: parsed.value.notes,
  });
  await snapshotApprovedArtifact(artifact, {
    reviewer: parsed.value.reviewer,
    decision: 'approved',
    approval_id: approvalId,
  });
  await setArtifactStatus(artifactId, 'approved');

  return NextResponse.json({ artifact_id: artifactId, status: 'approved' }, { status: 200 });
}
