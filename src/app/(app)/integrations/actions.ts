'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { assertRole } from '@/server/auth';
import { formOptional, runAction } from '@/server/action-utils';
import { IntegrationService } from '@/server/services/integration-service';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamAuth } from '@/server/providers/sarvam/auth';
import { SarvamService } from '@/server/services/sarvam-service';
import { AppError } from '@/server/providers/types';

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

// ---------------------------------------------------------------- Sarvam AI

function backend() {
  const admin = createAdminClient();
  if (!admin) throw new AppError('SUPABASE_SECRET_KEY is not set on the server.');
  return admin;
}

function refreshSarvamPages() {
  revalidatePath('/integrations');
  revalidatePath('/voice-agents');
  revalidatePath('/phone-numbers');
}

export async function startSarvamConnect(): Promise<ActionResult<{ userCode: string; verifyUrl: string }>> {
  return runAction(async () => {
    await assertRole('admin');
    const res = await SarvamAuth.startConnect(backend());
    return { ok: true, message: 'Approve the code on Sarvam to finish connecting.', data: res };
  });
}

type PollState = 'waiting' | 'connected' | 'expired' | 'none';
export async function pollSarvamConnect(): Promise<ActionResult<{ state: PollState }>> {
  return runAction<{ state: PollState }>(async () => {
    await assertRole('admin');
    const admin = backend();
    const state = await SarvamAuth.pollConnect(admin);
    if (state === 'connected') {
      // Verify immediately and record the verified status.
      await IntegrationService.check(admin, 'sarvam_ai');
      refreshSarvamPages();
      return { ok: true, message: 'Sarvam connected.', data: { state } };
    }
    if (state === 'expired') return { ok: false, error: 'The sign-in code expired or was declined. Start again.' };
    return { ok: true, message: '', data: { state } };
  });
}

export async function cancelSarvamConnect(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    await SarvamAuth.cancelConnect(backend());
    refreshSarvamPages();
    return { ok: true, message: 'Sign-in cancelled.' };
  });
}

export async function disconnectSarvam(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    const admin = backend();
    await SarvamAuth.disconnect(admin);
    await admin.from('integrations').update({ status: 'not_configured', last_error: 'Disconnected by an admin', last_checked_at: new Date().toISOString() }).in('key', ['sarvam_ai', 'telephony']);
    await admin.from('voice_agents').update({ connection_status: 'not_connected' }).eq('provider', 'sarvam').not('provider_synced_at', 'is', null);
    refreshSarvamPages();
    return { ok: true, message: 'Sarvam disconnected. Stored tokens were deleted.' };
  });
}

export async function syncSarvamAgents(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('manager');
    const r = await SarvamService.syncAgents(backend());
    refreshSarvamPages();
    return {
      ok: true,
      message: `Synced ${r.total} agent${r.total === 1 ? '' : 's'} from Sarvam (${r.created} new, ${r.updated} updated${r.missing ? `, ${r.missing} no longer in Sarvam` : ''}).`,
    };
  });
}

export async function syncSarvamNumbers(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('manager');
    const r = await SarvamService.syncNumbers(backend());
    refreshSarvamPages();
    const conns = r.connectionSummary.map((c) => `${c.provider}: ${c.status.replace(/_/g, ' ')}`).join(', ') || 'none';
    return {
      ok: true,
      message: r.imported
        ? `Imported ${r.imported} number${r.imported === 1 ? '' : 's'} from Sarvam (connections: ${conns}).`
        : `No numbers are onboarded in Sarvam yet (connections: ${conns}). Onboard a number in Sarvam, then sync again.`,
    };
  });
}

export async function enableSarvamCallSync(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    const admin = backend();
    const { SarvamCalling } = await import('@/server/providers/sarvam/calling');
    const r = await SarvamCalling.enableInboundSync(admin);
    refreshSarvamPages();
    return { ok: true, message: `Inbound call sync enabled for: ${r.deployments.join(', ')}. Calls to your Sarvam number will now appear in the CRM.` };
  });
}
