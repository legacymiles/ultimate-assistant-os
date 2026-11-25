-- 24/7 Queue chat: reference pictures and the model that answered.
--
-- attachments  [{ key, name }] — pictures the owner attached to a message,
--              stored in the private `queue-247` bucket under refs/<uid>/…
-- model        the model id that wrote a Jarvis reply ("" / null = offline)
alter table public.queue_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.queue_messages add column if not exists model text;
