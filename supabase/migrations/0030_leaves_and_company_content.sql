-- 1. Managers fully manage a company's sign-up form and call script (the rest of the company row stays admin-only).
create or replace function public.save_company_content(p_id uuid, p_form_schema jsonb, p_call_script text, p_set_script boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  if p_form_schema is not null and jsonb_typeof(p_form_schema) <> 'array' then raise exception 'bad_schema' using errcode = '22023'; end if;
  update public.companies
  set form_schema = coalesce(p_form_schema, form_schema),
      call_script = case when p_set_script then nullif(left(p_call_script, 4000), '') else call_script end
  where id = p_id;
end;
$$;
revoke execute on function public.save_company_content(uuid, jsonb, text, boolean) from anon, public;
grant execute on function public.save_company_content(uuid, jsonb, text, boolean) to authenticated;

-- 2. Leave requests.
--    Agent → their team leader (or a manager/admin) decides. Team leader → a manager or the admin. Manager → the admin.
create type public.leave_kind as enum ('annual', 'casual', 'sick', 'unpaid');
create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.leave_kind not null,
  start_date date not null,
  end_date date not null,
  days integer not null,
  reason text,
  status public.leave_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date and end_date <= start_date + 60)
);
create index on public.leave_requests (user_id, start_date desc);
create index on public.leave_requests (status, start_date);
create index on public.leave_requests (decided_by);
alter table public.leave_requests enable row level security;

-- Who may decide on a person's leave.
create or replace function public.can_decide_leave(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user <> auth.uid() and exists (
    select 1 from public.profiles me, public.profiles them
    where me.id = auth.uid() and me.is_active and them.id = p_user
      and (me.role = 'admin'
           or (me.role = 'manager' and them.role in ('agent', 'team_leader'))
           or (me.role = 'team_leader' and them.role = 'agent' and me.team_id is not null and them.team_id = me.team_id)))
$$;
revoke execute on function public.can_decide_leave(uuid) from anon, public;
grant execute on function public.can_decide_leave(uuid) to authenticated;

create policy "read leaves" on public.leave_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.can_decide_leave(user_id) or (select public.is_admin()));
create policy "active users only" on public.leave_requests as restrictive for all to authenticated
  using ((select public.my_role()) is not null) with check ((select public.my_role()) is not null);
grant select on public.leave_requests to authenticated;

-- Working days in a range (weekly off days don't count).
create or replace function public.workdays_between(p_from date, p_to date)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::integer from generate_series(p_from, p_to, interval '1 day') g, public.work_settings s
  where s.id = 1 and not (extract(isodow from g)::integer = any (s.off_days))
$$;

create or replace function public.leave_deciders(p_user uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select array(
    select l.id from public.profiles them join public.teams t on t.id = them.team_id join public.profiles l on l.id = t.leader_id
    where them.id = p_user and them.role = 'agent' and l.is_active and l.id <> p_user
    union
    select a.id from public.profiles a, public.profiles them
    where them.id = p_user and a.is_active and a.id <> p_user
      and (a.role = 'admin' or (a.role = 'manager' and them.role in ('agent', 'team_leader'))))
$$;
revoke execute on function public.leave_deciders(uuid) from anon, authenticated, public;

create or replace function public.request_leave(p_kind public.leave_kind, p_from date, p_to date, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  v_id uuid;
  v_days integer;
  v_earliest date := public.cairo_today() - (case when p_kind = 'sick' then 7 else 0 end);
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found or me.role = 'admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'bad_dates' using errcode = '22023'; end if;
  if p_to > p_from + 60 then raise exception 'too_long' using errcode = '22023'; end if;
  -- Sick leave may be logged after the fact (up to a week); anything else is asked for in advance or today.
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

  insert into public.notifications (user_id, type, title, body, link)
  select u, 'info', '🌴 ' || me.full_name || ' طالب إجازة ' || v_days || ' يوم',
         to_char(p_from, 'DD/MM') || case when p_to > p_from then ' → ' || to_char(p_to, 'DD/MM') else '' end
           || coalesce(' — ' || nullif(btrim(p_reason), ''), ''),
         '/admin/leaves'
  from unnest(public.leave_deciders(me.id)) u;
  return v_id;
end;
$$;
revoke execute on function public.request_leave(public.leave_kind, date, date, text) from anon, public;
grant execute on function public.request_leave(public.leave_kind, date, date, text) to authenticated;

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not public.can_decide_leave(r.user_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  update public.leave_requests
  set status = case when p_approve then 'approved'::public.leave_status else 'rejected'::public.leave_status end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(p_note), 300), '')
  where id = p_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (r.user_id, 'info',
          case when p_approve then '✅ إجازتك اتوافق عليها' else '❌ طلب إجازتك اترفض' end,
          to_char(r.start_date, 'DD/MM') || case when r.end_date > r.start_date then ' → ' || to_char(r.end_date, 'DD/MM') else '' end
            || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
          case when (select role from public.profiles where id = r.user_id) = 'agent' then '/agent/leaves' else '/admin/leaves' end);
end;
$$;
revoke execute on function public.decide_leave(uuid, boolean, text) from anon, public;
grant execute on function public.decide_leave(uuid, boolean, text) to authenticated;

-- The requester may cancel a pending request, or an approved one that hasn't started.
create or replace function public.cancel_leave(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.leave_requests set status = 'cancelled', decided_at = now()
  where id = p_id and user_id = auth.uid()
    and (status = 'pending' or (status = 'approved' and start_date > public.cairo_today()));
  if not found then raise exception 'cannot_cancel'; end if;
end;
$$;
revoke execute on function public.cancel_leave(uuid) from anon, public;
grant execute on function public.cancel_leave(uuid) to authenticated;

create or replace function public.on_leave(p_user uuid, p_day date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.leave_requests where user_id = p_user and status = 'approved' and p_day between start_date and end_date)
$$;
revoke execute on function public.on_leave(uuid, date) from anon, public;
grant execute on function public.on_leave(uuid, date) to authenticated;

-- 3. Attendance: someone on approved leave isn't absent, and nobody is alerted about them.
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
      and not public.on_leave(pr.id, d)
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

drop function public.attendance_month(date);
create function public.attendance_month(p_month date)
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
    select g::date as d from bounds, s, generate_series(bounds.m_from, bounds.m_to, interval '1 day') g
    where not (extract(isodow from g)::integer = any (s.off_days))
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
    select a.user_id, a.day, a.first_seen, a.last_seen,
           greatest(0, floor(extract(epoch from (a.first_seen - (public.cairo_day_start(a.day) + s.shift_start))) / 60))::integer as late_by
    from public.attendance a, bounds, s
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
revoke execute on function public.attendance_month(date) from anon, public;
grant execute on function public.attendance_month(date) to authenticated;

-- Keep leave requests in the audit log like the other tables.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'audit_row') then
    create trigger audit_leave_requests after insert or update or delete on public.leave_requests
      for each row execute function public.audit_row();
  end if;
end $$;
