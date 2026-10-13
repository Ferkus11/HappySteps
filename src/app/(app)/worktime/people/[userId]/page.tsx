import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, MessageSquareText } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listStaff, isActivePerson } from "@/lib/queries/people";
import { loadDays } from "@/lib/queries/worktime";
import {
  formatDuration,
  formatHours,
  localTime,
  parseMonth,
  shiftMonth,
  buildTimesheet,
  type AbsenceKind,
} from "@/lib/worktime";
import { formatDate, isoWeekday, monthRange, todayIn } from "@/lib/format";
import { zUuid } from "@/lib/validation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DayMarkers, DayStatusBadge } from "@/components/worktime/day-bits";
import { NavPicker } from "@/components/worktime/nav-pickers";
import {
  AbsenceForm,
  AddSessionButton,
  EditSessionButton,
  OverrideForm,
  RemoveAbsence,
  RemoveOverride,
  ScheduleEditor,
} from "./client";

export default async function WorktimePerson({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { userId } = await params;
  const sp = await searchParams;
  const ctx = await requireKg(["owner", "head", "accountant"]);
  if (!zUuid.safeParse(userId).success) notFound();
  const t = await getTranslations("worktime");
  const tr = await getTranslations("roles");
  const tc = await getTranslations("common");
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);
  const month = parseMonth(sp.month, today);
  const { from, to } = monthRange(month);
  const supabase = await createClient();
  const [people, schedule, overrides, absences, rows] = await Promise.all([
    listStaff(supabase, ctx.kg.id),
    supabase
      .from("staff_schedules")
      .select("weekday, start_time, end_time")
      .eq("kindergarten_id", ctx.kg.id)
      .eq("user_id", userId)
      .order("weekday"),
    supabase
      .from("schedule_overrides")
      .select("id, date, kind, start_time, end_time, note")
      .eq("kindergarten_id", ctx.kg.id)
      .eq("user_id", userId)
      .gte("date", from)
      .order("date")
      .limit(60),
    supabase
      .from("staff_absences")
      .select("id, kind, date_from, date_to, note")
      .eq("kindergarten_id", ctx.kg.id)
      .eq("user_id", userId)
      .gte("date_to", from)
      .order("date_from")
      .limit(60),
    loadDays(supabase, ctx.kg.id, from, to),
  ]);
  const person = people.find((p) => p.userId === userId);
  if (!person) notFound();
  const canEdit = ctx.role === "owner" || ctx.role === "head";
  const mine = rows.filter((r) => r.user_id === userId);
  const totals = buildTimesheet(mine)[0]?.totals;
  const days = mine
    .filter(
      (r) => r.work_date <= today && (r.sessions.length || r.status !== "off"),
    )
    .reverse();
  const base = `/worktime/people/${userId}`;

  return (
    <>
      <PageHeader title={t("personTitle")} />
      {/* One editor at a time (SPEC §8): days · weekly schedule · date changes · absences. */}
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <div className="flex items-start gap-4">
            <Avatar name={person.fullName} size={56} />
            <div className="min-w-0 flex-1">
              <h2 data-user-content className="text-lg font-extrabold" data-testid="person-name">
                {person.fullName}
              </h2>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {person.roles.map((r) => (
                  <Badge
                    key={r.membershipId}
                    tone={r.status === "active" ? "sky" : "neutral"}
                  >
                    {tr(r.role)}
                  </Badge>
                ))}
                {!isActivePerson(person) ? (
                  <Badge tone="neutral">{tc("archived")}</Badge>
                ) : null}
              </div>
            </div>
          </div>
          {totals ? (
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
              <Total
                label={t("totals.hours")}
                value={formatHours(totals.minutes)}
                testId="person-hours"
              />
              <Total label={t("totals.days")} value={totals.workedDays} />
              <Total label={t("totals.lates")} value={totals.lates} />
              <Total
                label={t("totals.missed")}
                value={totals.missed + totals.absences}
              />
            </dl>
          ) : null}
        </Card>

        <Tabs defaultValue="days">
          <TabsList>
            <TabsTrigger value="days">{t("tabs.days")}</TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">
              {t("tabs.schedule")}
            </TabsTrigger>
            <TabsTrigger value="overrides" data-testid="tab-overrides">
              {t("tabs.overrides")}
            </TabsTrigger>
            <TabsTrigger value="absences" data-testid="tab-absences">
              {t("tabs.absences")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="days">
            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-5">
                <h2 className="mr-auto text-[15px] font-bold">
                  {t("monthDays")}
                </h2>
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  aria-label={t("prevMonth")}
                >
                  <Link href={`${base}?month=${shiftMonth(month, -1)}`}>
                    <ChevronLeft />
                  </Link>
                </Button>
                <NavPicker
                  type="month"
                  value={month}
                  param="month"
                  path={base}
                  label={t("month")}
                />
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  aria-label={t("nextMonth")}
                >
                  <Link href={`${base}?month=${shiftMonth(month, 1)}`}>
                    <ChevronRight />
                  </Link>
                </Button>
                {canEdit ? (
                  <AddSessionButton
                    userId={userId}
                    defaultDate={month === today.slice(0, 7) ? today : to}
                  />
                ) : null}
              </div>
              {days.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">
                  {t("noDays")}
                </p>
              ) : (
                <ul
                  className="mt-3 divide-y divide-border"
                  data-testid="person-days"
                >
                  {days.map((r) => (
                    <li
                      key={r.work_date}
                      className="flex gap-3 px-4 py-3 md:px-5"
                      data-testid={`day-${r.work_date}`}
                    >
                      <div className="w-14 shrink-0">
                        <div className="text-sm font-bold">
                          {formatDate(r.work_date).slice(0, 5)}
                        </div>
                        <div className="text-xs text-faint">
                          {t(`weekdays.${isoWeekday(r.work_date)}`)}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-faint">
                          {r.shift_start
                            ? t("shiftShort", {
                                time: `${r.shift_start}–${r.shift_end}`,
                              })
                            : t("noShift")}
                        </div>
                        {r.sessions.map((s) => (
                          <div key={s.id} className="mt-1">
                            <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                              {localTime(s.started_at, tz)}–
                              {s.ended_at ? localTime(s.ended_at, tz) : "…"}
                              {canEdit ? (
                                <EditSessionButton
                                  id={s.id}
                                  date={r.work_date}
                                  start={localTime(s.started_at, tz)}
                                  end={
                                    s.ended_at ? localTime(s.ended_at, tz) : ""
                                  }
                                />
                              ) : null}
                            </div>
                            {s.edited && s.comment ? (
                              <p className="flex items-start gap-1 text-xs text-muted">
                                <MessageSquareText
                                  className="mt-0.5 size-3 shrink-0"
                                  aria-hidden
                                />{" "}
                                <span data-user-content>{s.comment}</span>
                              </p>
                            ) : null}
                          </div>
                        ))}
                        <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
                          <DayMarkers row={r} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <DayStatusBadge row={r} />
                        {r.worked_minutes > 0 ? (
                          <span className="text-sm font-bold tabular-nums">
                            {formatDuration(r.worked_minutes)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardHeader title={t("schedule")} />
              <ScheduleEditor
                userId={userId}
                canEdit={canEdit}
                days={(schedule.data ?? []).map((d) => ({
                  weekday: d.weekday as number,
                  start: String(d.start_time).slice(0, 5),
                  end: String(d.end_time).slice(0, 5),
                }))}
              />
            </Card>
          </TabsContent>
          <TabsContent value="overrides">
            <Card>
              <CardHeader title={t("overrides")} />
              {canEdit ? (
                <OverrideForm userId={userId} defaultDate={today} />
              ) : null}
              <ul className="mt-3 space-y-1 empty:hidden">
                {(overrides.data ?? []).map((o) => (
                  <li
                    key={o.id}
                    className="flex min-h-11 items-center gap-2 border-b border-border text-sm last:border-0"
                  >
                    <span className="w-20 shrink-0 font-semibold">
                      {formatDate(o.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {o.kind === "shift"
                        ? `${String(o.start_time).slice(0, 5)}–${String(o.end_time).slice(0, 5)}`
                        : t("dayOff")}
                      {o.note ? (
                        <span className="text-muted"> · {o.note}</span>
                      ) : null}
                    </span>
                    {canEdit ? <RemoveOverride id={o.id} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>
          <TabsContent value="absences">
            <Card>
              <CardHeader title={t("absences")} />
              {canEdit ? (
                <AbsenceForm userId={userId} defaultDate={today} />
              ) : null}
              <ul className="mt-3 space-y-1 empty:hidden">
                {(absences.data ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="flex min-h-11 items-center gap-2 border-b border-border text-sm last:border-0"
                  >
                    <Badge tone="brand">
                      {t(`absence.${a.kind as AbsenceKind}`)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {a.date_from === a.date_to
                        ? formatDate(a.date_from)
                        : `${formatDate(a.date_from)} – ${formatDate(a.date_to)}`}
                      {a.note ? (
                        <span className="text-muted"> · {a.note}</span>
                      ) : null}
                    </span>
                    {canEdit ? <RemoveAbsence id={a.id} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function Total({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | number;
  testId?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-xl font-extrabold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
