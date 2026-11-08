import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, Phone } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { scheduleBackgroundSync } from '@/server/recording-sync';
import { flatParams, parseEnum, parsePage, searchTerm } from '@/lib/list-params';
import { hasMinRole } from '@/lib/constants';
import { formatDateTime, formatDuration } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { EmotionBadge, LeadStageBadge, TemperatureBadge } from '@/components/contacts/lead-badges';
import { LeadStageSelect } from '@/components/contacts/lead-stage-select';
import { RecordingPlayButton } from '@/components/calls/recording-play-button';
import { callLead } from './actions';

export const metadata: Metadata = { title: 'Hot Leads' };
export const maxDuration = 60;
const PAGE = 25;
const TABS = [
  { key: 'interested', label: 'Interested' },
  { key: 'callback', label: 'Callback' },
  { key: 'meeting_booked', label: 'Meeting booked' },
  { key: 'won', label: 'Converted' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default async function HotLeadsPage(props: PageProps<'/leads'>) {
  const [{ db, profile }, sp] = await Promise.all([requireMember(), props.searchParams]);
  scheduleBackgroundSync();
  const params = flatParams(sp);
  const stage = parseEnum(params.stage, TABS.map((t) => t.key) as unknown as readonly TabKey[]);
  const page = parsePage(params.page);
  const canCall = hasMinRole(profile.role, 'agent');

  let q = db.from('hot_leads_view').select('*', { count: 'exact' });
  if (stage) q = q.eq('lead_stage', stage);
  const term = searchTerm(params.q);
  if (term) {
    const digits = (params.q ?? '').replace(/\D/g, '');
    const parts = [`full_name.ilike.${term}`, `business_name.ilike.${term}`];
    if (digits.length >= 3) parts.push(`phone_e164.ilike.%${digits}%`);
    q = q.or(parts.join(','));
  }
  const [{ data, count, error }, countsRes] = await Promise.all([
    q.order('lead_updated_at', { ascending: false, nullsFirst: false }).order('contact_id').range((page - 1) * PAGE, page * PAGE - 1),
    db.from('hot_leads_view').select('lead_stage').limit(20000),
  ]);
  if (error && error.code !== 'PGRST103') throw error;
  const counts = new Map<string, number>();
  for (const r of countsRes.data ?? []) counts.set(r.lead_stage!, (counts.get(r.lead_stage!) ?? 0) + 1);
  const total = countsRes.data?.length ?? 0;
  const href = (k: string | null) => {
    const u = new URLSearchParams();
    if (k) u.set('stage', k);
    if (params.q) u.set('q', params.q);
    const s = u.toString();
    return `/leads${s ? `?${s}` : ''}`;
  };
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Hot Leads"
        description="Everyone who showed interest, asked for a callback, booked a meeting or became a client. Updated automatically after every AI call."
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 pt-4 pb-3" data-testid="lead-tabs">
          {[{ key: null, label: 'All' }, ...TABS].map((t) => {
            const n = t.key ? (counts.get(t.key) ?? 0) : total;
            const active = (stage ?? null) === t.key;
            return (
              <Link
                key={t.key ?? 'all'}
                href={href(t.key)}
                data-testid={`lead-tab-${t.key ?? 'all'}`}
                className={`rounded-full border px-3.5 py-1.5 text-sm ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-ink-3'}`}
              >
                {t.label} <span className="tabular opacity-70">{n}</span>
              </Link>
            );
          })}
        </div>
        <div className="border-b border-line p-4">
          <FilterBar basePath="/leads" search={{ value: params.q, placeholder: 'Name, business or phone' }} hidden={stage ? { stage } : undefined} />
        </div>
        {rows.length ? (
          <>
            <TableWrap>
              <Table data-testid="hot-leads-table" className="min-w-[960px]">
                <thead>
                  <tr>
                    <Th>Client</Th>
                    <Th>Stage</Th>
                    <Th>Why (last call)</Th>
                    <Th>Last call</Th>
                    <Th>Recording</Th>
                    <Th className="w-44">Move to</Th>
                    <Th className="w-14"><span className="sr-only">Call</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Tr key={r.contact_id}>
                      <Td className="min-w-44">
                        <Link href={`/contacts/${r.contact_id}`} className="font-medium hover:underline">
                          {r.full_name || 'Unnamed'}
                        </Link>
                        <p className="tabular text-xs whitespace-nowrap text-ink-3">{formatPhone(r.phone_e164)}</p>
                        {r.business_name && <p className="max-w-52 truncate text-xs text-ink-3">{r.business_name}</p>}
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <LeadStageBadge stage={r.lead_stage} />
                          {r.lead_temperature && <TemperatureBadge temperature={r.lead_temperature} />}
                          {r.last_emotion && <EmotionBadge emotion={r.last_emotion} />}
                        </div>
                      </Td>
                      <Td className="max-w-80 min-w-60">
                        {r.call_id ? (
                          <Link href={`/calls/${r.call_id}`} className="line-clamp-3 text-xs text-ink-2 hover:text-ink hover:underline" title={r.why ?? ''}>
                            {r.why || 'Open the call for the transcript.'}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-3">Marked manually.</span>
                        )}
                      </Td>
                      <Td className="tabular text-xs whitespace-nowrap text-ink-2">
                        {r.last_call_at ? (
                          <>
                            {formatDateTime(r.last_call_at)}
                            <span className="block text-ink-3">
                              {formatDuration(r.last_call_duration)} · {r.total_calls} call{r.total_calls === 1 ? '' : 's'}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        {r.call_id ? (
                          <RecordingPlayButton callId={r.call_id} hasRecording={Boolean(r.has_recording)} label={r.full_name || r.phone_e164 || 'call'} />
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </Td>
                      <Td>
                        <LeadStageSelect contactId={r.contact_id!} stage={r.lead_stage ?? 'interested'} disabled={!canCall} />
                      </Td>
                      <Td>
                        {canCall && (
                          <ConfirmAction
                            action={callLead.bind(null, r.contact_id!)}
                            label={<Phone className="size-4" />}
                            variant="primary"
                            title={`Call ${r.full_name || formatPhone(r.phone_e164)} now?`}
                            description="Your AI agent calls this client right away (uses Sarvam credits). The result and recording appear here when the call ends."
                            confirmLabel="Call now"
                            testId="call-lead"
                            disabled={r.consent_status === 'revoked' || r.dnd_status === 'registered'}
                          />
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={params} basePath="/leads" />
          </>
        ) : (
          <EmptyState
            icon={<Flame className="size-5" />}
            title={stage || params.q ? 'No clients match this filter' : 'No hot leads yet'}
            description="When a caller shows interest, asks for a callback or books a meeting, they appear here automatically with the call recording."
          />
        )}
      </Card>
    </>
  );
}
