'use client';
import { useMemo, useRef, useState } from 'react';
import { FileUp, RotateCcw } from 'lucide-react';
import { buildImportPreview, CONTACT_FIELDS, type ContactInput, type ImportPreview } from '@/lib/contact-import';
import { formatPhone } from '@/lib/phone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Notice } from '@/components/ui/states';
import { Table, TableWrap, Td, Th } from '@/components/ui/table';
import { checkExistingPhones } from '@/app/(app)/contacts/actions';

const FIELD_LABELS: Record<(typeof CONTACT_FIELDS)[number], string> = {
  full_name: 'Name',
  phone: 'Phone',
  business_name: 'Business',
  business_category: 'Category',
  city: 'City',
  source: 'Source',
  consent_status: 'Consent',
  dnd_status: 'DND',
  notes: 'Notes',
};

export interface ImportSelection {
  rows: ContactInput[];
  existing: 'skip' | 'update';
  existingCount: number;
}

/**
 * CSV upload → parse → validate → duplicate detection (in file + against the
 * database) → preview. Calls onConfirm with the valid, de-duplicated rows.
 * Every row is validated again on the server before it is written.
 */
export function CsvImporter({
  onConfirm,
  confirmLabel,
  pending,
  allowUpdate = true,
  defaultSource = 'csv_import',
}: {
  onConfirm: (sel: ImportSelection) => void;
  confirmLabel: string;
  pending?: boolean;
  allowUpdate?: boolean;
  defaultSource?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const [readError, setReadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setReadError(null);
    if (f.size > 5 * 1024 * 1024) return setReadError('File is larger than 5 MB.');
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setReadError('Please choose a .csv file.');
    setFileName(f.name);
    const p = buildImportPreview(await f.text(), defaultSource);
    setPreview(p);
    setExisting(new Set());
    if (!p.fatal) {
      setChecking(true);
      try {
        const phones = p.rows.filter((r) => r.status === 'valid').map((r) => r.contact!.phone_e164);
        setExisting(new Set(await checkExistingPhones(phones)));
      } catch {
        setReadError('Could not check for existing contacts. Please try again.');
      } finally {
        setChecking(false);
      }
    }
  }

  const valid = useMemo(() => (preview?.rows ?? []).filter((r) => r.status === 'valid'), [preview]);
  const existingCount = valid.filter((r) => existing.has(r.contact!.phone_e164)).length;
  const newCount = valid.length - existingCount;
  const shown = (preview?.rows ?? []).filter((r) => filter === 'all' || r.status !== 'valid' || existing.has(r.contact!.phone_e164)).slice(0, 300);

  function reset() {
    setPreview(null);
    setFileName(null);
    setExisting(new Set());
    if (inputRef.current) inputRef.current.value = '';
  }

  if (!preview) {
    return (
      <div className="space-y-3">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-canvas/50 px-6 py-10 text-center hover:border-brand-400 hover:bg-brand-50/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
        >
          <FileUp className="size-6 text-ink-3" />
          <span className="text-sm font-medium">Choose a CSV file or drag it here</span>
          <span className="text-xs text-ink-3">Required column: phone. Optional: name, business, category, city, source, consent, dnd, notes. Max 5,000 rows.</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            data-testid="csv-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
        {readError && <ErrorNotice title="Could not read file" message={readError} />}
        <a href="/api/export/contacts?template=1" className="inline-block text-xs font-medium text-brand-700 hover:underline" download>
          Download CSV template
        </a>
      </div>
    );
  }

  if (preview.fatal) {
    return (
      <div className="space-y-3">
        <ErrorNotice title={`Cannot import ${fileName}`} message={preview.fatal} />
        <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={reset}>
          Choose another file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="csv-preview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{fileName}</span> · {preview.counts.total} rows
        </p>
        <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
          Choose another file
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="csv-counts">
        <Count label="New contacts" value={checking ? '…' : newCount} tone="good" />
        <Count label="Already exist" value={checking ? '…' : existingCount} tone="info" />
        <Count label="Duplicates in file" value={preview.counts.duplicates} tone="warning" />
        <Count label="Invalid rows" value={preview.counts.invalid} tone="critical" />
      </div>
      <p className="text-xs text-ink-3">
        Columns detected:{' '}
        {CONTACT_FIELDS.filter((f) => preview.mapping[f])
          .map((f) => `${FIELD_LABELS[f]} ← "${preview.mapping[f]}"`)
          .join(', ')}
      </p>
      {existingCount > 0 && allowUpdate && (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Existing contacts</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing_mode" checked={mode === 'skip'} onChange={() => setMode('skip')} className="accent-brand-500" />
            Keep existing contacts unchanged
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="existing_mode" checked={mode === 'update'} onChange={() => setMode('update')} className="accent-brand-500" />
            Update existing contacts with file values
          </label>
        </fieldset>
      )}
      <div className="flex gap-2 text-xs">
        {(['all', 'issues'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 font-medium ${filter === f ? 'bg-ink text-white' : 'bg-canvas text-ink-2'}`}>
            {f === 'all' ? 'All rows' : 'Issues & existing'}
          </button>
        ))}
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <TableWrap>
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Status</Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Business</Th>
                <Th>City</Th>
                <Th>Issue</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isExisting = r.status === 'valid' && existing.has(r.contact!.phone_e164);
                return (
                  <tr key={r.line}>
                    <Td className="tabular text-ink-3">{r.line}</Td>
                    <Td>
                      {r.status === 'invalid' ? (
                        <Badge tone="critical">Invalid</Badge>
                      ) : r.status === 'duplicate_in_file' ? (
                        <Badge tone="warning">Duplicate</Badge>
                      ) : isExisting ? (
                        <Badge tone="info">Exists</Badge>
                      ) : (
                        <Badge tone="good">New</Badge>
                      )}
                    </Td>
                    <Td>{r.contact?.full_name ?? r.raw[preview.mapping.full_name ?? ''] ?? '—'}</Td>
                    <Td className="tabular">{r.contact ? formatPhone(r.contact.phone_e164) : r.raw[preview.mapping.phone ?? ''] || '—'}</Td>
                    <Td>{r.contact?.business_name ?? '—'}</Td>
                    <Td>{r.contact?.city ?? '—'}</Td>
                    <Td className="text-xs text-red-700">{r.errors.join('; ')}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </div>
      {preview.rows.length > 300 && <p className="text-xs text-ink-3">Showing the first 300 rows of the preview.</p>}
      {valid.length === 0 ? (
        <Notice tone="warning">There are no valid rows to import.</Notice>
      ) : (
        <Button
          pending={pending}
          disabled={checking}
          data-testid="csv-confirm"
          onClick={() => onConfirm({ rows: valid.map((r) => r.contact!), existing: mode, existingCount })}
        >
          {confirmLabel} ({valid.length})
        </Button>
      )}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number | string; tone: 'good' | 'info' | 'warning' | 'critical' }) {
  const dot = { good: 'bg-status-good', info: 'bg-series-inbound', warning: 'bg-status-warning', critical: 'bg-status-critical' }[tone];
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        {label}
      </p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
