import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { ErrorNotice } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Sign in' };

async function LoginForm({ searchParams }: { searchParams: PageProps<'/login'>['searchParams'] }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  const err = typeof sp.error === 'string' ? sp.error : undefined;
  const message =
    err === 'oauth'
      ? `Sign-in failed: ${typeof sp.message === 'string' ? sp.message : 'unknown error'}`
      : err === 'confirmation_failed'
        ? 'That sign-in link is invalid or has expired.'
        : null;
  return (
    <>
      {message && <ErrorNotice title="Sign-in problem" message={message} className="mb-4" />}
      <AuthForm mode="login" next={next} />
    </>
  );
}

export default function LoginPage(props: PageProps<'/login'>) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">Access the FlashQC Digi call operations workspace.</p>
      <Suspense>
        <LoginForm searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
