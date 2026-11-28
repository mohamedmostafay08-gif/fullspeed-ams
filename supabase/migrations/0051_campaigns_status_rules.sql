-- Phase 2 of the LineCRM ideas:
--   1) Campaign and ad as real columns (from LineCRM fields, Facebook forms, or the old note), with a funnel report.
--   2) LineCRM's stage (موتوسكلات / عربيات / بدون وسيلة) fills the lead's «vehicle» answer when it is empty.
--   3) Next step: every open lead should have a future call or interview; a column makes «no next step» a cheap filter.
--   4) Status rules: fields required before a lead enters a status, and how many hours it may stay there
--      (overdue leads get a filter and one summary notification a day per agent).
-- Additive only. Safe to run twice.

-- ───────── 1) Columns ─────────
alter table public.leads add column if not exists campaign_name text;
alter table public.leads add column if not exists ad_name text;
-- The later of the call-back and the interview time; '-infinity' when there is none, so «no next step» is one comparison.
alter table public.leads add column if not exists next_step_at timestamptz not null default '-infinity';
alter table public.leads add column if not exists status_changed_at timestamptz;
alter table public.leads add column if not exists status_due_at timestamptz;

create index if not exists leads_campaign_idx on public.leads (campaign_name, created_at desc) where campaign_name is not null;
create index if not exists leads_next_step_idx on public.leads (agent_id, next_step_at)
  where status in ('no_answer', 'contacted', 'interview', 'documents');
create index if not exists leads_status_due_idx on public.leads (agent_id, status_due_at) where status_due_at is not null;

-- ───────── 2) Status rules ─────────
create table if not exists public.lead_status_rules (
  status public.lead_status primary key,
  required text[] not null default '{}',   -- keys from lead_rule_fields() below
  max_hours integer check (max_hours is null or max_hours between 1 and 2160),
  updated_at timestamptz not null default now()
);
insert into public.lead_status_rules (status)
select s from unnest(enum_range(null::public.lead_status)) s
on conflict (status) do nothing;

alter table public.lead_status_rules enable row level security;
drop policy if exists "read status rules" on public.lead_status_rules;
create policy "read status rules" on public.lead_status_rules for select to authenticated using (true);
grant select on public.lead_status_rules to authenticated;

-- What a rule may require. Columns of the lead, plus the «vehicle» answer.
create or replace function public.lead_rule_fields()
returns text[]
language sql immutable
as $$ select array['interview_at', 'callback_at', 'governorate_id', 'region_id', 'notes', 'reject_reason', 'vehicle'] $$;

-- ───────── 3) Bookkeeping stays out of the audit log ─────────
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ignored text[] := array['updated_at', 'callback_reminded_at', 'interview_reminded_at', 'last_contact_at', 'attempts',
                          'assigned_at', 'prev_agent_id', 'reassign_count', 'first_contact_at',
                          'campaign_name', 'ad_name', 'next_step_at', 'status_changed_at', 'status_due_at'];
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

-- ───────── 4) Helpers ─────────
-- «إعلان فيسبوك · campaign · ad» / «LineCRM · campaign · ad» → (campaign, ad).
create or replace function public.campaign_from_note(p_note text, out campaign text, out ad text)
language sql immutable
as $$
  select nullif(btrim(parts[2]), ''), nullif(btrim(parts[3]), '')
  from (select string_to_array(split_part(coalesce(p_note, ''), E'\n', 1), ' · ') as parts) x
  where parts[1] in ('إعلان فيسبوك', 'LineCRM')
$$;

-- LineCRM stage → the companies' «vehicle» option.
create or replace function public.vehicle_from_stage(p_stage text)
returns text
language sql immutable
as $$
  select case btrim(coalesce(p_stage, ''))
    when 'موتوسكلات' then 'موتوسيكل'
    when 'موتوسيكلات' then 'موتوسيكل'
    when 'عربيات' then 'عربية'
    when 'بدون وسيلة' then 'بدون مركبة'
  end
$$;

-- ───────── 5) Backfill (before the triggers, so they don't overwrite it) ─────────
update public.leads l
set campaign_name = coalesce(nullif(l.form_data->>'الحملة', ''), (public.campaign_from_note(l.notes)).campaign),
    ad_name = coalesce(nullif(l.form_data->>'الإعلان', ''), (public.campaign_from_note(l.notes)).ad)
where l.campaign_name is null and l.ad_name is null
  and (nullif(l.form_data->>'الحملة', '') is not null or nullif(l.form_data->>'الإعلان', '') is not null
       or l.notes like 'إعلان فيسبوك · %' or l.notes like 'LineCRM · %');

update public.leads l
set campaign_name = coalesce(l.campaign_name, nullif(e.payload->>'campaign_name', '')),
    ad_name = coalesce(l.ad_name, nullif(e.payload->>'ad_name', ''))
from public.meta_lead_events e
where e.lead_id = l.id and (l.campaign_name is null or l.ad_name is null)
  and (nullif(e.payload->>'campaign_name', '') is not null or nullif(e.payload->>'ad_name', '') is not null);

update public.leads l
set form_data = coalesce(l.form_data, '{}'::jsonb) || jsonb_build_object('vehicle', public.vehicle_from_stage(l.form_data->>'_المرحلة في LineCRM'))
where public.vehicle_from_stage(l.form_data->>'_المرحلة في LineCRM') is not null
  and nullif(l.form_data->>'vehicle', '') is null;

update public.leads l
set next_step_at = coalesce(greatest(l.callback_at, l.interview_at), '-infinity')
where l.next_step_at is distinct from coalesce(greatest(l.callback_at, l.interview_at), '-infinity');

-- When did each lead enter its status: the last audited status change, else when it was created.
with last_change as (
  select a.row_id, max(a.at) as at
  from public.audit_log a
  where a.table_name = 'leads' and a.action = 'update' and a.changes ? 'status'
  group by a.row_id
)
update public.leads l
set status_changed_at = coalesce((select lc.at from last_change lc where lc.row_id = l.id::text), l.created_at)
where l.status_changed_at is null;

-- ───────── 6) Triggers ─────────
create or replace function public.leads_fill_derived()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v text;
  r public.lead_status_rules;
begin
  -- Campaign / ad: set once when the lead arrives; later a person may correct them.
  if tg_op = 'INSERT' then
    new.campaign_name := coalesce(nullif(new.campaign_name, ''), nullif(new.form_data->>'الحملة', ''), (public.campaign_from_note(new.notes)).campaign);
    new.ad_name := coalesce(nullif(new.ad_name, ''), nullif(new.form_data->>'الإعلان', ''), (public.campaign_from_note(new.notes)).ad);
  elsif new.campaign_name is null and new.ad_name is null and new.form_data is distinct from old.form_data then
    new.campaign_name := nullif(new.form_data->>'الحملة', '');
    new.ad_name := nullif(new.form_data->>'الإعلان', '');
  end if;

  -- Vehicle from LineCRM's stage, only when the lead has no answer yet.
  v := public.vehicle_from_stage(new.form_data->>'_المرحلة في LineCRM');
  if v is not null and nullif(new.form_data->>'vehicle', '') is null then
    new.form_data := coalesce(new.form_data, '{}'::jsonb) || jsonb_build_object('vehicle', v);
  end if;

  new.next_step_at := coalesce(greatest(new.callback_at, new.interview_at), '-infinity');

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
    select * into r from public.lead_status_rules where status = new.status;
    new.status_due_at := case when r.max_hours is not null then now() + make_interval(hours => r.max_hours) end;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_fill_derived on public.leads;
create trigger leads_fill_derived before insert or update on public.leads
  for each row execute function public.leads_fill_derived();

-- Required fields before entering a status. Only for people; the server and scheduler are trusted.
-- The error is «REQUIRED:<field>,<field>» so the app can name the missing fields.
create or replace function public.leads_check_status_rules()
returns trigger
language plpgsql set search_path = public
as $$
declare
  req text[];
  missing text[] := '{}';
  f text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  -- Blocking a number closes its leads; that must never be stopped by a rule.
  if new.status = 'rejected' and public.blacklist_reason(new.phone) is not null then return new; end if;
  select required into req from public.lead_status_rules where status = new.status;
  if req is null or cardinality(req) = 0 then return new; end if;
  foreach f in array req loop
    if (f = 'interview_at' and new.interview_at is null)
       or (f = 'callback_at' and new.callback_at is null)
       or (f = 'governorate_id' and new.governorate_id is null)
       or (f = 'region_id' and new.region_id is null)
       or (f = 'notes' and nullif(btrim(coalesce(new.notes, '')), '') is null)
       or (f = 'reject_reason' and nullif(btrim(coalesce(new.reject_reason, '')), '') is null)
       or (f = 'vehicle' and nullif(btrim(coalesce(new.form_data->>'vehicle', '')), '') is null) then
      missing := missing || f;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'REQUIRED:%', array_to_string(missing, ',') using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_check_status_rules on public.leads;
create trigger leads_check_status_rules before insert or update of status on public.leads
  for each row execute function public.leads_check_status_rules();

-- A Facebook lead gets its event row linked after the insert: copy the campaign then.
create or replace function public.meta_event_fill_campaign()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.lead_id is not null and new.lead_id is distinct from old.lead_id then
    update public.leads
    set campaign_name = coalesce(campaign_name, nullif(new.payload->>'campaign_name', '')),
        ad_name = coalesce(ad_name, nullif(new.payload->>'ad_name', ''))
    where id = new.lead_id and (campaign_name is null or ad_name is null)
      and (nullif(new.payload->>'campaign_name', '') is not null or nullif(new.payload->>'ad_name', '') is not null);
  end if;
  return new;
end;
$$;
drop trigger if exists meta_event_fill_campaign on public.meta_lead_events;
create trigger meta_event_fill_campaign after update of lead_id on public.meta_lead_events
  for each row execute function public.meta_event_fill_campaign();

-- ───────── 7) Saving a rule (managers) ─────────
create or replace function public.set_status_rule(p_status public.lead_status, p_required text[], p_max_hours integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  bad text;
begin
  if not public.is_manager() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select f into bad from unnest(coalesce(p_required, '{}')) f where not (f = any (public.lead_rule_fields())) limit 1;
  if bad is not null then raise exception 'UNKNOWN_FIELD:%', bad using errcode = '22023'; end if;
  if p_max_hours is not null and (p_max_hours < 1 or p_max_hours > 2160) then
    raise exception 'BAD_HOURS' using errcode = '22023';
  end if;
  update public.lead_status_rules
  set required = coalesce(array(select distinct f from unnest(p_required) f), '{}'), max_hours = p_max_hours, updated_at = now()
  where status = p_status;
  -- Leads already in that status get the new deadline, counted from when they entered it.
  update public.leads
  set status_due_at = case when p_max_hours is not null then coalesce(status_changed_at, created_at) + make_interval(hours => p_max_hours) end
  where status = p_status and status_due_at is distinct from
        case when p_max_hours is not null then coalesce(status_changed_at, created_at) + make_interval(hours => p_max_hours) end;
end;
$$;
revoke execute on function public.set_status_rule(public.lead_status, text[], integer) from anon, public;
grant execute on function public.set_status_rule(public.lead_status, text[], integer) to authenticated;

-- ───────── 8) One summary a day per agent for overdue leads ─────────
create or replace function public.notify_overdue_status()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  hr integer := extract(hour from now() at time zone 'Africa/Cairo');
  r record;
  n integer := 0;
begin
  if hr < 10 or hr >= 20 or public.is_day_off(public.cairo_today()) then return 0; end if;
  for r in
    select l.agent_id, count(*) as c
    from public.leads l
    where l.status_due_at < now() and l.status not in ('hired', 'rejected') and l.agent_id is not null
    group by l.agent_id
  loop
    if public.notify_once('status-due:' || r.agent_id || ':' || public.cairo_today(), array[r.agent_id], 'reminder',
         '⏳ عندك ' || r.c || ' ليد فاتوا المدة في حالتهم', 'افتحهم وحرّكهم للخطوة الجاية', '/agent/leads?flag=stuck') then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.notify_overdue_status() from anon, authenticated, public;

do $$
begin
  perform cron.unschedule('notify-overdue-status');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('notify-overdue-status', '17 * * * *', 'select public.notify_overdue_status()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- ───────── 9) Campaign funnel ─────────
-- Per campaign (and its ads): leads → reached → interview → documents → hired, plus rejected and first-contact speed.
-- Managers and performance see everything; a team leader sees their team's leads.
create or replace function public.campaign_funnel(p_from date, p_to date, p_company uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  role text := public.my_role();
  team uuid[];
  t0 timestamptz := public.cairo_day_start(coalesce(p_from, public.cairo_today() - 29));
  t1 timestamptz := public.cairo_day_start(coalesce(p_to, public.cairo_today()) + 1);
  res jsonb;
begin
  if role is null or role not in ('admin', 'manager', 'team_leader', 'performance') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if role = 'team_leader' then team := public.my_team_member_ids(); end if;

  with l as (
    select coalesce(nullif(x.campaign_name, ''), '—') as campaign, coalesce(nullif(x.ad_name, ''), '—') as ad,
           x.status, x.created_at, x.first_contact_at, x.interview_at, x.source
    from public.leads x
    where x.created_at >= t0 and x.created_at < t1
      and (p_company is null or x.company_id = p_company)
      and (team is null or x.agent_id = any (team))
  ),
  agg as (
    select campaign, ad, source,
      count(*) as leads,
      count(*) filter (where first_contact_at is not null or status <> 'new') as reached,
      count(*) filter (where status in ('interview', 'documents', 'hired') or interview_at is not null) as interview,
      count(*) filter (where status in ('documents', 'hired')) as documents,
      count(*) filter (where status = 'hired') as hired,
      count(*) filter (where status = 'rejected') as rejected,
      round(percentile_cont(0.5) within group (order by extract(epoch from first_contact_at - created_at) / 60)
            filter (where first_contact_at is not null)::numeric) as median_first_min
    from l
    group by grouping sets ((campaign, ad, source), (campaign))
  )
  select jsonb_build_object(
    'from', coalesce(p_from, public.cairo_today() - 29),
    'to', coalesce(p_to, public.cairo_today()),
    'total', (select jsonb_build_object('leads', count(*), 'hired', count(*) filter (where status = 'hired')) from l),
    'campaigns', coalesce((
      select jsonb_agg(c order by (c->>'leads')::int desc) from (
        select jsonb_build_object(
          'campaign', a.campaign, 'leads', a.leads, 'reached', a.reached, 'interview', a.interview,
          'documents', a.documents, 'hired', a.hired, 'rejected', a.rejected, 'median_first_min', a.median_first_min,
          'ads', coalesce((
            select jsonb_agg(jsonb_build_object(
              'ad', b.ad, 'source', b.source, 'leads', b.leads, 'reached', b.reached, 'interview', b.interview,
              'documents', b.documents, 'hired', b.hired, 'rejected', b.rejected, 'median_first_min', b.median_first_min)
              order by b.leads desc)
            from agg b where b.campaign = a.campaign and b.ad is not null), '[]'::jsonb)) as c
        from agg a where a.ad is null
        order by a.leads desc
        limit 200
      ) s), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;
revoke execute on function public.campaign_funnel(date, date, uuid) from anon, public;
grant execute on function public.campaign_funnel(date, date, uuid) to authenticated;

-- ───────── 10) Export follows the new filters (same as 0036 plus campaign, no_next, stuck) ─────────
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
        and (p->>'campaign' is null or l.campaign_name = p->>'campaign')
        and (p->>'attempts' is null
             or (p->>'attempts' = '0' and l.attempts = 0)
             or (p->>'attempts' = '1-2' and l.attempts between 1 and 2)
             or (p->>'attempts' = '3+' and l.attempts >= 3))
        and (p->>'flag' is null
             or (p->>'flag' = 'never' and l.attempts = 0 and l.status = 'new')
             or (p->>'flag' = 'callback_due' and l.callback_at <= now())
             or (p->>'flag' = 'interview_upcoming' and l.interview_at >= now())
             or (p->>'flag' = 'interview_today' and l.interview_at >= public.cairo_day_start(prm.today) and l.interview_at < public.cairo_day_start(prm.today + 1))
             or (p->>'flag' = 'stale' and l.status in ('contacted', 'interview', 'documents') and l.last_contact_at < now() - interval '3 days')
             or (p->>'flag' = 'no_next' and l.status in ('no_answer', 'contacted', 'interview', 'documents') and l.next_step_at < now())
             or (p->>'flag' = 'stuck' and l.status_due_at < now() and l.status not in ('hired', 'rejected')))
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
