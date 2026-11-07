import { LogOut } from 'lucide-react';
import { getSession } from '@/server/auth';
import { ROLE_LABELS, type Role } from '@/lib/constants';
import { signOut } from '@/app/(auth)/actions';

export async function UserMenu() {
  const s = await getSession();
  if (!s) return null;
  const name = s.profile?.full_name || s.email;
  const initials = (s.profile?.full_name || s.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white">{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white" data-testid="current-user">
          {name}
        </p>
        <p className="truncate text-xs text-neutral-400">{s.profile ? ROLE_LABELS[s.profile.role as Role] : 'No profile'}</p>
      </div>
      <form action={signOut}>
        <button type="submit" className="rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

export function UserMenuFallback() {
  return <div className="h-11 animate-pulse rounded-lg bg-white/5" />;
}
