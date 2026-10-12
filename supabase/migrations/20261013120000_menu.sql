-- Module 2C: daily menu (SPEC §5.4). Cook/head/owner edit, every member of the kindergarten reads.

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  date date not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (kindergarten_id, date)
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus(id) on delete cascade,
  kindergarten_id uuid not null references public.kindergartens(id) on delete cascade,
  -- Same keys as kindergarten_settings.meals.
  meal text not null check (meal in ('breakfast', 'second_breakfast', 'lunch', 'snack', 'dinner')),
  dish text not null check (length(trim(dish)) between 1 and 200),
  -- "Состав одной строкой": no line breaks.
  composition text check (composition is null or (length(composition) <= 500 and composition !~ '[\r\n]')),
  position int not null default 0 check (position between 0 and 99),
  created_at timestamptz not null default now()
);
create index menu_items_menu_idx on public.menu_items (menu_id, meal, position);
create index menu_items_kg_idx on public.menu_items (kindergarten_id);

-- Who changed the day and when (set on every write by a signed-in user).
create or replace function public.tg_menus_touch() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger menus_touch before insert or update on public.menus
  for each row execute function public.tg_menus_touch();

-- A menu item must belong to a menu of the same kindergarten.
create or replace function public.tg_same_kg_menu_item() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select kindergarten_id from menus where id = new.menu_id) is distinct from new.kindergarten_id then
    raise exception 'kindergarten mismatch' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger menu_items_same_kg before insert or update on public.menu_items
  for each row execute function public.tg_same_kg_menu_item();

-- ───────────── RLS (SPEC §3.4 «Меню»: owner/head/cook full, other members view) ─────────────
alter table public.menus enable row level security;
alter table public.menu_items enable row level security;

create policy menus_select on public.menus for select to authenticated
  using (public.is_member(kindergarten_id));
create policy menus_insert on public.menus for insert to authenticated
  with check (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));
create policy menus_update on public.menus for update to authenticated
  using (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]))
  with check (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));
create policy menus_delete on public.menus for delete to authenticated
  using (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));

create policy menu_items_select on public.menu_items for select to authenticated
  using (public.is_member(kindergarten_id));
create policy menu_items_insert on public.menu_items for insert to authenticated
  with check (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));
create policy menu_items_update on public.menu_items for update to authenticated
  using (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]))
  with check (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));
create policy menu_items_delete on public.menu_items for delete to authenticated
  using (public.has_role(kindergarten_id, array['owner','head','cook']::public.app_role[]));

-- The kindergarten / date of a row never moves.
revoke update on public.menus from authenticated;
grant update (updated_at) on public.menus to authenticated;

-- ───────────── Save a whole day in one transaction ─────────────
-- p_items: [{ "meal": "breakfast", "dish": "Каша", "composition": "овсянка, молоко" }, ...] in display order.
-- An empty array clears the day. Runs as the caller (security invoker), so RLS decides.
create or replace function public.save_menu(p_kg uuid, p_date date, p_items jsonb) returns uuid
  language plpgsql security invoker set search_path = public as $$
declare m uuid;
begin
  if not public.has_role(p_kg, array['owner','head','cook']::public.app_role[]) then
    raise exception 'hs:forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'hs:invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    delete from menus where kindergarten_id = p_kg and date = p_date;
    return null;
  end if;
  insert into menus (kindergarten_id, date) values (p_kg, p_date)
    on conflict (kindergarten_id, date) do update set updated_at = now()
    returning id into m;
  delete from menu_items where menu_id = m;
  insert into menu_items (menu_id, kindergarten_id, meal, dish, composition, position)
  select m, p_kg, e.v->>'meal', trim(e.v->>'dish'), nullif(trim(coalesce(e.v->>'composition', '')), ''),
         (row_number() over (partition by e.v->>'meal' order by e.ord) - 1)::int
  from jsonb_array_elements(p_items) with ordinality as e(v, ord);
  return m;
end $$;
revoke execute on function public.save_menu(uuid, date, jsonb) from public, anon;
grant execute on function public.save_menu(uuid, date, jsonb) to authenticated, service_role;
