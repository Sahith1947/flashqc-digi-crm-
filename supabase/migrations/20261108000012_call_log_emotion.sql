-- =============================================================================
-- Call Logs show the caller's emotion and recording at a glance.
-- Recreated (not replaced) so k.* also picks up columns added to calls later.
-- =============================================================================
drop view if exists public.call_log_view;
create view public.call_log_view
with (security_invoker = true)
as
select
  k.*,
  ct.full_name        as contact_name,
  ct.business_name    as business_name,
  cp.name             as campaign_name,
  pn.label            as phone_number_label,
  pn.phone_e164       as business_phone_e164,
  va.name             as voice_agent_name,
  exists (select 1 from public.call_recordings r where r.call_id = k.id) as has_recording,
  exists (select 1 from public.call_transcripts t where t.call_id = k.id) as has_transcript,
  sm.call_id is not null as has_summary,
  sm.emotion          as emotion,
  sm.sentiment        as sentiment,
  (k.answered_at is not null) as is_answered
from public.calls k
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id
left join public.phone_numbers pn on pn.id = k.phone_number_id
left join public.voice_agents va on va.id = k.voice_agent_id
left join public.call_summaries sm on sm.call_id = k.id;
grant select on public.call_log_view to authenticated;
revoke all on public.call_log_view from anon;

-- Placeholder only: the assign_call_number trigger always sets the real Call ID on insert.
alter table public.calls alter column call_number set default 0;
