'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { normalizePhone } from '@/lib/phone';
import { searchTerm } from '@/lib/list-params';
import { assertRole } from '@/server/auth';
import { formOptional, formString, runAction } from '@/server/action-utils';
import { TelephonyService } from '@/server/services/telephony-service';

const optionalUuid = z.string().uuid().nullable();

export async function placeOutboundCall(_prev: ActionResult<{ callId: string }> | null, fd: FormData): Promise<ActionResult<{ callId: string }>> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const phone = normalizePhone(formString(fd, 'phone'));
    if (!phone.ok) return { ok: false, error: phone.error, fieldErrors: { phone: phone.error } };
    const mode = z.enum(['simulated', 'live']).parse(formString(fd, 'mode') || 'simulated');
    const res = await TelephonyService.startOutboundCall(db, {
      phoneE164: phone.e164,
      contactId: optionalUuid.parse(formOptional(fd, 'contact_id')),
      phoneNumberId: optionalUuid.parse(formOptional(fd, 'phone_number_id')),
      voiceAgentId: optionalUuid.parse(formOptional(fd, 'voice_agent_id')),
      mode,
    });
    revalidatePath('/outbound');
    revalidatePath('/calls');
    revalidatePath('/');
    const msg = res.simulated
      ? `Simulated call recorded (${res.status.replace('_', ' ')}). No real call was placed.`
      : `Call request accepted by the provider (status: ${res.status}). Final status will update from the provider.`;
    return { ok: true, message: msg, data: { callId: res.callId } };
  });
}

export async function searchContacts(q: string) {
  const { db } = await assertRole('viewer');
  const term = searchTerm(q);
  if (!term) return [];
  const digits = q.replace(/\D/g, '');
  const parts = [`full_name.ilike.${term}`, `business_name.ilike.${term}`];
  if (digits.length >= 3) parts.push(`phone_e164.ilike.%${digits}%`);
  const { data, error } = await db
    .from('contacts')
    .select('id, full_name, business_name, phone_e164, dnd_status, consent_status')
    .or(parts.join(','))
    .order('full_name')
    .limit(8);
  if (error) return [];
  return data ?? [];
}
