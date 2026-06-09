// T1 (spec 019) — GET /api/artifacts/{artifactId}/export?format=markdown|html|json (PRD §14.3,
// §18.1). P1: thin route — validate the format at the boundary, read the snapshot, render.
// P5 (Safety rails) / §18.1: the export reads ONLY the immutable approved snapshot (the
// publishable truth frozen at Gate #2) — a draft, blocked, edited, or rejected artifact has no
// snapshot and gets a user-safe 409, so non-approved content can never leave through this door.
// Content-Disposition is set so the dashboard's Download links work without client-side JS.

import { NextResponse } from 'next/server';
import {
  FORMAT_CONTENT_TYPE,
  exportFilename,
  isExportFormat,
  renderExport,
} from '@/app/lib/artifactExport.ts';
import { getApprovedSnapshotForArtifact } from '@/app/lib/db/approvedSnapshots.ts';
import { getArtifactWithClaims } from '@/app/lib/db/claims.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ artifactId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { artifactId } = await context.params;

  const format = new URL(request.url).searchParams.get('format') ?? 'markdown';
  if (!isExportFormat(format)) {
    return NextResponse.json(
      { error: 'format must be one of: markdown, html, json' },
      { status: 400 },
    );
  }

  const snapshot = await getApprovedSnapshotForArtifact(artifactId);
  if (snapshot === null) {
    // Distinguish "no such artifact" (404) from "exists but was never approved" (409) without
    // leaking anything beyond the artifact's review state.
    const artifact = await getArtifactWithClaims(artifactId);
    if (artifact === null) {
      return NextResponse.json({ error: 'artifact not found' }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          'artifact is not approved: only artifacts approved at Gate #2 can be exported; ' +
          'review and approve it first',
        status: artifact.status,
      },
      { status: 409 },
    );
  }

  return new NextResponse(renderExport(snapshot, format), {
    status: 200,
    headers: {
      'Content-Type': FORMAT_CONTENT_TYPE[format],
      'Content-Disposition': `attachment; filename="${exportFilename(snapshot, format)}"`,
    },
  });
}
