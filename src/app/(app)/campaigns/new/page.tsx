import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember } from '@/server/auth';
import { agentOptions, getSettings, lineOptions } from '@/server/queries/config';
import { contactFacets } from '@/server/queries/contacts';
import { TelephonyService } from '@/server/services/telephony-service';
import { PageHeader } from '@/components/ui/page-header';
import { CampaignWizard } from '@/components/campaigns/campaign-wizard';

export const metadata: Metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  const { db } = await requireMember('manager');
  const [lines, agents, settings, facets] = await Promise.all([lineOptions(db, 'outbound'), agentOptions(db), getSettings(db), contactFacets(db)]);
  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>
      <PageHeader title="New campaign" description="Campaigns are created as drafts. Review the contacts, then start the campaign." />
      <CampaignWizard
        lines={lines}
        agents={agents}
        liveAvailable={TelephonyService.isLiveCallingAvailable()}
        defaults={{ start: settings?.default_calling_window_start ?? '09:00', end: settings?.default_calling_window_end ?? '21:00' }}
        facets={facets}
      />
    </>
  );
}
