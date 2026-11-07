import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelephonyProvider, getVoiceAgentProvider } from '@/server/providers/registry';
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
    } else if (key === 'telephony') {
      result = await getTelephonyProvider().healthCheck();
    } else {
      result = await getVoiceAgentProvider().healthCheck();
    }

    let persisted = false;
    if (admin) {
      const status = result.verified ? (result.ok ? 'connected' : 'error') : 'not_configured';
      const { error } = await admin
        .from('integrations')
        .update({ status, last_checked_at: new Date().toISOString(), last_error: result.ok ? null : result.message.slice(0, 500) })
        .eq('key', key);
      persisted = !error;
    }
    return { ...result, persisted };
  },
};
