-- 0066: send the small gzipped backup to Google Drive instead of the raw JSON.
-- Since 2026-11-25 no backup reached Drive: the raw export grew to ~9 MB (≈12 MB as base64)
-- and Apps Script could not take it within 120 s (pg_net: "Timeout of 120000 ms reached").
-- The app already makes a gzipped copy (~0.6 MB); now it hands those bytes to the database,
-- which posts them to the same Apps Script (no change needed there: it already base64-decodes
-- the data and saves it as application/gzip).

create or replace function public.drive_backup_send(p_name text, p_data text)
returns bigint
language plpgsql security definer set search_path = private, public
as $$
declare
  url text := (select value from private.app_config where key = 'drive_script_url');
  secret text := (select value from private.app_config where key = 'drive_secret');
  req bigint;
begin
  if coalesce(url, '') = '' or coalesce(secret, '') = '' then return null; end if;
  if coalesce(p_name, '') !~ '^[\w.-]{1,100}$' or coalesce(p_data, '') = '' then
    raise exception 'bad_backup_payload' using errcode = '22023';
  end if;
  select net.http_post(
    url := url,
    body := jsonb_build_object('secret', secret, 'name', p_name, 'data', p_data),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  ) into req;
  insert into private.app_config (key, value) values ('drive_backup_request', req::text), ('drive_backup_at', now()::text)
  on conflict (key) do update set value = excluded.value;
  return req;
end;
$$;
revoke execute on function public.drive_backup_send(text, text) from anon, authenticated, public;
grant execute on function public.drive_backup_send(text, text) to service_role;

-- The nightly app backup (daily-backup, 01:05 UTC) now sends to Drive itself,
-- so the old raw-JSON job is no longer needed.
do $$
begin
  perform cron.unschedule('backup-to-drive') where exists (select 1 from cron.job where jobname = 'backup-to-drive');
end;
$$;
