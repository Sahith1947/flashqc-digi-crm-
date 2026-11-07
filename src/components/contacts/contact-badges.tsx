import { Badge } from '@/components/ui/badge';
import { CONSENT_LABELS, DND_LABELS, labelFor } from '@/lib/constants';

export function ConsentBadge({ status }: { status: string | null }) {
  const tone = status === 'granted' ? 'good' : status === 'revoked' ? 'critical' : 'neutral';
  return <Badge tone={tone}>{labelFor(CONSENT_LABELS, status, 'Unknown')}</Badge>;
}
export function DndBadge({ status }: { status: string | null }) {
  const tone = status === 'registered' ? 'warning' : status === 'not_registered' ? 'good' : 'neutral';
  return <Badge tone={tone}>{labelFor(DND_LABELS, status, 'Unknown')}</Badge>;
}
