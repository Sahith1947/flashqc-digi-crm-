import type { Metadata } from 'next';
import { scheduleBackgroundSync } from '@/server/recording-sync';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { getSummary, getTrends, trailingWindow } from '@/server/queries/analytics';
import { resolveRange, formatBucket } from '@/lib/dates';
import { flatParams } from '@/lib/list-params';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, labelFor, parseScope, type CampaignStatus } from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { EmptyState, Notice } from '@/components/ui/states';
import { Badge, SimulatedBadge } from '@/components/ui/badge';
import { MetricCards } from '@/components/calls/metric-cards';
import { StatusDistribution } from '@/components/calls/status-distribution';
import { CallsTable } from '@/components/calls/calls-table';
import { StackedColumns } from '@/components/charts/stacked-columns';
import { LineChart } from '@/components/charts/line-chart';
import { BarList } from '@/components/charts/bar-list';
import { LinkButton } from '@/components/ui/button';
import { LEAD_STAGE_LABELS, LEAD_STAGE_TONE, LEAD_STAGES } from '@/lib/leads';

export const metadata: Metadata = { title: 'Overview' };

const DIRECTION_SERIES = [
  { key: 'inbound', label: 'Inbound', color: 'var(--color-series-inbound)' },
  { key: 'outbound', label: 'Outbound', color: 'var(--color-series-outbound)' },
];
const TREND_SERIES = [
  { key: 'total', label: 'Total calls', color: 'var(--color-series-outbound)' },
  { key: 'answered', label: 'Answered', color: 'var(--color-series-inbound)' },
];

export default async function OverviewPage(props: PageProps<'/'>) {
  const { db, profile } = await requireMember();
  scheduleBackgroundSync();
  const sp = flatParams(await props.searchParams);
  const range = resolveRange(sp, '30d');
  const scope = parseScope(sp.scope);
  const trend = sp.trend === 'month' ? 'month' : 'week';
  const days = Math.round((range.to.getTime() - range.from.getTime()) / 86400000);
  const dailyGranularity = days > 92 ? 'week' : 'day';
  const tw = trailingWindow(trend);

  const [summary, daily, trends, recentCalls, recentCampaigns, leadRes] = await Promise.all([
    getSummary(db, range.from, range.to, scope),
    getTrends(db, range.from, range.to, dailyGranularity, scope),
    getTrends(db, tw.from, tw.to, trend, scope),
    (() => {
      let q = db.from('call_log_view').select('*').order('started_at', { ascending: false }).limit(8);
      if (scope === 'live') q = q.eq('is_simulated', false);
      if (scope === 'simulated') q = q.eq('is_simulated', true);
      return q;
    })(),
    db.from('campaigns').select('id, name, status, mode, created_at').order('created_at', { ascending: false }).limit(5),
    db.from('contacts').select('lead_stage, lead_temperature').limit(20000),
  ]);
  if (recentCalls.error) throw recentCalls.error;
  const leadRows = leadRes.data;
  const stageCount = new Map<string, number>();
  const tempCount = new Map<string, number>();
  for (const r of leadRows ?? []) {
    stageCount.set(r.lead_stage, (stageCount.get(r.lead_stage) ?? 0) + 1);
    if (r.lead_temperature) tempCount.set(r.lead_temperature, (tempCount.get(r.lead_temperature) ?? 0) + 1);
  }
  if (recentCampaigns.error) throw recentCampaigns.error;
  const statsRes = recentCampaigns.data.length
    ? await db.from('campaign_stats').select('*').in('campaign_id', recentCampaigns.data.map((c) => c.id))
    : { data: [], error: null };
  if (statsRes.error) throw statsRes.error;
  const statsById = new Map((statsRes.data ?? []).map((s) => [s.campaign_id, s]));

  const trendHref = (t: string) => {
    const q = new URLSearchParams(Object.entries({ ...sp, trend: t }).filter(([, v]) => v) as [string, string][]);
    return `/?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={`Welcome${profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        description={`Call activity for ${range.label.toLowerCase()} · times shown in IST`}
        actions={<DateRangeFilter basePath="/" range={range} scope={scope} />}
      />
      {sp.denied && <Notice tone="warning" className="mb-4">You do not have permission to open that page with your current role.</Notice>}
      {summary.simulated > 0 && scope === 'all' && (
        <Notice tone="sim" className="mb-4">
          {summary.simulated.toLocaleString('en-IN')} of {summary.total.toLocaleString('en-IN')} calls in this period are <strong>simulated</strong> test data.
          Use the data scope filter to show live calls only.
        </Notice>
      )}

      <MetricCards s={summary} />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={dailyGranularity === 'day' ? 'Daily calls' : 'Calls per week'} description="Inbound vs outbound, IST calendar days" />
          <CardBody>
            <StackedColumns
              series={DIRECTION_SERIES}
              data={daily.map((d) => ({ label: formatBucket(d.bucket, dailyGranularity), values: { inbound: d.inbound, outbound: d.outbound } }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Call status distribution" description="Share of calls by final status" />
          <CardBody>
            <StatusDistribution dist={summary.status_distribution} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={trend === 'week' ? 'Weekly trend · last 12 weeks' : 'Monthly trend · last 12 months'}
            action={
              <div className="flex rounded-lg border border-line-strong p-0.5 text-xs" role="tablist" aria-label="Trend granularity">
                {(['week', 'month'] as const).map((t) => (
                  <Link
                    key={t}
                    href={trendHref(t)}
                    role="tab"
                    aria-selected={trend === t}
                    className={`rounded-md px-2.5 py-1 font-medium ${trend === t ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}
                    scroll={false}
                  >
                    {t === 'week' ? 'Weekly' : 'Monthly'}
                  </Link>
                ))}
              </div>
            }
          />
          <CardBody>
            <LineChart series={TREND_SERIES} data={trends.map((d) => ({ label: formatBucket(d.bucket, trend), values: { total: d.total, answered: d.answered } }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Inbound vs outbound" description={range.label} />
          <CardBody>
            <BarList
              items={[
                { key: 'inbound', label: 'Inbound', value: summary.inbound, tone: 'info' },
                { key: 'outbound', label: 'Outbound', value: summary.outbound, tone: 'brand' },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Leads pipeline"
            description="All contacts by stage · updated automatically after each AI call"
            action={<LinkButton href="/contacts" variant="ghost" size="sm">Contacts <ArrowRight className="size-3.5" /></LinkButton>}
          />
          <CardBody>
            <div data-testid="leads-pipeline">
              <BarList
                items={LEAD_STAGES.map((s) => ({ key: s, label: LEAD_STAGE_LABELS[s], value: stageCount.get(s) ?? 0, tone: LEAD_STAGE_TONE[s] === 'brand' ? ('brand' as const) : LEAD_STAGE_TONE[s] }))}
                emptyText="No contacts yet. Leads are created automatically when someone talks to your AI agent."
              />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Lead temperature" description="From the AI's post-call analysis" />
          <CardBody>
            <BarList
              items={[
                { key: 'hot', label: 'Hot', value: tempCount.get('hot') ?? 0, tone: 'critical' as const },
                { key: 'warm', label: 'Warm', value: tempCount.get('warm') ?? 0, tone: 'warning' as const },
                { key: 'cold', label: 'Cold', value: tempCount.get('cold') ?? 0, tone: 'info' as const },
              ]}
              emptyText="No AI-rated leads yet."
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recent calls" action={<LinkButton href="/calls" variant="ghost" size="sm">View all <ArrowRight className="size-3.5" /></LinkButton>} />
          {recentCalls.data.length ? (
            <CallsTable rows={recentCalls.data} hide={['business', 'artifacts', 'campaign', 'outcome']} />
          ) : (
            <EmptyState
              title="No calls yet"
              description="Calls appear here once they are placed, received or simulated."
              action={<LinkButton href="/outbound" variant="dark" size="sm">Go to outbound calling</LinkButton>}
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Recent campaigns" action={<LinkButton href="/campaigns" variant="ghost" size="sm">View all <ArrowRight className="size-3.5" /></LinkButton>} />
          {recentCampaigns.data.length ? (
            <ul className="divide-y divide-line">
              {recentCampaigns.data.map((c) => {
                const st = statsById.get(c.id);
                const total = st?.contacts_total ?? 0;
                const done = st?.contacts_completed ?? 0;
                return (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/campaigns/${c.id}`} className="truncate text-sm font-medium hover:underline">
                        {c.name}
                      </Link>
                      <Badge tone={CAMPAIGN_STATUS_TONE[c.status as CampaignStatus]}>{labelFor(CAMPAIGN_STATUS_LABELS, c.status)}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-3">
                      {c.mode === 'simulated' && <SimulatedBadge />}
                      <span className="tabular">
                        {done}/{total} contacts completed · {st?.calls_answered ?? 0} answered
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No campaigns yet" action={<LinkButton href="/campaigns/new" variant="dark" size="sm">Create campaign</LinkButton>} />
          )}
        </Card>
      </div>
    </>
  );
}
