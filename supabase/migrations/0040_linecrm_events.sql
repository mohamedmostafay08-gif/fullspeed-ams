-- LineCRM event notifications (Developers & API → إشعارات الأحداث) land here first.
-- Step one only keeps them, so the real payload shape and signature scheme can be read
-- before leads are created from them.
create table if not exists public.linecrm_events (
  id text primary key,
  type text,
  payload jsonb,
  raw text,
  signature text,
  verified boolean not null default false,
  scheme text,
  status text not null default 'received',
  created_at timestamptz not null default now()
);
create index if not exists linecrm_events_created_idx on public.linecrm_events (created_at desc);
alter table public.linecrm_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'linecrm_events' and policyname = 'admins see linecrm events') then
    create policy "admins see linecrm events" on public.linecrm_events for select to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active));
  end if;
end;
$$;
grant select on public.linecrm_events to authenticated;
grant all on public.linecrm_events to service_role;
