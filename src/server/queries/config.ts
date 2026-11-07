import 'server-only';
import type { DB } from '@/lib/supabase/types';

export async function getSettings(db: DB) {
  const { data, error } = await db.from('app_settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function lineOptions(db: DB, kind: 'inbound' | 'outbound' | 'any' = 'any') {
  let q = db.from('phone_numbers').select('id, label, phone_e164').eq('enabled', true).order('label');
  if (kind === 'inbound') q = q.eq('can_inbound', true);
  if (kind === 'outbound') q = q.eq('can_outbound', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function agentOptions(db: DB) {
  const { data, error } = await db.from('voice_agents').select('id, name').neq('status', 'disabled').order('name');
  if (error) throw error;
  return data ?? [];
}
