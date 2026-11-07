import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { RecordingPlayButton } from './recording-play-button';
import type { CallLogRow } from '@/lib/supabase/types';
import { CALL_OUTCOME_LABELS, labelFor } from '@/lib/constants';
import { formatDateTime, formatDuration } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { CallStatusBadge, DirectionBadge, SimulatedBadge } from '@/components/ui/badge';
import { SortTh, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';

export const CALL_SORTS = ['started_at', 'duration_seconds', 'status', 'call_number'] as const;

export function callRef(n: number | null | undefined) {
  return n ? `CL-${String(n).padStart(6, '0')}` : '—';
}

type Column = 'direction' | 'campaign' | 'business' | 'artifacts' | 'outcome';

export function CallsTable({
  rows,
  hide = [],
  sort,
}: {
  rows: CallLogRow[];
  hide?: Column[];
  sort?: { params: Record<string, string | undefined>; basePath: string };
}) {
  const show = (c: Column) => !hide.includes(c);
  const header = (label: string, col: (typeof CALL_SORTS)[number]) =>
    sort ? <SortTh label={label} column={col} params={sort.params} basePath={sort.basePath} /> : <Th>{label}</Th>;
  return (
    <TableWrap>
      <Table data-testid="calls-table">
        <thead>
          <tr>
            {header('Call ID', 'call_number')}
            <Th>Contact</Th>
            {show('business') && <Th>Business</Th>}
            {show('direction') && <Th>Direction</Th>}
            {header('Date & time (IST)', 'started_at')}
            {header('Duration', 'duration_seconds')}
            {header('Status', 'status')}
            {show('campaign') && <Th>Campaign</Th>}
            {show('artifacts') && <Th>Recording · AI</Th>}
            {show('outcome') && <Th>Outcome</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Tr key={c.id}>
              <Td className="whitespace-nowrap">
                <Link href={`/calls/${c.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                  {callRef(c.call_number)}
                </Link>
                {c.is_simulated && (
                  <div className="mt-1">
                    <SimulatedBadge />
                  </div>
                )}
              </Td>
              <Td className="min-w-40">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.contact_name || <span className="text-ink-3">Unknown</span>}</p>
                  <p className="tabular text-xs whitespace-nowrap text-ink-3">{formatPhone(c.phone_e164)}</p>
                </div>
              </Td>
              {show('business') && <Td className="max-w-48 truncate text-ink-2">{c.business_name || '—'}</Td>}
              {show('direction') && (
                <Td>
                  <DirectionBadge direction={c.direction ?? ''} />
                </Td>
              )}
              <Td className="tabular whitespace-nowrap text-ink-2">{formatDateTime(c.started_at)}</Td>
              <Td className="tabular whitespace-nowrap">{c.is_answered ? formatDuration(c.duration_seconds) : '—'}</Td>
              <Td>
                <CallStatusBadge status={c.status ?? ''} />
              </Td>
              {show('campaign') && (
                <Td className="max-w-40 truncate">
                  {c.campaign_id ? (
                    <Link href={`/campaigns/${c.campaign_id}`} className="text-ink-2 hover:text-ink hover:underline">
                      {c.campaign_name}
                    </Link>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
              )}
              {show('artifacts') && (
                <Td>
                  <span className="flex items-center gap-2 text-ink-3">
                    <RecordingPlayButton callId={c.id!} hasRecording={Boolean(c.has_recording)} label={c.contact_name || c.phone_e164 || 'call'} />
                    <FileText className={c.has_transcript ? 'size-4 text-ink' : 'size-4 opacity-30'} aria-label={c.has_transcript ? 'Has transcript' : 'No transcript'} />
                    <Sparkles className={c.has_summary ? 'size-4 text-ink' : 'size-4 opacity-30'} aria-label={c.has_summary ? 'Has summary' : 'No summary'} />
                  </span>
                </Td>
              )}
              {show('outcome') && <Td className="whitespace-nowrap text-ink-2">{labelFor(CALL_OUTCOME_LABELS, c.outcome)}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
