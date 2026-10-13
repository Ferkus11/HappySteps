import Link from "next/link";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { Baby, CheckCircle2, ChevronRight, Sun } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "./widgets";
import { createClient } from "@/lib/supabase/server";
import { groupSummaries } from "@/lib/queries/groups";
import { isWorkingDayDb, loadPortions } from "@/lib/attendance";
import { countPending } from "@/lib/payments-data";
import { loadClubAttention } from "@/lib/clubs-data";
import { listStaffDocuments } from "@/lib/documents";
import {
  attentionItems,
  reminderPassed,
  unmarkedGroups,
  type AttentionKind,
} from "@/lib/attention";
import {
  effectiveStatus,
  reportCovering,
  type AbsenceReport,
  type AttendanceRow,
} from "@/lib/attendance-logic";
import { ageOn, formatTime, todayIn } from "@/lib/format";
import { signedUrls } from "@/lib/kg-assets";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Ring } from "@/components/ui/ring";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportAbsenceButton } from "@/components/attendance/absence-dialog";
import { AbsenceList } from "@/components/attendance/absence-list";
import { ReasonIcon } from "@/components/attendance/reason";
import { ChildSwitcher } from "./child-switcher";
import { myChildren } from "./children-data";

/** Children and groups of the garden, loaded once per request for both top-row cards. */
const groupsOf = cache(async (kgId: string) =>
  groupSummaries(await createClient(), kgId),
);

/** Owner/head top row: «Дети» — active children. */
async function ChildrenStat({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard");
  const groups = await groupsOf(ctx.kg.id);
  const children = groups.reduce((s, g) => s + g.activeCount, 0);
  return (
    <Link
      href="/children"
      className="block h-full"
      data-testid="dash-children-card"
    >
      <Card className="h-full hover:shadow-md">
        <Stat
          value={<span data-testid="dash-children">{children}</span>}
          label={t("children")}
          sub={t("activeChildren")}
        />
      </Card>
    </Link>
  );
}

/** Owner/head top row: «Группы» — count + ring of fill (active children / capacity). */
async function GroupsStat({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard");
  const groups = await groupsOf(ctx.kg.id);
  const children = groups.reduce((s, g) => s + g.activeCount, 0);
  const capacity = groups.reduce((s, g) => s + g.capacity, 0);
  return (
    <Link
      href="/groups"
      className="block h-full"
      data-testid="dash-groups-card"
    >
      <Card className="flex h-full items-center justify-between gap-2 hover:shadow-md">
        <Stat
          value={<span data-testid="dash-groups">{groups.length}</span>}
          label={t("groups")}
          sub={t("fill")}
        />
        <Ring
          value={capacity ? (children / capacity) * 100 : 0}
          size={56}
          stroke={6}
          label={t("fillLabel")}
        />
      </Card>
    </Link>
  );
}

const ATTENTION_TONE: Record<AttentionKind, string> = {
  unmarkedGroups: "bg-tile-unmarked text-tile-unmarked-fg",
  receipts: "bg-tile-late text-tile-late-fg",
  clubRequests: "bg-sky-soft text-sky-strong",
  clubQueue: "bg-sky-soft text-sky-strong",
  documents: "bg-tile-late text-tile-late-fg",
  waitlist: "bg-tile-work text-tile-work-fg",
};

/**
 * Owner/head: «Требует внимания» (PLAN stage 5). Every source loads in parallel; lines with zero are hidden.
 * Unmarked groups count only on a working day after the attendance reminder time (as the reminder push).
 */
async function AttentionCard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard.attention");
  const supabase = await createClient();
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);
  const late = reminderPassed(
    formatTime(new Date(), tz),
    ctx.settings.attendance_reminder_time,
  );
  const [working, portions, receipts, clubs, docs, { count: waitlist }] =
    await Promise.all([
      late
        ? isWorkingDayDb(supabase, ctx.kg.id, today)
        : Promise.resolve(false),
      late ? loadPortions(supabase, ctx.kg.id, today) : Promise.resolve([]),
      // Receipts are the accountant's (and owner's) job: the head can't act on them, so no line for her.
      ctx.role === "owner" ? countPending(supabase, ctx.kg.id) : Promise.resolve(null),
      loadClubAttention(supabase, ctx.kg.id),
      listStaffDocuments(supabase, ctx.kg.id, { expiringFrom: today }),
      supabase
        .from("waitlist_applications")
        .select("id", { count: "exact", head: true })
        .eq("kindergarten_id", ctx.kg.id)
        .eq("status", "new"),
    ]);
  const unmarked = working ? unmarkedGroups(portions) : [];
  const items = attentionItems({
    unmarkedGroups: unmarked.length,
    unmarkedGroupId: unmarked[0]?.group_id ?? null,
    receipts,
    clubRequests: clubs.requests,
    clubQueue: clubs.queueReady,
    documents: docs.length,
    waitlist: waitlist ?? 0,
  });
  return (
    <Card data-testid="attention-card" data-count={items.length}>
      <CardHeader title={t("title")} />
      {items.length === 0 ? (
        <div
          className="flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3.5"
          data-testid="attention-empty"
        >
          <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
          <div>
            <div className="font-bold text-success">{t("allGood")}</div>
            <div className="text-[13px] text-muted">{t("allGoodHint")}</div>
          </div>
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {items.map((i) => (
            <li key={i.kind}>
              <Link
                href={i.href}
                className="flex min-h-14 items-center gap-3 rounded-2xl px-2 py-1.5 hover:bg-surface-muted"
                data-testid="attention-item"
                data-kind={i.kind}
                data-count={i.count}
              >
                <span
                  className={cn(
                    "grid h-10 min-w-10 shrink-0 place-items-center rounded-xl px-2 text-[17px] font-extrabold tabular-nums",
                    ATTENTION_TONE[i.kind],
                  )}
                >
                  {i.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug font-semibold">
                    {t(`items.${i.kind}`, { count: i.count })}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {t(`hints.${i.kind}`)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-faint"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Parent: the child card (SPEC §6) — who, whether they are in the kindergarten today, «Ребёнок не придёт»
 * and the reported absences; pills switch between several children.
 */
async function ParentChildCard({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("dashboard");
  const ta = await getTranslations("attendance");
  const tc = await getTranslations("children");
  const kids = (await myChildren(ctx)).sort(
    (a, b) =>
      a.birth_date.localeCompare(b.birth_date) ||
      a.full_name.localeCompare(b.full_name, "ru"),
  );
  if (!kids.length) {
    return (
      <Card>
        <EmptyState
          icon={Baby}
          title={t("noChildren")}
          hint={t("noChildrenHint")}
        />
      </Card>
    );
  }
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const ids = kids.map((k) => k.id);
  const [working, photos, { data: rows }, { data: reports }] =
    await Promise.all([
      isWorkingDayDb(supabase, ctx.kg.id, today),
      signedUrls(
        "child-photos",
        kids.map((k) => k.photo_path ?? "").filter(Boolean),
      ),
      supabase
        .from("child_attendance")
        .select("child_id, date, status, reason")
        .in("child_id", ids)
        .eq("date", today),
      supabase
        .from("absence_reports")
        .select("id, child_id, date_from, date_to, reason, comment")
        .in("child_id", ids)
        .is("cancelled_at", null)
        .gte("date_to", today)
        .order("date_from"),
    ]);
  const reps = (reports ?? []) as AbsenceReport[];
  const rowBy = new Map(
    ((rows ?? []) as AttendanceRow[]).map((r) => [r.child_id, r]),
  );
  const all = kids.map((k) => ({ id: k.id, name: k.full_name }));
  const firstName = (full: string) => full.split(" ")[1] ?? full;

  const panels = kids.map((k) => {
    const e = effectiveStatus(
      rowBy.get(k.id),
      reportCovering(reps, k.id, today),
    );
    const tone = !working ? "off" : e.status;
    const mine = reps.filter((r) => r.child_id === k.id);
    return (
      <Card key={k.id} data-testid="parent-today" data-child={k.full_name}>
        <Link
          href={`/children/${k.id}`}
          className="-m-1 flex items-center gap-3 rounded-2xl p-1 hover:bg-surface-muted"
          data-testid="my-child"
        >
          <Avatar
            name={k.full_name}
            src={k.photo_path ? photos[k.photo_path] : null}
            size={56}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-extrabold">
              {k.full_name}
            </span>
            <span className="block truncate text-sm text-muted">
              {tc("age", { count: ageOn(k.birth_date, today) })}
              {k.groups ? ` · ${k.groups.name}` : ""}
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-faint" aria-hidden />
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div
            className={cn(
              "flex flex-1 items-center gap-3 rounded-2xl px-4 py-3.5",
              tone === "present" && "bg-tile-work text-tile-work-fg",
              tone === "absent" && "bg-tile-absent text-tile-absent-fg",
              tone === "none" && "bg-tile-unmarked text-tile-unmarked-fg",
              tone === "off" && "bg-surface-muted text-muted",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface/70">
              {tone === "off" ? (
                <Sun className="size-5" aria-hidden />
              ) : tone === "absent" ? (
                <ReasonIcon reason={e.status === "absent" ? e.reason : null} />
              ) : (
                <Baby className="size-5" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide uppercase opacity-80">
                {ta("todayInKg")}
              </div>
              <div
                className="text-[18px] leading-tight font-extrabold"
                data-testid="child-today-status"
                data-status={tone}
              >
                {tone === "off"
                  ? ta("dayOffToday")
                  : tone === "present"
                    ? ta("inKgToday")
                    : tone === "absent"
                      ? ta("notInKgToday")
                      : ta("notMarkedYet")}
              </div>
              {e.status === "absent" && e.reason ? (
                <div className="text-[13px] font-semibold opacity-80">
                  {ta(`reasons.${e.reason}`)}
                </div>
              ) : null}
            </div>
          </div>
          <ReportAbsenceButton
            kids={all}
            childId={k.id}
            today={today}
            variant="primary"
            className="h-14 w-full rounded-2xl text-base sm:h-auto sm:min-h-14 sm:w-auto sm:px-8"
          />
        </div>
        {mine.length ? (
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold text-faint">
              {ta("reportedAbsences")}
            </div>
            <AbsenceList today={today} items={mine} />
          </div>
        ) : null}
      </Card>
    );
  });

  return (
    <ChildSwitcher
      label={t("myChildren")}
      tabs={kids.map((k) => ({
        id: k.id,
        name: firstName(k.full_name),
        caption: tc("age", { count: ageOn(k.birth_date, today) }),
      }))}
      panels={panels}
    />
  );
}

export const coreWidgets: DashboardWidget[] = [
  {
    id: "dash-children",
    roles: ["owner", "head"],
    slot: "stat",
    order: 1,
    Component: ChildrenStat,
  },
  {
    id: "dash-groups",
    roles: ["owner", "head"],
    slot: "stat",
    order: 2,
    Component: GroupsStat,
  },
  {
    id: "attention",
    roles: ["owner", "head"],
    slot: "side",
    order: 1,
    phoneOrder: 1,
    Component: AttentionCard,
  },
  {
    id: "parent-child",
    roles: ["parent"],
    slot: "top",
    order: 10,
    skeleton: "tall",
    Component: ParentChildCard,
  },
];
