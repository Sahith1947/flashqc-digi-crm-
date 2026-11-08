'use client';
import { useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { connectVobiz } from '@/app/(app)/integrations/actions';

/** Admin form: paste the Vobiz Auth ID and Auth Token once. They are checked with Vobiz and stored encrypted on the server. */
export function VobizConnectForm() {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await connectVobiz(null, fd);
      if (res.ok) {
        push('success', res.message); // shown before the card switches to its connected view
        form.reset();
        router.refresh();
      } else push('error', res.error);
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="vobiz-connect-form" autoComplete="off">
      <Field label="Vobiz Auth ID" htmlFor="vobiz_auth_id">
        <Input id="vobiz_auth_id" name="vobiz_auth_id" required maxLength={64} placeholder="e.g. MA_XXXXXXXX" autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Vobiz Auth Token" htmlFor="vobiz_auth_token" hint="Stored encrypted on the server. It is never shown again.">
        <Input id="vobiz_auth_token" name="vobiz_auth_token" type="password" required maxLength={200} autoComplete="new-password" spellCheck={false} />
      </Field>
      <Button type="submit" size="sm" pending={pending} data-testid="vobiz-connect">
        Connect Vobiz
      </Button>
    </form>
  );
}
