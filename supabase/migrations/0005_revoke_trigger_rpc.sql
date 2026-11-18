-- Trigger functions are never meant to be called through the REST API.
revoke execute on function
  public.handle_new_user(),
  public.guard_lead_update(),
  public.log_lead_status(),
  public.guard_task_update(),
  public.notify_announcement(),
  public.notify_task(),
  public.notify_assignment(),
  public.notify_lead_assigned()
from anon, authenticated, public;
