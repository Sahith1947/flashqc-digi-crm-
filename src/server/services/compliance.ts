import 'server-only';
import type { DB } from '@/lib/supabase/types';

export interface CallableCheck {
  allowed: boolean;
  reason: string | null;
}

/**
 * Pre-call compliance gate used by manual calls and campaigns:
 *   - number on the suppression list → blocked
 *   - contact consent revoked → blocked
 *   - contact on DND (NCPR) without explicit consent → blocked
 */
export function evaluateCallable(
  suppressed: boolean,
  contact: { consent_status: string; dnd_status: string } | null,
): CallableCheck {
  if (suppressed) return { allowed: false, reason: 'Number is on the suppression list' };
  if (contact?.consent_status === 'revoked') return { allowed: false, reason: 'Contact has revoked consent' };
  if (contact?.dnd_status === 'registered' && contact.consent_status !== 'granted') {
    return { allowed: false, reason: 'Number is on DND and has no recorded consent' };
  }
  return { allowed: true, reason: null };
}

export async function checkCallable(db: DB, phoneE164: string, contactId: string | null): Promise<CallableCheck> {
  const [{ data: sup, error: supErr }, contactRes] = await Promise.all([
    db.from('suppression_list').select('id').eq('phone_e164', phoneE164).maybeSingle(),
    contactId
      ? db.from('contacts').select('consent_status, dnd_status').eq('id', contactId).maybeSingle()
      : db.from('contacts').select('consent_status, dnd_status').eq('phone_e164', phoneE164).maybeSingle(),
  ]);
  if (supErr) throw supErr;
  if (contactRes.error) throw contactRes.error;
  return evaluateCallable(Boolean(sup), contactRes.data);
}

/** Bulk variant for campaign batches: returns the set of suppressed numbers. */
export async function suppressedNumbers(db: DB, phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const { data, error } = await db.from('suppression_list').select('phone_e164').in('phone_e164', phones);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.phone_e164));
}
