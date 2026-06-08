// T4 (spec 015) — GET /api/skills/candidates (PRD §14.4). Read-only: lists skill-revision
// candidates across all runs and lifecycle statuses (the skill-admin queue). P5 /
// constitution §5/§9.4: candidates are staged proposals in Aurora; this read never writes
// or promotes. Lightweight summaries only — the per-candidate route loads bodies + signals.

import { NextResponse } from 'next/server';
import { listSkillCandidates } from '@/app/lib/db/skillCandidates.ts';
import { ok } from '@/app/lib/readApi.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const result = ok({ candidates: await listSkillCandidates() });
  return NextResponse.json(result.body, { status: result.status });
}
