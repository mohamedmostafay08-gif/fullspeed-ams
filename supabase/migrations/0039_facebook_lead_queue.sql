-- Facebook lead-ad forms that aren't linked to a company now wait in a queue
-- («ليدز فيسبوك» page) where an admin or manager picks the company lead by lead.

-- Same import as before, with the company passed in instead of read from the form link.
create or replace function public.meta_import_lead_for(p_leadgen text, p_form text, p_page text, p_lead jsonb, p_company uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  company uuid := p_company;
  fields jsonb := '{}';
  f jsonb;
  fname text;
  fval text;
  full_name text;
  first_name text;
  last_name text;
  phone text;
  lead uuid;
  result text;
begin
  if auth.uid() is not null and not public.is_manager() then raise exception 'server_only' using errcode = '42501'; end if;

  insert into public.meta_lead_events (leadgen_id, form_id, page_id, payload)
  values (p_leadgen, p_form, p_page, p_lead)
  on conflict (leadgen_id) do update set payload = coalesce(excluded.payload, meta_lead_events.payload);
  if exists (select 1 from public.meta_lead_events where leadgen_id = p_leadgen and status in ('created', 'duplicate')) then
    return 'already';
  end if;

  -- The Graph API didn't hand over the answers (token missing or without lead access).
  if p_lead is null or p_lead->'field_data' is null then
    update public.meta_lead_events set status = 'no_access' where leadgen_id = p_leadgen;
    perform public.notify_once('meta-access:' || public.cairo_today(), array(select id from public.profiles where role = 'admin' and is_active),
      'info', '⚠️ ليد من فيسبوك مقدرناش نقرا بياناته', 'التوكن ناقص أو مالوش صلاحية leads_retrieval — راجع «النسخ والتكاملات»', '/admin/integrations');
    return 'no_access';
  end if;

  if company is null then
    update public.meta_lead_events set status = 'unmapped' where leadgen_id = p_leadgen;
    perform public.notify_once('meta-queue:' || p_form || ':' || public.cairo_today(), array(select id from public.profiles where role in ('admin', 'manager') and is_active),
      'info', '📥 ليدز فيسبوك مستنية توزيع', 'رقم الفورم ' || p_form || ' — وزّعها على الشركات من «ليدز فيسبوك»', '/admin/facebook-leads');
    return 'unmapped';
  end if;

  for f in select value from jsonb_array_elements(coalesce(p_lead->'field_data', '[]')) loop
    fname := lower(f->>'name');
    fval := array_to_string(array(select jsonb_array_elements_text(coalesce(f->'values', '[]'))), ', ');
    if fname in ('full_name', 'full name', 'الاسم', 'الاسم بالكامل') then full_name := fval;
    elsif fname = 'first_name' then first_name := fval;
    elsif fname = 'last_name' then last_name := fval;
    elsif fname in ('phone_number', 'phone', 'رقم الهاتف', 'الموبايل') then phone := public.local_phone(fval);
    elsif fval <> '' then fields := fields || jsonb_build_object(left(f->>'name', 60), left(fval, 500));
    end if;
  end loop;
  full_name := left(trim(coalesce(nullif(full_name, ''), concat_ws(' ', first_name, last_name))), 120);

  if coalesce(full_name, '') = '' or coalesce(phone, '') !~ '^01[0125]\d{8}$' then
    result := 'invalid';
  elsif public.lead_phone_taken(company, phone) then
    result := 'duplicate';
  else
    begin
      insert into public.leads (company_id, agent_id, full_name, phone, form_data, source, external_id, notes)
      values (company, public.pick_agent_for_company(company), full_name, phone, fields, 'facebook', p_leadgen,
              nullif(concat_ws(' · ', 'إعلان فيسبوك', nullif(p_lead->>'campaign_name', ''), nullif(p_lead->>'ad_name', '')), 'إعلان فيسبوك'))
      returning id into lead;
      result := 'created';
    exception
      when unique_violation then result := 'duplicate';
      when others then result := case when sqlerrm like '%BLACKLISTED%' then 'blacklisted' else 'error' end;
    end;
  end if;

  update public.meta_lead_events set status = result, lead_id = lead, error = null where leadgen_id = p_leadgen;
  return result;
end;
$$;
revoke execute on function public.meta_import_lead_for(text, text, text, jsonb, uuid) from anon, public, authenticated;

-- The webhook's entry point: a linked form decides the company, an unlinked one queues the lead.
create or replace function public.meta_import_lead(p_leadgen text, p_form text, p_page text, p_lead jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  return public.meta_import_lead_for(p_leadgen, p_form, p_page, p_lead,
    (select company_id from public.meta_lead_forms where form_id = p_form));
end;
$$;
revoke execute on function public.meta_import_lead(text, text, text, jsonb) from anon, public;
grant execute on function public.meta_import_lead(text, text, text, jsonb) to authenticated, service_role;

-- One waiting lead → the company an admin or manager picked.
create or replace function public.meta_assign_lead(p_leadgen text, p_company uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  e public.meta_lead_events;
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.companies where id = p_company and is_active) then return 'no_company'; end if;
  select * into e from public.meta_lead_events where leadgen_id = p_leadgen and status = 'unmapped' and payload is not null for update;
  if not found then return 'gone'; end if;
  return public.meta_import_lead_for(e.leadgen_id, e.form_id, e.page_id, e.payload, p_company);
end;
$$;
revoke execute on function public.meta_assign_lead(text, uuid) from anon, public;
grant execute on function public.meta_assign_lead(text, uuid) to authenticated;

-- A waiting lead nobody wants (spam, test): drop it from the queue but keep the record.
create or replace function public.meta_dismiss_lead(p_leadgen text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  update public.meta_lead_events set status = 'dismissed' where leadgen_id = p_leadgen and status = 'unmapped';
  return found;
end;
$$;
revoke execute on function public.meta_dismiss_lead(text) from anon, public;
grant execute on function public.meta_dismiss_lead(text) to authenticated;
