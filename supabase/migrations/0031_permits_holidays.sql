-- 1. Official holidays: one list for everyone; nobody is absent or late on them.
create table public.public_holidays (
  day date primary key,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.public_holidays (created_by);
alter table public.public_holidays enable row level security;
create policy "read holidays" on public.public_holidays for select to authenticated using (true);
create policy "managers write holidays" on public.public_holidays for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
create policy "active users only" on public.public_holidays as restrictive for all to authenticated
  using ((select public.my_role()) is not null) with check ((select public.my_role()) is not null);
grant select, insert, update, delete on public.public_holidays to authenticated;

create or replace function public.is_day_off(p_day date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.work_settings s where s.id = 1 and extract(isodow from p_day)::integer = any (s.off_days))
      or exists (select 1 from public.public_holidays h where h.day = p_day)
$$;
grant execute on function public.is_day_off(date) to authenticated;

create or replace function public.workdays_between(p_from date, p_to date)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::integer from generate_series(p_from, p_to, interval '1 day') g where not public.is_day_off(g::date)
$$;

-- 2. Hourly permits: come in late, or leave early, on one day.
create table public.hour_permits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('late_arrival', 'early_leave')),
  at_time time not null,               -- late arrival: "I'll be in by"; early leave: "I'm leaving at"
  reason text,
  status public.leave_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create unique index hour_permits_one_per_kind on public.hour_permits (user_id, day, kind) where status in ('pending', 'approved');
create index on public.hour_permits (day, status);
create index on public.hour_permits (decided_by);
alter table public.hour_permits enable row level security;
create policy "read permits" on public.hour_permits for select to authenticated
  using (user_id = (select auth.uid()) or public.can_decide_leave(user_id) or (select public.is_admin()));
create policy "active users only" on public.hour_permits as restrictive for all to authenticated
  using ((select public.my_role()) is not null) with check ((select public.my_role()) is not null);
grant select on public.hour_permits to authenticated;

create or replace function public.request_permit(p_kind text, p_day date, p_time time, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  s public.work_settings;
  v_id uuid;
  label text;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found or me.role = 'admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_kind not in ('late_arrival', 'early_leave') then raise exception 'bad_kind' using errcode = '22023'; end if;
  if p_day < public.cairo_today() or p_day > public.cairo_today() + 30 then raise exception 'past_date' using errcode = '22023'; end if;
  if public.is_day_off(p_day) then raise exception 'no_workdays' using errcode = '22023'; end if;
  select * into s from public.work_settings where id = 1;
  if p_kind = 'late_arrival' and p_time <= s.shift_start then raise exception 'bad_time' using errcode = '22023'; end if;
  if p_kind = 'late_arrival' and p_time > s.shift_start + interval '4 hours' then raise exception 'too_long' using errcode = '22023'; end if;
  if exists (select 1 from public.leave_requests where user_id = me.id and status in ('pending', 'approved') and p_day between start_date and end_date) then
    raise exception 'overlap' using errcode = '23505';
  end if;
  begin
    insert into public.hour_permits (user_id, day, kind, at_time, reason)
    values (me.id, p_day, p_kind, p_time, nullif(left(btrim(p_reason), 300), ''))
    returning id into v_id;
  exception when unique_violation then raise exception 'overlap' using errcode = '23505';
  end;
  label := case when p_kind = 'late_arrival' then 'إذن تأخير لحد ' else 'إذن خروج بدري الساعة ' end;
  insert into public.notifications (user_id, type, title, body, link)
  select u, 'info', '⏱️ ' || me.full_name || ' طالب ' || label || to_char(p_time, 'HH24:MI'),
         to_char(p_day, 'DD/MM') || coalesce(' — ' || nullif(btrim(p_reason), ''), ''), '/admin/leaves'
  from unnest(public.leave_deciders(me.id)) u;
  return v_id;
end;
$$;
revoke execute on function public.request_permit(text, date, time, text) from anon, public;
grant execute on function public.request_permit(text, date, time, text) to authenticated;

create or replace function public.decide_permit(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r public.hour_permits;
begin
  select * into r from public.hour_permits where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not public.can_decide_leave(r.user_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  update public.hour_permits
  set status = case when p_approve then 'approved'::public.leave_status else 'rejected'::public.leave_status end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(p_note), 300), '')
  where id = p_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (r.user_id, 'info',
          case when p_approve then '✅ الإذن بتاعك اتوافق عليه' else '❌ طلب الإذن اترفض' end,
          to_char(r.day, 'DD/MM') || ' · ' || to_char(r.at_time, 'HH24:MI') || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
          case when (select role from public.profiles where id = r.user_id) = 'agent' then '/agent/leaves' else '/admin/leaves' end);
end;
$$;
revoke execute on function public.decide_permit(uuid, boolean, text) from anon, public;
grant execute on function public.decide_permit(uuid, boolean, text) to authenticated;

create or replace function public.cancel_permit(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.hour_permits set status = 'cancelled', decided_at = now()
  where id = p_id and user_id = auth.uid() and status in ('pending', 'approved') and day >= public.cairo_today();
  if not found then raise exception 'cannot_cancel'; end if;
end;
$$;
revoke execute on function public.cancel_permit(uuid) from anon, public;
grant execute on function public.cancel_permit(uuid) to authenticated;

-- When someone's working day starts: shift start, or later if they have an approved late-arrival permit.
create or replace function public.expected_start(p_user uuid, p_day date)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select public.cairo_day_start(p_day) + greatest(s.shift_start,
           coalesce((select max(at_time) from public.hour_permits
                     where user_id = p_user and day = p_day and kind = 'late_arrival' and status = 'approved'), s.shift_start))
  from public.work_settings s where s.id = 1
$$;
grant execute on function public.expected_start(uuid, date) to authenticated;

-- 3. How many of a person's team are already off on the busiest day of a range.
create or replace function public.team_leave_load(p_user uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with me as (select team_id from public.profiles where id = p_user),
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
revoke execute on function public.team_leave_load(uuid, date, date) from anon, public;
grant execute on function public.team_leave_load(uuid, date, date) to authenticated;

-- request_leave now warns the deciders when the team would be more than half out.
create or replace function public.request_leave(p_kind public.leave_kind, p_from date, p_to date, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  v_id uuid;
  v_days integer;
  v_earliest date := public.cairo_today() - (case when p_kind = 'sick' then 7 else 0 end);
  v_load jsonb;
  v_warn text := '';
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found or me.role = 'admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'bad_dates' using errcode = '22023'; end if;
  if p_to > p_from + 60 then raise exception 'too_long' using errcode = '22023'; end if;
  if p_from < v_earliest then raise exception 'past_date' using errcode = '22023'; end if;
  if exists (select 1 from public.leave_requests where user_id = me.id and status in ('pending', 'approved')
             and daterange(start_date, end_date, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'overlap' using errcode = '23505';
  end if;
  v_days := public.workdays_between(p_from, p_to);
  if v_days = 0 then raise exception 'no_workdays' using errcode = '22023'; end if;

  insert into public.leave_requests (user_id, kind, start_date, end_date, days, reason)
  values (me.id, p_kind, p_from, p_to, v_days, nullif(left(btrim(p_reason), 300), ''))
  returning id into v_id;

  if me.role = 'agent' then
    v_load := public.team_leave_load(me.id, p_from, p_to);
    if (v_load->>'team')::integer > 1 and ((v_load->>'peak')::integer + 1) * 2 > (v_load->>'team')::integer then
      v_warn := ' ⚠️ لو اتوافق هيبقى ' || ((v_load->>'peak')::integer + 1) || ' من ' || (v_load->>'team') || ' في التيم إجازة يوم '
                || to_char((v_load->>'peak_day')::date, 'DD/MM');
    end if;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  select u, 'info', '🌴 ' || me.full_name || ' طالب إجازة ' || v_days || ' يوم',
         to_char(p_from, 'DD/MM') || case when p_to > p_from then ' → ' || to_char(p_to, 'DD/MM') else '' end
           || coalesce(' — ' || nullif(btrim(p_reason), ''), '') || v_warn,
         '/admin/leaves'
  from unnest(public.leave_deciders(me.id)) u;
  return v_id;
end;
$$;

-- 4. Attendance honours holidays and late-arrival permits.
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
  if not public.location_ok() then return null; end if;

  insert into public.attendance (user_id, day) values (me.id, d)
  on conflict (user_id, day) do update set last_seen = now()
  returning (xmax = 0) into first_time;

  if first_time and not public.is_day_off(d) then
    select * into s from public.work_settings where id = 1;
    late_min := floor(extract(epoch from (now() - public.expected_start(me.id, d))) / 60)::integer;
    if late_min > s.grace_minutes then
      perform public.notify_once('late:' || d || ':' || me.id, array(select public.supervisors_of(me.id)), 'info',
        '⏰ ' || me.full_name || ' وصل متأخر ' || late_min || ' دقيقة', null, '/admin/attendance');
    end if;
  end if;
  return jsonb_build_object('day', d, 'first', first_time);
end;
$$;

create or replace function public.fire_attendance_alerts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  s public.work_settings;
  d date := public.cairo_today();
  n integer := 0;
  p record;
begin
  select * into s from public.work_settings where id = 1;
  if public.is_day_off(d) then return 0; end if;
  for p in
    select pr.id, pr.full_name from public.profiles pr
    where pr.is_active and pr.role in ('agent', 'team_leader')
      and not exists (select 1 from public.attendance a where a.user_id = pr.id and a.day = d)
      and not public.on_leave(pr.id, d)
      and now() between public.expected_start(pr.id, d) + interval '1 hour' and public.expected_start(pr.id, d) + interval '3 hours'
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

create or replace function public.attendance_month(p_month date)
returns table (user_id uuid, full_name text, role public.user_role, team_id uuid, present integer, late_days integer,
               late_minutes integer, absent integer, leave_days integer, avg_hours numeric, avg_first time)
language sql stable security definer set search_path = public
as $$
  with s as (select * from public.work_settings where id = 1),
  bounds as (
    select date_trunc('month', p_month)::date as m_from,
           least((date_trunc('month', p_month) + interval '1 month - 1 day')::date, public.cairo_today()) as m_to
  ),
  workdays as (
    select g::date as d from bounds, generate_series(bounds.m_from, bounds.m_to, interval '1 day') g
    where not public.is_day_off(g::date)
  ),
  people as (
    select p.id, p.full_name, p.role, p.team_id, (p.created_at at time zone 'Africa/Cairo')::date as since
    from public.profiles p
    where p.is_active and p.role in ('agent', 'team_leader') and public.can_see_agent(p.id)
  ),
  leave_days as (
    select pe.id as user_id, w.d
    from people pe join workdays w on w.d >= pe.since
    where exists (select 1 from public.leave_requests l where l.user_id = pe.id and l.status = 'approved' and w.d between l.start_date and l.end_date)
  ),
  att as (
    -- Lateness counts only on working days, from the expected start (shift start or an approved permit).
    select a.user_id, a.day, a.first_seen, a.last_seen,
           case when public.is_day_off(a.day) then 0
                else greatest(0, floor(extract(epoch from (a.first_seen - public.expected_start(a.user_id, a.day))) / 60))::integer end as late_by
    from public.attendance a, bounds
    where a.day between bounds.m_from and bounds.m_to
  )
  select pe.id, pe.full_name, pe.role, pe.team_id,
         count(att.day)::integer,
         count(*) filter (where att.late_by > s.grace_minutes)::integer,
         coalesce(sum(att.late_by) filter (where att.late_by > s.grace_minutes), 0)::integer,
         (select count(*) from workdays w where w.d >= pe.since and w.d < public.cairo_today()
             and not exists (select 1 from public.attendance x where x.user_id = pe.id and x.day = w.d)
             and not exists (select 1 from leave_days ld where ld.user_id = pe.id and ld.d = w.d))::integer,
         (select count(*) from leave_days ld where ld.user_id = pe.id)::integer,
         round(avg(extract(epoch from (att.last_seen - att.first_seen)) / 3600)::numeric, 1),
         (avg((att.first_seen at time zone 'Africa/Cairo')::time - time '00:00') + time '00:00')::time(0)
  from people pe cross join s
  left join att on att.user_id = pe.id
  group by pe.id, pe.full_name, pe.role, pe.team_id, pe.since, s.grace_minutes
  order by pe.full_name
$$;

create trigger audit_hour_permits after insert or update or delete on public.hour_permits
  for each row execute function public.audit_row();
create trigger audit_public_holidays after insert or update or delete on public.public_holidays
  for each row execute function public.audit_row();
