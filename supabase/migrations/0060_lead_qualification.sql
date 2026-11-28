-- 0060 · Quick qualification of a lead, and what each company accepts.
--   Lead:    area (governorate_id / region_id, already there), vehicle (form_data.vehicle, already used by 0051),
--            licence, age, and when it was qualified. Every company form already has «vehicle», «has_license» and «age»
--            fields in form_data, so the answers are written there too and old answers are read from there.
--   Company: vehicles it accepts, licence required, age range. Its hiring areas stay in company_governorates.
--   lead_fit(): which companies a lead fits, and why not.
-- Additive only. Safe to run twice.

-- ───────── 1) Columns ─────────
alter table public.leads add column if not exists has_license boolean;
alter table public.leads add column if not exists age smallint;
alter table public.leads add column if not exists qualified_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_age_range') then
    alter table public.leads add constraint leads_age_range check (age is null or age between 16 and 70);
  end if;
end $$;

alter table public.companies add column if not exists vehicles text[] not null default '{}';  -- empty = any vehicle
alter table public.companies add column if not exists needs_license boolean not null default false;
alter table public.companies add column if not exists min_age smallint;
alter table public.companies add column if not exists max_age smallint;

-- qualified_at is bookkeeping: keep it out of the audit diff (the fields themselves are still logged).
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ignored text[] := array['updated_at', 'callback_reminded_at', 'interview_reminded_at', 'last_contact_at', 'attempts',
                          'assigned_at', 'prev_agent_id', 'reassign_count', 'first_contact_at',
                          'campaign_name', 'ad_name', 'next_step_at', 'status_changed_at', 'status_due_at', 'qualified_at'];
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

-- form_data answers as typed values (the company form stores them as JSON booleans / numbers or text).
create or replace function public.fd_bool(p jsonb, k text)
returns boolean
language sql immutable
as $$ select case lower(coalesce(p->>k, '')) when 'true' then true when 'yes' then true when 'نعم' then true when 'false' then false when 'no' then false when 'لا' then false end $$;
create or replace function public.fd_age(p jsonb, k text)
returns smallint
language sql immutable
as $$ select case when btrim(coalesce(p->>k, '')) ~ '^\d{2}$' and (p->>k)::int between 16 and 70 then (p->>k)::smallint end $$;

-- Backfill once from the answers the company forms already collected.
update public.leads
set has_license = coalesce(has_license, public.fd_bool(form_data, 'has_license')),
    age = coalesce(age, public.fd_age(form_data, 'age'))
where (has_license is null and public.fd_bool(form_data, 'has_license') is not null)
   or (age is null and public.fd_age(form_data, 'age') is not null);

-- ───────── 2) Status rules can now ask for the licence and the age ─────────
create or replace function public.lead_rule_fields()
returns text[]
language sql immutable
as $$ select array['interview_at', 'callback_at', 'governorate_id', 'region_id', 'notes', 'reject_reason', 'vehicle', 'has_license', 'age'] $$;

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
       or (f = 'vehicle' and nullif(btrim(coalesce(new.form_data->>'vehicle', '')), '') is null)
       or (f = 'has_license' and new.has_license is null and public.fd_bool(new.form_data, 'has_license') is null)
       or (f = 'age' and new.age is null and public.fd_age(new.form_data, 'age') is null) then
      missing := missing || f;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'REQUIRED:%', array_to_string(missing, ',') using errcode = '23514';
  end if;
  return new;
end;
$$;

-- An interview needs the area and the vehicle from now on (the manager can change this in «قواعد الحالات»).
update public.lead_status_rules
set required = (select array_agg(distinct x) from unnest(required || array['governorate_id', 'vehicle']) x), updated_at = now()
where status = 'interview' and not (required @> array['governorate_id', 'vehicle']);

-- ───────── 3) Save the answers (runs as the user: RLS decides who may) ─────────
create or replace function public.qualify_lead(p_lead uuid, p_governorate smallint, p_region integer, p_vehicle text, p_has_license boolean, p_age integer)
returns void
language plpgsql set search_path = public
as $$
declare
  n integer;
begin
  if p_age is not null and (p_age < 16 or p_age > 70) then
    raise exception 'BAD_AGE' using errcode = '22023';
  end if;
  if p_region is not null and p_governorate is not null
     and not exists (select 1 from public.regions where id = p_region and governorate_id = p_governorate) then
    raise exception 'BAD_REGION' using errcode = '22023';
  end if;
  update public.leads
  set governorate_id = p_governorate,
      region_id = case when p_governorate is null then null else p_region end,
      form_data = (case
        when nullif(btrim(coalesce(p_vehicle, '')), '') is null then coalesce(form_data, '{}'::jsonb) - 'vehicle'
        else coalesce(form_data, '{}'::jsonb) || jsonb_build_object('vehicle', left(btrim(p_vehicle), 40))
      end - 'has_license' - 'age')
        || case when p_has_license is null then '{}'::jsonb else jsonb_build_object('has_license', p_has_license) end
        || case when p_age is null then '{}'::jsonb else jsonb_build_object('age', p_age) end,
      has_license = p_has_license,
      age = p_age,
      qualified_at = case when p_governorate is not null and nullif(btrim(coalesce(p_vehicle, '')), '') is not null then now() else qualified_at end
  where id = p_lead;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
end;
$$;
revoke execute on function public.qualify_lead(uuid, smallint, integer, text, boolean, integer) from anon, public;
grant execute on function public.qualify_lead(uuid, smallint, integer, text, boolean, integer) to authenticated;

-- ───────── 4) Which companies does a lead fit? ─────────
-- An unknown answer is not held against the lead; it is listed under «unknown» instead.
-- Runs as the caller, so a lead they can't see returns nothing.
create or replace function public.lead_fit(p_lead uuid)
returns jsonb
language sql stable set search_path = public
as $$
  with l as (
    select id, company_id, governorate_id, nullif(btrim(coalesce(form_data->>'vehicle', '')), '') as vehicle,
           coalesce(has_license, public.fd_bool(form_data, 'has_license')) as has_license, coalesce(age, public.fd_age(form_data, 'age')) as age
    from public.leads where id = p_lead
  ), c as (
    select c.id, c.name, c.vehicles, c.needs_license, c.min_age, c.max_age,
           array(select governorate_id from public.company_governorates g where g.company_id = c.id) as govs
    from public.companies c where c.is_active
  ), checks as (
    select c.id, c.name, (c.id = l.company_id) as own,
      array_remove(array[
        case when cardinality(c.govs) > 0 and l.governorate_id is not null and not (l.governorate_id = any (c.govs)) then 'area' end,
        case when cardinality(c.vehicles) > 0 and l.vehicle is not null and not (l.vehicle = any (c.vehicles)) then 'vehicle' end,
        case when c.needs_license and l.has_license is false then 'license' end,
        case when l.age is not null and ((c.min_age is not null and l.age < c.min_age) or (c.max_age is not null and l.age > c.max_age)) then 'age' end
      ], null) as misses,
      array_remove(array[
        case when cardinality(c.govs) > 0 and l.governorate_id is null then 'area' end,
        case when cardinality(c.vehicles) > 0 and l.vehicle is null then 'vehicle' end,
        case when c.needs_license and l.has_license is null then 'license' end,
        case when (c.min_age is not null or c.max_age is not null) and l.age is null then 'age' end
      ], null) as unknown
    from c cross join l
  )
  select coalesce(jsonb_agg(jsonb_build_object('company_id', id, 'name', name, 'own', own, 'fits', cardinality(misses) = 0,
                                               'misses', to_jsonb(misses), 'unknown', to_jsonb(unknown))
                            order by own desc, cardinality(misses), cardinality(unknown), name), '[]'::jsonb)
  from checks
$$;
revoke execute on function public.lead_fit(uuid) from anon, public;
grant execute on function public.lead_fit(uuid) to authenticated;

-- ───────── 5) Company requirements (managers) ─────────
create or replace function public.save_company_requirements(p_id uuid, p_vehicles text[], p_needs_license boolean, p_min_age integer, p_max_age integer, p_governorates smallint[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  if p_min_age is not null and (p_min_age < 16 or p_min_age > 70) then raise exception 'BAD_AGE' using errcode = '22023'; end if;
  if p_max_age is not null and (p_max_age < 16 or p_max_age > 70) then raise exception 'BAD_AGE' using errcode = '22023'; end if;
  if p_min_age is not null and p_max_age is not null and p_min_age > p_max_age then raise exception 'BAD_AGE' using errcode = '22023'; end if;
  update public.companies
  set vehicles = coalesce((select array_agg(distinct left(btrim(v), 40)) from unnest(p_vehicles) v where nullif(btrim(v), '') is not null), '{}'),
      needs_license = coalesce(p_needs_license, false),
      min_age = p_min_age,
      max_age = p_max_age
  where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_governorates is not null then
    delete from public.company_governorates where company_id = p_id and not (governorate_id = any (p_governorates));
    insert into public.company_governorates (company_id, governorate_id)
    select p_id, g from unnest(p_governorates) g
    where exists (select 1 from public.governorates where id = g)
    on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.save_company_requirements(uuid, text[], boolean, integer, integer, smallint[]) from anon, public;
grant execute on function public.save_company_requirements(uuid, text[], boolean, integer, integer, smallint[]) to authenticated;

create index if not exists leads_qualified_idx on public.leads (company_id) where qualified_at is null and status in ('new', 'no_answer', 'contacted');
