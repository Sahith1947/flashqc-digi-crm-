-- Emails that become active admins automatically when they sign up or sign in
-- for the first time (password or Google). Managed in Settings → Organisation.
alter table public.app_settings
  add column admin_emails text[] not null default '{}'
  check (array_length(admin_emails, 1) is null or array_length(admin_emails, 1) <= 20);

update public.app_settings set admin_emails = array['bokkisamsahith@gmail.com'] where id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
  v_listed boolean;
  v_name text;
begin
  perform pg_advisory_xact_lock(hashtext('flashqc_profiles_bootstrap'));
  select not exists (select 1 from public.profiles) into v_first;
  select coalesce(lower(coalesce(new.email, '')) = any (select lower(e) from unnest(s.admin_emails) e), false)
    into v_listed from public.app_settings s where s.id;
  v_name := nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 120), '');

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    v_name,
    case when v_first or coalesce(v_listed, false) then 'admin' else 'viewer' end,
    v_first or coalesce(v_listed, false)
  );
  return new;
end;
$$;

-- If a listed email already has an account, make it an active admin now.
update public.profiles p set role = 'admin', is_active = true
from public.app_settings s
where s.id and lower(p.email) = any (select lower(e) from unnest(s.admin_emails) e);
