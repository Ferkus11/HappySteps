import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, ChevronLeft, MessageCircle, Phone } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { groupSummaries } from "@/lib/queries/groups";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ageOn, formatDate, formatDateTime, todayIn } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { WAITLIST_COLUMNS, type WaitlistRow } from "@/lib/waitlist-data";
import type { WaitlistStatus } from "@/lib/waitlist";
import { WaitlistStatusBadge } from "@/components/waitlist/status-badge";
import { AcceptDialog, CommentForm, DeleteApplication, StatusButtons } from "./client";

interface TimelineItem {
  id: string;
  kind: "comment" | "status" | "created";
  body: string | null;
  status: WaitlistStatus | null;
  created_at: string;
  author: string | null;
}

export async function generateMetadata() {
  return { title: (await getTranslations("waitlist"))("title") };
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg(["owner", "head", "accountant"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("waitlist");
  const tch = await getTranslations("children");
  const supabase = await createClient();
  const { data } = await supabase
    .from("waitlist_applications")
    .select(WAITLIST_COLUMNS)
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  if (!data) notFound();
  const app = data as WaitlistRow;
  const isAdmin = ctx.role === "owner" || ctx.role === "head";
  const tz = ctx.settings.timezone;
  const today = todayIn(tz);

  const [{ data: comments }, groups, { data: fees }, { data: child }] = await Promise.all([
    supabase
      .from("waitlist_comments")
      .select("id, kind, body, status, created_at, profiles(full_name)")
      .eq("application_id", id)
      .order("created_at"),
    isAdmin && app.status !== "accepted" ? groupSummaries(supabase, ctx.kg.id) : Promise.resolve([]),
    isAdmin && app.status !== "accepted"
      ? supabase.from("children").select("monthly_fee").eq("kindergarten_id", ctx.kg.id).eq("status", "active").limit(500)
      : Promise.resolve({ data: [] as { monthly_fee: number }[] }),
    app.child_id ? supabase.from("children").select("id, full_name").eq("id", app.child_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Suggested fee for the new child: the most common fee in the kindergarten.
  const freq = new Map<number, number>();
  for (const f of fees ?? []) freq.set(Number(f.monthly_fee), (freq.get(Number(f.monthly_fee)) ?? 0) + 1);
  const defaultFee = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;

  const timeline: TimelineItem[] = [
    { id: "created", kind: "created", body: null, status: null, created_at: app.created_at, author: null },
    ...((comments ?? []) as unknown as (Omit<TimelineItem, "author"> & { profiles: { full_name: string } | null })[]).map((c) => ({
      ...c,
      author: c.profiles?.full_name ?? null,
    })),
  ];
  const phoneHref = `tel:${app.parent_phone}`;

  return (
    <>
      <Link href="/waitlist" className="-mt-1 mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-text">
        <ChevronLeft className="size-4" aria-hidden /> {t("back")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span data-user-content data-testid="wl-title">{app.child_name}</span>
            <WaitlistStatusBadge status={app.status} className="px-3 py-1 text-sm tracking-normal" />
          </span>
        }
        description={`${t("receivedOn", { date: formatDate(app.created_at, tz) })} · ${t(`source.${app.source}`)}`}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card>
            <dl className="grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-faint uppercase">{t("child")}</dt>
                <dd data-user-content className="mt-1 font-bold">{app.child_name}</dd>
                <dd className="text-sm text-muted">
                  {formatDate(app.child_birth_date)} · {tch("age", { count: ageOn(app.child_birth_date, today) })}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-faint uppercase">{t("desiredDate")}</dt>
                <dd className="mt-1 font-bold">{app.desired_date ? formatDate(app.desired_date) : <span className="font-normal text-muted">{t("noDesiredDate")}</span>}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-faint uppercase">{t("parent")}</dt>
                <dd data-user-content className="mt-1 font-bold">{app.parent_name}</dd>
                <dd className="text-sm text-muted" data-testid="wl-phone">
                  {formatPhone(app.parent_phone)}
                </dd>
                <dd className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={phoneHref}>
                      <Phone /> {t("call")}
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={whatsappLink(app.parent_phone, "")} target="_blank" rel="noreferrer">
                      <MessageCircle /> {t("whatsapp")}
                    </a>
                  </Button>
                </dd>
              </div>
              {app.comment ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-faint uppercase">{t("parentComment")}</dt>
                  <dd data-user-content className="mt-1 rounded-2xl bg-surface-muted p-3 text-sm whitespace-pre-line">{app.comment}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {app.status === "accepted" ? (
            <Card className="border-success/30 bg-success-soft" data-testid="wl-accepted-card">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-success">{t("acceptedOn", { date: formatDate(app.accepted_at, tz) })}</p>
                  {child ? <p data-user-content className="text-sm text-text">{child.full_name}</p> : null}
                </div>
              </div>
              {child ? (
                <Button asChild variant="outline" className="mt-4 w-full sm:w-auto">
                  <Link href={`/children/${child.id}`} data-testid="wl-child-link">
                    {t("openChild")}
                  </Link>
                </Button>
              ) : null}
            </Card>
          ) : isAdmin ? (
            <Card>
              <CardHeader title={t("statusTitle")} />
              <div className="space-y-3">
                <AcceptDialog
                  id={app.id}
                  app={{
                    childName: app.child_name,
                    childBirthDate: app.child_birth_date,
                    parentName: app.parent_name,
                    parentPhone: app.parent_phone,
                    desiredDate: app.desired_date,
                  }}
                  groups={groups.map((g) => ({ id: g.id, name: g.name, capacity: g.capacity, activeCount: g.activeCount }))}
                  defaultFee={defaultFee}
                  today={today}
                />
                <StatusButtons id={app.id} status={app.status} />
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <DeleteApplication id={app.id} name={app.child_name} />
              </div>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader title={t("history")} />
          <ol className="space-y-4" data-testid="wl-timeline">
            {timeline.map((e) => (
              <li key={e.id} className="relative pl-5">
                <span
                  className={`absolute top-1.5 left-0 size-2.5 rounded-full ${e.kind === "comment" ? "bg-sky" : e.status === "accepted" ? "bg-success" : "bg-border"}`}
                  aria-hidden
                />
                <div className="text-xs text-faint">
                  {formatDateTime(e.created_at, tz)}
                  {e.author ? ` · ${e.author}` : ""}
                </div>
                {e.kind === "comment" ? (
                  <p data-user-content className="mt-0.5 text-sm whitespace-pre-line" data-testid="wl-comment">
                    {e.body}
                  </p>
                ) : e.kind === "status" && e.status ? (
                  <p className="mt-0.5 text-sm font-semibold">{t("eventStatus", { status: t(`status.${e.status}`) })}</p>
                ) : (
                  <p className="mt-0.5 text-sm font-semibold">{app.source === "public" ? t("eventCreatedPublic") : t("eventCreatedManual")}</p>
                )}
              </li>
            ))}
          </ol>
          {isAdmin ? <CommentForm id={app.id} /> : null}
        </Card>
      </div>
    </>
  );
}
