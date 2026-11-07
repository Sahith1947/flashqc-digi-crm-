import { NextResponse, type NextRequest } from 'next/server';
import { assertRole } from '@/server/auth';
import { applyContactFilters, parseContactFilters } from '@/server/queries/contacts';
import { toCsv } from '@/lib/csv';
import { formatDateTime, istDateString } from '@/lib/dates';
import { AppError } from '@/server/providers/types';

const HEADERS = ['name', 'phone', 'business_name', 'business_category', 'city', 'source', 'consent', 'dnd', 'notes', 'suppressed', 'total_calls', 'last_call_ist', 'last_call_outcome', 'created_ist'];

function csvResponse(body: string, name: string) {
  return new NextResponse('﻿' + body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { db } = await assertRole('viewer');
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    if (params.template) {
      return csvResponse(toCsv(['name', 'phone', 'business_name', 'business_category', 'city', 'source', 'consent', 'dnd', 'notes'], []), 'flashqc-contacts-template.csv');
    }
    const filters = parseContactFilters(params);
    const rows: unknown[][] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      let q = db.from('contacts_with_stats').select('*');
      q = applyContactFilters(q, filters).order('created_at', { ascending: false }).order('id').range(offset, offset + 999);
      const { data, error } = await q;
      if (error) throw error;
      for (const c of data ?? []) {
        rows.push([
          c.full_name,
          c.phone_e164,
          c.business_name,
          c.business_category,
          c.city,
          c.source,
          c.consent_status,
          c.dnd_status,
          c.notes,
          c.is_suppressed ? 'yes' : 'no',
          c.total_calls,
          c.last_call_at ? formatDateTime(c.last_call_at) : '',
          c.last_call_outcome,
          formatDateTime(c.created_at),
        ]);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    return csvResponse(toCsv(HEADERS, rows), `flashqc-contacts-${istDateString()}.csv`);
  } catch (e) {
    const status = e instanceof AppError && e.code === 'unauthenticated' ? 401 : e instanceof AppError ? 403 : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : 'Export failed' }, { status });
  }
}
