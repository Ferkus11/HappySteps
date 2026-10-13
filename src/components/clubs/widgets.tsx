import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import type { DashboardWidget } from "@/components/dashboard/widgets";
import { createClient } from "@/lib/supabase/server";
import { emptyStats, loadChildEnrollments, loadClubs, loadPending, loadStats } from "@/lib/clubs-data";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EnrollmentBadge, ScheduleText } from "./bits";
import { parentKids } from "./views";

/** Parent: «Мои кружки» — each child's clubs with status; a link to the catalog when a child has none. */
async function ParentClubsWidget({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const kids = await parentKids(ctx);
  if (!kids.length) return null;
  const [clubs, enrollments] = await Promise.all([loadClubs(supabase, ctx.kg.id), loadChildEnrollments(supabase, ctx.kg.id, kids.map((k) => k.id))]);
  if (!clubs.length) return null;
  const t = await getTranslations("clubs");
  const byId = new Map(clubs.map((c) => [c.id, c]));
  return (
    <Card data-testid="parent-clubs">
      <CardHeader title={t("widget.parentTitle")} href="/clubs" />
      <div className="space-y-4">
        {kids.map((kid) => {
          const first = kid.full_name.split(" ")[1] ?? kid.full_name;
          const mine = enrollments.filter((e) => e.child_id === kid.id && byId.has(e.club_id));
          return (
            <div key={kid.id}>
              {kids.length > 1 ? <div className="mb-1 text-sm font-bold">{first}</div> : null}
              {mine.length ? (
                <ul className="space-y-1">
                  {mine.map((e) => {
                    const c = byId.get(e.club_id)!;
                    return (
                      <li key={e.id}>
                        <Link href={`/clubs/${c.id}?child=${kid.id}`} className="-mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 py-1 hover:bg-surface-muted" data-testid="parent-club" data-club={c.name}>
                          <div className="min-w-0 flex-1">
                            <div data-user-content className="truncate text-sm font-semibold">{c.name}</div>
                            <ScheduleText schedule={c.schedule} className="truncate text-xs text-faint" />
                          </div>
                          <EnrollmentBadge status={e.status} position={e.position} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Link href={`/clubs?child=${kid.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-surface-muted px-3.5 text-sm">
                  <span className="text-muted">{t("widget.parentEmpty", { child: first })}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand">
                    {t("widget.pick")} <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Club teacher: «Мои кружки и заявки» — requests waiting + own clubs with filled places. */
async function TeacherClubsWidget({ ctx }: { ctx: KgContext }) {
  const supabase = await createClient();
  const clubs = await loadClubs(supabase, ctx.kg.id, { teacherId: ctx.userId });
  if (!clubs.length) return null;
  const t = await getTranslations("clubs");
  const stats = await loadStats(supabase, ctx.kg.id);
  const pending = await loadPending(supabase, clubs, stats);
  return (
    <Card data-testid="teacher-clubs" data-count={pending.length}>
      <CardHeader title={t("widget.teacherTitle")} href="/clubs" />
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[30px] leading-none font-extrabold" data-testid="teacher-clubs-count">
          {pending.length}
        </span>
        <span className="text-[13px] font-medium text-muted">{pending.length ? t("widget.waiting", { count: pending.length }) : t("widget.noWaiting")}</span>
      </div>
      <ul className="space-y-1">
        {clubs.map((c) => {
          const s = stats[c.id] ?? emptyStats(c.capacity);
          return (
            <li key={c.id}>
              <Link href={`/clubs/${c.id}`} className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 hover:bg-surface-muted">
                <span data-user-content className="truncate text-sm font-semibold">{c.name}</span>
                <span className="shrink-0 text-[13px] text-muted">{t("places.attending", { active: s.active, capacity: s.capacity })}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {pending.length ? (
        <Button asChild variant="secondary" className="mt-3 w-full">
          <Link href="/clubs">{t("widget.open")}</Link>
        </Button>
      ) : null}
    </Card>
  );
}

export const clubsWidgets: DashboardWidget[] = [
  { id: "clubs-parent", roles: ["parent"], slot: "main", order: 50, Component: ParentClubsWidget },
  { id: "clubs-teacher", roles: ["club_teacher"], slot: "main", order: 1, Component: TeacherClubsWidget },
];
