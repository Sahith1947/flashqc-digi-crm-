import type { Metadata } from 'next';
import Link from 'next/link';
import { requireMember } from '@/server/auth';
import { getSummary, getTrends, pct } from '@/server/queries/analytics';
import { flatParams } from '@/lib/list-params';
import { formatBucket, formatDuration, resolveRange } from '@/lib/dates';
import { CALL_OUTCOME_LABELS, labelFor, parseScope } from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { EmptyState, Notice } from '@/components/ui/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { StackedColumns } from '@/components/charts/stacked-columns';
import { BarList } from '@/components/charts/bar-list';
import { StatusDistribution } from '@/components/calls/status-distribution';
import { CampaignModeBadge, CampaignStatusBadge } from '@/components/campaigns/campaign-badges';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage(props: PageProps<'/analytics'>) {
  const { db } = await requireMember();
  const sp = flatParams(await props.searchParams);
  const range = resolveRange(sp, '30d');
  const scope = parseScope(sp.scope);
  const days = Math.round((range.to.getTime() - range.from.getTime()) / 86400000);
  const g = days > 92 ? 'week' : 'day';
  const args = { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_scope: scope };

  const [summary, trends, hourly, outcomes, agents, campaigns] = await Promise.all([
    getSummary(db, range.from, range.to, scope),
    getTrends(db, range.from, range.to, g, scope),
    db.rpc('hourly_distribution', args),
    db.rpc('outcome_distribution', args),
    db.rpc('voice_agent_performance', args),
    db.from('campaigns').select('id, name, status, mode, created_at').order('created_at', { ascending: false }).limit(20),
  ]);
  for (const r of [hourly, outcomes, agents, campaigns]) if (r.error) throw r.error;
  const cStats = campaigns.data?.length ? await db.from('campaign_stats').select('*').in('campaign_id', campaigns.data.map((c) => c.id)) : { data: [] };
  const statsById = new Map((cStats.data ?? []).map((s) => [s.campaign_id, s]));
  const answeredFromTrends = trends.reduce((s, t) => s + t.answered, 0);

  return (
    <>
      <PageHeader title="Analytics" description={`${range.label} · IST · computed from call records`} actions={<DateRangeFilter basePath="/analytics" range={range} scope={scope} />} />
      {summary.simulated > 0 && scope !== 'live' && (
        <Notice tone="sim" className="mb-4">
          Includes {summary.simulated.toLocaleString('en-IN')} simulated calls. Switch the scope to &quot;Live only&quot; for real performance.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Answer rate" value={pct(summary.answered, summary.total)} hint={`${summary.answered.toLocaleString('en-IN')} of ${summary.total.toLocaleString('en-IN')} calls`} />
        <StatCard label="Missed rate" value={pct(summary.missed, summary.total)} hint={`${summary.missed.toLocaleString('en-IN')} missed / no answer / busy`} />
        <StatCard label="Failure rate" value={pct(summary.failed, summary.total)} hint={`${summary.failed.toLocaleString('en-IN')} failed`} />
        <StatCard label="Avg. talk time" value={formatDuration(summary.avg_duration_seconds)} hint={`${formatDuration(summary.talk_time_seconds)} total`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={g === 'day' ? 'Answered vs unanswered per day' : 'Answered vs unanswered per week'} description={`${answeredFromTrends.toLocaleString('en-IN')} answered in range`} />
          <CardBody>
            <StackedColumns
              series={[
                { key: 'answered', label: 'Answered', color: 'var(--color-series-inbound)' },
                { key: 'unanswered', label: 'Not answered', color: 'var(--color-series-outbound)' },
              ]}
              data={trends.map((t) => ({ label: formatBucket(t.bucket, g), values: { answered: t.answered, unanswered: t.total - t.answered } }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status distribution" />
          <CardBody>
            <StatusDistribution dist={summary.status_distribution} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Calls by hour of day (IST)" description="Use this to pick the best calling window" />
          <CardBody>
            <StackedColumns
              series={[
                { key: 'answered', label: 'Answered', color: 'var(--color-series-inbound)' },
                { key: 'unanswered', label: 'Not answered', color: 'var(--color-series-outbound)' },
              ]}
              data={(hourly.data ?? []).map((h) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, values: { answered: h.answered, unanswered: h.total - h.answered } }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Outcomes of answered calls" />
          <CardBody>
            <BarList items={(outcomes.data ?? []).map((o) => ({ key: o.outcome, label: labelFor(CALL_OUTCOME_LABELS, o.outcome), value: o.total, tone: 'brand' as const }))} emptyText="No answered calls in this period." />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Voice agent performance" />
          {agents.data?.length ? (
            <TableWrap>
              <Table className="min-w-[520px]">
                <thead>
                  <tr>
                    <Th>Agent</Th>
                    <Th>Calls</Th>
                    <Th>Answered</Th>
                    <Th>Answer rate</Th>
                    <Th>Avg. duration</Th>
                  </tr>
                </thead>
                <tbody>
                  {agents.data.map((a) => (
                    <Tr key={a.voice_agent_id ?? 'none'}>
                      <Td className="font-medium">{a.name}</Td>
                      <Td className="tabular">{a.total}</Td>
                      <Td className="tabular">{a.answered}</Td>
                      <Td className="tabular">{pct(a.answered, a.total)}</Td>
                      <Td className="tabular">{formatDuration(a.avg_duration_seconds)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState title="No calls in this period" />
          )}
        </Card>
        <Card>
          <CardHeader title="Campaign performance" description="All-time results of the 20 most recent campaigns" />
          {campaigns.data?.length ? (
            <TableWrap>
              <Table className="min-w-[560px]">
                <thead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th>Status</Th>
                    <Th>Contacts</Th>
                    <Th>Answered</Th>
                    <Th>Talk time</Th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.data.map((c) => {
                    const s = statsById.get(c.id);
                    return (
                      <Tr key={c.id}>
                        <Td>
                          <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                          <div className="mt-1">
                            <CampaignModeBadge mode={c.mode} />
                          </div>
                        </Td>
                        <Td>
                          <CampaignStatusBadge status={c.status} />
                        </Td>
                        <Td className="tabular">{s?.contacts_total ?? 0}</Td>
                        <Td className="tabular">
                          {s?.calls_answered ?? 0} ({pct(s?.calls_answered ?? 0, s?.calls_total ?? 0)})
                        </Td>
                        <Td className="tabular">{formatDuration(s?.talk_time_seconds ?? 0)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState title="No campaigns yet" />
          )}
        </Card>
      </div>
    </>
  );
}
