import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CheckCheck, FileText, Pin } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { canManage, reminderLocked } from "@/lib/announcements";
import { publishTargets, type Audience } from "@/lib/audience";
import { signedUrls } from "@/lib/kg-assets";
import { formatDateTime } from "@/lib/format";
import { zUuid } from "@/lib/validation";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ring } from "@/components/ui/ring";
import { Avatar } from "@/components/ui/avatar";
import { AnnouncementDialog } from "@/components/announcements/announcement-dialog";
import { DeleteAnnouncement, Gallery, MarkRead, RemindButton } from "@/components/announcements/detail-client";
import { audienceText } from "@/components/announcements/announcement-card";

type Detail = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  audience: Audience;
  created_at: string;
  updated_at: string;
  reminded_at: string | null;
  author_id: string | null;
  author: { full_name: string } | null;
  announcement_groups: { group_id: string; groups: { name: string; color: string } | null }[];
  announcement_files: { id: string; kind: "photo" | "pdf"; path: string; name: string; size: number; created_at: string }[];
};

export async function generateMetadata() {
  return { title: (await getTranslations("announcements"))("title") };
}

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!zUuid.safeParse(id).success) notFound();
  const ctx = await requireKg();
  const t = await getTranslations("announcements");
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select(
      "id, title, body, important, audience, created_at, updated_at, reminded_at, author_id, author:profiles!announcements_author_id_fkey(full_name), announcement_groups(group_id, groups(name, color)), announcement_files(id, kind, path, name, size, created_at)",
    )
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  if (!data) notFound();
  const a = data as unknown as Detail;
  const files = [...a.announcement_files].sort((x, y) => x.created_at.localeCompare(y.created_at));
  const urls = await signedUrls("announcements", files.map((f) => f.path), 600);
  const photos = files.filter((f) => f.kind === "photo" && urls[f.path]).map((f) => ({ id: f.id, url: urls[f.path], name: f.name }));
  const pdfs = files.filter((f) => f.kind === "pdf");
  const manage = canManage(ctx, a.author_id);
  const tz = ctx.settings.timezone;

  let audience: { user_id: string; full_name: string; read_at: string | null }[] = [];
  let targets = null;
  if (manage) {
    const [aud, tg] = await Promise.all([supabase.rpc("announcement_audience", { p_id: id }), publishTargets(supabase, ctx)]);
    audience = (aud.data ?? []) as typeof audience;
    targets = tg;
  }
  const readCount = audience.filter((r) => r.read_at).length;
  const unread = audience.filter((r) => !r.read_at);
  const remindLocked = reminderLocked(a.reminded_at);
  const groups = a.announcement_groups.map((g) => g.groups).filter((g): g is { name: string; color: string } => !!g);

  return (
    <>
      <MarkRead id={a.id} />
      <Link href="/announcements" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden /> {t("title")}
      </Link>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className={a.important ? "border-brand/30" : undefined}>
          {a.important ? (
            <Badge tone="brand" className="mb-3">
              <Pin className="size-3.5" aria-hidden /> {t("important")}
            </Badge>
          ) : null}
          <h1 className="text-[22px] leading-tight font-extrabold tracking-tight md:text-[26px]" data-testid="announcement-heading">
            {a.title}
          </h1>
          <p className="mt-2 text-[13px] text-faint">
            {[a.author?.full_name, formatDateTime(a.created_at, tz), await audienceText({ audience: a.audience, groups })].filter(Boolean).join(" · ")}
          </p>
          {a.body ? <div className="mt-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{a.body}</div> : null}
          {photos.length ? (
            <div className="mt-5">
              <Gallery photos={photos} title={a.title} />
            </div>
          ) : null}
          {pdfs.length ? (
            <ul className="mt-5 space-y-2" data-testid="announcement-attachments">
              {pdfs.map((f) => (
                <li key={f.id}>
                  <a
                    href={urls[f.path]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center gap-3 rounded-xl border border-border px-3 text-sm hover:bg-surface-muted"
                  >
                    <FileText className="size-5 shrink-0 text-sky-strong" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {manage ? (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
              {targets ? (
                <AnnouncementDialog
                  audiences={targets.audiences}
                  groups={targets.groups}
                  announcement={{
                    id: a.id,
                    title: a.title,
                    body: a.body,
                    audience: a.audience,
                    groupIds: a.announcement_groups.map((g) => g.group_id),
                    important: a.important,
                    files: files.map((f) => ({ id: f.id, kind: f.kind, name: f.name })),
                  }}
                />
              ) : null}
              <DeleteAnnouncement id={a.id} />
            </div>
          ) : null}
        </Card>
        {manage ? (
          <Card className="self-start" data-testid="read-stats">
            <CardHeader title={t("stats")} />
            <div className="flex items-center gap-4">
              <Ring value={audience.length ? (readCount / audience.length) * 100 : 0} size={64} stroke={7} />
              <div>
                <div className="text-[26px] leading-none font-extrabold" data-testid="read-count">
                  {t("readOf", { read: readCount, total: audience.length })}
                </div>
                <div className="mt-1 text-[13px] text-muted">{t("readCaption")}</div>
              </div>
            </div>
            {unread.length ? (
              <>
                <div className="mt-5 mb-2 text-[13px] font-semibold text-muted">{t("notRead", { count: unread.length })}</div>
                <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="unread-list">
                  {unread.map((u) => (
                    <li key={u.user_id} className="flex min-h-10 items-center gap-2.5 text-sm">
                      <Avatar name={u.full_name} size={28} />
                      <span className="truncate">{u.full_name}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4">
                  <RemindButton id={a.id} disabled={remindLocked} />
                  {a.reminded_at ? <p className="mt-2 text-[13px] text-faint">{t("remindedAt", { time: formatDateTime(a.reminded_at, tz) })}</p> : null}
                </div>
              </>
            ) : (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-success">
                <CheckCheck className="size-4" aria-hidden /> {t("allRead")}
              </p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
