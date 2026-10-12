import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarDays, MapPin, UserRound, Users } from "lucide-react";
import { requireKg, type KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/kg-assets";
import { ageOn, todayIn } from "@/lib/format";
import { ageFits, requestOutcome } from "@/lib/clubs";
import { emptyStats, loadChildEnrollments, loadClub, loadRoster, loadStats, type Club } from "@/lib/clubs-data";
import { zUuid } from "@/lib/validation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AgeRange, ClubPhoto, EnrollmentBadge, PlacesText, ScheduleText } from "@/components/clubs/bits";
import { ClubDialog } from "@/components/clubs/club-dialog";
import { DeleteClubButton, EnrollButton, LeaveButton } from "@/components/clubs/actions";
import { ClubRoster } from "@/components/clubs/roster";
import { ChildSwitcher, clubTeachers, parentKids } from "@/components/clubs/views";
import type { ClubStats } from "@/lib/clubs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("clubs");
  if (!zUuid.safeParse(id).success) return { title: t("title") };
  const supabase = await createClient();
  const { data } = await supabase.from("clubs").select("name").eq("id", id).maybeSingle();
  return { title: (data?.name as string | undefined) ?? t("title") };
}

async function Info({ club, stats, photo }: { club: Club; stats: ClubStats; photo: string | null }) {
  const t = await getTranslations("clubs");
  const row = (Icon: typeof Users, label: string, value: React.ReactNode) => (
    <div className="flex gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky-strong">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-faint uppercase">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
  return (
    <Card className="overflow-hidden p-0" data-testid="club-info">
      <div className="md:flex">
        <ClubPhoto name={club.name} src={photo} className="h-40 w-full md:h-auto md:min-h-56 md:w-80 md:shrink-0" />
        <div className="space-y-4 p-5">
          {club.description ? <p className="text-[15px] whitespace-pre-line text-text">{club.description}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {row(Users, t("ageLabel"), <AgeRange from={club.age_from} to={club.age_to} />)}
            {row(CalendarDays, t("scheduleLabel"), <ScheduleText schedule={club.schedule} />)}
            {club.place ? row(MapPin, t("placeLabel"), club.place) : null}
            {club.teacher_name ? row(UserRound, t("teacherLabel"), club.teacher_name) : null}
          </div>
          <div className="text-sm">
            <PlacesText stats={stats} />
          </div>
        </div>
      </div>
    </Card>
  );
}

async function ParentPanel({ ctx, club, stats, childParam }: { ctx: KgContext; club: Club; stats: ClubStats; childParam?: string }) {
  const t = await getTranslations("clubs");
  const kids = await parentKids(ctx);
  if (!kids.length) return null;
  const supabase = await createClient();
  const today = todayIn(ctx.settings.timezone);
  const kid = kids.find((k) => k.id === childParam) ?? kids[0];
  const first = kid.full_name.split(" ")[1] ?? kid.full_name;
  const age = ageOn(kid.birth_date, today);
  const enrollment = (await loadChildEnrollments(supabase, ctx.kg.id, [kid.id])).find((e) => e.club_id === club.id);
  return (
    <>
      <ChildSwitcher kids={kids} selected={kid.id} base={`/clubs/${club.id}`} today={today} />
      <Card data-testid="enroll-panel">
        {enrollment ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-bold">{first}</span>
              <EnrollmentBadge status={enrollment.status} position={enrollment.position} className="text-[13px]" />
            </div>
            {enrollment.status === "queued" ? <p className="basis-full text-[13px] text-muted sm:order-last">{t("queuedHint")}</p> : null}
            <LeaveButton
              enrollmentId={enrollment.id}
              label={enrollment.status === "active" ? t("leave") : enrollment.status === "queued" ? t("leaveQueue") : t("withdraw")}
              child={first}
              club={club.name}
            />
          </div>
        ) : ageFits(club, age) ? (
          <EnrollButton
            clubId={club.id}
            childId={kid.id}
            label={kids.length > 1 ? t("enrollFor", { child: first }) : t("enroll")}
            full={requestOutcome(stats) === "queued"}
          />
        ) : (
          <p className="text-sm text-muted" data-testid="not-for-age">
            {t("notForAge", { range: t("ageRange", { from: club.age_from, to: club.age_to }), child: first, age: t("childAge", { count: age }) })}
          </p>
        )}
      </Card>
    </>
  );
}

export default async function ClubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ child?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher", "club_teacher", "parent"]);
  const { id } = await params;
  if (!zUuid.safeParse(id).success) notFound();
  const sp = await searchParams;
  const t = await getTranslations("clubs");
  const supabase = await createClient();
  const club = await loadClub(supabase, ctx.kg.id, id);
  if (!club) notFound();
  const stats = (await loadStats(supabase, ctx.kg.id))[club.id] ?? emptyStats(club.capacity);
  const photo = await signedUrl("club-photos", club.photo_path);
  const admin = ctx.role === "owner" || ctx.role === "head";
  const showRoster = admin || ctx.role === "accountant" || (ctx.role === "club_teacher" && club.teacher_id === ctx.userId);
  const rows = showRoster ? await loadRoster(supabase, club.id) : [];
  return (
    <>
      <Link href="/clubs" className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden /> {t("back")}
      </Link>
      <PageHeader
        title={club.name}
        actions={
          admin ? (
            <>
              <DeleteClubButton clubId={club.id} name={club.name} />
              <ClubDialog
                teachers={await clubTeachers(ctx)}
                club={{ ...club, hasPhoto: !!club.photo_path }}
              />
            </>
          ) : null
        }
      />
      <div className="space-y-4">
        {ctx.role === "parent" ? <ParentPanel ctx={ctx} club={club} stats={stats} childParam={sp.child} /> : null}
        <Info club={club} stats={stats} photo={photo} />
        {showRoster ? (
          <ClubRoster
            club={club}
            rows={rows}
            stats={stats}
            rights={{ decide: admin || ctx.role === "club_teacher", exclude: admin, write: admin || ctx.role === "club_teacher" }}
            today={todayIn(ctx.settings.timezone)}
            tz={ctx.settings.timezone}
          />
        ) : null}
      </div>
    </>
  );
}
