'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ErrorNotice, Notice } from '@/components/ui/states';
import type { ActionResult } from '@/lib/action-result';
import { signIn, signUp } from '@/app/(auth)/actions';

export function AuthForm({ mode, next }: { mode: 'login' | 'signup'; next?: string }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(mode === 'login' ? signIn : signUp);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={action} className="space-y-4" noValidate>
      {mode === 'login' && next && <input type="hidden" name="next" value={next} />}
      {state && !state.ok && !fe && <ErrorNotice title={mode === 'login' ? 'Sign in failed' : 'Sign up failed'} message={state.error} />}
      {state?.ok && <Notice tone="info">{state.message}</Notice>}
      {mode === 'signup' && (
        <Field label="Full name" htmlFor="full_name" error={fe?.full_name} required>
          <Input id="full_name" name="full_name" autoComplete="name" required aria-invalid={Boolean(fe?.full_name)} />
        </Field>
      )}
      <Field label="Work email" htmlFor="email" error={fe?.email} required>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(fe?.email)} />
      </Field>
      <Field label="Password" htmlFor="password" error={fe?.password} hint={mode === 'signup' ? 'At least 8 characters' : undefined} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          aria-invalid={Boolean(fe?.password)}
        />
      </Field>
      <Button type="submit" pending={pending} className="w-full" data-testid="auth-submit">
        {mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-ink-2">
        {mode === 'login' ? (
          <>
            New team member?{' '}
            <Link href="/signup" className="font-medium text-brand-700 hover:underline">
              Request access
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-brand-700 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
