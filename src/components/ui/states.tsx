import type { ReactNode } from 'react';
import { Inbox, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} data-testid="empty-state">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-canvas text-ink-3">{icon ?? <Inbox className="size-5" />}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ title = 'Could not load data', message, className }: { title?: string; message: string; className?: string }) {
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm', className)}>
      <OctagonAlert className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden />
      <div>
        <p className="font-medium text-red-900">{title}</p>
        <p className="text-red-800">{message}</p>
      </div>
    </div>
  );
}

export function Notice({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warning' | 'sim'; className?: string }) {
  const styles = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    sim: 'border-violet-200 bg-violet-50 text-violet-900',
  }[tone];
  return <div className={cn('rounded-lg border px-4 py-3 text-sm', styles, className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-neutral-200/70', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}
