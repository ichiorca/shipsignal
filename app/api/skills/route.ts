// T4 (spec 015) — GET /api/skills (PRD §14.4). Read-only: lists the active repo skills
// with their Aurora snapshot counts. P5 / constitution §9.2: Aurora is the provenance
// ledger; this surfaces snapshot metadata of the repo-canonical SKILL.md files. No secret
// or DB handle reaches the client.

import { NextResponse } from 'next/server';
import { listSkills } from '@/app/lib/db/skills.ts';
import { ok } from '@/app/lib/readApi.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const result = ok({ skills: await listSkills() });
  return NextResponse.json(result.body, { status: result.status });
}
