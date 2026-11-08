import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { credentialPresence } from '@/server/env';
import { integrationReadiness } from '@/server/providers/registry';
import { hasMinRole } from '@/lib/constants';
import { formatDateTime } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Notice } from '@/components/ui/states';
import { CheckButton, IntegrationNotesForm } from '@/components/config/integration-controls';
import { ActionButton, SarvamConnect } from '@/components/config/sarvam-connect';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamAuth } from '@/server/providers/sarvam/auth';
import { enableSarvamCallSync, syncSarvamAgents, syncSarvamNumbers } from './actions';
import { TelephonyService } from '@/server/services/telephony-service';

export const metadata: Metadata = { title: 'Integrations' };

const STATUS_TONE = { not_configured: 'neutral', configured: 'warning', connected: 'good', error: 'critical' } as const;
const STATUS_LABEL = { not_configured: 'Not configured', configured: 'Configured', connected: 'Connected', error: 'Error' } as const;

const CAPABILITIES: Record<string, { label: string; ready: keyof ReturnType<typeof integrationReadiness> | 'storage' | 'sarvam' | 'live' | 'inbound' | 'recordings' }[]> = {
  sarvam_ai: [
    { label: 'Voice agent sync (Sarvam → CRM)', ready: 'sarvam' },
    { label: 'Telephony number sync', ready: 'sarvam' },
    { label: 'Call transcripts & AI summaries (sent by Sarvam after each call)', ready: 'recordings' },
  ],
  telephony: [
    { label: 'Live outbound calls & campaigns', ready: 'live' },
    { label: 'Inbound call sync', ready: 'inbound' },
    { label: 'Call transcripts, AI summaries & caller emotion', ready: 'recordings' },
  ],
  recording_storage: [{ label: 'Private recording uploads & signed playback', ready: 'storage' }],
};
const ENV_VARS: Record<string, string[]> = {
  sarvam_ai: ['INTEGRATION_ENCRYPTION_KEY', 'SUPABASE_SECRET_KEY'],
  telephony: ['TELEPHONY_PROVIDER', 'TELEPHONY_WEBHOOK_SECRET'],
  recording_storage: ['SUPABASE_SECRET_KEY'],
};

export default async function IntegrationsPage() {
  const { db, profile } = await requireMember();
  const { data, error } = await db.from('integrations').select('*').order('created_at');
  if (error) throw error;
  const env = credentialPresence();
  const ready = integrationReadiness();
  const isAdmin = hasMinRole(profile.role, 'admin');
  const canManage = hasMinRole(profile.role, 'manager');
  const admin = createAdminClient();
  const sarvam = admin && env.INTEGRATION_ENCRYPTION_KEY ? await SarvamAuth.status(admin) : null;
  const live = await TelephonyService.liveStatus();
  const { data: appSettings } = await db.from('app_settings').select('sarvam_inbound_webhook_at').maybeSingle();
  const inboundSync = Boolean(appSettings?.sarvam_inbound_webhook_at);
  const flags = { live: live.available, inbound: inboundSync, recordings: live.available || inboundSync };
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;

  return (
    <>
      <PageHeader title="Integrations" description="Connection status of external providers. Credentials are kept in server environment variables and never shown in the browser." />
      <Notice tone="info" className="mb-6">
        <strong>Sarvam AI</strong> connects through its official MCP server with your Sarvam sign-in (no API key). Agents and numbers sync from Sarvam into the CRM; live calling switches on once a phone number is onboarded in your Sarvam telephony connection.
      </Notice>
      <div className="grid gap-6 xl:grid-cols-3" data-testid="integrations">
        {data.map((i) => (
          <Card key={i.id}>
            <CardHeader
              title={i.display_name}
              description={i.last_checked_at ? `Last checked ${formatDateTime(i.last_checked_at)}` : 'Never checked'}
              action={<Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE]}>{STATUS_LABEL[i.status as keyof typeof STATUS_LABEL]}</Badge>}
            />
            <CardBody className="space-y-5">
              {i.last_error && <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2">{i.last_error}</p>}
              {i.key === 'sarvam_ai' && (
                <div className="space-y-3">
                  {sarvam ? (
                    <SarvamConnect connected={sarvam.connected} accountEmail={sarvam.accountEmail} connectedAt={sarvam.connectedAt} pending={sarvam.pending} isAdmin={isAdmin} />
                  ) : (
                    <Notice tone="warning">Set INTEGRATION_ENCRYPTION_KEY and SUPABASE_SECRET_KEY on the server to connect Sarvam.</Notice>
                  )}
                  {sarvam?.connected && canManage && (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton action={syncSarvamAgents} label="Sync voice agents" testId="sync-sarvam-agents" />
                      <ActionButton action={syncSarvamNumbers} label="Sync phone numbers" testId="sync-sarvam-numbers" />
                    </div>
                  )}
                </div>
              )}
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Capabilities</p>
                <ul className="space-y-1.5 text-sm">
                  {CAPABILITIES[i.key].map((c) => {
                    const ok = c.ready === 'storage' ? i.status === 'connected' : c.ready === 'sarvam' ? Boolean(sarvam?.connected) : c.ready === 'live' || c.ready === 'inbound' || c.ready === 'recordings' ? flags[c.ready] : ready[c.ready];
                    return (
                      <li key={c.label} className="flex items-center gap-2">
                        {ok ? <CheckCircle2 className="size-4 text-green-700" /> : <CircleDashed className="size-4 text-ink-3" />}
                        <span className={ok ? 'text-ink' : 'text-ink-2'}>{c.label}</span>
                        <span className="ml-auto text-xs text-ink-3">{ok ? 'Available' : 'Pending'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Server credentials</p>
                {i.key === 'telephony' && sarvam?.connected && (
                  <p className="mb-2 text-xs text-ink-2">Managed through your Sarvam telephony connection; these are only needed for a separate bring-your-own provider.</p>
                )}
                <ul className="space-y-1 text-sm">
                  {ENV_VARS[i.key].map((v) => (
                    <li key={v} className="flex items-center justify-between gap-2">
                      <code className="font-mono text-xs">{v}</code>
                      {env[v as keyof typeof env] ? <Badge tone="good">Set</Badge> : <Badge tone="neutral">Not set</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
              {i.key === 'telephony' && sarvam?.connected && (
                <div className="space-y-2" data-testid="telephony-live">
                  {!live.available && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Live calling: {live.reason}</p>}
                  {live.available && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">Live calls and live campaigns dial through Sarvam from your synced number.</p>}
                  {isAdmin && (
                    <ActionButton action={enableSarvamCallSync} label={inboundSync ? 'Re-apply inbound call sync' : 'Enable inbound call sync'} testId="enable-inbound-sync" variant={inboundSync ? 'secondary' : 'primary'} />
                  )}
                  {inboundSync && <p className="text-xs text-ink-3">Inbound calls are sent to the CRM since {formatDateTime(appSettings!.sarvam_inbound_webhook_at)}.</p>}
                </div>
              )}
              {i.key === 'telephony' && (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Webhook URL</p>
                  <code className="block rounded-lg bg-canvas px-3 py-2 font-mono text-xs break-all">{origin}/api/webhooks/telephony/sarvam</code>
                  <p className="mt-1 text-xs text-ink-3">Accepts only deliveries that carry the CRM&apos;s secret, which the CRM gives Sarvam when it sets up calls.</p>
                </div>
              )}
              {isAdmin && (
                <div className="space-y-4 border-t border-line pt-4">
                  <CheckButton integrationKey={i.key} />
                  <IntegrationNotesForm integrationKey={i.key} provider={i.provider} notes={String((i.config as { notes?: string })?.notes ?? '')} />
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
