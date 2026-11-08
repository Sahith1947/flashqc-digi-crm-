import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, Phone, Trash2, X } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { agentOptions, lineOptions } from '@/server/queries/config';
import { contactFacets } from '@/server/queries/contacts';
import { TelephonyService } from '@/server/services/telephony-service';
import { flatParams, isUuid, parseEnum, parsePage } from '@/lib/list-params';
import { CALL_OUTCOME_LABELS, CALL_STATUS_LABELS, CAMPAIGN_CONTACT_STATUS_LABELS, CAMPAIGN_CONTACT_STATUS_TONE, hasMinRole, labelFor } from '@/lib/constants';
import { formatDateTime, formatDuration } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { buttonClass } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { BarList } from '@/components/charts/bar-list';
import { CampaignModeBadge, CampaignStatusBadge } from '@/components/campaigns/campaign-badges';
import { AddContactsButton, CampaignControls, CampaignRunner, EditCampaignButton } from '@/components/campaigns/campaign-controls';
import { callContactAgain, deleteCampaign, removeCampaignContact } from '../actions';
import { INTEREST_LABELS, INTERESTS } from '@/lib/leads';
import { InterestBadge, LeadStageBadge } from '@/components/contacts/lead-badges';
import { RecordingPlayButton } from '@/components/calls/recording-play-button';
import type { CampaignResultRow } from '@/lib/supabase/types';

export const metadata: Metadata = { title: 'Campaign' };
// First playback of a Sarvam recording downloads it (a few seconds); allow time for that.
export const maxDuration = 60;
const PAGE = 25;
const CC_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped'] as const;

export default async function CampaignDetailPage(props: PageProps<'/campaigns/[id]'>) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const { db, profile } = await requireMember();
  const params = flatParams(await props.searchParams);
  const page = parsePage(params.page);
  const ccStatus = parseEnum(params.status, CC_STATUSES);
  const interest = parseEnum(params.interest, [...INTERESTS, 'pending'] as const);

  const { data: campaign, error } = await db.from('campaigns').select('*, phone_numbers(label, phone_e164), voice_agents(name)').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!campaign) notFound();

  let ccq = db.from('campaign_results_view').select('*', { count: 'exact' }).eq('campaign_id', id);
  if (ccStatus) ccq = ccq.eq('contact_status', ccStatus);
  if (interest) ccq = ccq.eq('interest', interest);
  const canManage = hasMinRole(profile.role, 'manager');
  const [statsRes, ccRes, outcomesRes, lines, agents, facets, interestRes] = await Promise.all([
    db.from('campaign_stats').select('*').eq('campaign_id', id).maybeSingle(),
    ccq.order('created_at').order('campaign_contact_id').range((page - 1) * PAGE, page * PAGE - 1),
    db.from('calls').select('outcome').eq('campaign_id', id).not('answered_at', 'is', null).limit(10000),
    canManage ? lineOptions(db, 'outbound') : Promise.resolve([]),
    canManage ? agentOptions(db) : Promise.resolve([]),
    canManage ? contactFacets(db) : Promise.resolve({ cities: [], categories: [], sources: [] }),
    db.from('campaign_results_view').select('interest').eq('campaign_id', id).limit(20000),
  ]);
  const interestCounts = new Map<string, number>();
  for (const r of interestRes.data ?? []) interestCounts.set(r.interest ?? 'unclear', (interestCounts.get(r.interest ?? 'unclear') ?? 0) + 1);
  const chipHref = (v: string | null) => {
    const q = new URLSearchParams(Object.entries(params).filter(([k, x]) => x && k !== 'page' && k !== 'interest') as [string, string][]);
    if (v) q.set('interest', v);
    const qs = q.toString();
    return `/campaigns/${id}${qs ? `?${qs}` : ''}`;
  };
  const canCall = hasMinRole(profile.role, 'agent');
  if (ccRes.error && ccRes.error.code !== 'PGRST103') throw ccRes.error;
  const s = statsRes.data;
  const outcomeCounts = new Map<string, number>();
  for (const o of outcomesRes.data ?? []) outcomeCounts.set(o.outcome ?? 'not_set', (outcomeCounts.get(o.outcome ?? 'not_set') ?? 0) + 1);
  const processed = (s?.contacts_completed ?? 0) + (s?.contacts_failed ?? 0) + (s?.contacts_skipped ?? 0);
  const editable = campaign.status === 'draft' || campaign.status === 'paused';
  const line = campaign.phone_numbers as { label: string; phone_e164: string } | null;
  const agent = campaign.voice_agents as { name: string } | null;
  const liveAvailable = (await TelephonyService.liveStatus()).available;

  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>
      <PageHeader
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <CampaignModeBadge mode={campaign.mode} />
            <span className="text-ink-3">Created {formatDateTime(campaign.created_at)}</span>
          </span>
        }
        actions={
          <>
            <CampaignControls campaign={campaign} canManage={canManage} />
            {canManage && editable && <EditCampaignButton campaign={campaign} lines={lines} agents={agents} liveAvailable={liveAvailable} />}
            {canManage && editable && <AddContactsButton campaignId={id} facets={facets} />}
            <a href={`/api/export/campaigns/${id}`} className={buttonClass('secondary')} download>
              <Download className="size-4" /> Report CSV
            </a>
            {canManage && ['draft', 'completed', 'cancelled'].includes(campaign.status) && (
              <ConfirmAction
                action={deleteCampaign.bind(null, id)}
                label="Delete"
                icon={<Trash2 className="size-4" />}
                title="Delete campaign?"
                description="The campaign and its contact enrolments are deleted. Calls already made stay in Call Logs."
                confirmLabel="Delete campaign"
                size="md"
                testId="campaign-delete"
              />
            )}
          </>
        }
      />

      {campaign.mode === 'simulated' && (
        <Notice tone="sim" className="mb-4">
          <strong>Simulated campaign.</strong> Calls are generated by the simulator to test the workflow — no real phone calls are made, and results are labelled as simulated everywhere.
        </Notice>
      )}
      {campaign.description && <p className="mb-4 text-sm text-ink-2">{campaign.description}</p>}
      <div className="mb-4">
        <CampaignRunner campaignId={id} running={campaign.status === 'running' && canManage} mode={campaign.mode} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="campaign-stats">
        <StatCard label="Contacts" value={s?.contacts_total ?? 0} hint={`${processed} processed · ${s?.contacts_pending ?? 0} pending`} />
        <StatCard label="Calls placed" value={s?.calls_total ?? 0} hint={`${s?.calls_answered ?? 0} answered`} />
        <StatCard label="Missed / failed" value={`${s?.calls_missed ?? 0} / ${s?.calls_failed ?? 0}`} hint={`${s?.contacts_skipped ?? 0} contacts skipped`} />
        <StatCard label="Talk time" value={formatDuration(s?.talk_time_seconds ?? 0)} hint={`Avg ${formatDuration(s?.avg_duration_seconds ?? 0)}`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Results"
            description={`${ccRes.count ?? 0} contact${ccRes.count === 1 ? '' : 's'}${interest ? ` · ${INTEREST_LABELS[interest]}` : ''}${ccStatus ? ` · ${CAMPAIGN_CONTACT_STATUS_LABELS[ccStatus]}` : ''}. Interest and funnel stage update automatically after every call.`}
          />
          <div className="flex flex-wrap gap-2 border-b border-line px-4 pt-4 pb-3" data-testid="interest-chips">
            {[null, 'interested', 'callback', 'confused', 'not_interested', 'hung_up', 'no_answer', 'unclear', 'pending'].map((v) => {
              const n = v ? (interestCounts.get(v) ?? 0) : (interestRes.data?.length ?? 0);
              if (v && !n && interest !== v) return null;
              const active = (interest ?? null) === v;
              return (
                <Link
                  key={v ?? 'all'}
                  href={chipHref(v)}
                  data-testid={`interest-chip-${v ?? 'all'}`}
                  className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-ink-3'}`}
                >
                  {v ? INTEREST_LABELS[v as keyof typeof INTEREST_LABELS] : 'All'} <span className="tabular opacity-70">{n}</span>
                </Link>
              );
            })}
          </div>
          <div className="border-b border-line p-4">
            <FilterBar
              basePath={`/campaigns/${id}`}
              selects={[{ name: 'status', label: 'Contact status', anyLabel: 'All contacts', value: ccStatus, options: CC_STATUSES.map((x) => ({ value: x, label: CAMPAIGN_CONTACT_STATUS_LABELS[x] })) }]}
            />
          </div>
          {ccRes.data?.length ? (
            <>
              <TableWrap>
                <Table data-testid="campaign-contacts-table" className="min-w-[900px]">
                  <thead>
                    <tr>
                      <Th>Contact</Th>
                      <Th>Interest</Th>
                      <Th>Funnel</Th>
                      <Th>Why</Th>
                      <Th>Recording</Th>
                      <Th>Status</Th>
                      <Th className="w-28"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ccRes.data as CampaignResultRow[]).map((r) => {
                      const why =
                        r.summary ||
                        (r.interest === 'pending'
                          ? 'Not called yet.'
                          : r.interest === 'no_answer'
                            ? `${labelFor(CALL_STATUS_LABELS, r.call_status)}${r.skip_reason ? ` · ${r.skip_reason}` : ''}`
                            : r.emotion
                              ? `Caller sounded ${r.emotion.toLowerCase()}.`
                              : '—');
                      return (
                        <Tr key={r.campaign_contact_id}>
                          <Td className="min-w-44">
                            <Link href={`/contacts/${r.contact_id}`} className="font-medium hover:underline">
                              {r.full_name || 'Unnamed'}
                            </Link>
                            <p className="tabular text-xs whitespace-nowrap text-ink-3">{formatPhone(r.phone_e164)}</p>
                            {r.business_name && <p className="max-w-52 truncate text-xs text-ink-3">{r.business_name}</p>}
                          </Td>
                          <Td>
                            <InterestBadge interest={r.interest} />
                          </Td>
                          <Td>
                            <LeadStageBadge stage={r.lead_stage} />
                          </Td>
                          <Td className="max-w-80 min-w-56">
                            {r.call_id ? (
                              <Link href={`/calls/${r.call_id}`} className="line-clamp-2 text-xs text-ink-2 hover:text-ink hover:underline" title={why}>
                                {why}
                              </Link>
                            ) : (
                              <span className="text-xs text-ink-3">{why}</span>
                            )}
                          </Td>
                          <Td>
                            {r.call_id ? (
                              <RecordingPlayButton callId={r.call_id} hasRecording={Boolean(r.has_recording)} answered={Boolean(r.is_answered)} label={r.full_name || r.phone_e164 || 'call'} />
                            ) : (
                              <span className="text-xs text-ink-3">—</span>
                            )}
                          </Td>
                          <Td>
                            <Badge tone={CAMPAIGN_CONTACT_STATUS_TONE[r.contact_status as keyof typeof CAMPAIGN_CONTACT_STATUS_TONE]}>
                              {CAMPAIGN_CONTACT_STATUS_LABELS[r.contact_status as keyof typeof CAMPAIGN_CONTACT_STATUS_LABELS]}
                            </Badge>
                            <p className="tabular mt-1 text-xs text-ink-3">
                              {r.attempts}/{campaign.max_attempts} · {formatDateTime(r.last_attempt_at)}
                            </p>
                          </Td>
                          <Td>
                            <span className="flex items-center gap-1">
                              {canCall && (
                                <ConfirmAction
                                  action={callContactAgain.bind(null, id, r.contact_id!)}
                                  label={<Phone className="size-4" />}
                                  variant="secondary"
                                  title={`Call ${r.full_name || formatPhone(r.phone_e164)} again?`}
                                  description={campaign.mode === 'live' ? 'Places one real call now with this campaign’s number and AI agent (uses Sarvam credits).' : 'Records one simulated call (no real call).'}
                                  confirmLabel="Call now"
                                  testId="call-again"
                                />
                              )}
                              {canManage && editable && r.contact_status === 'pending' && (
                                <ConfirmAction
                                  action={removeCampaignContact.bind(null, id, r.campaign_contact_id!)}
                                  label={<X className="size-4" />}
                                  variant="secondary"
                                  title="Remove contact from campaign?"
                                  description="The contact stays in your CRM; it is only removed from this campaign."
                                  confirmLabel="Remove"
                                />
                              )}
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
              <Pagination page={page} pageSize={PAGE} total={ccRes.count ?? 0} params={params} basePath={`/campaigns/${id}`} />
            </>
          ) : (
            <EmptyState
              title={interest || ccStatus ? 'No contacts match this filter' : 'No contacts in this campaign'}
              description={canManage && editable ? 'Use "Add contacts" to upload a CSV or select existing contacts.' : undefined}
            />
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Answered call outcomes" />
            <CardBody>
              <BarList
                items={[...outcomeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: labelFor(CALL_OUTCOME_LABELS, k), value: v, tone: 'brand' as const }))}
                emptyText="No answered calls yet."
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Configuration" />
            <CardBody>
              <dl className="text-sm">
                {[
                  ['Mode', campaign.mode === 'simulated' ? 'Simulated' : 'Live'],
                  ['Business number', line ? `${line.label} · ${formatPhone(line.phone_e164)}` : '—'],
                  ['Voice agent', agent?.name ?? '—'],
                  ['Calling window (IST)', `${campaign.calling_window_start.slice(0, 5)} – ${campaign.calling_window_end.slice(0, 5)}`],
                  ['Max attempts', campaign.max_attempts],
                  ['Started', formatDateTime(campaign.started_at)],
                  ['Paused', formatDateTime(campaign.paused_at)],
                  ['Finished', formatDateTime(campaign.completed_at)],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
