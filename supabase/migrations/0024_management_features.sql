-- Management features: admin approval requests, attendance, sign-in log with forced sign-out,
-- internal memos (broadcasts) with read receipts, and the weekly agent scorecard.

-- ═════════ 1. Approval requests (manager → admin) ═════════
create table public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('deactivate', 'activate')),
  target_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  requested_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create unique index admin_requests_one_pending on public.admin_requests (target_id) where status = 'pending';
create index on public.admin_requests (status, created_at desc);
alter table public.admin_requests enable row level security;

create policy "read requests" on public.admin_requests for select to authenticated
  using ((select public.is_admin()) or requested_by = (select auth.uid()));
create policy "managers request" on public.admin_requests for insert to authenticated
  with check (
    (select public.my_role()) = 'manager'
    and requested_by = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.profiles t
      where t.id = target_id and t.role in ('team_leader', 'agent')
        and ((kind = 'deactivate' and t.is_active) or (kind = 'activate' and not t.is_active))
    )
  );
grant select, insert on public.admin_requests to authenticated;

create or replace function public.notify_admins_of_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  who text := (select full_name from public.profiles where id = new.requested_by);
  target text := (select full_name from public.profiles where id = new.target_id);
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'task',
         case new.kind when 'deactivate' then '🛑 طلب إيقاف حساب: ' else '✅ طلب تفعيل حساب: ' end || target,
         who || ': ' || new.reason, '/admin/requests'
  from public.profiles p where p.role = 'admin' and p.is_active;
  return new;
end;
$$;
revoke execute on function public.notify_admins_of_request() from anon, authenticated, public;
create trigger admin_requests_notify after insert on public.admin_requests
  for each row execute function public.notify_admins_of_request();

-- Signs a user out of every device right away (their sessions stop being accepted).
create or replace function public.force_sign_out(p_user uuid)
returns integer
language plpgsql security definer set search_path = public, auth
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot_sign_out_self' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.force_sign_out(uuid) from anon, public;
grant execute on function public.force_sign_out(uuid) to authenticated;

create or replace function public.decide_admin_request(p_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public, auth
as $$
declare r public.admin_requests;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into r from public.admin_requests where id = p_id and status = 'pending' for update;
  if not found then return 'gone'; end if;

  update public.admin_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
  where id = p_id;

  if p_approve then
    update public.profiles set is_active = (r.kind = 'activate') where id = r.target_id;
    if r.kind = 'deactivate' then delete from auth.sessions where user_id = r.target_id; end if;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (r.requested_by, 'task',
          case when p_approve then '✅ الأدمن وافق على طلبك: ' else '❌ الأدمن رفض طلبك: ' end
            || (select full_name from public.profiles where id = r.target_id),
          coalesce(nullif(btrim(p_note), ''), case r.kind when 'deactivate' then 'إيقاف الحساب' else 'تفعيل الحساب' end),
          '/admin/agents/' || r.target_id);
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;
revoke execute on function public.decide_admin_request(uuid, boolean, text) from anon, public;
grant execute on function public.decide_admin_request(uuid, boolean, text) to authenticated;

create or replace function public.cancel_admin_request(p_id uuid)
returns boolean
language sql security definer set search_path = public
as $$
  update public.admin_requests set status = 'cancelled', decided_at = now()
  where id = p_id and status = 'pending' and requested_by = auth.uid()
  returning true
$$;
revoke execute on function public.cancel_admin_request(uuid) from anon, public;
grant execute on function public.cancel_admin_request(uuid) to authenticated;

-- ═════════ 2. Attendance ═════════
create table public.work_settings (
  id integer primary key default 1 check (id = 1),
  shift_start time not null default '10:00',
  grace_minutes integer not null default 15 check (grace_minutes between 0 and 180),
  off_days integer[] not null default '{5}', -- ISO weekday numbers (1 = Monday … 7 = Sunday); 5 = Friday
  updated_at timestamptz not null default now()
);
insert into public.work_settings (id) values (1) on conflict do nothing;
alter table public.work_settings enable row level security;
create policy "read work settings" on public.work_settings for select to authenticated using (true);
create policy "managers edit work settings" on public.work_settings for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
grant select, update on public.work_settings to authenticated;

create table public.attendance (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, day)
);
create index on public.attendance (day);
alter table public.attendance enable row level security;
create policy "read attendance" on public.attendance for select to authenticated
  using ((select public.sees_all()) or user_id = (select auth.uid()) or user_id = any ((select public.my_team_member_ids())::uuid[]));
grant select on public.attendance to authenticated;

-- Called by the app every few minutes while an agent or team leader has it open.
create or replace function public.touch_attendance()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  s public.work_settings;
  d date := public.cairo_today();
  first_time boolean;
  late_min integer;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found or me.role not in ('agent', 'team_leader') then return null; end if;

  insert into public.attendance (user_id, day) values (me.id, d)
  on conflict (user_id, day) do update set last_seen = now()
  returning (xmax = 0) into first_time;

  if first_time then
    select * into s from public.work_settings where id = 1;
    late_min := floor(extract(epoch from (now() - (public.cairo_day_start(d) + s.shift_start))) / 60)::integer;
    if not (extract(isodow from d)::integer = any (s.off_days)) and late_min > s.grace_minutes then
      perform public.notify_once('late:' || d || ':' || me.id, array(select public.supervisors_of(me.id)), 'info',
        '⏰ ' || me.full_name || ' وصل متأخر ' || late_min || ' دقيقة', null, '/admin/attendance');
    end if;
  end if;
  return jsonb_build_object('day', d, 'first', first_time);
end;
$$;
revoke execute on function public.touch_attendance() from anon, public;
grant execute on function public.touch_attendance() to authenticated;

-- Once per person per day: tell the team leader who hasn't shown up an hour into the shift.
create or replace function public.fire_attendance_alerts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  s public.work_settings;
  d date := public.cairo_today();
  start_at timestamptz;
  n integer := 0;
  p record;
begin
  select * into s from public.work_settings where id = 1;
  if extract(isodow from d)::integer = any (s.off_days) then return 0; end if;
  start_at := public.cairo_day_start(d) + s.shift_start;
  if now() < start_at + interval '1 hour' or now() > start_at + interval '3 hours' then return 0; end if;
  for p in
    select pr.id, pr.full_name from public.profiles pr
    where pr.is_active and pr.role in ('agent', 'team_leader')
      and not exists (select 1 from public.attendance a where a.user_id = pr.id and a.day = d)
  loop
    if public.notify_once('absent:' || d || ':' || p.id, array(select public.supervisors_of(p.id)), 'info',
         '🚫 ' || p.full_name || ' لسه مجاش النهارده', null, '/admin/attendance') then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.fire_attendance_alerts() from anon, authenticated, public;

-- One row per person for a month: days present, late days, minutes late, absences and average hours.
create or replace function public.attendance_month(p_month date)
returns table (user_id uuid, full_name text, role public.user_role, team_id uuid, present integer, late_days integer,
               late_minutes integer, absent integer, avg_hours numeric, avg_first time)
language sql stable security definer set search_path = public
as $$
  with s as (select * from public.work_settings where id = 1),
  bounds as (
    select date_trunc('month', p_month)::date as m_from,
           least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, public.cairo_today()) as m_to
  ),
  workdays as (
    select g::date as d from bounds, s, generate_series(bounds.m_from, bounds.m_to, interval '1 day') g
    where not (extract(isodow from g)::integer = any (s.off_days))
  ),
  people as (
    select p.id, p.full_name, p.role, p.team_id, (p.created_at at time zone 'Africa/Cairo')::date as since
    from public.profiles p
    where p.is_active and p.role in ('agent', 'team_leader') and public.can_see_agent(p.id)
  ),
  att as (
    select a.user_id, a.day, a.first_seen, a.last_seen,
           greatest(0, floor(extract(epoch from (a.first_seen - (public.cairo_day_start(a.day) + s.shift_start))) / 60))::integer as late_by
    from public.attendance a, bounds, s
    where a.day between bounds.m_from and bounds.m_to
  )
  select pe.id, pe.full_name, pe.role, pe.team_id,
         count(att.day)::integer,
         count(*) filter (where att.late_by > s.grace_minutes)::integer,
         coalesce(sum(att.late_by) filter (where att.late_by > s.grace_minutes), 0)::integer,
         ((select count(*) from workdays w where w.d >= pe.since and w.d <= public.cairo_today()
             and not exists (select 1 from public.attendance x where x.user_id = pe.id and x.day = w.d))
           - case when public.cairo_today() in (select d from workdays)
                   and not exists (select 1 from public.attendance x where x.user_id = pe.id and x.day = public.cairo_today())
                  then 1 else 0 end)::integer,  -- today isn't an absence yet
         round(avg(extract(epoch from (att.last_seen - att.first_seen)) / 3600)::numeric, 1),
         (avg((att.first_seen at time zone 'Africa/Cairo')::time - time '00:00') + time '00:00')::time(0)
  from people pe cross join s
  left join att on att.user_id = pe.id
  group by pe.id, pe.full_name, pe.role, pe.team_id, pe.since, s.grace_minutes
  order by pe.full_name
$$;
revoke execute on function public.attendance_month(date) from anon, public;
grant execute on function public.attendance_month(date) to authenticated;

-- ═════════ 3. Sign-in log ═════════
create table public.login_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  method text not null check (method in ('password', 'passkey')),
  ip text,
  device text,
  user_agent text
);
create index on public.login_events (at desc);
create index on public.login_events (user_id, at desc);
alter table public.login_events enable row level security;
create policy "admins read logins" on public.login_events for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));
grant select on public.login_events to authenticated;
-- Rows are written by the server (service role) right after a successful sign-in.

-- Active sessions per user, for the admin page.
create or replace function public.active_sessions()
returns table (user_id uuid, sessions integer, last_active timestamptz)
language sql stable security definer set search_path = public, auth
as $$
  select s.user_id, count(*)::integer, max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
  from auth.sessions s
  where public.is_admin() and (s.not_after is null or s.not_after > now())
  group by s.user_id
$$;
revoke execute on function public.active_sessions() from anon, public;
grant execute on function public.active_sessions() to authenticated;

-- A session the admin ended stops working immediately, not when its token expires.
create or replace function public.my_session()
returns jsonb
language sql stable security definer set search_path = public, auth
as $$
  select jsonb_build_object(
    'profile', to_jsonb(p) - 'created_at',
    'unread', (select count(*) from public.notifications n where n.user_id = p.id and not n.is_read),
    'location_ok', public.location_ok(),
    'location_name', (select w.name from public.work_locations w where w.id = p.location_id)
  )
  from public.profiles p
  where p.id = auth.uid()
    and (auth.jwt() ->> 'session_id' is null
         or exists (select 1 from auth.sessions s where s.id = (auth.jwt() ->> 'session_id')::uuid))
$$;

-- ═════════ 4. Internal memos (broadcasts) ═════════
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 150),
  body text not null check (length(btrim(body)) between 2 and 4000),
  team_id uuid references public.teams(id) on delete cascade, -- null = everyone
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.broadcasts (created_at desc);
alter table public.broadcasts enable row level security;
create policy "read broadcasts" on public.broadcasts for select to authenticated
  using (
    (select public.sees_all()) or created_by = (select auth.uid()) or team_id is null
    or team_id = (select p.team_id from public.profiles p where p.id = (select auth.uid()))
  );
create policy "staff post broadcasts" on public.broadcasts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and ((select public.is_manager())
         or ((select public.my_role()) = 'team_leader' and team_id is not null
             and team_id = (select p.team_id from public.profiles p where p.id = (select auth.uid()))))
  );
create policy "remove own broadcasts" on public.broadcasts for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));
grant select, insert, delete on public.broadcasts to authenticated;

create table public.broadcast_reads (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);
alter table public.broadcast_reads enable row level security;
create policy "read receipts" on public.broadcast_reads for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "mark own read" on public.broadcast_reads for insert to authenticated
  with check (user_id = (select auth.uid()));
grant select, insert on public.broadcast_reads to authenticated;

create or replace function public.notify_broadcast()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'info', '📢 ' || new.title, left(new.body, 140),
         case when p.role = 'agent' then '/agent/memos' else '/admin/memos' end
  from public.profiles p
  where p.is_active and p.id <> new.created_by
    and (new.team_id is null or p.team_id = new.team_id);
  return new;
end;
$$;
revoke execute on function public.notify_broadcast() from anon, authenticated, public;
create trigger broadcasts_notify after insert on public.broadcasts
  for each row execute function public.notify_broadcast();

-- Who a memo is for (active people other than its author) and who has read it.
create or replace function public.broadcast_audience(p_id uuid)
returns table (user_id uuid, full_name text, read_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, r.read_at
  from public.broadcasts b
  join public.profiles p on p.is_active and p.id <> b.created_by and (b.team_id is null or p.team_id = b.team_id)
  left join public.broadcast_reads r on r.broadcast_id = b.id and r.user_id = p.id
  where b.id = p_id and public.is_staff() and (public.sees_all() or b.created_by = auth.uid() or b.team_id = (select team_id from public.profiles where id = auth.uid()))
  order by r.read_at nulls first, p.full_name
$$;
revoke execute on function public.broadcast_audience(uuid) from anon, public;
grant execute on function public.broadcast_audience(uuid) to authenticated;

-- ═════════ 5. Weekly scorecard ═════════
-- One agent's numbers for a period next to the average of all active agents.
create or replace function public.agent_scorecard(p_agent uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with r as (select public.cairo_day_start(p_from) as t0, public.cairo_day_start(p_to + 1) as t1),
  agents as (select id from public.profiles where role = 'agent' and is_active),
  per as (
    select a.id,
      (select count(*) from public.leads l, r where l.agent_id = a.id and l.created_at >= r.t0 and l.created_at < r.t1) as leads,
      (select count(*) from public.leads l, r where l.agent_id = a.id and l.hired_at >= r.t0 and l.hired_at < r.t1) as hired,
      (select count(*) from public.lead_activities x, r where x.actor_id = a.id and x.to_status is not null and x.created_at >= r.t0 and x.created_at < r.t1) as outcomes,
      (select count(*) from public.lead_activities x, r where x.actor_id = a.id and x.to_status = 'no_answer' and x.created_at >= r.t0 and x.created_at < r.t1) as no_answer,
      (select count(*) from public.lead_activities x, r where x.actor_id = a.id and x.to_status = 'interview' and x.created_at >= r.t0 and x.created_at < r.t1) as interviews,
      (select count(*) from public.call_logs c, r where c.agent_id = a.id and c.started_at >= r.t0 and c.started_at < r.t1) as calls,
      (select coalesce(sum(c.duration_s), 0) / 60 from public.call_logs c, r where c.agent_id = a.id and c.started_at >= r.t0 and c.started_at < r.t1) as talk_min,
      (select avg(extract(epoch from (f.first_at - l.created_at)) / 60)
         from public.leads l, r,
         lateral (select min(x.created_at) as first_at from public.lead_activities x where x.lead_id = l.id and x.actor_id = a.id) f
         where l.agent_id = a.id and l.created_at >= r.t0 and l.created_at < r.t1 and f.first_at is not null) as first_call_min
    from agents a
  ),
  scored as (
    select *,
      case when outcomes > 0 then round(100.0 * (outcomes - no_answer) / outcomes) end as answer_rate,
      case when leads > 0 then round(100.0 * hired / leads) end as conversion
    from per
  )
  select case when public.can_see_agent(p_agent) then jsonb_build_object(
    'me', (select to_jsonb(s) - 'id' from scored s where s.id = p_agent),
    'team', (select jsonb_build_object(
        'leads', round(avg(leads), 1), 'hired', round(avg(hired), 1), 'calls', round(avg(calls), 1),
        'interviews', round(avg(interviews), 1), 'talk_min', round(avg(talk_min)),
        'answer_rate', round(avg(answer_rate)), 'conversion', round(avg(conversion)),
        'first_call_min', round(avg(first_call_min))) from scored),
    'rank', (select count(*) + 1 from scored s2 where s2.hired > coalesce((select hired from scored where id = p_agent), 0)),
    'agents', (select count(*) from scored)
  ) end
$$;
revoke execute on function public.agent_scorecard(uuid, date, date) from anon, public;
grant execute on function public.agent_scorecard(uuid, date, date) to authenticated;

-- Saturday morning: every agent gets a nudge to open last week's scorecard.
create or replace function public.send_weekly_scorecards()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  today date := public.cairo_today();
  wk text := to_char(today, 'IYYY-IW');
begin
  if extract(isodow from today) <> 6 or extract(hour from now() at time zone 'Africa/Cairo') < 10 then return 0; end if;
  if not public.notify_once('scorecard:' || wk, array(select id from public.profiles where role = 'agent' and is_active), 'info',
       '📈 تقييمك الأسبوعي جاهز', 'شوف أرقامك الأسبوع اللي فات مقارنة بالفريق', '/agent/scorecard') then
    return 0;
  end if;
  return 1;
end;
$$;
revoke execute on function public.send_weekly_scorecards() from anon, authenticated, public;

do $$
begin
  perform cron.schedule('fire-attendance-alerts', '*/10 * * * *', 'select public.fire_attendance_alerts()');
  perform cron.schedule('send-weekly-scorecards', '23 * * * 6', 'select public.send_weekly_scorecards()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;
