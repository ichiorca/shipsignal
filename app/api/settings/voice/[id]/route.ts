// DELETE /api/settings/voice/{id} — remove one company voice exemplar.

import { NextResponse } from 'next/server';
import { deleteVoiceExemplar } from '@/app/lib/db/voiceExemplars.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const deleted = await deleteVoiceExemplar(id);
  if (!deleted) {
    return NextResponse.json({ error: 'voice exemplar not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true }, { status: 200 });
}
