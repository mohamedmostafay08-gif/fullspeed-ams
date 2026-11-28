-- LineCRM's lead.created has no phone, and reading each lead costs API quota (spent until the 1st).
-- But the lead's first WhatsApp message (message.received, free) carries the phone, the contact
-- name and the text — and lead.created carries the same name and first_message. Matching the two
-- gives the waiting lead its phone without any API call. Also: a lead created later links the
-- WhatsApp messages that arrived before it. Additive only, safe to paste as is.

-- Finds the lead.created event this message belongs to: same name within 30 minutes before (or 5
-- after) the message, and when several share the name, the one whose first message is this text.
-- Only a single sure match is used; anything ambiguous waits for the bulk pull as before.
create or replace function public.linecrm_match_message(p_phone text, p_name text, p_text text, p_at timestamptz)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  ids text[];
  ev text;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode = '42501'; end if;
  if coalesce(p_phone, '') !~ '^01[0125]\d{8}$' or coalesce(trim(p_name), '') = '' then return null; end if;
  -- Already a lead or a waiting event with this phone: nothing to fill.
  if exists (select 1 from public.leads where phone = p_phone) then return 'known'; end if;
  if exists (select 1 from public.linecrm_events
              where type = 'lead.created' and status in ('received', 'queued')
                and public.linecrm_phone(coalesce(details->'data', details)) = p_phone) then
    return 'known';
  end if;
  select array_agg(id) into ids from public.linecrm_events
   where type = 'lead.created' and status = 'received' and verified
     and created_at between p_at - interval '30 minutes' and p_at + interval '5 minutes'
     and public.linecrm_phone(coalesce(details->'data', details, '{}'::jsonb)) is null
     and payload->'data'->>'name' = p_name;
  if coalesce(array_length(ids, 1), 0) > 1 then
    select array_agg(id) into ids from public.linecrm_events
     where id = any(ids) and payload->'data'->>'first_message' is not distinct from p_text;
  end if;
  if coalesce(array_length(ids, 1), 0) <> 1 then return null; end if;
  ev := ids[1];
  -- Same path as the bulk pull: the event gets the lead's data plus the phone, then queues or auto-assigns.
  return ev || ':' || public.linecrm_store_details(ev,
    jsonb_build_object('data', (select payload->'data' from public.linecrm_events where id = ev)
                               || jsonb_build_object('phone', p_phone, 'matched_from', 'message.received')), null);
end;
$$;
revoke execute on function public.linecrm_match_message(text, text, text, timestamptz) from anon, authenticated, public;
grant execute on function public.linecrm_match_message(text, text, text, timestamptz) to service_role;

create or replace function public.linecrm_wa_event(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  typ text := coalesce(p->>'type', p->>'event', '');
  d jsonb := coalesce(case when jsonb_typeof(p->'data') = 'object' then p->'data' end, p);
  dir text;
  v_mid text;
  v_body text;
  v_kind text;
  who text;
  ph text;
  nm text;
  ts_raw text;
  ts timestamptz := now();
  v_existing uuid;
  res jsonb;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode = '42501'; end if;
  if jsonb_typeof(d->'message') = 'object' then d := d || (d->'message'); end if;

  dir := case
    when typ = 'message.received' or lower(coalesce(d->>'direction', '')) in ('in', 'inbound', 'incoming', 'received') then 'in'
    when typ = 'message.sent' or lower(coalesce(d->>'direction', '')) in ('out', 'outbound', 'outgoing', 'sent') then 'out'
  end;
  if dir is null then return jsonb_build_object('skipped', 'not a message'); end if;

  v_mid := coalesce(d->>'wamid', d->>'wa_id', d->>'message_id', d->>'provider_message_id', d->>'id',
                  'lc:' || coalesce(p->>'id', md5(p::text)));
  v_body := coalesce(
    case when jsonb_typeof(d->'text') = 'string' then d->>'text' end,
    d->'text'->>'body', d->>'body', d->>'content', d->>'caption', d->>'file_name');
  v_kind := lower(coalesce(nullif(d->>'media_type', ''), nullif(d->'media'->>'type', ''), nullif(d->>'message_type', ''),
                case when d->>'type' in ('image', 'video', 'audio', 'document', 'sticker', 'location', 'template') then d->>'type' end,
                'text'));
  if v_kind <> 'text' then
    v_body := trim(coalesce(case v_kind when 'image' then '📷' when 'video' then '🎬' when 'audio' then '🎙️'
      when 'document' then '📎' when 'sticker' then '🙂' when 'location' then '📍' when 'template' then '📨' else '[' || v_kind || ']' end, '')
      || ' ' || coalesce(v_body, ''));
  end if;

  -- The customer's number: the sender of an incoming message, the recipient of an outgoing one.
  who := case dir
    when 'in' then coalesce(d->>'from', d->>'customer_phone', d->'customer'->>'phone', case when jsonb_typeof(d->'customer') = 'string' then d->>'customer' end,
                            d->'contact'->>'phone', d->'lead'->>'phone', d->>'phone', d->>'wa_id_from')
    else coalesce(d->>'to', d->>'customer_phone', d->'customer'->>'phone', case when jsonb_typeof(d->'customer') = 'string' then d->>'customer' end,
                  d->'contact'->>'phone', d->'lead'->>'phone', d->>'phone', d->>'recipient')
  end;
  ph := public.local_phone(who);
  if ph is null or ph !~ '^\d{8,15}$' then return jsonb_build_object('skipped', 'no phone'); end if;
  nm := coalesce(d->'contact'->>'name', d->'customer'->>'name', d->'lead'->>'name', d->>'customer_name', d->>'contact_name');

  ts_raw := coalesce(d->>'timestamp', d->>'received_at', d->>'sent_at', d->>'created_at', p->>'created_at', p->>'timestamp');
  begin
    if ts_raw ~ '^\d{10}(\.\d+)?$' then ts := to_timestamp(ts_raw::double precision);
    elsif ts_raw ~ '^\d{13}$' then ts := to_timestamp(ts_raw::double precision / 1000);
    elsif ts_raw is not null then ts := ts_raw::timestamptz;
    end if;
  exception when others then ts := now();
  end;

  if dir = 'in' then
    -- Same path as a message from Meta: lead link, conversation summary, agent notification.
    res := public.wa_receive(jsonb_build_object(
      'messages', jsonb_build_array(jsonb_build_object(
        'id', v_mid, 'from', ph, 'type', 'text', 'text', jsonb_build_object('body', coalesce(v_body, '')),
        'timestamp', floor(extract(epoch from ts))::bigint::text)),
      'contacts', case when nm is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('wa_id', ph, 'profile', jsonb_build_object('name', nm))) end));
    return jsonb_build_object('direction', 'in', 'phone', ph, 'lead_event', public.linecrm_match_message(ph, nm, v_body, ts)) || res;
  end if;

  -- Outgoing. Sent from AMS: already saved with the id LineCRM answered, or (if LineCRM answered
  -- another id) the same text to the same number in the last 10 minutes. Then only the id is kept.
  if exists (select 1 from public.wa_messages where wa_id = v_mid) then
    return jsonb_build_object('direction', 'out', 'duplicate', true);
  end if;
  select id into v_existing from public.wa_messages
   where phone = ph and direction = 'out' and sent_by is not null
     and wa_messages.body is not distinct from v_body and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if v_existing is not null then
    update public.wa_messages set wa_id = v_mid where id = v_existing and not exists (select 1 from public.wa_messages where wa_id = v_mid);
    return jsonb_build_object('direction', 'out', 'matched', v_existing);
  end if;

  -- Sent from LineCRM itself (its automation, the welcome message, or someone in its inbox).
  -- Not counted as the agent's contact (leads.last_contact_at stays as it was): nobody from the team wrote it.
  insert into public.wa_messages (wa_id, phone, lead_id, direction, kind, body, status, created_at)
  values (v_mid, ph, (select id from public.leads where phone = ph order by created_at desc limit 1),
          'out', case when v_kind = 'template' then 'template' else 'text' end, coalesce(v_body, ''), 'sent', least(ts, now()));
  insert into public.wa_threads as t (phone, lead_id, contact_name, last_message, last_direction, last_at, unread)
  values (ph, (select id from public.leads where phone = ph order by created_at desc limit 1), nm, left(coalesce(v_body, ''), 200), 'out', least(ts, now()), 0)
  on conflict (phone) do update set lead_id = coalesce(excluded.lead_id, t.lead_id), contact_name = coalesce(t.contact_name, excluded.contact_name),
    last_message = case when t.last_at is null or excluded.last_at >= t.last_at then excluded.last_message else t.last_message end,
    last_direction = case when t.last_at is null or excluded.last_at >= t.last_at then 'out' else t.last_direction end,
    last_at = greatest(t.last_at, excluded.last_at);
  return jsonb_build_object('direction', 'out', 'phone', ph, 'saved', 1);
end;
$$;
revoke execute on function public.linecrm_wa_event(jsonb) from anon, authenticated, public;
grant execute on function public.linecrm_wa_event(jsonb) to service_role;

-- A lead created after its WhatsApp messages arrived (from the queue, by hand, or the pull) gets them.
create or replace function public.wa_link_new_lead()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.wa_messages set lead_id = new.id where phone = new.phone and lead_id is null;
  update public.wa_threads set lead_id = new.id where phone = new.phone and lead_id is null;
  return null;
end;
$$;
revoke execute on function public.wa_link_new_lead() from anon, authenticated, public;
drop trigger if exists leads_link_wa on public.leads;
create trigger leads_link_wa after insert on public.leads for each row execute function public.wa_link_new_lead();

-- Messages that came in before this file: fill their waiting leads now (first message of each number).
do $$
declare
  r record;
begin
  for r in select distinct on (e.payload->'data'->>'from') e.payload->'data' as d, e.created_at
             from public.linecrm_events e
            where e.type = 'message.received' and e.status = 'chat'
            order by e.payload->'data'->>'from', e.created_at loop
    perform public.linecrm_match_message(public.local_phone(r.d->>'from'), r.d->>'contact_name',
      case when jsonb_typeof(r.d->'text') = 'string' then r.d->>'text' end, r.created_at);
  end loop;
end;
$$;
update public.wa_messages m set lead_id = l.id
  from public.leads l where m.lead_id is null and l.phone = m.phone;
update public.wa_threads t set lead_id = l.id
  from public.leads l where t.lead_id is null and l.phone = t.phone;
