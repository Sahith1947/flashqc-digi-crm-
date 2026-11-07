import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelephonyProvider } from '@/server/providers/registry';
import { CallEventService } from '@/server/services/call-event-service';
import { SarvamWebhookService } from '@/server/services/sarvam-webhook-service';
import { safeEqual, sarvamWebhookSecret } from '@/server/crypto';
import { serverEnv } from '@/server/env';

// Telephony provider webhooks (call results, inbound calls, recordings).
// Every request is authenticated before anything is written.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/webhooks/telephony/[provider]'>) {
  const { provider: providerId } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Backend not configured' }, { status: 503 });

  // ---- Sarvam: authenticated by the shared secret it echoes back in metadata.
  if (providerId === 'sarvam') {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const meta = ((body as { metadata?: Record<string, unknown> })?.metadata ?? {}) as Record<string, unknown>;
    const presented = typeof meta.crm_secret === 'string' ? meta.crm_secret : (req.nextUrl.searchParams.get('k') ?? '');
    let expected: string;
    try {
      expected = sarvamWebhookSecret();
    } catch {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
    }
    if (!presented || !safeEqual(presented, expected)) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    try {
      const res = await SarvamWebhookService.handle(admin, body);
      return NextResponse.json({ received: true, call_id: res.callId, status: res.status });
    } catch (e) {
      console.error('[sarvam webhook]', e);
      // Non-2xx so Sarvam marks the delivery failed and it can be retried.
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
  }

  // ---- Other providers via the adapter registry (signature verified by the adapter).
  if (!/^[a-z0-9_-]{1,40}$/.test(providerId) || providerId !== serverEnv.telephonyProvider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const provider = getTelephonyProvider(providerId);
  if (!provider.configured) return NextResponse.json({ error: 'Telephony provider not configured' }, { status: 501 });
  if (!(await provider.verifyWebhook(raw, req.headers))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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
