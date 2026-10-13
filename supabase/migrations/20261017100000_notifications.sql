-- Stage 6A: notification centre, per-type preferences, Web Push subscriptions and deferred push delivery.
-- The bell rows themselves (`notifications`) come from the shared base migration; text is rendered from
-- `type` + `params` in the reader's language (DECISIONS D-013).

-- ───────────────────────────── Preferences ─────────────────────────────
-- One row per explicit choice of a user (no row = enabled). Preferences are personal and global across
-- gardens (a type means the same thing in every garden), so there is no kindergarten_id here.
-- A disabled type produces neither a bell row nor a push (lib/notify.ts).
create table public.notification_preferences (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'message.new', 'announcement.new', 'announcement.reminder', 'event.reminder', 'absence.reported',
    'attendance.not_marked', 'receipt.new', 'receipt.accepted', 'receipt.rejected', 'club.request',
    'club.spot_free', 'club.decision', 'waitlist.new', 'document.expiring', 'worktime.auto_closed')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

alter table public.notification_preferences enable row level security;
create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = auth.uid());
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_preferences_delete on public.notification_preferences for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.notification_preferences from anon;
revoke update on public.notification_preferences from authenticated;
grant update (enabled, updated_at) on public.notification_preferences to authenticated;

-- ───────────────────────────── Web Push subscriptions ─────────────────────────────
-- A browser/device of a user. Device-level, not garden-level: one subscription receives the user's pushes
-- from every garden. Written only by the server (service role) after it has checked the signed-in user and
-- the endpoint (allow-listed push services — lib/push.ts); the user can list and remove own devices.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 2048),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  user_agent text check (length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
revoke insert, update on public.push_subscriptions from authenticated;

-- ───────────────────────────── Deferred push (quiet hours) ─────────────────────────────
-- Rows whose push waits for `deliver_after` (garden quiet hours) are sent by /api/cron/push-deferred.
-- `pushed_at` marks a row as handled (sent or skipped), so repeated or overlapping runs never send twice.
create index notifications_deferred_idx on public.notifications (deliver_after)
  where pushed_at is null and deliver_after is not null;

-- delete_chat_message() finds the bell rows of a removed chat message by its id.
create index notifications_message_idx on public.notifications ((params->>'message_id')) where type = 'message.new';

-- Claims due deferred rows atomically (service role only): marks them pushed and returns them.
create or replace function public.claim_deferred_pushes(p_limit int default 500)
  returns setof public.notifications
  language sql volatile security definer set search_path = public as $$
  update notifications n set pushed_at = now()
  where n.id in (
    select id from notifications
    where pushed_at is null and deliver_after is not null and deliver_after <= now()
    order by deliver_after
    limit greatest(1, least(p_limit, 2000))
    for update skip locked
  )
  returning n.*
$$;
revoke execute on function public.claim_deferred_pushes(int) from public, anon, authenticated;
grant execute on function public.claim_deferred_pushes(int) to service_role;

-- ───────────────────────────── Realtime ─────────────────────────────
-- The header bell and the centre update live. Rows are never deleted by the app (Realtime does not filter
-- DELETE events by RLS), only inserted and marked read.
alter publication supabase_realtime add table public.notifications;
