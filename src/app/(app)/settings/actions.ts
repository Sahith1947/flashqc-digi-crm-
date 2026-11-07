'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { ROLES, SUPPRESSION_SOURCES } from '@/lib/constants';
import { normalizePhone } from '@/lib/phone';
import { assertRole } from '@/server/auth';
import { formBool, formOptional, formString, runAction } from '@/server/action-utils';

export async function updateProfile(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db, userId } = await assertRole('viewer');
    const name = z.string().trim().min(2, 'Enter your name').max(120).parse(formString(fd, 'full_name'));
    const { error } = await db.from('profiles').update({ full_name: name }).eq('id', userId);
    if (error) throw error;
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Profile updated.' };
  });
}

export async function updateOrgSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
    const data = z
      .object({
        company_name: z.string().trim().min(1).max(120),
        default_calling_window_start: time,
        default_calling_window_end: time,
        simulation_mode_enabled: z.boolean(),
      })
      .refine((d) => d.default_calling_window_start < d.default_calling_window_end, { message: 'Window end must be after start', path: ['default_calling_window_end'] })
      .parse({
        company_name: formString(fd, 'company_name'),
        default_calling_window_start: formString(fd, 'default_calling_window_start').slice(0, 5),
        default_calling_window_end: formString(fd, 'default_calling_window_end').slice(0, 5),
        simulation_mode_enabled: formBool(fd, 'simulation_mode_enabled'),
      });
    const { data: rows, error } = await db.from('app_settings').update(data).eq('id', true).select('id');
    if (error) throw error;
    if (!rows?.length) return { ok: false, error: 'Settings could not be saved.' };
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Organisation settings saved.' };
  });
}

export async function updateMember(memberId: string, role: string, isActive: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const { data, error } = await db
      .from('profiles')
      .update({ role: z.enum(ROLES).parse(role), is_active: z.boolean().parse(isActive) })
      .eq('id', z.string().uuid().parse(memberId))
      .select('email');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'User not found.' };
    revalidatePath('/settings');
    return { ok: true, message: `${data[0].email} updated.` };
  });
}

export async function addSuppression(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const phone = normalizePhone(formString(fd, 'phone'));
    if (!phone.ok) return { ok: false, error: phone.error, fieldErrors: { phone: phone.error } };
    const source = z.enum(SUPPRESSION_SOURCES).parse(formString(fd, 'source') || 'manual');
    const reason = formOptional(fd, 'reason')?.slice(0, 500) ?? null;
    const { data: existing } = await db.from('suppression_list').select('id').eq('phone_e164', phone.e164).maybeSingle();
    if (existing) return { ok: false, error: 'This number is already on the suppression list.', fieldErrors: { phone: 'Already suppressed' } };
    const { error } = await db.from('suppression_list').insert({ phone_e164: phone.e164, source, reason });
    if (error) throw error;
    revalidatePath('/settings');
    revalidatePath('/contacts');
    return { ok: true, message: 'Number added to the suppression list.' };
  });
}

export async function removeSuppression(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const { data, error } = await db.from('suppression_list').delete().eq('id', z.string().uuid().parse(id)).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Entry not found.' };
    revalidatePath('/settings');
    revalidatePath('/contacts');
    return { ok: true, message: 'Number removed from the suppression list.' };
  });
}
