-- New notification kind for call-back and interview reminders (separate migration:
-- an enum value can't be used in the same transaction that adds it).
alter type public.notification_type add value if not exists 'reminder';
