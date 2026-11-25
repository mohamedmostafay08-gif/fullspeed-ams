-- Everything LineCRM knows about a lead goes onto it. What the agent needs (ad, campaign, city,
-- e-mail, interest, screening answers, first message) is shown to everyone; LineCRM's own bookkeeping
-- (its owner, stage, score, tags, id) is kept under keys starting with "_", shown to admins only.
-- Lead notes no longer mention LineCRM.

create or replace function public.linecrm_lead_fields(d jsonb)
returns jsonb
language sql immutable set search_path = public
as $$
  select
    -- Screening answers and other LineCRM custom fields (minus its own ids and the phone, kept on the lead).
    coalesce((select jsonb_object_agg(left(k, 60), left(v, 500))
                from jsonb_each_text(case when jsonb_typeof(d->'custom_fields') = 'object' then d->'custom_fields' else '{}' end) as x(k, v)
               where k not in ('channel_account_id', 'رقم الموبايل', 'phone') and coalesce(v, '') <> ''), '{}')
    || jsonb_strip_nulls(jsonb_build_object(
      'الإعلان', nullif(d->>'ad_name', ''),
      'الحملة', nullif(d->>'campaign_name', ''),
      'المدينة', nullif(d->>'city', ''),
      'الإيميل', nullif(d->>'email', ''),
      'مهتم بـ', nullif(d->>'interest', ''),
      'الميزانية', nullif(d->>'budget', ''),
      'الشركة اللي ذكرها', nullif(d->>'company_name', ''),
      'أول رسالة', nullif(left(regexp_replace(coalesce(d->>'notes', ''), '^[a-z]+:\s*', ''), 500), ''),
      '_المسؤول في LineCRM', nullif(d->>'owner_name', ''),
      '_إيميل المسؤول في LineCRM', nullif(d->>'owner_email', ''),
      '_المرحلة في LineCRM', nullif(d->>'stage', ''),
      '_التقييم في LineCRM', nullif(d->>'score', ''),
      '_التاجز في LineCRM', nullif((select string_agg(t, '، ') from jsonb_array_elements_text(case when jsonb_typeof(d->'tags') = 'array' then d->'tags' else '[]' end) t), ''),
      '_القناة', nullif(d->>'source', ''),
      '_رقم الليد في LineCRM', nullif(d->>'id', '')))
$$;

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
  phone := public.linecrm_phone(d);
  fields := public.linecrm_lead_fields(d);

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
              nullif(concat_ws(' · ', nullif(d->>'campaign_name', ''), nullif(d->>'ad_name', '')), ''))
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


-- Leads already made from LineCRM: same fields, notes without «LineCRM».
update public.leads l
   set form_data = (l.form_data - 'المسؤول في LineCRM') || public.linecrm_lead_fields(coalesce(e.details->'data', e.details)),
       notes = nullif(regexp_replace(coalesce(l.notes, ''), '^LineCRM( · )?', ''), '')
  from public.linecrm_events e
 where e.lead_id = l.id and e.details is not null;
update public.leads
   set notes = nullif(regexp_replace(notes, '^LineCRM( · )?', ''), '')
 where external_id like 'linecrm:%' and notes like 'LineCRM%';
