-- Phase 4: Web Push. Every new notification is forwarded (via pg_net) to the app, which
-- sends it to the user's subscribed devices. Keys live in a private table that only
-- service_role functions can read — they never pass through the browser or the repo.

create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_config (
  key text primary key,
  value text not null
);
insert into private.app_config (key, value)
values ('dispatch_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "own subscriptions read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own subscriptions add" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "own subscriptions update" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own subscriptions remove" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- Server-side config access (service_role only).
create or replace function public.push_config()
returns jsonb
language sql stable security definer set search_path = private, public
as $$ select coalesce(jsonb_object_agg(key, value), '{}') from private.app_config $$;

create or replace function public.set_push_config(p_key text, p_value text)
returns void
language sql security definer set search_path = private, public
as $$
  insert into private.app_config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
$$;

-- First writer wins (used for the VAPID key pair so concurrent cold starts agree on one pair).
create or replace function public.init_push_config(p_key text, p_value text)
returns text
language sql security definer set search_path = private, public
as $$
  insert into private.app_config (key, value) values (p_key, p_value) on conflict (key) do nothing;
  select value from private.app_config where key = p_key;
$$;

revoke execute on function public.push_config(), public.set_push_config(text, text), public.init_push_config(text, text) from public, anon, authenticated;
grant execute on function public.push_config(), public.set_push_config(text, text), public.init_push_config(text, text) to service_role;

-- Forward each notification for users that have at least one device subscribed.
create or replace function public.forward_notification_push()
returns trigger
language plpgsql security definer set search_path = private, public
as $$
declare
  v_url text := (select value from private.app_config where key = 'app_url');
  v_secret text := (select value from private.app_config where key = 'dispatch_secret');
begin
  if v_url is null or v_secret is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return new; end if;
  perform net.http_post(
    url := v_url || '/api/push/dispatch',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  return new;  -- push is best-effort; never block the notification itself
end;
$$;
revoke execute on function public.forward_notification_push() from public, anon, authenticated;

create trigger notifications_push after insert on public.notifications
  for each row execute function public.forward_notification_push();
