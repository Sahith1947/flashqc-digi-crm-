'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteCalls } from '@/app/(app)/calls/actions';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';

import { BULK_FORM_ID } from './bulk-form-id';
const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${BULK_FORM_ID}"][name=ids]`));

/** Header checkbox: selects every call on this page. */
export function SelectAllCalls() {
  const [state, setState] = useState<'none' | 'some' | 'all'>('none');
  useEffect(() => {
    const sync = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      setState(n === 0 ? 'none' : n === all.length ? 'all' : 'some');
    };
    document.addEventListener('change', sync);
    sync();
    return () => document.removeEventListener('change', sync);
  }, []);
  return (
    <input
      type="checkbox"
      aria-label="Select all calls on this page"
      data-testid="select-all-calls"
      className="size-4 accent-brand-600"
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      onChange={(e) => {
        for (const b of boxes()) b.checked = e.target.checked;
        document.dispatchEvent(new Event('change'));
      }}
    />
  );
}

/** Toolbar shown above Call Logs for admins: delete the selected calls. */
export function BulkCallActions() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  useEffect(() => {
    const sync = () => setCount(boxes().filter((b) => b.checked).length);
    document.addEventListener('change', sync);
    sync();
    return () => document.removeEventListener('change', sync);
  }, []);
  return (
    <form id={BULK_FORM_ID} onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm" data-testid="bulk-call-actions">
      <span className="text-ink-2">{count ? `${count} selected` : 'Tick calls to delete them'}</span>
      <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} disabled={!count} onClick={() => setOpen(true)} data-testid="bulk-delete-calls">
        Delete selected
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={`Delete ${count} call${count === 1 ? '' : 's'}?`}>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            The selected calls, with their events, recordings, transcripts and summaries, will be permanently deleted. The remaining Call IDs are
            renumbered (CL-000001, CL-000002 …) so there are no gaps. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              pending={pending}
              data-testid="bulk-delete-calls-confirm"
              onClick={() =>
                start(async () => {
                  const ids = boxes().filter((b) => b.checked).map((b) => b.value);
                  const res = await deleteCalls(ids);
                  if (res.ok) {
                    push('success', res.message);
                    setOpen(false);
                    for (const b of boxes()) b.checked = false;
                    setCount(0);
                    router.refresh();
                  } else push('error', res.error);
                })
              }
            >
              Delete permanently
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
