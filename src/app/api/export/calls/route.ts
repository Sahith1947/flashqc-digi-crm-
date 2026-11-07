import { NextResponse, type NextRequest } from 'next/server';
import { assertRole } from '@/server/auth';
import { applyCallFilters, parseCallFilters } from '@/server/queries/calls';
import { toCsv } from '@/lib/csv';
import { formatDateTime, istDateString } from '@/lib/dates';
import { CALL_OUTCOME_LABELS, CALL_STATUS_LABELS, labelFor } from '@/lib/constants';
import { callRef } from '@/components/calls/calls-table';
import { AppError } from '@/server/providers/types';

const MAX_ROWS = 50000;

export async function GET(req: NextRequest) {
  try {
    const { db } = await assertRole('viewer');
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const filters = parseCallFilters(params);
    const rows: unknown[][] = [];
    for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
      let q = db.from('call_log_view').select('*');
      q = applyCallFilters(q, filters).order('started_at', { ascending: false }).order('id').range(offset, offset + 999);
      const { data, error } = await q;
      if (error) throw error;
      for (const c of data ?? []) {
        rows.push([
          callRef(c.call_number),
          c.contact_name,
          c.phone_e164,
          c.business_name,
          c.direction,
          formatDateTime(c.started_at),
          c.started_at,
          c.duration_seconds,
          labelFor(CALL_STATUS_LABELS, c.status),
          c.campaign_name,
          c.has_recording ? 'yes' : 'no',
          c.has_summary ? 'yes' : 'no',
          labelFor(CALL_OUTCOME_LABELS, c.outcome, ''),
          c.is_simulated ? 'SIMULATED' : 'live',
          c.notes,
        ]);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    const csv = toCsv(
      ['Call ID', 'Contact name', 'Phone', 'Business', 'Direction', 'Date & time (IST)', 'Started at (UTC)', 'Duration (s)', 'Status', 'Campaign', 'Recording', 'Summary', 'Outcome', 'Data type', 'Notes'],
      rows,
    );
    return new NextResponse('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="flashqc-calls-${istDateString()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const status = e instanceof AppError && e.code === 'unauthenticated' ? 401 : e instanceof AppError ? 403 : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : 'Export failed' }, { status });
  }
}
