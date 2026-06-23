// GET/PUT /api/settings/voice-guide — read or save the singleton structured brand-voice guide
// (migration 0033). A single resource (no id), so PUT replaces the whole guide. The worker renders
// the saved guide into every generation prompt (constitution §1: no model calls from the app here).

import { NextResponse } from 'next/server';
import { voiceGuideInputSchema } from '@/app/lib/brandBrain.ts';
import { getVoiceGuide, updateVoiceGuide } from '@/app/lib/db/voiceGuide.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ guide: await getVoiceGuide() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = voiceGuideInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid voice guide input', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const guide = await updateVoiceGuide(parsed.data);
  return NextResponse.json({ guide });
}
