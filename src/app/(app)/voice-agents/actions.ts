'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { AGENT_STATUSES } from '@/lib/constants';
import { assertRole } from '@/server/auth';
import { formOptional, formString, runAction } from '@/server/action-utils';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().max(1000).nullable(),
  language: z.string().min(2).max(20),
  voice: z.string().max(80).nullable(),
  provider: z.enum(['sarvam', 'other']),
  provider_agent_id: z.string().max(200).nullable(),
  greeting: z.string().max(2000, 'Max 2000 characters').nullable(),
  instructions: z.string().max(20000, 'Max 20000 characters').nullable(),
  status: z.enum(AGENT_STATUSES),
});

export async function saveVoiceAgent(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const parsed = schema.safeParse({
      name: formString(fd, 'name'),
      description: formOptional(fd, 'description'),
      language: formString(fd, 'language') || 'en-IN',
      voice: formOptional(fd, 'voice'),
      provider: formString(fd, 'provider') || 'sarvam',
      provider_agent_id: formOptional(fd, 'provider_agent_id'),
      greeting: formOptional(fd, 'greeting'),
      instructions: formOptional(fd, 'instructions'),
      status: formString(fd, 'status') || 'draft',
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors: fe };
    }
    if (id) {
      const { data, error } = await db.from('voice_agents').update(parsed.data).eq('id', z.string().uuid().parse(id)).select('id');
      if (error) throw error;
      if (!data?.length) return { ok: false, error: 'Agent not found.' };
    } else {
      const { error } = await db.from('voice_agents').insert(parsed.data);
      if (error) throw error;
    }
    revalidatePath('/voice-agents');
    revalidatePath('/phone-numbers');
    return { ok: true, message: id ? 'Voice agent updated.' : 'Voice agent created. It will connect to Sarvam AI in Phase 2.' };
  });
}

export async function deleteVoiceAgent(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const { data, error } = await db.from('voice_agents').delete().eq('id', z.string().uuid().parse(id)).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Agent not found.' };
    revalidatePath('/voice-agents');
    revalidatePath('/phone-numbers');
    return { ok: true, message: 'Voice agent deleted. Numbers and campaigns using it are now unassigned.' };
  });
}
