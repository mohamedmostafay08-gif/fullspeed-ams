-- Phase 2: call-backs, interviews, call attempts, WhatsApp templates, blacklist, documents, reminders.

-- ───────── Lead scheduling fields ─────────
alter table public.leads
  add column callback_at timestamptz,
  add column interview_at timestamptz,
  add column interview_place text,
  add column attempts integer not null default 0,
  add column last_contact_at timestamptz,
  add column callback_reminded_at timestamptz,
  add column interview_reminded_at timestamptz;

create index leads_agent_callback_idx on public.leads (agent_id, callback_at) where callback_at is not null;
create index leads_agent_interview_idx on public.leads (agent_id, interview_at) where interview_at is not null;

-- Moving a call-back or interview re-arms its reminder.
create or replace function public.rearm_lead_reminders()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.callback_at is distinct from old.callback_at then new.callback_reminded_at := null; end if;
  if new.interview_at is distinct from old.interview_at then new.interview_reminded_at := null; end if;
  return new;
end;
$$;
create trigger leads_rearm before update of callback_at, interview_at on public.leads
  for each row execute function public.rearm_lead_reminders();

create or replace function public.can_see_lead(p_lead uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead and (public.can_see_agent(l.agent_id) or (l.agent_id is null and public.is_staff()))
  )
$$;

-- Free-text entries in a lead's history (call outcome, WhatsApp sent, document uploaded …).
create or replace function public.log_lead_note(p_lead uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_see_lead(p_lead) then raise exception 'FORBIDDEN'; end if;
  insert into public.lead_activities (lead_id, actor_id, note) values (p_lead, auth.uid(), left(p_note, 500));
end;
$$;

-- ───────── WhatsApp templates ─────────
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  company_id uuid references public.companies(id) on delete cascade,
  sort integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_templates enable row level security;
create policy "read templates" on public.whatsapp_templates for select to authenticated using (true);
create policy "staff add templates" on public.whatsapp_templates for insert to authenticated with check (public.is_staff());
create policy "staff edit templates" on public.whatsapp_templates for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete templates" on public.whatsapp_templates for delete to authenticated using (public.is_staff());

insert into public.whatsapp_templates (title, body, sort) values
  ('أول تواصل', 'أهلاً {الاسم} 👋 معاك {الأجنت} من Full Speed. شفنا إنك قدّمت على شغل كابتن مع {الشركة} — ينفع نكلمك دلوقتي ونشرحلك التفاصيل؟', 1),
  ('مردش على المكالمة', 'أهلاً {الاسم}، حاولت أكلمك بخصوص شغل الكابتن مع {الشركة} ومعرفتش أوصلك. ابعتلي الوقت المناسب وأنا أكلمك 🙏', 2),
  ('تأكيد المقابلة', 'أهلاً {الاسم} ✅ ميعاد مقابلتك مع {الشركة}: {ميعاد_المقابلة} في {مكان_المقابلة}. متنساش البطاقة والرخصة. لو في أي حاجة كلمني — {الأجنت}', 3),
  ('الأوراق المطلوبة', 'أهلاً {الاسم}، عشان نكمّل تعيينك مع {الشركة} محتاجين: صورة البطاقة (وش وضهر)، الرخصة، رخصة المركبة، وصورة شخصية. تقدر تبعتهم هنا على الواتساب.', 4);

-- ───────── Blacklist ─────────
create table public.blacklist (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  full_name text,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.blacklist enable row level security;
create policy "staff read blacklist" on public.blacklist for select to authenticated using (public.is_staff());
create policy "staff add blacklist" on public.blacklist for insert to authenticated with check (public.is_staff());
create policy "staff remove blacklist" on public.blacklist for delete to authenticated using (public.is_staff());

-- Anyone signed in may ask about one number (agents can't list the blacklist).
create or replace function public.blacklist_reason(p_phone text)
returns text
language sql stable security definer set search_path = public
as $$ select reason from public.blacklist where phone = p_phone $$;

-- No new lead with a blacklisted number, whatever the channel (form, import, CRM).
create or replace function public.block_blacklisted_lead()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.blacklist b where b.phone = new.phone) then
    raise exception 'BLACKLISTED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger leads_blacklist before insert on public.leads
  for each row execute function public.block_blacklisted_lead();

-- ───────── Lead documents ─────────
create table public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null default 'other' check (kind in ('id_front', 'id_back', 'license', 'vehicle_license', 'photo', 'criminal_record', 'other')),
  path text not null unique,
  file_name text,
  mime text,
  size integer,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.lead_documents (lead_id, created_at desc);
alter table public.lead_documents enable row level security;
create policy "read lead documents" on public.lead_documents for select to authenticated using (public.can_see_lead(lead_id));
create policy "add lead documents" on public.lead_documents for insert to authenticated
  with check (public.can_see_lead(lead_id) and uploaded_by = auth.uid());
create policy "remove lead documents" on public.lead_documents for delete to authenticated
  using (public.can_see_lead(lead_id) and (public.is_staff() or uploaded_by = auth.uid()));

-- Private bucket; objects live under "<lead id>/…".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-docs', 'lead-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.can_see_lead_object(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  return public.can_see_lead(split_part(p_name, '/', 1)::uuid);
exception when others then
  return false;
end;
$$;

create policy "read lead docs" on storage.objects for select to authenticated
  using (bucket_id = 'lead-docs' and public.can_see_lead_object(name));
create policy "upload lead docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-docs' and public.can_see_lead_object(name));
create policy "delete lead docs" on storage.objects for delete to authenticated
  using (bucket_id = 'lead-docs' and public.can_see_lead_object(name));

-- ───────── Reminders ─────────
-- Call-backs notify when due; interviews notify one hour ahead. Idempotent: safe to call often.
create or replace function public.fire_due_reminders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer := 0;
  m integer;
begin
  with due as (
    update public.leads l set callback_reminded_at = now()
    where l.callback_at <= now() and l.callback_reminded_at is null and l.agent_id is not null
      and l.status not in ('hired', 'rejected')
    returning l.id, l.agent_id, l.company_id, l.full_name, l.phone
  )
  insert into public.notifications (user_id, company_id, type, title, body, link)
  select d.agent_id, d.company_id, 'reminder', 'معاد مكالمة: ' || d.full_name, d.phone, '/agent/leads/' || d.id from due d;
  get diagnostics m = row_count; n := n + m;

  with soon as (
    update public.leads l set interview_reminded_at = now()
    where l.interview_at <= now() + interval '1 hour' and l.interview_at > now() - interval '1 hour'
      and l.interview_reminded_at is null and l.agent_id is not null and l.status = 'interview'
    returning l.id, l.agent_id, l.company_id, l.full_name, l.interview_at, l.interview_place
  )
  insert into public.notifications (user_id, company_id, type, title, body, link)
  select s.agent_id, s.company_id, 'reminder', 'مقابلة قربت: ' || s.full_name,
         to_char(s.interview_at at time zone 'Africa/Cairo', 'HH24:MI') || coalesce(' · ' || s.interview_place, ''),
         '/agent/leads/' || s.id
  from soon s;
  get diagnostics m = row_count; n := n + m;
  return n;
end;
$$;

-- Run every minute where pg_cron exists; the app also calls it as a fallback.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('fire-due-reminders', '* * * * *', 'select public.fire_due_reminders()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;

-- ───────── Grants ─────────
grant select, insert, update, delete on public.whatsapp_templates, public.blacklist, public.lead_documents to authenticated;
grant all on public.whatsapp_templates, public.blacklist, public.lead_documents to service_role;
revoke execute on function public.can_see_lead(uuid), public.log_lead_note(uuid, text), public.blacklist_reason(text),
  public.fire_due_reminders(), public.can_see_lead_object(text) from anon, public;
grant execute on function public.can_see_lead(uuid), public.log_lead_note(uuid, text), public.blacklist_reason(text),
  public.fire_due_reminders(), public.can_see_lead_object(text) to authenticated;

alter publication supabase_realtime add table public.lead_documents;
