-- =============================================================================
-- Call IDs (CL-000001 …) stay continuous: when calls are deleted, the remaining
-- calls are renumbered 1..N in their original order, and new calls take N+1.
-- =============================================================================

-- Plain number assigned by trigger instead of an identity (which never reuses numbers).
alter table public.calls alter column call_number drop identity if exists;

create or replace function public.assign_call_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.calls.call_number'));
  select coalesce(max(call_number), 0) + 1 into new.call_number from public.calls;
  return new;
end;
$$;
revoke all on function public.assign_call_number() from public, anon, authenticated;

-- Runs before guard_calls (triggers fire in name order: "assign…" < "guard…").
create trigger assign_call_number before insert on public.calls
  for each row execute function public.assign_call_number();

create or replace function public.renumber_call_numbers()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.calls.call_number'));
  perform set_config('crm.renumbering', 'on', true);
  -- Two steps so the unique constraint never sees two calls with the same number.
  update public.calls set call_number = -call_number where call_number > 0;
  update public.calls k set call_number = n.rn
  from (select id, row_number() over (order by -call_number) as rn from public.calls) n
  where n.id = k.id;
  perform set_config('crm.renumbering', 'off', true);
end;
$$;
revoke all on function public.renumber_call_numbers() from public, anon, authenticated;

create or replace function public.renumber_calls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.renumber_call_numbers();
  return null;
end;
$$;
revoke all on function public.renumber_calls() from public, anon, authenticated;

create trigger renumber_calls_after_delete after delete on public.calls
  for each statement execute function public.renumber_calls();

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
  if new.direction is distinct from old.direction then
    raise exception 'Call direction cannot be changed';
  end if;
  if new.call_number is distinct from old.call_number and coalesce(current_setting('crm.renumbering', true), '') <> 'on' then
    raise exception 'Call ID cannot be changed';
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

-- Close existing gaps once.
select public.renumber_call_numbers();
