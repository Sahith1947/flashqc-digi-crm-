import type { Metadata } from 'next';
import { scheduleBackgroundSync } from '@/server/recording-sync';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { flatParams, parseEnum, parsePage, searchTerm } from '@/lib/list-params';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUSES, hasMinRole } from '@/lib/constants';
import { formatDateTime, formatDuration } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { LinkButton } from '@/components/ui/button';
import { CampaignModeBadge, CampaignStatusBadge, Progress } from '@/components/campaigns/campaign-badges';

export const metadata: Metadata = { title: 'Bulk Campaigns' };
const PAGE = 20;

export default async function CampaignsPage(props: PageProps<'/campaigns'>) {
  const { db, profile } = await requireMember();
  scheduleBackgroundSync();
  const params = flatParams(await props.searchParams);
  const page = parsePage(params.page);
  const status = parseEnum(params.status, CAMPAIGN_STATUSES);
  const mode = parseEnum(params.mode, ['simulated', 'live'] as const);
  let q = db.from('campaigns').select('*', { count: 'exact' });
  if (status) q = q.eq('status', status);
  if (mode) q = q.eq('mode', mode);
  const term = searchTerm(params.q);
  if (term) q = q.ilike('name', term);
  const { data, count, error } = await q.order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (error && error.code !== 'PGRST103') throw error;
  const rows = data ?? [];
  const statsRes = rows.length ? await db.from('campaign_stats').select('*').in('campaign_id', rows.map((r) => r.id)) : { data: [], error: null };
  if (statsRes.error) throw statsRes.error;
  const stats = new Map((statsRes.data ?? []).map((s) => [s.campaign_id, s]));
  const canManage = hasMinRole(profile.role, 'manager');

  return (
    <>
      <PageHeader
        title="Bulk Campaigns"
        description="Upload contacts, configure and run calling campaigns. Simulated campaigns are clearly labelled until telephony is connected."
        actions={canManage ? <LinkButton href="/campaigns/new" icon={<Plus className="size-4" />}>New campaign</LinkButton> : undefined}
      />
      <Card>
        <div className="border-b border-line p-4">
          <FilterBar
            basePath="/campaigns"
            search={{ value: params.q, placeholder: 'Search campaigns' }}
            selects={[
              { name: 'status', label: 'Status', anyLabel: 'All statuses', value: status, options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABELS[s] })) },
              { name: 'mode', label: 'Mode', anyLabel: 'All modes', value: mode, options: [{ value: 'simulated', label: 'Simulated' }, { value: 'live', label: 'Live' }] },
            ]}
          />
        </div>
        {rows.length ? (
          <>
            <TableWrap>
              <Table data-testid="campaigns-table" className="min-w-[900px]">
                <thead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th>Status</Th>
                    <Th>Progress</Th>
                    <Th>Contacts</Th>
                    <Th>Answered</Th>
                    <Th>Talk time</Th>
                    <Th>Created (IST)</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const s = stats.get(c.id);
                    const done = (s?.contacts_completed ?? 0) + (s?.contacts_failed ?? 0) + (s?.contacts_skipped ?? 0);
                    return (
                      <Tr key={c.id}>
                        <Td>
                          <Link href={`/campaigns/${c.id}`} className="font-medium hover:text-brand-700 hover:underline">
                            {c.name}
                          </Link>
                          <div className="mt-1">
                            <CampaignModeBadge mode={c.mode} />
                          </div>
                        </Td>
                        <Td>
                          <CampaignStatusBadge status={c.status} />
                        </Td>
                        <Td>
                          <Progress done={done} total={s?.contacts_total ?? 0} />
                        </Td>
                        <Td className="tabular">{s?.contacts_total ?? 0}</Td>
                        <Td className="tabular">
                          {s?.calls_answered ?? 0} / {s?.calls_total ?? 0}
                        </Td>
                        <Td className="tabular">{formatDuration(s?.talk_time_seconds ?? 0)}</Td>
                        <Td className="tabular whitespace-nowrap text-ink-2">{formatDateTime(c.created_at)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={params} basePath="/campaigns" />
          </>
        ) : (
          <EmptyState
            title={Object.keys(params).length ? 'No campaigns match these filters' : 'No campaigns yet'}
            description="Create a campaign, upload a CSV of contacts and run it in simulated mode to test the workflow."
            action={canManage ? <LinkButton href="/campaigns/new" variant="dark" size="sm">New campaign</LinkButton> : undefined}
          />
        )}
      </Card>
    </>
  );
}
