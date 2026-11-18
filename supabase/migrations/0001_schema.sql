-- Full Speed AMS — core schema

create type public.user_role as enum ('admin', 'team_leader', 'agent');
create type public.lead_status as enum ('new', 'no_answer', 'contacted', 'interview', 'documents', 'hired', 'rejected');
create type public.task_status as enum ('pending', 'in_progress', 'done', 'cancelled');
create type public.task_priority as enum ('low', 'medium', 'high');
create type public.notification_type as enum ('bonus', 'rate', 'task', 'assignment', 'lead', 'info');

-- ───────── Geography ─────────
create table public.governorates (
  id smallint primary key,
  name_ar text not null unique,
  name_en text not null unique
);

create table public.regions (
  id serial primary key,
  governorate_id smallint not null references public.governorates(id) on delete cascade,
  name_ar text not null,
  name_en text,
  unique (governorate_id, name_ar)
);
create index on public.regions (governorate_id);

-- ───────── People ─────────
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  leader_id uuid,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role public.user_role not null default 'agent',
  team_id uuid references public.teams(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.profiles (team_id);

alter table public.teams
  add constraint teams_leader_fk foreign key (leader_id) references public.profiles(id) on delete set null;

-- ───────── Companies ─────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  logo_path text,
  description text,
  -- [{ "key": "vehicle", "label": "نوع المركبة", "type": "select", "required": true, "options": ["موتوسيكل","عربية"] }]
  form_schema jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint form_schema_is_array check (jsonb_typeof(form_schema) = 'array')
);

-- Areas where a company is currently hiring
create table public.company_governorates (
  company_id uuid not null references public.companies(id) on delete cascade,
  governorate_id smallint not null references public.governorates(id) on delete cascade,
  primary key (company_id, governorate_id)
);

-- Rates (تعريفة) and bonuses announced per company
create table public.company_announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type public.notification_type not null default 'bonus' check (type in ('bonus', 'rate', 'info')),
  title text not null,
  body text,
  amount numeric(10, 2),
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.company_announcements (company_id, created_at desc);

create table public.agent_companies (
  agent_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (agent_id, company_id)
);
create index on public.agent_companies (company_id);

-- ───────── Leads (applicants) ─────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  agent_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  phone text not null,
  governorate_id smallint references public.governorates(id),
  region_id integer references public.regions(id),
  form_data jsonb not null default '{}'::jsonb,
  status public.lead_status not null default 'new',
  notes text,
  source text not null default 'manual',
  external_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  hired_at timestamptz,
  unique (source, external_id)
);
create index on public.leads (agent_id, created_at desc);
create index on public.leads (company_id, created_at desc);
create index on public.leads (status);
create index on public.leads (phone);

create table public.lead_activities (
  id bigserial primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  from_status public.lead_status,
  to_status public.lead_status,
  note text,
  created_at timestamptz not null default now()
);
create index on public.lead_activities (lead_id, created_at desc);

-- ───────── Tasks & targets ─────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  due_date date,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.tasks (agent_id, status);

create table public.daily_targets (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  date date not null,
  target_leads integer not null default 0 check (target_leads >= 0),
  target_hired integer not null default 0 check (target_hired >= 0),
  unique (agent_id, company_id, date)
);

-- ───────── Notifications ─────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  type public.notification_type not null default 'info',
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, is_read, created_at desc);
