-- Smarter "lead waiting" reminders. Additive only (create or replace), safe to paste as is.
-- The scheduler already runs this every 5 minutes (fire-delay-alerts), 09:00–22:00 Cairo time.

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

  -- New leads nobody has called yet:
  --   30 min → the agent;  60 min → the agent again and their team leader.
  --   Agent on leave or suspended → the team leader straight away at 30 min (nobody else will call).
  --   No agent at all for an hour → managers and admins.
  -- Not on official holidays or weekly days off.
  if public.is_day_off(public.cairo_today()) then return 0; end if;
  for r in
    select l.id, l.full_name, l.agent_id, a.full_name agent_name, l.created_at,
           (a.is_active is not true or public.on_leave(a.id, public.cairo_today())) as away
    from public.leads l left join public.profiles a on a.id = l.agent_id
    where l.status = 'new' and l.attempts = 0 and l.callback_at is null
      and l.created_at < now() - interval '30 minutes' and l.created_at > now() - interval '24 hours'
  loop
    if r.agent_id is null then
      if r.created_at < now() - interval '60 minutes' then
        if public.notify_once('slow:unassigned:' || r.id, array(select id from public.profiles where role in ('admin', 'manager') and is_active), 'info',
             '⚠️ ليد من غير أجنت من ساعة: ' || r.full_name, 'محدش اتعين عليه — وزّعه', '/admin/leads/' || r.id) then n := n + 1; end if;
      end if;
    elsif r.away then
      if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
           '⚠️ ليد مستني و' || r.agent_name || ' مش موجود: ' || r.full_name, 'الأجنت في إجازة أو موقوف — حوّله لحد تاني', '/admin/leads/' || r.id) then n := n + 1; end if;
    else
      if public.notify_once('slow:agent:' || r.id, array[r.agent_id], 'reminder',
           '⏳ ليد مستني من نص ساعة: ' || r.full_name, null, '/agent/leads/' || r.id) then n := n + 1; end if;
      if r.created_at < now() - interval '60 minutes' then
        if public.notify_once('slow:agent60:' || r.id, array[r.agent_id], 'reminder',
             '⚠️ ليد مستني من ساعة: ' || r.full_name, 'كلّمه دلوقتي — التيم ليدر بتاعك اتبلّغ', '/agent/leads/' || r.id) then n := n + 1; end if;
        if public.notify_once('slow:tl:' || r.id, array(select public.supervisors_of(r.agent_id)), 'info',
             '⚠️ ليد متأخر عند ' || r.agent_name || ': ' || r.full_name, 'محدش كلمه من ساعة', '/admin/leads/' || r.id) then n := n + 1; end if;
      end if;
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

