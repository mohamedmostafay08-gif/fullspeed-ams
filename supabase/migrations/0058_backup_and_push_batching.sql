-- 0058: Google Drive backup that reports its real result, and one push per person per batch.
-- Additive: replaces three functions, adds two, swaps the push trigger. Safe to run twice.

-- ═════ 1. «اعمل نسخة دلوقتي» could not reach Drive ═════
-- The button calls backup_to_drive() with the service-role key, which never had EXECUTE on it
-- ("permission denied for function backup_to_drive").
grant execute on function public.backup_to_drive() to service_role;

-- ═════ 2. Keep Google's answer before pg_net forgets it ═════
-- pg_net keeps responses for 6 hours only, so by daytime the page showed no Drive status at all
-- and the real error was lost. This copies the answer for the latest request into app_config.
create or replace function public.drive_backup_capture()
returns jsonb
language plpgsql security definer set search_path = private, public
as $$
declare
  req bigint := (select nullif(value, '')::bigint from private.app_config where key = 'drive_backup_request');
  sent_at timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'drive_backup_at');
  prev jsonb := (select nullif(value, '')::jsonb from private.app_config where key = 'drive_backup_result');
  res jsonb;
begin
  if req is null then return prev; end if;
  if prev is not null and (prev->>'req')::bigint = req then return prev; end if;
  select jsonb_build_object(
           'req', r.id,
           'code', r.status_code,
           'ok', coalesce(r.status_code in (200, 302), false),
           'error', case when r.timed_out then 'timeout: ' || coalesce(r.error_msg, '') else r.error_msg end,
           'body', left(coalesce(r.content, ''), 300),
           'at', r.created)
    into res
    from net._http_response r where r.id = req;
  if res is null then
    -- No answer yet: still running, or pg_net already dropped it.
    if sent_at is null or sent_at > now() - interval '6 hours' then return prev; end if;
    res := jsonb_build_object('req', req, 'code', null, 'ok', false, 'error', 'no_response', 'body', '', 'at', now());
  end if;
  insert into private.app_config (key, value) values ('drive_backup_result', res::text)
  on conflict (key) do update set value = excluded.value;
  return res;
end;
$$;
revoke execute on function public.drive_backup_capture() from anon, authenticated, public;
grant execute on function public.drive_backup_capture() to service_role;

-- Morning check reads the kept answer instead of a response that may be gone.
create or replace function public.check_backup()
returns boolean
language plpgsql security definer set search_path = private, public
as $$
declare
  last_ok timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'last_backup_at');
  drive_at timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'drive_backup_at');
  has_drive boolean := exists (select 1 from private.app_config where key = 'drive_script_url' and value <> '');
  res jsonb;
  admins uuid[] := array(select id from public.profiles where role = 'admin' and is_active);
  d date := public.cairo_today();
begin
  if last_ok is null or last_ok < now() - interval '26 hours' then
    return public.notify_once('backup-missing:' || d, admins, 'info', '⚠️ النسخة الاحتياطية بتاعة امبارح متعملتش',
      'افتح «النسخ والتكاملات» واعمل نسخة دلوقتي', '/admin/integrations');
  end if;
  if has_drive then
    res := public.drive_backup_capture();
    if drive_at is null or drive_at < now() - interval '26 hours' or res is null or not coalesce((res->>'ok')::boolean, false) then
      return public.notify_once('backup-drive:' || d, admins, 'info', '⚠️ النسخة الاحتياطية موصلتش جوجل درايف',
        'النسخة اتحفظت في السيستم بس — افتح «النسخ والتكاملات»', '/admin/integrations');
    end if;
  end if;
  return false;
end;
$$;
revoke execute on function public.check_backup() from anon, authenticated, public;

-- The integrations page shows the kept answer (status + Google's error text).
create or replace function public.admin_usage()
returns jsonb
language sql stable security definer set search_path = public, storage, private
as $$
  select case when public.is_admin() then jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'files', (select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('bytes', bytes, 'count', n)), '{}')
              from (select bucket_id, sum(coalesce((metadata ->> 'size')::bigint, 0)) bytes, count(*) n from storage.objects group by 1) s),
    'leads', (select count(*) from public.leads),
    'people', (select count(*) from public.profiles where is_active),
    'last_backup_at', (select value from private.app_config where key = 'last_backup_at'),
    'drive_backup_at', (select value from private.app_config where key = 'drive_backup_at'),
    'drive_status', coalesce(
      (select r.status_code from net._http_response r
        where r.id = (select nullif(value, '')::bigint from private.app_config where key = 'drive_backup_request')),
      (select (nullif(value, '')::jsonb ->> 'code')::int from private.app_config where key = 'drive_backup_result'
        and (nullif(value, '')::jsonb ->> 'req') = (select value from private.app_config where key = 'drive_backup_request'))),
    'drive_error', (select nullif(coalesce(nullif(j->>'error', ''), case when not coalesce((j->>'ok')::boolean, true) then nullif(j->>'body', '') end), '')
                    from (select nullif(value, '')::jsonb j from private.app_config where key = 'drive_backup_result') x
                    where j->>'req' = (select value from private.app_config where key = 'drive_backup_request'))
  ) end
$$;

do $$
begin
  perform cron.unschedule('drive-backup-capture') where exists (select 1 from cron.job where jobname = 'drive-backup-capture');
  perform cron.schedule('drive-backup-capture', '*/10 * * * *', 'select public.drive_backup_capture()');
end;
$$;

-- ═════ 3. One push per person per batch ═════
-- Bulk actions (distribution, delay alerts, rebalance) insert many notifications in one statement.
-- The row trigger made one HTTP call per row: dozens at the same second, which timed out and
-- buzzed phones over and over. Now one call per person per statement, with how many arrived;
-- the app shows the newest one and "+N more".
create or replace function public.forward_notification_push_batch()
returns trigger
language plpgsql security definer set search_path = private, public
as $$
declare
  v_url text := (select value from private.app_config where key = 'app_url');
  v_secret text := (select value from private.app_config where key = 'dispatch_secret');
  r record;
begin
  if v_url is null or v_secret is null then return null; end if;
  for r in
    select n.user_id,
           (array_agg(n.id order by n.created_at desc, (n.type::text in ('bonus', 'rate', 'reminder', 'lead', 'assignment')) desc))[1] as last_id,
           count(*) as cnt
      from new_rows n
     where exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
     group by n.user_id
  loop
    perform net.http_post(
      url := v_url || '/api/push/dispatch',
      body := jsonb_build_object('id', r.last_id, 'count', r.cnt),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
      timeout_milliseconds := 10000
    );
  end loop;
  return null;
exception when others then
  return null;  -- push is best-effort; never block the notification itself
end;
$$;
revoke execute on function public.forward_notification_push_batch() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function public.forward_notification_push_batch();
