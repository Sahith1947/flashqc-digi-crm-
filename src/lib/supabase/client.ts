'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { assertPublicEnv } from '@/lib/env';

export function createClient() {
  const { supabaseUrl, supabaseKey } = assertPublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
