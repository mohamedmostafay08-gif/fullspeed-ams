-- Counts shown as badges on the menu (redesign, phase 1). One call per page load.
-- SECURITY INVOKER on purpose: every count goes through the caller's own RLS, so a team leader
-- only counts their team, an agent only their own threads and tasks, and "performance" (who can't
-- see leads or chats) gets zeros.
--   approvals  : pending leaves + hour permits + breaks of other people (+ admin requests, admin only)
--   distribute : leads waiting for a company (unlinked Facebook forms + queued LineCRM), managers only
--   wa         : WhatsApp threads with unread messages
--   tasks      : the caller's own open tasks
create or replace function public.nav_badges()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'approvals',
      (select count(*) from public.leave_requests where status = 'pending' and user_id <> auth.uid())
      + (select count(*) from public.hour_permits where status = 'pending' and user_id <> auth.uid())
      + (select count(*) from public.agent_breaks where status = 'pending' and agent_id <> auth.uid()
           and day = (now() at time zone 'Africa/Cairo')::date)
      + case when public.is_admin() then (select count(*) from public.admin_requests where status = 'pending') else 0 end,
    'distribute',
      case when public.is_manager()
        then (select count(*) from public.meta_lead_events where status = 'unmapped')
           + (select count(*) from public.linecrm_events where status = 'queued')
        else 0 end,
    'wa', (select count(*) from public.wa_threads where unread > 0),
    'tasks', (select count(*) from public.tasks where agent_id = auth.uid() and status in ('pending', 'in_progress'))
  )
$$;

revoke all on function public.nav_badges() from public, anon;
grant execute on function public.nav_badges() to authenticated;
