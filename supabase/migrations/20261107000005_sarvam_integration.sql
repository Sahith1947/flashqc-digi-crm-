-- =============================================================================
-- Sarvam AI integration: credential storage and provider-sync columns.
-- =============================================================================

-- Encrypted provider credentials (OAuth tokens). Ciphertext is AES-256-GCM,
-- encrypted by the app server with INTEGRATION_ENCRYPTION_KEY, so neither the
-- database nor its backups hold usable tokens. No end-user role can read it:
-- RLS is on with no policies and privileges are revoked.
create table public.integration_credentials (
  key         text primary key check (key in ('sarvam_ai', 'sarvam_ai_pending')),
  ciphertext  text not null,
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.integration_credentials is 'Encrypted provider tokens. Backend (service role) only. metadata holds non-secret facts (account email, expiry).';
alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, authenticated;
create trigger set_updated_at before update on public.integration_credentials
  for each row execute function public.set_updated_at();

-- Provider-side state of voice agents, written only by a verified sync.
alter table public.voice_agents
  add column provider_status     text check (char_length(provider_status) <= 40),
  add column provider_version    integer check (provider_version >= 0),
  add column provider_deployed   boolean,
  add column provider_synced_at  timestamptz;
create unique index voice_agents_provider_agent_key
  on public.voice_agents (provider, provider_agent_id) where provider_agent_id is not null;

-- Provider-side state of phone numbers.
alter table public.phone_numbers
  add column provider_connection_id  text check (char_length(provider_connection_id) <= 200),
  add column provider_synced_at      timestamptz;

-- Extend the connection guard: synced provider fields are backend-only too.
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

-- Sarvam's telephony connection in this workspace uses Vobiz.
alter table public.phone_numbers drop constraint phone_numbers_provider_check;
alter table public.phone_numbers add constraint phone_numbers_provider_check
  check (provider in ('unassigned', 'sarvam', 'vobiz', 'exotel', 'twilio', 'plivo', 'knowlarity', 'other'));
