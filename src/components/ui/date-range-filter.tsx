'use client';
import { RANGE_PRESETS, type DateRange } from '@/lib/dates';
import { DATA_SCOPE_LABELS, DATA_SCOPES, type DataScope } from '@/lib/constants';
import { FilterBar } from './filter-bar';

/** Date range + data scope (live/simulated) selector shared by Overview and Analytics. */
export function DateRangeFilter({ basePath, range, scope, extraSelects = [] }: { basePath: string; range: DateRange; scope: DataScope; extraSelects?: Parameters<typeof FilterBar>[0]['selects'] }) {
  return (
    <FilterBar
      basePath={basePath}
      showReset={false}
      selects={[
        { name: 'range', label: 'Date range', value: range.preset, options: RANGE_PRESETS },
        { name: 'scope', label: 'Data scope', value: scope, options: DATA_SCOPES.map((s) => ({ value: s, label: DATA_SCOPE_LABELS[s] })) },
        ...(extraSelects ?? []),
      ]}
      extra={
        range.preset === 'custom' ? (
          <>
            <label className="sr-only" htmlFor="from">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={range.fromDate} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
            <label className="sr-only" htmlFor="to">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={range.toDate} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
          </>
        ) : null
      }
    />
  );
}
