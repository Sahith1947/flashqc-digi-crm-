-- =============================================================================
-- Database security & logic tests. Run with:  npm run test:db
-- Everything runs inside a transaction that is rolled back.
-- Any failed assertion raises an exception and aborts with a non-zero exit.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create or replace function pg_temp.as_backend() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS (blocked): %  [%]', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: expected error for: %', p_label;
end $$;

create or replace function pg_temp.expect(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap users: first user becomes admin; later users are inactive viewers
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', '{"full_name":"Admin"}', 'authenticated', 'authenticated');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'agent@test.local',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'viewer@test.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'pending@test.local', 'authenticated', 'authenticated');

select pg_temp.expect((select role = 'admin' and is_active from public.profiles where email = 'admin@test.local'), 'first user is active admin');
select pg_temp.expect((select role = 'viewer' and not is_active from public.profiles where email = 'manager@test.local'), 'later users start inactive viewers');

-- Admin activates and assigns roles
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update public.profiles set role = 'manager', is_active = true where email = 'manager@test.local';
update public.profiles set role = 'agent',   is_active = true where email = 'agent@test.local';
update public.profiles set role = 'viewer',  is_active = true where email = 'viewer@test.local';
select pg_temp.expect((select count(*) = 4 from public.profiles where is_active), 'admin activated 3 users');
select pg_temp.expect_error($$update public.profiles set role = 'agent' where email = 'admin@test.local'$$, 'cannot demote last admin');

-- ---------------------------------------------------------------------------
-- Anonymous and pending users see nothing
-- ---------------------------------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.expect_error($$select * from public.contacts$$, 'anon cannot read contacts');
select pg_temp.expect_error($$select * from public.calls$$, 'anon cannot read calls');

select pg_temp.as_backend();
insert into public.contacts (full_name, phone_e164) values ('Seed Contact', '+919800000001');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect((select count(*) = 0 from public.contacts), 'pending user sees no contacts');
select pg_temp.expect((select count(*) = 1 from public.profiles), 'pending user sees only own profile');
select pg_temp.expect_error($$insert into public.contacts (phone_e164) values ('+919800000002')$$, 'pending user cannot insert contacts');
select pg_temp.expect_error($$update public.profiles set role = 'admin', is_active = true where email = 'pending@test.local'$$, 'pending user cannot self-promote');

-- ---------------------------------------------------------------------------
-- Viewer: read-only
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select count(*) = 1 from public.contacts), 'viewer can read contacts');
select pg_temp.expect_error($$insert into public.contacts (phone_e164) values ('+919800000003')$$, 'viewer cannot insert contacts');
update public.contacts set notes = 'x';
select pg_temp.as_backend();
select pg_temp.expect((select notes is null from public.contacts where phone_e164 = '+919800000001'), 'viewer update affected no rows');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select * from public.audit_logs limit 1$$ || $$ ; select 1/(select count(*) from public.audit_logs)$$, 'viewer cannot read audit logs');

-- ---------------------------------------------------------------------------
-- Agent: contacts + calls, but no campaigns / config / deletes
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into public.contacts (full_name, phone_e164, city) values ('Agent Contact', '+919800000004', 'Hyderabad');
select pg_temp.expect_error($$insert into public.contacts (phone_e164) values ('+919800000004')$$, 'duplicate phone rejected');
select pg_temp.expect_error($$insert into public.contacts (phone_e164) values ('98000')$$, 'invalid E.164 rejected');
select pg_temp.expect_error($$insert into public.campaigns (name) values ('Agent campaign')$$, 'agent cannot create campaigns');
select pg_temp.expect_error($$insert into public.phone_numbers (label, phone_e164) values ('L', '+914000000000')$$, 'agent cannot add phone numbers');
delete from public.contacts where phone_e164 = '+919800000004';
select pg_temp.expect((select count(*) = 1 from public.contacts where phone_e164 = '+919800000004'), 'agent delete affected no rows');

-- Real calls cannot be fabricated by users
select pg_temp.expect_error($$insert into public.calls (direction, status, phone_e164) values ('outbound', 'completed', '+919800000004')$$,
  'user cannot insert completed real call');
select pg_temp.expect_error($$insert into public.calls (direction, status, phone_e164, provider_call_id, provider) values ('outbound', 'queued', '+919800000004', 'fake', 'x')$$,
  'user cannot insert real call with provider id');
insert into public.calls (direction, status, phone_e164) values ('outbound', 'queued', '+919800000004');
select pg_temp.expect_error($$update public.calls set status = 'completed' where not is_simulated$$, 'user cannot complete a real call');
select pg_temp.expect_error($$update public.calls set duration_seconds = 60 where not is_simulated$$, 'user cannot set real call duration');
select pg_temp.expect_error($$update public.calls set is_simulated = true where not is_simulated$$, 'user cannot flip is_simulated');
update public.calls set status = 'failed', failure_reason = 'provider not configured' where not is_simulated;
select pg_temp.expect((select status = 'failed' from public.calls where not is_simulated), 'user can mark queued real call failed');
update public.calls set outcome = 'other', notes = 'note' where not is_simulated;
select pg_temp.expect((select outcome = 'other' from public.calls where not is_simulated), 'user can set outcome/notes on real call');
select pg_temp.expect_error($$insert into public.call_events (call_id, event_type, source) select id, 'answered', 'provider_webhook' from public.calls limit 1$$,
  'user cannot forge provider webhook events');
select pg_temp.expect_error($$insert into public.call_events (call_id, event_type, source) select id, 'answered', 'simulator' from public.calls where not is_simulated limit 1$$,
  'user cannot add simulator events to real call');

-- Simulated calls are fully writable by agents
insert into public.calls (direction, status, phone_e164, is_simulated, answered_at, ended_at, duration_seconds, started_at)
values ('outbound', 'completed', '+919800000004', true, now() - interval '1 minute', now(), 60, now() - interval '2 minutes');
insert into public.call_events (call_id, event_type, status, source) select id, 'completed', 'completed', 'simulator' from public.calls where is_simulated;
select pg_temp.expect((select count(*) = 1 from public.call_events), 'agent can add simulator events to simulated call');

-- Transcripts/summaries: only manual from users
select pg_temp.expect_error($$insert into public.call_summaries (call_id, summary, source) select id, 'AI says', 'ai' from public.calls limit 1$$,
  'user cannot insert AI-sourced summary');
insert into public.call_summaries (call_id, summary, source) select id, 'Manual summary', 'manual' from public.calls where is_simulated;
select pg_temp.expect_error($$insert into public.call_recordings (call_id, source, provider_recording_id) select id, 'provider', 'x' from public.calls limit 1$$,
  'user cannot insert provider recording');

-- ---------------------------------------------------------------------------
-- Manager: config + campaigns, but cannot flip connection status
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.voice_agents (name, connection_status) values ('Priya', 'connected');
select pg_temp.expect((select connection_status = 'not_connected' from public.voice_agents where name = 'Priya'), 'insert cannot claim connected agent');
select pg_temp.expect_error($$update public.voice_agents set connection_status = 'connected'$$, 'manager cannot mark agent connected');
insert into public.phone_numbers (label, phone_e164) values ('Main line', '+914012345678');
select pg_temp.expect_error($$update public.phone_numbers set connection_status = 'connected'$$, 'manager cannot mark number connected');
update public.integrations set config = '{"hacked":true}' where key = 'telephony';
select pg_temp.expect((select config = '{}'::jsonb from public.integrations where key = 'telephony'), 'manager update of integrations affected no rows');
insert into public.campaigns (name) values ('Manager campaign');
insert into public.campaign_contacts (campaign_id, contact_id) select cp.id, c.id from public.campaigns cp, public.contacts c;
select pg_temp.expect((select contacts_total = 2 from public.campaign_stats), 'campaign_stats counts contacts');
select pg_temp.expect_error($$insert into public.campaign_contacts (campaign_id, contact_id) select cp.id, c.id from public.campaigns cp, public.contacts c$$,
  'duplicate campaign contact rejected');
select pg_temp.expect_error($$update public.app_settings set company_name = 'X'$$ || $$; select 1/(select count(*) from public.app_settings where company_name = 'X')$$,
  'manager cannot change org settings');

-- ---------------------------------------------------------------------------
-- Auto-approved admin emails (e.g. Google sign-in of a listed Gmail address)
-- ---------------------------------------------------------------------------
select pg_temp.as_backend();
update public.app_settings set admin_emails = array['listed.owner@gmail.com'];
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('00000000-0000-0000-0000-0000000000f1', 'Listed.Owner@Gmail.com', '{"name":"Listed Owner"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-0000000000f2', 'someone.else@gmail.com', '{"name":"Someone"}', 'authenticated', 'authenticated');
select pg_temp.expect((select role = 'admin' and is_active and full_name = 'Listed Owner' from public.profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  'listed email (case-insensitive) becomes active admin with Google name');
select pg_temp.expect((select role = 'viewer' and not is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  'unlisted Google user waits for approval');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
update public.app_settings set admin_emails = array['attacker@gmail.com'];
select pg_temp.as_backend();
select pg_temp.expect((select admin_emails = array['listed.owner@gmail.com'] from public.app_settings), 'manager cannot change admin email list');

-- ---------------------------------------------------------------------------
-- Sarvam integration: tokens are backend-only; synced fields are backend-only
-- ---------------------------------------------------------------------------
select pg_temp.as_backend();
insert into public.integration_credentials (key, ciphertext) values ('sarvam_ai', 'v1.x.y.z');
insert into public.voice_agents (name, provider, provider_agent_id, provider_status, provider_synced_at, connection_status)
  values ('Synced Agent', 'sarvam', 'Conv-123', 'draft', now(), 'connected');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select * from public.integration_credentials$$, 'admin session cannot read stored provider tokens');
select pg_temp.expect_error($$delete from public.integration_credentials$$, 'admin session cannot delete stored provider tokens');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$update public.voice_agents set provider_status = 'deployed' where name = 'Synced Agent'$$, 'manager cannot fake Sarvam agent status');
select pg_temp.expect_error($$update public.voice_agents set provider_agent_id = 'other' where name = 'Synced Agent'$$, 'manager cannot re-point a synced agent');
update public.voice_agents set status = 'ready', instructions = 'CRM notes' where name = 'Synced Agent';
select pg_temp.expect((select status = 'ready' from public.voice_agents where name = 'Synced Agent'), 'manager can edit CRM-side fields of synced agent');
insert into public.voice_agents (name, provider_status, provider_synced_at) values ('Sneaky', 'deployed', now());
select pg_temp.expect((select provider_status is null and provider_synced_at is null from public.voice_agents where name = 'Sneaky'), 'insert cannot claim synced provider state');
insert into public.phone_numbers (label, phone_e164, provider) values ('Vobiz line', '+914099999999', 'vobiz');
select pg_temp.expect_error($$update public.phone_numbers set provider_synced_at = now() where label = 'Vobiz line'$$, 'manager cannot fake number sync');

-- Sarvam campaign link is backend-only
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into public.campaigns (name, mode, provider, provider_campaign_id) values ('Sneaky live', 'live', 'sarvam', 'fake-id');
select pg_temp.expect((select provider_campaign_id is null and provider is null from public.campaigns where name = 'Sneaky live'), 'insert cannot claim a Sarvam campaign link');
select pg_temp.expect_error($$update public.campaigns set provider_campaign_id = 'x' where name = 'Sneaky live'$$, 'manager cannot set Sarvam campaign link');
select pg_temp.expect_error($$update public.voice_agents set provider_committed_version = 9 where name = 'Synced Agent'$$, 'manager cannot fake published agent version');

-- ---------------------------------------------------------------------------
-- Admin: integrations config (not status), audit log
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update public.integrations set config = '{"region":"in"}' where key = 'telephony';
select pg_temp.expect_error($$update public.integrations set status = 'connected' where key = 'telephony'$$, 'admin cannot fake integration status');
select pg_temp.expect((select count(*) > 0 from public.audit_logs where table_name = 'contacts'), 'audit log recorded contact insert');
select pg_temp.expect((select count(*) > 0 from public.audit_logs where table_name = 'profiles' and action = 'update'), 'audit log recorded role change');

-- Backend (service role) may set verified provider state
select pg_temp.as_backend();
update public.calls set status = 'completed', provider = 'test', provider_call_id = 'p-1', answered_at = started_at, ended_at = started_at + interval '30 seconds', duration_seconds = 30
  where not is_simulated;
select pg_temp.expect((select status = 'completed' from public.calls where provider_call_id = 'p-1'), 'backend can record verified provider result');
select pg_temp.expect_error($$update public.calls set provider_call_id = null where provider_call_id = 'p-1'$$, 'real completed call must keep provider id (check constraint)');

-- ---------------------------------------------------------------------------
-- Analytics calculations
-- ---------------------------------------------------------------------------
insert into public.calls (direction, status, phone_e164, is_simulated, started_at) values
  ('inbound', 'missed', '+919800000005', true, now() - interval '1 hour'),
  ('outbound', 'failed', '+919800000006', true, now() - interval '1 hour'),
  ('outbound', 'no_answer', '+919800000007', true, now() - interval '3 days');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect(
  (select (s->>'total')::int = 5 and (s->>'inbound')::int = 1 and (s->>'outbound')::int = 4
          and (s->>'answered')::int = 2 and (s->>'missed')::int = 2 and (s->>'failed')::int = 1
          and (s->>'talk_time_seconds')::int = 90 and (s->>'avg_duration_seconds')::int = 45 and (s->>'simulated')::int = 4
   from public.dashboard_summary(now() - interval '30 days', now() + interval '1 day', 'all') s),
  'dashboard_summary totals are correct');
select pg_temp.expect(
  (select (s->>'total')::int = 1 from public.dashboard_summary(now() - interval '30 days', now() + interval '1 day', 'live') s),
  'dashboard_summary live scope excludes simulated');
select pg_temp.expect(
  (select count(*) = 8 and sum(total) = 5 from public.call_trends(now() - interval '7 days', now() + interval '1 second', 'day', 'all')),
  'call_trends fills daily gaps and sums to total');
select pg_temp.expect((select sum(total) = 5 and count(*) = 24 from public.hourly_distribution(now() - interval '30 days', now() + interval '1 day', 'all')),
  'hourly_distribution covers 24 hours');
select pg_temp.as_backend();
update public.calls set contact_id = (select id from public.contacts where phone_e164 = '+919800000004') where phone_e164 = '+919800000004';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect((select total_calls = 2 and last_call_status is not null from public.contacts_with_stats where phone_e164 = '+919800000004'),
  'contacts_with_stats computes total calls and last status');

-- Call IDs stay continuous after deletes, and cannot be edited by users.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$update public.calls set call_number = 999 where call_number = 1$$, 'agent cannot change a Call ID');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.calls set call_number = 999 where call_number = 1$$, 'admin cannot change a Call ID by hand');
delete from public.calls where call_number in (select min(call_number) from public.calls);
select pg_temp.expect((select min(call_number) = 1 and max(call_number) = count(*) from public.calls), 'Call IDs are renumbered 1..N after an admin deletes a call');
insert into public.calls (direction, status, phone_e164, is_simulated) values ('outbound', 'completed', '+919800000008', true);
select pg_temp.expect((select call_number = (select count(*) from public.calls) from public.calls where phone_e164 = '+919800000008'), 'new call takes the next Call ID');

rollback;
\echo 'ALL DATABASE TESTS PASSED'
