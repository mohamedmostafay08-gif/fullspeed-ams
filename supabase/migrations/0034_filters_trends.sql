-- Filters and trends. Additive only (no drops), so it can be pasted into the SQL editor as is.

-- ═════ 1. Saved filters: a person names a filter and comes back to it ═════
create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  page text not null check (page in ('leads', 'analytics')),
  name text not null check (char_length(name) between 1 and 60),
  query text not null check (char_length(query) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists saved_filters_user_idx on public.saved_filters (user_id, page);
alter table public.saved_filters enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_filters' and policyname = 'own saved filters') then
    create policy "own saved filters" on public.saved_filters for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end;
$$;
grant select, insert, delete on public.saved_filters to authenticated;

-- ═════ 2. Analytics with filters (team, company, agent, source, governorate) ═════
-- Same shape as acquisition_analytics; row-level security still decides which leads count.
create or replace function public.analytics_filtered(
  p_from date, p_to date,
  p_team uuid default null, p_company uuid default null, p_agent uuid default null,
  p_source text default null, p_governorate integer default null)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_start timestamptz := (p_from::timestamp at time zone 'Africa/Cairo');
  v_end timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Cairo');
  v_result jsonb;
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'INVALID_RANGE';
  end if;

  with agents as (
    select id, full_name, team_id from public.profiles
    where role = 'agent' and is_active
      and (p_team is null or team_id = p_team)
      and (p_agent is null or id = p_agent)
  ),
  scope as (
    select * from public.leads x
    where (p_company is null or x.company_id = p_company)
      and (p_source is null or x.source = p_source)
      and (p_governorate is null or x.governorate_id = p_governorate)
      and (p_agent is null or x.agent_id = p_agent)
      and (p_team is null or x.agent_id in (select id from public.profiles where team_id = p_team))
  ),
  l as (select * from scope where created_at >= v_start and created_at < v_end),
  hires as (select * from scope where hired_at >= v_start and hired_at < v_end),
  touch as (
    select a.lead_id, min(a.created_at) as t
    from public.lead_activities a
    join l on l.id = a.lead_id
    where a.from_status is not null
    group by a.lead_id
  ),
  brk as (
    select agent_id,
           count(*) as taken,
           sum(extract(epoch from (coalesce(ended_at, least(ends_at, now())) - started_at)) / 60) as minutes
    from public.agent_breaks
    where started_at >= v_start and started_at < v_end and status in ('active', 'ended')
    group by agent_id
  ),
  per_agent as (
    select a.id, a.full_name, a.team_id,
           count(l.id) as leads,
           count(l.id) filter (where l.status not in ('new', 'no_answer')) as contacted,
           count(l.id) filter (where l.status = 'no_answer') as no_answer,
           count(l.id) filter (where l.status = 'rejected') as rejected,
           (select count(*) from hires h where h.agent_id = a.id) as hired,
           round((avg(extract(epoch from (t.t - l.created_at))) / 3600)::numeric, 1) as first_touch_hours,
           coalesce(max(b.taken), 0) as breaks,
           round(coalesce(max(b.minutes), 0)::numeric) as break_minutes
    from agents a
    left join l on l.agent_id = a.id
    left join touch t on t.lead_id = l.id
    left join brk b on b.agent_id = a.id
    group by a.id, a.full_name, a.team_id
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'leads', count(*),
        'contacted', count(*) filter (where status not in ('new', 'no_answer')),
        'no_answer', count(*) filter (where status = 'no_answer'),
        'rejected', count(*) filter (where status = 'rejected'),
        'unassigned', count(*) filter (where agent_id is null),
        'converted', count(*) filter (where status = 'hired')
      ) from l
    ),
    'hired', (select count(*) from hires),
    'avg_hours_to_hire', (select round((avg(extract(epoch from (hired_at - created_at))) / 3600)::numeric, 1) from hires),
    'avg_hours_first_touch', (select round((avg(extract(epoch from (t.t - l.created_at))) / 3600)::numeric, 1) from l join touch t on t.lead_id = l.id),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from l group by status) s),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'leads', lc, 'hired', hc) order by g), '[]'::jsonb)
      from (
        select g,
               (select count(*) from l where (l.created_at at time zone 'Africa/Cairo')::date = g::date) as lc,
               (select count(*) from hires h where (h.hired_at at time zone 'Africa/Cairo')::date = g::date) as hc
        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
      ) d
    ),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', source, 'leads', n, 'hired', h) order by n desc), '[]'::jsonb)
      from (select source, count(*) as n, count(*) filter (where status = 'hired') as h from l group by source) s
    ),
    'by_governorate', (
      select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(g.name_ar, 'غير محدد'), 'leads', n, 'hired', h) order by n desc), '[]'::jsonb)
      from (select governorate_id, count(*) as n, count(*) filter (where status = 'hired') as h from l group by governorate_id) s
      left join public.governorates g on g.id = s.governorate_id
    ),
    'by_company', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'logo', c.logo_path, 'leads', coalesce(s.n, 0), 'contacted', coalesce(s.ct, 0),
               'rejected', coalesce(s.r, 0), 'hired', (select count(*) from hires h where h.company_id = c.id)
             ) order by coalesce(s.n, 0) desc), '[]'::jsonb)
      from public.companies c
      left join (
        select company_id, count(*) as n,
               count(*) filter (where status not in ('new', 'no_answer')) as ct,
               count(*) filter (where status = 'rejected') as r
        from l group by company_id
      ) s on s.company_id = c.id
      where s.n is not null or exists (select 1 from hires h where h.company_id = c.id)
    ),
    'by_agent', (select coalesce(jsonb_agg(to_jsonb(pa) order by pa.hired desc, pa.leads desc), '[]'::jsonb) from per_agent pa),
    'by_team', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name,
               'agents', (select count(*) from per_agent pa where pa.team_id = t.id),
               'leads', (select coalesce(sum(leads), 0) from per_agent pa where pa.team_id = t.id),
               'hired', (select coalesce(sum(hired), 0) from per_agent pa where pa.team_id = t.id)
             ) order by t.name), '[]'::jsonb)
      from public.teams t
      where p_team is null or t.id = p_team
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke execute on function public.analytics_filtered(date, date, uuid, uuid, uuid, text, integer) from anon, public;
grant execute on function public.analytics_filtered(date, date, uuid, uuid, uuid, text, integer) to authenticated;

-- ═════ 3. Week-by-week numbers (Egyptian week, Saturday → Friday), same filters ═════
create or replace function public.analytics_weekly(
  p_to date, p_weeks integer,
  p_team uuid default null, p_company uuid default null, p_agent uuid default null,
  p_source text default null, p_governorate integer default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with w as (
    select (p_to - ((extract(dow from p_to)::integer + 1) % 7) - 7 * k)::date as week_start
    from generate_series(0, least(greatest(p_weeks, 1), 52) - 1) k
  ),
  scope as (
    select x.created_at, x.hired_at, x.status from public.leads x
    where (p_company is null or x.company_id = p_company)
      and (p_source is null or x.source = p_source)
      and (p_governorate is null or x.governorate_id = p_governorate)
      and (p_agent is null or x.agent_id = p_agent)
      and (p_team is null or x.agent_id in (select id from public.profiles where team_id = p_team))
      and (x.created_at >= public.cairo_day_start((select min(week_start) from w))
           or x.hired_at >= public.cairo_day_start((select min(week_start) from w)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'week', w.week_start,
    'leads', (select count(*) from scope s where s.created_at >= public.cairo_day_start(w.week_start) and s.created_at < public.cairo_day_start(w.week_start + 7)),
    'contacted', (select count(*) from scope s where s.created_at >= public.cairo_day_start(w.week_start) and s.created_at < public.cairo_day_start(w.week_start + 7) and s.status not in ('new', 'no_answer')),
    'rejected', (select count(*) from scope s where s.created_at >= public.cairo_day_start(w.week_start) and s.created_at < public.cairo_day_start(w.week_start + 7) and s.status = 'rejected'),
    'hired', (select count(*) from scope s where s.hired_at >= public.cairo_day_start(w.week_start) and s.hired_at < public.cairo_day_start(w.week_start + 7))
  ) order by w.week_start), '[]'::jsonb)
  from w
$$;
revoke execute on function public.analytics_weekly(date, integer, uuid, uuid, uuid, text, integer) from anon, public;
grant execute on function public.analytics_weekly(date, integer, uuid, uuid, uuid, text, integer) to authenticated;
