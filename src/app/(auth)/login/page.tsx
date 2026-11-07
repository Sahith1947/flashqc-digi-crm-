import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

async function LoginForm({ searchParams }: { searchParams: PageProps<'/login'>['searchParams'] }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  return <AuthForm mode="login" next={next} />;
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
