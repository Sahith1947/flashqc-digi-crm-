-- =============================================================================
-- Live calling through Sarvam: campaign links, published agent version,
-- provider-hosted recordings, and the CRM's direct-call campaign.
-- =============================================================================

-- CRM campaign ↔ Sarvam campaign (set only by the backend).
alter table public.campaigns
  add column provider text check (provider in ('sarvam')),
  add column provider_campaign_id text check (char_length(provider_campaign_id) <= 200),
  add column provider_synced_at timestamptz;
create unique index campaigns_provider_campaign_key on public.campaigns (provider, provider_campaign_id) where provider_campaign_id is not null;

create or replace function public.guard_campaign_provider()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_backend_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.provider := null;
    new.provider_campaign_id := null;
    new.provider_synced_at := null;
  elsif new.provider is distinct from old.provider
     or new.provider_campaign_id is distinct from old.provider_campaign_id
     or new.provider_synced_at is distinct from old.provider_synced_at then
    raise exception 'Provider campaign fields are set only by the backend';
  end if;
  return new;
end;
$$;
create trigger guard_campaign_provider before insert or update on public.campaigns
  for each row execute function public.guard_campaign_provider();

-- Latest published (committed) Sarvam version; campaigns must use one.
alter table public.voice_agents add column provider_committed_version integer check (provider_committed_version >= 0);

-- Extend the agent guard to the new column.
create or replace function public.guard_connection_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_backend_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.connection_status := 'not_connected';
    if tg_table_name = 'voice_agents' then
      new.provider_status := null;
      new.provider_version := null;
      new.provider_committed_version := null;
      new.provider_deployed := null;
      new.provider_synced_at := null;
    else
      new.provider_connection_id := null;
      new.provider_synced_at := null;
    end if;
    return new;
  end if;
  if new.connection_status is distinct from old.connection_status then
    raise exception 'Connection status is set only by a verified provider check';
  end if;
  if tg_table_name = 'voice_agents' then
    if new.provider_status is distinct from old.provider_status
       or new.provider_version is distinct from old.provider_version
       or new.provider_committed_version is distinct from old.provider_committed_version
       or new.provider_deployed is distinct from old.provider_deployed
       or new.provider_synced_at is distinct from old.provider_synced_at
       or (old.provider_synced_at is not null and new.provider_agent_id is distinct from old.provider_agent_id) then
      raise exception 'Provider-synced fields are set only by a provider sync';
    end if;
  else
    if new.provider_connection_id is distinct from old.provider_connection_id
       or new.provider_synced_at is distinct from old.provider_synced_at
       or (old.provider_synced_at is not null and new.phone_e164 is distinct from old.phone_e164) then
      raise exception 'Provider-synced fields are set only by a provider sync';
    end if;
  end if;
  return new;
end;
$$;

-- Provider recordings arrive as a URL (can exceed the id length limit).
alter table public.call_recordings add column provider_recording_url text check (char_length(provider_recording_url) <= 4000);
alter table public.call_recordings drop constraint if exists call_recordings_check;
alter table public.call_recordings add constraint call_recordings_has_media check (
  (storage_bucket is not null and storage_path is not null)
  or provider_recording_id is not null
  or provider_recording_url is not null
);
create unique index call_recordings_provider_key on public.call_recordings (call_id, provider_recording_url) where provider_recording_url is not null;

-- The always-on Sarvam campaign that carries one-off "Live call" requests from the CRM.
alter table public.app_settings
  add column sarvam_direct_campaign_id text check (char_length(sarvam_direct_campaign_id) <= 200),
  add column sarvam_direct_campaign_key text check (char_length(sarvam_direct_campaign_key) <= 400),
  add column sarvam_inbound_webhook_at timestamptz;

-- Refresh the library view so it exposes the provider recording URL.
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
  exists (select 1 from public.call_summaries s where s.call_id = k.id) as has_summary,
  r.provider_recording_url
from public.call_recordings r
join public.calls k on k.id = r.call_id
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id;
