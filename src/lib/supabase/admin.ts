import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { assertPublicEnv } from '@/lib/env';
import { serverEnv } from '@/server/env';

/**
 * Backend client using the secret (service role) key. Bypasses RLS.
 * Only for verified provider callbacks, scheduled jobs and backend health checks.
 * Returns null when the key is not configured.
 */
export function createAdminClient() {
  if (!serverEnv.supabaseSecretKey) return null;
  const { supabaseUrl } = assertPublicEnv();
  return createSupabaseClient<Database>(supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
