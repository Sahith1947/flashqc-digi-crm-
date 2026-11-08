import { Flame, Snowflake, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { emotionTone, INTEREST_LABELS, INTEREST_TONE, LEAD_STAGE_LABELS, LEAD_STAGE_TONE, type Interest, type LeadStage } from '@/lib/leads';

export function LeadStageBadge({ stage }: { stage: string | null }) {
  const s = (stage ?? 'new') as LeadStage;
  return <Badge tone={LEAD_STAGE_TONE[s] ?? 'neutral'}>{LEAD_STAGE_LABELS[s] ?? s}</Badge>;
}

export function TemperatureBadge({ temperature }: { temperature: string | null }) {
  if (!temperature) return <span className="text-xs text-ink-3">—</span>;
  const map = {
    hot: { tone: 'critical' as const, icon: <Flame className="size-3" aria-hidden />, label: 'Hot' },
    warm: { tone: 'warning' as const, icon: <Sun className="size-3" aria-hidden />, label: 'Warm' },
    cold: { tone: 'info' as const, icon: <Snowflake className="size-3" aria-hidden />, label: 'Cold' },
  }[temperature as 'hot' | 'warm' | 'cold'];
  if (!map) return null;
  return (
    <Badge tone={map.tone} icon={false}>
      {map.icon}
      {map.label}
    </Badge>
  );
}

export function EmotionBadge({ emotion }: { emotion: string | null }) {
  if (!emotion) return <span className="text-xs text-ink-3">—</span>;
  return (
    <Badge tone={emotionTone(emotion)} title="Auto-detected from the AI call analysis and the customer's words">
      {emotion}
    </Badge>
  );
}

export function InterestBadge({ interest }: { interest: string | null }) {
  const k = (interest ?? 'unclear') as Interest | 'pending';
  return <Badge tone={INTEREST_TONE[k] ?? 'neutral'}>{INTEREST_LABELS[k] ?? k}</Badge>;
}
