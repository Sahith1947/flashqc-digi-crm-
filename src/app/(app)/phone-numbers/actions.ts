'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { PHONE_PROVIDERS } from '@/lib/constants';
import { normalizePhone } from '@/lib/phone';
import { assertRole } from '@/server/auth';
import { formBool, formOptional, formString, runAction } from '@/server/action-utils';

const schema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(120),
  provider: z.enum(PHONE_PROVIDERS),
  provider_number_id: z.string().max(200).nullable(),
  can_inbound: z.boolean(),
  can_outbound: z.boolean(),
  enabled: z.boolean(),
  voice_agent_id: z.string().uuid().nullable(),
});

function read(fd: FormData) {
  const phone = normalizePhone(formString(fd, 'phone'));
  const parsed = schema.safeParse({
    label: formString(fd, 'label'),
    provider: formString(fd, 'provider') || 'unassigned',
    provider_number_id: formOptional(fd, 'provider_number_id'),
    can_inbound: formBool(fd, 'can_inbound'),
    can_outbound: formBool(fd, 'can_outbound'),
    enabled: formBool(fd, 'enabled'),
    voice_agent_id: formOptional(fd, 'voice_agent_id'),
  });
  const fe: Record<string, string> = {};
  if (!phone.ok) fe.phone = phone.error;
  if (!parsed.success) for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
  if (parsed.success && !parsed.data.can_inbound && !parsed.data.can_outbound) fe.can_inbound = 'Enable inbound, outbound or both';
  if (Object.keys(fe).length || !phone.ok || !parsed.success) return { error: { ok: false as const, error: 'Please fix the highlighted fields.', fieldErrors: fe } };
  return { data: { ...parsed.data, phone_e164: phone.e164 } };
}

export async function savePhoneNumber(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const r = read(fd);
    if (r.error) return r.error;
    if (id) {
      const { data, error } = await db.from('phone_numbers').update(r.data).eq('id', z.string().uuid().parse(id)).select('id');
      if (error) throw error;
      if (!data?.length) return { ok: false, error: 'Number not found.' };
    } else {
      const { error } = await db.from('phone_numbers').insert(r.data);
      if (error) throw error;
    }
    revalidatePath('/phone-numbers');
    return { ok: true, message: id ? 'Phone number updated.' : 'Phone number added. It stays "Not connected" until the provider integration verifies it.' };
  });
}

export async function deletePhoneNumber(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const { data, error } = await db.from('phone_numbers').delete().eq('id', z.string().uuid().parse(id)).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Number not found.' };
    revalidatePath('/phone-numbers');
    return { ok: true, message: 'Phone number removed. Existing call records are kept.' };
  });
}
