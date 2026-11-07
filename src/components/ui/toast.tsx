'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, OctagonAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            data-testid={`toast-${t.kind}`}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' ? 'border-green-200' : 'border-red-200',
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" aria-hidden />
            ) : (
              <OctagonAlert className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden />
            )}
            <p className="flex-1 text-ink">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/** Shows a toast whenever a server-action result changes. Success toasts only follow confirmed results. */
export function useActionToast(state: { ok: boolean; message?: string; error?: string } | null) {
  const { push } = useToast();
  const last = useRef<typeof state>(null);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok && state.message) push('success', state.message);
    if (!state.ok && state.error) push('error', state.error);
  }, [state, push]);
}

/** Runs `cb` exactly once for each successful action result. */
export function useOnSuccess<T extends { ok: boolean } | null>(state: T, cb: (s: NonNullable<T>) => void) {
  const handled = useRef<T | null>(null);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => {
    if (state && state.ok && handled.current !== state) {
      handled.current = state;
      cbRef.current(state as NonNullable<T>);
    }
  }, [state]);
}
