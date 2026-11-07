import { CheckCircle2, Clock, Hourglass, OctagonAlert, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { formatDuration } from '@/lib/dates';
import type { Summary } from '@/server/queries/analytics';
import { pct } from '@/server/queries/analytics';

export function MetricCards({ s }: { s: Summary }) {
  const n = (v: number) => v.toLocaleString('en-IN');
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="metric-cards">
      <StatCard label="Total calls" value={n(s.total)} icon={<Phone className="size-4" />} hint={s.simulated ? `${n(s.simulated)} simulated` : 'All recorded calls'} />
      <StatCard label="Incoming" value={n(s.inbound)} icon={<PhoneIncoming className="size-4" />} hint={`${pct(s.inbound, s.total)} of calls`} />
      <StatCard label="Outgoing" value={n(s.outbound)} icon={<PhoneOutgoing className="size-4" />} hint={`${pct(s.outbound, s.total)} of calls`} />
      <StatCard label="Answered" value={n(s.answered)} icon={<CheckCircle2 className="size-4" />} hint={`${pct(s.answered, s.total)} answer rate`} />
      <StatCard label="Missed" value={n(s.missed)} icon={<PhoneMissed className="size-4" />} hint="Missed, no answer or busy" />
      <StatCard label="Failed" value={n(s.failed)} icon={<OctagonAlert className="size-4" />} hint={`${pct(s.failed, s.total)} of calls`} />
      <StatCard label="Avg. duration" value={formatDuration(s.avg_duration_seconds)} icon={<Hourglass className="size-4" />} hint="Answered calls" />
      <StatCard label="Total talk time" value={formatDuration(s.talk_time_seconds)} icon={<Clock className="size-4" />} hint="Answered calls" />
    </div>
  );
}
