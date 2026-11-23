-- Priority 1 from the system review: heavy work moves into the database. Additive only.

-- ═════ 1. Backups: one list of tables, one export built by the database ═════
-- The web server used to read every table page by page, parse it and compress it, which can't fit
-- the free server's limits as data grows. Now the database builds the export and the server only
-- passes the bytes along (compressed) to storage. The Google Drive copy uses the same export.
create or replace function private.backup_tables()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['governorates', 'regions', 'teams', 'team_companies', 'profiles', 'companies', 'company_governorates',
    'agent_companies', 'work_locations', 'work_settings', 'daily_targets', 'leads', 'lead_activities', 'lead_documents',
    'call_logs', 'tasks', 'company_announcements', 'agent_breaks', 'whatsapp_templates', 'blacklist', 'attendance',
    'broadcasts', 'broadcast_reads', 'admin_requests', 'geo_checkins', 'login_events', 'audit_log',
    'leave_requests', 'hour_permits', 'public_holidays', 'team_targets', 'saved_filters', 'interview_wa_reminders']
$$;

create or replace function public.backup_export()
returns jsonb
language plpgsql stable security definer set search_path = private, public, auth
as $$
declare
  t text;
  data jsonb := '{}';
  rows jsonb;
begin
  -- Only the server (service role), the scheduler, or an admin's Drive backup may read everything.
  if auth.uid() is not null and not public.is_admin() then raise exception 'server_only' using errcode = '42501'; end if;
  foreach t in array private.backup_tables() loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into rows;
      data := data || jsonb_build_object(t, rows);
    end if;
  end loop;
  return jsonb_build_object(
    'app', 'fullspeed-ams', 'created_at', now(),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email)), '[]') from auth.users u),
    'tables', data);
end;
$$;
revoke execute on function public.backup_export() from anon, authenticated, public;
grant execute on function public.backup_export() to service_role;

create or replace function public.backup_to_drive()
returns bigint
language plpgsql security definer set search_path = private, public, auth
as $$
declare
  url text := (select value from private.app_config where key = 'drive_script_url');
  secret text := (select value from private.app_config where key = 'drive_secret');
  req bigint;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if coalesce(url, '') = '' or coalesce(secret, '') = '' then return null; end if;
  select net.http_post(
    url := url,
    body := jsonb_build_object(
      'secret', secret,
      'name', 'fullspeed-' || public.cairo_today() || '.json',
      'data', replace(encode(convert_to(public.backup_export()::text, 'UTF8'), 'base64'), E'\n', '')),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  ) into req;
  insert into private.app_config (key, value) values ('drive_backup_request', req::text), ('drive_backup_at', now()::text)
  on conflict (key) do update set value = excluded.value;
  return req;
end;
$$;

-- ═════ 2. Leads Excel export: the whole CSV is written by the database ═════
-- Same filters as the leads screen, row-level security still decides what each person can export.
-- The app passes the column titles and status names in the viewer's language.
create or replace function public.csv_cell(v text)
returns text
language sql immutable set search_path = ''
as $$
  with s as (
    select case when coalesce(v, '') ~ '^[=+\-@]' and coalesce(v, '') !~ '^-?[0-9]' then '''' || v else coalesce(v, '') end as x
  )
  select case when x ~ '[",\r\n]' then '"' || replace(x, '"', '""') || '"' else x end from s
$$;
revoke execute on function public.csv_cell(text) from anon, public;
grant execute on function public.csv_cell(text) to authenticated;

-- Returning this type lets the API hand the file over as-is (Content-Type: text/csv) instead of JSON.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'text/csv' and typnamespace = 'public'::regnamespace) then
    create domain public."text/csv" as text;
  end if;
end;
$$;

create or replace function public.export_leads_csv(p jsonb)
returns public."text/csv"
language sql stable security invoker set search_path = public
as $$
  with prm as (
    select nullif(p->>'from', '')::date as f_from,
           coalesce(nullif(p->>'to', '')::date, nullif(p->>'from', '')::date) as f_to,
           coalesce(nullif(p->>'datefield', ''), 'created') as date_col,
           nullif(regexp_replace(coalesce(p->>'q', ''), '[%_,()*\\]', '', 'g'), '') as term,
           public.cairo_today() as today
  ),
  x as materialized (
    select row_number() over () as n, e.* from (
      select l.full_name, l.phone, c.name as company, g.name_ar as governorate, rg.name_ar as region, a.full_name as agent,
             l.status::text as status, l.source, l.created_at, l.notes, l.form_data
      from prm, public.leads l
      join public.companies c on c.id = l.company_id
      left join public.governorates g on g.id = l.governorate_id
      left join public.regions rg on rg.id = l.region_id
      left join public.profiles a on a.id = l.agent_id
      where (p->>'company' is null or l.company_id = (p->>'company')::uuid)
        and (p->>'agent' is null or (p->>'agent' = 'none' and l.agent_id is null) or l.agent_id::text = p->>'agent')
        and (p->>'team' is null or l.agent_id in (select id from public.profiles where team_id = (p->>'team')::uuid))
        and (p->>'status' is null or l.status::text = p->>'status')
        and (p->>'gov' is null or l.governorate_id = (p->>'gov')::integer)
        and (p->>'source' is null or l.source = p->>'source')
        and (p->>'reason' is null or l.reject_reason = p->>'reason')
        and (p->>'attempts' is null
             or (p->>'attempts' = '0' and l.attempts = 0)
             or (p->>'attempts' = '1-2' and l.attempts between 1 and 2)
             or (p->>'attempts' = '3+' and l.attempts >= 3))
        and (p->>'flag' is null
             or (p->>'flag' = 'never' and l.attempts = 0 and l.status = 'new')
             or (p->>'flag' = 'callback_due' and l.callback_at <= now())
             or (p->>'flag' = 'interview_upcoming' and l.interview_at >= now())
             or (p->>'flag' = 'interview_today' and l.interview_at >= public.cairo_day_start(prm.today) and l.interview_at < public.cairo_day_start(prm.today + 1))
             or (p->>'flag' = 'stale' and l.status in ('contacted', 'interview', 'documents') and l.last_contact_at < now() - interval '3 days'))
        and ((prm.f_from is null and prm.f_to is null) or (
             case prm.date_col when 'hired' then l.hired_at when 'contact' then l.last_contact_at else l.created_at end
               >= public.cairo_day_start(coalesce(prm.f_from, date '2000-01-01'))
             and case prm.date_col when 'hired' then l.hired_at when 'contact' then l.last_contact_at else l.created_at end
               < public.cairo_day_start(coalesce(prm.f_to, date '2100-01-01') + 1)))
        and (p->>'company' is null or p->>'fkey' is null or p->>'fval' is null or l.form_data->>(p->>'fkey') = p->>'fval')
        and (prm.term is null or l.full_name ilike '%' || prm.term || '%' or l.phone ilike '%' || prm.term || '%')
      order by
        case when p->>'sort' = 'attempts' then l.attempts end desc nulls last,
        case when p->>'sort' = 'contact' then l.last_contact_at end desc nulls last,
        case when p->>'sort' = 'old' then l.created_at end asc,
        l.created_at desc, l.id desc
      limit 50000
    ) e
  ),
  -- Extra columns: every form question that appears, in the order it first shows up.
  keys as (
    select k, row_number() over (order by min(x.n), k) as i
    from x, jsonb_object_keys(case when jsonb_typeof(x.form_data) = 'object' then x.form_data else '{}' end) k
    group by k
  ),
  head as (
    select string_agg(public.csv_cell(h), ',' order by ord) as line
    from (
      select value as h, ord from jsonb_array_elements_text(p->'headers') with ordinality as t(value, ord)
      union all
      select coalesce((select fld->>'label' from public.companies c2, jsonb_array_elements(c2.form_schema) fld
                       where fld->>'key' = keys.k limit 1), keys.k), 1000 + keys.i
      from keys
    ) hs
  ),
  body as (
    select string_agg(
      concat_ws(',',
        public.csv_cell(x.full_name), public.csv_cell(x.phone), public.csv_cell(x.company), public.csv_cell(x.governorate),
        public.csv_cell(x.region), public.csv_cell(x.agent), public.csv_cell(coalesce(p->'status_labels'->>x.status, x.status)),
        public.csv_cell(x.source), public.csv_cell(to_char(x.created_at at time zone 'Africa/Cairo', 'DD/MM/YYYY, HH24:MI:SS')),
        public.csv_cell(x.notes))
      || coalesce((
        select string_agg(',' || public.csv_cell(case jsonb_typeof(x.form_data->keys.k)
                                   when 'boolean' then case when (x.form_data->>keys.k)::boolean then p->>'yes' else p->>'no' end
                                   else x.form_data->>keys.k end), '' order by keys.i)
        from keys), ''),
      E'\r\n' order by x.n) as lines
    from x
  )
  select (chr(65279) || head.line || coalesce(E'\r\n' || body.lines, ''))::public."text/csv" from head, body
$$;
revoke execute on function public.export_leads_csv(jsonb) from anon, public;
grant execute on function public.export_leads_csv(jsonb) to authenticated;

-- ═════ 3. CRM inbound leads: the whole batch in one database call ═════
-- The server checks names and phone numbers; the database finds the company, governorate and region,
-- skips duplicates, picks the agent and inserts, returning one result per lead.
create or replace function public.crm_import_leads(p_items jsonb, p_note text default 'المصدر: {0}')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  it jsonb;
  results jsonb := '[]';
  ext text;
  co record;
  gov integer;
  reg integer;
  agent uuid;
  new_id uuid;
  src text;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode = '42501'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    ext := nullif(it->>'external_id', '');
    if not coalesce((it->>'valid')::boolean, false) then
      results := results || jsonb_build_object('external_id', ext, 'status', 'rejected', 'reason', 'invalid name/phone');
      continue;
    end if;
    select c.id, c.is_active into co from public.companies c
    where c.slug = it->>'company' or lower(c.name) = it->>'company'
    order by (c.slug = it->>'company') desc limit 1;
    if co.id is null or not co.is_active then
      results := results || jsonb_build_object('external_id', ext, 'status', 'rejected', 'reason', 'unknown company');
      continue;
    end if;
    if public.lead_phone_taken(co.id, it->>'phone') then
      results := results || jsonb_build_object('external_id', ext, 'status', 'duplicate');
      continue;
    end if;
    gov := null;
    if nullif(it->>'governorate', '') is not null then
      select g.id into gov from public.governorates g
      where g.name_ar = it->>'governorate' or lower(g.name_en) = lower(it->>'governorate') limit 1;
    end if;
    reg := null;
    if nullif(it->>'region', '') is not null then
      select r.id into reg from public.regions r
      where r.name_ar = it->>'region' and (gov is null or r.governorate_id = gov) limit 1;
    end if;
    agent := public.pick_agent_for_company(co.id);
    src := nullif(it->>'source', '');
    begin
      insert into public.leads (company_id, agent_id, full_name, phone, governorate_id, region_id, form_data, source, external_id, notes)
      values (co.id, agent, it->>'full_name', it->>'phone', gov, reg, coalesce(it->'fields', '{}'), 'crm', ext,
              case when src is not null then replace(p_note, '{0}', 'crm:' || src) end)
      returning id into new_id;
      results := results || jsonb_build_object('external_id', ext, 'status', 'created', 'id', new_id, 'assigned', agent is not null);
    exception
      when unique_violation then
        results := results || jsonb_build_object('external_id', ext, 'status', 'duplicate');
      when others then
        results := results || jsonb_build_object('external_id', ext, 'status', case when sqlerrm like '%BLACKLISTED%' then 'blacklisted' else 'error' end);
    end;
  end loop;
  return results;
end;
$$;
revoke execute on function public.crm_import_leads(jsonb, text) from anon, authenticated, public;
grant execute on function public.crm_import_leads(jsonb, text) to service_role;

-- ═════ 4. Counting in the database instead of downloading thousands of rows ═════
-- TV screen: today's new leads per company. Row-level security applies (security invoker).
create or replace function public.leads_by_company(p_start timestamptz, p_end timestamptz)
returns table (company_id uuid, name text, logo_path text, leads bigint)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.name, c.logo_path, count(*)
  from public.leads l join public.companies c on c.id = l.company_id
  where l.created_at >= p_start and l.created_at < p_end
  group by c.id, c.name, c.logo_path
$$;
revoke execute on function public.leads_by_company(timestamptz, timestamptz) from anon, public;
grant execute on function public.leads_by_company(timestamptz, timestamptz) to authenticated;

-- Live board: per agent, new leads nobody has called yet, and how many of them waited too long.
create or replace function public.waiting_leads_by_agent(p_slow_before timestamptz)
returns table (agent_id uuid, waiting bigint, slow bigint)
language sql stable security invoker set search_path = public
as $$
  select l.agent_id, count(*), count(*) filter (where l.created_at < p_slow_before)
  from public.leads l
  where l.status = 'new' and l.attempts = 0 and l.agent_id is not null
  group by l.agent_id
$$;
revoke execute on function public.waiting_leads_by_agent(timestamptz) from anon, public;
grant execute on function public.waiting_leads_by_agent(timestamptz) to authenticated;

-- ═════ 5. Analytics: faster per-day counts, and a light version for comparisons ═════
create or replace function public.analytics_filtered(
  p_from date, p_to date,
  p_team uuid default null, p_company uuid default null, p_agent uuid default null,
  p_source text default null, p_governorate integer default null)
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

  with agents as (
    select id, full_name, team_id from public.profiles
    where role = 'agent' and is_active
      and (p_team is null or team_id = p_team)
      and (p_agent is null or id = p_agent)
  ),
  scope as (
    select * from public.leads x
    where (p_company is null or x.company_id = p_company)
      and (p_source is null or x.source = p_source)
      and (p_governorate is null or x.governorate_id = p_governorate)
      and (p_agent is null or x.agent_id = p_agent)
      and (p_team is null or x.agent_id in (select id from public.profiles where team_id = p_team))
  ),
  l as (select * from scope where created_at >= v_start and created_at < v_end),
  hires as (select * from scope where hired_at >= v_start and hired_at < v_end),
  touch as (
    select a.lead_id, min(a.created_at) as t
    from public.lead_activities a
    join l on l.id = a.lead_id
    where a.from_status is not null
    group by a.lead_id
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
      -- Counted once per day group, instead of re-scanning every lead for every day.
      select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'leads', coalesce(lc.n, 0), 'hired', coalesce(hc.n, 0)) order by g), '[]'::jsonb)
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
      left join (select (created_at at time zone 'Africa/Cairo')::date as d, count(*) as n from l group by 1) lc on lc.d = g::date
      left join (select (hired_at at time zone 'Africa/Cairo')::date as d, count(*) as n from hires group by 1) hc on hc.d = g::date
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
      where p_team is null or t.id = p_team
    )
  ) into v_result;

  return v_result;
end;
$$;

-- The comparisons tab only needs the headline numbers; this skips the per-agent, per-company and
-- per-day breakdowns that analytics_filtered builds.
create or replace function public.analytics_totals(
  p_from date, p_to date,
  p_team uuid default null, p_company uuid default null, p_agent uuid default null,
  p_source text default null, p_governorate integer default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with scope as (
    select x.id, x.status, x.agent_id, x.created_at, x.hired_at from public.leads x
    where (p_company is null or x.company_id = p_company)
      and (p_source is null or x.source = p_source)
      and (p_governorate is null or x.governorate_id = p_governorate)
      and (p_agent is null or x.agent_id = p_agent)
      and (p_team is null or x.agent_id in (select id from public.profiles where team_id = p_team))
  ),
  l as (select * from scope where created_at >= public.cairo_day_start(p_from) and created_at < public.cairo_day_start(p_to + 1)),
  hires as (select * from scope where hired_at >= public.cairo_day_start(p_from) and hired_at < public.cairo_day_start(p_to + 1)),
  touch as (
    select a.lead_id, min(a.created_at) as t
    from public.lead_activities a join l on l.id = a.lead_id
    where a.from_status is not null
    group by a.lead_id
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'leads', count(*),
        'contacted', count(*) filter (where status not in ('new', 'no_answer')),
        'no_answer', count(*) filter (where status = 'no_answer'),
        'rejected', count(*) filter (where status = 'rejected'),
        'unassigned', count(*) filter (where agent_id is null),
        'converted', count(*) filter (where status = 'hired')) from l),
    'hired', (select count(*) from hires),
    'avg_hours_to_hire', (select round((avg(extract(epoch from (hired_at - created_at))) / 3600)::numeric, 1) from hires),
    'avg_hours_first_touch', (select round((avg(extract(epoch from (t.t - l.created_at))) / 3600)::numeric, 1) from l join touch t on t.lead_id = l.id)
  )
$$;
revoke execute on function public.analytics_totals(date, date, uuid, uuid, uuid, text, integer) from anon, public;
grant execute on function public.analytics_totals(date, date, uuid, uuid, uuid, text, integer) to authenticated;
