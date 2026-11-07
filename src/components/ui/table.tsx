import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table className={cn('w-full min-w-[640px] border-collapse text-sm', className)} {...props} />;
}
export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn('border-b border-line bg-canvas/60 px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-2 uppercase', className)}
      {...props}
    />
  );
}
export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-line px-4 py-3 align-middle text-ink', className)} {...props} />;
}
export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-canvas/50', className)} {...props} />;
}

/** Sortable column header that toggles ?sort=&dir= while preserving other params. */
export function SortTh({
  label,
  column,
  params,
  basePath,
  className,
}: {
  label: string;
  column: string;
  params: Record<string, string | undefined>;
  basePath: string;
  className?: string;
}) {
  const active = params.sort === column;
  const nextDir = active && params.dir === 'asc' ? 'desc' : 'asc';
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v && k !== 'page' && k !== 'sort' && k !== 'dir') qs.set(k, v);
  });
  qs.set('sort', column);
  qs.set('dir', nextDir);
  const Icon = !active ? ArrowUpDown : params.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={`${basePath}?${qs.toString()}`} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        <Icon className={cn('size-3', active ? 'text-ink' : 'text-ink-3')} aria-hidden />
      </Link>
    </Th>
  );
}
