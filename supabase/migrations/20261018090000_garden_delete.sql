-- Stage 7A · Deleting a whole kindergarten (the demo seed recreates «Happy Steps»; a future superadmin «delete garden»).
--
-- The last-owner guard (foundation, SPEC §3.3) blocked the cascade from `kindergartens` to `memberships`: when the garden
-- row itself is gone there is nothing left to protect. The guard is unchanged for every other case — archiving,
-- demoting or deleting the last active owner of an existing garden still fails. Only the service role can delete
-- gardens (kindergartens has no delete policy), so clients gain nothing.
create or replace function public.tg_protect_last_owner() returns trigger
  language plpgsql security definer set search_path = public as $$
declare kg uuid := coalesce(old.kindergarten_id, new.kindergarten_id);
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'owner') then
    -- cascade from a deleted garden: the kindergarten row is already gone
    if tg_op = 'DELETE' and not exists (select 1 from kindergartens where id = kg) then
      return old;
    end if;
    if not exists (
      select 1 from memberships where kindergarten_id = kg and role = 'owner' and status = 'active' and id <> old.id
    ) then
      raise exception 'last_owner' using errcode = 'P0001', hint = 'Нельзя архивировать последнего владельца сада';
    end if;
  end if;
  return coalesce(new, old);
end $$;
