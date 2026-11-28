-- 0056 · Admin's full control over users: one-click suspend (with the open leads handed to someone else
-- or back to distribution), sign out of every device, and the same actions on many users at once.
-- Additive: three new functions. Paste into the Supabase SQL editor; the app code ships after it.
--
-- user_overview(): one row per user — last seen, live devices, open leads. Admin and manager only.
-- set_users_active(users, active, transfer_to, unassign): admin only. Suspending also ends their sessions
--   (trigger from 0027) and moves their open leads to transfer_to, or back to the unassigned pool.
-- force_sign_out_many(users): admin only. Ends every session of those users (never the caller's own).

create or replace function public.user_overview()
returns table (user_id uuid, last_seen timestamptz, sessions integer, open_leads bigint)
language sql stable security definer set search_path = public, auth
as $$
  select p.id,
    greatest(
      (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) from auth.sessions s where s.user_id = p.id),
      (select max(e.at) from public.login_events e where e.user_id = p.id and e.success)
    ),
    (select count(*)::integer from auth.sessions s where s.user_id = p.id and (s.not_after is null or s.not_after > now())),
    (select count(*) from public.leads l where l.agent_id = p.id and l.status not in ('hired', 'rejected'))
  from public.profiles p
  where public.is_manager()
$$;
revoke execute on function public.user_overview() from anon, public;
grant execute on function public.user_overview() to authenticated;

create or replace function public.set_users_active(
  p_users uuid[],
  p_active boolean,
  p_transfer_to uuid default null,
  p_unassign boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  ids uuid[];
  changed integer := 0;
  moved integer := 0;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  -- Nobody suspends themselves by accident.
  ids := array(select distinct u from unnest(coalesce(p_users, '{}')) u where u <> auth.uid());
  if coalesce(array_length(ids, 1), 0) = 0 then raise exception 'no_users' using errcode = '22023'; end if;
  if array_length(ids, 1) > 500 then raise exception 'too_many' using errcode = '22023'; end if;

  if not p_active and p_transfer_to is not null then
    if p_transfer_to = any(ids) then raise exception 'transfer_to_suspended' using errcode = '22023'; end if;
    if not exists (select 1 from public.profiles where id = p_transfer_to and is_active and role = 'agent') then
      raise exception 'transfer_to_invalid' using errcode = '22023';
    end if;
  end if;

  update public.profiles set is_active = p_active where id = any(ids) and is_active is distinct from p_active;
  get diagnostics changed = row_count;

  if not p_active and (p_transfer_to is not null or p_unassign) then
    perform set_config('app.bulk_assign', 'on', true);
    update public.leads set agent_id = p_transfer_to
    where agent_id = any(ids) and status not in ('hired', 'rejected');
    get diagnostics moved = row_count;
    perform set_config('app.bulk_assign', '', true);
    if p_transfer_to is not null and moved > 0 then
      insert into public.notifications (user_id, type, title, link)
      values (p_transfer_to, 'lead', 'اتنقل عليك ' || moved || ' ليد من زميل اتوقف', '/agent/leads');
    end if;
  end if;

  return jsonb_build_object('changed', changed, 'leads_moved', moved);
end;
$$;
revoke execute on function public.set_users_active(uuid[], boolean, uuid, boolean) from anon, public;
grant execute on function public.set_users_active(uuid[], boolean, uuid, boolean) to authenticated;

create or replace function public.force_sign_out_many(p_users uuid[])
returns integer
language plpgsql security definer set search_path = public, auth
as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  delete from auth.sessions where user_id = any(p_users) and user_id <> auth.uid();
  get diagnostics n = row_count;
  delete from public.push_subscriptions where user_id = any(p_users) and user_id <> auth.uid();
  return n;
end;
$$;
revoke execute on function public.force_sign_out_many(uuid[]) from anon, public;
grant execute on function public.force_sign_out_many(uuid[]) to authenticated;
