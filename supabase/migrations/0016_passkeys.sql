-- Fingerprint / Face ID sign-in (WebAuthn passkeys). The biometric never leaves the device;
-- we only store each device's public key. Writes go through the server (service role).
create table public.passkeys (
  id text primary key,                         -- credential id (base64url)
  user_id uuid not null references public.profiles(id) on delete cascade,
  public_key text not null,                    -- COSE public key (base64url)
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.passkeys (user_id);
alter table public.passkeys enable row level security;
create policy "own passkeys read" on public.passkeys for select to authenticated using (user_id = auth.uid());
create policy "own passkeys remove" on public.passkeys for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.passkeys to authenticated;
grant all on public.passkeys to service_role;

-- One-time challenges (5 minutes); only the server touches them.
create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  user_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('register', 'login')),
  created_at timestamptz not null default now()
);
alter table public.webauthn_challenges enable row level security;
revoke all on public.webauthn_challenges from anon, authenticated;
grant all on public.webauthn_challenges to service_role;

create trigger audit_passkeys after insert or delete on public.passkeys for each row execute function public.audit_row();
