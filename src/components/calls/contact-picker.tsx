'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { formatPhone } from '@/lib/phone';
import { searchContacts } from '@/app/(app)/outbound/actions';

type Hit = Awaited<ReturnType<typeof searchContacts>>[number];

/** Phone input with contact search. Typing a name/business suggests contacts; a raw number is also accepted. */
export function ContactPicker({ defaultPhone = '', error }: { defaultPhone?: string; error?: string }) {
  const [value, setValue] = useState(defaultPhone);
  const [contactId, setContactId] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Hit | null>(null);
  const listId = useId();
  const seq = useRef(0);

  const searching = !selected && value.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const res = await searchContacts(value);
      if (n === seq.current) {
        setHits(res);
        setOpen(true);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value, searching]);
  const visibleHits = searching ? hits : [];

  return (
    <div className="relative">
      <input type="hidden" name="contact_id" value={contactId} />
      <input type="hidden" name="phone" value={selected ? selected.phone_e164 : value} />
      <input
        id="phone"
        role="combobox"
        aria-expanded={open && visibleHits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={Boolean(error)}
        autoComplete="off"
        value={selected ? `${selected.full_name || 'Unnamed'} · ${formatPhone(selected.phone_e164)}` : value}
        onChange={(e) => {
          setSelected(null);
          setContactId('');
          setValue(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => visibleHits.length > 0 && setOpen(true)}
        placeholder="Search contact or type a number, e.g. 98765 43210"
        className="block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm placeholder:text-ink-3 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none aria-[invalid=true]:border-red-500"
      />
      {open && visibleHits.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
          {visibleHits.map((h) => (
            <li key={h.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-canvas"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(h);
                  setContactId(h.id);
                  setOpen(false);
                }}
              >
                <span className="text-sm font-medium">{h.full_name || 'Unnamed contact'}</span>
                <span className="text-xs text-ink-3">
                  {formatPhone(h.phone_e164)}
                  {h.business_name && ` · ${h.business_name}`}
                  {h.dnd_status === 'registered' && ' · On DND'}
                  {h.consent_status === 'revoked' && ' · Consent revoked'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
