-- =============================================================================
-- Hot leads: contacts in the follow-up stages (interested, callback, meeting
-- booked, won) with their latest answered call, its reason and recording.
-- =============================================================================
create view public.hot_leads_view
with (security_invoker = true)
as
select
  c.id                as contact_id,
  c.full_name,
  c.phone_e164,
  c.business_name,
  c.city,
  c.lead_stage,
  c.lead_temperature,
  c.last_emotion,
  c.lead_updated_at,
  c.consent_status,
  c.dnd_status,
  k.id                as call_id,
  k.started_at        as last_call_at,
  k.direction         as last_call_direction,
  k.duration_seconds  as last_call_duration,
  left(sm.summary, 400) as why,
  exists (select 1 from public.call_recordings r where r.call_id = k.id) as has_recording,
  (select count(*)::integer from public.calls a where a.contact_id = c.id and a.status <> 'queued') as total_calls
from public.contacts c
left join lateral (
  select x.* from public.calls x
  where x.contact_id = c.id and x.answered_at is not null
  order by x.started_at desc
  limit 1
) k on true
left join public.call_summaries sm on sm.call_id = k.id
where c.lead_stage in ('interested', 'callback', 'meeting_booked', 'won');
grant select on public.hot_leads_view to authenticated;
revoke all on public.hot_leads_view from anon;
