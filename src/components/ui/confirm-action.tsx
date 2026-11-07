'use client';
import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { Button } from './button';
import { Modal } from './modal';
import { useToast } from './toast';

/** Button → confirmation dialog → server action → toast with the confirmed result. */
export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
  size = 'sm',
  icon,
  disabled,
  testId,
}: {
  action: () => Promise<ActionResult<unknown>>;
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: 'danger' | 'secondary' | 'primary' | 'dark';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)} disabled={disabled} data-testid={testId}>
        {label}
      </Button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={title}>
        <div className="space-y-4">
          <div className="text-sm text-ink-2">{description}</div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              pending={pending}
              data-testid={testId ? `${testId}-confirm` : undefined}
              onClick={() =>
                start(async () => {
                  const res = await action();
                  if (!res) return; // redirected
                  if (res.ok) {
                    push('success', res.message);
                    setOpen(false);
                    router.refresh();
                  } else push('error', res.error);
                })
              }
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
