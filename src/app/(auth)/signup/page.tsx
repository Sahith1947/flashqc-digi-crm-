import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { GoogleButton, OrDivider } from '@/components/auth/google-button';

export const metadata: Metadata = { title: 'Request access' };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Request access</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">New accounts stay inactive until an admin approves them and assigns a role.</p>
      <GoogleButton />
      <OrDivider />
      <AuthForm mode="signup" />
    </>
  );
}
