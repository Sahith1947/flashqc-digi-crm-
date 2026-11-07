'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { assertRole } from '@/server/auth';
import { formOptional, runAction } from '@/server/action-utils';
import { IntegrationService } from '@/server/services/integration-service';

const keySchema = z.enum(['sarvam_ai', 'telephony', 'recording_storage']);

export async function checkIntegration(key: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const res = await IntegrationService.check(db, keySchema.parse(key));
    revalidatePath('/integrations');
    // Report exactly what the check found — never a success unless it was verified.
    if (res.ok && res.verified) return { ok: true, message: res.message };
    return { ok: false, error: res.message };
  });
}

export async function saveIntegrationConfig(key: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const provider = formOptional(fd, 'provider');
    const notes = formOptional(fd, 'notes');
    if (notes && notes.length > 2000) return { ok: false, error: 'Notes are too long.' };
    if (notes && /(sk|key|secret|token|password)[-_ ]?[:=]/i.test(notes)) {
      return { ok: false, error: 'Do not store secrets here. API keys belong in server environment variables.' };
    }
    const { data, error } = await db
      .from('integrations')
      .update({ provider: provider?.slice(0, 60) ?? null, config: notes ? { notes } : {} })
      .eq('key', keySchema.parse(key))
      .select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Integration not found.' };
    revalidatePath('/integrations');
    return { ok: true, message: 'Integration notes saved.' };
  });
}
