-- LineCRM started answering HTTP 429 (too many requests): every webhook delivery read the new lead
-- and re-read 3 older ones, so each new lead cost up to 4 calls and the backlog fed itself.
-- Now the webhook reads only the new lead (and not while LineCRM is rate-limiting us),
-- and all re-reads run from the scheduler at a steady pace with a backoff.
-- Leads that failed to load because of an error are retried for 14 days instead of 3.

-- Events worth reading (again):
--   1) never read yet (the webhook skipped it during a backoff),
--   2) the last read failed (429, timeout…): retried every minute, for 14 days,
--   3) read fine but no usable phone yet: every 10 minutes, for 3 days (as before).
-- Failed / unread ones come first, oldest first, so the ones closest to expiring are saved first.
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
       or (e.detail_error is null and e.detail_checked_at < now() - interval '10 minutes' and e.created_at > now() - interval '3 days')
     )
   order by (e.detail_error is null and e.detail_checked_at is not null), e.created_at
   limit least(greatest(p_limit, 1), 20)
$$;
revoke execute on function public.linecrm_recheck_list(int) from anon, public, authenticated;
grant execute on function public.linecrm_recheck_list(int) to service_role;

-- Speeds up the list above and the lead page lookups.
create index if not exists linecrm_events_recheck_idx on public.linecrm_events (status, type, created_at);
create index if not exists linecrm_events_lead_id_idx on public.linecrm_events (lead_id);

-- Called once per recheck run (and by the webhook on a 429).
-- p_limited = true: LineCRM said 429 → pause all reads for 2 minutes; if it keeps going
-- for 15 minutes, tell the admins once a day. p_limited = false: clears the pause.
create or replace function public.linecrm_rate_state(p_limited boolean)
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  since timestamptz := nullif((select value from private.app_config where key = 'linecrm_429_since'), '')::timestamptz;
begin
  if p_limited then
    insert into private.app_config (key, value) values ('linecrm_backoff_until', (now() + interval '2 minutes')::text)
    on conflict (key) do update set value = excluded.value;
    if since is null then
      insert into private.app_config (key, value) values ('linecrm_429_since', now()::text)
      on conflict (key) do update set value = excluded.value;
    elsif since < now() - interval '15 minutes' then
      perform public.notify_once('linecrm-429:' || public.cairo_today(),
        array(select id from public.profiles where role = 'admin' and is_active), 'info',
        '⚠️ LineCRM موقف قراءة الليدز (429)',
        'LineCRM بيرفض الطلبات من ' || to_char(since at time zone 'Africa/Cairo', 'HH24:MI') || ' — السيستم بيعيد المحاولة لوحده بالراحة',
        '/admin/integrations');
    end if;
  else
    update private.app_config set value = '' where key in ('linecrm_backoff_until', 'linecrm_429_since') and value <> '';
  end if;
end;
$$;
revoke execute on function public.linecrm_rate_state(boolean) from anon, public, authenticated;
grant execute on function public.linecrm_rate_state(boolean) to service_role;

-- Every minute: ask the app to re-read a batch, only when there is work and no backoff.
create or replace function public.linecrm_recheck_tick()
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  until timestamptz := nullif((select value from private.app_config where key = 'linecrm_backoff_until'), '')::timestamptz;
begin
  if coalesce((select value from private.app_config where key = 'linecrm_api_key'), '') = '' then return; end if;
  if until is not null and until > now() then return; end if;
  if not exists (select 1 from public.linecrm_recheck_list(1)) then return; end if;
  perform public.call_app('/api/linecrm/recheck', '{}'::jsonb);
end;
$$;
revoke execute on function public.linecrm_recheck_tick() from anon, public, authenticated;

do $$
begin
  perform cron.unschedule('linecrm-recheck') where exists (select 1 from cron.job where jobname = 'linecrm-recheck');
  perform cron.schedule('linecrm-recheck', '* * * * *', 'select public.linecrm_recheck_tick()');
end;
$$;
