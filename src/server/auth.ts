import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasMinRole, type Role } from '@/lib/constants';
import type { DB, Profile } from '@/lib/supabase/types';
import { AppError } from '@/server/providers/types';

export interface SessionContext {
  db: DB;
  userId: string;
  email: string;
  profile: Profile | null;
}

/** Cached per request. Verifies the user with the auth server. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  await connection(); // per-request, never prerendered
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await db.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { db, userId: data.user.id, email: data.user.email ?? '', profile };
});

/** For pages: redirects to /login or /pending as needed. */
export async function requireMember(min: Role = 'viewer'): Promise<SessionContext & { profile: Profile }> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.profile || !s.profile.is_active) redirect('/pending');
  if (!hasMinRole(s.profile.role, min)) redirect('/?denied=1');
  return s as SessionContext & { profile: Profile };
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertRole(min: Role): Promise<SessionContext & { profile: Profile }> {
  const s = await getSession();
  if (!s) throw new AppError('Your session has expired. Please sign in again.', 'unauthenticated');
  if (!s.profile?.is_active) throw new AppError('Your account is awaiting admin approval.', 'inactive');
  if (!hasMinRole(s.profile.role, min)) {
    throw new AppError(`This action requires the ${min} role or higher.`, 'forbidden');
  }
  return s as SessionContext & { profile: Profile };
}
