-- LineCRM's API quota is 10,000 requests a month, and ~1,100 leads arrive a day, so one read per lead
-- can't fit. Instead the app pulls the lead LIST in pages (one request = many leads) every 15 minutes
-- and hands each page to the database, which matches the leads to the waiting webhook events.
-- The per-lead re-read job (linecrm-recheck) is switched off; the webhook only stores the event.

-- Fast lookup of an event by LineCRM's lead id.
create index if not exists linecrm_events_lcid_idx on public.linecrm_events ((payload->'data'->>'id'));

-- One page of LineCRM's lead list (raw response text) → fills every waiting event it covers.
-- Returns {leads, matched, oldest, need_more}: need_more = this page doesn't yet reach back to the
-- oldest waiting event, so the app should read the next page.
create or replace function public.linecrm_store_bulk(p_body text)
returns jsonb
language plpgsql security definer set search_path = private, public
as $$
declare
  b jsonb;
  arr jsonb;
  l jsonb;
  e record;
  matched int := 0;
  oldest timestamptz;
  -- The oldest event the pull still has to reach: never read (or read failed) in the last 14 days,
  -- or read but still without a phone in the last 2 hours (older ones get picked up when a page covers them).
  pending timestamptz := (select min(created_at) from public.linecrm_events
                           where status = 'received' and type = 'lead.created' and verified
                             and ((created_at > now() - interval '14 days' and (details is null or detail_error is not null))
                               or (created_at > now() - interval '2 hours' and detail_error is null)));
begin
  begin
    b := p_body::jsonb;
  exception when others then
    return jsonb_build_object('error', 'not_json', 'sample', left(p_body, 200));
  end;
  arr := case when jsonb_typeof(b) = 'array' then b
              else coalesce(b->'data', b->'leads', b->'items', b->'results') end;
  if arr is null or jsonb_typeof(arr) <> 'array' then
    return jsonb_build_object('error', 'unknown_shape',
      'keys', (select jsonb_agg(k) from jsonb_object_keys(case when jsonb_typeof(b) = 'object' then b else '{}' end) k));
  end if;

  for l in select * from jsonb_array_elements(arr) loop
    if (l->>'created_at') is not null then
      oldest := least(coalesce(oldest, (l->>'created_at')::timestamptz), (l->>'created_at')::timestamptz);
    end if;
    for e in select id from public.linecrm_events
              where payload->'data'->>'id' = l->>'id' and status = 'received' and type = 'lead.created' loop
      perform public.linecrm_store_details(e.id, jsonb_build_object('data', l), null);
      matched := matched + 1;
    end loop;
  end loop;

  return jsonb_build_object('leads', jsonb_array_length(arr), 'matched', matched, 'oldest', oldest,
    'need_more', jsonb_array_length(arr) > 0 and pending is not null and oldest is not null and oldest > pending - interval '5 minutes');
end;
$$;
revoke execute on function public.linecrm_store_bulk(text) from anon, public, authenticated;
grant execute on function public.linecrm_store_bulk(text) to service_role;

-- Every 15 minutes: ask the app to pull, unless there's no key or LineCRM asked us to wait.
create or replace function public.linecrm_pull_tick()
returns void
language plpgsql security definer set search_path = private, public
as $$
declare
  until timestamptz := nullif((select value from private.app_config where key = 'linecrm_backoff_until'), '')::timestamptz;
begin
  if coalesce((select value from private.app_config where key = 'linecrm_api_key'), '') = '' then return; end if;
  if until is not null and until > now() then return; end if;
  perform public.call_app('/api/linecrm/pull', '{}'::jsonb);
end;
$$;
revoke execute on function public.linecrm_pull_tick() from anon, public, authenticated;

do $$
begin
  perform cron.unschedule('linecrm-recheck') where exists (select 1 from cron.job where jobname = 'linecrm-recheck');
  perform cron.schedule('linecrm-pull', '*/15 * * * *', 'select public.linecrm_pull_tick()');
end;
$$;
