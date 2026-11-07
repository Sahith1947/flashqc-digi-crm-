'use client';
import Form from 'next/form';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FilterSelect {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value?: string;
  /** label for the "any" option; omit to require a value */
  anyLabel?: string;
}

/**
 * GET form that drives list pages through the URL (shareable, back-button friendly).
 * Selects apply immediately; search applies on Enter or the search button.
 */
export function FilterBar({
  basePath,
  search,
  selects = [],
  hidden = {},
  extra,
  className,
  showReset = true,
}: {
  basePath: string;
  search?: { value?: string; placeholder: string };
  selects?: FilterSelect[];
  hidden?: Record<string, string | undefined>;
  extra?: ReactNode;
  className?: string;
  showReset?: boolean;
}) {
  const active = Boolean(search?.value) || selects.some((s) => s.value && s.anyLabel);
  return (
    <Form
      action={basePath}
      className={cn('flex flex-wrap items-end gap-2', className)}
      onChange={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'SELECT' || (t as HTMLInputElement).type === 'date') (e.currentTarget as HTMLFormElement).requestSubmit();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search && (
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <label htmlFor="filter-q" className="sr-only">
            Search
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={search.value}
            placeholder={search.placeholder}
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-ink-3 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
          />
        </div>
      )}
      {selects.map((s) => (
        <div key={s.name}>
          <label htmlFor={`filter-${s.name}`} className="sr-only">
            {s.label}
          </label>
          <select
            id={`filter-${s.name}`}
            name={s.name}
            defaultValue={s.value ?? ''}
            aria-label={s.label}
            className="h-9 rounded-lg border border-line-strong bg-surface pr-8 pl-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 focus:outline-none"
          >
            {s.anyLabel && <option value="">{s.anyLabel}</option>}
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      {extra}
      {search && (
        <button type="submit" className="h-9 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-neutral-800">
          Search
        </button>
      )}
      {showReset && active && (
        <Link href={basePath} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:bg-canvas hover:text-ink">
          <X className="size-3.5" /> Clear
        </Link>
      )}
    </Form>
  );
}
