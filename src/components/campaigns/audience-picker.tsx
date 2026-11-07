'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CONSENT_LABELS, CONSENT_STATUSES, DND_LABELS, DND_STATUSES } from '@/lib/constants';
import { Field, Input, Select } from '@/components/ui/form';
import { Notice } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { CsvImporter, type ImportSelection } from '@/components/contacts/csv-importer';
import { previewFilterAudience, type CampaignAudience } from '@/app/(app)/campaigns/actions';

type Tab = 'csv' | 'filter' | 'none';

/** Lets the user choose campaign contacts via CSV upload, a filter over existing contacts, or none yet. */
export function AudiencePicker({
  facets,
  onChange,
  allowNone = true,
}: {
  facets: { cities: string[]; categories: string[] };
  onChange: (a: CampaignAudience | null, summary: string) => void;
  allowNone?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('csv');
  const [csv, setCsv] = useState<ImportSelection | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [count, setCount] = useState<{ count: number; capped: boolean } | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (tab === 'none') onChange({ type: 'none' }, 'No contacts yet');
    else if (tab === 'csv') onChange(csv ? { type: 'csv', rows: csv.rows, existing: csv.existing } : null, csv ? `${csv.rows.length} contacts from CSV` : '');
    else onChange(count && count.count > 0 ? { type: 'filter', filters } : null, count ? `${count.count} existing contacts` : '');
  }, [tab, csv, count, filters, onChange]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'csv', label: 'Upload CSV' },
    { id: 'filter', label: 'Existing contacts' },
    ...(allowNone ? [{ id: 'none' as Tab, label: 'Add later' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-canvas p-1 text-sm" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'csv' &&
        (csv ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900" data-testid="csv-ready">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4" /> {csv.rows.length} valid contacts ready ({csv.existingCount} already in CRM, {csv.existing === 'update' ? 'will be updated' : 'kept unchanged'}).
            </span>
            <Button variant="ghost" size="sm" onClick={() => setCsv(null)}>
              Change file
            </Button>
          </div>
        ) : (
          <CsvImporter confirmLabel="Use these contacts" onConfirm={setCsv} defaultSource="campaign_csv" />
        ))}

      {tab === 'filter' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Search" htmlFor="af_q">
              <Input id="af_q" value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Name, business…" />
            </Field>
            <Field label="City" htmlFor="af_city">
              <Select id="af_city" value={filters.city ?? ''} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
                <option value="">All cities</option>
                {facets.cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Category" htmlFor="af_cat">
              <Select id="af_cat" value={filters.category ?? ''} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                <option value="">All categories</option>
                {facets.categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Consent" htmlFor="af_consent">
              <Select id="af_consent" value={filters.consent ?? ''} onChange={(e) => setFilters({ ...filters, consent: e.target.value })}>
                <option value="">Any</option>
                {CONSENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONSENT_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="DND" htmlFor="af_dnd">
              <Select id="af_dnd" value={filters.dnd ?? ''} onChange={(e) => setFilters({ ...filters, dnd: e.target.value })}>
                <option value="">Any</option>
                {DND_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DND_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              pending={counting}
              onClick={async () => {
                setCounting(true);
                try {
                  setCount(await previewFilterAudience({ ...filters, suppressed: 'no' }));
                } finally {
                  setCounting(false);
                }
              }}
              data-testid="filter-preview"
            >
              Find matching contacts
            </Button>
            {count && (
              <span className="text-sm" data-testid="filter-count">
                <strong>{count.count}</strong> matching contact{count.count === 1 ? '' : 's'}
                {count.capped && ' (capped at 5,000)'}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-3">Suppressed numbers are excluded. Contacts on DND without consent are skipped automatically when the campaign runs.</p>
        </div>
      )}

      {tab === 'none' && <Notice tone="info">The campaign is created as a draft. Add contacts from the campaign page before starting it.</Notice>}
    </div>
  );
}
