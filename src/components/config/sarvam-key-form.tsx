'use client';
import { useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { saveSarvamApiKey } from '@/app/(app)/integrations/actions';

/** Admin form: paste the Sarvam API key once to switch on call recordings. Stored encrypted on the server. */
export function SarvamKeyForm({ replace = false }: { replace?: boolean }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await saveSarvamApiKey(null, fd);
      if (res.ok) {
        push('success', res.message);
        form.reset();
        router.refresh();
      } else push('error', res.error);
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-2" data-testid="sarvam-key-form" autoComplete="off">
      <Field label={replace ? 'Replace Sarvam API key' : 'Sarvam API key'} htmlFor="sarvam_api_key" hint="Sarvam dashboard → API keys. Starts with sk_. Stored encrypted; never shown again.">
        <Input id="sarvam_api_key" name="sarvam_api_key" type="password" required maxLength={200} placeholder="sk_samvaad_…" autoComplete="new-password" spellCheck={false} />
      </Field>
      <Button type="submit" size="sm" variant={replace ? 'secondary' : 'primary'} pending={pending} data-testid="sarvam-key-save">
        {replace ? 'Save new key' : 'Switch on recordings'}
      </Button>
    </form>
  );
}
