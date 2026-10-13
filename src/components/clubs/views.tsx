import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Baby, ChevronRight, Inbox, Shapes } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/kg-assets";
import { ageOn, formatDate, todayIn } from "@/lib/format";
import { ageFits, confirmOutcome, sortCatalog, type ClubStats } from "@/lib/clubs";
import { emptyStats, loadChildEnrollments, loadClubs, loadPending, loadStats, type Club, type PendingItem } from "@/lib/clubs-data";
import { myChildren } from "@/components/dashboard/parent";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ClubCard } from "./club-card";
import { ClubDialog } from "./club-dialog";
import { ConfirmEnrollmentButton, ReasonButton } from "./actions";
import { ClubPhoto, EnrollmentBadge, ScheduleText } from "./bits";

export type Kid = Awaited<ReturnType<typeof myChildren>>[number];

/** The parent's active children, oldest first (stable order for the switcher and the default choice). */
export async function parentKids(ctx: KgContext): Promise<Kid[]> {
  return (await myChildren(ctx)).sort((a, b) => a.birth_date.localeCompare(b.birth_date) || a.full_name.localeCompare(b.full_name, "ru"));
}

/** Pills to switch between the parent's children (?child=…); hidden for a single child. */
export async function ChildSwitcher({ kids, selected, base, today }: { kids: Kid[]; selected: string; base: string; today: string }) {
  if (kids.length < 2) return null;
  const t = await getTranslations("clubs");
  return (
    <nav aria-label={t("forChild")} className="scrollbar-none mb-4 flex gap-2 overflow-x-auto" data-testid="child-switcher">
      {kids.map((k) => {
        const on = k.id === selected;
        return (
          <Link
            key={k.id}
            href={`${base}?child=${k.id}`}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 rounded-full border py-1 pr-4 pl-1 text-sm font-semibold",
              on ? "border-brand bg-brand-soft text-brand" : "border-border bg-surface text-text hover:bg-surface-muted",
            )}
            data-testid="child-switch"
          >
            <Avatar name={k.full_name} size={34} />
            <span>{k.full_name.split(" ")[1] ?? k.full_name}</span>
            <span className="font-medium text-muted">· {t("childAge", { count: ageOn(k.birth_date, today) })}</span>
          </Link>
        );
      })}
    </nav>
  );
}

async function photosOf(clubs: Club[]) {
  return signedUrls("club-photos", clubs.map((c) => c.photo_path ?? "").filter(Boolean));
}

function CatalogGrid({ clubs, stats, photos, hrefOf, statusOf, testid = "club-catalog", showTeacher = true }: {
  showTeacher?: boolean;
  clubs: Club[];
  stats: Record<string, ClubStats>;
  photos: Record<string, string>;
  hrefOf: (c: Club) => string;
  statusOf?: (c: Club) => React.ReactNode;
  testid?: string;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid={testid}>
      {clubs.map((c) => (
        <li key={c.id}>
          <ClubCard club={c} stats={stats[c.id] ?? emptyStats(c.capacity)} photo={c.photo_path ? photos[c.photo_path] : null} href={hrefOf(c)} status={statusOf?.(c)} showTeacher={showTeacher} />
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────── Parent ─────────────────────────────

export async function ParentClubs({ ctx, childParam }: { ctx: KgContext; childParam?: string }) {
  const t = await getTranslations("clubs");
  const kids = await parentKids(ctx);
  if (!kids.length) {
    return (
      <Card>
        <EmptyState icon={Baby} title={t("noChildren")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const kid = kids.find((k) => k.id === childParam) ?? kids[0];
  const [clubs, stats, enrollments] = await Promise.all([
    loadClubs(supabase, ctx.kg.id),
    loadStats(supabase, ctx.kg.id),
    loadChildEnrollments(supabase, ctx.kg.id, kids.map((k) => k.id)),
  ]);
  const photos = await photosOf(clubs);
  const age = ageOn(kid.birth_date, today);
  const mine = enrollments.filter((e) => e.child_id === kid.id);
  const mineIds = new Set(mine.map((e) => e.club_id));
  const suitable = sortCatalog(clubs.filter((c) => ageFits(c, age) && !mineIds.has(c.id)), mineIds);
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const first = kid.full_name.split(" ")[1] ?? kid.full_name;
  return (
    <>
      <ChildSwitcher kids={kids} selected={kid.id} base="/clubs" today={today} />
      {mine.length ? (
        <Card className="mb-4" data-testid="my-enrollments">
          <CardHeader title={`${t("myEnrollments")} · ${first}`} />
          <ul className="space-y-1">
            {mine.map((e) => {
              const c = byId.get(e.club_id);
              if (!c) return null;
              return (
                <li key={e.id}>
                  <Link
                    href={`/clubs/${c.id}?child=${kid.id}`}
                    className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-muted"
                    data-testid="my-enrollment"
                    data-club={c.name}
                  >
                    <ClubPhoto name={c.name} src={c.photo_path ? photos[c.photo_path] : null} className="size-11 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{c.name}</div>
                      <ScheduleText schedule={c.schedule} className="truncate text-[13px] text-muted" />
                    </div>
                    <EnrollmentBadge status={e.status} position={e.position} />
                    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold">{t("suitable")}</h2>
        <span className="text-sm text-muted">{t("suitableHint", { child: first, age: t("childAge", { count: age }) })}</span>
      </div>
      {suitable.length ? (
        <CatalogGrid clubs={suitable} stats={stats} photos={photos} hrefOf={(c) => `/clubs/${c.id}?child=${kid.id}`} />
      ) : (
        <Card>
          <EmptyState icon={Shapes} title={t("noSuitable")} hint={t("noSuitableHint")} />
        </Card>
      )}
    </>
  );
}

// ───────────────────────────── Staff ─────────────────────────────

/** Compact list of what waits for a decision (requests + queued children whose turn has come). */
export async function PendingList({ items, ctx, canDecide }: { items: PendingItem[]; ctx: KgContext; canDecide: boolean }) {
  const t = await getTranslations("clubs");
  if (!items.length) return null;
  return (
    <Card className="mb-4" data-testid="pending-requests" data-count={items.length}>
      <CardHeader title={t("requests")} action={<Badge tone="sky">{t("requestsCount", { count: items.length })}</Badge>} />
      <ul className="divide-y divide-border">
        {items.map((r) => {
          const outcome = confirmOutcome({ status: r.status, position: r.queue_position }, r.stats);
          return (
            <li key={r.enrollment_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid="pending-item" data-child={r.child_name} data-club={r.club.name}>
              <Link href={`/clubs/${r.club.id}`} className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                <Avatar name={r.child_name} size={40} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.child_name}</div>
                  <div className="truncate text-[13px] text-muted">
                    {r.club.name} · {t("childAge", { count: r.age })} · {formatDate(r.requested_at, ctx.settings.timezone)}
                  </div>
                </div>
              </Link>
              {r.status === "queued" ? <Badge tone="success">{t("queueReady")}</Badge> : null}
              {canDecide ? (
                <div className="ml-auto flex gap-2">
                  <ReasonButton enrollmentId={r.enrollment_id} kind="reject" child={r.child_name} club={r.club.name} />
                  <ConfirmEnrollmentButton enrollmentId={r.enrollment_id} disabled={outcome === "full" || outcome === "order"} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export async function clubTeachers(ctx: KgContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name)")
    .eq("kindergarten_id", ctx.kg.id)
    .eq("role", "club_teacher")
    .eq("status", "active");
  return ((data ?? []) as unknown as { user_id: string; profiles: { full_name: string } | null }[])
    .map((m) => ({ id: m.user_id, name: m.profiles?.full_name ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Owner / head: requests on top, then the catalog; «Новый кружок» is the page action. */
export async function AdminClubs({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("clubs");
  const supabase = await createClient();
  const [clubs, stats] = await Promise.all([loadClubs(supabase, ctx.kg.id), loadStats(supabase, ctx.kg.id)]);
  const [pending, photos] = await Promise.all([loadPending(supabase, clubs, stats), photosOf(clubs)]);
  return (
    <>
      <PendingList items={pending} ctx={ctx} canDecide />
      {clubs.length ? (
        <CatalogGrid
          clubs={clubs}
          stats={stats}
          photos={photos}
          hrefOf={(c) => `/clubs/${c.id}`}
          statusOf={(c) => {
            const n = pending.filter((p) => p.club.id === c.id).length;
            return n ? <Badge tone="sky">{t("requestsCount", { count: n })}</Badge> : null;
          }}
        />
      ) : (
        <Card>
          <EmptyState icon={Shapes} title={t("noClubs")} hint={t("noClubsAdminHint")} action={<ClubDialog teachers={await clubTeachers(ctx)} />} />
        </Card>
      )}
    </>
  );
}

/** Club teacher: own clubs only, with what waits for a decision. */
export async function TeacherClubs({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("clubs");
  const supabase = await createClient();
  const [clubs, stats] = await Promise.all([loadClubs(supabase, ctx.kg.id, { teacherId: ctx.userId }), loadStats(supabase, ctx.kg.id)]);
  const [pending, photos] = await Promise.all([loadPending(supabase, clubs, stats), photosOf(clubs)]);
  if (!clubs.length) {
    return (
      <Card>
        <EmptyState icon={Shapes} title={t("noClubs")} hint={t("noClubsTeacherHint")} />
      </Card>
    );
  }
  return (
    <>
      {pending.length ? (
        <PendingList items={pending} ctx={ctx} canDecide />
      ) : (
        <Card className="mb-4 flex items-center gap-3 py-4" data-testid="pending-requests" data-count={0}>
          <Inbox className="size-5 text-faint" aria-hidden />
          <span className="text-sm text-muted">{t("noRequests")}</span>
        </Card>
      )}
      <h2 className="mb-3 text-[17px] font-bold">{t("myClubs")}</h2>
      <CatalogGrid clubs={clubs} stats={stats} photos={photos} hrefOf={(c) => `/clubs/${c.id}`} testid="my-clubs" showTeacher={false} />
    </>
  );
}

/** Teacher / accountant: read-only catalog (SPEC §3.4 👁). */
export async function CatalogClubs({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("clubs");
  const supabase = await createClient();
  const [clubs, stats] = await Promise.all([loadClubs(supabase, ctx.kg.id), loadStats(supabase, ctx.kg.id)]);
  const photos = await photosOf(clubs);
  if (!clubs.length) {
    return (
      <Card>
        <EmptyState icon={Shapes} title={t("noClubs")} hint={t("noClubsStaffHint")} />
      </Card>
    );
  }
  return <CatalogGrid clubs={clubs} stats={stats} photos={photos} hrefOf={(c) => `/clubs/${c.id}`} />;
}
