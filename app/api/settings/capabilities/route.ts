// POST/DELETE /api/settings/capabilities — operator edits to the capability→skill mapping
// (migration 0032). POST adds/updates one (capability, skill) edge as an operator override; DELETE
// removes one. The worker resolves these at generation time (DB-wins-per-type over the code
// default). No model calls here (constitution §1). All writes are parameterised.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isArtifactType } from '@/app/lib/artifactTypes.ts';
import {
  upsertCapabilitySkill,
  deleteCapabilitySkill,
} from '@/app/lib/db/capabilitySkills.ts';

export const runtime = 'nodejs';

const editSchema = z.object({
  artifact_type: z.string().trim().refine(isArtifactType, {
    message: 'artifact_type must be a known artifact type',
  }),
  skill_name: z.string().trim().min(1).max(120),
  required: z.boolean().default(true),
});

async function parse(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = editSchema.safeParse(await parse(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid capability mapping', details: parsed.error.issues },
      { status: 400 },
    );
  }
  await upsertCapabilitySkill(parsed.data.artifact_type, parsed.data.skill_name, parsed.data.required);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const parsed = editSchema.safeParse(await parse(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid capability mapping', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const removed = await deleteCapabilitySkill(parsed.data.artifact_type, parsed.data.skill_name);
  return NextResponse.json({ ok: true, removed });
}
