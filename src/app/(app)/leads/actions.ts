'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { assertRole } from '@/server/auth';
import { runAction } from '@/server/action-utils';
import { AppError } from '@/server/providers/types';
import { TelephonyService } from '@/server/services/telephony-service';

/** One call to a hot lead: a real call when live calling is ready, otherwise a clearly labelled simulation. */
export async function callLead(contactId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const { data: ct } = await db.from('contacts').select('id, phone_e164').eq('id', z.string().uuid().parse(contactId)).maybeSingle();
    if (!ct) throw new AppError('Contact not found.');
    const live = (await TelephonyService.liveStatus()).available;
    const res = await TelephonyService.startOutboundCall(db, { phoneE164: ct.phone_e164, contactId: ct.id, phoneNumberId: null, voiceAgentId: null, mode: live ? 'live' : 'simulated' });
    revalidatePath('/leads');
    revalidatePath('/calls');
    if (res.simulated) return { ok: true, message: 'Simulated call recorded (live calling is not connected).' };
    return { ok: true, message: res.status === 'ringing' ? 'Calling now. The result and recording appear here when the call ends.' : 'Call sent to Sarvam; it starts within about 2 minutes.' };
  });
}
