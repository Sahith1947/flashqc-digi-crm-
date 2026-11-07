import 'server-only';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamService } from '@/server/services/sarvam-service';

// Throttled background recording checks (per server instance), run after the response is sent.
let lastSweep = 0;
const lastCallCheck = new Map<string, number>();

export function scheduleRecordingSweep() {
  if (Date.now() - lastSweep < 5 * 60_000) return;
  lastSweep = Date.now();
  after(async () => {
    const admin = createAdminClient();
    if (!admin) return;
    await SarvamService.sweepRecordings(admin, 5).catch((e) => console.error('[recording sweep]', e));
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
    await SarvamService.fetchRecording(admin, callId).catch((e) => console.error('[recording check]', e));
  });
}
