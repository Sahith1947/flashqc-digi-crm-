import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Ban, PhoneCall, Trash2 } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { isUuid } from '@/lib/list-params';
import { CALL_OUTCOME_LABELS, CAMPAIGN_CONTACT_STATUS_LABELS, CAMPAIGN_CONTACT_STATUS_TONE, hasMinRole, labelFor } from '@/lib/constants';
import { formatDateTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Notice } from '@/components/ui/states';
import { LinkButton } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { CallsTable } from '@/components/calls/calls-table';
import { ContactFormButton } from '@/components/contacts/contact-form';
import { ConsentBadge, DndBadge } from '@/components/contacts/contact-badges';
import { deleteContact, setSuppression } from '../actions';

export const metadata: Metadata = { title: 'Contact' };

export default async function ContactDetailPage(props: PageProps<'/contacts/[id]'>) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const { db, profile } = await requireMember();
  const { data: contact, error } = await db.from('contacts_with_stats').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!contact) notFound();
  const [callsRes, campaignsRes, raw] = await Promise.all([
    db.from('call_log_view').select('*').eq('contact_id', id).order('started_at', { ascending: false }).limit(50),
    db.from('campaign_contacts').select('id, status, outcome, attempts, campaign_id, campaigns(name)').eq('contact_id', id).order('created_at', { ascending: false }),
    db.from('contacts').select('*').eq('id', id).single(),
  ]);
  if (callsRes.error) throw callsRes.error;
  const canAgent = hasMinRole(profile.role, 'agent');
  const canManager = hasMinRole(profile.role, 'manager');
  const blocked = contact.is_suppressed || contact.consent_status === 'revoked' || (contact.dnd_status === 'registered' && contact.consent_status !== 'granted');

  return (
    <>
      <Link href="/contacts" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Contacts
      </Link>
      <PageHeader
        title={contact.full_name || 'Unnamed contact'}
        description={`${formatPhone(contact.phone_e164)}${contact.business_name ? ` · ${contact.business_name}` : ''}`}
        actions={
          <>
            {canAgent && !blocked && (
              <LinkButton href={`/outbound?dial=${encodeURIComponent(contact.phone_e164!)}`} icon={<PhoneCall className="size-4" />}>
                Call
              </LinkButton>
            )}
            {canAgent && raw.data && <ContactFormButton contact={raw.data} />}
            {canAgent && !contact.is_suppressed && (
              <ConfirmAction
                action={setSuppression.bind(null, contact.phone_e164!, true, 'Added from contact page')}
                label="Do not call"
                icon={<Ban className="size-4" />}
                title="Add to suppression list?"
                description="This number will be blocked from all manual and campaign calls until a manager removes it."
                confirmLabel="Add to suppression list"
                testId="suppress-contact"
              />
            )}
            {canManager && contact.is_suppressed && (
              <ConfirmAction
                action={setSuppression.bind(null, contact.phone_e164!, false)}
                label="Remove from suppression"
                variant="secondary"
                title="Remove from suppression list?"
                description="Only do this if the person has asked to be contacted again."
                confirmLabel="Remove"
              />
            )}
            {canManager && (
              <ConfirmAction
                action={deleteContact.bind(null, id)}
                label="Delete"
                icon={<Trash2 className="size-4" />}
                title="Delete this contact?"
                description="The contact and its campaign enrolments are deleted. Call history is kept but unlinked."
                confirmLabel="Delete contact"
                testId="delete-contact"
              />
            )}
          </>
        }
      />
      {blocked && (
        <Notice tone="warning" className="mb-6">
          This contact cannot be called:{' '}
          {contact.is_suppressed ? 'the number is on the suppression list.' : contact.consent_status === 'revoked' ? 'consent was revoked.' : 'the number is on DND with no recorded consent.'}
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-0 text-sm">
              {[
                ['Phone', formatPhone(contact.phone_e164)],
                ['Business', contact.business_name || '—'],
                ['Category', contact.business_category || '—'],
                ['City', contact.city || '—'],
                ['Source', contact.source],
                ['Consent', <ConsentBadge key="c" status={contact.consent_status} />],
                ['DND', <DndBadge key="d" status={contact.dnd_status} />],
                ['Total calls', contact.total_calls],
                ['Last call', formatDateTime(contact.last_call_at)],
                ['Last outcome', labelFor(CALL_OUTCOME_LABELS, contact.last_call_outcome)],
                ['Added', formatDateTime(contact.created_at)],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-4 border-b border-line py-2 last:border-0">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {contact.notes && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium tracking-wide text-ink-3 uppercase">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{contact.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Call history" description={`${contact.total_calls} call${contact.total_calls === 1 ? '' : 's'}`} />
            {callsRes.data.length ? <CallsTable rows={callsRes.data} hide={['business']} /> : <EmptyState title="No calls with this contact yet" />}
          </Card>
          <Card>
            <CardHeader title="Campaigns" />
            {campaignsRes.data?.length ? (
              <ul className="divide-y divide-line">
                {campaignsRes.data.map((cc) => (
                  <li key={cc.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/campaigns/${cc.campaign_id}`} className="font-medium hover:underline">
                      {(cc.campaigns as { name: string } | null)?.name ?? 'Campaign'}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-ink-3">{cc.attempts} attempt{cc.attempts === 1 ? '' : 's'}</span>
                      <Badge tone={CAMPAIGN_CONTACT_STATUS_TONE[cc.status]}>{CAMPAIGN_CONTACT_STATUS_LABELS[cc.status]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Not part of any campaign" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
