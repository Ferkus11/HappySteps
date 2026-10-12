"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { cancellable, type AbsenceReason } from "@/lib/attendance-logic";
import { formatDate } from "@/lib/format";
import { cancelAbsenceAction } from "@/app/(app)/attendance/actions";
import { ReasonIcon } from "./reason";

export interface UpcomingReport {
  id: string;
  childName?: string;
  date_from: string;
  date_to: string;
  reason: AbsenceReason;
  comment: string | null;
}

/** Parent's current/upcoming absence reports with "cancel" (before the day starts). */
export function AbsenceList({ items, today }: { items: UpcomingReport[]; today: string }) {
  const t = useTranslations("attendance");
  const cancel = useAction(cancelAbsenceAction, { success: t("cancelled") });
  if (!items.length) return null;
  return (
    <ul className="space-y-2" data-testid="absence-list">
      {items.map((r) => {
        const can = cancellable(r, today);
        return (
          <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-tile-absent/60 px-3 py-2.5 text-sm" data-testid="absence-item">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-tile-absent-fg">
              <ReasonIcon reason={r.reason} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {r.childName ? `${r.childName} · ` : ""}
                {t(`reasons.${r.reason}`)}
              </div>
              <div className="truncate text-muted">
                {r.date_from === r.date_to ? formatDate(r.date_from) : `${formatDate(r.date_from)} — ${formatDate(r.date_to)}`}
                {r.comment ? ` · ${r.comment}` : ""}
              </div>
            </div>
            {can ? (
              <Confirm
                trigger={
                  <button
                    type="button"
                    className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface"
                    aria-label={t("cancelReport")}
                    data-testid="cancel-absence"
                  >
                    <X className="size-4" />
                  </button>
                }
                title={t("cancelReport")}
                description={can === "whole" ? t("cancelWhole") : t("cancelRest")}
                confirmLabel={t("cancelReport")}
                onConfirm={() => cancel.run(r.id)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
