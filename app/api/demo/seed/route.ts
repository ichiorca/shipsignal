// POST /api/demo/seed (operator feedback 2026-06-09, priority 5): create a synthetic,
// fully-populated sample release so the dashboard demos without GitHub/Actions/Bedrock.
// P1: thin route — one transactional seeder call. P5: no request data is read (nothing to
// validate), the fixture is synthetic (no PII), and the demo runs are ordinary rows scoped
// by their own release_run_id (erasable/cascade-deletable like any run).

import { NextResponse } from 'next/server';
import { seedDemoRelease } from '@/app/lib/db/demoSeed.ts';

// Aurora access requires the Node.js runtime (not Edge).
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const { runId } = await seedDemoRelease();
    return NextResponse.json({ run_id: runId, seeded: true }, { status: 201 });
  } catch (err) {
    console.error('demo seed failed', { message: String(err) });
    return NextResponse.json(
      { error: 'seeding the sample release failed; is the database migrated?' },
      { status: 500 },
    );
  }
}
