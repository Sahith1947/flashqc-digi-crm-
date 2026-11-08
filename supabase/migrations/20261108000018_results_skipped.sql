-- =============================================================================
-- Campaign results: contacts skipped for compliance (DND, revoked consent,
-- suppression list) show as "skipped" instead of "not called yet".
-- =============================================================================
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
  case when k.id is null then (case when cc.status = 'skipped' then 'skipped' else 'pending' end) else public.call_interest(k.answered_at is not null, k.outcome, sm.emotion, k.duration_seconds) end as interest
from public.campaign_contacts cc
join public.contacts ct on ct.id = cc.contact_id
left join public.calls k on k.id = cc.last_call_id
left join public.call_summaries sm on sm.call_id = k.id;

