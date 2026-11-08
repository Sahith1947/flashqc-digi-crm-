-- =============================================================================
-- Vobiz call recordings: the CRM stores the Vobiz API keys encrypted (backend
-- only, like the Sarvam tokens) and pulls each call's recording from Vobiz.
-- =============================================================================
alter table public.integration_credentials drop constraint if exists integration_credentials_key_check;
alter table public.integration_credentials add constraint integration_credentials_key_check
  check (key in ('sarvam_ai', 'sarvam_ai_pending', 'vobiz'));

-- A Vobiz recording is attached to at most one call.
create unique index if not exists call_recordings_provider_recording_key
  on public.call_recordings (provider_recording_id) where provider_recording_id like 'vobiz:%';
