-- =============================================================================
-- One-time repair: live calls that were moved to a newer Sarvam campaign (after
-- a calling-hours change) were wrongly marked "failed" by the "Campaign Cancelled"
-- attempt of the replaced campaign. The real attempt from the new campaign was
-- then stored as a separate call row. This merges that row back into the original
-- call, or re-queues the call when its real attempt has not reported yet.
-- =============================================================================
do $$
declare
  r record;
  d public.calls%rowtype;
  dup uuid;
begin
  for r in
    select k.id, k.provider_call_id,
      (select e.payload->>'sarvam_campaign_id' from public.call_events e
        where e.call_id = k.id and e.event_type in ('submitted_to_sarvam', 'resubmitted_to_sarvam')
        order by e.occurred_at desc limit 1) as current_campaign
    from public.calls k
    where k.provider = 'sarvam' and k.direction = 'outbound' and k.provider_call_id is not null
      and exists (select 1 from public.call_events e where e.call_id = k.id and e.event_type = 'resubmitted_to_sarvam')
  loop
    -- Only calls whose stored attempt came from a campaign other than the current one.
    continue when r.current_campaign is null or exists (
      select 1 from public.call_events e
      where e.call_id = r.id and e.source = 'provider_webhook'
        and e.payload->>'attempt_id' = r.provider_call_id and e.payload->>'campaign_id' = r.current_campaign);

    -- Relabel the superseded attempt so the timeline explains what happened.
    update public.call_events set event_type = 'superseded_attempt', status = null
    where call_id = r.id and source = 'provider_webhook' and payload->>'attempt_id' = r.provider_call_id;

    dup := null;
    select e.call_id into dup from public.call_events e
    where e.source = 'provider_webhook' and e.call_id <> r.id
      and e.payload->>'user_identifier' = 'call:' || r.id::text
      and e.payload->>'campaign_id' = r.current_campaign
    order by e.occurred_at desc limit 1;

    if dup is not null then
      select * into d from public.calls where id = dup;
      -- Free the attempt id held by the duplicate row first (provider ids are unique).
      update public.calls set provider_call_id = null, status = 'failed' where id = dup;
      update public.calls set
        status = d.status, provider_call_id = d.provider_call_id, started_at = d.started_at,
        answered_at = d.answered_at, ended_at = d.ended_at, duration_seconds = d.duration_seconds,
        failure_reason = d.failure_reason, outcome = coalesce(outcome, d.outcome),
        contact_id = coalesce(contact_id, d.contact_id)
      where id = r.id;
      update public.call_events set call_id = r.id where call_id = dup;
      update public.call_transcripts set call_id = r.id where call_id = dup
        and not exists (select 1 from public.call_transcripts t where t.call_id = r.id);
      update public.call_summaries set call_id = r.id where call_id = dup
        and not exists (select 1 from public.call_summaries s where s.call_id = r.id);
      update public.call_recordings set call_id = r.id where call_id = dup
        and not exists (select 1 from public.call_recordings x where x.call_id = r.id);
      update public.campaign_contacts set last_call_id = r.id where last_call_id = dup;
      delete from public.calls where id = dup;
    elsif exists (
      select 1 from public.calls o join public.call_events e on e.call_id = o.id
      where o.id <> r.id and o.phone_e164 = (select phone_e164 from public.calls where id = r.id)
        and e.source = 'provider_webhook' and e.payload->>'campaign_id' = r.current_campaign
        and e.event_type <> 'superseded_attempt') then
      -- Same number was in the same Sarvam batch and Sarvam dialled it once (on the other call).
      update public.calls set status = 'canceled', provider_call_id = null,
        failure_reason = 'Duplicate request for the same number; Sarvam dialled it once (see the other call).'
      where id = r.id;
    else
      -- The real attempt has not reported yet: wait for it again.
      update public.calls set status = 'queued', provider_call_id = null, answered_at = null,
        ended_at = null, duration_seconds = 0, failure_reason = null
      where id = r.id;
    end if;
  end loop;
end $$;
