import { Badge, SimulatedBadge } from '@/components/ui/badge';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, labelFor, type CampaignStatus } from '@/lib/constants';

export function CampaignStatusBadge({ status }: { status: string }) {
  return <Badge tone={CAMPAIGN_STATUS_TONE[status as CampaignStatus] ?? 'neutral'}>{labelFor(CAMPAIGN_STATUS_LABELS, status)}</Badge>;
}
export function CampaignModeBadge({ mode }: { mode: string }) {
  return mode === 'simulated' ? <SimulatedBadge /> : <Badge tone="brand" icon={false}>Live</Badge>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${done} of ${total} processed`}>
      <div className="h-1.5 w-24 rounded-full bg-canvas">
        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-ink-2">{pct}%</span>
    </div>
  );
}
