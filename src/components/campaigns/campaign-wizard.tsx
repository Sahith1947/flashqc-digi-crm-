'use client';
import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { createCampaign, type CampaignAudience } from '@/app/(app)/campaigns/actions';
import { CampaignFields, readCampaignDetails } from './campaign-fields';
import { AudiencePicker } from './audience-picker';

export function CampaignWizard(props: {
  lines: { id: string; label: string; phone_e164: string }[];
  agents: { id: string; name: string }[];
  liveAvailable: boolean;
  defaults: { start: string; end: string };
  facets: { cities: string[]; categories: string[] };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [audience, setAudience] = useState<CampaignAudience | null>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>();
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const onAudience = useCallback((a: CampaignAudience | null, s: string) => {
    setAudience(a);
    setSummary(s);
  }, []);

  return (
    <form
      ref={formRef}
      className="space-y-6"
      data-testid="campaign-wizard"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!formRef.current?.reportValidity()) return;
        if (!audience) {
          setError('Choose the campaign contacts: confirm a CSV, find matching contacts, or pick "Add later".');
          return;
        }
        const details = readCampaignDetails(formRef.current);
        start(async () => {
          const res = await createCampaign(details, audience);
          if (res.ok) {
            push('success', res.message);
            router.push(`/campaigns/${res.data!.id}`);
          } else {
            setError(res.error);
            setFieldErrors(res.fieldErrors);
            push('error', res.error);
          }
        });
      }}
    >
      <Card>
        <CardHeader title="1. Campaign settings" />
        <CardBody>
          <CampaignFields lines={props.lines} agents={props.agents} liveAvailable={props.liveAvailable} defaults={props.defaults} fieldErrors={fieldErrors} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="2. Contacts" description="Numbers are validated, de-duplicated and checked against existing contacts." />
        <CardBody>
          <AudiencePicker facets={props.facets} onChange={onAudience} />
        </CardBody>
      </Card>
      {error && <ErrorNotice title="Cannot create campaign" message={error} />}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {summary && <span className="text-sm text-ink-2">{summary}</span>}
        <Button type="submit" pending={pending} data-testid="create-campaign">
          Create campaign (draft)
        </Button>
      </div>
    </form>
  );
}
