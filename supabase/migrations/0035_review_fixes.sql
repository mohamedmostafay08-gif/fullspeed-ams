-- Fixes from the system review. Additive only (create or replace, revoke), safe to paste as is.

-- ═════ 1. performance_report: only read the leads in the asked range (it used to scan the whole table) ═════
create or replace function public.performance_report(p_from date, p_to date, p_agent uuid default null)
returns table (
  day date, agent_id uuid, company_id uuid,
  leads_count bigint, hired_count bigint,
  target_leads integer, target_hired integer
)
language sql stable security invoker set search_path = public
as $$
  with ev as (
    select (created_at at time zone 'Africa/Cairo')::date as d, agent_id, company_id, 1 as l, 0 as h
    from public.leads
    where agent_id is not null and (p_agent is null or agent_id = p_agent)
      and created_at >= public.cairo_day_start(p_from) and created_at < public.cairo_day_start(p_to + 1)
    union all
    select (hired_at at time zone 'Africa/Cairo')::date, agent_id, company_id, 0, 1
    from public.leads
    where hired_at is not null and agent_id is not null and (p_agent is null or agent_id = p_agent)
      and hired_at >= public.cairo_day_start(p_from) and hired_at < public.cairo_day_start(p_to + 1)
  ), agg as (
    select d, agent_id, company_id, sum(l)::bigint as lc, sum(h)::bigint as hc
    from ev where d between p_from and p_to
    group by 1, 2, 3
  ), t as (
    select * from public.daily_targets
    where date between p_from and p_to and (p_agent is null or agent_id = p_agent)
  )
  select coalesce(agg.d, t.date), coalesce(agg.agent_id, t.agent_id), coalesce(agg.company_id, t.company_id),
         coalesce(agg.lc, 0), coalesce(agg.hc, 0),
         coalesce(t.target_leads, 0), coalesce(t.target_hired, 0)
  from agg
  full join t on t.date = agg.d and t.agent_id = agg.agent_id and t.company_id = agg.company_id
$$;

-- ═════ 2. Helpers: no anonymous access, and only about people you're allowed to see ═════
revoke execute on function public.expected_start(uuid, date) from anon, public;
grant execute on function public.expected_start(uuid, date) to authenticated;
revoke execute on function public.is_day_off(date) from anon, public;
grant execute on function public.is_day_off(date) to authenticated;

-- Scheduled jobs run without a signed-in user (auth.uid() is null) and keep working.
create or replace function public.on_leave(p_user uuid, p_day date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.leave_requests where user_id = p_user and status = 'approved' and p_day between start_date and end_date)
     and (auth.uid() is null or p_user = auth.uid() or public.can_see_agent(p_user))
$$;

create or replace function public.team_leave_load(p_user uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with allowed as (select auth.uid() is null or p_user = auth.uid() or public.can_see_agent(p_user) as ok),
  me as (select team_id from public.profiles, allowed where id = p_user and allowed.ok),
  team as (select p.id from public.profiles p, me where me.team_id is not null and p.team_id = me.team_id and p.is_active and p.role = 'agent'),
  days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g where not public.is_day_off(g::date)),
  per_day as (
    select d.d, count(distinct l.user_id) as off
    from days d join public.leave_requests l on l.status in ('approved', 'pending') and d.d between l.start_date and l.end_date
    where l.user_id in (select id from team) and l.user_id <> p_user
    group by d.d
  )
  select jsonb_build_object('team', (select count(*) from team),
                            'peak', coalesce((select max(off) from per_day), 0),
                            'peak_day', (select d from per_day order by off desc, d limit 1))
$$;

-- ═════ 3. Monthly team target: re-splitting clears old shares first ═════
create or replace function public.set_team_target(p_team uuid, p_company uuid, p_month date, p_target integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  m date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  first_day date := greatest(m, public.cairo_today());
  agents uuid[];
  days date[];
  hired integer;
  remaining integer;
  share integer;
  a integer;
  i integer;
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  if p_target is null or p_target < 0 then raise exception 'bad_target' using errcode = '22023'; end if;

  insert into public.team_targets (team_id, company_id, month, target_hired, updated_by, updated_at)
  values (p_team, p_company, m, p_target, auth.uid(), now())
  on conflict (team_id, company_id, month) do update set target_hired = excluded.target_hired, updated_by = excluded.updated_by, updated_at = now();

  if m_end < public.cairo_today() then return jsonb_build_object('agents', 0, 'days', 0, 'remaining', 0); end if;

  -- Start from a clean slate for the rest of the month, so people who left the team or the
  -- company (or days that turned into holidays) don't keep an old share of the target.
  update public.daily_targets dt set target_hired = 0
  where dt.company_id = p_company and dt.date between first_day and m_end
    and dt.agent_id in (select id from public.profiles where team_id = p_team);

  agents := array(select p.id from public.profiles p join public.agent_companies ac on ac.agent_id = p.id and ac.company_id = p_company
                  where p.team_id = p_team and p.role = 'agent' and p.is_active order by p.full_name);
  days := array(select g::date from generate_series(first_day, m_end, interval '1 day') g where not public.is_day_off(g::date) order by 1);
  select count(*) into hired from public.leads l
  where l.company_id = p_company and l.status = 'hired' and l.agent_id = any (array(select id from public.profiles where team_id = p_team))
    and l.hired_at >= public.cairo_day_start(m) and l.hired_at < public.cairo_day_start(m_end + 1);
  remaining := greatest(0, p_target - hired);

  if coalesce(array_length(agents, 1), 0) = 0 or coalesce(array_length(days, 1), 0) = 0 then
    return jsonb_build_object('agents', coalesce(array_length(agents, 1), 0), 'days', coalesce(array_length(days, 1), 0), 'remaining', remaining);
  end if;

  -- Whole numbers that add up exactly: first across agents, then each agent's share across the days left.
  for a in 1 .. array_length(agents, 1) loop
    share := (remaining * a) / array_length(agents, 1) - (remaining * (a - 1)) / array_length(agents, 1);
    for i in 1 .. array_length(days, 1) loop
      insert into public.daily_targets (agent_id, company_id, date, target_hired)
      values (agents[a], p_company, days[i], (share * i) / array_length(days, 1) - (share * (i - 1)) / array_length(days, 1))
      on conflict (agent_id, company_id, date) do update set target_hired = excluded.target_hired;
    end loop;
  end loop;
  return jsonb_build_object('agents', array_length(agents, 1), 'days', array_length(days, 1), 'remaining', remaining);
end;
$$;
