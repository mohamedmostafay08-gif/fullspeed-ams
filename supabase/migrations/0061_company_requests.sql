-- 0061 · Company requests: «Breadfast wants 40 motorcycles in Cairo by 10 Dec».
--   company_requests: one row per request. Hires that match it (same company, area and vehicle, hired on or after its start day)
--   count towards it. company_requests_progress() returns every request with its numbers in one call.
--   A daily morning alert tells managers about requests that are late or due within 3 days.
-- Additive only. Safe to run twice.

create table if not exists public.company_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  governorate_id smallint references public.governorates(id),         -- null = any area
  vehicle text,                                                       -- null = any vehicle
  needed integer not null check (needed between 1 and 5000),
  starts_on date not null default public.cairo_today(),               -- hires from this day count
  due_on date,
  priority smallint not null default 2 check (priority between 1 and 3), -- 1 urgent · 2 normal · 3 low
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  notes text check (char_length(notes) <= 500),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint company_requests_dates check (due_on is null or due_on >= starts_on)
);
create index if not exists company_requests_company_idx on public.company_requests (company_id, status);
create index if not exists company_requests_governorate_idx on public.company_requests (governorate_id);
create index if not exists company_requests_created_by_idx on public.company_requests (created_by);
create index if not exists leads_hired_company_idx on public.leads (company_id, hired_at) where hired_at is not null;

alter table public.company_requests enable row level security;
drop policy if exists "read company requests" on public.company_requests;
create policy "read company requests" on public.company_requests for select to authenticated using (true);
drop policy if exists "managers write company requests" on public.company_requests;
create policy "managers write company requests" on public.company_requests for all to authenticated
  using ((select public.is_manager())) with check ((select public.is_manager()));
grant select, insert, update, delete on public.company_requests to authenticated;

create or replace function public.company_requests_touch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); new.created_by := coalesce(auth.uid(), new.created_by); end if;
  if tg_op = 'UPDATE' then new.created_at := old.created_at; new.created_by := old.created_by; end if;
  new.closed_at := case when new.status = 'open' then null else coalesce(case when tg_op = 'UPDATE' then old.closed_at end, now()) end;
  return new;
end;
$$;
revoke execute on function public.company_requests_touch() from anon, authenticated, public;
drop trigger if exists company_requests_touch on public.company_requests;
create trigger company_requests_touch before insert or update on public.company_requests
  for each row execute function public.company_requests_touch();

drop trigger if exists audit_company_requests on public.company_requests;
create trigger audit_company_requests after insert or update or delete on public.company_requests
  for each row execute function public.audit_row();

-- Every request with: hired so far, in the pipe (interview / documents), what's left, days left and the daily pace needed.
-- Numbers only (no names), so every signed-in role may call it; it reads leads as the owner.
create or replace function public.company_requests_progress(p_status text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  today date := public.cairo_today();
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.status = 'open' desc, x.priority, x.due_on nulls last, x.created_at)
    from (
      select r.id, r.company_id, c.name as company, c.logo_path, r.governorate_id, g.name_ar as governorate, r.vehicle,
             r.needed, r.starts_on, r.due_on, r.priority, r.status, r.notes, r.created_at, r.closed_at,
             h.hired, p.in_pipe,
             greatest(r.needed - h.hired, 0) as remaining,
             case when r.due_on is not null then r.due_on - today end as days_left,
             case when r.due_on is not null and r.due_on >= today and r.needed > h.hired
                  then round((r.needed - h.hired)::numeric / (r.due_on - today + 1), 1) end as per_day
      from public.company_requests r
      join public.companies c on c.id = r.company_id
      left join public.governorates g on g.id = r.governorate_id
      cross join lateral (
        select count(*)::int as hired from public.leads l
        where l.company_id = r.company_id and l.hired_at >= public.cairo_day_start(r.starts_on)
          and (r.governorate_id is null or l.governorate_id = r.governorate_id)
          and (r.vehicle is null or l.form_data->>'vehicle' = r.vehicle)
      ) h
      cross join lateral (
        select count(*)::int as in_pipe from public.leads l
        where l.company_id = r.company_id and l.status in ('interview', 'documents')
          and (r.governorate_id is null or l.governorate_id = r.governorate_id)
          and (r.vehicle is null or l.form_data->>'vehicle' = r.vehicle)
      ) p
      where p_status = 'all' or r.status = p_status
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.company_requests_progress(text) from anon, public;
grant execute on function public.company_requests_progress(text) to authenticated;

-- lead_fit() from 0060, now also counting the company's open requests that match the lead (area and vehicle),
-- so the companies that need people like this one come first.
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
      (select count(*)::int from public.company_requests r
       where r.company_id = c.id and r.status = 'open'
         and (r.governorate_id is null or r.governorate_id = l.governorate_id)
         and (r.vehicle is null or r.vehicle = l.vehicle)) as requests,
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
                                               'misses', to_jsonb(misses), 'unknown', to_jsonb(unknown),
                                               'requests', requests)
                            order by own desc, cardinality(misses), requests desc, cardinality(unknown), name), '[]'::jsonb)
  from checks
$$;
revoke execute on function public.lead_fit(uuid) from anon, public;
grant execute on function public.lead_fit(uuid) to authenticated;

-- Each morning: one note to managers listing late requests and those due within 3 days that aren't filled.
create or replace function public.notify_company_requests()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  today date := public.cairo_today();
  late integer;
  soon integer;
  managers uuid[];
begin
  if public.is_day_off(today) then return 0; end if;
  select count(*) filter (where x.due_on < today), count(*) filter (where x.due_on between today and today + 3)
  into late, soon
  from public.company_requests x
  where x.status = 'open' and x.due_on is not null and x.due_on <= today + 3
    and x.needed > (select count(*) from public.leads l
                    where l.company_id = x.company_id and l.hired_at >= public.cairo_day_start(x.starts_on)
                      and (x.governorate_id is null or l.governorate_id = x.governorate_id)
                      and (x.vehicle is null or l.form_data->>'vehicle' = x.vehicle));
  if late + soon = 0 then return 0; end if;
  select array_agg(id) into managers from public.profiles where role in ('admin', 'manager') and is_active;
  if managers is null then return 0; end if;
  if public.notify_once('company-requests:' || today, managers, 'info',
       '📦 طلبات الشركات: ' || late || ' متأخر · ' || soon || ' معاده خلال 3 أيام',
       'افتح طلبات الشركات وشوف الناقص', '/admin/demand') then
    return 1;
  end if;
  return 0;
end;
$$;
revoke execute on function public.notify_company_requests() from anon, authenticated, public;

do $$
begin
  perform cron.unschedule('notify-company-requests');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('notify-company-requests', '30 7 * * *', 'select public.notify_company_requests()'); -- 9:30 Cairo (winter)
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;
