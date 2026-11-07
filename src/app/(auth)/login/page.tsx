import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { GoogleButton, OrDivider } from '@/components/auth/google-button';
import { ErrorNotice } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Sign in' };

async function LoginForm({ searchParams }: { searchParams: PageProps<'/login'>['searchParams'] }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  const err = typeof sp.error === 'string' ? sp.error : undefined;
  const message =
    err === 'google_disabled'
      ? 'Google sign-in is not switched on yet. An admin needs to enable the Google provider in Supabase (see docs/GOOGLE_LOGIN.md).'
      : err === 'google_failed'
        ? 'Could not start Google sign-in. Please try again.'
        : err === 'oauth'
          ? `Google sign-in failed: ${typeof sp.message === 'string' ? sp.message : 'unknown error'}`
          : err === 'confirmation_failed'
            ? 'That sign-in link is invalid or has expired.'
            : null;
  return (
    <>
      {message && <ErrorNotice title="Sign-in problem" message={message} className="mb-4" />}
      <GoogleButton next={next} />
      <OrDivider />
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
