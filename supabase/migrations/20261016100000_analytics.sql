-- Stage 5B · Owner analytics «Аналитика» (SPEC §7). No new tables: read-only aggregates over the module tables.
--
-- Access (SPEC §3.4, row «Аналитика»): owner — everything; head — everything except finances;
-- accountant — finances only; everybody else — nothing. Every function checks the caller and the garden
-- itself (security definer, so aggregation does not pay per-row RLS costs) and is closed to public/anon.
--
-- Definitions shared with the modules (so the numbers match the module screens):
--   attendance — effective status of a child on a working day (D-018): the attendance row, otherwise «absent»
--                when an active parent report covers the day, otherwise «not marked». The roster of a day comes
--                from child_group_history (the group on that date; archived children count until they left).
--                Rate = present / (present + absent); unmarked days are left out.
--   staff      — worktime_range() (D-017), the single source of day statuses; closed days only (up to yesterday).
--   finance    — invoice columns of the FIFO balance model (D-025): amount / paid_amount / balance per month.
--   funnel     — waitlist statuses and their timeline (D-028); children's stays from child_group_history + archive events.
-- Periods are local dates of the kindergarten (its time zone); the server caps them at 400 days.

create or replace function public.analytics_guard(kg uuid, p_section text, p_from date, p_to date) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_section = 'finance' then
    if not public.has_role(kg, array['owner', 'accountant']::public.app_role[]) then
      raise exception 'hs:forbidden' using errcode = '42501';
    end if;
  elsif p_section in ('attendance', 'staff', 'funnel') then
    if not public.has_role(kg, array['owner', 'head']::public.app_role[]) then
      raise exception 'hs:forbidden' using errcode = '42501';
    end if;
  else
    raise exception 'hs:invalid';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'hs:invalid';
  end if;
end $$;
revoke execute on function public.analytics_guard(uuid, text, date, date) from public, anon;
grant execute on function public.analytics_guard(uuid, text, date, date) to authenticated, service_role;

-- ───────────────────────────── 1. Attendance and occupancy ─────────────────────────────
-- { days: [{d, enrolled, present, absent, sick, unmarked}],          working days from p_from up to min(p_to, today)
--   groups: [{id, name, color, capacity, children, present, absent, sick, unmarked}],
--   reasons: {sick, vacation, family, other, none},                   effective absences by reason
--   on_date: date }                                                    occupancy date = min(p_to, today)
create or replace function public.analytics_attendance(kg uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'attendance', p_from, p_to);
  t := least(p_to, public.kg_today(kg));
  with days as (
    select g::date as d from generate_series(p_from::timestamp, t::timestamp, interval '1 day') g
    where public.kg_is_working_day(kg, g::date)
  ),
  roster as (
    select dd.d, h.group_id, h.child_id
    from days dd
    join child_group_history h on h.kindergarten_id = kg and h.from_date <= dd.d and (h.to_date is null or h.to_date >= dd.d)
    join children c on c.id = h.child_id and c.enrolled_on <= dd.d
  ),
  rep as (
    select distinct on (x.child_id, g::date) x.child_id, g::date as d, x.reason
    from absence_reports x
    cross join lateral generate_series(greatest(x.date_from, p_from)::timestamp, least(x.date_to, t)::timestamp, interval '1 day') g
    where x.kindergarten_id = kg and x.cancelled_at is null and x.date_from <= t and x.date_to >= p_from
    order by x.child_id, g::date, x.created_at desc
  ),
  eff as (
    select r.d, r.group_id,
           coalesce(a.status, case when rp.child_id is not null then 'absent' end) as st,
           case when a.status = 'absent' then coalesce(a.reason, rp.reason)
                when a.status is null then rp.reason end as reason
    from roster r
    left join child_attendance a on a.child_id = r.child_id and a.date = r.d
    left join rep rp on rp.child_id = r.child_id and rp.d = r.d
  ),
  by_day as (
    select d, count(*)::int as enrolled,
           count(*) filter (where st = 'present')::int as present,
           count(*) filter (where st = 'absent')::int as absent,
           count(*) filter (where st = 'absent' and reason = 'sick')::int as sick,
           count(*) filter (where st is null)::int as unmarked
    from eff group by d
  ),
  by_group as (
    select group_id,
           count(*) filter (where st = 'present')::int as present,
           count(*) filter (where st = 'absent')::int as absent,
           count(*) filter (where st = 'absent' and reason = 'sick')::int as sick,
           count(*) filter (where st is null)::int as unmarked
    from eff group by group_id
  ),
  occ as (
    select h.group_id, count(*)::int as n
    from child_group_history h
    join children c on c.id = h.child_id and c.enrolled_on <= t
    where h.kindergarten_id = kg and h.from_date <= t and (h.to_date is null or h.to_date >= t)
    group by h.group_id
  )
  select jsonb_build_object(
    'on_date', t,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('d', dd.d, 'enrolled', coalesce(b.enrolled, 0), 'present', coalesce(b.present, 0),
                                          'absent', coalesce(b.absent, 0), 'sick', coalesce(b.sick, 0), 'unmarked', coalesce(b.unmarked, 0))
                       order by dd.d)
      from days dd left join by_day b on b.d = dd.d), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color, 'capacity', g.capacity,
                                          'children', coalesce(o.n, 0), 'present', coalesce(b.present, 0), 'absent', coalesce(b.absent, 0),
                                          'sick', coalesce(b.sick, 0), 'unmarked', coalesce(b.unmarked, 0))
                       order by g.sort_order, g.name)
      from groups g left join by_group b on b.group_id = g.id left join occ o on o.group_id = g.id
      where g.kindergarten_id = kg), '[]'::jsonb),
    'reasons', (
      select jsonb_build_object(
        'sick', count(*) filter (where reason = 'sick'),
        'vacation', count(*) filter (where reason = 'vacation'),
        'family', count(*) filter (where reason = 'family'),
        'other', count(*) filter (where reason = 'other'),
        'none', count(*) filter (where reason is null))
      from eff where st = 'absent')
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_attendance(uuid, date, date) from public, anon;
grant execute on function public.analytics_attendance(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── 2. Staff discipline ─────────────────────────────
-- One row per person with a schedule, marks or absences in the period. Closed days only: p_from … min(p_to, yesterday).
-- The app compares with the same number of closed days of the previous period (analytics.ts staffRanges).
-- worktime_range() covers at most 93 days per call, so longer periods are read in 93-day chunks.
create or replace function public.analytics_staff(kg uuid, p_from date, p_to date)
  returns table (user_id uuid, full_name text, archived boolean, scheduled_days int, worked_days int,
                 late_days int, late_minutes int, absent_days int, sick_days int, vacation_days int, unmarked_days int,
                 outside_days int, planned_minutes int, worked_minutes int, auto_closed_days int, edited_days int)
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
begin
  perform public.analytics_guard(kg, 'staff', p_from, p_to);
  t := least(p_to, public.kg_today(kg) - 1);
  if t < p_from then
    return;
  end if;
  return query
    with chunks as (
      select c::date as f, least(c::date + 92, t) as e
      from generate_series(p_from::timestamp, t::timestamp, interval '93 days') c
    ),
    -- worktime_range itself leaves out the days before a person joined the garden and after archiving (D-017),
    -- so these numbers match the timesheet and the accountant's card.
    r as (
      select w.* from chunks ch cross join lateral public.worktime_range(kg, ch.f, ch.e) w
    )
    select r.user_id, max(r.full_name), bool_or(r.archived),
           count(*) filter (where r.shift_start is not null)::int,
           count(*) filter (where r.first_start is not null)::int,
           count(*) filter (where r.status = 'late')::int,
           coalesce(sum(r.late_minutes) filter (where r.status = 'late'), 0)::int,
           count(*) filter (where r.status = 'absent')::int,
           count(*) filter (where r.status = 'absent' and r.absence_kind = 'sick')::int,
           count(*) filter (where r.status = 'absent' and r.absence_kind = 'vacation')::int,
           count(*) filter (where r.status = 'unmarked')::int,
           count(*) filter (where r.outside_schedule)::int,
           coalesce(sum(extract(epoch from (r.shift_end - r.shift_start)) / 60) filter (where r.shift_start is not null), 0)::int,
           coalesce(sum(r.worked_minutes), 0)::int,
           count(*) filter (where r.auto_closed)::int,
           count(*) filter (where r.edited)::int
    from r
    group by r.user_id
    having count(*) filter (where r.shift_start is not null or r.first_start is not null or r.absence_kind is not null) > 0
    order by max(r.full_name), r.user_id;
end $$;
revoke execute on function public.analytics_staff(uuid, date, date) from public, anon;
grant execute on function public.analytics_staff(uuid, date, date) to authenticated, service_role;

-- ───────────────────────────── 3. Finance ─────────────────────────────
-- { months: [{period, invoices, charged, paid, debt, overdue, paid_invoices, avg_days}],   months that intersect the period
--   debtors: [{child_id, full_name, status, group_name, debt, since, months}],              open debts as of today
--   today, paid_until }
-- avg_days — days from the 1st of the month to the moment the invoice became fully paid (local date of paid_at).
-- p_paid_until (optional) — money «as of» that local date: only receipts accepted up to it count, allocated with the
-- same FIFO rule as invoices_recalc (D-025): paid = clamp(child's money accepted by then − charges of the older
-- invoices, 0, amount); debt and overdue follow (overdue = due before that date). The page passes it for the
-- previous period while the current one is still running, so «1–13 October» compares with «September as of
-- 13 September», not with September's invoices and every payment made since.
create or replace function public.analytics_finance(kg uuid, p_from date, p_to date, p_paid_until date default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  today date;
  tz text;
  cut date;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'finance', p_from, p_to);
  today := public.kg_today(kg);
  cut := least(coalesce(p_paid_until, today), today);
  tz := coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty');
  with months as (
    select g::date as period
    from generate_series(date_trunc('month', p_from)::timestamp, date_trunc('month', p_to)::timestamp, interval '1 month') g
  ),
  inv as (
    select i.period, i.amount, i.due_date, i.paid_at,
           case when p_paid_until is null then i.paid_amount
                else least(i.amount, greatest(0,
                       coalesce((select sum(r.confirmed_amount) from payment_receipts r
                                 where r.child_id = i.child_id and r.status = 'accepted' and (r.reviewed_at at time zone tz)::date <= cut), 0)
                     - coalesce((select sum(o.amount) from invoices o where o.child_id = i.child_id and o.period < i.period), 0)))
           end as paid
    from invoices i
    where i.kindergarten_id = kg and i.period in (select period from months)
  ),
  per as (
    select x.period, count(*)::int as invoices, sum(x.amount) as charged, sum(x.paid) as paid, sum(x.amount - x.paid) as debt,
           coalesce(sum(x.amount - x.paid) filter (where x.due_date < cut), 0) as overdue,
           count(*) filter (where x.amount - x.paid <= 0)::int as paid_invoices,
           avg(greatest(0, least((x.paid_at at time zone tz)::date, cut) - x.period))
             filter (where x.amount - x.paid <= 0 and x.paid_at is not null) as avg_days
    from inv x
    group by x.period
  ),
  debt as (
    select c.id, c.full_name, c.status, g.name as group_name, sum(i.balance) as debt, min(i.due_date) as since, count(*)::int as months
    from invoices i
    join children c on c.id = i.child_id
    left join groups g on g.id = c.group_id
    where i.kindergarten_id = kg and i.balance > 0
    group by c.id, c.full_name, c.status, g.name
  )
  select jsonb_build_object(
    'today', today,
    'paid_until', cut,
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('period', m.period, 'invoices', coalesce(p.invoices, 0), 'charged', coalesce(p.charged, 0),
                                          'paid', coalesce(p.paid, 0), 'debt', coalesce(p.debt, 0), 'overdue', coalesce(p.overdue, 0),
                                          'paid_invoices', coalesce(p.paid_invoices, 0), 'avg_days', round(p.avg_days, 1))
                       order by m.period)
      from months m left join per p on p.period = m.period), '[]'::jsonb),
    'debtors', coalesce((
      select jsonb_agg(jsonb_build_object('child_id', d.id, 'full_name', d.full_name, 'status', d.status, 'group_name', d.group_name,
                                          'debt', d.debt, 'since', d.since, 'months', d.months)
                       order by d.debt desc, d.full_name)
      from debt d), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_finance(uuid, date, date, date) from public, anon;
grant execute on function public.analytics_finance(uuid, date, date, date) to authenticated, service_role;

-- ───────────────────────────── 4. Funnel and churn ─────────────────────────────
-- { applications, contacted, accepted, declined,       applications created in the period (cohort) and how far they got
--   joined, left, left_reasons: {reason: n},           stays that started / ended in the period
--   active: [{d, n}] }                                 active children per day, p_from … min(p_to, today)
-- «contacted» counts every application that reached «Связались» at some point (timeline) or was accepted.
--
-- Stays. A child can leave and come back (archive → restore), so joining and leaving are read from the group history
-- (child_group_history — the archive trigger closes the open stay on the archive day, a restore opens a new one; transfers
-- are back-to-back stays and do not break a stay). Consecutive history rows are merged into stays; a gap — or an archive
-- event in the journal on the last day of a row followed by a row the next day — ends a stay.
--   start   = first day of the stay, not before enrolled_on;
--   left_on = the archive day (archived_at of a currently archived child for its last stay); the child is not active
--             from that day on. A child archived without a known date is left out (no guessing a date).
--   reason  = archive_reason for the current archive, otherwise the reason recorded in the journal on that day.
-- Children who never had a group: one stay from enrolled_on to the archive date.
create or replace function public.analytics_funnel(kg uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  t date;
  tz text;
  res jsonb;
begin
  perform public.analytics_guard(kg, 'funnel', p_from, p_to);
  t := least(p_to, public.kg_today(kg));
  tz := coalesce((select timezone from kindergarten_settings where kindergarten_id = kg), 'Asia/Almaty');
  with apps as (
    select a.id, a.status,
           a.status in ('contacted', 'accepted')
             or exists (select 1 from waitlist_comments wc where wc.application_id = a.id and wc.kind = 'status' and wc.status = 'contacted') as reached
    from waitlist_applications a
    where a.kindergarten_id = kg and (a.created_at at time zone tz)::date between p_from and p_to
  ),
  archives as (
    select a.entity_id as child, (a.created_at at time zone tz)::date as d, a.details ->> 'reason' as reason, a.created_at
    from audit_log a
    where a.kindergarten_id = kg and a.action = 'child.archive' and a.entity = 'child'
  ),
  rows_ as (
    select h.child_id, h.from_date as f, h.to_date as e
    from child_group_history h where h.kindergarten_id = kg
    union all
    select c.id, c.enrolled_on, case when c.status = 'archived' then (c.archived_at at time zone tz)::date end
    from children c
    where c.kindergarten_id = kg and not exists (select 1 from child_group_history h where h.child_id = c.id)
  ),
  ordered as (
    select r.*,
           max(r.e) over w as prev_end,
           bool_or(r.e is null) over w as prev_open,
           count(*) over w as prev_n
    from rows_ r
    window w as (partition by r.child_id order by r.f, r.e nulls last rows between unbounded preceding and 1 preceding)
  ),
  marked as (
    select o.*,
           sum(case when o.prev_n = 0 then 1
                    when o.prev_open then 0
                    when o.f > o.prev_end + 1 then 1
                    when o.f = o.prev_end + 1 and exists (select 1 from archives x where x.child = o.child_id::text and x.d = o.prev_end) then 1
                    else 0 end) over (partition by o.child_id order by o.f, o.e nulls last rows unbounded preceding) as isl
    from ordered o
  ),
  merged as (
    select m.child_id, m.isl, min(m.f) as f, case when bool_or(m.e is null) then null else max(m.e) end as e,
           m.isl = max(m.isl) over (partition by m.child_id) as last
    from marked m group by m.child_id, m.isl
  ),
  stays as (
    select x.* from (
      select c.id as child_id,
             greatest(mg.f, c.enrolled_on) as start,
             case when mg.last and c.status = 'archived' then coalesce((c.archived_at at time zone tz)::date, mg.e) else mg.e end as left_on,
             case when mg.last and c.status = 'archived' then coalesce(c.archive_reason, 'other')
                  else coalesce((select ar.reason from archives ar where ar.child = c.id::text and ar.d = mg.e order by ar.created_at desc limit 1), 'other')
             end as reason,
             mg.last and c.status = 'archived' as archived_now
      from merged mg join children c on c.id = mg.child_id
    ) x
    where not (x.archived_now and x.left_on is null) and (x.left_on is null or x.left_on >= x.start)
  )
  select jsonb_build_object(
    'applications', (select count(*) from apps),
    'contacted', (select count(*) from apps where reached),
    'accepted', (select count(*) from apps where status = 'accepted'),
    'declined', (select count(*) from apps where status = 'declined'),
    'joined', (select count(*) from stays where start between p_from and p_to),
    'left', (select count(*) from stays where left_on between p_from and p_to),
    'left_reasons', coalesce((
      select jsonb_object_agg(r, n) from (
        select reason as r, count(*) as n from stays where left_on between p_from and p_to group by 1
      ) x), '{}'::jsonb),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object('d', g::date,
               'n', (select count(*) from stays s where s.start <= g::date and (s.left_on is null or s.left_on > g::date)))
             order by g)
      from generate_series(p_from::timestamp, t::timestamp, interval '1 day') g), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_funnel(uuid, date, date) from public, anon;
grant execute on function public.analytics_funnel(uuid, date, date) to authenticated, service_role;
