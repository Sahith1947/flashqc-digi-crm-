import type { Metadata } from 'next';
import { requireMember } from '@/server/auth';
import { CALLS_PAGE_SIZE, campaignOptions, listCalls } from '@/server/queries/calls';
import { agentOptions, getSettings, lineOptions } from '@/server/queries/config';
import { TelephonyService } from '@/server/services/telephony-service';
import { flatParams } from '@/lib/list-params';
import { hasMinRole } from '@/lib/constants';
import { normalizePhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/states';
import { Pagination } from '@/components/ui/pagination';
import { CallsTable } from '@/components/calls/calls-table';
import { CallFilterBar } from '@/components/calls/call-filters';
import { OutboundDialer } from '@/components/calls/call-forms';

export const metadata: Metadata = { title: 'Outbound Calls' };

export default async function OutboundPage(props: PageProps<'/outbound'>) {
  const { db, profile } = await requireMember();
  const params = flatParams(await props.searchParams);
  const { dial, ...listParams } = params;
  const [list, campaigns, lines, agents, settings] = await Promise.all([
    listCalls(db, listParams, { direction: 'outbound' }),
    campaignOptions(db),
    lineOptions(db, 'outbound'),
    agentOptions(db),
    getSettings(db),
  ]);
  const liveAvailable = TelephonyService.isLiveCallingAvailable();
  const dialPhone = dial ? normalizePhone(dial) : null;
  return (
    <>
      <PageHeader title="Outbound Calls" description="Place individual calls and review outbound call history." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Place a call" description={liveAvailable ? 'Live calling is connected.' : 'Live calling activates after telephony integration.'} />
          <CardBody>
            {hasMinRole(profile.role, 'agent') ? (
              <OutboundDialer
                lines={lines}
                agents={agents}
                liveAvailable={liveAvailable}
                simulationEnabled={Boolean(settings?.simulation_mode_enabled)}
                defaultPhone={dialPhone?.ok ? dialPhone.e164 : ''}
              />
            ) : (
              <Notice tone="info">Your role (viewer) can review calls but not place them.</Notice>
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Outbound history" description={`${list.total.toLocaleString('en-IN')} calls`} />
          <div className="border-b border-line p-4">
            <CallFilterBar basePath="/outbound" filters={list.filters} campaigns={campaigns} hideDirection sort={{ sort: params.sort, dir: params.dir }} />
          </div>
          {list.rows.length ? (
            <>
              <CallsTable rows={list.rows} hide={['direction', 'business']} sort={{ params: listParams, basePath: '/outbound' }} />
              <Pagination page={list.page} pageSize={CALLS_PAGE_SIZE} total={list.total} params={listParams} basePath="/outbound" />
            </>
          ) : (
            <EmptyState title="No outbound calls" description="Calls you place here or through campaigns will appear in this list." />
          )}
        </Card>
      </div>
    </>
  );
}
