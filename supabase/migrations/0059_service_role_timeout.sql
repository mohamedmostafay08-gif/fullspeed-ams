-- 0059: give server-side calls (service role) more time than the 8 s the API applies to everyone.
-- The backup export normally takes about 1 s, but on 2026-11-28 the database was busy for a few
-- minutes and «اعمل نسخة دلوقتي» failed with "canceling statement due to statement timeout".
-- Only the app's server holds the service-role key; signed-in users keep their 8 s limit.
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
