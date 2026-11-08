import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { campaignOptions, CALLS_PAGE_SIZE, listCalls } from '@/server/queries/calls';
import { flatParams } from '@/lib/list-params';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { buttonClass } from '@/components/ui/button';
import { CallsTable } from '@/components/calls/calls-table';
import { CallFilterBar } from '@/components/calls/call-filters';
import { scheduleRecordingSweep } from '@/server/recording-sync';
import { BulkCallActions } from '@/components/calls/bulk-call-actions';
import { hasMinRole } from '@/lib/constants';

export const metadata: Metadata = { title: 'Call Logs' };
// First playback of a Sarvam recording downloads it (a few seconds); allow time for that.
export const maxDuration = 60;

export default async function CallLogsPage(props: PageProps<'/calls'>) {
  const { db, profile } = await requireMember();
  const canAdmin = hasMinRole(profile.role, 'admin');
  const params = flatParams(await props.searchParams);
  const [{ rows, total, page, filters }, campaigns] = await Promise.all([listCalls(db, params), campaignOptions(db)]);
  scheduleRecordingSweep();
  const exportQs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== 'page') as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title="Call Logs"
        description="Complete history of inbound and outbound calls. Times in IST."
        actions={
          <a href={`/api/export/calls${exportQs ? `?${exportQs}` : ''}`} className={buttonClass('secondary')} download>
            <Download className="size-4" /> Export CSV
          </a>
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <CallFilterBar basePath="/calls" filters={filters} campaigns={campaigns} sort={{ sort: params.sort, dir: params.dir }} />
        </div>
        {rows.length ? (
          <>
            {canAdmin && <BulkCallActions />}
            <CallsTable rows={rows} sort={{ params, basePath: '/calls' }} selectable={canAdmin} hide={campaigns.length ? [] : ['campaign']} />
            <Pagination page={page} pageSize={CALLS_PAGE_SIZE} total={total} params={params} basePath="/calls" />
          </>
        ) : (
          <EmptyState
            title={total === 0 && Object.keys(params).length === 0 ? 'No calls recorded yet' : 'No calls match these filters'}
            description="Calls are recorded when placed from Outbound, received on a connected line, run in a campaign, or simulated."
          />
        )}
      </Card>
    </>
  );
}
