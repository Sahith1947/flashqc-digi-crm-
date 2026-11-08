-- =============================================================================
-- One simple "interest" per call, used by Call Logs and campaign results:
--   interested · callback · confused · not_interested · no_answer · unclear
-- Derived from the AI call analysis (outcome) and the detected emotion, so it
-- also follows a manual outcome change.
-- =============================================================================
create or replace function public.call_interest(p_answered boolean, p_outcome text, p_emotion text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not coalesce(p_answered, false) then 'no_answer'
    when p_outcome = 'callback_requested' then 'callback'
    when p_outcome in ('converted', 'interested') then 'interested'
    when p_outcome in ('not_interested', 'do_not_call', 'wrong_number') then 'not_interested'
    when p_emotion = 'Confused' then 'confused'
    when p_emotion in ('Excited', 'Interested') then 'interested'
    when p_emotion in ('Disinterested', 'Annoyed') then 'not_interested'
    else 'unclear'
  end;
$$;

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
  (k.answered_at is not null) as is_answered,
  public.call_interest(k.answered_at is not null, k.outcome, sm.emotion) as interest
from public.calls k
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id
left join public.phone_numbers pn on pn.id = k.phone_number_id
left join public.voice_agents va on va.id = k.voice_agent_id
left join public.call_summaries sm on sm.call_id = k.id;
grant select on public.call_log_view to authenticated;
revoke all on public.call_log_view from anon;

-- Campaign results: each enrolled contact with its latest call, interest, funnel stage and the AI's reason.
create view public.campaign_results_view
with (security_invoker = true)
as
select
  cc.id               as campaign_contact_id,
  cc.campaign_id,
  cc.status           as contact_status,
  cc.attempts,
  cc.skip_reason,
  cc.last_attempt_at,
  cc.created_at,
  ct.id               as contact_id,
  ct.full_name,
  ct.phone_e164,
  ct.business_name,
  ct.lead_stage,
  ct.lead_temperature,
  k.id                as call_id,
  k.status            as call_status,
  k.duration_seconds,
  (k.answered_at is not null) as is_answered,
  k.outcome,
  sm.emotion,
  left(sm.summary, 400) as summary,
  exists (select 1 from public.call_recordings r where r.call_id = k.id) as has_recording,
  case when k.id is null then 'pending' else public.call_interest(k.answered_at is not null, k.outcome, sm.emotion) end as interest
from public.campaign_contacts cc
join public.contacts ct on ct.id = cc.contact_id
left join public.calls k on k.id = cc.last_call_id
left join public.call_summaries sm on sm.call_id = k.id;
grant select on public.campaign_results_view to authenticated;
revoke all on public.campaign_results_view from anon;
