// GET /api/health — liveness/readiness probe (UX review M10). Confirms the server is up AND
// that Aurora is reachable, so on-call can check the app without triggering a real release run.
// constitution §5: the response is secret-free — a DB error is never echoed (it could carry the
// DSN), only a coarse 'unavailable' status.

import { NextResponse } from 'next/server';
import { query } from '@/app/lib/aurora.ts';

// DB check requires the Node.js runtime (not Edge); always evaluated fresh.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await query('SELECT 1');
    return NextResponse.json({ status: 'ok', database: 'reachable' }, { status: 200 });
  } catch {
    return NextResponse.json(
      { status: 'unavailable', database: 'unreachable' },
      { status: 503 },
    );
  }
}
