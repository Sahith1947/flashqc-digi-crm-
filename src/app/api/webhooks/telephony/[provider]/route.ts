import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelephonyProvider } from '@/server/providers/registry';
import { CallEventService } from '@/server/services/call-event-service';
import { serverEnv } from '@/server/env';

// Telephony provider webhook (call status, inbound calls, recordings).
// Every request must be verified by the provider adapter before anything is written.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/webhooks/telephony/[provider]'>) {
  const { provider: providerId } = await ctx.params;
  if (!/^[a-z0-9_-]{1,40}$/.test(providerId) || providerId !== serverEnv.telephonyProvider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const provider = getTelephonyProvider(providerId);
  if (!provider.configured) return NextResponse.json({ error: 'Telephony provider not configured' }, { status: 501 });

  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  if (!(await provider.verifyWebhook(raw, req.headers))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Backend not configured' }, { status: 503 });
  try {
    const events = await provider.parseWebhook(raw, req.headers);
    for (const e of events) await CallEventService.ingestProviderEvent(admin, provider.id, e);
    return NextResponse.json({ received: events.length });
  } catch (e) {
    console.error('[telephony webhook]', e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
