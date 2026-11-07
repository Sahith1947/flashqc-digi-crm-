'use client';
import type { Campaign } from '@/lib/supabase/types';
import { formatPhone } from '@/lib/phone';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import type { CampaignDetailsInput } from '@/app/(app)/campaigns/actions';

export interface Opt {
  id: string;
  label: string;
}

export function readCampaignDetails(form: HTMLFormElement): CampaignDetailsInput {
  const fd = new FormData(form);
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  return {
    name: s('name'),
    description: s('description') || null,
    mode: (s('mode') || 'simulated') as 'simulated' | 'live',
    phone_number_id: s('phone_number_id') || null,
    voice_agent_id: s('voice_agent_id') || null,
    calling_window_start: s('calling_window_start') || '09:00',
    calling_window_end: s('calling_window_end') || '21:00',
    max_attempts: Number(s('max_attempts') || 1),
  };
}

export function CampaignFields({
  campaign,
  lines,
  agents,
  liveAvailable,
  defaults,
  fieldErrors,
}: {
  campaign?: Campaign;
  lines: { id: string; label: string; phone_e164: string }[];
  agents: { id: string; name: string }[];
  liveAvailable: boolean;
  defaults: { start: string; end: string };
  fieldErrors?: Record<string, string>;
}) {
  const fe = fieldErrors ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Campaign name" htmlFor="cp_name" error={fe.name} required className="sm:col-span-2">
        <Input id="cp_name" name="name" required maxLength={160} defaultValue={campaign?.name ?? ''} placeholder="e.g. Hyderabad restaurants – Nov follow-up" />
      </Field>
      <Field label="Description" htmlFor="cp_desc" className="sm:col-span-2">
        <Textarea id="cp_desc" name="description" rows={2} maxLength={2000} defaultValue={campaign?.description ?? ''} />
      </Field>
      <Field label="Mode" htmlFor="cp_mode" hint={liveAvailable ? 'Live campaigns place real calls.' : 'Live mode becomes available after telephony integration (Phase 2).'}>
        <Select id="cp_mode" name="mode" defaultValue={campaign?.mode ?? 'simulated'}>
          <option value="simulated">Simulated (test data, no real calls)</option>
          <option value="live" disabled={!liveAvailable}>
            Live{liveAvailable ? '' : ' (not connected)'}
          </option>
        </Select>
      </Field>
      <Field label="Max attempts per contact" htmlFor="cp_attempts" hint="Retries apply to no-answer and busy">
        <Select id="cp_attempts" name="max_attempts" defaultValue={String(campaign?.max_attempts ?? 1)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Business number" htmlFor="cp_line">
        <Select id="cp_line" name="phone_number_id" defaultValue={campaign?.phone_number_id ?? ''}>
          <option value="">None</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} · {formatPhone(l.phone_e164)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Voice agent" htmlFor="cp_agent">
        <Select id="cp_agent" name="voice_agent_id" defaultValue={campaign?.voice_agent_id ?? ''}>
          <option value="">None</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Calling window start (IST)" htmlFor="cp_start" hint="Enforced for live campaigns">
        <Input id="cp_start" name="calling_window_start" type="time" defaultValue={(campaign?.calling_window_start ?? defaults.start).slice(0, 5)} required />
      </Field>
      <Field label="Calling window end (IST)" htmlFor="cp_end" error={fe.calling_window_end}>
        <Input id="cp_end" name="calling_window_end" type="time" defaultValue={(campaign?.calling_window_end ?? defaults.end).slice(0, 5)} required />
      </Field>
    </div>
  );
}
