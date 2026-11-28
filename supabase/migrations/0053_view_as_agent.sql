-- «شوف السيستم كأجنت»: the admin opens the agent pages with one agent's data, read-only, without
-- signing out. Nothing here changes what anyone can read: the admin already sees every row through
-- RLS, and the app blocks every write while the view is on. This only records who looked, and when,
-- in the activity log.
--
-- Additive: the audit_log action check gains two values; one new function.

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'view_as_start', 'view_as_end'));

-- Admin only. Checks the target is an active agent, writes one audit row, returns the agent's name.
create or replace function public.log_view_as(p_agent uuid, p_start boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'view_as_admin_only' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_agent and role = 'agent';
  if v_name is null then
    raise exception 'view_as_not_agent' using errcode = '22023';
  end if;
  insert into public.audit_log (actor_id, actor_name, table_name, row_id, action, changes)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), 'view_as', p_agent::text,
          case when p_start then 'view_as_start' else 'view_as_end' end,
          jsonb_build_object('full_name', v_name));
  return v_name;
end;
$$;

revoke all on function public.log_view_as(uuid, boolean) from public, anon;
grant execute on function public.log_view_as(uuid, boolean) to authenticated;
