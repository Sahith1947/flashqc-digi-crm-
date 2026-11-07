'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import Link from 'next/link';
import { FlaskConical, PhoneCall, PhoneIncoming } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Notice } from '@/components/ui/states';
import { useActionToast } from '@/components/ui/toast';
import { formatPhone } from '@/lib/phone';
import { placeOutboundCall } from '@/app/(app)/outbound/actions';
import { simulateInboundCall } from '@/app/(app)/inbound/actions';
import { ContactPicker } from './contact-picker';

interface LineOpt {
  id: string;
  label: string;
  phone_e164: string;
}
interface AgentOpt {
  id: string;
  name: string;
}

export function OutboundDialer({
  lines,
  agents,
  liveAvailable,
  simulationEnabled,
  defaultPhone,
}: {
  lines: LineOpt[];
  agents: AgentOpt[];
  liveAvailable: boolean;
  simulationEnabled: boolean;
  defaultPhone?: string;
}) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult<{ callId: string }> | null>(placeOutboundCall);
  useActionToast(state);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const canCall = liveAvailable || simulationEnabled;
  return (
    <form onSubmit={action} className="space-y-4" data-testid="outbound-form">
      <Field label="Contact or number" htmlFor="phone" error={fe?.phone} required hint="Indian numbers can be entered without +91.">
        <ContactPicker defaultPhone={defaultPhone} error={fe?.phone} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From business number" htmlFor="phone_number_id">
          <Select id="phone_number_id" name="phone_number_id" defaultValue="">
            <option value="">Default / none</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} · {formatPhone(l.phone_e164)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Voice agent" htmlFor="voice_agent_id">
          <Select id="voice_agent_id" name="voice_agent_id" defaultValue="">
            <option value="">None</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Call mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 ${!simulationEnabled ? 'opacity-50' : ''}`}>
            <input type="radio" name="mode" value="simulated" defaultChecked={!liveAvailable} disabled={!simulationEnabled} className="mt-0.5 accent-brand-500" />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <FlaskConical className="size-4" /> Simulated
              </span>
              <span className="block text-xs text-ink-3">Test the workflow. Labelled as simulated; no real call.</span>
            </span>
          </label>
          <label className={`flex items-start gap-2.5 rounded-lg border p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 ${liveAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input type="radio" name="mode" value="live" defaultChecked={liveAvailable} disabled={!liveAvailable} className="mt-0.5 accent-brand-500" />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <PhoneCall className="size-4" /> Live call
              </span>
              <span className="block text-xs text-ink-3">{liveAvailable ? 'Places a real call through the telephony provider.' : 'Telephony provider not connected yet (Phase 2).'}</span>
            </span>
          </label>
        </div>
      </fieldset>
      {!canCall && <Notice tone="warning">Simulation mode is disabled in Settings and no telephony provider is connected, so calls cannot be placed.</Notice>}
      {state?.ok && state.data && (
        <Notice tone="info">
          {state.message}{' '}
          <Link href={`/calls/${state.data.callId}`} className="font-medium underline">
            Open call
          </Link>
        </Notice>
      )}
      {state && !state.ok && !fe && <Notice tone="warning">{state.error}</Notice>}
      <Button type="submit" pending={pending} disabled={!canCall} icon={<PhoneCall className="size-4" />}>
        Start call
      </Button>
    </form>
  );
}

export function InboundSimulator({ lines, simulationEnabled }: { lines: LineOpt[]; simulationEnabled: boolean }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult<{ callId: string }> | null>(simulateInboundCall);
  useActionToast(state);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={action} className="space-y-4" data-testid="inbound-sim-form">
      <Field label="Caller number" htmlFor="sim_phone" error={fe?.phone} required>
        <Input id="sim_phone" name="phone" placeholder="98765 43210" required aria-invalid={Boolean(fe?.phone)} />
      </Field>
      <Field label="Business line called" htmlFor="sim_line">
        <Select id="sim_line" name="phone_number_id" defaultValue="">
          <option value="">Any / not specified</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} · {formatPhone(l.phone_e164)}
            </option>
          ))}
        </Select>
      </Field>
      {state?.ok && state.data && (
        <Notice tone="sim">
          {state.message}{' '}
          <Link href={`/calls/${state.data.callId}`} className="font-medium underline">
            Open call
          </Link>
        </Notice>
      )}
      {state && !state.ok && !fe && <Notice tone="warning">{state.error}</Notice>}
      <Button type="submit" variant="dark" pending={pending} disabled={!simulationEnabled} icon={<PhoneIncoming className="size-4" />}>
        Simulate inbound call
      </Button>
      {!simulationEnabled && <p className="text-xs text-ink-3">Simulation mode is disabled in Settings.</p>}
    </form>
  );
}
