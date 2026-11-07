-- =============================================================================
-- Views and analytics functions.
-- Every figure is computed from database records. Functions are SECURITY
-- INVOKER so Row Level Security applies. Day/week/month/hour buckets are
-- computed in Asia/Kolkata; timestamps are stored in UTC.
--
-- Metric definitions (shared with the UI):
--   answered  = answered_at is not null
--   missed    = status in ('missed','no_answer','busy')
--   failed    = status = 'failed'
--   talk time = sum(duration_seconds) of answered calls
--   avg dur.  = avg(duration_seconds) of answered calls
-- p_scope: 'all' | 'live' | 'simulated'
-- =============================================================================

create or replace function public.scope_matches(p_is_simulated boolean, p_scope text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_scope, 'all')
    when 'live' then not p_is_simulated
    when 'simulated' then p_is_simulated
    else true
  end;
$$;

-- -----------------------------------------------------------------------------
-- Contacts with call statistics (no denormalised counters to drift out of sync)
-- -----------------------------------------------------------------------------
create or replace view public.contacts_with_stats
with (security_invoker = true)
as
select
  c.*,
  coalesce(s.total_calls, 0) as total_calls,
  s.last_call_at,
  s.last_call_outcome,
  s.last_call_status,
  exists (select 1 from public.suppression_list sl where sl.phone_e164 = c.phone_e164) as is_suppressed
from public.contacts c
left join lateral (
  select
    count(*)::integer as total_calls,
    max(k.started_at) as last_call_at,
    (array_agg(k.outcome order by k.started_at desc))[1] as last_call_outcome,
    (array_agg(k.status order by k.started_at desc))[1] as last_call_status
  from public.calls k
  where k.contact_id = c.id
) s on true;

-- -----------------------------------------------------------------------------
-- Calls joined with the names the UI needs (keeps list queries to one round trip)
-- -----------------------------------------------------------------------------
create or replace view public.call_log_view
with (security_invoker = true)
as
select
  k.*,
  ct.full_name        as contact_name,
  ct.business_name    as business_name,
  cp.name             as campaign_name,
  pn.label            as phone_number_label,
  pn.phone_e164       as business_phone_e164,
  va.name             as voice_agent_name,
  exists (select 1 from public.call_recordings r where r.call_id = k.id) as has_recording,
  exists (select 1 from public.call_transcripts t where t.call_id = k.id) as has_transcript,
  exists (select 1 from public.call_summaries s where s.call_id = k.id) as has_summary,
  (k.answered_at is not null) as is_answered
from public.calls k
left join public.contacts ct on ct.id = k.contact_id
left join public.campaigns cp on cp.id = k.campaign_id
left join public.phone_numbers pn on pn.id = k.phone_number_id
left join public.voice_agents va on va.id = k.voice_agent_id;

-- -----------------------------------------------------------------------------
-- Campaign statistics
-- -----------------------------------------------------------------------------
create or replace view public.campaign_stats
with (security_invoker = true)
as
select
  cp.id as campaign_id,
  coalesce(cc.total, 0)        as contacts_total,
  coalesce(cc.pending, 0)      as contacts_pending,
  coalesce(cc.in_progress, 0)  as contacts_in_progress,
  coalesce(cc.completed, 0)    as contacts_completed,
  coalesce(cc.failed, 0)       as contacts_failed,
  coalesce(cc.skipped, 0)      as contacts_skipped,
  coalesce(k.calls, 0)         as calls_total,
  coalesce(k.answered, 0)      as calls_answered,
  coalesce(k.missed, 0)        as calls_missed,
  coalesce(k.failed, 0)        as calls_failed,
  coalesce(k.talk_time, 0)     as talk_time_seconds,
  coalesce(k.avg_duration, 0)  as avg_duration_seconds
from public.campaigns cp
left join lateral (
  select
    count(*)::integer                                          as total,
    (count(*) filter (where status = 'pending'))::integer      as pending,
    (count(*) filter (where status = 'in_progress'))::integer  as in_progress,
    (count(*) filter (where status = 'completed'))::integer    as completed,
    (count(*) filter (where status = 'failed'))::integer       as failed,
    (count(*) filter (where status = 'skipped'))::integer      as skipped
  from public.campaign_contacts x where x.campaign_id = cp.id
) cc on true
left join lateral (
  select
    count(*)::integer                                                              as calls,
    (count(*) filter (where answered_at is not null))::integer                     as answered,
    (count(*) filter (where status in ('missed', 'no_answer', 'busy')))::integer   as missed,
    (count(*) filter (where status = 'failed'))::integer                           as failed,
    coalesce(sum(duration_seconds) filter (where answered_at is not null), 0)::integer as talk_time,
    coalesce(round(avg(duration_seconds) filter (where answered_at is not null)), 0)::integer as avg_duration
  from public.calls y where y.campaign_id = cp.id
) k on true;

-- -----------------------------------------------------------------------------
-- Dashboard summary
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_from timestamptz, p_to timestamptz, p_scope text default 'all')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with c as (
    select * from public.calls
    where started_at >= p_from and started_at < p_to and public.scope_matches(is_simulated, p_scope)
  ),
  totals as (
    select
      count(*)::integer                                                            as total,
      (count(*) filter (where direction = 'inbound'))::integer                     as inbound,
      (count(*) filter (where direction = 'outbound'))::integer                    as outbound,
      (count(*) filter (where answered_at is not null))::integer                   as answered,
      (count(*) filter (where status in ('missed', 'no_answer', 'busy')))::integer as missed,
      (count(*) filter (where status = 'failed'))::integer                         as failed,
      (count(*) filter (where is_simulated))::integer                              as simulated,
      coalesce(sum(duration_seconds) filter (where answered_at is not null), 0)::bigint as talk_time_seconds,
      coalesce(round(avg(duration_seconds) filter (where answered_at is not null)), 0)::integer as avg_duration_seconds
    from c
  ),
  by_status as (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) as v
    from (select status, count(*)::integer as n from c group by status) s
  )
  select to_jsonb(totals) || jsonb_build_object('status_distribution', by_status.v)
  from totals, by_status;
$$;

-- -----------------------------------------------------------------------------
-- Trend series with gap filling. p_granularity: 'day' | 'week' | 'month'
-- -----------------------------------------------------------------------------
create or replace function public.call_trends(
  p_from timestamptz, p_to timestamptz, p_granularity text default 'day', p_scope text default 'all')
returns table (bucket date, total integer, inbound integer, outbound integer, answered integer, missed integer, failed integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_granularity not in ('day', 'week', 'month') then
    raise exception 'Invalid granularity %', p_granularity;
  end if;
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  if p_granularity = 'day' and p_to - p_from > interval '400 days' then
    raise exception 'Daily range is limited to 400 days';
  end if;

  return query
  with buckets as (
    select generate_series(
      date_trunc(p_granularity, p_from at time zone 'Asia/Kolkata'),
      date_trunc(p_granularity, (p_to - interval '1 microsecond') at time zone 'Asia/Kolkata'),
      ('1 ' || p_granularity)::interval
    ) as b
  ),
  agg as (
    select
      date_trunc(p_granularity, k.started_at at time zone 'Asia/Kolkata') as b,
      count(*)::integer                                                              as total,
      (count(*) filter (where k.direction = 'inbound'))::integer                     as inbound,
      (count(*) filter (where k.direction = 'outbound'))::integer                    as outbound,
      (count(*) filter (where k.answered_at is not null))::integer                   as answered,
      (count(*) filter (where k.status in ('missed', 'no_answer', 'busy')))::integer as missed,
      (count(*) filter (where k.status = 'failed'))::integer                         as failed
    from public.calls k
    where k.started_at >= p_from and k.started_at < p_to and public.scope_matches(k.is_simulated, p_scope)
    group by 1
  )
  select buckets.b::date, coalesce(agg.total, 0), coalesce(agg.inbound, 0), coalesce(agg.outbound, 0),
         coalesce(agg.answered, 0), coalesce(agg.missed, 0), coalesce(agg.failed, 0)
  from buckets left join agg on agg.b = buckets.b
  order by 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Calls by hour of day (IST)
-- -----------------------------------------------------------------------------
create or replace function public.hourly_distribution(p_from timestamptz, p_to timestamptz, p_scope text default 'all')
returns table (hour integer, total integer, answered integer)
language sql
stable
set search_path = ''
as $$
  select h.hour, coalesce(a.total, 0), coalesce(a.answered, 0)
  from generate_series(0, 23) as h(hour)
  left join (
    select extract(hour from started_at at time zone 'Asia/Kolkata')::integer as hour,
           count(*)::integer as total,
           (count(*) filter (where answered_at is not null))::integer as answered
    from public.calls
    where started_at >= p_from and started_at < p_to and public.scope_matches(is_simulated, p_scope)
    group by 1
  ) a on a.hour = h.hour
  order by h.hour;
$$;

-- -----------------------------------------------------------------------------
-- Outcome distribution
-- -----------------------------------------------------------------------------
create or replace function public.outcome_distribution(p_from timestamptz, p_to timestamptz, p_scope text default 'all')
returns table (outcome text, total integer)
language sql
stable
set search_path = ''
as $$
  select coalesce(outcome, 'not_set'), count(*)::integer
  from public.calls
  where started_at >= p_from and started_at < p_to and public.scope_matches(is_simulated, p_scope)
    and answered_at is not null
  group by 1
  order by 2 desc;
$$;

-- -----------------------------------------------------------------------------
-- Voice agent performance
-- -----------------------------------------------------------------------------
create or replace function public.voice_agent_performance(p_from timestamptz, p_to timestamptz, p_scope text default 'all')
returns table (voice_agent_id uuid, name text, total integer, answered integer, avg_duration_seconds integer, talk_time_seconds bigint)
language sql
stable
set search_path = ''
as $$
  select k.voice_agent_id, coalesce(va.name, 'Unassigned'),
         count(*)::integer,
         (count(*) filter (where k.answered_at is not null))::integer,
         coalesce(round(avg(k.duration_seconds) filter (where k.answered_at is not null)), 0)::integer,
         coalesce(sum(k.duration_seconds) filter (where k.answered_at is not null), 0)::bigint
  from public.calls k
  left join public.voice_agents va on va.id = k.voice_agent_id
  where k.started_at >= p_from and k.started_at < p_to and public.scope_matches(k.is_simulated, p_scope)
  group by k.voice_agent_id, va.name
  order by 3 desc;
$$;

grant select on public.contacts_with_stats, public.call_log_view, public.campaign_stats to authenticated;
revoke all on public.contacts_with_stats, public.call_log_view, public.campaign_stats from anon;
grant execute on function
  public.scope_matches(boolean, text),
  public.dashboard_summary(timestamptz, timestamptz, text),
  public.call_trends(timestamptz, timestamptz, text, text),
  public.hourly_distribution(timestamptz, timestamptz, text),
  public.outcome_distribution(timestamptz, timestamptz, text),
  public.voice_agent_performance(timestamptz, timestamptz, text)
to authenticated;
