-- Shared base for stage 2+ modules: kindergarten days off, in-app notifications.

-- ───────────── Holidays & days off (SPEC §5.2: no attendance/work expected) ─────────────
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  date date not null,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default 'holiday' check (kind in ('holiday', 'day_off', 'working_day')),
  -- 'working_day' marks a Saturday/Sunday that is a working day (transferred day)
  created_at timestamptz not null default now(),
  unique (kindergarten_id, date)
);
create index holidays_kg_date_idx on public.holidays (kindergarten_id, date);

alter table public.holidays enable row level security;
create policy holidays_select on public.holidays for select to authenticated using (public.is_member(kindergarten_id));
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_admin(kindergarten_id)) with check (public.is_admin(kindergarten_id));

-- Is the kindergarten open on this date? (weekends closed unless marked 'working_day').
create or replace function public.kg_is_working_day(kg uuid, d date) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from holidays h where h.kindergarten_id = kg and h.date = d and h.kind = 'working_day') then true
    when exists (select 1 from holidays h where h.kindergarten_id = kg and h.date = d and h.kind in ('holiday', 'day_off')) then false
    else extract(isodow from d) < 6
  end
$$;
revoke execute on function public.kg_is_working_day(uuid, date) from public, anon;
grant execute on function public.kg_is_working_day(uuid, date) to authenticated, service_role;

-- ───────────── In-app notifications (bell). Push delivery is added in stage 6. ─────────────
-- Text is rendered from `type` + `params` in the reader's language (messages/<locale>/notifications.json).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid references public.kindergartens(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  params jsonb not null default '{}'::jsonb,
  url text,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Inserts only via the server (service role) after the action's own permission checks.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
