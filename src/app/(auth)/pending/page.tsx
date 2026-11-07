import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';
import { getSession } from '@/server/auth';
import { signOut } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Awaiting approval' };

async function PendingContent() {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.profile?.is_active) redirect('/');
  return (
    <div className="space-y-4" data-testid="pending-approval">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Clock className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Awaiting approval</h1>
      <p className="text-sm text-ink-2">
        Your account <span className="font-medium text-ink">{s.email}</span> has been created. An admin needs to activate it and assign a role before you
        can access CRM data.
      </p>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  );
}

export default function PendingPage() {
  return (
    <Suspense>
      <PendingContent />
    </Suspense>
  );
}
