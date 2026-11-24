-- ═════ 1. After the hire: did the captain actually start and stay? ═════
-- hired → first order → still working after 7 days → after 30 days, or left (with a reason).
alter table public.leads add column if not exists first_order_at timestamptz;
alter table public.leads add column if not exists active7_at timestamptz;
alter table public.leads add column if not exists active30_at timestamptz;
alter table public.leads add column if not exists left_at timestamptz;
alter table public.leads add column if not exists left_reason text;
create index if not exists leads_hired_followup_idx on public.leads (hired_at) where status = 'hired';

-- The lead's agent or staff mark a step; each step is logged on the lead.
create or replace function public.set_hire_stage(p_lead uuid, p_stage text, p_reason text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  l public.leads;
  note text;
begin
  select * into l from public.leads where id = p_lead for update;
  if not found then return 'not_found'; end if;
  if not (l.agent_id = auth.uid() or public.is_staff()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if l.status <> 'hired' then return 'not_hired'; end if;

  if p_stage = 'first_order' then
    update public.leads set first_order_at = coalesce(first_order_at, now()), left_at = null, left_reason = null where id = p_lead;
    note := '🛵 نزل أول أوردر';
  elsif p_stage = 'active7' then
    update public.leads set first_order_at = coalesce(first_order_at, now()), active7_at = coalesce(active7_at, now()), left_at = null, left_reason = null where id = p_lead;
    note := '✅ كمّل 7 أيام';
  elsif p_stage = 'active30' then
    update public.leads set first_order_at = coalesce(first_order_at, now()), active7_at = coalesce(active7_at, now()), active30_at = coalesce(active30_at, now()), left_at = null, left_reason = null where id = p_lead;
    note := '🏆 كمّل 30 يوم';
  elsif p_stage = 'left' then
    update public.leads set left_at = now(), left_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '') where id = p_lead;
    note := '🚪 ساب الشغل' || coalesce(' — ' || nullif(left(trim(coalesce(p_reason, '')), 200), ''), '');
  elsif p_stage = 'undo' then
    update public.leads set first_order_at = null, active7_at = null, active30_at = null, left_at = null, left_reason = null where id = p_lead;
    note := '↩️ اتمسحت مراحل ما بعد التعيين';
  else
    return 'bad_stage';
  end if;
  insert into public.lead_activities (lead_id, actor_id, note) values (p_lead, auth.uid(), note);
  return 'ok';
end;
$$;
revoke execute on function public.set_hire_stage(uuid, text, text) from anon, public;
grant execute on function public.set_hire_stage(uuid, text, text) to authenticated;

-- Per company, for captains hired in the period: how many started and stayed. Row-level security applies.
create or replace function public.hire_retention(p_from date, p_to date)
returns table (company_id uuid, company text, hired bigint, first_order bigint, active7 bigint, active30 bigint, left_job bigint,
               due7 bigint, due30 bigint)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.name,
         count(*),
         count(*) filter (where l.first_order_at is not null),
         count(*) filter (where l.active7_at is not null),
         count(*) filter (where l.active30_at is not null),
         count(*) filter (where l.left_at is not null),
         -- Old enough to judge: hired 7 / 30+ days ago.
         count(*) filter (where l.hired_at < now() - interval '7 days'),
         count(*) filter (where l.hired_at < now() - interval '30 days')
    from public.leads l join public.companies c on c.id = l.company_id
   where l.status = 'hired'
     and (l.hired_at at time zone 'Africa/Cairo')::date between p_from and p_to
   group by c.id, c.name
   order by count(*) desc
$$;
revoke execute on function public.hire_retention(date, date) from anon, public;
grant execute on function public.hire_retention(date, date) to authenticated;

-- ═════ 2. Faster first call + after-hire follow-ups ═════
-- New leads nobody has called: 15 min → the agent; 30 min → the agent again and their team leader.
-- Agent away → team leader at 15 min. No agent for 30 min → managers and admins.
-- Hired captains: the agent is reminded to check the first order (day 3), 7 days and 30 days.
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
  if public.is_day_off(public.cairo_today()) then return 0; end if;

  for r in
    select l.id, l.full_name, l.agent_id, a.full_name agent_name, l.created_at,
           (a.is_active is not true or public.on_leave(a.id, public.cairo_today())) as away
    from public.leads l left join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.callback_at is null
      and l.created_at < now() - interval '15 minutes' and l.created_at > now() - interval '24 hours'
  loop
    if r.agent_id is null then
      if r.created_at < now() - interval '30 minutes' then
        if public.notify_once('slow:unassigned:' || r.id, array(select id from public.profiles where role in ('admin', 'manager') and is_active), 'info',
             '⚠️ ليد من غير أجنت من نص ساعة: ' || r.full_name, 'محدش اتعين عليه — وزّعه', '/admin/leads/' || r.id) then n := n + 1; end if;
      end if;
    elsif r.away then
      if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ليد مستني و' || r.agent_name || ' مش موجود: ' || r.full_name, 'الأجنت في إجازة أو موقوف — حوّله لحد تاني', '/admin/leads/' || r.id) then n := n + 1; end if;
    else
      if public.notify_once('slow:agent:' || r.id, array[r.agent_id], 'reminder',
           '⏳ ليد مستني من ربع ساعة: ' || r.full_name, 'كلّمه دلوقتي — أول ربع ساعة بتفرق', '/agent/leads/' || r.id) then n := n + 1; end if;
      if r.created_at < now() - interval '30 minutes' then
        if public.notify_once('slow:agent60:' || r.id, array[r.agent_id], 'reminder',
             '⚠️ ليد مستني من نص ساعة: ' || r.full_name, 'كلّمه دلوقتي — التيم ليدر بتاعك اتبلّغ', '/agent/leads/' || r.id) then n := n + 1; end if;
        if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
             '⚠️ ليد متأخر عند ' || r.agent_name || ': ' || r.full_name, 'محدش كلمه من نص ساعة', '/admin/leads/' || r.id) then n := n + 1; end if;
      end if;
    end if;
  end loop;

  -- After the hire (agent reminders, once each).
  for r in
    select l.id, l.full_name, l.agent_id, l.hired_at, l.first_order_at, l.active7_at, l.active30_at
    from public.leads l
    where l.status = 'hired' and l.left_at is null and l.agent_id is not null
      and l.hired_at > now() - interval '60 days'
  loop
    if r.first_order_at is null and r.hired_at < now() - interval '3 days' then
      if public.notify_once('hire:first:' || r.id, array[r.agent_id], 'reminder',
           '🛵 نزل أول أوردر؟ ' || r.full_name, 'اتعين من 3 أيام — اتأكد إنه نزل الشغل وعلّم المرحلة', '/agent/leads/' || r.id) then n := n + 1; end if;
    elsif r.first_order_at is not null and r.active7_at is null and r.first_order_at < now() - interval '7 days' then
      if public.notify_once('hire:7:' || r.id, array[r.agent_id], 'reminder',
           '✅ كمّل 7 أيام؟ ' || r.full_name, 'كلّمه واتأكد إنه لسه شغال', '/agent/leads/' || r.id) then n := n + 1; end if;
    elsif r.active7_at is not null and r.active30_at is null and r.first_order_at < now() - interval '30 days' then
      if public.notify_once('hire:30:' || r.id, array[r.agent_id], 'reminder',
           '🏆 كمّل 30 يوم؟ ' || r.full_name, 'كلّمه واتأكد إنه لسه شغال', '/agent/leads/' || r.id) then n := n + 1; end if;
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

-- ═════ 3. Screening answers from LineCRM custom fields go onto the lead ═════
create or replace function public.linecrm_create_lead(p_event text, p_company uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  e public.linecrm_events;
  d jsonb;
  full_name text;
  phone text;
  fields jsonb;
  extra jsonb;
  lead uuid;
  result text;
begin
  if not exists (select 1 from public.companies where id = p_company and is_active) then return 'no_company'; end if;
  select * into e from public.linecrm_events where id = p_event and status = 'queued' for update;
  if not found then return 'gone'; end if;

  d := coalesce(e.details->'data', e.details);
  full_name := left(trim(coalesce(d->>'name', '')), 120);
  phone := public.local_phone(d->>'phone');
  -- LineCRM custom fields (e.g. answers saved by its WhatsApp automation), minus its own ids.
  select coalesce(jsonb_object_agg(left(k, 60), left(v, 500)), '{}') into extra
    from jsonb_each_text(case when jsonb_typeof(d->'custom_fields') = 'object' then d->'custom_fields' else '{}' end) as x(k, v)
   where k not in ('channel_account_id') and coalesce(v, '') <> '';
  fields := extra || jsonb_strip_nulls(jsonb_build_object(
    'الإعلان', nullif(d->>'ad_name', ''),
    'الحملة', nullif(d->>'campaign_name', ''),
    'المدينة', nullif(d->>'city', ''),
    'المسؤول في LineCRM', nullif(d->>'owner_name', ''),
    'أول رسالة', nullif(left(regexp_replace(coalesce(d->>'notes', ''), '^whatsapp:\s*', ''), 500), '')));

  if full_name = '' or coalesce(phone, '') !~ '^01[0125]\d{8}$' then
    result := 'invalid';
  elsif public.lead_phone_taken(p_company, phone) then
    result := 'duplicate';
  else
    begin
      insert into public.leads (company_id, agent_id, full_name, phone, form_data, source, external_id, notes)
      values (p_company, public.pick_agent_for_company(p_company), full_name, phone, fields,
              case when d->>'source' in ('whatsapp', 'facebook') then d->>'source' else 'crm' end,
              'linecrm:' || coalesce(d->>'id', e.id),
              nullif(concat_ws(' · ', 'LineCRM', nullif(d->>'campaign_name', ''), nullif(d->>'ad_name', '')), 'LineCRM'))
      returning id into lead;
      result := 'created';
    exception
      when unique_violation then result := 'duplicate';
      when others then result := case when sqlerrm like '%BLACKLISTED%' then 'blacklisted' else 'error' end;
    end;
  end if;

  update public.linecrm_events set status = result, lead_id = lead where id = p_event;
  return result;
end;
$$;
revoke execute on function public.linecrm_create_lead(text, uuid) from anon, public, authenticated;
