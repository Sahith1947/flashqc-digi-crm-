'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { normalizePhone } from '@/lib/phone';
import { assertRole } from '@/server/auth';
import { formOptional, formString, runAction } from '@/server/action-utils';
import { TelephonyService } from '@/server/services/telephony-service';

export async function simulateInboundCall(_prev: ActionResult<{ callId: string }> | null, fd: FormData): Promise<ActionResult<{ callId: string }>> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const phone = normalizePhone(formString(fd, 'phone'));
    if (!phone.ok) return { ok: false, error: phone.error, fieldErrors: { phone: phone.error } };
    const phoneNumberId = z.string().uuid().nullable().parse(formOptional(fd, 'phone_number_id'));
    const res = await TelephonyService.simulateInboundCall(db, { phoneE164: phone.e164, phoneNumberId });
    revalidatePath('/inbound');
    revalidatePath('/calls');
    revalidatePath('/');
    return { ok: true, message: `Simulated inbound call recorded (${res.status}).`, data: { callId: res.callId } };
  });
}
