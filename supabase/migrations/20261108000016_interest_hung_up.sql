-- =============================================================================
-- "Hung up early": answered calls of 12 seconds or less with no clear signal
-- (most short campaign calls), instead of the vaguer "needs review".
-- =============================================================================
create or replace function public.call_interest(p_answered boolean, p_outcome text, p_emotion text, p_duration integer)
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
    when coalesce(p_duration, 0) <= 12 then 'hung_up'
    else 'unclear'
  end;
$$;

create or replace view public.call_log_view
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
  public.call_interest(k.answered_at is not null, k.outcome, sm.emotion, k.duration_seconds) as interest
from public.calls k
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id
left join public.phone_numbers pn on pn.id = k.phone_number_id
left join public.voice_agents va on va.id = k.voice_agent_id
left join public.call_summaries sm on sm.call_id = k.id;

create or replace view public.campaign_results_view
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
  case when k.id is null then 'pending' else public.call_interest(k.answered_at is not null, k.outcome, sm.emotion, k.duration_seconds) end as interest
from public.campaign_contacts cc
join public.contacts ct on ct.id = cc.contact_id
left join public.calls k on k.id = cc.last_call_id
left join public.call_summaries sm on sm.call_id = k.id;

drop function if exists public.call_interest(boolean, text, text);
