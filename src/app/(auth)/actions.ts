'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/action-result';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === 'string' ? next : '';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

export async function signIn(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!parsed.success) {
    return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const db = await createClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: error.code === 'email_not_confirmed' ? 'Please confirm your email address first.' : 'Invalid email or password.' };
  }
  redirect(safeNext(fd.get('next')));
}

const signupSchema = credentials.extend({
  full_name: z.string().trim().min(2, 'Enter your name').max(120),
});

export async function signUp(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({ email: fd.get('email'), password: fd.get('password'), full_name: fd.get('full_name') });
  if (!parsed.success) {
    return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const db = await createClient();
  const origin = (await headers()).get('origin') ?? '';
  const { data, error } = await db.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name }, emailRedirectTo: origin ? `${origin}/auth/callback` : undefined },
  });
  if (error) {
    return { ok: false, error: error.code === 'user_already_exists' ? 'An account with this email already exists.' : error.message };
  }
  if (!data.session) {
    return { ok: true, message: 'Account created. Check your email to confirm your address, then sign in.' };
  }
  redirect('/');
}

export async function signOut() {
  const db = await createClient();
  await db.auth.signOut();
  redirect('/login');
}
