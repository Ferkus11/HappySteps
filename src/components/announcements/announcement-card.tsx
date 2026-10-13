import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText, Image as ImageIcon, Pin } from "lucide-react";
import type { AnnouncementListItem } from "@/lib/announcements";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function audienceText(a: { audience: AnnouncementListItem["audience"]; groups: { name: string }[] }) {
  const t = await getTranslations("announcements");
  if (a.audience === "groups") return a.groups.map((g) => g.name).join(", ") || t("audiences.groups");
  return t(`audiences.${a.audience}`);
}

/** One announcement in a list. "Важное" is the single accent: tinted card + pin. */
export async function AnnouncementCard({ a, timezone, compact }: { a: AnnouncementListItem; timezone: string; compact?: boolean }) {
  const t = await getTranslations("announcements");
  const audience = await audienceText(a);
  // In the list the title sits right under the page <h1>; in the dashboard widget, under the card's <h2>.
  const Heading = compact ? "h3" : "h2";
  return (
    <Link
      href={`/announcements/${a.id}`}
      data-testid="announcement-item"
      data-important={a.important ? "true" : undefined}
      className={cn(
        "block rounded-2xl border p-4 transition-shadow hover:shadow-md",
        a.important ? "border-brand/30 bg-brand-soft" : "border-border/70 bg-surface",
        compact && "p-3",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {a.important ? <Pin className="size-4 shrink-0 text-brand" role="img" aria-label={t("important")} /> : null}
            <Heading data-user-content className={cn("min-w-0 truncate font-bold", !a.read && "text-text")}>
              {a.title}
            </Heading>
            {!a.read ? <span className="size-2.5 shrink-0 rounded-full bg-sky" data-testid="unread-dot" role="img" aria-label={t("unread")} /> : null}
          </div>
          {!compact && a.body ? <p data-user-content className="mt-1 line-clamp-2 text-sm text-muted">{a.body}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
            <span>{formatDate(a.created_at, timezone)}</span>
            {!compact ? (
              <span className="truncate" data-user-content={a.audience === "groups" && a.groups.length ? "" : undefined}>
                {audience}
              </span>
            ) : null}
            {a.photos ? (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="size-3.5" aria-hidden /> {a.photos}
              </span>
            ) : null}
            {a.pdfs ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" aria-hidden /> {a.pdfs}
              </span>
            ) : null}
            {a.stats ? <span data-testid="read-stats-short">{t("readOf", { read: a.stats.read, total: a.stats.total })}</span> : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
