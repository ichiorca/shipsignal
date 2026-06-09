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
  tryApproveArtifact,
} from '@/app/lib/db/claims.ts';
import { recordApproval } from '@/app/lib/db/approvals.ts';
import { snapshotApprovedArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { dispatchArtifactApprovedWebhook } from '@/app/lib/outboundDispatch.ts';
import { withTransaction } from '@/app/lib/aurora.ts';

export const runtime = 'nodejs';

/** Thrown inside the approval transaction when the conditional status flip matches no row
 *  (artifact already decided or re-blocked), so the whole transaction rolls back → 409. */
class GateConflictError extends Error {}

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
          'artifact cannot be approved: it is blocked, edited (needs re-validation), or has ' +
          'unsupported claims; reject or re-validate it instead',
        status: artifact.status,
      },
      { status: 409 },
    );
  }

  // Record the decision, snapshot the approved content, and flip the status ATOMICALLY in one
  // transaction (T2 spec 016 / §18.3). The flip is a CONDITIONAL guard (only a not-blocked,
  // not-already-approved row moves), so a concurrent double-submit, or an artifact re-blocked by
  // the worker between the isApprovable read and this write, matches no row → GateConflictError →
  // the whole transaction rolls back and we return 409. This means an approval/snapshot is never
  // recorded for a flip that didn't win, and an 'approved' status never exists without its
  // tamper-evident audit record (fail closed, constitution §5).
  try {
    await withTransaction(async (client) => {
      const approvalId = await recordApproval(
        {
          target_type: 'artifact',
          target_id: artifactId,
          decision: 'approved',
          reviewer: parsed.value.reviewer,
          notes: parsed.value.notes,
        },
        client,
      );
      await snapshotApprovedArtifact(
        artifact,
        { reviewer: parsed.value.reviewer, decision: 'approved', approval_id: approvalId },
        client,
      );
      if (!(await tryApproveArtifact(artifactId, client))) {
        throw new GateConflictError();
      }
    });
  } catch (err) {
    if (err instanceof GateConflictError) {
      return NextResponse.json(
        {
          error:
            'artifact cannot be approved: it is blocked or already decided; ' +
            'reject or edit it instead',
        },
        { status: 409 },
      );
    }
    throw err;
  }

  // T3 (spec 019) — distribution AFTER the human gate: the approval (and its §18.3 snapshot)
  // is already committed, so the outbound webhook fires on the publishable truth. Fail-soft:
  // a webhook outage never fails the approval; the outcome is audited on the delivery ledger.
  const webhookDelivery = await dispatchArtifactApprovedWebhook(artifactId);

  return NextResponse.json(
    { artifact_id: artifactId, status: 'approved', webhook_delivery: webhookDelivery },
    { status: 200 },
  );
}
