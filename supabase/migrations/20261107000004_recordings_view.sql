-- Recording library view: one row per recording with its call context.
create or replace view public.recording_library_view
with (security_invoker = true)
as
select
  r.id,
  r.call_id,
  r.source,
  r.storage_bucket,
  r.storage_path,
  r.provider_recording_id,
  r.mime_type,
  r.size_bytes,
  coalesce(r.duration_seconds, k.duration_seconds) as duration_seconds,
  r.created_at,
  k.call_number,
  k.direction,
  k.status       as call_status,
  k.started_at   as call_started_at,
  k.phone_e164,
  k.contact_id,
  k.campaign_id,
  k.is_simulated,
  ct.full_name     as contact_name,
  ct.business_name as business_name,
  cp.name          as campaign_name,
  exists (select 1 from public.call_transcripts t where t.call_id = k.id) as has_transcript,
  exists (select 1 from public.call_summaries s where s.call_id = k.id) as has_summary
from public.call_recordings r
join public.calls k on k.id = r.call_id
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id;

grant select on public.recording_library_view to authenticated;
revoke all on public.recording_library_view from anon;
