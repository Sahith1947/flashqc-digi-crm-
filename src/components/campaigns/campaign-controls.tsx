'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Plus, Settings2, XCircle } from 'lucide-react';
import type { Campaign } from '@/lib/supabase/types';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { addCampaignContacts, processCampaignBatch, transitionCampaign, updateCampaign, type CampaignAudience } from '@/app/(app)/campaigns/actions';
import { CampaignFields, readCampaignDetails } from './campaign-fields';
import { AudiencePicker } from './audience-picker';

export function CampaignControls({ campaign, canManage }: { campaign: Campaign; canManage: boolean }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  if (!canManage) return null;
  const go = (to: 'running' | 'paused') =>
    start(async () => {
      const res = await transitionCampaign(campaign.id, to);
      if (res.ok) {
        push('success', res.message);
        router.refresh();
      } else push('error', res.error);
    });
  return (
    <>
      {(campaign.status === 'draft' || campaign.status === 'paused') && (
        <Button icon={<Play className="size-4" />} pending={pending} onClick={() => go('running')} data-testid="campaign-start">
          {campaign.status === 'draft' ? 'Start campaign' : 'Resume'}
        </Button>
      )}
      {campaign.status === 'running' && (
        <Button variant="dark" icon={<Pause className="size-4" />} pending={pending} onClick={() => go('paused')} data-testid="campaign-pause">
          Pause
        </Button>
      )}
      {['draft', 'running', 'paused'].includes(campaign.status) && (
        <ConfirmAction
          action={transitionCampaign.bind(null, campaign.id, 'cancelled')}
          label="Cancel"
          icon={<XCircle className="size-4" />}
          title="Cancel this campaign?"
          description="Pending contacts will be marked skipped. Completed calls are kept. A cancelled campaign cannot be restarted."
          confirmLabel="Cancel campaign"
          size="md"
          testId="campaign-cancel"
        />
      )}
    </>
  );
}

/** While a campaign is running, processes batches and refreshes the page. Stops when paused/completed or on error. */
export function CampaignRunner({ campaignId, running, mode }: { campaignId: string; running: boolean; mode: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [note, setNote] = useState<string | null>(null);
  const busy = useRef(false);
  const tick = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      const res = await processCampaignBatch(campaignId);
      if (!res.ok) {
        push('error', res.error);
        setNote(res.error);
        router.refresh();
        return;
      }
      setNote(res.data?.note ?? null);
      if (res.data && (res.data.processed > 0 || res.data.status !== 'running')) router.refresh();
      if (res.data?.status === 'completed') push('success', 'Campaign completed.');
    } finally {
      busy.current = false;
    }
  }, [campaignId, push, router]);
  useEffect(() => {
    if (!running) return;
    void tick();
    const t = setInterval(() => void tick(), 1500);
    return () => clearInterval(t);
  }, [running, tick]);
  if (!running) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-ink-2" data-testid="campaign-runner">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
      </span>
      {note ?? (mode === 'simulated' ? 'Running simulation — processing contacts while this page is open.' : 'Running — dialling contacts.')}
    </p>
  );
}

export function EditCampaignButton(props: {
  campaign: Campaign;
  lines: { id: string; label: string; phone_e164: string }[];
  agents: { id: string; name: string }[];
  liveAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [fe, setFe] = useState<Record<string, string>>();
  const formRef = useRef<HTMLFormElement>(null);
  const { push } = useToast();
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setOpen(true)} data-testid="campaign-edit">
        Settings
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Campaign settings" wide>
        <form
          ref={formRef}
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateCampaign(props.campaign.id, readCampaignDetails(formRef.current!));
              if (res.ok) {
                push('success', res.message);
                setOpen(false);
                router.refresh();
              } else {
                setFe(res.fieldErrors);
                push('error', res.error);
              }
            });
          }}
        >
          <CampaignFields campaign={props.campaign} lines={props.lines} agents={props.agents} liveAvailable={props.liveAvailable} defaults={{ start: '09:00', end: '21:00' }} fieldErrors={fe} />
          <div className="flex justify-end">
            <Button type="submit" pending={pending}>
              Save settings
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AddContactsButton({ campaignId, facets }: { campaignId: string; facets: { cities: string[]; categories: string[] } }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [audience, setAudience] = useState<CampaignAudience | null>(null);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const onChange = useCallback((a: CampaignAudience | null) => setAudience(a), []);
  return (
    <>
      <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => { setRound((r) => r + 1); setOpen(true); }} data-testid="campaign-add-contacts">
        Add contacts
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add contacts to campaign" wide>
        <div className="space-y-4">
          <AudiencePicker key={round} facets={facets} onChange={onChange} allowNone={false} />
          <div className="flex justify-end">
            <Button
              disabled={!audience}
              pending={pending}
              data-testid="campaign-add-confirm"
              onClick={() =>
                audience &&
                start(async () => {
                  const res = await addCampaignContacts(campaignId, audience);
                  if (res.ok) {
                    push('success', res.message);
                    setOpen(false);
                    router.refresh();
                  } else push('error', res.error);
                })
              }
            >
              Add to campaign
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
