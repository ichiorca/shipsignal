// POST /api/artifacts/{artifactId}/publish/hackernews (Path B / Phase 3). Hacker News has no
// programmatic submit, so this is ASSISTED, not automated (operator decision 2026-06-15): it
// returns the prepared "Show HN" title + body + the submit-form URL for a human to post. Nothing
// is sent, no credential is involved, and no approval row is recorded (it isn't a publish).
// Still gated to a Gate #2 approved snapshot of the right type. §2: human-gated by construction.

import { NextResponse } from 'next/server';
import { buildShowHnSubmission, isHackerNewsAssistable } from '@/app/lib/channelPublish.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;

  const snapshot = await getApprovedSnapshotForArtifact(artifactId);
  if (snapshot === null) {
    const artifact = await getArtifactWithClaims(artifactId);
    if (artifact === null) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'artifact is not approved: only artifacts approved at Gate #2 can be prepared', status: artifact.status },
      { status: 409 },
    );
  }
  if (!isHackerNewsAssistable(snapshot.artifact_type)) {
    return NextResponse.json(
      { error: `this artifact type (${snapshot.artifact_type}) is not a Hacker News post` },
      { status: 409 },
    );
  }

  const submission = buildShowHnSubmission(snapshot);
  return NextResponse.json(
    {
      prepared: true,
      assisted: true,
      destination: 'hackernews',
      title: submission.title,
      text: submission.text,
      submitUrl: submission.submitUrl,
    },
    { status: 200 },
  );
}
