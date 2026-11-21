-- The server writes sign-in rows with the service role; give it the table and its id sequence
-- explicitly instead of relying on the project's default privileges.
grant select, insert on public.login_events to service_role;
grant usage, select on sequence public.login_events_id_seq to service_role;
