-- Fixes from the 22 Nov audit.

-- ═════ 1. A deactivated account loses access everywhere, at once ═════
-- my_role() is null for an inactive (or missing) profile; these restrictive policies are ANDed with
-- every other policy, so an old token for a deactivated user can no longer read or write work data.
do $$
declare t text;
begin
  foreach t in array array['leads', 'lead_activities', 'call_logs', 'tasks', 'lead_documents', 'agent_companies',
                           'daily_targets', 'agent_breaks', 'notifications', 'broadcasts', 'broadcast_reads',
                           'company_announcements', 'whatsapp_templates', 'blacklist', 'geo_checkins', 'attendance']
  loop
    execute format('create policy "active users only" on public.%I as restrictive for all to authenticated
                    using ((select public.my_role()) is not null) with check ((select public.my_role()) is not null)', t);
  end loop;
end;
$$;

-- Deactivating someone signs them out of every device.
create or replace function public.end_sessions_on_deactivate()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if old.is_active and not new.is_active then
    delete from auth.sessions where user_id = new.id;
    delete from public.push_subscriptions where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.end_sessions_on_deactivate() from anon, authenticated, public;
create trigger profiles_deactivated after update of is_active on public.profiles
  for each row execute function public.end_sessions_on_deactivate();

-- ═════ 2. Lead dates can't be forged ═════
-- created_at / created_by are set once by the database; hired_at is stamped only when a lead becomes
-- hired and kept as long as it stays hired.
create or replace function public.guard_lead_update()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  if new.status = 'hired' and old.status is distinct from 'hired' then
    new.hired_at := now();
  elsif new.status = 'hired' then
    new.hired_at := old.hired_at;
  else
    new.hired_at := null;
  end if;

  if not public.is_staff() then
    if new.agent_id is distinct from old.agent_id
       or new.company_id is distinct from old.company_id
       or new.source is distinct from old.source
       or new.external_id is distinct from old.external_id then
      raise exception 'Agents cannot reassign leads';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_lead_insert()
returns trigger
language plpgsql set search_path = public
as $$
begin
  -- Signed-in users (forms, file import) get the server's clock; the CRM (service role) keeps its own.
  if auth.uid() is not null then
    new.created_at := now();
    new.created_by := auth.uid();
    new.hired_at := case when new.status = 'hired' then now() end;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_lead_insert() from anon, authenticated, public;
create trigger leads_guard_insert before insert on public.leads
  for each row execute function public.guard_lead_insert();

-- ═════ 3. Attendance only counts from the branch ═════
create or replace function public.touch_attendance()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  s public.work_settings;
  d date := public.cairo_today();
  first_time boolean;
  late_min integer;
begin
  select * into me from public.profiles where id = auth.uid() and is_active;
  if not found or me.role not in ('agent', 'team_leader') then return null; end if;
  -- Someone tied to a branch is present only once their location check passed.
  if not public.location_ok() then return null; end if;

  insert into public.attendance (user_id, day) values (me.id, d)
  on conflict (user_id, day) do update set last_seen = now()
  returning (xmax = 0) into first_time;

  if first_time then
    select * into s from public.work_settings where id = 1;
    late_min := floor(extract(epoch from (now() - (public.cairo_day_start(d) + s.shift_start))) / 60)::integer;
    if not (extract(isodow from d)::integer = any (s.off_days)) and late_min > s.grace_minutes then
      perform public.notify_once('late:' || d || ':' || me.id, array(select public.supervisors_of(me.id)), 'info',
        '⏰ ' || me.full_name || ' وصل متأخر ' || late_min || ' دقيقة', null, '/admin/attendance');
    end if;
  end if;
  return jsonb_build_object('day', d, 'first', first_time);
end;
$$;

-- ═════ 4. Lead documents: only the uploader or staff delete a file ═════
drop policy "delete lead docs" on storage.objects;
create policy "delete lead docs" on storage.objects for delete to authenticated
  using (
    bucket_id = 'lead-docs' and public.can_see_lead_object(name)
    and (public.is_staff()
         or not exists (select 1 from public.lead_documents d where d.path = name and d.uploaded_by is distinct from auth.uid()))
  );

-- ═════ 5. Tell the admin when the nightly backup didn't happen or didn't reach Drive ═════
create or replace function public.check_backup()
returns boolean
language plpgsql security definer set search_path = private, public
as $$
declare
  last_ok timestamptz := (select nullif(value, '')::timestamptz from private.app_config where key = 'last_backup_at');
  drive text := (select value from private.app_config where key = 'last_backup_drive');
  admins uuid[] := array(select id from public.profiles where role = 'admin' and is_active);
  d date := public.cairo_today();
begin
  if last_ok is null or last_ok < now() - interval '26 hours' then
    return public.notify_once('backup-missing:' || d, admins, 'info', '⚠️ النسخة الاحتياطية بتاعة امبارح متعملتش',
      'افتح «النسخ والتكاملات» واعمل نسخة دلوقتي', '/admin/integrations');
  end if;
  if drive = 'error' and exists (select 1 from private.app_config where key = 'drive_script_url' and value <> '') then
    return public.notify_once('backup-drive:' || d, admins, 'info', '⚠️ النسخة الاحتياطية موصلتش جوجل درايف',
      'النسخة اتحفظت في السيستم بس — افتح «النسخ والتكاملات»', '/admin/integrations');
  end if;
  return false;
end;
$$;
revoke execute on function public.check_backup() from anon, authenticated, public;

do $$
begin
  perform cron.schedule('check-backup', '0 3 * * *', 'select public.check_backup()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end;
$$;
