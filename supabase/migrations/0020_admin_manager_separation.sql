-- Separate the admin from the acquisition manager.
-- 1. Admin accounts are invisible to everyone but admins (team lists, pickers, joins).
-- 2. A manager reads only the activity log of their own edits and of team leaders/agents —
--    never the admin's, other managers', or system changes.
-- 3. A manager can add and edit team leaders/agents but can't deactivate them or change
--    their role (making an agent the leader of a team is the one exception).

-- 1 ── profiles
drop policy "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated
  using (
    (select public.is_admin())
    or id = (select auth.uid())
    or (role <> 'admin' and ((select public.sees_all()) or id = any ((select public.my_team_member_ids())::uuid[])))
  );

-- 2 ── activity log
drop policy "managers read audit" on public.audit_log;
create policy "admins read audit" on public.audit_log for select to authenticated
  using ((select public.is_admin()));
create policy "managers read team audit" on public.audit_log for select to authenticated
  using (
    (select public.my_role()) = 'manager'
    and (
      actor_id = (select auth.uid())
      or exists (select 1 from public.profiles p where p.id = audit_log.actor_id and p.role in ('team_leader', 'agent'))
    )
  );

-- 3 ── deactivation and role changes are the admin's
create or replace function public.guard_manager_profile_edit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.my_role() = 'manager' then
    if new.is_active is distinct from old.is_active then
      raise exception 'manager_cannot_deactivate' using errcode = '42501';
    end if;
    if new.role is distinct from old.role and not (old.role = 'agent' and new.role = 'team_leader') then
      raise exception 'manager_cannot_change_role' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_manager_profile_edit() from anon, authenticated, public;

create trigger guard_manager_profile_edit before update on public.profiles
  for each row execute function public.guard_manager_profile_edit();
