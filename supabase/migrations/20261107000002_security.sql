-- =============================================================================
-- Security: roles, guards, Row Level Security, audit logging, storage.
--
-- Role ladder (lowest → highest): viewer < agent < manager < admin
--   viewer  : read-only access to all CRM data
--   agent   : + manage contacts, log/simulate calls, notes, recordings, transcripts
--   manager : + campaigns, phone numbers, voice agents, suppression removals, deletes
--   admin   : + team management, integrations, organisation settings, audit log
-- Inactive users (pending approval) have no data access at all.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so they can read profiles under RLS)
-- -----------------------------------------------------------------------------
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'admin' then 4 when 'manager' then 3 when 'agent' then 2 when 'viewer' then 1 else 0 end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.has_min_role(p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.role_rank(public.current_app_role()), 0) >= public.role_rank(p_min_role)
         and public.role_rank(p_min_role) > 0;
$$;

-- True when the statement is executed by the backend (service role key or a
-- direct database connection) rather than an end-user JWT.
create or replace function public.is_backend_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') not in ('authenticated', 'anon');
$$;

-- -----------------------------------------------------------------------------
-- New user → profile. First ever user becomes an active admin.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
begin
  perform pg_advisory_xact_lock(hashtext('flashqc_profiles_bootstrap'));
  select not exists (select 1 from public.profiles) into v_first;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    case when v_first then 'admin' else 'viewer' end,
    v_first
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Profile guard: only admins change role / activation; never lose the last admin.
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot change';
  end if;

  if not public.is_backend_context() then
    if new.email is distinct from old.email then
      raise exception 'Email is managed by authentication and cannot be edited here';
    end if;
    if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
       and not public.has_min_role('admin') then
      raise exception 'Only admins can change roles or activation';
    end if;
  end if;

  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    if not exists (select 1 from public.profiles where role = 'admin' and is_active and id <> old.id) then
      raise exception 'Cannot remove the last active admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- -----------------------------------------------------------------------------
-- Connection-status guard: provider connection state may only be set by the
-- backend after a verified provider response. Users can never mark something
-- as "connected".
-- -----------------------------------------------------------------------------
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
  elsif new.connection_status is distinct from old.connection_status then
    raise exception 'Connection status is set only by a verified provider check';
  end if;
  return new;
end;
$$;

create trigger guard_connection_status before insert or update on public.voice_agents
  for each row execute function public.guard_connection_status();
create trigger guard_connection_status before insert or update on public.phone_numbers
  for each row execute function public.guard_connection_status();

create or replace function public.guard_integration_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_backend_context() then
    return new;
  end if;
  if new.key is distinct from old.key
     or new.status is distinct from old.status
     or new.last_checked_at is distinct from old.last_checked_at
     or new.last_error is distinct from old.last_error then
    raise exception 'Integration status is set only by the backend after a verified provider check';
  end if;
  return new;
end;
$$;

create trigger guard_integration_update before update on public.integrations
  for each row execute function public.guard_integration_update();

-- -----------------------------------------------------------------------------
-- Call guard: end users can never fabricate the outcome of a REAL call.
--   * a real call inserted by a user must be 'queued' with no provider data
--   * a real call's telephony fields can only change via the backend
--     (provider webhook), except queued → failed/canceled
--   * is_simulated can never be flipped
-- -----------------------------------------------------------------------------
create or replace function public.guard_calls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_backend_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if not new.is_simulated then
      if new.status <> 'queued' or new.provider_call_id is not null or new.answered_at is not null
         or new.ended_at is not null or new.duration_seconds <> 0 then
        raise exception 'A real call can only be created as queued; its progress must come from the telephony provider';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.is_simulated is distinct from old.is_simulated then
    raise exception 'is_simulated cannot be changed';
  end if;
  if new.direction is distinct from old.direction or new.call_number is distinct from old.call_number then
    raise exception 'Call direction cannot be changed';
  end if;

  if not old.is_simulated then
    if new.answered_at is distinct from old.answered_at
       or new.ended_at is distinct from old.ended_at
       or new.duration_seconds is distinct from old.duration_seconds
       or new.provider is distinct from old.provider
       or new.provider_call_id is distinct from old.provider_call_id
       or new.phone_e164 is distinct from old.phone_e164
       or new.started_at is distinct from old.started_at then
      raise exception 'Telephony fields of a real call are set only by the provider';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'queued' and new.status in ('failed', 'canceled')) then
      raise exception 'Status of a real call is set only by the provider';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_calls before insert or update on public.calls
  for each row execute function public.guard_calls();

-- call_events: users may only add 'user' events, or 'simulator' events on simulated calls.
create or replace function public.guard_call_events()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sim boolean;
begin
  if public.is_backend_context() then
    return new;
  end if;
  new.created_by := auth.uid();
  if new.source = 'user' then
    return new;
  end if;
  if new.source = 'simulator' then
    select is_simulated into v_sim from public.calls where id = new.call_id;
    if coalesce(v_sim, false) then
      return new;
    end if;
  end if;
  raise exception 'Event source % is not allowed for this call', new.source;
end;
$$;

create trigger guard_call_events before insert on public.call_events
  for each row execute function public.guard_call_events();

-- -----------------------------------------------------------------------------
-- Audit logging
-- -----------------------------------------------------------------------------
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return new; -- no material change
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    coalesce(public.current_app_role(), case when public.is_backend_context() then 'system' end),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles','app_settings','voice_agents','phone_numbers','integrations','contacts',
                           'campaigns','suppression_list','call_recordings','call_transcripts','call_summaries']
  loop
    execute format('create trigger audit_log after insert or update or delete on public.%I for each row execute function public.write_audit_log()', t);
  end loop;
end $$;
-- Calls change constantly during campaigns; audit edits and deletions only.
create trigger audit_log after update of outcome, notes, contact_id or delete on public.calls
  for each row execute function public.write_audit_log();

-- -----------------------------------------------------------------------------
-- Privileges: nothing for anonymous users.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.role_rank(text), public.current_app_role(), public.has_min_role(text),
  public.is_backend_context() to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Audit logs are append-only from triggers.
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.app_settings      enable row level security;
alter table public.voice_agents      enable row level security;
alter table public.phone_numbers     enable row level security;
alter table public.integrations      enable row level security;
alter table public.contacts          enable row level security;
alter table public.suppression_list  enable row level security;
alter table public.campaigns         enable row level security;
alter table public.calls             enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.call_events       enable row level security;
alter table public.call_recordings   enable row level security;
alter table public.call_transcripts  enable row level security;
alter table public.call_summaries    enable row level security;
alter table public.audit_logs        enable row level security;

-- Read access for every active team member on operational tables.
do $$
declare t text;
begin
  foreach t in array array['app_settings','voice_agents','phone_numbers','integrations','contacts','suppression_list',
                           'campaigns','calls','campaign_contacts','call_events','call_recordings',
                           'call_transcripts','call_summaries']
  loop
    execute format('create policy "members can read" on public.%I for select to authenticated using (public.has_min_role(''viewer''))', t);
  end loop;
end $$;

-- profiles
create policy "read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "members read team" on public.profiles for select to authenticated
  using (public.has_min_role('viewer'));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "admins update profiles" on public.profiles for update to authenticated
  using (public.has_min_role('admin')) with check (public.has_min_role('admin'));

-- app_settings / integrations: admin writes
create policy "admins update settings" on public.app_settings for update to authenticated
  using (public.has_min_role('admin')) with check (public.has_min_role('admin'));
create policy "admins update integrations" on public.integrations for update to authenticated
  using (public.has_min_role('admin')) with check (public.has_min_role('admin'));

-- voice_agents / phone_numbers: manager writes, admin deletes
create policy "managers insert" on public.voice_agents for insert to authenticated with check (public.has_min_role('manager'));
create policy "managers update" on public.voice_agents for update to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));
create policy "admins delete" on public.voice_agents for delete to authenticated using (public.has_min_role('admin'));

create policy "managers insert" on public.phone_numbers for insert to authenticated with check (public.has_min_role('manager'));
create policy "managers update" on public.phone_numbers for update to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));
create policy "admins delete" on public.phone_numbers for delete to authenticated using (public.has_min_role('admin'));

-- contacts: agents write, managers delete
create policy "agents insert" on public.contacts for insert to authenticated with check (public.has_min_role('agent'));
create policy "agents update" on public.contacts for update to authenticated
  using (public.has_min_role('agent')) with check (public.has_min_role('agent'));
create policy "managers delete" on public.contacts for delete to authenticated using (public.has_min_role('manager'));

-- suppression_list: agents add (opt-outs happen on calls), managers remove
create policy "agents insert" on public.suppression_list for insert to authenticated with check (public.has_min_role('agent'));
create policy "managers delete" on public.suppression_list for delete to authenticated using (public.has_min_role('manager'));

-- campaigns / campaign_contacts: managers
create policy "managers insert" on public.campaigns for insert to authenticated with check (public.has_min_role('manager'));
create policy "managers update" on public.campaigns for update to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));
create policy "managers delete" on public.campaigns for delete to authenticated using (public.has_min_role('manager'));

create policy "managers insert" on public.campaign_contacts for insert to authenticated with check (public.has_min_role('manager'));
create policy "managers update" on public.campaign_contacts for update to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));
create policy "managers delete" on public.campaign_contacts for delete to authenticated using (public.has_min_role('manager'));

-- calls: agents create/update (guarded by trigger), admins delete
create policy "agents insert" on public.calls for insert to authenticated with check (public.has_min_role('agent'));
create policy "agents update" on public.calls for update to authenticated
  using (public.has_min_role('agent')) with check (public.has_min_role('agent'));
create policy "admins delete" on public.calls for delete to authenticated using (public.has_min_role('admin'));

-- call_events: append-only for agents (guarded by trigger)
create policy "agents insert" on public.call_events for insert to authenticated with check (public.has_min_role('agent'));

-- recordings / transcripts / summaries: users may only add manual/uploaded items.
create policy "agents insert uploads" on public.call_recordings for insert to authenticated
  with check (public.has_min_role('agent') and source = 'upload');
create policy "managers delete" on public.call_recordings for delete to authenticated using (public.has_min_role('manager'));

create policy "agents insert manual" on public.call_transcripts for insert to authenticated
  with check (public.has_min_role('agent') and source = 'manual');
create policy "agents update manual" on public.call_transcripts for update to authenticated
  using (public.has_min_role('agent') and source = 'manual') with check (public.has_min_role('agent') and source = 'manual');
create policy "managers delete" on public.call_transcripts for delete to authenticated using (public.has_min_role('manager'));

create policy "agents insert manual" on public.call_summaries for insert to authenticated
  with check (public.has_min_role('agent') and source = 'manual');
create policy "agents update manual" on public.call_summaries for update to authenticated
  using (public.has_min_role('agent') and source = 'manual') with check (public.has_min_role('agent') and source = 'manual');
create policy "managers delete" on public.call_summaries for delete to authenticated using (public.has_min_role('manager'));

-- audit_logs: admins read
create policy "admins read audit" on public.audit_logs for select to authenticated using (public.has_min_role('admin'));

-- -----------------------------------------------------------------------------
-- Storage: private bucket for call recordings
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-recordings', 'call-recordings', false, 104857600,
        array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/webm','audio/mp4','audio/x-m4a','audio/aac'])
on conflict (id) do nothing;

create policy "members read recordings" on storage.objects for select to authenticated
  using (bucket_id = 'call-recordings' and public.has_min_role('viewer'));
create policy "agents upload recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'call-recordings' and public.has_min_role('agent'));
create policy "managers delete recordings" on storage.objects for delete to authenticated
  using (bucket_id = 'call-recordings' and public.has_min_role('manager'));
