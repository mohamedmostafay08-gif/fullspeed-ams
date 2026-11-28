-- LineCRM's 429 is a monthly quota (10,000 requests, renews on the 1st), not a short rate limit:
-- {"error":"quota_exceeded","limit":10000}. What used it up: leads whose phone WhatsApp hides
-- (EG.xxxx) were re-read every 10 minutes for 3 days, up to ~430 reads per lead.
-- 1) Leads waiting for a phone: re-read with doubling gaps (1h, 2h, 4h, 8h, 16h), for 1 day only, so about 5 reads.
-- 2) After 15 minutes of 429s, wait 30 minutes between tries instead of 2.

create or replace function public.linecrm_recheck_list(p_limit int default 5)
returns table (id text, lead_id text)
language sql stable security definer set search_path = public
as $$
  select e.id, coalesce(e.payload->'data'->>'id', e.details->'data'->>'id')
    from public.linecrm_events e
   where e.status = 'received' and e.type = 'lead.created' and e.verified
     and coalesce(e.payload->'data'->>'id', e.details->'data'->>'id') is not null
     and (
       (e.detail_checked_at is null and e.created_at < now() - interval '1 minute' and e.created_at > now() - interval '14 days')
       or (e.detail_error is not null and e.detail_checked_at < now() - interval '1 minute' and e.created_at > now() - interval '14 days')
       or (e.detail_error is null and e.created_at > now() - interval '1 day'
           and e.detail_checked_at < now() - greatest(interval '1 hour', e.detail_checked_at - e.created_at))
     )
   order by (e.detail_error is null and e.detail_checked_at is not null), e.created_at
   limit least(greatest(p_limit, 1), 20)
$$;
revoke execute on function public.linecrm_recheck_list(int) from anon, public, authenticated;
grant execute on function public.linecrm_recheck_list(int) to service_role;

create or replace function public.linecrm_rate_state(p_limited boolean)
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  since timestamptz := nullif((select value from private.app_config where key = 'linecrm_429_since'), '')::timestamptz;
  pause interval := case when since is not null and since < now() - interval '15 minutes' then interval '30 minutes' else interval '2 minutes' end;
begin
  if p_limited then
    insert into private.app_config (key, value) values ('linecrm_backoff_until', (now() + pause)::text)
    on conflict (key) do update set value = excluded.value;
    if since is null then
      insert into private.app_config (key, value) values ('linecrm_429_since', now()::text)
      on conflict (key) do update set value = excluded.value;
    elsif since < now() - interval '15 minutes' then
      perform public.notify_once('linecrm-429:' || public.cairo_today(),
        array(select id from public.profiles where role = 'admin' and is_active), 'info',
        '⚠️ LineCRM موقف قراءة الليدز (429)',
        'حصة LineCRM الشهرية خلصت أو بيرفض الطلبات من ' || to_char(since at time zone 'Africa/Cairo', 'HH24:MI') || ' — السيستم بيعيد المحاولة كل نص ساعة',
        '/admin/integrations');
    end if;
  else
    update private.app_config set value = '' where key in ('linecrm_backoff_until', 'linecrm_429_since') and value <> '';
  end if;
end;
$$;
revoke execute on function public.linecrm_rate_state(boolean) from anon, public, authenticated;
grant execute on function public.linecrm_rate_state(boolean) to service_role;
