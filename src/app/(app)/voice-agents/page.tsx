import type { Metadata } from 'next';
import { Bot, RefreshCw, Trash2 } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { VoiceAgentService } from '@/server/services/voice-agent-service';
import { AGENT_LANGUAGES, AGENT_STATUS_LABELS, CONNECTION_STATUS_LABELS, CONNECTION_STATUS_TONE, hasMinRole, labelFor } from '@/lib/constants';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Notice } from '@/components/ui/states';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { VoiceAgentButton } from '@/components/config/config-forms';
import { deleteVoiceAgent } from './actions';

export const metadata: Metadata = { title: 'Voice Agents' };

export default async function VoiceAgentsPage() {
  const { db, profile } = await requireMember();
  const [{ data: agents, error }, { data: lines }, { data: usage }] = await Promise.all([
    db.from('voice_agents').select('*').order('created_at'),
    db.from('phone_numbers').select('voice_agent_id'),
    db.from('calls').select('voice_agent_id').not('voice_agent_id', 'is', null).limit(10000),
  ]);
  if (error) throw error;
  const linesByAgent = new Map<string, number>();
  lines?.forEach((l) => l.voice_agent_id && linesByAgent.set(l.voice_agent_id, (linesByAgent.get(l.voice_agent_id) ?? 0) + 1));
  const callsByAgent = new Map<string, number>();
  usage?.forEach((c) => c.voice_agent_id && callsByAgent.set(c.voice_agent_id, (callsByAgent.get(c.voice_agent_id) ?? 0) + 1));
  const canManage = hasMinRole(profile.role, 'manager');
  const canAdmin = hasMinRole(profile.role, 'admin');
  const syncAvailable = VoiceAgentService.isSyncAvailable();
  const langLabel = (v: string) => AGENT_LANGUAGES.find((l) => l.value === v)?.label ?? v;

  return (
    <>
      <PageHeader title="Voice Agents" description="AI voice agent configurations. They connect to Sarvam AI in Phase 2." actions={canManage ? <VoiceAgentButton /> : undefined} />
      <Notice tone="info" className="mb-4">
        Agents are stored as provider-independent configurations. Syncing to Sarvam AI and the &quot;Connected&quot; status are enabled only after the official Sarvam documentation is integrated.
      </Notice>
      {agents.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="agents-grid">
          {agents.map((a) => (
            <Card key={a.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-ink text-brand-400">
                      <Bot className="size-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{a.name}</p>
                      <p className="text-xs text-ink-3">
                        {langLabel(a.language)} · {a.provider === 'sarvam' ? 'Sarvam AI' : 'Other'}
                      </p>
                    </div>
                  </div>
                  <Badge tone={a.status === 'ready' ? 'good' : a.status === 'disabled' ? 'neutral' : 'warning'}>{labelFor(AGENT_STATUS_LABELS, a.status)}</Badge>
                </div>
                {a.description && <p className="text-sm text-ink-2">{a.description}</p>}
                {a.greeting && <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink-2 italic">&ldquo;{a.greeting}&rdquo;</p>}
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-line p-2">
                    <dt className="text-ink-3">Integration</dt>
                    <dd className="mt-1">
                      <Badge tone={CONNECTION_STATUS_TONE[a.connection_status]}>{CONNECTION_STATUS_LABELS[a.connection_status]}</Badge>
                    </dd>
                  </div>
                  <div className="rounded-lg border border-line p-2">
                    <dt className="text-ink-3">Numbers</dt>
                    <dd className="tabular mt-1 text-sm font-semibold">{linesByAgent.get(a.id) ?? 0}</dd>
                  </div>
                  <div className="rounded-lg border border-line p-2">
                    <dt className="text-ink-3">Calls</dt>
                    <dd className="tabular mt-1 text-sm font-semibold">{callsByAgent.get(a.id) ?? 0}</dd>
                  </div>
                </dl>
                {canManage && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <VoiceAgentButton a={a} />
                    <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} disabled title="Available after the Sarvam AI integration (Phase 2)">
                      {syncAvailable ? 'Sync to Sarvam' : 'Sync (Phase 2)'}
                    </Button>
                    {canAdmin && (
                      <ConfirmAction
                        action={deleteVoiceAgent.bind(null, a.id)}
                        label={<Trash2 className="size-3.5" />}
                        title={`Delete ${a.name}?`}
                        description="Numbers and campaigns using this agent will be unassigned. Call history is kept."
                        confirmLabel="Delete agent"
                      />
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Bot className="size-5" />} title="No voice agents yet" description="Define each agent's language, greeting and script now. They will be pushed to Sarvam AI in Phase 2." action={canManage ? <VoiceAgentButton /> : undefined} />
        </Card>
      )}
    </>
  );
}
