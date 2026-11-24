-- LineCRM leads (WhatsApp ads) wait in the distribution queue next to Facebook form leads:
-- an admin or manager picks the company for each one, then it becomes a lead here.
alter table public.linecrm_events add column if not exists lead_id uuid references public.leads(id) on delete set null;

-- Called by the webhook (service role) once the full lead was read from LineCRM.
create or replace function public.linecrm_store_details(p_event text, p_details jsonb, p_error text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  d jsonb := coalesce(p_details->'data', p_details);
  ok boolean := p_error is null and public.local_phone(d->>'phone') ~ '^01[0125]\d{8}$';
begin
  update public.linecrm_events
     set details = p_details, detail_error = p_error,
         status = case when ok and status = 'received' then 'queued' else status end
   where id = p_event;
  if ok then
    perform public.notify_once('linecrm-queue:' || public.cairo_today(), array(select id from public.profiles where role in ('admin', 'manager') and is_active),
      'info', '📥 ليدز LineCRM مستنية توزيع', 'ليدز جديدة من إعلانات الواتساب — وزّعها على الشركات من «ليدز للتوزيع»', '/admin/facebook-leads');
  end if;
  return case when ok then 'queued' else 'kept' end;
end;
$$;
revoke execute on function public.linecrm_store_details(text, jsonb, text) from anon, public, authenticated;
grant execute on function public.linecrm_store_details(text, jsonb, text) to service_role;

-- One waiting LineCRM lead → the company an admin or manager picked.
create or replace function public.linecrm_assign_lead(p_event text, p_company uuid)
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
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
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
revoke execute on function public.linecrm_assign_lead(text, uuid) from anon, public;
grant execute on function public.linecrm_assign_lead(text, uuid) to authenticated;

create or replace function public.linecrm_dismiss_lead(p_event text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  update public.linecrm_events set status = 'dismissed' where id = p_event and status = 'queued';
  return found;
end;
$$;
revoke execute on function public.linecrm_dismiss_lead(text) from anon, public;
grant execute on function public.linecrm_dismiss_lead(text) to authenticated;

-- Managers (not only admins) read the queue.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'linecrm_events' and policyname = 'managers see queued linecrm leads') then
    create policy "managers see queued linecrm leads" on public.linecrm_events for select to authenticated
      using (status = 'queued' and public.is_manager());
  end if;
end;
$$;

-- Leads that arrived before this change and already have their details.
update public.linecrm_events set status = 'queued'
 where status = 'received' and type = 'lead.created'
   and public.local_phone(coalesce(details->'data', details)->>'phone') ~ '^01[0125]\d{8}$';
