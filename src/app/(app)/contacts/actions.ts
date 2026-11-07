'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import type { ContactInput } from '@/lib/contact-import';
import { CONSENT_STATUSES, DND_STATUSES } from '@/lib/constants';
import { normalizePhone } from '@/lib/phone';
import { assertRole } from '@/server/auth';
import { formOptional, formString, runAction } from '@/server/action-utils';
import { ContactService } from '@/server/services/contact-service';

const contactSchema = z.object({
  full_name: z.string().max(200, 'Max 200 characters').nullable(),
  business_name: z.string().max(200, 'Max 200 characters').nullable(),
  business_category: z.string().max(120, 'Max 120 characters').nullable(),
  city: z.string().max(120, 'Max 120 characters').nullable(),
  source: z.string().min(1).max(60, 'Max 60 characters'),
  consent_status: z.enum(CONSENT_STATUSES),
  dnd_status: z.enum(DND_STATUSES),
  notes: z.string().max(5000, 'Max 5000 characters').nullable(),
});

function readContact(fd: FormData) {
  const phone = normalizePhone(formString(fd, 'phone'));
  const parsed = contactSchema.safeParse({
    full_name: formOptional(fd, 'full_name'),
    business_name: formOptional(fd, 'business_name'),
    business_category: formOptional(fd, 'business_category'),
    city: formOptional(fd, 'city'),
    source: formString(fd, 'source') || 'manual',
    consent_status: formString(fd, 'consent_status') || 'unknown',
    dnd_status: formString(fd, 'dnd_status') || 'unknown',
    notes: formOptional(fd, 'notes'),
  });
  const fieldErrors: Record<string, string> = {};
  if (!phone.ok) fieldErrors.phone = phone.error;
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (!phone.ok || !parsed.success) return { error: { ok: false as const, error: 'Please fix the highlighted fields.', fieldErrors } };
  return { data: { ...parsed.data, phone_e164: phone.e164 } };
}

function refresh(id?: string) {
  revalidatePath('/contacts');
  if (id) revalidatePath(`/contacts/${id}`);
}

export async function createContact(_prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const r = readContact(fd);
    if (r.error) return r.error;
    const { data: existing } = await db.from('contacts').select('id').eq('phone_e164', r.data.phone_e164).maybeSingle();
    if (existing) return { ok: false, error: 'A contact with this phone number already exists.', fieldErrors: { phone: 'Already exists' } };
    const { data, error } = await db.from('contacts').insert(r.data).select('id').single();
    if (error) throw error;
    // Link any earlier calls from this number.
    await db.from('calls').update({ contact_id: data.id }).eq('phone_e164', r.data.phone_e164).is('contact_id', null);
    refresh();
    return { ok: true, message: 'Contact created.', data: { id: data.id } };
  });
}

export async function updateContact(id: string, _prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const cid = z.string().uuid().parse(id);
    const r = readContact(fd);
    if (r.error) return r.error;
    const { data: clash } = await db.from('contacts').select('id').eq('phone_e164', r.data.phone_e164).neq('id', cid).maybeSingle();
    if (clash) return { ok: false, error: 'Another contact already uses this phone number.', fieldErrors: { phone: 'Already used by another contact' } };
    const { data, error } = await db.from('contacts').update(r.data).eq('id', cid).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Contact not found or you lack permission.' };
    refresh(cid);
    return { ok: true, message: 'Contact updated.', data: { id: cid } };
  });
}

export async function deleteContact(id: string): Promise<ActionResult> {
  const res = await runAction<undefined>(async () => {
    const { db } = await assertRole('manager');
    const { data, error } = await db.from('contacts').delete().eq('id', z.string().uuid().parse(id)).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Contact not found or you lack permission.' };
    refresh();
    return { ok: true, message: 'Contact deleted.' };
  });
  if (res.ok) redirect('/contacts');
  return res;
}

export async function setSuppression(phoneE164: string, suppress: boolean, reason?: string): Promise<ActionResult> {
  return runAction(async () => {
    const phone = normalizePhone(phoneE164);
    if (!phone.ok) return { ok: false, error: phone.error };
    if (suppress) {
      const { db } = await assertRole('agent');
      const { error } = await db
        .from('suppression_list')
        .upsert({ phone_e164: phone.e164, source: 'manual', reason: reason?.slice(0, 500) || 'Added from contact' }, { onConflict: 'phone_e164', ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { db } = await assertRole('manager');
      const { data, error } = await db.from('suppression_list').delete().eq('phone_e164', phone.e164).select('id');
      if (error) throw error;
      if (!data?.length) return { ok: false, error: 'Number was not on the suppression list.' };
    }
    revalidatePath('/contacts', 'layout');
    revalidatePath('/settings');
    return { ok: true, message: suppress ? 'Number added to the suppression list. It will not be called.' : 'Number removed from the suppression list.' };
  });
}

export async function checkExistingPhones(phones: string[]): Promise<string[]> {
  const { db } = await assertRole('viewer');
  const list = z.array(z.string().max(20)).max(5000).parse(phones);
  return [...(await ContactService.findExistingPhones(db, list))];
}

const importRow = z.object({
  full_name: z.string().nullable(),
  phone_e164: z.string(),
  business_name: z.string().nullable(),
  business_category: z.string().nullable(),
  city: z.string().nullable(),
  source: z.string(),
  consent_status: z.enum(CONSENT_STATUSES),
  dnd_status: z.enum(DND_STATUSES),
  notes: z.string().nullable(),
});

export async function importContacts(rows: ContactInput[], existing: 'skip' | 'update'): Promise<ActionResult<{ inserted: number; updated: number; skipped: number }>> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const parsed = z.array(importRow).min(1, 'Nothing to import').max(5000).parse(rows);
    const res = await ContactService.importContacts(db, parsed, z.enum(['skip', 'update']).parse(existing));
    refresh();
    return {
      ok: true,
      message: `Import complete: ${res.inserted} added, ${res.updated} updated, ${res.skipped} existing skipped.`,
      data: { inserted: res.inserted, updated: res.updated, skipped: res.skipped },
    };
  });
}
