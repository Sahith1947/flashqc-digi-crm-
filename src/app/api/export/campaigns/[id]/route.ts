import { NextResponse, type NextRequest } from 'next/server';
import { assertRole } from '@/server/auth';
import { toCsv } from '@/lib/csv';
import { formatDateTime } from '@/lib/dates';
import { isUuid } from '@/lib/list-params';
import { CALL_OUTCOME_LABELS, CALL_STATUS_LABELS, labelFor } from '@/lib/constants';
import { AppError } from '@/server/providers/types';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/export/campaigns/[id]'>) {
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { db } = await assertRole('viewer');
    const { data: campaign } = await db.from('campaigns').select('name, mode').eq('id', id).maybeSingle();
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const rows: unknown[][] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const { data, error } = await db
        .from('campaign_contacts')
        .select('status, attempts, skip_reason, last_attempt_at, contacts(full_name, phone_e164, business_name, city), calls(status, duration_seconds, answered_at, outcome)')
        .eq('campaign_id', id)
        .order('created_at')
        .order('id')
        .range(offset, offset + 999);
      if (error) throw error;
      for (const cc of data ?? []) {
        const ct = cc.contacts as { full_name: string | null; phone_e164: string; business_name: string | null; city: string | null } | null;
        const call = cc.calls as { status: string; duration_seconds: number; answered_at: string | null; outcome: string | null } | null;
        rows.push([
          ct?.full_name,
          ct?.phone_e164,
          ct?.business_name,
          ct?.city,
          cc.status,
          cc.skip_reason,
          cc.attempts,
          call ? labelFor(CALL_STATUS_LABELS, call.status) : '',
          call?.answered_at ? call.duration_seconds : '',
          labelFor(CALL_OUTCOME_LABELS, call?.outcome, ''),
          cc.last_attempt_at ? formatDateTime(cc.last_attempt_at) : '',
          campaign.mode === 'simulated' ? 'SIMULATED' : 'live',
        ]);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    const csv = toCsv(['name', 'phone', 'business', 'city', 'contact_status', 'skip_reason', 'attempts', 'call_status', 'duration_s', 'outcome', 'last_attempt_ist', 'data_type'], rows);
    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'campaign';
    return new NextResponse('﻿' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="campaign-${slug}.csv"`, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const status = e instanceof AppError && e.code === 'unauthenticated' ? 401 : e instanceof AppError ? 403 : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : 'Export failed' }, { status });
  }
}
