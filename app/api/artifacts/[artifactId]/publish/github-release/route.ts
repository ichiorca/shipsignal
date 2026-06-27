// POST /api/artifacts/{artifactId}/publish/github-release (operator feedback 2026-06-09,
// priority 1: close the last mile). Publishes ONE approved changelog/blog as the GitHub
// Release body for the run's released tag — converting approved content into a real release
// announcement with one click.
//
// P1 (Substrate): thin Vercel route — validate, read the snapshot, one authenticated GitHub
// call, record the audit row. P5 / §18.1: only the immutable Gate #2 snapshot is publishable
// (draft/blocked/rejected → 409); the body names an accountable reviewer recorded BEFORE the
// outward call. constitution §2: this is human-gated distribution (a human button behind
// Gate #2), not autopublishing.

import { NextResponse } from 'next/server';
import { publishRequestSchema, isGitHubPublishable, buildGitHubReleasePayload } from '@/app/lib/publish.ts';
import { publishGitHubRelease } from '@/app/lib/publishDispatch.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { beginApprovalDispatch, completeApprovalDispatch, deleteApproval } from '@/app/lib/db/approvals.ts';
import { parseBody } from '@/app/lib/featureReview.ts';

// Aurora + the authenticated GitHub call require the Node.js runtime (not Edge).
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
  const parsed = parseBody(publishRequestSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid publish input', details: parsed.errors },
      { status: 400 },
    );
  }

  const snapshot = await getApprovedSnapshotForArtifact(artifactId);
  if (snapshot === null) {
    const artifact = await getArtifactWithClaims(artifactId);
    if (artifact === null) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          'artifact is not approved: only artifacts approved at Gate #2 can be published',
        status: artifact.status,
      },
      { status: 409 },
    );
  }

  if (!isGitHubPublishable(snapshot.artifact_type)) {
    return NextResponse.json(
      {
        error:
          'only a changelog entry or release blog can be published as a GitHub Release; ' +
          `this artifact is a ${snapshot.artifact_type}`,
      },
      { status: 409 },
    );
  }

  const run = await getReleaseRun(snapshot.release_run_id);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }

  // Two-phase idempotent dispatch (audit trail, §10.4): acquire a 'pending' marker BEFORE the
  // outward call. A completed marker → idempotent success; a still-pending one (a concurrent
  // publish mid-flight) → 409 'in_flight', never a false 'published'. Marked completed only after
  // GitHub accepts the release; deleted on failure so a retry can re-acquire it.
  const acquire = await beginApprovalDispatch(
    {
      target_type: 'artifact_publish',
      target_id: artifactId,
      decision: 'approved',
      reviewer: parsed.value.reviewer,
      notes: parsed.value.notes ?? `github_release tag=${run.head_ref}`,
    },
    `artifact_publish:${artifactId}:github_release`,
  );
  if (acquire.kind === 'completed') {
    return NextResponse.json(
      { published: true, destination: 'github_release', idempotent: true },
      { status: 200 },
    );
  }
  if (acquire.kind === 'in_flight') {
    return NextResponse.json(
      {
        error: 'a GitHub Release publish for this artifact is already in progress; refresh to see its result before retrying',
        inFlight: true,
      },
      { status: 409 },
    );
  }
  const approvalId = acquire.id;

  try {
    const release = await publishGitHubRelease(
      run.repo,
      buildGitHubReleasePayload(snapshot, run.head_ref),
    );
    await completeApprovalDispatch(approvalId);
    return NextResponse.json(
      { published: true, destination: 'github_release', url: release.html_url, created: release.created },
      { status: 200 },
    );
  } catch (err) {
    // The outward call failed; clear the dedupe marker so a retry can proceed, then report 502.
    // The helper's errors are status-only (never the token or a response body).
    await deleteApproval(approvalId).catch((e: unknown) => console.error("failed to clear dedupe marker; retry may be blocked", { message: e instanceof Error ? e.message : String(e) }));
    console.error('github release publish failed', { artifactId, message: String(err) });
    return NextResponse.json(
      { error: 'publishing to GitHub Releases failed; check the server logs and retry' },
      { status: 502 },
    );
  }
}
