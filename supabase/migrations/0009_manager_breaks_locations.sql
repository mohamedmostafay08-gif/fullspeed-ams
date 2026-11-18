-- Manager role permissions, agent breaks, work-location gating and acquisition analytics.

-- ───────── Roles ─────────
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'manager', 'team_leader'), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'manager'), false)
$$;

create or replace function public.can_see_agent(p_agent uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_agent = auth.uid()
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.is_active
        and (
          me.role in ('admin', 'manager')
          or (
            me.role = 'team_leader'
            and me.team_id is not null
            and me.team_id = (select team_id from public.profiles where id = p_agent)
          )
        )
    )
$$;

revoke execute on function public.is_manager() from anon, public;
grant execute on function public.is_manager() to authenticated;

-- Managers run people and teams, but can never touch or create admins.
create policy "manager profiles" on public.profiles for update to authenticated
  using (public.my_role() = 'manager' and role <> 'admin')
  with check (public.my_role() = 'manager' and role <> 'admin');
create policy "manager teams" on public.teams for all to authenticated
  using (public.my_role() = 'manager') with check (public.my_role() = 'manager');

-- ───────── Work locations ─────────
create table public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 300 check (radius_m between 50 and 5000),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column location_id uuid references public.work_locations(id) on delete set null,
  add column allow_anywhere boolean not null default false;

create table public.geo_checkins (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid references public.work_locations(id) on delete set null,
  distance_m integer not null,
  accuracy_m integer,
  created_at timestamptz not null default now()
);
create index on public.geo_checkins (user_id, created_at desc);

create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Agents and team leaders with a location (and no "anywhere" pass) must check in on site.
create or replace function public.location_required(p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user and role in ('agent', 'team_leader') and location_id is not null and not allow_anywhere
  )
$$;

-- A check-in at the assigned location is valid for 4 hours.
create or replace function public.location_ok()
returns boolean
language sql stable security definer set search_path = public
as $$
  select not public.location_required()
    or exists (
      select 1
      from public.geo_checkins c
      join public.profiles p on p.id = c.user_id
      where c.user_id = auth.uid()
        and c.location_id = p.location_id
        and c.created_at > now() - interval '4 hours'
    )
$$;

create or replace function public.geo_check_in(p_lat double precision, p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_loc public.work_locations;
  v_dist double precision;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if not public.location_required() then
    return jsonb_build_object('ok', true, 'required', false);
  end if;

  select l.* into v_loc
  from public.profiles p join public.work_locations l on l.id = p.location_id
  where p.id = auth.uid();

  if p_accuracy is null or p_accuracy > 500 then
    return jsonb_build_object('ok', false, 'reason', 'accuracy', 'accuracy', round(coalesce(p_accuracy, -1)));
  end if;

  v_dist := public.distance_m(p_lat, p_lng, v_loc.lat, v_loc.lng);
  if v_dist > v_loc.radius_m + least(p_accuracy, 150) then
    return jsonb_build_object('ok', false, 'reason', 'far', 'distance', round(v_dist), 'location', v_loc.name, 'radius', v_loc.radius_m);
  end if;

  insert into public.geo_checkins (user_id, location_id, distance_m, accuracy_m)
  values (auth.uid(), v_loc.id, round(v_dist), round(p_accuracy));
  return jsonb_build_object('ok', true, 'required', true, 'location', v_loc.name, 'distance', round(v_dist));
end;
$$;

alter table public.work_locations enable row level security;
alter table public.geo_checkins enable row level security;

create policy "read locations" on public.work_locations for select to authenticated using (true);
create policy "manager locations" on public.work_locations for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "read checkins" on public.geo_checkins for select to authenticated using (public.can_see_agent(user_id));

-- Agents can only write leads while checked in at their location.
drop policy "insert leads" on public.leads;
create policy "insert leads" on public.leads for insert to authenticated
  with check (
    (public.is_staff() and (agent_id is null or public.can_see_agent(agent_id)))
    or (
      agent_id = auth.uid()
      and public.location_ok()
      and exists (select 1 from public.agent_companies ac where ac.agent_id = auth.uid() and ac.company_id = leads.company_id)
    )
  );

drop policy "update leads" on public.leads;
create policy "update leads" on public.leads for update to authenticated
  using (
    (public.is_staff() and (agent_id is null or public.can_see_agent(agent_id)))
    or (agent_id = auth.uid() and public.location_ok())
  )
  with check (
    (public.is_staff() and (agent_id is null or public.can_see_agent(agent_id)))
    or (agent_id = auth.uid() and public.location_ok())
  );

-- ───────── Breaks: 2 × 30 minutes per Cairo day, approved by a team leader / manager ─────────
create type public.break_status as enum ('pending', 'active', 'ended', 'rejected', 'cancelled');

create table public.agent_breaks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  status public.break_status not null default 'pending',
  day date not null default (now() at time zone 'Africa/Cairo')::date,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create index on public.agent_breaks (agent_id, day);
create index on public.agent_breaks (status) where status in ('pending', 'active');
create unique index agent_breaks_one_open on public.agent_breaks (agent_id) where status in ('pending', 'active');

create or replace function public.close_expired_breaks()
returns void
language sql volatile security definer set search_path = public
as $$
  update public.agent_breaks set status = 'ended', ended_at = ends_at
  where status = 'active' and ends_at <= now()
$$;

create or replace function public.request_break()
returns public.agent_breaks
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_me public.profiles;
  v_used integer;
  v_row public.agent_breaks;
begin
  select * into v_me from public.profiles where id = auth.uid() and is_active;
  if v_me.id is null or v_me.role <> 'agent' then
    raise exception 'BREAK_NOT_ALLOWED';
  end if;

  perform public.close_expired_breaks();
  if exists (select 1 from public.agent_breaks where agent_id = v_me.id and status in ('pending', 'active')) then
    raise exception 'BREAK_OPEN';
  end if;

  select count(*) into v_used from public.agent_breaks
  where agent_id = v_me.id and day = (now() at time zone 'Africa/Cairo')::date and status in ('pending', 'active', 'ended');
  if v_used >= 2 then
    raise exception 'BREAK_LIMIT';
  end if;

  insert into public.agent_breaks (agent_id) values (v_me.id) returning * into v_row;

  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'break', 'طلب بريك: ' || v_me.full_name, 'نص ساعة — مستني موافقتك', '/admin/breaks'
  from public.profiles p
  where p.is_active and p.id <> v_me.id
    and (p.role in ('admin', 'manager') or (p.role = 'team_leader' and p.team_id is not null and p.team_id = v_me.team_id));

  return v_row;
end;
$$;

create or replace function public.decide_break(p_id uuid, p_approve boolean)
returns public.agent_breaks
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.agent_breaks;
begin
  select * into v_row from public.agent_breaks where id = p_id for update;
  if v_row.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_staff() and public.can_see_agent(v_row.agent_id)) then
    raise exception 'FORBIDDEN';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'NOT_PENDING';
  end if;

  if p_approve then
    update public.agent_breaks
    set status = 'active', started_at = now(), ends_at = now() + interval '30 minutes', decided_by = auth.uid()
    where id = p_id returning * into v_row;
  else
    update public.agent_breaks set status = 'rejected', decided_by = auth.uid() where id = p_id returning * into v_row;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_row.agent_id, 'break',
    case when p_approve then 'البريك اتوافق عليه — معاك 30 دقيقة' else 'طلب البريك اترفض' end,
    case when p_approve then 'البريك هيخلص الساعة ' || to_char(v_row.ends_at at time zone 'Africa/Cairo', 'HH12:MI') end,
    '/agent'
  );
  return v_row;
end;
$$;

-- Agent ends their own break early or cancels a pending request; staff can end any break they manage.
create or replace function public.end_break(p_id uuid)
returns public.agent_breaks
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_row public.agent_breaks;
begin
  select * into v_row from public.agent_breaks where id = p_id for update;
  if v_row.id is null or not (v_row.agent_id = auth.uid() or (public.is_staff() and public.can_see_agent(v_row.agent_id))) then
    raise exception 'FORBIDDEN';
  end if;

  if v_row.status = 'pending' then
    update public.agent_breaks set status = 'cancelled' where id = p_id returning * into v_row;
  elsif v_row.status = 'active' then
    update public.agent_breaks set status = 'ended', ended_at = least(now(), ends_at) where id = p_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

alter table public.agent_breaks enable row level security;
create policy "read breaks" on public.agent_breaks for select to authenticated using (public.can_see_agent(agent_id));

grant select on public.work_locations, public.geo_checkins, public.agent_breaks to authenticated;
grant insert, update, delete on public.work_locations to authenticated;
grant all on public.work_locations, public.geo_checkins, public.agent_breaks to service_role;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function
  public.location_required(uuid), public.location_ok(), public.geo_check_in(double precision, double precision, double precision),
  public.close_expired_breaks(), public.request_break(), public.decide_break(uuid, boolean), public.end_break(uuid)
from anon, public;
grant execute on function
  public.location_required(uuid), public.location_ok(), public.geo_check_in(double precision, double precision, double precision),
  public.request_break(), public.decide_break(uuid, boolean), public.end_break(uuid)
to authenticated;

alter publication supabase_realtime add table public.agent_breaks;

-- ───────── Acquisition analytics (security invoker: RLS scopes it to what the caller manages) ─────────
create or replace function public.acquisition_analytics(p_from date, p_to date)
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

  with l as (
    select * from public.leads where created_at >= v_start and created_at < v_end
  ),
  hires as (
    select * from public.leads where hired_at >= v_start and hired_at < v_end
  ),
  touch as (
    select a.lead_id, min(a.created_at) as t
    from public.lead_activities a
    join l on l.id = a.lead_id
    where a.from_status is not null
    group by a.lead_id
  ),
  agents as (
    select id, full_name, team_id from public.profiles where role = 'agent' and is_active
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
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.acquisition_analytics(date, date) from anon, public;
grant execute on function public.acquisition_analytics(date, date) to authenticated;
