import { BarList } from '@/components/charts/bar-list';
import { CALL_STATUS_LABELS, CALL_STATUS_TONE, CALL_STATUSES } from '@/lib/constants';

export function StatusDistribution({ dist }: { dist: Record<string, number> }) {
  const items = CALL_STATUSES.filter((s) => (dist[s] ?? 0) > 0)
    .map((s) => ({ key: s, label: CALL_STATUS_LABELS[s], value: dist[s] ?? 0, tone: CALL_STATUS_TONE[s] }))
    .sort((a, b) => b.value - a.value);
  return <BarList items={items} emptyText="No calls in this period." />;
}
