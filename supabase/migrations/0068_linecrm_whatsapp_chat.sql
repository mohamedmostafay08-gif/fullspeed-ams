-- WhatsApp conversations through LineCRM's number.
-- LineCRM calls /api/linecrm/webhook with message.received (the lead wrote) and message.sent
-- (a message went out, from AMS or from LineCRM itself). LineCRM keeps no message text, so the
-- webhook is the only copy: each one is saved into wa_messages / wa_threads, the same tables the
-- AMS inbox and the lead page already read. Additive only, safe to paste as is.

-- LineCRM doesn't publish the message payload, so the common field names are all accepted.
-- The raw delivery stays in linecrm_events, so a field name can be added here later.
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
  v_kind := lower(coalesce(nullif(d->>'media_type', ''), nullif(d->>'message_type', ''),
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

  ts_raw := coalesce(d->>'timestamp', d->>'sent_at', d->>'created_at', p->>'created_at', p->>'timestamp');
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
    return jsonb_build_object('direction', 'in', 'phone', ph) || res;
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
