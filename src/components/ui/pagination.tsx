import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Pagination({
  page,
  pageSize,
  total,
  params,
  basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
  basePath: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v && k !== 'page') qs.set(k, v);
    });
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = 'inline-flex h-8 items-center gap-1 rounded-md border border-line-strong bg-surface px-2.5 text-sm';
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-ink-2" aria-label="Pagination">
      <p className="tabular">
        Showing <span className="font-medium text-ink">{from.toLocaleString('en-IN')}</span>–
        <span className="font-medium text-ink">{to.toLocaleString('en-IN')}</span> of{' '}
        <span className="font-medium text-ink">{total.toLocaleString('en-IN')}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cn(linkCls, 'hover:bg-canvas')} rel="prev">
            <ChevronLeft className="size-4" /> Prev
          </Link>
        ) : (
          <span className={cn(linkCls, 'opacity-40')} aria-disabled="true">
            <ChevronLeft className="size-4" /> Prev
          </span>
        )}
        <span className="tabular">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={cn(linkCls, 'hover:bg-canvas')} rel="next">
            Next <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkCls, 'opacity-40')} aria-disabled="true">
            Next <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
