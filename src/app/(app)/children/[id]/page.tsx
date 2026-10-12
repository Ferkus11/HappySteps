import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups } from "@/lib/queries/people";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ageOn, formatDate, formatMoney, todayIn } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { signedUrl } from "@/lib/kg-assets";
import { ChildAttendanceCard } from "@/components/attendance/child-attendance-card";
import { ChildPaymentCard } from "@/components/payments/child-card";
import { ChildAdminActions, EditChild, GuardianRow, AddGuardian, PhotoUpload } from "./client";

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg();
  const t = await getTranslations("children");
  const supabase = await createClient();
  const { data: child } = await supabase
    .from("children")
    .select("id, full_name, birth_date, group_id, enrolled_on, allergies, medical_notes, monthly_fee, status, archive_reason, photo_path")
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  if (!child) notFound();
  const [groups, { data: guardians }, { data: history }, photo] = await Promise.all([
    listGroups(supabase, ctx.kg.id),
    supabase.from("child_guardians").select("user_id, relation, profiles(full_name, phone)").eq("child_id", id),
    supabase.from("child_group_history").select("id, group_id, from_date, to_date").eq("child_id", id).order("from_date", { ascending: false }),
    signedUrl("child-photos", child.photo_path, 600),
  ]);
  const group = groups.find((g) => g.id === child.group_id);
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const showMoney = ["owner", "head", "accountant", "parent"].includes(ctx.role);
  const today = todayIn(ctx.settings.timezone);
  const gName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? "—";

  return (
    <>
      <PageHeader title={t("card")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-4">
              <div className="relative">
                <Avatar name={child.full_name} src={photo} size={72} />
                {isAdmin ? <PhotoUpload childId={child.id} /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold" data-testid="child-name">{child.full_name}</h2>
                <p className="mt-0.5 text-muted">
                  {t("age", { count: ageOn(child.birth_date, today) })} · {formatDate(child.birth_date)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group ? (
                    <Badge tone="sky">
                      <span className="size-2 rounded-full" style={{ background: group.color }} aria-hidden /> {group.name}
                    </Badge>
                  ) : (
                    <Badge>{t("noGroup")}</Badge>
                  )}
                  {child.status === "archived" ? <Badge tone="danger">{t("archived")}</Badge> : null}
                </div>
              </div>
              {isAdmin ? (
                <EditChild
                  child={{
                    id: child.id,
                    fullName: child.full_name,
                    birthDate: child.birth_date,
                    enrolledOn: child.enrolled_on,
                    monthlyFee: Number(child.monthly_fee),
                    allergies: child.allergies ?? "",
                    medicalNotes: child.medical_notes ?? "",
                  }}
                />
              ) : null}
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs text-faint">{t("enrolledOn")}</dt>
                <dd className="font-semibold">{formatDate(child.enrolled_on)}</dd>
              </div>
              {showMoney ? (
                <div>
                  <dt className="text-xs text-faint">{t("monthlyFee")}</dt>
                  <dd className="font-semibold">{formatMoney(child.monthly_fee)}</dd>
                </div>
              ) : null}
              {child.status === "archived" && child.archive_reason ? (
                <div>
                  <dt className="text-xs text-faint">{t("archiveReason")}</dt>
                  <dd className="font-semibold">{t(`archiveReasons.${child.archive_reason}` as "archiveReasons.other")}</dd>
                </div>
              ) : null}
            </dl>
            {isAdmin ? (
              <div className="mt-5">
                <ChildAdminActions
                  childId={child.id}
                  status={child.status}
                  groups={groups.filter((g) => g.id !== child.group_id).map((g) => ({ id: g.id, name: g.name }))}
                  today={today}
                />
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title={t("medical")} />
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-faint">{t("allergies")}</dt>
                <dd className={child.allergies ? "font-semibold text-warning" : "text-muted"}>{child.allergies || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">{t("medicalNotes")}</dt>
                <dd className="whitespace-pre-line">{child.medical_notes || "—"}</dd>
              </div>
            </dl>
          </Card>
        </div>
        <div className="space-y-4">
          <ChildAttendanceCard ctx={ctx} child={child} />
          <ChildPaymentCard ctx={ctx} childId={child.id} />
          <Card>
            <CardHeader title={t("parents")} action={isAdmin && child.status === "active" ? <AddGuardian childId={child.id} /> : null} />
            {guardians?.length ? (
              <ul className="space-y-3">
                {(guardians as unknown as { user_id: string; relation: string | null; profiles: { full_name: string; phone: string } | null }[]).map((g) => (
                  <GuardianRow
                    key={g.user_id}
                    childId={child.id}
                    userId={g.user_id}
                    name={g.profiles?.full_name ?? "—"}
                    phone={formatPhone(g.profiles?.phone)}
                    relation={g.relation}
                    canUnlink={isAdmin}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("noParents")}</p>
            )}
          </Card>
          {ctx.role !== "parent" && history?.length ? (
            <Card>
              <CardHeader title={t("history")} />
              <ol className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-3">
                    <span className="font-semibold">{gName(h.group_id)}</span>
                    <span className="text-muted">
                      {formatDate(h.from_date)} — {h.to_date ? formatDate(h.to_date) : t("now")}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
