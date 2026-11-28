-- 0055 · Fixes from the 28/11 audit. Additive: functions are replaced with the same signatures, nothing is dropped
-- except one policy that is recreated identically (faster form). Paste into the Supabase SQL editor; no app deploy needed.
--
--   1) A default cap of open leads per agent (150) when none is set, so one agent can't end up with every lead.
--   2) distribute_unassigned() respects each agent's cap and hands the newest leads out first.
--   3) rebalance_open_leads(): untouched leads above an agent's cap go back to the pool, then get handed out again.
--   4) fire_delay_alerts(): "lead waiting" counts from when the lead was assigned (not when it arrived), and an agent
--      with more than 5 waiting leads gets one summary per hour instead of a notification per lead.
--   5) Security: meta_import_lead() is no longer callable by signed-in users (only the Meta webhook uses it);
--      agent_stats() only answers for agents you may see; a few helper functions closed to anon/users.
--   6) LineCRM: once the monthly quota is spent, the 15-minute pull stays quiet until the 1st of next month.
--   7) Housekeeping from Supabase Advisors: fixed search_path on 3 functions, 9 foreign-key indexes, one faster policy.

-- 1) Default cap ---------------------------------------------------------------------------------------------------
update public.assignment_settings set max_open_default = 150 where id = 1 and coalesce(max_open_default, 0) = 0;

-- 2) distribute_unassigned: same signature as 0054, now capacity-aware -------------------------------------------
create or replace function public.distribute_unassigned(p_company uuid default null, p_limit integer default 5000)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  c record;
  step integer;
  moved integer := 0;
  def_cap integer := nullif((select max_open_default from public.assignment_settings where id = 1), 0);
begin
  -- Managers and admins in the app; the SQL editor and pg_cron (no signed-in user) may run it too.
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('app.bulk_assign', 'on', true);
  for c in
    select id from public.companies where is_active and (p_company is null or id = p_company)
  loop
    exit when moved >= p_limit;
    with ag as (
      -- Linked agents who receive leads, with their open load and cap (no cap = up to the remaining limit).
      select p.id,
        (select count(*) from public.leads l where l.agent_id = p.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents')) as open_n,
        coalesce(nullif(p.max_open_leads, 0), def_cap) as cap
      from public.agent_companies ac
      join public.profiles p on p.id = ac.agent_id and p.is_active and p.role = 'agent' and p.receives_leads
      where ac.company_id = c.id
    ),
    slots as (
      -- One row per free seat; ordering by (load + seat number) fills the lightest agent first and keeps it even.
      select ag.id, row_number() over (order by ag.open_n + k, random()) as rn
      from ag, generate_series(1, greatest(least(coalesce(ag.cap - ag.open_n, p_limit - moved), p_limit - moved), 0)) as k
    ),
    todo as (
      select l.id, row_number() over (order by l.created_at desc) as rn
      from public.leads l
      where l.company_id = c.id and l.agent_id is null and l.status not in ('hired', 'rejected')
      order by l.created_at desc
      limit greatest(p_limit - moved, 0)
    ),
    upd as (
      update public.leads l set agent_id = s.id
      from todo t join slots s on s.rn = t.rn
      where l.id = t.id
      returning l.agent_id, l.company_id
    ),
    note as (
      insert into public.notifications (user_id, company_id, type, title, body, link)
      select u.agent_id, u.company_id, 'lead'::public.notification_type, 'اتوزّع عليك ' || count(*) || ' ليد جديد', null, '/agent/leads'
      from upd u group by u.agent_id, u.company_id
      returning 1
    )
    select count(*) into step from upd;
    moved := moved + step;
  end loop;
  perform set_config('app.bulk_assign', '', true);
  return moved;
end;
$$;
revoke execute on function public.distribute_unassigned(uuid, integer) from anon, public;
grant execute on function public.distribute_unassigned(uuid, integer) to authenticated;

-- 3) rebalance_open_leads --------------------------------------------------------------------------------------------
-- Untouched leads (new, no attempt, no first contact, no callback) above an agent's cap go back to the pool, oldest
-- first (the agent keeps the freshest). Leads someone already worked on never move. Then distribute_unassigned runs.
-- p_company limits it to one company's leads; p_cap overrides every agent's cap for this run only.
create or replace function public.rebalance_open_leads(p_company uuid default null, p_cap integer default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  def_cap integer := nullif((select max_open_default from public.assignment_settings where id = 1), 0);
  returned integer := 0;
  distributed integer := 0;
begin
  -- Managers and admins in the app; the SQL editor and pg_cron (no signed-in user) may run it too.
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_cap is not null and (p_cap < 1 or p_cap > 10000) then
    raise exception 'BAD_CAP' using errcode = '22023';
  end if;
  perform set_config('app.bulk_assign', 'on', true);
  with ag as (
    select p.id,
      coalesce(p_cap, nullif(p.max_open_leads, 0), def_cap) as cap,
      (select count(*) from public.leads l where l.agent_id = p.id and l.status in ('new', 'no_answer', 'contacted', 'interview', 'documents')) as open_n
    from public.profiles p
    where p.role = 'agent'
  ),
  untouched as (
    select l.id, l.agent_id, row_number() over (partition by l.agent_id order by l.created_at) as rn
    from public.leads l
    where l.agent_id is not null and l.status = 'new' and l.attempts = 0
      and l.first_contact_at is null and l.callback_at is null
      and (p_company is null or l.company_id = p_company)
  ),
  back as (
    update public.leads l set agent_id = null
    from untouched u join ag on ag.id = u.agent_id
    where l.id = u.id and ag.cap is not null and u.rn <= ag.open_n - ag.cap
    returning l.id
  )
  select count(*) into returned from back;
  perform set_config('app.bulk_assign', '', true);
  distributed := public.distribute_unassigned(p_company, 10000);
  return jsonb_build_object('returned', returned, 'distributed', distributed);
end;
$$;
revoke execute on function public.rebalance_open_leads(uuid, integer) from anon, public;
grant execute on function public.rebalance_open_leads(uuid, integer) to authenticated;

-- 4) fire_delay_alerts: from assignment time, summarised for busy agents ------------------------------------------
-- Only the first block (waiting leads) changed; the unassigned count, after-hire, idle and break blocks are as before.
create or replace function public.fire_delay_alerts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer := 0;
  hr integer := extract(hour from now() at time zone 'Africa/Cairo');
  day text := public.cairo_today()::text;
  r record;
  unassigned integer;
  busy uuid[] := '{}';
begin
  if hr < 9 or hr >= 22 then return 0; end if;
  if public.is_day_off(public.cairo_today()) then return 0; end if;

  -- Agents with more than 5 waiting leads: one summary per hour (to them, and to their supervisors), no per-lead alerts.
  for r in
    select l.agent_id, a.full_name as agent_name,
      (a.is_active is not true or public.on_leave(a.id, public.cairo_today())) as away,
      count(*) as waiting,
      count(*) filter (where coalesce(l.assigned_at, l.created_at) < now() - interval '30 minutes') as late
    from public.leads l join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.callback_at is null
      and coalesce(l.assigned_at, l.created_at) < now() - interval '15 minutes'
      and coalesce(l.assigned_at, l.created_at) > now() - interval '24 hours'
    group by l.agent_id, a.full_name, a.is_active, a.id
    having count(*) > 5
  loop
    busy := busy || r.agent_id;
    if r.away then
      if public.notify_once('slow:sum:away:' || r.agent_id || ':' || day || ':' || hr, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ' || r.waiting || ' ليد مستنيين و' || r.agent_name || ' مش موجود', 'الأجنت في إجازة أو موقوف — وزّعهم على حد تاني', '/admin/leads') then n := n + 1; end if;
    else
      if public.notify_once('slow:sum:agent:' || r.agent_id || ':' || day || ':' || hr, array[r.agent_id], 'reminder',
           '⏳ عندك ' || r.waiting || ' ليد مستنيين مكالمة', 'ابدأ بالأحدث — أول ربع ساعة بتفرق', '/agent/leads') then n := n + 1; end if;
      if r.late > 0 and public.notify_once('slow:sum:tl:' || r.agent_id || ':' || day || ':' || hr, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ' || r.late || ' ليد متأخر عند ' || r.agent_name, 'محدش كلمهم من نص ساعة أو أكتر', '/admin/leads') then n := n + 1; end if;
    end if;
  end loop;

  for r in
    select l.id, l.full_name, l.agent_id, a.full_name agent_name, coalesce(l.assigned_at, l.created_at) as since,
      (a.is_active is not true or public.on_leave(a.id, public.cairo_today())) as away
    from public.leads l
    left join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.callback_at is null
      and l.agent_id is not null and not (l.agent_id = any (busy))
      and coalesce(l.assigned_at, l.created_at) < now() - interval '15 minutes'
      and coalesce(l.assigned_at, l.created_at) > now() - interval '24 hours'
  loop
    if r.away then
      if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ليد مستني و' || r.agent_name || ' مش موجود: ' || r.full_name, 'الأجنت في إجازة أو موقوف — حوّله لحد تاني', '/admin/leads/' || r.id) then n := n + 1; end if;
    else
      if public.notify_once('slow:agent:' || r.id, array[r.agent_id], 'reminder',
           '⏳ ليد مستني من ربع ساعة: ' || r.full_name, 'كلّمه دلوقتي — أول ربع ساعة بتفرق', '/agent/leads/' || r.id) then n := n + 1; end if;
      if r.since < now() - interval '30 minutes' then
        if public.notify_once('slow:agent60:' || r.id, array[r.agent_id], 'reminder',
             '⚠️ ليد مستني من نص ساعة: ' || r.full_name, 'كلّمه دلوقتي — التيم ليدر بتاعك اتبلّغ', '/agent/leads/' || r.id) then n := n + 1; end if;
        if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
             '⚠️ ليد متأخر عند ' || r.agent_name || ': ' || r.full_name, 'محدش كلمه من نص ساعة', '/admin/leads/' || r.id) then n := n + 1; end if;
      end if;
    end if;
  end loop;

  -- Leads with no agent for 30+ minutes: one notification per hour with the count, not one per lead.
  select count(*) into unassigned
  from public.leads l
  where l.status = 'new' and l.attempts = 0 and l.agent_id is null
    and l.created_at < now() - interval '30 minutes' and l.created_at > now() - interval '24 hours';
  if unassigned > 0 then
    if public.notify_once('slow:unassigned:' || day || ':' || hr, array(select id from public.profiles where role in ('admin', 'manager') and is_active), 'info',
         '⚠️ ليدز من غير أجنت: ' || unassigned, 'ليدز جديدة محدش اتعين عليها من نص ساعة — وزّعها أو اربط أجنتس بالشركات', '/admin/leads') then n := n + 1; end if;
  end if;

  -- After the hire (agent reminders, once each).
  for r in
    select l.id, l.full_name, l.agent_id, l.hired_at, l.first_order_at, l.active7_at, l.active30_at
    from public.leads l
    where l.status = 'hired' and l.left_at is null and l.agent_id is not null and l.hired_at > now() - interval '60 days'
  loop
    if r.first_order_at is null and r.hired_at < now() - interval '3 days' then
      if public.notify_once('hire:first:' || r.id, array[r.agent_id], 'reminder', '🛵 نزل أول أوردر؟ ' || r.full_name, 'اتعين من 3 أيام — اتأكد إنه نزل الشغل وعلّم المرحلة', '/agent/leads/' || r.id) then n := n + 1; end if;
    elsif r.first_order_at is not null and r.active7_at is null and r.first_order_at < now() - interval '7 days' then
      if public.notify_once('hire:7:' || r.id, array[r.agent_id], 'reminder', '✅ كمّل 7 أيام؟ ' || r.full_name, 'كلّمه واتأكد إنه لسه شغال', '/agent/leads/' || r.id) then n := n + 1; end if;
    elsif r.active7_at is not null and r.active30_at is null and r.first_order_at < now() - interval '30 days' then
      if public.notify_once('hire:30:' || r.id, array[r.agent_id], 'reminder', '🏆 كمّل 30 يوم؟ ' || r.full_name, 'كلّمه واتأكد إنه لسه شغال', '/agent/leads/' || r.id) then n := n + 1; end if;
    end if;
  end loop;

  -- Agents who started the day but went quiet for an hour (not on a break). Once per agent per hour.
  for r in
    select p.id, p.full_name, t.last_at
    from public.profiles p join public.activity_today_all() t on t.agent_id = p.id
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
revoke execute on function public.fire_delay_alerts() from anon, public, authenticated;

-- 5) Security ------------------------------------------------------------------------------------------------------
-- Only /api/meta/webhook calls this, with the server key. Signed-in users could call it to create leads.
revoke execute on function public.meta_import_lead(text, text, text, jsonb) from anon, public, authenticated;
grant execute on function public.meta_import_lead(text, text, text, jsonb) to service_role;

-- agent_stats: same numbers, but only for an agent the caller may see (themselves, their team, or staff above).
create or replace function public.agent_stats(p_agent uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.can_see_agent(p_agent) then jsonb_build_object(
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
  ) end
$$;

-- Run by pg_cron (as postgres) or by triggers only.
revoke execute on function public.fire_due_reminders() from anon, public, authenticated;
revoke execute on function public.meta_event_fill_campaign() from anon, public, authenticated;
revoke execute on function public.workdays_between(date, date) from anon, public;
grant execute on function public.workdays_between(date, date) to authenticated;

-- 6) LineCRM: stop the pull for the rest of the month once the quota is spent ---------------------------------------
-- The pull writes its last log to linecrm_pull_last; a "quota_exceeded" logged this month (Cairo) means wait for the 1st.
create or replace function public.linecrm_pull_tick()
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  until timestamptz := nullif((select value from private.app_config where key = 'linecrm_backoff_until'), '')::timestamptz;
  last text := (select value from private.app_config where key = 'linecrm_pull_last');
  last_at timestamptz;
begin
  if coalesce((select value from private.app_config where key = 'linecrm_api_key'), '') = '' then return; end if;
  if until is not null and until > now() then return; end if;
  if last like '%quota_exceeded%' then
    begin
      last_at := substring(last from '"at":"([^"]+)"')::timestamptz;
    exception when others then
      last_at := null;
    end;
    if last_at is not null
       and date_trunc('month', last_at at time zone 'Africa/Cairo') = date_trunc('month', now() at time zone 'Africa/Cairo') then
      return;
    end if;
  end if;
  perform public.call_app('/api/linecrm/pull', '{}'::jsonb);
end;
$$;
revoke execute on function public.linecrm_pull_tick() from anon, public, authenticated;

-- 7) Advisors housekeeping -----------------------------------------------------------------------------------------
alter function public.lead_rule_fields() set search_path = public;
alter function public.campaign_from_note(text) set search_path = public;
alter function public.vehicle_from_stage(text) set search_path = public;

create index if not exists lead_transfers_actor_id_idx on public.lead_transfers (actor_id);
create index if not exists lead_transfers_from_agent_idx on public.lead_transfers (from_agent);
create index if not exists lead_transfers_to_agent_idx on public.lead_transfers (to_agent);
create index if not exists leads_prev_agent_id_idx on public.leads (prev_agent_id);
create index if not exists meta_lead_events_lead_id_idx on public.meta_lead_events (lead_id);
create index if not exists meta_lead_forms_company_id_idx on public.meta_lead_forms (company_id);
create index if not exists team_companies_assigned_by_idx on public.team_companies (assigned_by);
create index if not exists wa_messages_sent_by_idx on public.wa_messages (sent_by);
create index if not exists wa_threads_lead_id_idx on public.wa_threads (lead_id);

-- Same rule, with auth.uid() evaluated once per query instead of once per row.
drop policy if exists "admins see linecrm events" on public.linecrm_events;
create policy "admins see linecrm events" on public.linecrm_events for select to authenticated
  using (exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin' and profiles.is_active));

-- After pasting, once the other agents are added and linked to companies, spread the leads with:
--   select public.rebalance_open_leads();          -- uses each agent's cap (default 150)
--   select public.rebalance_open_leads(null, 100); -- or a one-off cap for this run
