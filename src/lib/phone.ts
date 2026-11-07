// Phone number normalisation to E.164. Default country: India (+91).
// Pure module (no imports) so it can be unit-tested with `node --test`.

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(raw: string | null | undefined): PhoneResult {
  if (raw === null || raw === undefined) return { ok: false, error: 'Phone number is required' };
  let s = String(raw).trim();
  if (!s) return { ok: false, error: 'Phone number is required' };

  // Spreadsheet artefacts like 9.1987654321E+11 cannot be recovered reliably.
  if (/e\+?\d+$/i.test(s)) return { ok: false, error: 'Number is in scientific notation (format the column as text)' };

  // Remove common separators and a trailing extension marker.
  s = s.replace(/[\s\-(). ]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (!/^\d+$/.test(digits)) return { ok: false, error: 'Contains invalid characters' };
    if (digits.startsWith('91')) return validateIndian(digits.slice(2));
    const e164 = '+' + digits;
    return E164.test(e164) ? { ok: true, e164 } : { ok: false, error: 'Not a valid international number' };
  }

  if (!/^\d+$/.test(s)) return { ok: false, error: 'Contains invalid characters' };
  if (s.length === 10) return validateIndian(s);
  if (s.length === 11 && s.startsWith('0')) return validateIndian(s.slice(1));
  if (s.length === 12 && s.startsWith('91')) return validateIndian(s.slice(2));
  return { ok: false, error: 'Expected a 10-digit Indian number or +country code' };
}

function validateIndian(national: string): PhoneResult {
  if (!/^\d{10}$/.test(national)) return { ok: false, error: 'Indian numbers must have 10 digits after +91' };
  if (national.startsWith('0')) return { ok: false, error: 'Indian numbers cannot start with 0 after +91' };
  return { ok: true, e164: '+91' + national };
}

export function isE164(value: string): boolean {
  return E164.test(value);
}

/** Human-friendly display: +91 98765 43210 for Indian numbers, otherwise unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
