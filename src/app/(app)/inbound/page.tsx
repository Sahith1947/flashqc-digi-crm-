import type { Metadata } from 'next';
import Link from 'next/link';
import { PhoneCall, Radio } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { CALLS_PAGE_SIZE, campaignOptions, listCalls } from '@/server/queries/calls';
import { getSettings, lineOptions } from '@/server/queries/config';
import { isoDaysAgo } from '@/server/queries/analytics';
import { TelephonyService } from '@/server/services/telephony-service';
import { flatParams } from '@/lib/list-params';
import { hasMinRole } from '@/lib/constants';
import { formatDateTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, SimulatedBadge } from '@/components/ui/badge';
import { EmptyState, Notice } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { LinkButton } from '@/components/ui/button';
import { CallsTable } from '@/components/calls/calls-table';
import { CallFilterBar } from '@/components/calls/call-filters';
import { InboundSimulator } from '@/components/calls/call-forms';

export const metadata: Metadata = { title: 'Inbound Calls' };

export default async function InboundPage(props: PageProps<'/inbound'>) {
  const { db, profile } = await requireMember();
  const params = flatParams(await props.searchParams);
  const since = isoDaysAgo(14);
  const [list, campaigns, lines, settings, missedRes, liveRes] = await Promise.all([
    listCalls(db, params, { direction: 'inbound' }),
    campaignOptions(db),
    lineOptions(db, 'inbound'),
    getSettings(db),
    db.from('call_log_view').select('id, phone_e164, contact_name, started_at, is_simulated').eq('direction', 'inbound').eq('status', 'missed').gte('started_at', since).order('started_at', { ascending: false }).limit(50),
    TelephonyService.liveStatus(),
  ]);
  if (missedRes.error) throw missedRes.error;

  // Callback queue: missed inbound calls with no later answered call to/from that number.
  const missed = missedRes.data ?? [];
  let callbackQueue = missed;
  if (missed.length) {
    const phones = [...new Set(missed.map((m) => m.phone_e164!))];
    const { data: later, error } = await db.from('calls').select('phone_e164, started_at').in('phone_e164', phones).not('answered_at', 'is', null).gte('started_at', since);
    if (error) throw error;
    const lastAnswered = new Map<string, string>();
    for (const l of later ?? []) if (!lastAnswered.has(l.phone_e164) || lastAnswered.get(l.phone_e164)! < l.started_at) lastAnswered.set(l.phone_e164, l.started_at);
    const seen = new Set<string>();
    callbackQueue = missed.filter((m) => {
      if (seen.has(m.phone_e164!)) return false;
      seen.add(m.phone_e164!);
      const a = lastAnswered.get(m.phone_e164!);
      return !a || a < m.started_at!;
    });
  }
  const liveAvailable = liveRes.available;

  return (
    <>
      <PageHeader title="Inbound Calls" description="Calls received on your business numbers, and missed calls that need a callback." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Live inbound" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-ink-3" />
                {liveAvailable ? <Badge tone="good">Provider connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
              </div>
              <p className="text-ink-2">
                {liveAvailable
                  ? 'Inbound calls are received through the telephony provider webhook and appear here automatically.'
                  : 'Real inbound calls will appear automatically once the telephony provider webhook is connected in Phase 2.'}
              </p>
              <p className="text-xs text-ink-3">{lines.length} inbound-capable business number{lines.length === 1 ? '' : 's'} configured.</p>
            </CardBody>
          </Card>
          {hasMinRole(profile.role, 'agent') && (
            <Card>
              <CardHeader title="Simulate an inbound call" description="For testing workflows. Clearly labelled as simulated." />
              <CardBody>
                <InboundSimulator lines={lines} simulationEnabled={Boolean(settings?.simulation_mode_enabled)} />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Missed calls · callback queue" description="Missed in the last 14 days with no answered call since" />
            {callbackQueue.length ? (
              <ul className="divide-y divide-line" data-testid="callback-queue">
                {callbackQueue.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        <Link href={`/calls/${m.id}`} className="hover:underline">
                          {m.contact_name || formatPhone(m.phone_e164)}
                        </Link>
                        {m.is_simulated && <SimulatedBadge className="ml-2" />}
                      </p>
                      <p className="text-xs text-ink-3">
                        {m.contact_name && `${formatPhone(m.phone_e164)} · `}missed {formatDateTime(m.started_at)}
                      </p>
                    </div>
                    {hasMinRole(profile.role, 'agent') && (
                      <LinkButton href={`/outbound?dial=${encodeURIComponent(m.phone_e164!)}`} variant="secondary" size="sm" icon={<PhoneCall className="size-3.5" />}>
                        Call back
                      </LinkButton>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No pending callbacks" description="Every missed call from the last 14 days has been answered since." />
            )}
          </Card>
          <Card>
            <CardHeader title="Inbound history" description={`${list.total.toLocaleString('en-IN')} calls`} />
            <div className="border-b border-line p-4">
              <CallFilterBar basePath="/inbound" filters={list.filters} campaigns={campaigns} hideDirection sort={{ sort: params.sort, dir: params.dir }} />
            </div>
            {list.rows.length ? (
              <>
                <CallsTable rows={list.rows} hide={['direction', 'campaign']} sort={{ params, basePath: '/inbound' }} />
                <Pagination page={list.page} pageSize={CALLS_PAGE_SIZE} total={list.total} params={params} basePath="/inbound" />
              </>
            ) : (
              <EmptyState title="No inbound calls" description={liveAvailable ? 'No inbound calls received yet.' : 'Connect a telephony provider (Phase 2) or simulate an inbound call to test.'} />
            )}
          </Card>
        </div>
      </div>
      {!liveAvailable && <Notice tone="info" className="mt-6">Webhook endpoint prepared: <code className="font-mono text-xs">POST /api/webhooks/telephony/&lt;provider&gt;</code> — it rejects all requests until a provider adapter with signature verification is configured.</Notice>}
    </>
  );
}
