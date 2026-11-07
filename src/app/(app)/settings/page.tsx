import type { Metadata } from 'next';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { getSettings } from '@/server/queries/config';
import { flatParams, parsePage, searchTerm } from '@/lib/list-params';
import { hasMinRole, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, SUPPRESSION_SOURCE_LABELS, labelFor, type Role } from '@/lib/constants';
import { formatDateTime } from '@/lib/dates';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { MemberRow, OrgSettingsForm, ProfileForm, SuppressionForm } from '@/components/settings/settings-forms';
import { removeSuppression } from './actions';

export const metadata: Metadata = { title: 'Settings' };

const TABS = [
  { id: 'profile', label: 'Profile', min: 'viewer' },
  { id: 'organization', label: 'Organisation', min: 'viewer' },
  { id: 'team', label: 'Team', min: 'admin' },
  { id: 'suppression', label: 'Suppression list', min: 'viewer' },
  { id: 'audit', label: 'Audit log', min: 'admin' },
] as const;
const PAGE = 25;

export default async function SettingsPage(props: PageProps<'/settings'>) {
  const { db, profile, email, userId } = await requireMember();
  const params = flatParams(await props.searchParams);
  const allowed = TABS.filter((t) => hasMinRole(profile.role, t.min as Role));
  const tab = allowed.find((t) => t.id === params.tab)?.id ?? 'profile';
  const page = parsePage(params.page);

  return (
    <>
      <PageHeader title="Settings" description="Your profile, organisation defaults, team access and compliance lists." />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
        {allowed.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${tab === t.id ? 'border-brand-500 text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'profile' && (
        <Card>
          <CardHeader title="Your profile" description={`Role: ${ROLE_LABELS[profile.role as Role]} — ${ROLE_DESCRIPTIONS[profile.role as Role]}`} />
          <CardBody>
            <ProfileForm name={profile.full_name ?? ''} email={email} />
          </CardBody>
        </Card>
      )}

      {tab === 'organization' && <OrgTab db={db} canEdit={hasMinRole(profile.role, 'admin')} />}
      {tab === 'team' && <TeamTab db={db} selfId={userId} />}
      {tab === 'suppression' && <SuppressionTab db={db} params={params} page={page} canAdd={hasMinRole(profile.role, 'agent')} canRemove={hasMinRole(profile.role, 'manager')} />}
      {tab === 'audit' && <AuditTab db={db} params={params} page={page} />}
    </>
  );
}

type DBc = Awaited<ReturnType<typeof requireMember>>['db'];

async function OrgTab({ db, canEdit }: { db: DBc; canEdit: boolean }) {
  const s = await getSettings(db);
  if (!s) return <EmptyState title="Settings unavailable" />;
  return (
    <Card>
      <CardHeader title="Organisation" description={canEdit ? undefined : 'Only admins can change organisation settings.'} />
      <CardBody>
        <OrgSettingsForm s={s} canEdit={canEdit} />
      </CardBody>
    </Card>
  );
}

async function TeamTab({ db, selfId }: { db: DBc; selfId: string }) {
  const { data, error } = await db.from('profiles').select('*').order('created_at');
  if (error) throw error;
  const pending = data.filter((p) => !p.is_active);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Roles" />
        <CardBody>
          <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <li key={r} className="rounded-lg border border-line p-3">
                <p className="font-medium">{ROLE_LABELS[r]}</p>
                <p className="text-xs text-ink-3">{ROLE_DESCRIPTIONS[r]}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Team members" description={`${data.length} users${pending.length ? ` · ${pending.length} awaiting approval` : ''}`} />
        <TableWrap>
          <Table data-testid="team-table">
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th>Access</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <p className="font-medium">
                      {m.full_name || '—'} {m.id === selfId && <span className="text-xs text-ink-3">(you)</span>}
                    </p>
                    <p className="text-xs text-ink-3">{m.email}</p>
                  </Td>
                  <Td>{m.is_active ? <Badge tone="good">Active · {ROLE_LABELS[m.role as Role]}</Badge> : <Badge tone="warning">Awaiting approval</Badge>}</Td>
                  <Td className="tabular text-ink-2">{formatDateTime(m.created_at)}</Td>
                  <Td>
                    <MemberRow m={m} isSelf={m.id === selfId} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}

async function SuppressionTab({ db, params, page, canAdd, canRemove }: { db: DBc; params: Record<string, string | undefined>; page: number; canAdd: boolean; canRemove: boolean }) {
  let q = db.from('suppression_list').select('*', { count: 'exact' });
  const term = searchTerm(params.q);
  if (term) {
    const p = normalizePhone(params.q);
    q = p.ok ? q.eq('phone_e164', p.e164) : q.or(`reason.ilike.${term},phone_e164.ilike.%${(params.q ?? '').replace(/\D/g, '') || '_'}%`);
  }
  const { data, count, error } = await q.order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (error && error.code !== 'PGRST103') throw error;
  return (
    <div className="space-y-6">
      {canAdd && (
        <Card>
          <CardHeader title="Add a number" description="Suppressed numbers are blocked from every manual and campaign call." />
          <CardBody>
            <SuppressionForm />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Suppression list" description={`${count ?? 0} numbers`} />
        <div className="border-b border-line p-4">
          <FilterBar basePath="/settings" hidden={{ tab: 'suppression' }} search={{ value: params.q, placeholder: 'Search number or reason' }} />
        </div>
        {data?.length ? (
          <>
            <TableWrap>
              <Table data-testid="suppression-table">
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Source</Th>
                    <Th>Reason</Th>
                    <Th>Added</Th>
                    {canRemove && <Th className="w-12"><span className="sr-only">Remove</span></Th>}
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => (
                    <Tr key={s.id}>
                      <Td className="tabular font-medium">{formatPhone(s.phone_e164)}</Td>
                      <Td>{labelFor(SUPPRESSION_SOURCE_LABELS, s.source)}</Td>
                      <Td className="text-ink-2">{s.reason || '—'}</Td>
                      <Td className="tabular text-ink-2">{formatDateTime(s.created_at)}</Td>
                      {canRemove && (
                        <Td>
                          <ConfirmAction
                            action={removeSuppression.bind(null, s.id)}
                            label={<Trash2 className="size-3.5" />}
                            title="Remove from suppression list?"
                            description="Only remove a number if the person has asked to be contacted again."
                            confirmLabel="Remove"
                          />
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={{ ...params, tab: 'suppression' }} basePath="/settings" />
          </>
        ) : (
          <EmptyState title="No suppressed numbers" />
        )}
      </Card>
    </div>
  );
}

async function AuditTab({ db, params, page }: { db: DBc; params: Record<string, string | undefined>; page: number }) {
  const tables = ['contacts', 'calls', 'campaigns', 'phone_numbers', 'voice_agents', 'integrations', 'profiles', 'app_settings', 'suppression_list', 'call_recordings', 'call_transcripts', 'call_summaries'];
  let q = db.from('audit_logs').select('*', { count: 'exact' });
  if (params.table && tables.includes(params.table)) q = q.eq('table_name', params.table);
  if (params.action && ['insert', 'update', 'delete'].includes(params.action)) q = q.eq('action', params.action);
  const [{ data, count, error }, { data: people }] = await Promise.all([
    q.order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    db.from('profiles').select('id, full_name, email'),
  ]);
  if (error && error.code !== 'PGRST103') throw error;
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const changed = (o: unknown, n: unknown) => {
    if (!o || !n) return [];
    const a = o as Record<string, unknown>;
    const b = n as Record<string, unknown>;
    return Object.keys(b).filter((k) => k !== 'updated_at' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  };
  return (
    <Card>
      <CardHeader title="Audit log" description="Automatically recorded by database triggers. Read-only." />
      <div className="border-b border-line p-4">
        <FilterBar
          basePath="/settings"
          hidden={{ tab: 'audit' }}
          selects={[
            { name: 'table', label: 'Table', anyLabel: 'All tables', value: params.table, options: tables.map((t) => ({ value: t, label: t })) },
            { name: 'action', label: 'Action', anyLabel: 'All actions', value: params.action, options: ['insert', 'update', 'delete'].map((t) => ({ value: t, label: t })) },
          ]}
        />
      </div>
      {data?.length ? (
        <>
          <TableWrap>
            <Table data-testid="audit-table">
              <thead>
                <tr>
                  <Th>When (IST)</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Record</Th>
                  <Th>Changed fields</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <Tr key={a.id}>
                    <Td className="tabular whitespace-nowrap text-ink-2">{formatDateTime(a.created_at)}</Td>
                    <Td>
                      {a.actor_id ? names.get(a.actor_id) ?? 'Deleted user' : 'System'}
                      {a.actor_role && <p className="text-xs text-ink-3">{a.actor_role}</p>}
                    </Td>
                    <Td>
                      <Badge tone={a.action === 'delete' ? 'critical' : a.action === 'insert' ? 'good' : 'info'} icon={false}>
                        {a.action}
                      </Badge>
                    </Td>
                    <Td>
                      <p className="font-mono text-xs">{a.table_name}</p>
                      <p className="max-w-40 truncate font-mono text-[11px] text-ink-3">{a.record_id}</p>
                    </Td>
                    <Td className="max-w-72 text-xs text-ink-2">{a.action === 'update' ? changed(a.old_data, a.new_data).join(', ') || '—' : '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={{ ...params, tab: 'audit' }} basePath="/settings" />
        </>
      ) : (
        <EmptyState title="No audit entries" />
      )}
    </Card>
  );
}
