-- Call scripts & call timing, month forecast, weekly/monthly report notices,
-- daily backups and WhatsApp auto-welcome (both driven from the app via pg_net).

-- ───────── Call script per company ─────────
alter table public.companies add column call_script text;

-- ───────── Call log (duration measured from tapping "call" until the agent is back in the app) ─────────
create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  duration_s integer check (duration_s between 0 and 14400)
);
create index on public.call_logs (agent_id, started_at);
create index on public.call_logs (lead_id, started_at desc);
alter table public.call_logs enable row level security;
create policy "read calls" on public.call_logs for select to authenticated
  using ((select public.sees_all()) or agent_id = (select auth.uid()) or agent_id = any ((select public.my_team_member_ids())::uuid[]));
create policy "log own calls" on public.call_logs for insert to authenticated
  with check (agent_id = (select auth.uid()) and public.can_see_lead(lead_id));
create policy "finish own calls" on public.call_logs for update to authenticated
  using (agent_id = (select auth.uid())) with check (agent_id = (select auth.uid()));
grant select, insert, update on public.call_logs to authenticated;
grant all on public.call_logs to service_role;

-- Talk time per agent for a period (minutes), for the live board and reports.
create or replace function public.talk_time(p_from date, p_to date)
returns table (agent_id uuid, calls integer, minutes integer)
language sql stable security invoker set search_path = public
as $$
  select c.agent_id, count(*)::int, round(coalesce(sum(c.duration_s), 0) / 60.0)::int
  from public.call_logs c
  where c.started_at >= public.cairo_day_start(p_from) and c.started_at < public.cairo_day_start(p_to + 1)
  group by 1
$$;

-- ───────── Month forecast (Fridays are days off) ─────────
create or replace function public.month_forecast(p_day date default null)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  d date := coalesce(p_day, public.cairo_today());
  m_start date := date_trunc('month', d)::date;
  m_end date := (date_trunc('month', d) + interval '1 month - 1 day')::date;
  total_days integer;
  done_days integer;
begin
  select count(*) filter (where extract(isodow from g) <> 5),
         count(*) filter (where extract(isodow from g) <> 5 and g::date <= d)
    into total_days, done_days
  from generate_series(m_start, m_end, '1 day') g;
  done_days := greatest(done_days, 1);

  return (
    with l as (select agent_id, count(*) n from public.leads
               where created_at >= public.cairo_day_start(m_start) and created_at < public.cairo_day_start(d + 1) group by 1),
    h as (select agent_id, count(*) n from public.leads
          where hired_at >= public.cairo_day_start(m_start) and hired_at < public.cairo_day_start(d + 1) group by 1),
    t as (select agent_id, sum(target_leads) tl, sum(target_hired) th from public.daily_targets
          where date between m_start and m_end group by 1),
    a as (select p.id, p.full_name, coalesce(l.n, 0) leads, coalesce(h.n, 0) hired, coalesce(t.tl, 0) tl, coalesce(t.th, 0) th
          from public.profiles p left join l on l.agent_id = p.id left join h on h.agent_id = p.id left join t on t.agent_id = p.id
          where p.role = 'agent' and p.is_active)
    select jsonb_build_object(
      'month', to_char(m_start, 'YYYY-MM'),
      'workdays_total', total_days,
      'workdays_done', done_days,
      'leads', (select coalesce(sum(leads), 0) from a),
      'hired', (select coalesce(sum(hired), 0) from a),
      'target_leads', (select coalesce(sum(tl), 0) from a),
      'target_hired', (select coalesce(sum(th), 0) from a),
      'projected_leads', (select round(coalesce(sum(leads), 0)::numeric / done_days * total_days) from a),
      'projected_hired', (select round(coalesce(sum(hired), 0)::numeric / done_days * total_days) from a),
      'agents', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', id, 'name', full_name, 'hired', hired, 'target_hired', th, 'leads', leads, 'target_leads', tl,
                   'projected_hired', round(hired::numeric / done_days * total_days)) order by hired desc), '[]') from a)
    )
  );
end;
$$;
revoke execute on function public.month_forecast(date), public.talk_time(date, date) from anon, public;
grant execute on function public.month_forecast(date), public.talk_time(date, date) to authenticated;

-- ───────── Weekly / monthly report notices (week = Saturday–Friday) ─────────
create or replace function public.send_period_reports()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  today date := public.cairo_today();
  hr integer := extract(hour from now() at time zone 'Africa/Cairo');
  n integer := 0;
  w_end date; w_start date; m_start date; m_end date;
  leads_n integer; hired_n integer; prev_hired integer;
  staff uuid[] := array(select id from public.profiles where role in ('admin', 'manager', 'team_leader') and is_active);
  fc jsonb;
begin
  if hr < 9 then return 0; end if;

  -- Every Saturday: last week (Sat → Fri).
  if extract(isodow from today) = 6 then
    w_end := today - 1; w_start := today - 7;
    select count(*) into leads_n from public.leads where created_at >= public.cairo_day_start(w_start) and created_at < public.cairo_day_start(w_end + 1);
    select count(*) into hired_n from public.leads where hired_at >= public.cairo_day_start(w_start) and hired_at < public.cairo_day_start(w_end + 1);
    select count(*) into prev_hired from public.leads where hired_at >= public.cairo_day_start(w_start - 7) and hired_at < public.cairo_day_start(w_start);
    if public.notify_once('weekly:' || w_start, staff, 'info', '📈 التقرير الأسبوعي جاهز: ' || w_start || ' → ' || w_end,
         leads_n || ' ليد · ' || hired_n || ' اشتغلوا · الأسبوع اللي قبله: ' || prev_hired,
         '/admin/report?period=week&date=' || w_end) then n := n + 1; end if;

    -- Mid-month nudge when the month is heading below target.
    fc := public.month_forecast(today);
    if (fc ->> 'target_hired')::int > 0 and (fc ->> 'projected_hired')::int < 0.9 * (fc ->> 'target_hired')::int then
      if public.notify_once('forecast:' || today, array(select id from public.profiles where role in ('admin', 'manager') and is_active), 'info',
           '⚠️ تارجت الشهر في خطر', 'المتوقع ' || (fc ->> 'projected_hired') || ' من ' || (fc ->> 'target_hired') || ' تعيين',
           '/admin') then n := n + 1; end if;
    end if;
  end if;

  -- 1st of the month: last month.
  if extract(day from today) = 1 then
    m_start := (date_trunc('month', today) - interval '1 month')::date; m_end := today - 1;
    select count(*) into leads_n from public.leads where created_at >= public.cairo_day_start(m_start) and created_at < public.cairo_day_start(today);
    select count(*) into hired_n from public.leads where hired_at >= public.cairo_day_start(m_start) and hired_at < public.cairo_day_start(today);
    if public.notify_once('monthly:' || m_start, staff, 'info', '🗓️ التقرير الشهري جاهز: ' || to_char(m_start, 'YYYY-MM'),
         leads_n || ' ليد · ' || hired_n || ' اشتغلوا', '/admin/report?period=month&date=' || m_end) then n := n + 1; end if;
  end if;
  return n;
end;
$$;
revoke execute on function public.send_period_reports() from anon, authenticated, public;

-- ───────── Server jobs the database asks the app to run (backups, WhatsApp) ─────────
create or replace function public.call_app(p_path text, p_body jsonb)
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  v_url text := (select value from private.app_config where key = 'app_url');
  v_secret text := (select value from private.app_config where key = 'dispatch_secret');
begin
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url || p_path, body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret), timeout_milliseconds := 60000);
end;
$$;
revoke execute on function public.call_app(text, jsonb) from anon, authenticated, public;

-- New lead → WhatsApp welcome (the app checks whether WhatsApp is configured).
create or replace function public.welcome_new_lead()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.call_app('/api/whatsapp/welcome', jsonb_build_object('id', new.id));
  return new;
exception when others then
  return new;
end;
$$;
revoke execute on function public.welcome_new_lead() from anon, authenticated, public;
create trigger leads_whatsapp_welcome after insert on public.leads for each row execute function public.welcome_new_lead();

-- Backups bucket (private).
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

do $$
begin
  perform cron.schedule('send-period-reports', '17 * * * *', 'select public.send_period_reports()');
  perform cron.schedule('daily-backup', '5 1 * * *', $c$select public.call_app('/api/backup/run', '{}'::jsonb)$c$);
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;

