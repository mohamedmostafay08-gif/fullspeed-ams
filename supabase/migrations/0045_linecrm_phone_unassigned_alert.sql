-- 1) LineCRM leads without a usable phone (WhatsApp hides some numbers, Messenger has none):
--    take the number from a LineCRM custom field («رقم الموبايل», filled by its screening automation),
--    and re-read such leads for a few days until the field is filled.
-- 2) Leads with no agent: one hourly alert with the count instead of one per lead.
alter table public.linecrm_events add column if not exists detail_checked_at timestamptz;

-- The lead's Egyptian mobile: the LineCRM phone, else a phone-like custom field; null when none is valid.
create or replace function public.linecrm_phone(d jsonb)
returns text
language sql immutable set search_path = public
as $$
  select p from (
    select public.local_phone(v) as p, o
      from (values (d->>'phone', 0),
                   (d->'custom_fields'->>'رقم الموبايل', 1),
                   (d->'custom_fields'->>'الموبايل', 2),
                   (d->'custom_fields'->>'رقم التليفون', 3),
                   (d->'custom_fields'->>'phone', 4)) as x(v, o)
  ) y
  where p ~ '^01[0125]\d{8}$'
  order by o limit 1
$$;

-- LineCRM leads worth reading again: no usable phone yet, under 3 days old, not checked in the last 10 minutes.
create or replace function public.linecrm_recheck_list(p_limit int default 5)
returns table (id text, lead_id text)
language sql stable security definer set search_path = public
as $$
  select e.id, coalesce(e.payload->'data'->>'id', e.details->'data'->>'id')
    from public.linecrm_events e
   where e.status = 'received' and e.type = 'lead.created' and e.verified
     and e.created_at > now() - interval '3 days'
     and coalesce(e.detail_checked_at, e.created_at) < now() - interval '10 minutes'
     and coalesce(e.payload->'data'->>'id', e.details->'data'->>'id') is not null
   order by e.detail_checked_at nulls first
   limit least(greatest(p_limit, 1), 20)
$$;
revoke execute on function public.linecrm_recheck_list(int) from anon, public, authenticated;
grant execute on function public.linecrm_recheck_list(int) to service_role;

create or replace function public.linecrm_store_details(p_event text, p_details jsonb, p_error text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  d jsonb := coalesce(p_details->'data', p_details);
  ok boolean := p_error is null and public.linecrm_phone(d) is not null;
  guess uuid;
  r text;
begin
  update public.linecrm_events
     set details = coalesce(p_details, details), detail_error = p_error, detail_checked_at = now(),
         status = case when ok and status = 'received' then 'queued' else status end
   where id = p_event;
  if not ok then return 'kept'; end if;

  if public.auto_assign_on() then
    guess := public.company_guess(concat_ws(' ', d->>'campaign_name', d->>'ad_name'));
    if guess is not null then
      r := public.linecrm_create_lead(p_event, guess);
      if r <> 'gone' then return 'auto:' || r; end if;
    end if;
  end if;

  perform public.notify_once('linecrm-queue:' || public.cairo_today(), array(select id from public.profiles where role in ('admin', 'manager') and is_active),
    'info', '📥 ليدز LineCRM مستنية توزيع', 'ليدز جديدة من إعلانات الواتساب — وزّعها على الشركات من «ليدز للتوزيع»', '/admin/facebook-leads');
  return 'queued';
end;
$$;
revoke execute on function public.linecrm_store_details(text, jsonb, text) from anon, public, authenticated;
grant execute on function public.linecrm_store_details(text, jsonb, text) to service_role;

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
  phone := public.linecrm_phone(d);
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
      null; -- counted below in one notification
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

  -- Leads with no agent for 30+ minutes: one notification per hour with the count, not one per lead.
  select count(*) into unassigned from public.leads l
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

