import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelephonyProvider } from '@/server/providers/registry';
import { SarvamAuth } from '@/server/providers/sarvam/auth';
import { AppError } from '@/server/providers/types';
import { SarvamService } from './sarvam-service';
import type { HealthResult } from '@/server/providers/types';
import { RECORDINGS_BUCKET } from './recording-service';

export type IntegrationKey = 'sarvam_ai' | 'telephony' | 'recording_storage';

/**
 * Runs a real health check. Status is persisted only with the backend client,
 * and only marked "connected" when the check was verified by the provider.
 */
export const IntegrationService = {
  async check(_db: DB, key: IntegrationKey): Promise<HealthResult & { persisted: boolean }> {
    let result: HealthResult;
    let configuredOnly = false;
    const admin = createAdminClient();
    if (key === 'recording_storage') {
      if (!admin) {
        result = { ok: false, verified: false, message: 'SUPABASE_SECRET_KEY is not set on the server, so storage cannot be verified.' };
      } else {
        const { data, error } = await admin.storage.getBucket(RECORDINGS_BUCKET);
        result = error || !data
          ? { ok: false, verified: true, message: `Bucket "${RECORDINGS_BUCKET}" is not reachable: ${error?.message ?? 'not found'}` }
          : { ok: true, verified: true, message: `Private bucket "${RECORDINGS_BUCKET}" is reachable (public: ${data.public ? 'yes' : 'no'}).` };
      }
    } else if (!admin) {
      result = { ok: false, verified: false, message: 'SUPABASE_SECRET_KEY is not set on the server.' };
    } else {
      const sarvamConnected = (await SarvamAuth.status(admin)).connected;
      try {
        if (key === 'sarvam_ai') result = await SarvamService.health(admin);
        else if (sarvamConnected) {
          const t = await SarvamService.telephonyHealth(admin);
          // A connection without numbers is "configured", not "connected".
          configuredOnly = !t.ok && t.connections > 0;
          result = t;
        } else result = await getTelephonyProvider().healthCheck();
      } catch (e) {
        result = { ok: false, verified: true, message: e instanceof AppError ? e.message : 'Sarvam check failed.' };
      }
    }

    let persisted = false;
    if (admin) {
      const status = configuredOnly ? 'configured' : result.verified ? (result.ok ? 'connected' : 'error') : 'not_configured';
      const { error } = await admin
        .from('integrations')
        .update({ status, provider: key === 'sarvam_ai' ? 'sarvam' : key === 'telephony' && configuredOnly ? 'sarvam (vobiz)' : undefined, last_checked_at: new Date().toISOString(), last_error: result.ok ? null : result.message.slice(0, 500) })
        .eq('key', key);
      persisted = !error;
    }
    return { ...result, persisted };
  },
};
