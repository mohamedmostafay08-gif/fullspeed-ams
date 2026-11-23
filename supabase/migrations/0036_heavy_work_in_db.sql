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
