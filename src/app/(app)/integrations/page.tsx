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

export const metadata: Metadata = { title: 'Integrations' };

const STATUS_TONE = { not_configured: 'neutral', configured: 'warning', connected: 'good', error: 'critical' } as const;
const STATUS_LABEL = { not_configured: 'Not configured', configured: 'Configured', connected: 'Connected', error: 'Error' } as const;

const CAPABILITIES: Record<string, { label: string; ready: keyof ReturnType<typeof integrationReadiness> | 'storage' }[]> = {
  sarvam_ai: [
    { label: 'Voice agent sync', ready: 'voiceAgents' },
    { label: 'Speech-to-text transcripts', ready: 'transcription' },
    { label: 'AI call summaries', ready: 'summaries' },
  ],
  telephony: [
    { label: 'Live outbound calls', ready: 'telephony' },
    { label: 'Inbound call webhooks', ready: 'telephony' },
    { label: 'Provider-hosted recordings', ready: 'providerRecordings' },
  ],
  recording_storage: [{ label: 'Private recording uploads & signed playback', ready: 'storage' }],
};
const ENV_VARS: Record<string, string[]> = {
  sarvam_ai: ['SARVAM_API_KEY'],
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
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;

  return (
    <>
      <PageHeader title="Integrations" description="Connection status of external providers. Credentials are kept in server environment variables and never shown in the browser." />
      <Notice tone="info" className="mb-6">
        <strong>Phase 2.</strong> Sarvam AI, MCP and telephony adapters will be implemented from the official documentation you provide. Only capabilities the documentation actually supports will be enabled; each one plugs into the service layer in <code className="font-mono text-xs">src/server/providers</code>.
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
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Capabilities</p>
                <ul className="space-y-1.5 text-sm">
                  {CAPABILITIES[i.key].map((c) => {
                    const ok = c.ready === 'storage' ? i.status === 'connected' : ready[c.ready];
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
                <ul className="space-y-1 text-sm">
                  {ENV_VARS[i.key].map((v) => (
                    <li key={v} className="flex items-center justify-between gap-2">
                      <code className="font-mono text-xs">{v}</code>
                      {env[v as keyof typeof env] ? <Badge tone="good">Set</Badge> : <Badge tone="neutral">Not set</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
              {i.key === 'telephony' && (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Webhook URL</p>
                  <code className="block rounded-lg bg-canvas px-3 py-2 font-mono text-xs break-all">{origin}/api/webhooks/telephony/&lt;provider&gt;</code>
                  <p className="mt-1 text-xs text-ink-3">Rejects all requests until a provider adapter with signature verification is registered.</p>
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
