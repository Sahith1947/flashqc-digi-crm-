import type { Metadata } from 'next';
import Link from 'next/link';
import { AudioLines } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { campaignOptions } from '@/server/queries/calls';
import { RECORDINGS_BUCKET } from '@/server/services/recording-service';
import { getRecordingSourceProvider } from '@/server/providers/registry';
import { flatParams, isUuid, parseEnum, parsePage, searchTerm } from '@/lib/list-params';
import { addDays, formatDateTime, formatDuration, isValidDateString as isValidDate, istStartOfDay } from '@/lib/dates';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { DirectionBadge, SimulatedBadge } from '@/components/ui/badge';
import { callRef } from '@/components/calls/calls-table';
import { ArtifactsViewer } from '@/components/recordings/artifacts-viewer';

export const metadata: Metadata = { title: 'Recordings' };
const PAGE = 20;

export default async function RecordingsPage(props: PageProps<'/recordings'>) {
  const { db } = await requireMember();
  const params = flatParams(await props.searchParams);
  const page = parsePage(params.page);
  const campaign = isUuid(params.campaign) ? params.campaign : undefined;
  const direction = parseEnum(params.direction, ['inbound', 'outbound'] as const);
  const transcript = parseEnum(params.transcript, ['yes', 'no'] as const);
  const from = isValidDate(params.from) ? params.from : undefined;
  const to = isValidDate(params.to) ? params.to : undefined;

  let q = db.from('recording_library_view').select('*', { count: 'exact' });
  if (campaign) q = q.eq('campaign_id', campaign);
  if (direction) q = q.eq('direction', direction);
  if (transcript) q = q.eq('has_transcript', transcript === 'yes');
  if (from) q = q.gte('call_started_at', istStartOfDay(from).toISOString());
  if (to) q = q.lt('call_started_at', istStartOfDay(addDays(to, 1)).toISOString());
  const term = searchTerm(params.q);
  if (term) {
    const phone = normalizePhone(params.q);
    const parts = [`contact_name.ilike.${term}`, `business_name.ilike.${term}`, `campaign_name.ilike.${term}`];
    if (phone.ok) parts.push(`phone_e164.eq.${phone.e164}`);
    q = q.or(parts.join(','));
  }
  const [{ data, count, error }, campaigns] = await Promise.all([
    q.order('call_started_at', { ascending: false }).order('id').range((page - 1) * PAGE, page * PAGE - 1),
    campaignOptions(db),
  ]);
  if (error && error.code !== 'PGRST103') throw error;
  const rows = data ?? [];

  // Short-lived signed URLs for this page only (private bucket).
  const paths = rows.filter((r) => r.storage_bucket === RECORDINGS_BUCKET && r.storage_path).map((r) => r.storage_path!);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await db.storage.from(RECORDINGS_BUCKET).createSignedUrls(paths, 3600);
    urls?.forEach((u) => u.path && u.signedUrl && signed.set(u.path, u.signedUrl));
  }
  const providerPlayback = getRecordingSourceProvider().configured;

  return (
    <>
      <PageHeader title="Recordings" description="Call recordings stored privately. Playback links are signed and expire after one hour." />
      <Card>
        <div className="border-b border-line p-4">
          <FilterBar
            basePath="/recordings"
            search={{ value: params.q, placeholder: 'Contact, business, campaign or phone' }}
            selects={[
              { name: 'direction', label: 'Direction', anyLabel: 'All directions', value: direction, options: [{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }] },
              { name: 'campaign', label: 'Campaign', anyLabel: 'All campaigns', value: campaign, options: campaigns },
              { name: 'transcript', label: 'Transcript', anyLabel: 'Any transcript', value: transcript, options: [{ value: 'yes', label: 'Has transcript' }, { value: 'no', label: 'No transcript' }] },
            ]}
            extra={
              <div className="flex items-center gap-1">
                <input name="from" type="date" defaultValue={from} aria-label="From date" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
                <span className="text-ink-3">–</span>
                <input name="to" type="date" defaultValue={to} aria-label="To date" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
              </div>
            }
          />
        </div>
        {rows.length ? (
          <>
            <ul className="divide-y divide-line" data-testid="recordings-list">
              {rows.map((r) => {
                const url = r.storage_path ? signed.get(r.storage_path) : (r.provider_recording_url ?? undefined);
                return (
                  <li key={r.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_minmax(280px,420px)_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <Link href={`/calls/${r.call_id}`} className="hover:underline">
                          {r.contact_name || formatPhone(r.phone_e164)}
                        </Link>
                        <DirectionBadge direction={r.direction ?? ''} />
                        {r.is_simulated && <SimulatedBadge />}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        <span className="font-mono">{callRef(r.call_number)}</span> · {formatPhone(r.phone_e164)}
                        {r.business_name && ` · ${r.business_name}`} · {formatDateTime(r.call_started_at)} · {formatDuration(r.duration_seconds)}
                        {r.campaign_name && (
                          <>
                            {' · '}
                            <Link href={`/campaigns/${r.campaign_id}`} className="hover:underline">
                              {r.campaign_name}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div>
                      {url ? (
                        <audio controls preload="none" src={url} className="h-9 w-full" data-testid="recording-player">
                          Your browser does not support audio playback.
                        </audio>
                      ) : r.provider_recording_id ? (
                        <p className="text-xs text-ink-3">{providerPlayback ? 'Open the call to play this provider recording.' : 'Provider playback connects in Phase 2.'}</p>
                      ) : (
                        <p className="text-xs text-red-700">File unavailable</p>
                      )}
                    </div>
                    <ArtifactsViewer callId={r.call_id!} title={`${callRef(r.call_number)} · ${r.contact_name || formatPhone(r.phone_e164)}`} hasTranscript={Boolean(r.has_transcript)} hasSummary={Boolean(r.has_summary)} />
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={params} basePath="/recordings" />
          </>
        ) : (
          <EmptyState
            icon={<AudioLines className="size-5" />}
            title={Object.keys(params).length ? 'No recordings match these filters' : 'No recordings yet'}
            description="Recordings appear here when uploaded on a call's detail page, or automatically from the telephony provider after Phase 2. Demo recordings are never generated."
          />
        )}
      </Card>
      <Notice tone="info" className="mt-6">
        Storage: private Supabase bucket <code className="font-mono text-xs">call-recordings</code>. Provider-hosted recordings will be resolved server-side through the RecordingService once the telephony integration is connected.
      </Notice>
    </>
  );
}
