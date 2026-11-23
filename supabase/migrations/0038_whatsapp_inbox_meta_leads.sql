-- WhatsApp inbox (incoming messages, replies, shared inbox) and Facebook lead-ads forms.
-- Additive only (create if not exists / create or replace), safe to paste as is.

-- ═════ 1. Phone numbers: WhatsApp sends 2010…, the system stores 010… ═════
create or replace function public.local_phone(p text)
returns text
language sql immutable set search_path = ''
as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x)
  select case
    when x ~ '^0020?1[0125]\d{8}$' then '0' || right(x, 10)
    when x ~ '^201[0125]\d{8}$' then '0' || substr(x, 3)
    when x ~ '^1[0125]\d{8}$' then '0' || x
    else x end
  from d
$$;

-- ═════ 2. Messages and conversations ═════
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique,
  phone text not null,
  lead_id uuid references public.leads(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text',
  body text,
  media_id text,
  status text,
  error text,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_phone_idx on public.wa_messages (phone, created_at desc);
create index if not exists wa_messages_lead_idx on public.wa_messages (lead_id, created_at desc);
create index if not exists wa_messages_media_idx on public.wa_messages (media_id) where media_id is not null;

create table if not exists public.wa_threads (
  phone text primary key,
  lead_id uuid references public.leads(id) on delete set null,
  contact_name text,
  last_message text,
  last_direction text,
  last_at timestamptz,
  last_inbound_at timestamptz,
  unread integer not null default 0,
  referral jsonb
);
create index if not exists wa_threads_last_idx on public.wa_threads (last_at desc);

alter table public.wa_messages enable row level security;
alter table public.wa_threads enable row level security;

-- A conversation is visible to whoever can see its lead; numbers with no lead yet to staff only.
create or replace function public.can_see_wa(p_lead uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case when p_lead is null then public.is_staff() else public.can_see_lead(p_lead) end
$$;
revoke execute on function public.can_see_wa(uuid) from anon, public;
grant execute on function public.can_see_wa(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wa_messages' and policyname = 'see wa messages') then
    create policy "see wa messages" on public.wa_messages for select to authenticated using (public.can_see_wa(lead_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'wa_threads' and policyname = 'see wa threads') then
    create policy "see wa threads" on public.wa_threads for select to authenticated using (public.can_see_wa(lead_id));
  end if;
end;
$$;
grant select on public.wa_messages, public.wa_threads to authenticated;
grant all on public.wa_messages, public.wa_threads to service_role;

do $$
begin
  alter publication supabase_realtime add table public.wa_messages;
exception when others then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.wa_threads;
exception when others then null;
end;
$$;

-- ═════ 3. Incoming WhatsApp (called by the server with the webhook payload) ═════
-- Saves each message once, links it to the newest lead with that number (or makes a new lead when
-- that's switched on), keeps the conversation summary, notifies the lead's agent, and records
-- delivery/read receipts for messages we sent.
create or replace function public.wa_receive(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  m jsonb;
  s jsonb;
  ph text;
  nm text;
  k text;
  txt text;
  med text;
  lead uuid;
  agent uuid;
  lead_name text;
  company uuid := nullif((select value from private.app_config where key = 'wa_inbox_company'), '')::uuid;
  auto_lead boolean := coalesce((select value from private.app_config where key = 'wa_auto_lead'), '') = '1';
  saved integer := 0;
  created integer := 0;
  ref jsonb;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode = '42501'; end if;

  for m in select value from jsonb_array_elements(coalesce(p->'messages', '[]')) loop
    continue when exists (select 1 from public.wa_messages where wa_id = m->>'id');
    ph := public.local_phone(m->>'from');
    nm := (select c->'profile'->>'name' from jsonb_array_elements(coalesce(p->'contacts', '[]')) c where c->>'wa_id' = m->>'from' limit 1);
    k := coalesce(m->>'type', 'text');
    med := coalesce(m->k->>'id', null);
    txt := case k
      when 'text' then m->'text'->>'body'
      when 'image' then coalesce(m->'image'->>'caption', '')
      when 'video' then coalesce(m->'video'->>'caption', '')
      when 'document' then coalesce(m->'document'->>'caption', m->'document'->>'filename', '')
      when 'audio' then ''
      when 'sticker' then ''
      when 'location' then '📍 ' || coalesce(m->'location'->>'name', '') || ' ' || coalesce(m->'location'->>'latitude', '') || ',' || coalesce(m->'location'->>'longitude', '')
      when 'button' then m->'button'->>'text'
      when 'interactive' then coalesce(m->'interactive'->'button_reply'->>'title', m->'interactive'->'list_reply'->>'title')
      when 'reaction' then m->'reaction'->>'emoji'
      when 'contacts' then '👤 ' || coalesce(m->'contacts'->0->'name'->>'formatted_name', '')
      else '[' || k || ']' end;
    ref := m->'referral';

    select l.id, l.agent_id, l.full_name into lead, agent, lead_name
    from public.leads l where l.phone = ph order by l.created_at desc limit 1;

    if lead is null and auto_lead and company is not null and ph ~ '^01[0125]\d{8}$' then
      begin
        insert into public.leads (company_id, agent_id, full_name, phone, source, notes)
        values (company, public.pick_agent_for_company(company), coalesce(nullif(nm, ''), ph), ph,
                case when ref is not null then 'facebook' else 'whatsapp' end,
                case when ref is not null then 'إعلان: ' || coalesce(ref->>'headline', ref->>'source_url', '') else 'جه من رسالة واتساب' end)
        returning id, agent_id, full_name into lead, agent, lead_name;
        created := created + 1;
      exception when others then
        lead := null;
      end;
    end if;

    insert into public.wa_messages (wa_id, phone, lead_id, direction, kind, body, media_id, status, created_at)
    values (m->>'id', ph, lead, 'in', k, txt, med, 'received',
            coalesce(to_timestamp(nullif(m->>'timestamp', '')::double precision), now()));
    saved := saved + 1;

    insert into public.wa_threads as t (phone, lead_id, contact_name, last_message, last_direction, last_at, last_inbound_at, unread, referral)
    values (ph, lead, nm, left(coalesce(nullif(txt, ''), '[' || k || ']'), 200), 'in', now(), now(), 1, ref)
    on conflict (phone) do update set
      lead_id = coalesce(excluded.lead_id, t.lead_id),
      contact_name = coalesce(excluded.contact_name, t.contact_name),
      last_message = excluded.last_message, last_direction = 'in', last_at = now(), last_inbound_at = now(),
      unread = t.unread + 1, referral = coalesce(t.referral, excluded.referral);

    -- One notification per conversation every 10 minutes, so a burst of messages doesn't spam.
    perform public.notify_once('wa:' || ph || ':' || floor(extract(epoch from now()) / 600)::bigint,
      case when agent is not null then array[agent]
           else array(select id from public.profiles where role in ('admin', 'manager') and is_active) end,
      'reminder', '💬 رسالة واتساب من ' || coalesce(lead_name, nm, ph),
      left(coalesce(nullif(txt, ''), '[' || k || ']'), 120),
      case when agent is not null then '/agent/inbox?p=' || ph else '/admin/inbox?p=' || ph end);
  end loop;

  -- Delivery receipts: only move forward (sent → delivered → read); failures always win.
  for s in select value from jsonb_array_elements(coalesce(p->'statuses', '[]')) loop
    update public.wa_messages w set
      status = s->>'status',
      error = coalesce(s->'errors'->0->>'title', w.error)
    where w.wa_id = s->>'id'
      and (s->>'status' = 'failed'
           or array_position(array['sent', 'delivered', 'read'], s->>'status') > coalesce(array_position(array['sent', 'delivered', 'read'], w.status), 0));
  end loop;

  return jsonb_build_object('saved', saved, 'leads_created', created);
end;
$$;
revoke execute on function public.wa_receive(jsonb) from anon, authenticated, public;
grant execute on function public.wa_receive(jsonb) to service_role;

-- A message sent from the system (the server calls this after WhatsApp accepted it).
create or replace function public.wa_record_out(p_phone text, p_wa_id text, p_kind text, p_body text, p_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  lead uuid := (select id from public.leads where phone = p_phone order by created_at desc limit 1);
  new_id uuid;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode = '42501'; end if;
  insert into public.wa_messages (wa_id, phone, lead_id, direction, kind, body, status, sent_by)
  values (p_wa_id, p_phone, lead, 'out', p_kind, p_body, 'sent', p_user)
  returning id into new_id;
  insert into public.wa_threads as t (phone, lead_id, last_message, last_direction, last_at, unread)
  values (p_phone, lead, left(p_body, 200), 'out', now(), 0)
  on conflict (phone) do update set lead_id = coalesce(excluded.lead_id, t.lead_id),
    last_message = excluded.last_message, last_direction = 'out', last_at = now(), unread = 0;
  if lead is not null then
    update public.leads set last_contact_at = now() where id = lead;
  end if;
  return new_id;
end;
$$;
revoke execute on function public.wa_record_out(text, text, text, text, uuid) from anon, authenticated, public;
grant execute on function public.wa_record_out(text, text, text, text, uuid) to service_role;

-- Opening a conversation marks it read (only for people who can see it).
create or replace function public.wa_mark_read(p_phone text)
returns void
language sql security definer set search_path = public
as $$
  update public.wa_threads set unread = 0 where phone = p_phone and unread > 0 and public.can_see_wa(lead_id)
$$;
revoke execute on function public.wa_mark_read(text) from anon, public;
grant execute on function public.wa_mark_read(text) to authenticated;

-- A number that wrote in before any lead existed: staff turn it into a lead for a company.
create or replace function public.wa_make_lead(p_phone text, p_company uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  lead uuid;
begin
  if not public.is_staff() then raise exception 'staff_only' using errcode = '42501'; end if;
  if p_phone !~ '^01[0125]\d{8}$' then raise exception 'bad_phone' using errcode = '22023'; end if;
  insert into public.leads (company_id, agent_id, full_name, phone, source, created_by)
  values (p_company, public.pick_agent_for_company(p_company), coalesce(nullif(trim(p_name), ''), p_phone), p_phone, 'whatsapp', auth.uid())
  returning id into lead;
  update public.wa_messages set lead_id = lead where phone = p_phone and lead_id is null;
  update public.wa_threads set lead_id = lead where phone = p_phone;
  return lead;
end;
$$;
revoke execute on function public.wa_make_lead(text, uuid, text) from anon, public;
grant execute on function public.wa_make_lead(text, uuid, text) to authenticated;

-- New leads (from any source) pick up an earlier conversation with the same number.
create or replace function public.wa_link_new_lead()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.wa_messages set lead_id = new.id where phone = new.phone and lead_id is null;
  update public.wa_threads set lead_id = new.id where phone = new.phone and lead_id is null;
  return new;
end;
$$;
revoke execute on function public.wa_link_new_lead() from anon, authenticated, public;
create or replace trigger leads_wa_link after insert on public.leads for each row execute function public.wa_link_new_lead();

-- ═════ 4. Facebook / Instagram lead-ads forms ═════
create table if not exists public.meta_lead_forms (
  form_id text primary key check (form_id ~ '^\d{5,30}$'),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);
alter table public.meta_lead_forms enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_lead_forms' and policyname = 'managers manage lead forms') then
    create policy "managers manage lead forms" on public.meta_lead_forms for all to authenticated
      using (public.is_manager()) with check (public.is_manager());
  end if;
end;
$$;
grant select, insert, update, delete on public.meta_lead_forms to authenticated;

-- Every lead Facebook tells us about, kept so a form linked later can still bring its leads in.
create table if not exists public.meta_lead_events (
  leadgen_id text primary key,
  form_id text,
  page_id text,
  payload jsonb,
  status text not null default 'pending',
  lead_id uuid references public.leads(id) on delete set null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists meta_lead_events_status_idx on public.meta_lead_events (status, created_at desc);
alter table public.meta_lead_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_lead_events' and policyname = 'managers see lead events') then
    create policy "managers see lead events" on public.meta_lead_events for select to authenticated using (public.is_manager());
  end if;
end;
$$;
grant select on public.meta_lead_events to authenticated;
grant all on public.meta_lead_events to service_role;

-- Turns one Facebook lead (Graph API "field_data") into a lead of the form's company.
create or replace function public.meta_import_lead(p_leadgen text, p_form text, p_page text, p_lead jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  company uuid := (select company_id from public.meta_lead_forms where form_id = p_form);
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
    perform public.notify_once('meta-form:' || p_form, array(select id from public.profiles where role in ('admin', 'manager') and is_active),
      'info', '⚠️ فورم إعلان فيسبوك مش مربوط بشركة', 'رقم الفورم ' || p_form || ' — اربطه من «النسخ والتكاملات» وهتدخل ليدزه', '/admin/integrations');
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
revoke execute on function public.meta_import_lead(text, text, text, jsonb) from anon, public;
grant execute on function public.meta_import_lead(text, text, text, jsonb) to authenticated, service_role;

-- After a form is linked to a company: bring in the leads that were waiting for it.
create or replace function public.meta_retry_unmapped()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  e record;
  n integer := 0;
begin
  if not public.is_manager() then raise exception 'managers_only' using errcode = '42501'; end if;
  for e in select * from public.meta_lead_events where status = 'unmapped' and payload is not null
           and form_id in (select form_id from public.meta_lead_forms) loop
    if public.meta_import_lead(e.leadgen_id, e.form_id, e.page_id, e.payload) = 'created' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.meta_retry_unmapped() from anon, public;
grant execute on function public.meta_retry_unmapped() to authenticated;
