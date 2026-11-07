import type { Metadata } from 'next';
import { Trash2 } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { agentOptions } from '@/server/queries/config';
import { CONNECTION_STATUS_LABELS, CONNECTION_STATUS_TONE, hasMinRole, labelFor, PHONE_PROVIDER_LABELS } from '@/lib/constants';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice } from '@/components/ui/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { PhoneNumberButton } from '@/components/config/config-forms';
import { ActionButton } from '@/components/config/sarvam-connect';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamAuth } from '@/server/providers/sarvam/auth';
import { serverEnv } from '@/server/env';
import { syncSarvamNumbers } from '../integrations/actions';
import { deletePhoneNumber } from './actions';

export const metadata: Metadata = { title: 'Phone Numbers' };

export default async function PhoneNumbersPage() {
  const { db, profile } = await requireMember();
  const [{ data, error }, agents] = await Promise.all([
    db.from('phone_numbers').select('*, voice_agents(name)').order('created_at'),
    agentOptions(db),
  ]);
  if (error) throw error;
  const canManage = hasMinRole(profile.role, 'manager');
  const canAdmin = hasMinRole(profile.role, 'admin');
  const admin = createAdminClient();
  const sarvam = admin && serverEnv.integrationEncryptionKey ? await SarvamAuth.status(admin) : null;
  return (
    <>
      <PageHeader
        title="Phone Numbers"
        description="Business phone lines used for inbound and outbound calling."
        actions={
          canManage ? (
            <>
              {sarvam?.connected && <ActionButton action={syncSarvamNumbers} label="Sync from Sarvam" testId="sync-numbers" variant="primary" />}
              <PhoneNumberButton agents={agents} />
            </>
          ) : undefined
        }
      />
      <Notice tone="info" className="mb-4">
        {sarvam?.connected ? (
          <>Numbers onboarded in your Sarvam telephony connection are imported with <strong>Sync from Sarvam</strong> and show &quot;Connected&quot;. Numbers added here manually stay &quot;Not connected&quot; until they exist in Sarvam — connection status cannot be set by hand.</>
        ) : (
          <>Numbers are configuration placeholders until Sarvam is connected. <strong>Connection</strong> shows &quot;Connected&quot; only after the provider verifies the number — it cannot be set manually.</>
        )}
      </Notice>
      <Card>
        {data.length ? (
          <TableWrap>
            <Table data-testid="numbers-table" className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Provider</Th>
                  <Th>Capability</Th>
                  <Th>Assigned agent</Th>
                  <Th>Status</Th>
                  <Th>Connection</Th>
                  {canManage && <Th className="text-right">Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {data.map((n) => (
                  <Tr key={n.id}>
                    <Td>
                      <p className="font-medium">{n.label}</p>
                      <p className="tabular text-xs text-ink-3">{formatPhone(n.phone_e164)}</p>
                    </Td>
                    <Td>
                      {labelFor(PHONE_PROVIDER_LABELS, n.provider)}
                      {n.provider_number_id && <p className="text-xs text-ink-3">{n.provider_number_id}</p>}
                    </Td>
                    <Td>
                      <span className="flex gap-1">
                        {n.can_inbound && <Badge tone="info" icon={false}>Inbound</Badge>}
                        {n.can_outbound && <Badge tone="brand" icon={false}>Outbound</Badge>}
                      </span>
                    </Td>
                    <Td>{(n.voice_agents as { name: string } | null)?.name ?? <span className="text-ink-3">None</span>}</Td>
                    <Td>{n.enabled ? <Badge tone="good">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</Td>
                    <Td>
                      <Badge tone={CONNECTION_STATUS_TONE[n.connection_status]}>{CONNECTION_STATUS_LABELS[n.connection_status]}</Badge>
                    </Td>
                    {canManage && (
                      <Td>
                        <div className="flex justify-end gap-2">
                          <PhoneNumberButton n={n} agents={agents} />
                          {canAdmin && (
                            <ConfirmAction
                              action={deletePhoneNumber.bind(null, n.id)}
                              label={<Trash2 className="size-3.5" />}
                              title={`Remove ${n.label}?`}
                              description="The number is removed from the CRM. Past calls on this line are kept."
                              confirmLabel="Remove number"
                            />
                          )}
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="No phone numbers yet" description="Add your business numbers now; they will be connected to the telephony provider in Phase 2." action={canManage ? <PhoneNumberButton agents={agents} /> : undefined} />
        )}
      </Card>
    </>
  );
}
