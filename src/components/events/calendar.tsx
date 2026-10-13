"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Cake, MapPin, Trash2, UsersRound } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { formatDate, isoWeekday } from "@/lib/format";
import { KIND_DOT, KIND_STYLE, monthGrid, shiftMonth, timeRange, type EventKind } from "@/lib/events";
import { cn } from "@/lib/utils";
import { deleteEventAction } from "@/app/(app)/events/actions";
import type { Audience, TargetGroup } from "@/components/announcements/audience-fields";
import { EventDialog } from "./event-dialog";

export interface CalEvent {
  id: string;
  title: string;
  kind: EventKind;
  date: string;
  start_time: string | null;
  end_time: string | null;
  place: string | null;
  description: string | null;
  audience: Audience;
  groups: { id: string; name: string; color: string }[];
  manageable: boolean;
}
export interface CalBirthday {
  kind: "child" | "staff";
  person_id: string;
  full_name: string;
  day: string;
  age: number | null;
  group_name: string | null;
}
export interface CalDayOff {
  date: string;
  name: string;
}

/** First name for compact cells: "Ахметов Алихан Даниярович" → "Алихан". */
const shortName = (n: string) => n.split(/\s+/)[1] ?? n;

export function EventsCalendar({
  month,
  today,
  initialDay,
  events,
  birthdays,
  daysOff,
  upcoming,
  targets,
}: {
  month: string;
  today: string;
  initialDay: string;
  events: CalEvent[];
  birthdays: CalBirthday[];
  daysOff: CalDayOff[];
  upcoming: CalEvent[];
  targets: { audiences: Audience[]; groups: TargetGroup[] } | null;
}) {
  const t = useTranslations("events");
  const [day, setDay] = React.useState(initialDay);
  const [open, setOpen] = React.useState<CalEvent | null>(null);

  const weeks = React.useMemo(() => monthGrid(month), [month]);
  const byDay = React.useMemo(() => {
    const m = new Map<string, { events: CalEvent[]; birthdays: CalBirthday[]; off: CalDayOff | null }>();
    const get = (d: string) => {
      if (!m.has(d)) m.set(d, { events: [], birthdays: [], off: null });
      return m.get(d)!;
    };
    for (const e of events) get(e.date).events.push(e);
    for (const b of birthdays) get(b.day).birthdays.push(b);
    for (const h of daysOff) get(h.date).off = h;
    return m;
  }, [events, birthdays, daysOff]);

  // Month/weekday names from our messages: Intl lacks Kazakh data in some browsers and must match SSR.
  const monthsNom = t("monthsNom").split(",");
  const monthsGen = t("monthsGen").split(",");
  const weekdaysLong = t("weekdaysLong").split(",");
  const monthTitle = t("monthTitle", { month: monthsNom[Number(month.slice(5, 7)) - 1], year: month.slice(0, 4) });
  const dayTitle = (d: string) =>
    t("dayTitle", { weekday: weekdaysLong[isoWeekday(d) - 1], day: Number(d.slice(8)), month: monthsGen[Number(d.slice(5, 7)) - 1] });
  const weekdays = t("weekdaysShort").split(",");
  const selected = byDay.get(day) ?? { events: [], birthdays: [], off: null };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0 p-3 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg font-extrabold first-letter:uppercase" data-testid="calendar-month">
            {monthTitle}
          </h2>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" aria-label={t("prevMonth")}>
              <Link href={`/events?month=${shiftMonth(month, -1)}`} scroll={false}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-11">
              <Link href={`/events?month=${today.slice(0, 7)}&day=${today}`} scroll={false}>
                {t("today")}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" aria-label={t("nextMonth")}>
              <Link href={`/events?month=${shiftMonth(month, 1)}`} scroll={false} data-testid="next-month">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-faint" aria-hidden>
          {weekdays.map((w, i) => (
            <div key={w} className={cn("py-1.5", i >= 5 && "text-tile-unmarked-fg")}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 lg:gap-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border" data-testid="calendar-grid">
          {weeks.flat().map((d, i) => {
            const info = byDay.get(d);
            const inMonth = d.slice(0, 7) === month;
            const isToday = d === today;
            const isSel = d === day;
            const dayNum = Number(d.slice(8));
            const weekend = i % 7 >= 5;
            const items = (info?.events.length ?? 0) + (info?.birthdays.length ?? 0);
            const hidden = Math.max(0, (info?.events.length ?? 0) - 2) + Math.max(0, (info?.birthdays.length ?? 0) - 2);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSel}
                onClick={() => setDay(d)}
                data-testid={`day-${d}`}
                className={cn(
                  "relative flex min-h-12 cursor-pointer flex-col items-center rounded-xl p-1 text-left transition-colors lg:min-h-28 lg:items-stretch lg:rounded-none lg:border-r lg:border-b lg:border-border lg:p-1.5",
                  i % 7 === 6 && "lg:border-r-0",
                  i >= weeks.length * 7 - 7 && "lg:border-b-0",
                  info?.off ? "bg-tile-unmarked/60" : "lg:bg-surface",
                  isSel ? "ring-2 ring-text ring-inset lg:ring-2" : "hover:bg-surface-muted",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold",
                    isToday ? "bg-text text-white" : !inMonth ? "font-medium text-faint" : weekend || info?.off ? "text-tile-unmarked-fg" : "text-text",
                  )}
                  aria-hidden
                >
                  {dayNum}
                </span>
                {/* The button's name: the full date, how many entries, the day off (the chips below add the titles). */}
                <span className="sr-only">
                  {formatDate(d)}
                  {items ? ` · ${t("itemsCount", { count: items })}` : ""}
                  {info?.off ? (
                    <>
                      {" · "}
                      <span data-user-content>{info.off.name}</span>
                    </>
                  ) : null}
                </span>
                {/* phone: dots in the legend's two colours only — every event blue, birthdays crimson (the kind is in the list below) */}
                <span className="mt-0.5 flex h-1.5 gap-0.5 lg:hidden" aria-hidden>
                  {info?.events.slice(0, 3).map((e) => <span key={e.id} className="size-1.5 rounded-full bg-sky" data-testid="calendar-dot" />)}
                  {info?.birthdays.length ? <span className="size-1.5 rounded-full bg-brand" /> : null}
                </span>
                {/* desktop: chips */}
                <span className="mt-1 hidden min-w-0 flex-col gap-0.5 lg:flex">
                  {info?.off ? <span data-user-content className="truncate text-[11px] font-semibold text-tile-unmarked-fg">{info.off.name}</span> : null}
                  {info?.events.slice(0, 2).map((e) => (
                    <span key={e.id} className={cn("truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold", KIND_STYLE[e.kind])} data-testid="calendar-event">
                      {e.start_time ? `${e.start_time} ` : ""}
                      <span data-user-content>{e.title}</span>
                    </span>
                  ))}
                  {info?.birthdays.slice(0, 2).map((b) => (
                    <span key={`${b.kind}-${b.person_id}`} className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-brand" data-testid="calendar-birthday">
                      <Cake className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{shortName(b.full_name)}</span>
                    </span>
                  ))}
                  {hidden > 0 ? (
                    <span className="text-[11px] text-faint">{t("more", { count: hidden })}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <Legend />
      </Card>

      <div className="min-w-0 space-y-4">
        <Card data-testid="selected-day">
          <CardHeader
            title={<span className="first-letter:uppercase">{dayTitle(day)}</span>}
            action={
              targets ? (
                <EventDialog
                  audiences={targets.audiences}
                  groups={targets.groups}
                  defaultDate={day < today ? today : day}
                  trigger={
                    <Button size="sm" data-testid="new-event">
                      + {t("new")}
                    </Button>
                  }
                />
              ) : null
            }
          />
          <DayList info={selected} onOpen={setOpen} />
        </Card>
        <Card data-testid="upcoming-list">
          <CardHeader title={t("upcoming")} />
          {upcoming.length ? (
            <ul className="space-y-2">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <EventRow e={e} today={today} onOpen={setOpen} showDate />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t("noUpcoming")}</p>
          )}
        </Card>
      </div>
      <EventDetails event={open} onClose={() => setOpen(null)} targets={targets} />
    </div>
  );
}

function Legend() {
  const t = useTranslations("events");
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-brand" aria-hidden /> {t("legendBirthday")}
      </span>
      {/* days off and weekends are shown by a lavender day number, so the legend shows one */}
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] leading-none font-bold text-tile-unmarked-fg" aria-hidden>
          31
        </span>{" "}
        {t("legendDayOff")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-sky" aria-hidden /> {t("legendEvent")}
      </span>
    </div>
  );
}

function DayList({ info, onOpen }: { info: { events: CalEvent[]; birthdays: CalBirthday[]; off: CalDayOff | null }; onOpen: (e: CalEvent) => void }) {
  const t = useTranslations("events");
  if (!info.events.length && !info.birthdays.length && !info.off) {
    return <EmptyState icon={CalendarDays} title={t("dayEmpty")} className="py-6" />;
  }
  return (
    <ul className="space-y-2" data-testid="day-items">
      {info.off ? (
        <li className="flex min-h-11 items-center gap-2 rounded-xl bg-tile-unmarked px-3 text-sm font-semibold text-tile-unmarked-fg">
          <CalendarDays className="size-4" aria-hidden /> {t("dayOff")}: <span data-user-content>{info.off.name}</span>
        </li>
      ) : null}
      {info.events.map((e) => (
        <li key={e.id}>
          <EventRow e={e} onOpen={onOpen} />
        </li>
      ))}
      {info.birthdays.map((b) => (
        <li key={`${b.kind}-${b.person_id}`} className="flex min-h-11 items-center gap-3 rounded-xl bg-brand-soft px-3 py-2 text-sm" data-testid="birthday-item">
          <Cake className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span data-user-content className="block truncate font-semibold">{b.full_name}</span>
            <span className="block text-[13px] text-muted">
              {b.kind === "child" ? t("turnsChild", { age: b.age ?? 0 }) : t("staffBirthday")}
              {b.group_name ? (
  <>
    {" · "}
    <span data-user-content>{b.group_name}</span>
  </>
) : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EventRow({ e, onOpen, showDate, today }: { e: CalEvent; onOpen: (e: CalEvent) => void; showDate?: boolean; today?: string }) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const when = showDate ? (e.date === today ? tc("today") : formatDate(e.date)) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      className="flex w-full cursor-pointer items-stretch gap-3 rounded-xl border border-border/70 p-3 text-left hover:bg-surface-muted"
      data-testid="event-row"
    >
      <span className={cn("w-1 shrink-0 rounded-full", KIND_DOT[e.kind])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span data-user-content className="block truncate text-sm font-bold">{e.title}</span>
        {when || e.start_time ? <span className="block truncate text-[13px] text-muted">{[when, timeRange(e)].filter(Boolean).join(" · ")}</span> : null}
        <span className="block truncate text-[13px] text-faint">
          {t(`kinds.${e.kind}`)}
          {e.place ? (
            <>
              {" · "}
              <span data-user-content>{e.place}</span>
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function EventDetails({ event, onClose, targets }: { event: CalEvent | null; onClose: () => void; targets: { audiences: Audience[]; groups: TargetGroup[] } | null }) {
  const t = useTranslations("events");
  const ta = useTranslations("announcements");
  const del = useAction(deleteEventAction, { onSuccess: onClose });
  const e = event;
  return (
    <Dialog open={!!e} onOpenChange={(v) => !v && onClose()}>
      {e ? (
        <DialogContent title={e.title} description={t(`kinds.${e.kind}`)}>
          <div className="space-y-3 text-sm" data-testid="event-details">
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 text-faint" aria-hidden /> {formatDate(e.date)}
            </p>
            {timeRange(e) ? (
              <p className="flex items-center gap-2">
                <Clock className="size-4 text-faint" aria-hidden /> {timeRange(e)}
              </p>
            ) : null}
            {e.place ? (
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-faint" aria-hidden /> <span data-user-content>{e.place}</span>
              </p>
            ) : null}
            <p className="flex items-center gap-2">
              <UsersRound className="size-4 text-faint" aria-hidden />
              {e.audience === "groups" ? <span data-user-content>{e.groups.map((g) => g.name).join(", ")}</span> : ta(`audiences.${e.audience}`)}
            </p>
            {e.description ? <p data-user-content className="whitespace-pre-wrap text-text">{e.description}</p> : null}
            {e.kind === "day_off" ? <Badge tone="lavender">{t("kinds.day_off")}</Badge> : null}
          </div>
          {e.manageable && targets ? (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              <EventDialog
                audiences={targets.audiences}
                groups={targets.groups}
                defaultDate={e.date}
                onSaved={onClose}
                event={{ ...e, groupIds: e.groups.map((g) => g.id) }}
              />
              <Confirm
                trigger={
                  <Button variant="ghost" data-testid="delete-event">
                    <Trash2 /> {t("delete")}
                  </Button>
                }
                title={t("deleteTitle")}
                confirmLabel={t("delete")}
                danger
                onConfirm={() => del.run(e.id)}
              />
            </div>
          ) : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
