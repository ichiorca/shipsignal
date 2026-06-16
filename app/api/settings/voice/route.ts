// GET/POST /api/settings/voice — list company voice exemplars, or add one. The text is stored
// here (embedding=NULL); the worker embeds it later via Bedrock (constitution §1: no model calls
// from the Vercel app).

import { NextResponse } from 'next/server';
import { voiceExemplarInputSchema } from '@/app/lib/brandBrain.ts';
import { listVoiceExemplars, createVoiceExemplar } from '@/app/lib/db/voiceExemplars.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ exemplars: await listVoiceExemplars() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = voiceExemplarInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid voice exemplar input', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const exemplar = await createVoiceExemplar(parsed.data);
  return NextResponse.json({ exemplar }, { status: 201 });
}
