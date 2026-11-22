-- Phase 2 hardening: indexes and faster policies, failed sign-in log, lead import/export inside the
-- database, the nightly Drive copy made by the database itself, and a usage summary for the admin.

-- ═════ 1. Indexes for every foreign key the advisor flagged ═════
create index if not exists admin_requests_decided_by_idx on public.admin_requests (decided_by);
create index if not exists admin_requests_requested_by_idx on public.admin_requests (requested_by);
create index if not exists agent_breaks_decided_by_idx on public.agent_breaks (decided_by);
create index if not exists agent_companies_assigned_by_idx on public.agent_companies (assigned_by);
create index if not exists blacklist_created_by_idx on public.blacklist (created_by);
create index if not exists broadcast_reads_user_id_idx on public.broadcast_reads (user_id);
create index if not exists broadcasts_created_by_idx on public.broadcasts (created_by);
create index if not exists broadcasts_team_id_idx on public.broadcasts (team_id);
create index if not exists company_announcements_created_by_idx on public.company_announcements (created_by);
create index if not exists company_governorates_governorate_id_idx on public.company_governorates (governorate_id);
create index if not exists daily_targets_company_id_idx on public.daily_targets (company_id);
create index if not exists geo_checkins_location_id_idx on public.geo_checkins (location_id);
create index if not exists lead_documents_uploaded_by_idx on public.lead_documents (uploaded_by);
create index if not exists leads_governorate_id_idx on public.leads (governorate_id);
create index if not exists leads_region_id_idx on public.leads (region_id);
create index if not exists notifications_company_id_idx on public.notifications (company_id);
create index if not exists profiles_location_id_idx on public.profiles (location_id);
create index if not exists tasks_assigned_by_idx on public.tasks (assigned_by);
create index if not exists tasks_company_id_idx on public.tasks (company_id);
create index if not exists teams_leader_id_idx on public.teams (leader_id);
create index if not exists webauthn_challenges_user_id_idx on public.webauthn_challenges (user_id);
create index if not exists whatsapp_templates_company_id_idx on public.whatsapp_templates (company_id);
create index if not exists whatsapp_templates_created_by_idx on public.whatsapp_templates (created_by);

-- ═════ 2. Policies that re-ran auth.uid() per row: evaluate it once per query ═════
alter policy "read own notifications" on public.notifications using (user_id = (select auth.uid()));
alter policy "mark own notifications" on public.notifications using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "add lead documents" on public.lead_documents with check (public.can_see_lead(lead_id) and uploaded_by = (select auth.uid()));
alter policy "remove lead documents" on public.lead_documents
  using (public.can_see_lead(lead_id) and ((select public.is_staff()) or uploaded_by = (select auth.uid())));
alter policy "own subscriptions read" on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy "own subscriptions add" on public.push_subscriptions with check (user_id = (select auth.uid()));
alter policy "own subscriptions update" on public.push_subscriptions using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "own subscriptions remove" on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy "own passkeys read" on public.passkeys using (user_id = (select auth.uid()));
alter policy "own passkeys remove" on public.passkeys using (user_id = (select auth.uid()));
alter policy "manager profiles" on public.profiles
  using ((select public.my_role()) = 'manager' and (role in ('team_leader', 'agent') or id = (select auth.uid())))
  with check ((select public.my_role()) = 'manager' and (role in ('team_leader', 'agent') or (id = (select auth.uid()) and role = 'manager')));

-- ═════ 3. Failed sign-ins are logged too ═════
alter table public.login_events alter column user_id drop not null;
alter table public.login_events add column if not exists email text;
alter table public.login_events add column if not exists success boolean not null default true;

-- ═════ 4. Lead import in one database call (duplicates, blacklist, distribution) ═════
create or replace function public.normalize_eg_phone(raw text)
returns text
language plpgsql immutable set search_path = public
as $$
declare p text := regexp_replace(translate(coalesce(raw, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9+]', '', 'g');
begin
  if p like '+20%' then p := '0' || substr(p, 4);
  elsif p like '0020%' then p := '0' || substr(p, 5);
  elsif p like '20%' and length(p) = 12 then p := '0' || substr(p, 3);
  elsif p ~ '^1[0-9]{9}$' then p := '0' || p;
  end if;
  return p;
end;
$$;

-- p_rows: [{"n": name, "p": phone, "g": governorate, "r": region, "x": {other columns}}], at most 2000.
-- p_distribute: 'auto' (even split over the company's agents), 'none', or one agent's id.
create or replace function public.import_leads(p_company uuid, p_distribute text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  pool uuid[];
  target uuid;
  r jsonb;
  ph text;
  nm text;
  gov integer;
  reg integer;
  n_ins integer := 0;
  n_dup integer := 0;
  n_skip integer := 0;
  n_block integer := 0;
begin
  select * into me from public.profiles where id = auth.uid() and is_active and role in ('admin', 'manager', 'team_leader');
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'too_many_rows' using errcode = '22023'; end if;

  if p_distribute = 'auto' then
    -- Least-loaded first (today's leads), so a batch tops up whoever has the fewest.
    pool := array(
      select p.id from public.agent_companies ac join public.profiles p on p.id = ac.agent_id
      where ac.company_id = p_company and p.is_active and p.role = 'agent'
        and (me.role <> 'team_leader' or p.team_id = me.team_id)
      order by (select count(*) from public.leads l where l.agent_id = p.id and l.created_at > public.cairo_day_start(public.cairo_today())), p.id);
    if coalesce(cardinality(pool), 0) = 0 then raise exception 'no_agents' using errcode = 'P0002'; end if;
  elsif coalesce(p_distribute, 'none') <> 'none' and p_distribute <> '' then
    target := p_distribute::uuid;
    if not exists (select 1 from public.agent_companies ac join public.profiles p on p.id = ac.agent_id
                   where ac.agent_id = target and ac.company_id = p_company and p.is_active
                     and (me.role <> 'team_leader' or p.team_id = me.team_id)) then
      raise exception 'agent_not_on_company' using errcode = '22023';
    end if;
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    nm := left(btrim(coalesce(r ->> 'n', '')), 120);
    ph := public.normalize_eg_phone(r ->> 'p');
    if nm = '' or ph !~ '^01[0125][0-9]{8}$' then n_skip := n_skip + 1; continue; end if;
    if exists (select 1 from public.blacklist b where b.phone = ph) then n_block := n_block + 1; continue; end if;
    if exists (select 1 from public.leads l where l.company_id = p_company and l.phone = ph) then n_dup := n_dup + 1; continue; end if;
    gov := (select g.id from public.governorates g where g.name_ar = btrim(r ->> 'g') or lower(g.name_en) = lower(btrim(r ->> 'g')) limit 1);
    reg := (select x.id from public.regions x where x.name_ar = btrim(r ->> 'r') and (gov is null or x.governorate_id = gov) limit 1);
    insert into public.leads (company_id, agent_id, full_name, phone, governorate_id, region_id, form_data, source, created_by)
    values (p_company,
            case when pool is not null then pool[(n_ins % cardinality(pool)) + 1] else target end,
            nm, ph, gov, reg, coalesce(r -> 'x', '{}'::jsonb), 'import', me.id);
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('inserted', n_ins, 'dupes', n_dup, 'skipped', n_skip, 'blocked', n_block);
end;
$$;
revoke execute on function public.import_leads(uuid, text, jsonb) from anon, public;
grant execute on function public.import_leads(uuid, text, jsonb) to authenticated;

-- ═════ 5. Lead export in one call (row-level security still applies) ═════
-- Returns one JSON array so the API's 1000-row cap doesn't cut the file short.
create or replace function public.export_leads(p_company uuid default null, p_agent text default null, p_status text default null,
                                               p_from date default null, p_to date default null, p_q text default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]')
  from (
    select l.full_name, l.phone, c.name as company, g.name_ar as governorate, rg.name_ar as region, a.full_name as agent,
           l.status::text as status, l.source, l.created_at, l.notes, l.form_data
    from public.leads l
    join public.companies c on c.id = l.company_id
    left join public.governorates g on g.id = l.governorate_id
    left join public.regions rg on rg.id = l.region_id
    left join public.profiles a on a.id = l.agent_id
    where (p_company is null or l.company_id = p_company)
      and (p_agent is null or (p_agent = 'none' and l.agent_id is null) or l.agent_id::text = p_agent)
      and (p_status is null or l.status::text = p_status)
      and (p_from is null or l.created_at >= public.cairo_day_start(p_from))
      and (p_to is null or l.created_at < public.cairo_day_start(p_to + 1))
      and (p_q is null or l.full_name ilike '%' || p_q || '%' or l.phone ilike '%' || p_q || '%')
    order by l.created_at desc, l.id desc
    limit 50000
  ) e
$$;
revoke execute on function public.export_leads(uuid, text, text, date, date, text) from anon, public;
grant execute on function public.export_leads(uuid, text, text, date, date, text) to authenticated;

-- ═════ 6. The nightly Google Drive copy, made inside the database ═════
-- Builds the whole export in Postgres and posts it to the Apps Script, so it never depends on the
-- web server's time limits. The admin may run it on demand; the scheduler runs it every night.
create or replace function public.backup_to_drive()
returns bigint
language plpgsql security definer set search_path = private, public, auth
as $$
declare
  url text := (select value from private.app_config where key = 'drive_script_url');
  secret text := (select value from private.app_config where key = 'drive_secret');
  tables text[] := array['governorates', 'regions', 'teams', 'team_companies', 'profiles', 'companies', 'company_governorates',
    'agent_companies', 'work_locations', 'work_settings', 'daily_targets', 'leads', 'lead_activities', 'lead_documents',
    'call_logs', 'tasks', 'company_announcements', 'agent_breaks', 'whatsapp_templates', 'blacklist', 'attendance',
    'broadcasts', 'broadcast_reads', 'admin_requests', 'geo_checkins', 'login_events', 'audit_log'];
  t text;
  data jsonb := '{}';
  rows jsonb;
  req bigint;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if coalesce(url, '') = '' or coalesce(secret, '') = '' then return null; end if;
  foreach t in array tables loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into rows;
    data := data || jsonb_build_object(t, rows);
  end loop;
  select net.http_post(
    url := url,
    body := jsonb_build_object(
      'secret', secret,
      'name', 'fullspeed-' || public.cairo_today() || '.json',
      'data', replace(encode(convert_to(jsonb_build_object(
        'app', 'fullspeed-ams', 'created_at', now(),
        'users', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email)), '[]') from auth.users u),
        'tables', data)::text, 'UTF8'), 'base64'), E'\n', '')),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  ) into req;
  insert into private.app_config (key, value) values ('drive_backup_request', req::text), ('drive_backup_at', now()::text)
  on conflict (key) do update set value = excluded.value;
  return req;
end;
$$;
revoke execute on function public.backup_to_drive() from anon, public;
grant execute on function public.backup_to_drive() to authenticated;

-- Morning check: the in-app copy must be under 26 hours old and the Drive post must have gone through.
-- (Apps Script answers a POST with a redirect once the file is saved.)
create or replace function public.check_backup()
returns boolean
language plpgsql security definer set search_path = private, public
as $$
declare
  last_ok timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'last_backup_at');
  req bigint := (select nullif(value, '')::bigint from private.app_config where key = 'drive_backup_request');
  drive_at timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'drive_backup_at');
  has_drive boolean := exists (select 1 from private.app_config where key = 'drive_script_url' and value <> '');
  code integer;
  admins uuid[] := array(select id from public.profiles where role = 'admin' and is_active);
  d date := public.cairo_today();
begin
  if last_ok is null or last_ok < now() - interval '26 hours' then
    return public.notify_once('backup-missing:' || d, admins, 'info', '⚠️ النسخة الاحتياطية بتاعة امبارح متعملتش',
      'افتح «النسخ والتكاملات» واعمل نسخة دلوقتي', '/admin/integrations');
  end if;
  if has_drive then
    select r.status_code into code from net._http_response r where r.id = req;
    if drive_at is null or drive_at < now() - interval '26 hours' or code is null or code not in (200, 302) then
      return public.notify_once('backup-drive:' || d, admins, 'info', '⚠️ النسخة الاحتياطية موصلتش جوجل درايف',
        'النسخة اتحفظت في السيستم بس — افتح «النسخ والتكاملات»', '/admin/integrations');
    end if;
  end if;
  return false;
end;
$$;
revoke execute on function public.check_backup() from anon, authenticated, public;

do $$
begin
  perform cron.schedule('backup-to-drive', '20 1 * * *', 'select public.backup_to_drive()');
  perform cron.unschedule('check-backup');
  perform cron.schedule('check-backup', '0 2 * * *', 'select public.check_backup()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;

-- ═════ 7. Usage against the free-plan limits, for the admin ═════
create or replace function public.admin_usage()
returns jsonb
language sql stable security definer set search_path = public, storage, private
as $$
  select case when public.is_admin() then jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'files', (select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('bytes', bytes, 'count', n)), '{}')
              from (select bucket_id, sum(coalesce((metadata ->> 'size')::bigint, 0)) bytes, count(*) n from storage.objects group by 1) s),
    'leads', (select count(*) from public.leads),
    'people', (select count(*) from public.profiles where is_active),
    'last_backup_at', (select value from private.app_config where key = 'last_backup_at'),
    'drive_backup_at', (select value from private.app_config where key = 'drive_backup_at'),
    'drive_status', (select r.status_code from net._http_response r
                     where r.id = (select nullif(value, '')::bigint from private.app_config where key = 'drive_backup_request'))
  ) end
$$;
revoke execute on function public.admin_usage() from anon, public;
grant execute on function public.admin_usage() to authenticated;
