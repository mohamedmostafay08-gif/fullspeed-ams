-- A manager may switch people between team leader and agent (never to or from manager/admin);
-- deactivating an account stays the admin's call.
create or replace function public.guard_manager_profile_edit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.my_role() = 'manager' then
    if new.is_active is distinct from old.is_active then
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
