'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CsvImporter } from './csv-importer';
import { Notice } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { importContacts } from '@/app/(app)/contacts/actions';

export function ContactImport() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const { push } = useToast();
  if (done) {
    return (
      <div className="space-y-3">
        <Notice tone="info">{done}</Notice>
        <div className="flex gap-3 text-sm">
          <Link href="/contacts" className="font-medium text-brand-700 hover:underline">
            View contacts
          </Link>
          <button type="button" className="font-medium text-ink-2 hover:text-ink" onClick={() => { setDone(null); setRound((r) => r + 1); }}>
            Import another file
          </button>
        </div>
      </div>
    );
  }
  return (
    <CsvImporter
      key={round}
      confirmLabel="Import contacts"
      pending={pending}
      onConfirm={(sel) =>
        start(async () => {
          const res = await importContacts(sel.rows, sel.existing);
          if (res.ok) {
            push('success', res.message);
            setDone(res.message);
          } else push('error', res.error);
        })
      }
    />
  );
}
