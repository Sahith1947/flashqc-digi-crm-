-- =============================================================================
-- Sarvam call recordings through the Analytics API (needs a Sarvam API key,
-- stored encrypted and readable by the backend only).
-- =============================================================================
alter table public.integration_credentials drop constraint if exists integration_credentials_key_check;
alter table public.integration_credentials add constraint integration_credentials_key_check
  check (key in ('sarvam_ai', 'sarvam_ai_pending', 'vobiz', 'sarvam_api_key'));

-- One Sarvam recording reference per call.
create unique index if not exists call_recordings_sarvam_key
  on public.call_recordings (call_id) where provider_recording_id like 'sarvam:%';
