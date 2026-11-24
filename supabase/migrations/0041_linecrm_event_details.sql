-- The full LineCRM record behind a lead.created notification (the notification itself has no phone),
-- fetched with a read-only LineCRM API key and kept next to the event.
alter table public.linecrm_events add column if not exists details jsonb;
alter table public.linecrm_events add column if not exists detail_error text;
