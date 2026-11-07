'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { CONSENT_STATUSES, DND_STATUSES } from '@/lib/constants';
import { assertRole } from '@/server/auth';
import { runAction } from '@/server/action-utils';
import { AppError } from '@/server/providers/types';
import { CampaignService } from '@/server/services/campaign-service';
import { ContactService } from '@/server/services/contact-service';
import { applyContactFilters, parseContactFilters } from '@/server/queries/contacts';
import type { DB } from '@/lib/supabase/types';

const uuid = z.string().uuid();
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM');

const detailsSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    description: z.string().trim().max(2000).nullable(),
    mode: z.enum(['simulated', 'live']),
    phone_number_id: uuid.nullable(),
    voice_agent_id: uuid.nullable(),
    calling_window_start: time,
    calling_window_end: time,
    max_attempts: z.coerce.number().int().min(1).max(5),
  })
  .refine((d) => d.calling_window_start.slice(0, 5) < d.calling_window_end.slice(0, 5), {
    message: 'Window end must be after start',
    path: ['calling_window_end'],
  });

const contactRow = z.object({
  full_name: z.string().nullable(),
  phone_e164: z.string(),
  business_name: z.string().nullable(),
  business_category: z.string().nullable(),
  city: z.string().nullable(),
  source: z.string(),
  consent_status: z.enum(CONSENT_STATUSES),
  dnd_status: z.enum(DND_STATUSES),
  notes: z.string().nullable(),
});

const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('csv'), rows: z.array(contactRow).min(1).max(5000), existing: z.enum(['skip', 'update']) }),
  z.object({ type: z.literal('filter'), filters: z.record(z.string(), z.string().optional()) }),
]);
export type CampaignAudience = z.infer<typeof audienceSchema>;
export type CampaignDetailsInput = z.input<typeof detailsSchema>;

function refresh(id?: string) {
  revalidatePath('/campaigns');
  revalidatePath('/');
  if (id) revalidatePath(`/campaigns/${id}`);
}

async function contactIdsForFilter(db: DB, raw: Record<string, string | undefined>) {
  const filters = parseContactFilters(raw);
  const ids: string[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    let q = db.from('contacts_with_stats').select('id');
    q = applyContactFilters(q, filters).order('created_at').order('id').range(offset, offset + 999);
    const { data, error } = await q;
    if (error) throw error;
    data?.forEach((r) => r.id && ids.push(r.id));
    if ((data?.length ?? 0) < 1000) break;
  }
  return ids;
}

async function audienceContactIds(db: DB, audience: CampaignAudience): Promise<string[]> {
  if (audience.type === 'none') return [];
  if (audience.type === 'csv') return (await ContactService.importContacts(db, audience.rows, audience.existing)).ids;
  return contactIdsForFilter(db, audience.filters);
}

export async function previewFilterAudience(raw: Record<string, string | undefined>): Promise<{ count: number; capped: boolean }> {
  const { db } = await assertRole('manager');
  const ids = await contactIdsForFilter(db, raw);
  return { count: ids.length, capped: ids.length >= 5000 };
}

export async function createCampaign(details: CampaignDetailsInput, audience: CampaignAudience): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const d = detailsSchema.parse(details);
    const a = audienceSchema.parse(audience);
    const { data: campaign, error } = await db.from('campaigns').insert(d).select('id').single();
    if (error) throw error;
    try {
      const ids = await audienceContactIds(db, a);
      const added = await CampaignService.enrollContacts(db, campaign.id, ids);
      refresh(campaign.id);
      return { ok: true, message: `Campaign created as draft with ${added} contact${added === 1 ? '' : 's'}.`, data: { id: campaign.id } };
    } catch (e) {
      // Compensate: do not leave a half-created campaign behind.
      await db.from('campaigns').delete().eq('id', campaign.id);
      throw e;
    }
  });
}

export async function updateCampaign(id: string, details: CampaignDetailsInput): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const d = detailsSchema.parse(details);
    const { data, error } = await db.from('campaigns').update(d).eq('id', uuid.parse(id)).in('status', ['draft', 'paused']).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Only draft or paused campaigns can be edited.' };
    refresh(id);
    return { ok: true, message: 'Campaign settings saved.' };
  });
}

export async function addCampaignContacts(id: string, audience: CampaignAudience): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const cid = uuid.parse(id);
    const { data: c } = await db.from('campaigns').select('status').eq('id', cid).single();
    if (!c || !['draft', 'paused'].includes(c.status)) return { ok: false, error: 'Contacts can only be added to draft or paused campaigns.' };
    const ids = await audienceContactIds(db, audienceSchema.parse(audience));
    const added = await CampaignService.enrollContacts(db, cid, ids);
    refresh(cid);
    const dup = ids.length - added;
    return { ok: true, message: `${added} contact${added === 1 ? '' : 's'} added${dup ? `, ${dup} already in campaign` : ''}.` };
  });
}

export async function removeCampaignContact(campaignId: string, campaignContactId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const { data, error } = await db.from('campaign_contacts').delete().eq('id', uuid.parse(campaignContactId)).eq('campaign_id', uuid.parse(campaignId)).eq('status', 'pending').select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'Only pending contacts can be removed.' };
    refresh(campaignId);
    return { ok: true, message: 'Contact removed from campaign.' };
  });
}

export async function transitionCampaign(id: string, to: 'running' | 'paused' | 'cancelled'): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    await CampaignService.transition(db, uuid.parse(id), z.enum(['running', 'paused', 'cancelled']).parse(to));
    refresh(id);
    const msg = { running: 'Campaign is running.', paused: 'Campaign paused.', cancelled: 'Campaign cancelled. Pending contacts were skipped.' }[to];
    return { ok: true, message: msg };
  });
}

export async function processCampaignBatch(id: string): Promise<ActionResult<{ processed: number; remaining: number; status: string; note: string | null }>> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const res = await CampaignService.processBatch(db, uuid.parse(id), 5);
    if (res.processed > 0 || res.status !== 'running') refresh(id);
    return { ok: true, message: res.status === 'completed' ? 'Campaign completed.' : `${res.processed} processed`, data: res };
  });
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  const res = await runAction<undefined>(async () => {
    const { db } = await assertRole('manager');
    const cid = uuid.parse(id);
    const { data: c } = await db.from('campaigns').select('status').eq('id', cid).maybeSingle();
    if (!c) throw new AppError('Campaign not found');
    if (c.status === 'running' || c.status === 'paused') return { ok: false, error: 'Cancel the campaign before deleting it.' };
    const { error } = await db.from('campaigns').delete().eq('id', cid);
    if (error) throw error;
    refresh();
    return { ok: true, message: 'Campaign deleted. Its call records are kept in Call Logs.' };
  });
  if (res.ok) redirect('/campaigns');
  return res;
}
