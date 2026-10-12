"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { deleteAnnouncementAction, markAnnouncementReadAction, remindAnnouncementAction } from "@/app/(app)/announcements/actions";

/** Marks the announcement read once it is actually opened (not on link prefetch). */
export function MarkRead({ id }: { id: string }) {
  React.useEffect(() => {
    markAnnouncementReadAction(id).catch(() => {});
  }, [id]);
  return null;
}

export function Gallery({ photos, title }: { photos: { id: string; url: string; name: string }[]; title: string }) {
  const t = useTranslations("announcements");
  const [index, setIndex] = React.useState<number | null>(null);
  if (!photos.length) return null;
  const cur = index === null ? null : photos[index];
  return (
    <>
      <ul className={photos.length === 1 ? "grid" : "grid grid-cols-2 gap-2 sm:grid-cols-3"} data-testid="announcement-gallery">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" onClick={() => setIndex(i)} className="block w-full cursor-zoom-in overflow-hidden rounded-2xl bg-surface-muted" aria-label={t("openPhoto", { n: i + 1 })}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs, no optimizer */}
              <img src={p.url} alt={p.name} className={photos.length === 1 ? "max-h-[420px] w-full object-contain" : "aspect-square w-full object-cover"} loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={cur !== null} onOpenChange={(v) => !v && setIndex(null)}>
        {cur ? (
          <DialogContent title={title} description={t("photoOf", { n: (index ?? 0) + 1, total: photos.length })} className="md:w-[min(92vw,960px)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs */}
            <img src={cur.url} alt={cur.name} className="mx-auto max-h-[70dvh] w-auto rounded-xl object-contain" />
            {photos.length > 1 ? (
              <div className="mt-4 flex justify-between">
                <Button variant="outline" size="icon" aria-label={t("prev")} onClick={() => setIndex(((index ?? 0) - 1 + photos.length) % photos.length)}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon" aria-label={t("next")} onClick={() => setIndex(((index ?? 0) + 1) % photos.length)}>
                  <ChevronRight />
                </Button>
              </div>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export function RemindButton({ id, disabled }: { id: string; disabled: boolean }) {
  const t = useTranslations("announcements");
  const [sent, setSent] = React.useState(false);
  const a = useAction(remindAnnouncementAction, {
    onSuccess: (d) => {
      setSent(true);
      toast.success(t("reminded", { count: d.count }));
    },
  });
  return (
    <Button variant="secondary" onClick={() => a.run(id)} disabled={disabled || sent || a.pending} data-testid="remind">
      <BellRing /> {t("remind")}
    </Button>
  );
}

export function DeleteAnnouncement({ id }: { id: string }) {
  const t = useTranslations("announcements");
  const router = useRouter();
  const a = useAction(deleteAnnouncementAction, { refresh: false, onSuccess: () => router.push("/announcements") });
  return (
    <Confirm
      trigger={
        <Button variant="ghost" data-testid="delete-announcement">
          <Trash2 /> {t("delete")}
        </Button>
      }
      title={t("deleteTitle")}
      description={t("deleteHint")}
      confirmLabel={t("delete")}
      danger
      onConfirm={() => a.run(id)}
    />
  );
}
