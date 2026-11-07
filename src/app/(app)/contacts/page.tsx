import type { Metadata } from 'next';
import Link from 'next/link';
import { Ban, Download, Upload } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { CONTACTS_PAGE_SIZE, contactFacets, listContacts } from '@/server/queries/contacts';
import { flatParams } from '@/lib/list-params';
import { CALL_OUTCOME_LABELS, CONSENT_LABELS, CONSENT_STATUSES, DND_LABELS, DND_STATUSES, hasMinRole, labelFor } from '@/lib/constants';
import { formatDateTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { FilterBar } from '@/components/ui/filter-bar';
import { Pagination } from '@/components/ui/pagination';
import { SortTh, Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { buttonClass, LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ContactFormButton } from '@/components/contacts/contact-form';
import { ActionButton } from '@/components/config/sarvam-connect';
import { backfillLeadsFromCalls } from './actions';
import { ConsentBadge, DndBadge } from '@/components/contacts/contact-badges';
import { EmotionBadge, LeadStageBadge, TemperatureBadge } from '@/components/contacts/lead-badges';
import { LEAD_STAGE_LABELS, LEAD_STAGES } from '@/lib/leads';

export const metadata: Metadata = { title: 'Contacts' };

export default async function ContactsPage(props: PageProps<'/contacts'>) {
  const { db, profile } = await requireMember();
  const params = flatParams(await props.searchParams);
  const [{ rows, total, page, filters }, facets] = await Promise.all([listContacts(db, params), contactFacets(db)]);
  const canAgent = hasMinRole(profile.role, 'agent');
  const exportQs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== 'page') as [string, string][]).toString();
  const sortProps = { params, basePath: '/contacts' };
  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${total.toLocaleString('en-IN')} contact${total === 1 ? '' : 's'}. Phone numbers are unique, so duplicates are never created.`}
        actions={
          <>
            <a href={`/api/export/contacts${exportQs ? `?${exportQs}` : ''}`} className={buttonClass('secondary')} download>
              <Download className="size-4" /> Export CSV
            </a>
            {canAgent && (
              <LinkButton href="/contacts/import" variant="secondary" icon={<Upload className="size-4" />}>
                Import CSV
              </LinkButton>
            )}
            {hasMinRole(profile.role, 'admin') && <ActionButton action={backfillLeadsFromCalls} label="Create leads from past AI calls" testId="backfill-leads" />}
            {canAgent && <ContactFormButton />}
          </>
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <FilterBar
            basePath="/contacts"
            search={{ value: filters.q, placeholder: 'Name, phone, business or notes' }}
            hidden={{ sort: params.sort, dir: params.dir }}
            selects={[
              { name: 'stage', label: 'Lead stage', anyLabel: 'All stages', value: filters.stage, options: LEAD_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] })) },
              { name: 'temperature', label: 'Temperature', anyLabel: 'Any temperature', value: filters.temperature, options: [{ value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }] },
              { name: 'city', label: 'City', anyLabel: 'All cities', value: filters.city, options: facets.cities.map((c) => ({ value: c, label: c })) },
              { name: 'category', label: 'Category', anyLabel: 'All categories', value: filters.category, options: facets.categories.map((c) => ({ value: c, label: c })) },
              { name: 'source', label: 'Source', anyLabel: 'All sources', value: filters.source, options: facets.sources.map((c) => ({ value: c, label: c })) },
              { name: 'consent', label: 'Consent', anyLabel: 'Any consent', value: filters.consent, options: CONSENT_STATUSES.map((s) => ({ value: s, label: CONSENT_LABELS[s] })) },
              { name: 'dnd', label: 'DND', anyLabel: 'Any DND status', value: filters.dnd, options: DND_STATUSES.map((s) => ({ value: s, label: DND_LABELS[s] })) },
              { name: 'suppressed', label: 'Suppression', anyLabel: 'Suppressed or not', value: filters.suppressed, options: [{ value: 'yes', label: 'Suppressed' }, { value: 'no', label: 'Not suppressed' }] },
            ]}
          />
        </div>
        {rows.length ? (
          <>
            <TableWrap>
              <Table data-testid="contacts-table" className="min-w-[1240px]">
                <thead>
                  <tr>
                    <SortTh label="Name" column="full_name" {...sortProps} />
                    <Th>Phone</Th>
                    <Th>Business</Th>
                    <SortTh label="City" column="city" {...sortProps} />
                    <Th>Lead stage</Th>
                    <Th>Temp.</Th>
                    <Th>Emotion</Th>
                    <Th>Consent</Th>
                    <Th>DND</Th>
                    <SortTh label="Calls" column="total_calls" {...sortProps} />
                    <SortTh label="Last call" column="last_call_at" {...sortProps} />
                    <Th>Last outcome</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`/contacts/${c.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">
                          {c.full_name || 'Unnamed contact'}
                        </Link>
                        {c.is_suppressed && (
                          <Badge tone="critical" className="ml-2" title="On the suppression list">
                            <Ban className="size-3" /> Do not call
                          </Badge>
                        )}
                        <p className="text-xs text-ink-3">Source: {c.source}</p>
                      </Td>
                      <Td className="tabular whitespace-nowrap">{formatPhone(c.phone_e164)}</Td>
                      <Td>
                        <p className="max-w-48 truncate">{c.business_name || '—'}</p>
                        {c.business_category && <p className="text-xs text-ink-3">{c.business_category}</p>}
                      </Td>
                      <Td>{c.city || '—'}</Td>
                      <Td>
                        <LeadStageBadge stage={c.lead_stage} />
                      </Td>
                      <Td>
                        <TemperatureBadge temperature={c.lead_temperature} />
                      </Td>
                      <Td>
                        <EmotionBadge emotion={c.last_emotion} />
                      </Td>
                      <Td>
                        <ConsentBadge status={c.consent_status} />
                      </Td>
                      <Td>
                        <DndBadge status={c.dnd_status} />
                      </Td>
                      <Td className="tabular">{c.total_calls}</Td>
                      <Td className="tabular whitespace-nowrap text-ink-2">{formatDateTime(c.last_call_at)}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{labelFor(CALL_OUTCOME_LABELS, c.last_call_outcome)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination page={page} pageSize={CONTACTS_PAGE_SIZE} total={total} params={params} basePath="/contacts" />
          </>
        ) : (
          <EmptyState
            title={Object.keys(params).length ? 'No contacts match these filters' : 'No contacts yet'}
            description="Add contacts one by one, import a CSV, or save callers from the call details page."
            action={canAgent ? <LinkButton href="/contacts/import" variant="dark" size="sm">Import CSV</LinkButton> : undefined}
          />
        )}
      </Card>
    </>
  );
}
