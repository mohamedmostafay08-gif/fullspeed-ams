-- Hosted projects no longer grant table access to API roles by default.
-- Signed-in users get table privileges; row level security still decides which rows they see.
-- The anon role gets nothing: every page requires a session.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant execute on function
  public.performance_report(date, date, uuid),
  public.performance_summary(date, date),
  public.lead_status_counts(timestamptz, timestamptz)
to authenticated;

grant execute on function public.pick_agent_for_company(uuid), public.lead_phone_taken(uuid, text) to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant all on tables to service_role;
