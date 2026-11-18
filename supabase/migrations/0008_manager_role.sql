-- Acquisition manager: manages every team and person, sees all analytics. Kept in its own
-- migration because a new enum value cannot be used in the transaction that adds it.
alter type public.user_role add value if not exists 'manager' after 'admin';
alter type public.notification_type add value if not exists 'break';
