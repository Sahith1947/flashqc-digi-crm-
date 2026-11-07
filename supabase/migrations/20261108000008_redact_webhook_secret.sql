-- Never keep the Sarvam webhook secret in stored call events.
update public.call_events
set payload = payload #- '{metadata,crm_secret}'
where source = 'provider_webhook' and payload -> 'metadata' ? 'crm_secret';
