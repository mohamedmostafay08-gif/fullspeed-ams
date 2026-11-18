-- Phase 3: leaderboard & streaks, delay alerts, automatic daily report, audit log.

create or replace function public.cairo_day_start(p_day date)
returns timestamptz
language sql immutable set search_path = public
as $$ select p_day::timestamp at time zone 'Africa/Cairo' $$;

create or replace function public.cairo_today()
returns date
language sql stable set search_path = public
as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- ───────── Leaderboard ─────────
-- Points: new lead 1 · logged call 1 · interview 3 · hire 10.
create or replace function public.agent_streak(p_agent uuid)
returns integer
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.cairo_today();
  streak integer := 0;
  leads_n integer; hired_n integer; act_n integer; t_leads integer; t_hired integer; good boolean;
begin
  for i in 0..89 loop
    select count(*) into leads_n from public.leads
      where agent_id = p_agent and created_at >= public.cairo_day_start(d) and created_at < public.cairo_day_start(d + 1);
    select count(*) into hired_n from public.leads
      where agent_id = p_agent and hired_at >= public.cairo_day_start(d) and hired_at < public.cairo_day_start(d + 1);
    select count(*) into act_n from public.lead_activities
      where actor_id = p_agent and created_at >= public.cairo_day_start(d) and created_at < public.cairo_day_start(d + 1);
    select coalesce(sum(target_leads), 0), coalesce(sum(target_hired), 0) into t_leads, t_hired
      from public.daily_targets where agent_id = p_agent and date = d;

    if leads_n + act_n + hired_n = 0 then
      -- day off (or today not started yet): neither counts nor breaks the streak
      d := d - 1;
      continue;
    end if;
    good := case when t_leads + t_hired > 0 then leads_n >= t_leads and hired_n >= t_hired else hired_n >= 1 end;
    if not good then
      exit when i > 0;          -- today still in progress: don't break on it
    else
      streak := streak + 1;
    end if;
    d := d - 1;
  end loop;
  return streak;
end;
$$;

create or replace function public.leaderboard(p_from date, p_to date)
returns table (agent_id uuid, full_name text, team_id uuid, leads integer, calls integer, interviews integer, hired integer, points integer, streak integer)
language sql stable security definer set search_path = public
as $$
  with r as (select public.cairo_day_start(p_from) s, public.cairo_day_start(least(p_to, p_from + 366) + 1) e),
  a as (select id, full_name, team_id from public.profiles where role = 'agent' and is_active),
  l as (select l.agent_id, count(*) n from public.leads l, r where l.created_at >= r.s and l.created_at < r.e group by 1),
  h as (select l.agent_id, count(*) n from public.leads l, r where l.hired_at >= r.s and l.hired_at < r.e group by 1),
  c as (select la.actor_id, count(*) n from public.lead_activities la, r
        where la.created_at >= r.s and la.created_at < r.e and la.note ~ '^(📞|📵|⏰|📅|✋|🎉)' group by 1),
  iv as (select l.agent_id, count(*) n from public.lead_activities la join public.leads l on l.id = la.lead_id, r
         where la.created_at >= r.s and la.created_at < r.e and la.to_status = 'interview' group by 1)
  select a.id, a.full_name, a.team_id,
         coalesce(l.n, 0)::int, coalesce(c.n, 0)::int, coalesce(iv.n, 0)::int, coalesce(h.n, 0)::int,
         (coalesce(l.n, 0) + coalesce(c.n, 0) + 3 * coalesce(iv.n, 0) + 10 * coalesce(h.n, 0))::int,
         public.agent_streak(a.id)
  from a
  left join l on l.agent_id = a.id
  left join h on h.agent_id = a.id
  left join c on c.actor_id = a.id
  left join iv on iv.agent_id = a.id
  order by 8 desc, 7 desc, 2
$$;

-- Lifetime numbers behind the badges.
create or replace function public.agent_stats(p_agent uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total_leads', (select count(*) from public.leads where agent_id = p_agent),
    'total_hired', (select count(*) from public.leads where agent_id = p_agent and status = 'hired'),
    'streak', public.agent_streak(p_agent),
    'calls_today', (select count(*) from public.lead_activities
                    where actor_id = p_agent and created_at >= public.cairo_day_start(public.cairo_today())
                      and note ~ '^(📞|📵|⏰|📅|✋|🎉)'),
    'avg_first_touch_min', (
      select round(avg(extract(epoch from ft.first_at - l.created_at) / 60))
      from public.leads l
      cross join lateral (select min(la.created_at) first_at from public.lead_activities la
                          where la.lead_id = l.id and la.actor_id = p_agent and la.created_at > l.created_at + interval '1 second') ft
      where l.agent_id = p_agent and l.created_at > now() - interval '7 days' and ft.first_at is not null),
    'leads_7d', (select count(*) from public.leads where agent_id = p_agent and created_at > now() - interval '7 days')
  )
$$;

-- ───────── Live team view ─────────
-- Unfiltered (used by the alert job, which runs without a user).
create or replace function public.activity_today_all()
returns table (agent_id uuid, last_at timestamptz, last_note text, checkin_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id,
         (select max(x) from (values
            ((select max(created_at) from public.lead_activities where actor_id = p.id and created_at >= public.cairo_day_start(public.cairo_today()))),
            ((select max(created_at) from public.leads where created_by = p.id and created_at >= public.cairo_day_start(public.cairo_today())))) v(x)),
         (select coalesce(la.note, la.to_status::text) from public.lead_activities la
           where la.actor_id = p.id and la.created_at >= public.cairo_day_start(public.cairo_today())
           order by la.created_at desc limit 1),
         (select max(created_at) from public.geo_checkins where user_id = p.id and created_at >= public.cairo_day_start(public.cairo_today()))
  from public.profiles p
  where p.role = 'agent' and p.is_active
$$;

-- What the signed-in supervisor may see.
create or replace function public.team_activity_today()
returns table (agent_id uuid, last_at timestamptz, last_note text, checkin_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select * from public.activity_today_all() a where public.can_see_agent(a.agent_id)
$$;

-- ───────── Alerts ─────────
create table public.alert_log (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.alert_log enable row level security;  -- written by definer functions only

-- Who watches an agent: their team leader, else every active manager/admin.
create or replace function public.supervisors_of(p_agent uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  with tl as (
    select t.leader_id from public.profiles p join public.teams t on t.id = p.team_id
    join public.profiles l on l.id = t.leader_id and l.is_active
    where p.id = p_agent
  )
  select leader_id from tl
  union
  select id from public.profiles where role in ('admin', 'manager') and is_active and not exists (select 1 from tl)
$$;

create or replace function public.notify_once(p_key text, p_users uuid[], p_type public.notification_type, p_title text, p_body text, p_link text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.alert_log (key) values (p_key) on conflict do nothing;
  if not found then return false; end if;
  insert into public.notifications (user_id, type, title, body, link)
  select u, p_type, p_title, p_body, p_link from unnest(p_users) u where u is not null;
  return true;
end;
$$;

-- Every few minutes during working hours (09:00–22:00 Cairo).
create or replace function public.fire_delay_alerts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer := 0;
  hr integer := extract(hour from now() at time zone 'Africa/Cairo');
  day text := public.cairo_today()::text;
  r record;
begin
  if hr < 9 or hr >= 22 then return 0; end if;

  -- New leads nobody has called yet: agent at 30 min, supervisor at 60 min.
  for r in
    select l.id, l.full_name, l.agent_id, a.full_name agent_name, l.created_at
    from public.leads l join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.callback_at is null
      and l.created_at < now() - interval '30 minutes' and l.created_at > now() - interval '24 hours'
  loop
    if public.notify_once('slow:agent:' || r.id, array[r.agent_id], 'reminder',
         'ليد مستني من نص ساعة: ' || r.full_name, null, '/agent/leads/' || r.id) then n := n + 1; end if;
    if r.created_at < now() - interval '60 minutes' then
      if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ليد متأخر عند ' || r.agent_name || ': ' || r.full_name, 'محدش كلمه من ساعة', '/admin/leads/' || r.id) then n := n + 1; end if;
    end if;
  end loop;

  -- Agents who started the day but went quiet for an hour (not on a break). Once per agent per hour.
  for r in
    select p.id, p.full_name, t.last_at
    from public.profiles p
    join public.activity_today_all() t on t.agent_id = p.id
    where t.last_at < now() - interval '60 minutes'
      and not exists (select 1 from public.agent_breaks b where b.agent_id = p.id and b.status in ('pending', 'active') and coalesce(b.ends_at, now()) >= now())
  loop
    if public.notify_once('idle:' || r.id || ':' || day || ':' || hr, array(select public.supervisors_of(r.id)), 'info',
         '⚠️ مفيش نشاط من ساعة: ' || r.full_name, 'آخر حركة ' || to_char(r.last_at at time zone 'Africa/Cairo', 'HH24:MI'), '/admin/live') then n := n + 1; end if;
  end loop;

  -- Breaks that ran out 10+ minutes ago with no activity since.
  for r in
    select b.id, b.agent_id, p.full_name, b.ends_at
    from public.agent_breaks b join public.profiles p on p.id = b.agent_id
    where b.status in ('active', 'ended') and b.ends_at < now() - interval '10 minutes' and b.ends_at > now() - interval '3 hours'
      and coalesce(b.ended_at, b.ends_at) >= b.ends_at
      and not exists (select 1 from public.lead_activities la where la.actor_id = b.agent_id and la.created_at > b.ends_at)
      and not exists (select 1 from public.leads l where l.created_by = b.agent_id and l.created_at > b.ends_at)
  loop
    if public.notify_once('break:' || r.id, array(select public.supervisors_of(r.agent_id)) || r.agent_id, 'info',
         '⚠️ مرجعش من البريك: ' || r.full_name, 'البريك خلص ' || to_char(r.ends_at at time zone 'Africa/Cairo', 'HH24:MI'), '/admin/live') then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- 21:00 Cairo: summary notification to admins, managers and team leaders.
create or replace function public.send_daily_report()
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  d date := public.cairo_today();
  leads_n integer; hired_n integer; best text;
begin
  if extract(hour from now() at time zone 'Africa/Cairo') < 21 then return false; end if;
  select count(*) into leads_n from public.leads where created_at >= public.cairo_day_start(d) and created_at < public.cairo_day_start(d + 1);
  select count(*) into hired_n from public.leads where hired_at >= public.cairo_day_start(d) and hired_at < public.cairo_day_start(d + 1);
  select lb.full_name into best from public.leaderboard(d, d) lb where lb.points > 0 limit 1;
  return public.notify_once('daily:' || d, array(select id from public.profiles where role in ('admin', 'manager', 'team_leader') and is_active), 'info',
    '📊 التقرير اليومي جاهز: ' || d,
    leads_n || ' ليد · ' || hired_n || ' اشتغلوا' || coalesce(' · الأول: ' || best, ''),
    '/admin/report?date=' || d);
end;
$$;

do $$
begin
  perform cron.schedule('fire-delay-alerts', '*/5 * * * *', 'select public.fire_delay_alerts()');
  perform cron.schedule('send-daily-report', '*/15 * * * *', 'select public.send_daily_report()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;

-- ───────── Audit log ─────────
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  table_name text not null,
  row_id text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'
);
create index on public.audit_log (at desc);
create index on public.audit_log (table_name, row_id);
create index on public.audit_log (actor_id, at desc);
alter table public.audit_log enable row level security;
create policy "managers read audit" on public.audit_log for select to authenticated using (public.is_manager());

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ignored text[] := array['updated_at', 'callback_reminded_at', 'interview_reminded_at', 'last_contact_at', 'attempts'];
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  nw jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  j jsonb := coalesce(nw, o);
  diff jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    diff := '{}';
    for k in select jsonb_object_keys(nw) loop
      if not (k = any (ignored)) and (o -> k) is distinct from (nw -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, nw -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  else
    diff := j - ignored;
  end if;

  insert into public.audit_log (actor_id, actor_name, table_name, row_id, action, changes)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), tg_table_name,
          coalesce(j ->> 'id', concat_ws(':', j ->> 'agent_id', j ->> 'company_id')),
          lower(tg_op), diff);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['leads', 'profiles', 'teams', 'companies', 'agent_companies', 'daily_targets', 'tasks',
                           'company_announcements', 'work_locations', 'blacklist', 'whatsapp_templates', 'lead_documents', 'agent_breaks']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', 'audit_' || t, t);
  end loop;
end;
$$;

-- ───────── Grants ─────────
grant select on public.audit_log to authenticated;
grant all on public.audit_log, public.alert_log to service_role;
revoke execute on function public.audit_row(), public.notify_once(text, uuid[], public.notification_type, text, text, text),
  public.fire_delay_alerts(), public.send_daily_report(), public.supervisors_of(uuid), public.activity_today_all() from anon, authenticated, public;
revoke execute on function public.agent_streak(uuid), public.leaderboard(date, date), public.agent_stats(uuid),
  public.team_activity_today(), public.cairo_day_start(date), public.cairo_today() from anon, public;
grant execute on function public.agent_streak(uuid), public.leaderboard(date, date), public.agent_stats(uuid),
  public.team_activity_today(), public.cairo_day_start(date), public.cairo_today() to authenticated;
