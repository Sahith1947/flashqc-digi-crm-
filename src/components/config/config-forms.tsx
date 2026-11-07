'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import type { PhoneNumber, VoiceAgent } from '@/lib/supabase/types';
import { AGENT_LANGUAGES, AGENT_STATUS_LABELS, AGENT_STATUSES, PHONE_PROVIDER_LABELS, PHONE_PROVIDERS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { useActionToast, useOnSuccess } from '@/components/ui/toast';
import { savePhoneNumber } from '@/app/(app)/phone-numbers/actions';
import { saveVoiceAgent } from '@/app/(app)/voice-agents/actions';

type Bound = (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;

function useModalForm(action: Bound, onDone: () => void) {
  const { state, pending, onSubmit: formAction } = useFormAction<ActionResult | null>(action);
  useActionToast(state);
  useOnSuccess(state, () => onDone());
  return { formAction, pending, fe: state && !state.ok ? state.fieldErrors : undefined };
}

function PhoneNumberForm({ n, agents, onDone }: { n?: PhoneNumber; agents: { id: string; name: string }[]; onDone: () => void }) {
  const { formAction, pending, fe } = useModalForm(savePhoneNumber.bind(null, n?.id ?? null) as Bound, onDone);
  return (
    <form onSubmit={formAction} className="space-y-4" data-testid="phone-number-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" htmlFor="pn_label" error={fe?.label} required>
          <Input id="pn_label" name="label" defaultValue={n?.label ?? ''} required maxLength={120} placeholder="e.g. Sales line – Hyderabad" />
        </Field>
        <Field label="Phone number" htmlFor="pn_phone" error={fe?.phone} required>
          <Input id="pn_phone" name="phone" defaultValue={n?.phone_e164 ?? ''} required placeholder="+91 40 1234 5678" />
        </Field>
        <Field label="Provider" htmlFor="pn_provider" hint="Which telephony provider hosts this number">
          <Select id="pn_provider" name="provider" defaultValue={n?.provider ?? 'unassigned'}>
            {PHONE_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PHONE_PROVIDER_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider number ID" htmlFor="pn_pid" hint="Optional reference from the provider dashboard">
          <Input id="pn_pid" name="provider_number_id" defaultValue={n?.provider_number_id ?? ''} maxLength={200} />
        </Field>
        <Field label="Assigned voice agent" htmlFor="pn_agent" className="sm:col-span-2">
          <Select id="pn_agent" name="voice_agent_id" defaultValue={n?.voice_agent_id ?? ''}>
            <option value="">None</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox name="can_inbound" label="Inbound" description="Receives calls" defaultChecked={n?.can_inbound ?? true} />
        <Checkbox name="can_outbound" label="Outbound" description="Places calls" defaultChecked={n?.can_outbound ?? true} />
        <Checkbox name="enabled" label="Enabled" description="Available in the CRM" defaultChecked={n?.enabled ?? true} />
      </div>
      {fe?.can_inbound && <p className="text-xs text-red-700">{fe.can_inbound}</p>}
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          {n ? 'Save changes' : 'Add number'}
        </Button>
      </div>
    </form>
  );
}

function VoiceAgentForm({ a, onDone }: { a?: VoiceAgent; onDone: () => void }) {
  const { formAction, pending, fe } = useModalForm(saveVoiceAgent.bind(null, a?.id ?? null) as Bound, onDone);
  return (
    <form onSubmit={formAction} className="space-y-4" data-testid="voice-agent-form">
      {a?.provider_synced_at && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          This agent is synced from Sarvam. Name, language, greeting and description are overwritten on the next sync — change them in Sarvam. CRM status and instructions notes stay as you set them.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent name" htmlFor="va_name" error={fe?.name} required>
          <Input id="va_name" name="name" defaultValue={a?.name ?? ''} required maxLength={120} placeholder="e.g. Priya – Sales (Telugu)" />
        </Field>
        <Field label="Status" htmlFor="va_status" hint='"Ready" means the configuration is complete. Connection is verified separately.'>
          <Select id="va_status" name="status" defaultValue={a?.status ?? 'draft'}>
            {AGENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AGENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Language" htmlFor="va_lang">
          <Select id="va_lang" name="language" defaultValue={a?.language ?? 'en-IN'}>
            {AGENT_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Voice" htmlFor="va_voice" hint="Voice name from the provider (set in Phase 2)">
          <Input id="va_voice" name="voice" defaultValue={a?.voice ?? ''} maxLength={80} />
        </Field>
        <Field label="Provider" htmlFor="va_provider">
          <Select id="va_provider" name="provider" defaultValue={a?.provider ?? 'sarvam'}>
            <option value="sarvam">Sarvam AI</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Provider agent ID" htmlFor="va_pid" hint="Set automatically by Sarvam sync">
          <Input id="va_pid" name="provider_agent_id" defaultValue={a?.provider_agent_id ?? ''} maxLength={200} readOnly={Boolean(a?.provider_synced_at)} />
        </Field>
        <Field label="Description" htmlFor="va_desc" className="sm:col-span-2">
          <Input id="va_desc" name="description" defaultValue={a?.description ?? ''} maxLength={1000} />
        </Field>
        <Field label="Greeting" htmlFor="va_greet" error={fe?.greeting} className="sm:col-span-2">
          <Textarea id="va_greet" name="greeting" rows={2} defaultValue={a?.greeting ?? ''} maxLength={2000} placeholder="Namaste! This is Priya from FlashQC Digi…" />
        </Field>
        <Field label="Instructions / script" htmlFor="va_instr" error={fe?.instructions} className="sm:col-span-2">
          <Textarea id="va_instr" name="instructions" rows={6} defaultValue={a?.instructions ?? ''} maxLength={20000} placeholder="Goals, tone, qualification questions, objection handling…" />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          {a ? 'Save changes' : 'Create agent'}
        </Button>
      </div>
    </form>
  );
}

function ModalButton({ edit, label, title, testId, children }: { edit: boolean; label: string; title: string; testId: string; children: (done: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const router = useRouter();
  const done = () => {
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      <Button
        variant={edit ? 'secondary' : 'primary'}
        size={edit ? 'sm' : 'md'}
        icon={edit ? <Pencil className="size-3.5" /> : <Plus className="size-4" />}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        data-testid={testId}
      >
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
        <div key={key}>{children(done)}</div>
      </Modal>
    </>
  );
}

export function PhoneNumberButton({ n, agents }: { n?: PhoneNumber; agents: { id: string; name: string }[] }) {
  return (
    <ModalButton edit={Boolean(n)} label={n ? 'Edit' : 'Add number'} title={n ? 'Edit phone number' : 'Add phone number'} testId={n ? 'edit-number' : 'add-number'}>
      {(done) => <PhoneNumberForm n={n} agents={agents} onDone={done} />}
    </ModalButton>
  );
}

export function VoiceAgentButton({ a }: { a?: VoiceAgent }) {
  return (
    <ModalButton edit={Boolean(a)} label={a ? 'Edit' : 'New agent'} title={a ? 'Edit voice agent' : 'New voice agent'} testId={a ? 'edit-agent' : 'add-agent'}>
      {(done) => <VoiceAgentForm a={a} onDone={done} />}
    </ModalButton>
  );
}
