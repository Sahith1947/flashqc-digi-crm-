import Link from 'next/link';
import { cn } from '@/lib/cn';
import { NAV_ITEMS } from './nav-items';

/** Pure navigation list. `activePath` null renders without highlight (static prerender fallback). */
export function NavList({ activePath, onNavigate }: { activePath: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = activePath !== null && (href === '/' ? activePath === '/' : activePath === href || activePath.startsWith(href + '/'));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white',
            )}
          >
            {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-brand-500" aria-hidden />}
            <Icon className={cn('size-4.5 shrink-0', active ? 'text-brand-400' : 'text-neutral-500 group-hover:text-neutral-300')} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
