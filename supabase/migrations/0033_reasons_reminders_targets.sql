-- ═════ 1. Rejection reasons ═════
alter table public.leads
  add column if not exists reject_reason text,
  add column if not exists rejected_at timestamptz;
alter table public.leads drop constraint if exists leads_reject_reason_check;
alter table public.leads add constraint leads_reject_reason_check check (reject_reason is null or reject_reason in
  ('salary', 'no_vehicle', 'far', 'age', 'not_interested', 'other_job', 'documents', 'no_show', 'other'));

-- The reason and date belong to a rejected lead only; reopening it clears them.
create or replace function public.stamp_rejection()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status = 'rejected' then
    if tg_op = 'INSERT' or old.status is distinct from 'rejected' then new.rejected_at := now(); end if;
  else
    new.reject_reason := null;
    new.rejected_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_stamp_rejection on public.leads;
create trigger leads_stamp_rejection before insert or update of status, reject_reason on public.leads
  for each row execute function public.stamp_rejection();

-- Reasons per company for leads rejected in a period, limited to what the caller may see.
create or replace function public.rejection_reasons(p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('company_id', x.company_id, 'company', x.name, 'reason', x.reason, 'n', x.n) order by x.n desc), '[]'::jsonb)
  from (
    select l.company_id, c.name, coalesce(l.reject_reason, 'unknown') as reason, count(*)::integer as n
    from public.leads l join public.companies c on c.id = l.company_id
    where l.status = 'rejected'
      and l.rejected_at >= public.cairo_day_start(p_from) and l.rejected_at < public.cairo_day_start(p_to + 1)
      and public.can_see_agent(l.agent_id)
    group by l.company_id, c.name, coalesce(l.reject_reason, 'unknown')
  ) x
$$;
revoke execute on function public.rejection_reasons(date, date) from anon, public;
grant execute on function public.rejection_reasons(date, date) to authenticated;

-- ═════ 2. WhatsApp interview reminders to the captain (a day before and an hour before) ═════
create table if not exists public.interview_wa_reminders (
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('day', 'hour')),
  interview_at timestamptz not null,
  queued_at timestamptz not null default now(),
  primary key (lead_id, kind, interview_at)
);
alter table public.interview_wa_reminders enable row level security;
-- Written only by the scheduler (security definer); nobody reads it through the API.

create or replace function public.queue_interview_whatsapp()
returns integer
language plpgsql security definer set search_path = public, private
as $$
declare
  n integer := 0;
  r record;
begin
  if coalesce((select value from private.app_config where key = 'wa_enabled'), '') <> '1'
     or coalesce((select value from private.app_config where key = 'wa_reminder_template'), '') = '' then
    return 0;
  end if;
  for r in
    with due as (
      select l.id, 'day'::text as kind, l.interview_at from public.leads l
      where l.status = 'interview' and l.interview_at between now() + interval '20 hours' and now() + interval '26 hours'
      union all
      select l.id, 'hour', l.interview_at from public.leads l
      where l.status = 'interview' and l.interview_at between now() + interval '45 minutes' and now() + interval '75 minutes'
    )
    insert into public.interview_wa_reminders (lead_id, kind, interview_at)
    select id, kind, interview_at from due
    on conflict do nothing
    returning lead_id, kind
  loop
    perform public.call_app('/api/whatsapp/reminder', jsonb_build_object('id', r.lead_id, 'kind', r.kind));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.queue_interview_whatsapp() from anon, authenticated, public;

-- ═════ 3. Tell the team leader when an agent's numbers drop three days running ═════
create or replace function public.fire_performance_drops()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  d date := public.cairo_today();
  n integer := 0;
  r record;
begin
  for r in
    with days as (
      select g::date as day from generate_series(d - 24, d, interval '1 day') g where not public.is_day_off(g::date)
    ),
    pts as (
      select dy.day, lb.agent_id, lb.full_name, lb.points
      from days dy cross join lateral public.leaderboard(dy.day, dy.day) lb
    ),
    present as (
      select p.* from pts p
      join public.attendance a on a.user_id = p.agent_id and a.day = p.day
      join public.profiles pr on pr.id = p.agent_id and pr.is_active and pr.role = 'agent'
    ),
    ranked as (select *, row_number() over (partition by agent_id order by day desc) as rn from present)
    select agent_id, max(full_name) as full_name,
           avg(points) filter (where rn <= 3) as recent,
           max(points) filter (where rn <= 3) as recent_max,
           count(*) filter (where rn <= 3) as n_recent,
           avg(points) filter (where rn between 4 and 17) as base,
           count(*) filter (where rn between 4 and 17) as n_base
    from ranked group by agent_id
  loop
    if r.n_recent = 3 and r.n_base >= 5 and r.base >= 8 and r.recent_max < r.base * 0.6 then
      if public.notify_once('drop:' || r.agent_id || ':' || to_char(d, 'IYYY-IW'),
           array(select public.supervisors_of(r.agent_id)), 'info',
           '📉 ' || r.full_name || ' أداؤه نازل آخر 3 أيام',
           'متوسطه ' || round(r.recent) || ' نقطة في اليوم بدل ' || round(r.base) || ' — كلّمه وشوف إيه اللي مضايقه',
           '/admin/scorecard?agent=' || r.agent_id) then
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.fire_performance_drops() from anon, authenticated, public;

-- ═════ 4. Monthly targets per team and company, split into the agents' daily targets ═════
create table if not exists public.team_targets (
  team_id uuid not null references public.teams(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  target_hired integer not null check (target_hired between 0 and 100000),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (team_id, company_id, month)
);
create index if not exists team_targets_company_idx on public.team_targets (company_id);
create index if not exists team_targets_updated_by_idx on public.team_targets (updated_by);
alter table public.team_targets enable row level security;
drop policy if exists "read team targets" on public.team_targets;
create policy "read team targets" on public.team_targets for select to authenticated
  using ((select public.sees_all())
         or team_id = (select team_id from public.profiles where id = (select auth.uid()) and role = 'team_leader'));
grant select on public.team_targets to authenticated;

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
revoke execute on function public.set_team_target(uuid, uuid, date, integer) from anon, public;
grant execute on function public.set_team_target(uuid, uuid, date, integer) to authenticated;

-- A team's companies this month: target, hires so far, and what's still needed per working day.
create or replace function public.team_target_progress(p_team uuid, p_month date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with m as (
    select date_trunc('month', p_month)::date as m_from,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date as m_to
  ),
  ok as (
    select public.sees_all()
        or exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'team_leader' and team_id = p_team) as allowed
  ),
  cos as (
    select c.id, c.name, c.logo_path from public.team_companies tc join public.companies c on c.id = tc.company_id where tc.team_id = p_team
    union
    select c.id, c.name, c.logo_path from public.team_targets tt join public.companies c on c.id = tt.company_id, m
    where tt.team_id = p_team and tt.month = m.m_from
  ),
  left_days as (
    select count(*)::integer as n from m, generate_series(greatest(m.m_from, public.cairo_today()), m.m_to, interval '1 day') g
    where not public.is_day_off(g::date)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', cos.id, 'name', cos.name, 'logo_path', cos.logo_path,
    'target', tt.target_hired,
    'hired', (select count(*) from public.leads l, m
              where l.company_id = cos.id and l.status = 'hired'
                and l.agent_id in (select id from public.profiles where team_id = p_team)
                and l.hired_at >= public.cairo_day_start(m.m_from) and l.hired_at < public.cairo_day_start(m.m_to + 1)),
    'agents', (select count(*) from public.profiles p join public.agent_companies ac on ac.agent_id = p.id and ac.company_id = cos.id
               where p.team_id = p_team and p.role = 'agent' and p.is_active),
    'days_left', (select n from left_days)
  ) order by cos.name), '[]'::jsonb)
  from cos cross join ok cross join m
  left join public.team_targets tt on tt.team_id = p_team and tt.company_id = cos.id and tt.month = m.m_from
  where ok.allowed
$$;
revoke execute on function public.team_target_progress(uuid, date) from anon, public;
grant execute on function public.team_target_progress(uuid, date) to authenticated;

drop trigger if exists audit_team_targets on public.team_targets;
create trigger audit_team_targets after insert or update or delete on public.team_targets
  for each row execute function public.audit_row();

-- ═════ 5. Performance users never read lead rows (names, phones, notes, files) ═════
-- Their pages get totals from the server instead.
do $$
declare t text;
begin
  foreach t in array array['leads', 'lead_activities', 'call_logs', 'lead_documents'] loop
    execute format('drop policy if exists "no lead rows for performance" on public.%I', t);
    execute format('create policy "no lead rows for performance" on public.%I as restrictive for select to authenticated
                    using (coalesce((select public.my_role())::text, %L) <> %L)', t, '', 'performance');
  end loop;
end;
$$;

create or replace function public.can_see_lead(p_lead uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role()::text, '') <> 'performance' and exists (
    select 1 from public.leads l
    where l.id = p_lead and (public.can_see_agent(l.agent_id) or (l.agent_id is null and public.is_staff()))
  )
$$;

-- ═════ Schedules ═════
do $$
begin
  perform cron.schedule('queue-interview-whatsapp', '*/10 * * * *', 'select public.queue_interview_whatsapp()');
  perform cron.schedule('fire-performance-drops', '25 19 * * *', 'select public.fire_performance_drops()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;
