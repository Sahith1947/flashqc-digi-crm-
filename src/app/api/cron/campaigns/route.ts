import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/server/env';
import { CampaignService } from '@/server/services/campaign-service';

// Scheduled campaign processing (e.g. Vercel Cron / Supabase pg_cron hitting this URL every minute).
// Auth: "Authorization: Bearer <CRON_SECRET>". Processes a bounded batch per running campaign.
function authorized(req: NextRequest) {
  const expected = serverEnv.cronSecret;
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!expected || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY not configured' }, { status: 503 });
  const { data: running, error } = await admin.from('campaigns').select('id').eq('status', 'running').limit(20);
  if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 });
  const results = [];
  for (const c of running ?? []) {
    try {
      results.push({ id: c.id, ...(await CampaignService.processBatch(admin, c.id, 10)) });
    } catch (e) {
      results.push({ id: c.id, error: e instanceof Error ? e.message : 'failed' });
    }
  }
  return NextResponse.json({ processedCampaigns: results.length, results });
}
