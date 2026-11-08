import { NextResponse, type NextRequest } from 'next/server';
import { assertRole } from '@/server/auth';
import { toCsv } from '@/lib/csv';
import { formatDateTime } from '@/lib/dates';
import { isUuid } from '@/lib/list-params';
import { CALL_OUTCOME_LABELS, CALL_STATUS_LABELS, labelFor } from '@/lib/constants';
import { AppError } from '@/server/providers/types';
import { INTEREST_LABELS, LEAD_STAGE_LABELS, type Interest, type LeadStage } from '@/lib/leads';

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
        .from('campaign_results_view')
        .select('*')
        .eq('campaign_id', id)
        .order('created_at')
        .order('campaign_contact_id')
        .range(offset, offset + 999);
      if (error) throw error;
      for (const r of data ?? []) {
        rows.push([
          r.full_name,
          r.phone_e164,
          r.business_name,
          INTEREST_LABELS[(r.interest ?? 'unclear') as Interest | 'pending' | 'skipped'],
          LEAD_STAGE_LABELS[(r.lead_stage ?? 'new') as LeadStage],
          r.emotion ?? '',
          r.summary ?? '',
          r.contact_status,
          r.skip_reason,
          r.attempts,
          r.call_id ? labelFor(CALL_STATUS_LABELS, r.call_status) : '',
          r.is_answered ? r.duration_seconds : '',
          labelFor(CALL_OUTCOME_LABELS, r.outcome, ''),
          r.has_recording ? 'yes' : 'no',
          r.last_attempt_at ? formatDateTime(r.last_attempt_at) : '',
          campaign.mode === 'simulated' ? 'SIMULATED' : 'live',
        ]);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    const csv = toCsv(['name', 'phone', 'business', 'interest', 'funnel_stage', 'emotion', 'why', 'contact_status', 'skip_reason', 'attempts', 'call_status', 'duration_s', 'outcome', 'recording', 'last_attempt_ist', 'data_type'], rows);
    const slug = campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'campaign';
    return new NextResponse('﻿' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="campaign-${slug}.csv"`, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const status = e instanceof AppError && e.code === 'unauthenticated' ? 401 : e instanceof AppError ? 403 : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : 'Export failed' }, { status });
  }
}
