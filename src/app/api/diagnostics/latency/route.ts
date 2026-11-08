import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Signed-in only (the proxy blocks anonymous /api calls). Measures how long the server waits on the database.
export async function GET() {
  const t0 = performance.now();
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const tClaims = performance.now();
  if (!data?.claims?.sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const q: number[] = [];
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    await db.from('profiles').select('id').eq('id', data.claims.sub).maybeSingle();
    q.push(Math.round(performance.now() - s));
  }
  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? 'local',
    // Host name only (no credentials): it names the database's region, e.g. aws-0-ap-south-1.pooler.supabase.com.
    database_host: (() => {
      try {
        return new URL(process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || '').hostname;
      } catch {
        return null;
      }
    })(),
    verify_login_ms: Math.round(tClaims - t0),
    database_round_trip_ms: q,
  });
}
