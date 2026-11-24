-- 1) Words that point to a company in a campaign or ad name (e.g. «بريد فاست»), on top of its name and code.
create table if not exists public.company_keywords (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  keyword text not null check (length(trim(keyword)) >= 2),
  created_at timestamptz not null default now()
);
create unique index if not exists company_keywords_unique on public.company_keywords (company_id, lower(trim(keyword)));
alter table public.company_keywords enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_keywords' and policyname = 'managers manage company keywords') then
    create policy "managers manage company keywords" on public.company_keywords for all to authenticated
      using (public.is_manager()) with check (public.is_manager());
  end if;
end;
$$;
grant select, insert, delete on public.company_keywords to authenticated;

-- The one active company whose name, code or keyword appears in the text; null when none or several do.
create or replace function public.company_guess(p_text text)
returns uuid
language sql stable security definer set search_path = public
as $$
  with t as (select lower(coalesce(p_text, '')) as x),
  hits as (
    select distinct c.id
      from public.companies c, t
     where c.is_active and t.x <> '' and (
           (length(trim(c.name)) >= 3 and position(lower(trim(c.name)) in t.x) > 0)
        or (length(trim(c.slug)) >= 3 and position(lower(trim(c.slug)) in t.x) > 0)
        or exists (select 1 from public.company_keywords k where k.company_id = c.id and position(lower(trim(k.keyword)) in t.x) > 0))
  )
  select case when count(*) = 1 then (array_agg(id))[1] end from hits
$$;
revoke execute on function public.company_guess(text) from anon, public;
grant execute on function public.company_guess(text) to authenticated, service_role;

-- 2) Auto-assign switch, set from «ليدز للتوزيع» (private.app_config key auto_assign_by_campaign = '1').
create or replace function public.auto_assign_on()
returns boolean
language sql stable security definer set search_path = private, public
as $$ select coalesce((select value from private.app_config where key = 'auto_assign_by_campaign'), '') = '1' $$;
revoke execute on function public.auto_assign_on() from anon, public;

-- One queued LineCRM lead → a lead of the given company (no role check: callers check).
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
  lead uuid;
  result text;
begin
  if not exists (select 1 from public.companies where id = p_company and is_active) then return 'no_company'; end if;
  select * into e from public.linecrm_events where id = p_event and status = 'queued' for update;
  if not found then return 'gone'; end if;

  d := coalesce(e.details->'data', e.details);
  full_name := left(trim(coalesce(d->>'name', '')), 120);
  phone := public.local_phone(d->>'phone');
  fields := jsonb_strip_nulls(jsonb_build_object(
    'الإعلان', nullif(d->>'ad_name', ''),
    'الحملة', nullif(d->>'campaign_name', ''),
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

create or replace function public.linecrm_assign_lead(p_event text, p_company uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  return public.linecrm_create_lead(p_event, p_company);
end;
$$;

-- 3) Several queued LineCRM leads (one campaign) → one company. Returns a count per outcome.
create or replace function public.linecrm_assign_many(p_events text[], p_company uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  ev text;
  r text;
  counts jsonb := '{}';
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  foreach ev in array coalesce(p_events, '{}') loop
    r := public.linecrm_create_lead(ev, p_company);
    counts := counts || jsonb_build_object(r, coalesce((counts->>r)::int, 0) + 1);
  end loop;
  return counts;
end;
$$;
revoke execute on function public.linecrm_assign_many(text[], uuid) from anon, public;
grant execute on function public.linecrm_assign_many(text[], uuid) to authenticated;

-- Webhook (service role): keep the full lead, queue it, and with auto-assign on send it straight to its company.
create or replace function public.linecrm_store_details(p_event text, p_details jsonb, p_error text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  d jsonb := coalesce(p_details->'data', p_details);
  ok boolean := p_error is null and public.local_phone(d->>'phone') ~ '^01[0125]\d{8}$';
  guess uuid;
  r text;
begin
  update public.linecrm_events
     set details = p_details, detail_error = p_error,
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

-- Facebook forms: an unlinked form's lead goes to the company named in its campaign or ad when auto-assign is on.
create or replace function public.meta_import_lead(p_leadgen text, p_form text, p_page text, p_lead jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  company uuid := (select company_id from public.meta_lead_forms where form_id = p_form);
begin
  if company is null and p_lead is not null and public.auto_assign_on() then
    company := public.company_guess(concat_ws(' ', p_lead->>'campaign_name', p_lead->>'ad_name'));
  end if;
  return public.meta_import_lead_for(p_leadgen, p_form, p_page, p_lead, company);
end;
$$;
revoke execute on function public.meta_import_lead(text, text, text, jsonb) from anon, public;
grant execute on function public.meta_import_lead(text, text, text, jsonb) to authenticated, service_role;
