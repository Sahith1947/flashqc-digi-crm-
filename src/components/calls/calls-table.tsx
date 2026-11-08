import Link from 'next/link';
import { RecordingPlayButton } from './recording-play-button';
import { SelectAllCalls } from './bulk-call-actions';
import { BULK_FORM_ID } from './bulk-form-id';
import { EmotionBadge, InterestBadge } from '@/components/contacts/lead-badges';
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

/** 'business' is kept for older callers; the business now shows under the contact name. 'artifacts' is the Recording column. */
type Column = 'direction' | 'campaign' | 'business' | 'artifacts' | 'outcome' | 'emotion' | 'interest';

export function CallsTable({
  rows,
  hide = [],
  sort,
  selectable = false,
}: {
  rows: CallLogRow[];
  hide?: Column[];
  sort?: { params: Record<string, string | undefined>; basePath: string };
  /** Adds tick boxes for the bulk actions toolbar (BulkCallActions must be on the page). */
  selectable?: boolean;
}) {
  const show = (c: Column) => !hide.includes(c);
  const header = (label: string, col: (typeof CALL_SORTS)[number]) =>
    sort ? <SortTh label={label} column={col} params={sort.params} basePath={sort.basePath} /> : <Th>{label}</Th>;
  return (
    <TableWrap>
      <Table data-testid="calls-table">
        <thead>
          <tr>
            {selectable && (
              <Th className="w-10">
                <SelectAllCalls />
              </Th>
            )}
            {header('Call ID', 'call_number')}
            <Th>Contact</Th>
            {show('direction') && <Th>Direction</Th>}
            {header('Date & time (IST)', 'started_at')}
            {header('Duration', 'duration_seconds')}
            {header('Status', 'status')}
            {show('interest') && <Th>Interest</Th>}
            {show('emotion') && <Th>Emotion</Th>}
            {show('artifacts') && <Th>Recording</Th>}
            {show('outcome') && <Th>Outcome</Th>}
            {show('campaign') && <Th>Campaign</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <Tr key={c.id}>
              {selectable && (
                <Td className="w-10">
                  <input type="checkbox" form={BULK_FORM_ID} name="ids" value={c.id!} aria-label={`Select ${callRef(c.call_number)}`} className="size-4 accent-brand-600" />
                </Td>
              )}
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
                  <p className="tabular text-xs whitespace-nowrap text-ink-3">
                    {formatPhone(c.phone_e164)}
                    {c.business_name ? ` · ${c.business_name}` : ''}
                  </p>
                </div>
              </Td>
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
              {show('interest') && (
                <Td>
                  <InterestBadge interest={c.interest} />
                </Td>
              )}
              {show('emotion') && (
                <Td>
                  <EmotionBadge emotion={c.emotion} />
                </Td>
              )}
              {show('artifacts') && (
                <Td>
                  <RecordingPlayButton callId={c.id!} hasRecording={Boolean(c.has_recording)} answered={Boolean(c.is_answered)} simulated={Boolean(c.is_simulated)} label={c.contact_name || c.phone_e164 || 'call'} />
                </Td>
              )}
              {show('outcome') && <Td className="whitespace-nowrap text-ink-2">{labelFor(CALL_OUTCOME_LABELS, c.outcome)}</Td>}
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
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
