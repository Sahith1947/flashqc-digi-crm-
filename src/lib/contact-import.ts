// CSV → contact rows: header mapping, validation and duplicate detection.
// Pure (imports only other pure modules) so it runs both in the browser preview
// and on the server, where every row is re-validated before writing.
import { parseCsvWithHeader } from './csv.ts';
import { normalizePhone } from './phone.ts';

export const CONTACT_FIELDS = [
  'full_name',
  'phone',
  'business_name',
  'business_category',
  'city',
  'source',
  'consent_status',
  'dnd_status',
  'notes',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

const HEADER_ALIASES: Record<ContactField, string[]> = {
  full_name: ['name', 'full name', 'fullname', 'contact name', 'contact', 'customer name', 'person'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'number', 'contact number', 'phone_e164', 'msisdn', 'whatsapp'],
  business_name: ['business', 'business name', 'company', 'company name', 'organisation', 'organization', 'shop', 'firm'],
  business_category: ['category', 'business category', 'industry', 'segment', 'type'],
  city: ['city', 'town', 'location', 'district'],
  source: ['source', 'lead source', 'channel'],
  consent_status: ['consent', 'consent status', 'consent_status', 'opt in', 'optin'],
  dnd_status: ['dnd', 'dnd status', 'dnd_status', 'ndnc', 'ncpr'],
  notes: ['notes', 'note', 'remarks', 'comments', 'comment'],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

export function mapHeaders(headers: string[]): Partial<Record<ContactField, string>> {
  const mapping: Partial<Record<ContactField, string>> = {};
  for (const field of CONTACT_FIELDS) {
    const aliases = [norm(field), ...HEADER_ALIASES[field].map(norm)];
    const found = headers.find((h) => aliases.includes(norm(h)));
    if (found) mapping[field] = found;
  }
  return mapping;
}

export interface ContactInput {
  full_name: string | null;
  phone_e164: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  source: string;
  consent_status: 'unknown' | 'granted' | 'revoked';
  dnd_status: 'unknown' | 'not_registered' | 'registered';
  notes: string | null;
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate_in_file';

export interface PreviewRow {
  line: number; // 1-based line number in the CSV (header = line 1)
  raw: Record<string, string>;
  status: RowStatus;
  errors: string[];
  contact: ContactInput | null;
  /** set later by the caller after checking the database */
  existing?: boolean;
}

function parseConsent(v: string): ContactInput['consent_status'] | null {
  const s = norm(v);
  if (!s || s === 'unknown') return 'unknown';
  if (['yes', 'y', 'true', '1', 'granted', 'opted in', 'opt in', 'given'].includes(s)) return 'granted';
  if (['no', 'n', 'false', '0', 'revoked', 'opted out', 'opt out', 'denied', 'withdrawn'].includes(s)) return 'revoked';
  return null;
}

function parseDnd(v: string): ContactInput['dnd_status'] | null {
  const s = norm(v);
  if (!s || s === 'unknown') return 'unknown';
  if (['yes', 'y', 'true', '1', 'registered', 'dnd', 'on'].includes(s)) return 'registered';
  if (['no', 'n', 'false', '0', 'not registered', 'off', 'clear'].includes(s)) return 'not_registered';
  return null;
}

const clip = (v: string | undefined, max: number): string | null => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export function validateContactRecord(
  rec: Record<string, string>,
  mapping: Partial<Record<ContactField, string>>,
  defaultSource: string,
): { contact: ContactInput | null; errors: string[] } {
  const get = (f: ContactField) => (mapping[f] ? (rec[mapping[f]!] ?? '') : '');
  const errors: string[] = [];

  const phone = normalizePhone(get('phone'));
  if (!phone.ok) errors.push(`Phone: ${phone.error}`);

  const consent = parseConsent(get('consent_status'));
  if (consent === null) errors.push(`Consent: unrecognised value "${get('consent_status')}"`);
  const dnd = parseDnd(get('dnd_status'));
  if (dnd === null) errors.push(`DND: unrecognised value "${get('dnd_status')}"`);

  if (errors.length || !phone.ok || consent === null || dnd === null) return { contact: null, errors };

  return {
    errors,
    contact: {
      full_name: clip(get('full_name'), 200),
      phone_e164: phone.e164,
      business_name: clip(get('business_name'), 200),
      business_category: clip(get('business_category'), 120),
      city: clip(get('city'), 120),
      source: clip(get('source'), 60) ?? defaultSource,
      consent_status: consent,
      dnd_status: dnd,
      notes: clip(get('notes'), 5000),
    },
  };
}

export const MAX_IMPORT_ROWS = 5000;

export interface ImportPreview {
  headers: string[];
  mapping: Partial<Record<ContactField, string>>;
  rows: PreviewRow[];
  fatal: string | null;
  counts: { total: number; valid: number; invalid: number; duplicates: number };
}

export function buildImportPreview(csvText: string, defaultSource = 'csv_import'): ImportPreview {
  const { headers, records } = parseCsvWithHeader(csvText);
  const mapping = mapHeaders(headers);
  const empty = { total: 0, valid: 0, invalid: 0, duplicates: 0 };
  if (headers.length === 0) return { headers, mapping, rows: [], fatal: 'The file is empty.', counts: empty };
  if (!mapping.phone) {
    return {
      headers,
      mapping,
      rows: [],
      fatal: 'No phone column found. Add a column named "phone" (or "mobile", "phone number").',
      counts: empty,
    };
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return { headers, mapping, rows: [], fatal: `Too many rows (${records.length}). Maximum is ${MAX_IMPORT_ROWS} per import.`, counts: empty };
  }

  const seen = new Map<string, number>();
  const rows: PreviewRow[] = records.map((raw, idx) => {
    const line = idx + 2;
    const { contact, errors } = validateContactRecord(raw, mapping, defaultSource);
    if (!contact) return { line, raw, status: 'invalid', errors, contact: null };
    const firstLine = seen.get(contact.phone_e164);
    if (firstLine !== undefined) {
      return { line, raw, status: 'duplicate_in_file', errors: [`Duplicate of line ${firstLine}`], contact };
    }
    seen.set(contact.phone_e164, line);
    return { line, raw, status: 'valid', errors: [], contact };
  });

  return {
    headers,
    mapping,
    rows,
    fatal: rows.length === 0 ? 'The file has a header row but no data rows.' : null,
    counts: {
      total: rows.length,
      valid: rows.filter((r) => r.status === 'valid').length,
      invalid: rows.filter((r) => r.status === 'invalid').length,
      duplicates: rows.filter((r) => r.status === 'duplicate_in_file').length,
    },
  };
}
