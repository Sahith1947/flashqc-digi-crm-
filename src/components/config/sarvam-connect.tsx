'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Link2, RefreshCw, Unplug } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { useToast } from '@/components/ui/toast';
import { cancelSarvamConnect, disconnectSarvam, pollSarvamConnect, startSarvamConnect } from '@/app/(app)/integrations/actions';

/** Runs a server action and toasts its confirmed result. */
export function ActionButton({ action, label, testId, variant = 'secondary', icon, disabled }: { action: () => Promise<ActionResult<unknown>>; label: string; testId?: string; variant?: 'secondary' | 'primary' | 'dark'; icon?: React.ReactNode; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size="sm"
      icon={icon ?? <RefreshCw className="size-3.5" />}
      pending={pending}
      disabled={disabled}
      data-testid={testId}
      onClick={() =>
        start(async () => {
          const res = await action();
          if (res.ok) push('success', res.message);
          else push('error', res.error);
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}

export function SarvamConnect({
  connected,
  accountEmail,
  connectedAt,
  pending: initialPending,
  isAdmin,
}: {
  connected: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  pending: { userCode: string; verifyUrl: string } | null;
  isAdmin: boolean;
}) {
  const [flow, setFlow] = useState(initialPending);
  const [starting, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await pollSarvamConnect();
      if (!res.ok) {
        push('error', res.error);
        setFlow(null);
      } else if (res.data?.state === 'connected') {
        push('success', 'Sarvam connected.');
        setFlow(null);
        router.refresh();
      } else if (res.data?.state === 'none') setFlow(null);
    } finally {
      busy.current = false;
    }
  }, [push, router]);

  useEffect(() => {
    if (!flow) return;
    const t = setInterval(() => void poll(), 3000);
    return () => clearInterval(t);
  }, [flow, poll]);

  if (connected) {
    return (
      <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm" data-testid="sarvam-connected">
        <p className="text-green-900">
          Signed in as <strong>{accountEmail ?? 'your Sarvam account'}</strong>
          {connectedAt && <span className="text-green-800"> · since {new Date(connectedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>}
        </p>
        {isAdmin && (
          <ConfirmAction
            action={disconnectSarvam}
            label="Disconnect"
            icon={<Unplug className="size-3.5" />}
            title="Disconnect Sarvam?"
            description="Stored Sarvam tokens are deleted. Synced agents stay in the CRM but show as not connected until you reconnect."
            confirmLabel="Disconnect"
            testId="sarvam-disconnect"
          />
        )}
      </div>
    );
  }

  if (!isAdmin) return <p className="text-sm text-ink-3">An admin can connect the Sarvam account.</p>;

  if (flow) {
    return (
      <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm" data-testid="sarvam-pending">
        <p className="font-medium">Approve this code in your Sarvam account:</p>
        <p className="font-mono text-2xl font-semibold tracking-widest" data-testid="sarvam-user-code">
          {flow.userCode}
        </p>
        <a href={flow.verifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand-800 underline">
          Open Sarvam to approve <ExternalLink className="size-3.5" />
        </a>
        <p className="flex items-center gap-2 text-xs text-ink-2">
          <RefreshCw className="size-3 animate-spin" /> Waiting for approval — this updates automatically.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await cancelSarvamConnect();
            setFlow(null);
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      icon={<Link2 className="size-4" />}
      pending={starting}
      data-testid="sarvam-connect"
      onClick={() =>
        start(async () => {
          const res = await startSarvamConnect();
          if (res.ok && res.data) {
            setFlow(res.data);
            window.open(res.data.verifyUrl, '_blank', 'noopener');
          } else if (!res.ok) push('error', res.error);
        })
      }
    >
      Connect Sarvam
    </Button>
  );
}
