'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import type { Contact } from '@/lib/supabase/types';
import { CONSENT_LABELS, CONSENT_STATUSES, DND_LABELS, DND_STATUSES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { useActionToast, useOnSuccess } from '@/components/ui/toast';
import { createContact, updateContact } from '@/app/(app)/contacts/actions';

type R = ActionResult<{ id: string }>;

function ContactFields({ c, fe }: { c?: Partial<Contact>; fe?: Record<string, string> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="cf_name" error={fe?.full_name}>
        <Input id="cf_name" name="full_name" defaultValue={c?.full_name ?? ''} maxLength={200} />
      </Field>
      <Field label="Phone number" htmlFor="cf_phone" error={fe?.phone} required hint="10-digit Indian number or +country code">
        <Input id="cf_phone" name="phone" defaultValue={c?.phone_e164 ?? ''} required aria-invalid={Boolean(fe?.phone)} />
      </Field>
      <Field label="Business name" htmlFor="cf_business" error={fe?.business_name}>
        <Input id="cf_business" name="business_name" defaultValue={c?.business_name ?? ''} maxLength={200} />
      </Field>
      <Field label="Business category" htmlFor="cf_category" error={fe?.business_category}>
        <Input id="cf_category" name="business_category" defaultValue={c?.business_category ?? ''} maxLength={120} placeholder="e.g. Restaurant, Clinic" />
      </Field>
      <Field label="City" htmlFor="cf_city" error={fe?.city}>
        <Input id="cf_city" name="city" defaultValue={c?.city ?? ''} maxLength={120} />
      </Field>
      <Field label="Source" htmlFor="cf_source" error={fe?.source}>
        <Input id="cf_source" name="source" defaultValue={c?.source ?? 'manual'} maxLength={60} />
      </Field>
      <Field label="Consent status" htmlFor="cf_consent">
        <Select id="cf_consent" name="consent_status" defaultValue={c?.consent_status ?? 'unknown'}>
          {CONSENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONSENT_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="DND status" htmlFor="cf_dnd" hint="NCPR / DND registry status">
        <Select id="cf_dnd" name="dnd_status" defaultValue={c?.dnd_status ?? 'unknown'}>
          {DND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DND_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="cf_notes" error={fe?.notes} className="sm:col-span-2">
        <Textarea id="cf_notes" name="notes" rows={3} defaultValue={c?.notes ?? ''} maxLength={5000} />
      </Field>
    </div>
  );
}

function ContactFormInner({ contact, onDone }: { contact?: Contact; onDone: (id: string) => void }) {
  const action = contact ? (updateContact.bind(null, contact.id) as (p: R | null, fd: FormData) => Promise<R>) : createContact;
  const { state, pending, onSubmit: formAction } = useFormAction<R | null>(action);
  useActionToast(state);
  useOnSuccess(state, (s) => s.ok && s.data && onDone(s.data.id));
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={formAction} className="space-y-5" data-testid="contact-form">
      <ContactFields c={contact} fe={fe} />
      <div className="flex justify-end gap-2">
        <Button type="submit" pending={pending}>
          {contact ? 'Save changes' : 'Create contact'}
        </Button>
      </div>
    </form>
  );
}

export function ContactFormButton({ contact }: { contact?: Contact }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const router = useRouter();
  return (
    <>
      <Button
        variant={contact ? 'secondary' : 'primary'}
        icon={contact ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        data-testid={contact ? 'edit-contact' : 'new-contact'}
      >
        {contact ? 'Edit' : 'New contact'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={contact ? 'Edit contact' : 'New contact'} wide>
        <ContactFormInner
          key={key}
          contact={contact}
          onDone={(id) => {
            setOpen(false);
            if (!contact) router.push(`/contacts/${id}`);
            else router.refresh();
          }}
        />
      </Modal>
    </>
  );
}
