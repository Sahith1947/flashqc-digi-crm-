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
import { VobizService } from '@/server/services/vobiz-service';
import { SarvamRecordings } from '@/server/services/sarvam-recordings';
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


// ---------------------------------------------------------------- Vobiz call recordings
export async function connectVobiz(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    const authId = String(fd.get('vobiz_auth_id') ?? '');
    const authToken = String(fd.get('vobiz_auth_token') ?? '');
    if (!authId.trim() || !authToken.trim()) return { ok: false, error: 'Enter both the Auth ID and the Auth Token.' };
    const admin = backend();
    await VobizService.connect(admin, authId, authToken);
    let extra = '';
    try {
      const n = await VobizService.sync(admin, { days: 30 });
      if (n) extra = ` ${n} recording${n === 1 ? '' : 's'} added to Call Logs.`;
    } catch (e) {
      console.error('[vobiz] first sync', e);
    }
    revalidatePath('/', 'layout');
    return { ok: true, message: `Vobiz connected. Recordings now sync automatically.${extra}` };
  });
}

export async function syncVobizRecordings(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('agent');
    const n = await VobizService.sync(backend(), { days: 30 });
    revalidatePath('/', 'layout');
    if (n === null) return { ok: false, error: 'Connect Vobiz first.' };
    return { ok: true, message: n ? `${n} new recording${n === 1 ? '' : 's'} added to Call Logs.` : 'Checked Vobiz: no new recordings for your calls yet.' };
  });
}

export async function disconnectVobiz(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    await VobizService.disconnect(backend());
    revalidatePath('/integrations');
    return { ok: true, message: 'Vobiz disconnected. The saved keys were deleted; recordings already in Call Logs stay.' };
  });
}

// ---------------------------------------------------------------- Sarvam recordings (API key)
export async function saveSarvamApiKey(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    const key = String(fd.get('sarvam_api_key') ?? '');
    if (!key.trim()) return { ok: false, error: 'Paste your Sarvam API key.' };
    const n = await SarvamRecordings.saveKey(backend(), key);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Recordings switched on.${n ? ` ${n} past call${n === 1 ? '' : 's'} now have a recording.` : ''} New calls get theirs automatically.` };
  });
}

export async function removeSarvamApiKey(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('admin');
    await SarvamRecordings.removeKey(backend());
    revalidatePath('/integrations');
    return { ok: true, message: 'Sarvam API key deleted. Recordings already saved stay playable.' };
  });
}

export async function downloadAllRecordings(): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('manager');
    const admin = backend();
    await SarvamRecordings.backfill(admin, 3650);
    const r = await SarvamRecordings.materializePending(admin, { budgetMs: 40_000 });
    revalidatePath('/recordings');
    revalidatePath('/integrations');
    if (!r.saved && !r.remaining) return { ok: true, message: r.failed ? `${r.failed} call(s) had no recording at Sarvam. Everything else is ready.` : 'All recordings are already saved and ready to play.' };
    return {
      ok: true,
      message: `${r.saved} recording${r.saved === 1 ? '' : 's'} saved${r.failed ? `, ${r.failed} not available at Sarvam` : ''}.${r.remaining ? ` ${r.remaining} still to go — click again to continue.` : ' All recordings are ready.'}`,
    };
  });
}
