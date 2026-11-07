-- =============================================================================
-- FlashQC Digi – Call Operations CRM
-- Core schema: tables, constraints, indexes, timestamps.
-- All timestamps are stored as timestamptz (UTC). Display uses Asia/Kolkata.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per authenticated user (created by trigger on auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text check (char_length(full_name) <= 120),
  role        text not null default 'viewer'
              check (role in ('admin', 'manager', 'agent', 'viewer')),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'CRM users. New sign-ups are inactive until an admin activates them; the very first user becomes admin.';

create index profiles_role_idx on public.profiles (role) where is_active;

-- -----------------------------------------------------------------------------
-- app_settings: single-row organisation settings
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                            boolean primary key default true check (id),
  company_name                  text not null default 'FlashQC Digi' check (char_length(company_name) between 1 and 120),
  default_calling_window_start  time not null default '09:00',
  default_calling_window_end    time not null default '21:00',
  simulation_mode_enabled       boolean not null default true,
  updated_at                    timestamptz not null default now(),
  check (default_calling_window_start < default_calling_window_end)
);
insert into public.app_settings (id) values (true);

-- -----------------------------------------------------------------------------
-- voice_agents: AI voice agent configuration (provider-independent)
-- -----------------------------------------------------------------------------
create table public.voice_agents (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 120),
  description        text check (char_length(description) <= 1000),
  language           text not null default 'en-IN' check (char_length(language) between 2 and 20),
  voice              text check (char_length(voice) <= 80),
  provider           text not null default 'sarvam' check (provider in ('sarvam', 'other')),
  provider_agent_id  text check (char_length(provider_agent_id) <= 200),
  greeting           text check (char_length(greeting) <= 2000),
  instructions       text check (char_length(instructions) <= 20000),
  status             text not null default 'draft' check (status in ('draft', 'ready', 'disabled')),
  -- connection_status can only be changed by the backend (service role) after a verified provider check.
  connection_status  text not null default 'not_connected' check (connection_status in ('not_connected', 'connected', 'error')),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index voice_agents_name_key on public.voice_agents (lower(name));

-- -----------------------------------------------------------------------------
-- phone_numbers: business phone lines
-- -----------------------------------------------------------------------------
create table public.phone_numbers (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null check (char_length(label) between 1 and 120),
  phone_e164          text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider            text not null default 'unassigned'
                      check (provider in ('unassigned', 'sarvam', 'exotel', 'twilio', 'plivo', 'knowlarity', 'other')),
  provider_number_id  text check (char_length(provider_number_id) <= 200),
  can_inbound         boolean not null default true,
  can_outbound        boolean not null default true,
  enabled             boolean not null default true,
  voice_agent_id      uuid references public.voice_agents (id) on delete set null,
  connection_status   text not null default 'not_connected' check (connection_status in ('not_connected', 'connected', 'error')),
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (can_inbound or can_outbound)
);
create index phone_numbers_voice_agent_idx on public.phone_numbers (voice_agent_id);

-- -----------------------------------------------------------------------------
-- integrations: external provider status (NO secrets – those live in server env)
-- -----------------------------------------------------------------------------
create table public.integrations (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key in ('sarvam_ai', 'telephony', 'recording_storage')),
  display_name     text not null,
  provider         text,
  status           text not null default 'not_configured'
                   check (status in ('not_configured', 'configured', 'connected', 'error')),
  config           jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  last_checked_at  timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
insert into public.integrations (key, display_name, provider) values
  ('sarvam_ai', 'Sarvam AI (Voice Agents, Transcription, Summaries)', 'sarvam'),
  ('telephony', 'Telephony Provider', null),
  ('recording_storage', 'Recording Storage', 'supabase_storage');

-- -----------------------------------------------------------------------------
-- contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text check (char_length(full_name) <= 200),
  phone_e164         text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  business_name      text check (char_length(business_name) <= 200),
  business_category  text check (char_length(business_category) <= 120),
  city               text check (char_length(city) <= 120),
  source             text not null default 'manual' check (char_length(source) between 1 and 60),
  consent_status     text not null default 'unknown' check (consent_status in ('unknown', 'granted', 'revoked')),
  dnd_status         text not null default 'unknown' check (dnd_status in ('unknown', 'not_registered', 'registered')),
  notes              text check (char_length(notes) <= 5000),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index contacts_created_at_idx on public.contacts (created_at desc);
create index contacts_city_idx on public.contacts (lower(city));
create index contacts_category_idx on public.contacts (lower(business_category));
create index contacts_search_idx on public.contacts
  using gin (to_tsvector('simple', coalesce(full_name, '') || ' ' || coalesce(business_name, '') || ' ' || phone_e164));

-- -----------------------------------------------------------------------------
-- suppression_list: numbers that must never be called
-- -----------------------------------------------------------------------------
create table public.suppression_list (
  id          uuid primary key default gen_random_uuid(),
  phone_e164  text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason      text check (char_length(reason) <= 500),
  source      text not null default 'manual' check (source in ('manual', 'opt_out', 'dnd', 'complaint')),
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- campaigns
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 160),
  description           text check (char_length(description) <= 2000),
  mode                  text not null default 'simulated' check (mode in ('simulated', 'live')),
  status                text not null default 'draft'
                        check (status in ('draft', 'running', 'paused', 'completed', 'cancelled')),
  phone_number_id       uuid references public.phone_numbers (id) on delete set null,
  voice_agent_id        uuid references public.voice_agents (id) on delete set null,
  calling_window_start  time not null default '09:00',
  calling_window_end    time not null default '21:00',
  max_attempts          smallint not null default 1 check (max_attempts between 1 and 5),
  started_at            timestamptz,
  paused_at             timestamptz,
  completed_at          timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (calling_window_start < calling_window_end)
);
create index campaigns_status_idx on public.campaigns (status);
create index campaigns_created_at_idx on public.campaigns (created_at desc);

-- -----------------------------------------------------------------------------
-- calls
-- -----------------------------------------------------------------------------
create table public.calls (
  id                   uuid primary key default gen_random_uuid(),
  call_number          bigint generated always as identity unique,
  direction            text not null check (direction in ('inbound', 'outbound')),
  status               text not null default 'queued'
                       check (status in ('queued', 'ringing', 'in_progress', 'completed', 'no_answer', 'busy', 'failed', 'canceled', 'missed')),
  contact_id           uuid references public.contacts (id) on delete set null,
  phone_e164           text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_number_id      uuid references public.phone_numbers (id) on delete set null,
  voice_agent_id       uuid references public.voice_agents (id) on delete set null,
  campaign_id          uuid references public.campaigns (id) on delete set null,
  started_at           timestamptz not null default now(),
  answered_at          timestamptz,
  ended_at             timestamptz,
  duration_seconds     integer not null default 0 check (duration_seconds >= 0),
  outcome              text check (outcome in ('interested', 'not_interested', 'callback_requested', 'wrong_number',
                                               'voicemail', 'do_not_call', 'converted', 'no_response', 'other')),
  notes                text check (char_length(notes) <= 5000),
  is_simulated         boolean not null default false,
  provider             text check (char_length(provider) <= 60),
  provider_call_id     text check (char_length(provider_call_id) <= 200),
  failure_reason       text check (char_length(failure_reason) <= 500),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- A real (non-simulated) call can only progress beyond queued/failed/canceled
  -- when a provider has confirmed it (provider_call_id present).
  constraint calls_real_call_verified check (
    is_simulated or provider_call_id is not null or status in ('queued', 'failed', 'canceled')
  ),
  constraint calls_answer_after_start check (answered_at is null or answered_at >= started_at),
  constraint calls_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint calls_inbound_missed check (status <> 'missed' or direction = 'inbound')
);
create unique index calls_provider_call_key on public.calls (provider, provider_call_id) where provider_call_id is not null;
create index calls_started_at_idx on public.calls (started_at desc);
create index calls_direction_started_idx on public.calls (direction, started_at desc);
create index calls_status_idx on public.calls (status);
create index calls_contact_idx on public.calls (contact_id, started_at desc);
create index calls_campaign_idx on public.calls (campaign_id, started_at desc);
create index calls_phone_idx on public.calls (phone_e164);
create index calls_phone_number_idx on public.calls (phone_number_id);
create index calls_voice_agent_idx on public.calls (voice_agent_id);

-- -----------------------------------------------------------------------------
-- campaign_contacts: contacts enrolled in a campaign + per-contact outcome
-- -----------------------------------------------------------------------------
create table public.campaign_contacts (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  status           text not null default 'pending'
                   check (status in ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  skip_reason      text check (char_length(skip_reason) <= 300),
  attempts         smallint not null default 0 check (attempts >= 0),
  last_call_id     uuid references public.calls (id) on delete set null,
  outcome          text,
  last_attempt_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index campaign_contacts_status_idx on public.campaign_contacts (campaign_id, status);
create index campaign_contacts_contact_idx on public.campaign_contacts (contact_id);
create index campaign_contacts_last_call_idx on public.campaign_contacts (last_call_id);

-- -----------------------------------------------------------------------------
-- call_events: immutable timeline of a call (status changes, webhooks, notes)
-- -----------------------------------------------------------------------------
create table public.call_events (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references public.calls (id) on delete cascade,
  event_type   text not null check (char_length(event_type) between 1 and 60),
  status       text,
  source       text not null check (source in ('simulator', 'provider_webhook', 'user', 'system')),
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index call_events_call_idx on public.call_events (call_id, occurred_at);

-- -----------------------------------------------------------------------------
-- call_recordings
-- -----------------------------------------------------------------------------
create table public.call_recordings (
  id                      uuid primary key default gen_random_uuid(),
  call_id                 uuid not null references public.calls (id) on delete cascade,
  source                  text not null check (source in ('upload', 'provider')),
  storage_bucket          text,
  storage_path            text,
  provider_recording_id   text check (char_length(provider_recording_id) <= 200),
  mime_type               text check (char_length(mime_type) <= 100),
  size_bytes              bigint check (size_bytes >= 0),
  duration_seconds        integer check (duration_seconds >= 0),
  uploaded_by             uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  -- We never store invented URLs: either a real object in our storage bucket,
  -- or a provider recording reference that is resolved server-side.
  check ((storage_bucket is not null and storage_path is not null) or provider_recording_id is not null)
);
create index call_recordings_call_idx on public.call_recordings (call_id);
create index call_recordings_created_idx on public.call_recordings (created_at desc);
create unique index call_recordings_storage_key on public.call_recordings (storage_bucket, storage_path) where storage_path is not null;

-- -----------------------------------------------------------------------------
-- call_transcripts (one per call)
-- -----------------------------------------------------------------------------
create table public.call_transcripts (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null unique references public.calls (id) on delete cascade,
  language    text check (char_length(language) <= 20),
  content     text not null check (char_length(content) between 1 and 200000),
  segments    jsonb check (segments is null or jsonb_typeof(segments) = 'array'),
  source      text not null check (source in ('manual', 'provider', 'ai')),
  provider    text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- call_summaries (one per call)
-- -----------------------------------------------------------------------------
create table public.call_summaries (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null unique references public.calls (id) on delete cascade,
  summary            text not null check (char_length(summary) between 1 and 20000),
  key_points         jsonb check (key_points is null or jsonb_typeof(key_points) = 'array'),
  sentiment          text check (sentiment in ('positive', 'neutral', 'negative')),
  suggested_outcome  text,
  source             text not null check (source in ('manual', 'ai')),
  model              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- audit_logs (written only by triggers)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_table_idx on public.audit_logs (table_name, record_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','app_settings','voice_agents','phone_numbers','integrations','contacts',
                           'campaigns','calls','campaign_contacts','call_transcripts','call_summaries']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
