import 'server-only';
import type { DB } from '@/lib/supabase/types';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import type { ContactInput } from '@/lib/contact-import';
import { MAX_IMPORT_ROWS } from '@/lib/contact-import';
import { isE164 } from '@/lib/phone';
import { CONSENT_STATUSES, DND_STATUSES } from '@/lib/constants';
import { AppError } from '@/server/providers/types';

const CHUNK = 500;

function sanitize(c: ContactInput): ContactInput {
  const clip = (v: string | null | undefined, n: number) => {
    const s = (v ?? '').toString().trim();
    return s ? s.slice(0, n) : null;
  };
  if (!isE164(c.phone_e164)) throw new AppError(`Invalid phone number ${c.phone_e164}`);
  return {
    full_name: clip(c.full_name, 200),
    phone_e164: c.phone_e164,
    business_name: clip(c.business_name, 200),
    business_category: clip(c.business_category, 120),
    city: clip(c.city, 120),
    source: clip(c.source, 60) ?? 'csv_import',
    consent_status: (CONSENT_STATUSES as readonly string[]).includes(c.consent_status) ? c.consent_status : 'unknown',
    dnd_status: (DND_STATUSES as readonly string[]).includes(c.dnd_status) ? c.dnd_status : 'unknown',
    notes: clip(c.notes, 5000),
  };
}

export const ContactService = {
  async findExistingPhones(db: DB, phones: string[]): Promise<Set<string>> {
    const valid = [...new Set(phones.filter(isE164))];
    const found = new Set<string>();
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { data, error } = await db.from('contacts').select('phone_e164').in('phone_e164', valid.slice(i, i + CHUNK));
      if (error) throw error;
      data?.forEach((r) => found.add(r.phone_e164));
    }
    return found;
  },

  /**
   * Imports contacts without creating duplicates (phone_e164 is unique).
   * existing = 'skip' leaves current records untouched; 'update' overwrites
   * the imported fields (empty cells never blank out existing data).
   * Returns ids for every phone in the input (new and existing) in input order.
   */
  async importContacts(db: DB, rows: ContactInput[], existing: 'skip' | 'update') {
    if (rows.length > MAX_IMPORT_ROWS) throw new AppError(`Maximum ${MAX_IMPORT_ROWS} rows per import`);
    // Server-side re-validation and in-request dedupe (first occurrence wins).
    const byPhone = new Map<string, ContactInput>();
    for (const r of rows) {
      const s = sanitize(r);
      if (!byPhone.has(s.phone_e164)) byPhone.set(s.phone_e164, s);
    }
    const all = [...byPhone.values()];
    const existingPhones = await this.findExistingPhones(db, all.map((r) => r.phone_e164));
    const toInsert = all.filter((r) => !existingPhones.has(r.phone_e164));
    const toUpdate = existing === 'update' ? all.filter((r) => existingPhones.has(r.phone_e164)) : [];

    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const { data, error } = await db
        .from('contacts')
        .upsert(toInsert.slice(i, i + CHUNK), { onConflict: 'phone_e164', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      inserted += data?.length ?? 0;
    }

    let updated = 0;
    for (const r of toUpdate) {
      const patch: TablesUpdate<'contacts'> = Object.fromEntries(
        Object.entries(r).filter(([k, v]) => k !== 'phone_e164' && v !== null && !(k === 'consent_status' && v === 'unknown') && !(k === 'dnd_status' && v === 'unknown')),
      );
      if (Object.keys(patch).length === 0) continue;
      const { error } = await db.from('contacts').update(patch).eq('phone_e164', r.phone_e164);
      if (error) throw error;
      updated++;
    }

    const ids: string[] = [];
    const phones = all.map((r) => r.phone_e164);
    for (let i = 0; i < phones.length; i += CHUNK) {
      const { data, error } = await db.from('contacts').select('id').in('phone_e164', phones.slice(i, i + CHUNK));
      if (error) throw error;
      data?.forEach((r) => ids.push(r.id));
    }

    return {
      inserted,
      updated,
      skipped: existingPhones.size - updated,
      ids,
    };
  },
};
