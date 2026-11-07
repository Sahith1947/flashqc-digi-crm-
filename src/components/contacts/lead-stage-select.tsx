'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LEAD_STAGE_LABELS, LEAD_STAGES } from '@/lib/leads';
import { Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { setLeadStage } from '@/app/(app)/contacts/actions';

export function LeadStageSelect({ contactId, stage, disabled }: { contactId: string; stage: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <Select
      aria-label="Lead stage"
      data-testid="lead-stage-select"
      defaultValue={stage}
      disabled={disabled || pending}
      className="h-9 w-48"
      onChange={(e) => {
        const v = e.target.value;
        start(async () => {
          const res = await setLeadStage(contactId, v);
          push(res.ok ? 'success' : 'error', res.ok ? res.message : res.error);
          router.refresh();
        });
      }}
    >
      {LEAD_STAGES.map((s) => (
        <option key={s} value={s}>
          {LEAD_STAGE_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}
