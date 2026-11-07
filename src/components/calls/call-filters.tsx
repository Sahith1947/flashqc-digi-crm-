import { FilterBar, type FilterSelect } from '@/components/ui/filter-bar';
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, CALL_STATUS_LABELS, CALL_STATUSES } from '@/lib/constants';
import type { CallFilters } from '@/server/queries/calls';

export function CallFilterBar({
  basePath,
  filters,
  campaigns,
  hideDirection = false,
  sort,
}: {
  basePath: string;
  filters: CallFilters;
  campaigns: { value: string; label: string }[];
  hideDirection?: boolean;
  sort?: { sort?: string; dir?: string };
}) {
  const selects: FilterSelect[] = [];
  if (!hideDirection)
    selects.push({
      name: 'direction',
      label: 'Direction',
      anyLabel: 'All directions',
      value: filters.direction,
      options: [
        { value: 'inbound', label: 'Inbound' },
        { value: 'outbound', label: 'Outbound' },
      ],
    });
  selects.push(
    {
      name: 'status',
      label: 'Status',
      anyLabel: 'All statuses',
      value: filters.status,
      options: [
        { value: 'answered', label: 'Answered (any)' },
        { value: 'missed_any', label: 'Missed / no answer / busy' },
        ...CALL_STATUSES.map((s) => ({ value: s, label: CALL_STATUS_LABELS[s] })),
      ],
    },
    {
      name: 'outcome',
      label: 'Outcome',
      anyLabel: 'All outcomes',
      value: filters.outcome,
      options: [...CALL_OUTCOMES.map((o) => ({ value: o, label: CALL_OUTCOME_LABELS[o] })), { value: 'not_set', label: 'Not set' }],
    },
    { name: 'campaign', label: 'Campaign', anyLabel: 'All campaigns', value: filters.campaign, options: campaigns },
    {
      name: 'scope',
      label: 'Data scope',
      anyLabel: 'Live + simulated',
      value: filters.scope,
      options: [
        { value: 'live', label: 'Live only' },
        { value: 'simulated', label: 'Simulated only' },
      ],
    },
    {
      name: 'recording',
      label: 'Recording',
      anyLabel: 'Any recording',
      value: filters.recording,
      options: [
        { value: 'yes', label: 'Has recording' },
        { value: 'no', label: 'No recording' },
      ],
    },
  );
  return (
    <FilterBar
      basePath={basePath}
      search={{ value: filters.q, placeholder: 'Name, phone, business or CL-ID' }}
      selects={selects}
      hidden={{ sort: sort?.sort, dir: sort?.dir }}
      extra={
        <div className="flex items-center gap-1">
          <label htmlFor="from" className="sr-only">
            From date
          </label>
          <input id="from" name="from" type="date" defaultValue={filters.from} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label="From date" />
          <span className="text-ink-3">–</span>
          <label htmlFor="to" className="sr-only">
            To date
          </label>
          <input id="to" name="to" type="date" defaultValue={filters.to} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" aria-label="To date" />
        </div>
      }
    />
  );
}
