import 'server-only';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamService } from '@/server/services/sarvam-service';
import { VobizService } from '@/server/services/vobiz-service';

// Throttled background recording checks (per server instance), run after the response is sent.
let lastSweep = 0;
const lastCallCheck = new Map<string, number>();

/** Background upkeep after a page is sent: new published agent versions, then recordings. */
export const scheduleBackgroundSync = () => scheduleRecordingSweep();

export function scheduleRecordingSweep() {
  if (Date.now() - lastSweep < 5 * 60_000) return;
  lastSweep = Date.now();
  after(async () => {
    const admin = createAdminClient();
    if (!admin) return;
    await SarvamService.autoSync(admin).catch((e) => console.error('[agent version sync]', e));
    await SarvamService.sweepRecordings(admin, 5).catch((e) => console.error('[recording sweep]', e));
    await VobizService.sync(admin).catch((e) => console.error('[vobiz sweep]', e));
    const { SarvamRecordings } = await import('@/server/services/sarvam-recordings');
    await SarvamRecordings.materializePending(admin, { limit: 3, budgetMs: 20_000 }).catch((e) => console.error('[recording save]', e));
  });
}

export function scheduleRecordingCheck(callId: string) {
  const prev = lastCallCheck.get(callId) ?? 0;
  if (Date.now() - prev < 5 * 60_000) return;
  lastCallCheck.set(callId, Date.now());
  if (lastCallCheck.size > 500) lastCallCheck.clear();
  after(async () => {
    const admin = createAdminClient();
    if (!admin) return;
    const r = await SarvamService.fetchRecording(admin, callId).catch((e) => (console.error('[recording check]', e), null));
    if (r !== 'attached' && r !== 'already') await VobizService.sync(admin, { callId, days: 30 }).catch((e) => console.error('[vobiz check]', e));
  });
}
