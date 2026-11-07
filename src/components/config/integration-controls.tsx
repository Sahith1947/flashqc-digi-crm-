'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { useActionToast, useToast } from '@/components/ui/toast';
import { checkIntegration, saveIntegrationConfig } from '@/app/(app)/integrations/actions';

export function CheckButton({ integrationKey }: { integrationKey: string }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Activity className="size-3.5" />}
      pending={pending}
      data-testid={`check-${integrationKey}`}
      onClick={() =>
        start(async () => {
          const res = await checkIntegration(integrationKey);
          push(res.ok ? 'success' : 'error', res.ok ? res.message : res.error);
          router.refresh();
        })
      }
    >
      Check connection
    </Button>
  );
}

export function IntegrationNotesForm({ integrationKey, provider, notes }: { integrationKey: string; provider: string | null; notes: string }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(saveIntegrationConfig.bind(null, integrationKey) as (p: ActionResult | null, fd: FormData) => Promise<ActionResult>);
  useActionToast(state);
  return (
    <form onSubmit={action} className="space-y-3">
      <Field label="Provider" htmlFor={`prov-${integrationKey}`}>
        <Input id={`prov-${integrationKey}`} name="provider" defaultValue={provider ?? ''} maxLength={60} placeholder="e.g. sarvam, exotel" />
      </Field>
      <Field label="Setup notes (non-secret)" htmlFor={`notes-${integrationKey}`} hint="Account IDs, regions, contacts. Never paste API keys here.">
        <Textarea id={`notes-${integrationKey}`} name="notes" rows={2} defaultValue={notes} maxLength={2000} />
      </Field>
      <Button type="submit" size="sm" variant="dark" pending={pending}>
        Save notes
      </Button>
    </form>
  );
}
