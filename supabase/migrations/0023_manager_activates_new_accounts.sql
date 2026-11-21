-- A manager finishes setting up an account they just created (new accounts start inactive),
-- so activating an account in its first 10 minutes is allowed. Any other change to whether an
-- account is active — deactivating, or re-activating an older one — stays the admin's call.
create or replace function public.guard_manager_profile_edit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.my_role() = 'manager' then
    if new.is_active is distinct from old.is_active
       and not (not old.is_active and new.is_active and old.created_at > now() - interval '10 minutes') then
      raise exception 'manager_cannot_deactivate' using errcode = '42501';
    end if;
    if new.role is distinct from old.role
       and not (old.role in ('agent', 'team_leader') and new.role in ('agent', 'team_leader')) then
      raise exception 'manager_cannot_change_role' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
