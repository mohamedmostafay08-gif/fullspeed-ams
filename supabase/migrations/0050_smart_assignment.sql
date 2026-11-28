-- 0050 · Smart assignment, follow-up timeout and speed to first contact (ideas taken from LineCRM's assignment rules).
-- Additive only. Paste into the Supabase SQL editor; the app code ships after it.
--
-- 1) Settings (one row): skip agents who aren't available, a default cap on open leads, and the follow-up timeout.
-- 2) Per agent: a "receives leads" switch and an optional own cap.
-- 3) On every lead: when it was handed to its agent, who had it before, how many times it was moved, and the first contact.
-- 4) lead_transfers: every hand-over (new, manual, auto, timeout).
-- 5) pick_agent_for_company: available agents first, under their cap first, then fewest leads today (old rule).
-- 6) reassign_overdue_leads (every 5 minutes): a new lead nobody touched within the timeout moves to an available colleague.
-- 7) assignment_overview: numbers for the «التوزيع والمهلة» page.

-- ───────── 1) Settings ─────────
create table if not exists public.assignment_settings (
  id integer primary key default 1 check (id = 1),
  skip_unavailable boolean not null default true,                                   -- break, leave, early-leave permit, not online
  online_minutes integer not null default 20 check (online_minutes between 0 and 600), -- 0 = don't require the app to be open
  max_open_default integer not null default 0 check (max_open_default between 0 and 10000), -- 0 = no cap
  reassign_minutes integer not null default 0 check (reassign_minutes between 0 and 1440),  -- 0 = timeout off
  max_reassigns integer not null default 1 check (max_reassigns between 1 and 5),
  updated_at timestamptz not null default now()
);
insert into public.assignment_settings (id) values (1) on conflict do nothing;
alter table public.assignment_settings enable row level security;
drop policy if exists "read assignment settings" on public.assignment_settings;
create policy "read assignment settings" on public.assignment_settings for select to authenticated using (true);
drop policy if exists "managers edit assignment settings" on public.assignment_settings;
create policy "managers edit assignment settings" on public.assignment_settings for update to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
grant select, update on public.assignment_settings to authenticated;

-- ───────── 2) Per agent ─────────
alter table public.profiles add column if not exists receives_leads boolean not null default true;
alter table public.profiles add column if not exists max_open_leads integer check (max_open_leads is null or max_open_leads between 0 and 10000);

-- ───────── 3) Per lead ─────────
alter table public.leads add column if not exists assigned_at timestamptz;
alter table public.leads add column if not exists prev_agent_id uuid references public.profiles(id) on delete set null;
alter table public.leads add column if not exists reassign_count integer not null default 0;
alter table public.leads add column if not exists first_contact_at timestamptz;
create index if not exists leads_overdue_idx on public.leads (assigned_at) where status = 'new' and first_contact_at is null;
create index if not exists leads_agent_status_idx on public.leads (agent_id, status);

-- ───────── 4) Hand-over log ─────────
create table if not exists public.lead_transfers (
  id bigserial primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_agent uuid references public.profiles(id) on delete set null,
  to_agent uuid references public.profiles(id) on delete set null,
  reason text not null default 'manual' check (reason in ('new', 'manual', 'auto', 'timeout')),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lead_transfers_created_idx on public.lead_transfers (created_at desc);
create index if not exists lead_transfers_lead_idx on public.lead_transfers (lead_id);
alter table public.lead_transfers enable row level security;
drop policy if exists "read lead transfers" on public.lead_transfers;
create policy "read lead transfers" on public.lead_transfers for select to authenticated
  using ((select public.sees_all()) or public.can_see_lead(lead_id));
grant select on public.lead_transfers to authenticated;

-- The new columns are bookkeeping: keep them out of the audit log (same list as 0021 plus the new ones).
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ignored text[] := array['updated_at', 'callback_reminded_at', 'interview_reminded_at', 'last_contact_at', 'attempts',
                          'assigned_at', 'prev_agent_id', 'reassign_count', 'first_contact_at'];
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  nw jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  j jsonb := coalesce(nw, o);
  diff jsonb;
  k text;
  actor uuid;
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

  actor := public.audit_actor(tg_table_name, tg_op, j);
  insert into public.audit_log (actor_id, actor_name, table_name, row_id, action, changes)
  values (actor, (select full_name from public.profiles where id = actor), tg_table_name,
          coalesce(j ->> 'id', concat_ws(':', j ->> 'agent_id', j ->> 'company_id')),
          lower(tg_op), diff);
  return coalesce(new, old);
end;
$$;

-- Server and scheduler work (no signed-in user) may move leads; agents still can't (same rules as 0027 otherwise).
create or replace function public.guard_lead_update()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  if new.status = 'hired' and old.status is distinct from 'hired' then
    new.hired_at := now();
  elsif new.status = 'hired' then
    new.hired_at := old.hired_at;
  else
    new.hired_at := null;
  end if;

  if auth.uid() is not null and not public.is_staff() then
    if new.agent_id is distinct from old.agent_id
       or new.company_id is distinct from old.company_id
       or new.source is distinct from old.source
       or new.external_id is distinct from old.external_id then
      raise exception 'Agents cannot reassign leads';
    end if;
  end if;
  return new;
end;
$$;

-- Backfill once (bookkeeping columns only; skipped by the audit log above).
update public.leads set assigned_at = created_at where agent_id is not null and assigned_at is null;
update public.leads l set first_contact_at = coalesce(
    (select min(c.started_at) from public.call_logs c where c.lead_id = l.id),
    (select min(a.created_at) from public.lead_activities a where a.lead_id = l.id and a.actor_id is not null and a.created_at > l.created_at),
    l.last_contact_at)
  where l.first_contact_at is null and (l.status <> 'new' or l.attempts > 0 or l.last_contact_at is not null);

-- Stamps the hand-over time, the previous agent and the first contact.
create or replace function public.leads_track_assignment()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.agent_id is not null then new.assigned_at := coalesce(new.assigned_at, now()); end if;
    if new.status <> 'new' or new.last_contact_at is not null then
      new.first_contact_at := coalesce(new.first_contact_at, new.last_contact_at, now());
    end if;
    return new;
  end if;

  if new.agent_id is distinct from old.agent_id then
    new.assigned_at := case when new.agent_id is null then null else now() end;
    if old.agent_id is not null then new.prev_agent_id := old.agent_id; end if;
  else
    new.assigned_at := old.assigned_at;
    new.prev_agent_id := old.prev_agent_id;
  end if;

  if old.first_contact_at is not null then
    new.first_contact_at := old.first_contact_at;
  elsif (new.last_contact_at is not null and new.last_contact_at is distinct from old.last_contact_at)
     or (old.status = 'new' and new.status <> 'new') then
    new.first_contact_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.leads_track_assignment() from anon, authenticated, public;
drop trigger if exists leads_track_assignment on public.leads;
create trigger leads_track_assignment before insert or update on public.leads
  for each row execute function public.leads_track_assignment();

create or replace function public.leads_log_transfer()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  why text := nullif(current_setting('app.transfer_reason', true), '');
begin
  if tg_op = 'INSERT' then
    if new.agent_id is null then return null; end if;
    insert into public.lead_transfers (lead_id, from_agent, to_agent, reason, actor_id)
    values (new.id, null, new.agent_id, coalesce(why, 'new'), auth.uid());
  elsif new.agent_id is distinct from old.agent_id and new.agent_id is not null then
    insert into public.lead_transfers (lead_id, from_agent, to_agent, reason, actor_id)
    values (new.id, old.agent_id, new.agent_id, coalesce(why, case when auth.uid() is null then 'auto' else 'manual' end), auth.uid());
  end if;
  return null;
end;
$$;
revoke execute on function public.leads_log_transfer() from anon, authenticated, public;
drop trigger if exists leads_log_transfer on public.leads;
create trigger leads_log_transfer after insert or update of agent_id on public.leads
  for each row execute function public.leads_log_transfer();

-- ───────── 5) Who gets the next lead ─────────
-- Available = active, not on leave, not on a break, not past an approved early-leave time, and (if required) had the app open lately.
create or replace function public.agent_available_now(p_agent uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with s as (select online_minutes from public.assignment_settings where id = 1)
  select exists (select 1 from public.profiles p where p.id = p_agent and p.is_active)
    and not public.on_leave(p_agent, public.cairo_today())
    and not exists (select 1 from public.agent_breaks b
                    where b.agent_id = p_agent and b.status = 'active' and coalesce(b.ends_at, now() + interval '1 minute') > now())
    and not exists (select 1 from public.hour_permits h
                    where h.user_id = p_agent and h.day = public.cairo_today() and h.status = 'approved' and h.kind = 'early_leave'
                      and h.at_time <= (now() at time zone 'Africa/Cairo')::time)
    and (coalesce((select online_minutes from s), 20) = 0
         or exists (select 1 from public.attendance a
                    where a.user_id = p_agent and a.day = public.cairo_today()
                      and a.last_seen > now() - make_interval(mins => coalesce((select online_minutes from s), 20))))
$$;
revoke execute on function public.agent_available_now(uuid) from anon, public;
grant execute on function public.agent_available_now(uuid) to authenticated;

-- Agents linked to the company who receive leads, best first:
-- available → under their cap → not on leave → fewest leads today → random. Never empty-handed while someone receives.
create or replace function public.pick_agent_for_company_except(p_company uuid, p_except uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  with s as (select skip_unavailable, max_open_default from public.assignment_settings where id = 1),
  cand as (
    select p.id,
      coalesce(nullif(p.max_open_leads, 0), nullif((select max_open_default from s), 0)) as cap,
      (select count(*) from public.leads l where l.agent_id = p.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents')) as open_n,
      (select count(*) from public.leads l where l.agent_id = p.id and l.created_at >= public.cairo_day_start(public.cairo_today())) as today_n,
      public.agent_available_now(p.id) as avail,
      public.on_leave(p.id, public.cairo_today()) as away
    from public.agent_companies ac
    join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
    where ac.company_id = p_company and ac.agent_id is distinct from p_except
  )
  select id from cand
  order by
    case when coalesce((select skip_unavailable from s), true) and not avail then 1 else 0 end,
    case when cap is not null and open_n >= cap then 1 else 0 end,
    case when away then 1 else 0 end,
    today_n, random()
  limit 1
$$;
revoke execute on function public.pick_agent_for_company_except(uuid, uuid) from anon, authenticated, public;
grant execute on function public.pick_agent_for_company_except(uuid, uuid) to service_role;

-- Same name and signature as before, so every caller (imports, Meta, LineCRM, CRM API) gets the new rule.
create or replace function public.pick_agent_for_company(p_company uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select public.pick_agent_for_company_except(p_company, null) $$;
revoke execute on function public.pick_agent_for_company(uuid) from anon, authenticated, public;
grant execute on function public.pick_agent_for_company(uuid) to service_role;

-- A manager (or the agent's team leader) turns receiving on/off and sets the agent's own cap (null = company default).
create or replace function public.set_agent_receiving(p_agent uuid, p_on boolean, p_max integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_manager() or (public.my_role() = 'team_leader' and p_agent = any (public.my_team_member_ids()))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_max is not null and (p_max < 0 or p_max > 10000) then raise exception 'BAD_MAX'; end if;
  update public.profiles set receives_leads = coalesce(p_on, true), max_open_leads = nullif(p_max, 0)
  where id = p_agent and role = 'agent';
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;
revoke execute on function public.set_agent_receiving(uuid, boolean, integer) from anon, public;
grant execute on function public.set_agent_receiving(uuid, boolean, integer) to authenticated;

-- ───────── 6) Follow-up timeout ─────────
-- A new lead nobody called within the timeout (counted from the hand-over, or from 9 AM for night leads)
-- moves to an available colleague on the same company. Working hours only, at most max_reassigns times.
create or replace function public.reassign_overdue_leads()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  s public.assignment_settings;
  hr integer := extract(hour from now() at time zone 'Africa/Cairo');
  day_start timestamptz := public.cairo_day_start(public.cairo_today()) + interval '9 hours';
  r record;
  target uuid;
  n integer := 0;
begin
  select * into s from public.assignment_settings where id = 1;
  if s.reassign_minutes is null or s.reassign_minutes = 0 then return 0; end if;
  if hr < 9 or hr >= 22 or public.is_day_off(public.cairo_today()) then return 0; end if;

  for r in
    select l.id, l.full_name, l.agent_id, l.company_id, l.reassign_count, a.full_name as agent_name
    from public.leads l join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.first_contact_at is null and l.callback_at is null
      and l.reassign_count < s.max_reassigns
      and l.assigned_at > now() - interval '48 hours'
      and greatest(l.assigned_at, day_start) < now() - make_interval(mins => s.reassign_minutes)
    order by l.assigned_at
    limit 200
  loop
    target := public.pick_agent_for_company_except(r.company_id, r.agent_id);
    continue when target is null or not public.agent_available_now(target);

    perform set_config('app.transfer_reason', 'timeout', true);
    update public.leads set agent_id = target, reassign_count = reassign_count + 1 where id = r.id;
    perform set_config('app.transfer_reason', '', true);
    n := n + 1;

    perform public.notify_once('reassign:' || r.id || ':' || r.reassign_count, array[r.agent_id], 'info',
      '↪️ ليد اتحوّل لزميلك: ' || r.full_name, 'محدش كلّمه في ' || s.reassign_minutes || ' دقيقة', '/agent/leads');
    perform public.notify_once('reassign:tl:' || r.id || ':' || r.reassign_count, array(select public.supervisors_of(r.agent_id)), 'info',
      '↪️ ليد اتحوّل من ' || r.agent_name || ': ' || r.full_name, 'محدش كلّمه في ' || s.reassign_minutes || ' دقيقة', '/admin/leads/' || r.id);
  end loop;
  return n;
end;
$$;
revoke execute on function public.reassign_overdue_leads() from anon, authenticated, public;

do $$
begin
  perform cron.unschedule('reassign-overdue-leads');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('reassign-overdue-leads', '*/5 * * * *', 'select public.reassign_overdue_leads()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ───────── 7) Numbers for the page ─────────
-- Managers and the performance role see everyone; a team leader sees their team. Lead names are left out for performance.
create or replace function public.assignment_overview(p_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  role text := public.my_role();
  team uuid[];
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
  s public.assignment_settings;
  res jsonb;
begin
  if role is null or role not in ('admin', 'manager', 'team_leader', 'performance') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if role = 'team_leader' then team := public.my_team_member_ids(); end if;
  select * into s from public.assignment_settings where id = 1;

  with ag as (
    select p.id, p.full_name, p.team_id, p.receives_leads, p.max_open_leads
    from public.profiles p
    where p.role = 'agent' and p.is_active and (team is null or p.id = any (team))
  ),
  lp as (  -- leads handed out in the period, by their current agent
    select l.agent_id, l.created_at, l.first_contact_at
    from public.leads l
    where l.created_at >= since and l.agent_id in (select id from ag)
  ),
  tr as (
    select t.* from public.lead_transfers t
    where t.created_at >= since
      and (team is null or t.from_agent = any (team) or t.to_agent = any (team))
  ),
  per as (
    select ag.id, ag.full_name, ag.team_id, ag.receives_leads, ag.max_open_leads,
      (select count(*) from public.leads l where l.agent_id = ag.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents')) as open_n,
      (select count(*) from lp where lp.agent_id = ag.id) as received,
      (select count(*) from lp where lp.agent_id = ag.id and lp.first_contact_at is not null) as contacted,
      (select round(percentile_cont(0.5) within group (order by extract(epoch from lp.first_contact_at - lp.created_at) / 60)::numeric)
         from lp where lp.agent_id = ag.id and lp.first_contact_at is not null) as median_first_min,
      (select count(*) from tr where tr.from_agent = ag.id and tr.reason = 'timeout') as moved_away,
      case
        when public.on_leave(ag.id, public.cairo_today()) then 'leave'
        when exists (select 1 from public.agent_breaks b where b.agent_id = ag.id and b.status = 'active' and coalesce(b.ends_at, now() + interval '1 minute') > now()) then 'break'
        when public.agent_available_now(ag.id) then 'available'
        else 'offline'
      end as state,
      (select a.last_seen from public.attendance a where a.user_id = ag.id and a.day = public.cairo_today()) as last_seen,
      (select t.name from public.teams t where t.id = ag.team_id) as team_name
    from ag
  )
  select jsonb_build_object(
    'settings', to_jsonb(s) - 'id',
    'kpi', jsonb_build_object(
      'handed', (select count(*) from lp),
      'contacted', (select count(*) from lp where first_contact_at is not null),
      'within15', (select count(*) from lp where first_contact_at is not null and first_contact_at <= created_at + interval '15 minutes'),
      'median_first_min', (select round(percentile_cont(0.5) within group (order by extract(epoch from first_contact_at - created_at) / 60)::numeric) from lp where first_contact_at is not null),
      'timeout_moves', (select count(*) from tr where reason = 'timeout'),
      'manual_moves', (select count(*) from tr where reason = 'manual'),
      'overdue_now', (select count(*) from public.leads l
                       where l.status = 'new' and l.attempts = 0 and l.first_contact_at is null and l.agent_id in (select id from ag)
                         and l.assigned_at > now() - interval '48 hours'
                         and l.assigned_at < now() - make_interval(mins => case when s.reassign_minutes > 0 then s.reassign_minutes else 30 end)),
      'unassigned_now', case when team is null then (select count(*) from public.leads l where l.agent_id is null and l.status = 'new' and l.created_at > now() - interval '48 hours') end
    ),
    'agents', coalesce((select jsonb_agg(to_jsonb(per) order by per.state <> 'available', per.full_name) from per), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select tr.lead_id, tr.reason, tr.created_at,
          case when role = 'performance' then null else l.full_name end as lead_name,
          (select full_name from public.profiles where id = tr.from_agent) as from_name,
          (select full_name from public.profiles where id = tr.to_agent) as to_name
        from tr join public.leads l on l.id = tr.lead_id
        where tr.reason in ('manual', 'timeout', 'auto')
        order by tr.created_at desc
        limit 30
      ) x), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;
revoke execute on function public.assignment_overview(integer) from anon, public;
grant execute on function public.assignment_overview(integer) to authenticated;
