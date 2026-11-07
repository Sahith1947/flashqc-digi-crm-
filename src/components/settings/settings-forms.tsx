'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/action-result';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, SUPPRESSION_SOURCE_LABELS, SUPPRESSION_SOURCES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { useActionToast, useOnSuccess, useToast } from '@/components/ui/toast';
import { addSuppression, updateMember, updateOrgSettings, updateProfile } from '@/app/(app)/settings/actions';

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(updateProfile);
  useActionToast(state);
  return (
    <form onSubmit={action} className="max-w-md space-y-4">
      <Field label="Email" htmlFor="pf_email" hint="Managed by authentication">
        <Input id="pf_email" value={email} disabled readOnly />
      </Field>
      <Field label="Full name" htmlFor="pf_name" error={state && !state.ok ? state.fieldErrors?._ ?? state.fieldErrors?.full_name : undefined}>
        <Input id="pf_name" name="full_name" defaultValue={name} required minLength={2} maxLength={120} />
      </Field>
      <Button type="submit" pending={pending}>
        Save profile
      </Button>
    </form>
  );
}

export function OrgSettingsForm({ s, canEdit }: { s: { company_name: string; default_calling_window_start: string; default_calling_window_end: string; simulation_mode_enabled: boolean; admin_emails: string[] }; canEdit: boolean }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(updateOrgSettings);
  useActionToast(state);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={action} className="max-w-xl space-y-4">
      <Field label="Company name" htmlFor="os_name">
        <Input id="os_name" name="company_name" defaultValue={s.company_name} required maxLength={120} disabled={!canEdit} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default calling window start (IST)" htmlFor="os_start">
          <Input id="os_start" name="default_calling_window_start" type="time" defaultValue={s.default_calling_window_start.slice(0, 5)} required disabled={!canEdit} />
        </Field>
        <Field label="Default calling window end (IST)" htmlFor="os_end" error={fe?.default_calling_window_end} hint="Use 00:00–23:59 for 24 hours. TRAI rules and Indian carriers may still block promotional calls between 9 PM and 9 AM.">
          <Input id="os_end" name="default_calling_window_end" type="time" defaultValue={s.default_calling_window_end.slice(0, 5)} required disabled={!canEdit} />
        </Field>
      </div>
      <Checkbox
        name="simulation_mode_enabled"
        label="Enable simulation mode"
        description="Allows simulated calls and campaigns for testing. All simulated data is labelled. Disable once live telephony is in use."
        defaultChecked={s.simulation_mode_enabled}
        disabled={!canEdit}
      />
      <Field
        label="Auto-approved admin emails"
        htmlFor="os_admins"
        error={fe?.admin_emails ?? fe?.['admin_emails.0']}
        hint="These people become active admins the first time they create their account. One per line. Everyone else waits for approval."
      >
        <Textarea id="os_admins" name="admin_emails" rows={3} defaultValue={s.admin_emails.join('\n')} disabled={!canEdit} placeholder="name@gmail.com" />
      </Field>
      <p className="text-xs text-ink-3">Timezone: dates are displayed in Asia/Kolkata (IST) and stored in UTC.</p>
      {canEdit && (
        <Button type="submit" pending={pending}>
          Save settings
        </Button>
      )}
    </form>
  );
}

export function MemberRow({ m, isSelf }: { m: { id: string; role: string; is_active: boolean }; isSelf: boolean }) {
  const [role, setRole] = useState(m.role);
  const [active, setActive] = useState(m.is_active);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const dirty = role !== m.role || active !== m.is_active;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${m.id}`}>
        Role
      </label>
      <Select id={`role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)} className="h-8 w-32 text-xs" title={ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS]}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-brand-500" disabled={isSelf} />
        Active
      </label>
      <Button
        size="sm"
        variant={dirty ? 'primary' : 'secondary'}
        disabled={!dirty}
        pending={pending}
        data-testid={`save-member-${m.id}`}
        onClick={() =>
          start(async () => {
            const res = await updateMember(m.id, role, active);
            if (res.ok) {
              push('success', res.message);
              router.refresh();
            } else {
              push('error', res.error);
              setRole(m.role);
              setActive(m.is_active);
            }
          })
        }
      >
        Save
      </Button>
    </div>
  );
}

export function SuppressionForm() {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(addSuppression);
  useActionToast(state);
  const formRef = useRef<HTMLFormElement>(null);
  useOnSuccess(state, () => formRef.current?.reset());
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} onSubmit={action} className="flex flex-wrap items-end gap-3" data-testid="suppression-form">
      <Field label="Phone number" htmlFor="sup_phone" error={fe?.phone} className="w-52">
        <Input id="sup_phone" name="phone" required placeholder="98765 43210" />
      </Field>
      <Field label="Source" htmlFor="sup_source" className="w-40">
        <Select id="sup_source" name="source" defaultValue="manual">
          {SUPPRESSION_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SUPPRESSION_SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason" htmlFor="sup_reason" className="min-w-52 flex-1">
        <Input id="sup_reason" name="reason" maxLength={500} placeholder="e.g. Asked not to be called" />
      </Field>
      <Button type="submit" pending={pending}>
        Add number
      </Button>
    </form>
  );
}
