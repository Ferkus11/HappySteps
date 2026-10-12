"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, CheckCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReasonIcon } from "@/components/attendance/reason";
import { useAction } from "@/hooks/use-action";
import { dayProgress, type AbsenceReason, type Effective } from "@/lib/attendance-logic";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markAllPresentAction, markAttendanceAction } from "./actions";

export interface MarkChild {
  id: string;
  name: string;
  photo: string | null;
  allergies: string | null;
  effective: Effective;
  report: { reason: AbsenceReason; comment: string | null; from: string; to: string } | null;
}

export function Marking({ groupId, date, items, editable }: { groupId: string; date: string; items: MarkChild[]; editable: boolean }) {
  const t = useTranslations("attendance");
  // Optimistic overrides until the refreshed server data arrives (the page re-keys this component then).
  const [over, setOver] = React.useState<Record<string, Effective>>({});
  const mark = useAction(markAttendanceAction);
  const all = useAction(markAllPresentAction, { onSuccess: (d) => (d.count ? toast.success(t("allMarked", { count: d.count })) : undefined) });
  const eff = (c: MarkChild) => over[c.id] ?? c.effective;
  const progress = dayProgress(items.map(eff));
  const pct = progress.total ? Math.round((progress.marked / progress.total) * 100) : 0;
  const unmarked = progress.total - progress.marked;

  const set = async (c: MarkChild, status: "present" | "absent") => {
    const prev = over[c.id];
    setOver((o) => ({ ...o, [c.id]: status === "present" ? { status } : { status, reason: c.report?.reason ?? null, fromReport: false } }));
    const r = await mark.run({ groupId, date, marks: [{ childId: c.id, status }] });
    if (!r?.ok)
      setOver((o) => {
        const n = { ...o };
        if (prev) n[c.id] = prev;
        else delete n[c.id];
        return n;
      });
  };

  return (
    <>
      <div className="mb-4 rounded-card border border-border/70 bg-surface p-4 shadow-card md:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-muted">{t("progressLabel")}</div>
            <div className="mt-1 text-[26px] leading-none font-extrabold" data-testid="attendance-progress">
              {t("progress", { marked: progress.marked, total: progress.total })}
            </div>
          </div>
          <div className="flex gap-3 text-right text-sm">
            <div>
              <div className="text-xl leading-none font-extrabold text-success" data-testid="attendance-present-count">
                {progress.present}
              </div>
              <div className="mt-1 text-xs text-muted">{t("presentShort")}</div>
            </div>
            <div>
              <div className="text-xl leading-none font-extrabold text-tile-absent-fg" data-testid="attendance-absent-count">
                {progress.absent}
              </div>
              <div className="mt-1 text-xs text-muted">{t("absentShort")}</div>
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--ring-track)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
        </div>
        {editable && unmarked > 0 ? (
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
            <Button size="lg" className="w-full md:w-auto md:min-w-64" onClick={() => all.run({ groupId, date })} disabled={all.pending} data-testid="mark-all-present">
              <CheckCheck /> {t("allPresent")}
            </Button>
            <p className="text-center text-xs text-faint md:text-left">{t("allPresentHint")}</p>
          </div>
        ) : null}
      </div>

      <ul className="space-y-2.5" data-testid="attendance-list">
        {items.map((c) => {
          const e = eff(c);
          return (
            <li
              key={c.id}
              className={cn(
                "rounded-card border border-border/70 bg-surface p-3 shadow-card transition-colors md:p-4",
                e.status === "present" && "border-success/30",
                e.status === "absent" && "bg-tile-absent/40",
              )}
              data-testid="attendance-child"
              data-child={c.name}
              data-status={e.status}
            >
              <div className="flex items-center gap-3">
                <Avatar name={c.name} src={c.photo} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] leading-snug font-bold break-words">{c.name}</div>
                  {c.report ? (
                    <div className="mt-0.5 flex items-start gap-1.5 text-[13px] leading-snug font-semibold text-tile-absent-fg" data-testid="child-report">
                      <ReasonIcon reason={c.report.reason} className="mt-0.5 size-3.5" />
                      <span className="line-clamp-2 break-words">
                        {t(`reasons.${c.report.reason}`)}
                        {c.report.to > date ? ` · ${t("until", { date: formatDate(c.report.to).slice(0, 5) })}` : ""}
                        {c.report.comment ? ` · ${c.report.comment}` : ""}
                      </span>
                    </div>
                  ) : e.status === "none" ? (
                    <div className="mt-0.5 text-[13px] text-faint">{t("notMarked")}</div>
                  ) : null}
                </div>
                {!editable ? (
                  <StatusPill e={e} />
                ) : (
                  <div className="grid shrink-0 grid-cols-2 gap-1.5" role="group" aria-label={c.name}>
                    <ToggleButton active={e.status === "present"} tone="present" onClick={() => set(c, "present")} label={t("present")} testId="mark-present" />
                    <ToggleButton active={e.status === "absent"} tone="absent" onClick={() => set(c, "absent")} label={t("absent")} testId="mark-absent" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ToggleButton({ active, tone, onClick, label, testId }: { active: boolean; tone: "present" | "absent"; onClick: () => void; label: string; testId: string }) {
  const Icon = tone === "present" ? Check : X;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-14 w-[68px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl border text-[12px] font-bold transition-colors select-none active:scale-[0.97]",
        !active && "border-border bg-surface-muted text-muted",
        active && tone === "present" && "border-success bg-success text-white",
        active && tone === "absent" && "border-tile-absent-fg bg-tile-absent-fg text-white",
      )}
    >
      <Icon className="size-5" strokeWidth={2.6} aria-hidden />
      {label}
    </button>
  );
}

function StatusPill({ e }: { e: Effective }) {
  const t = useTranslations("attendance");
  if (e.status === "present") return <span className="shrink-0 rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success">{t("present")}</span>;
  if (e.status === "absent") return <span className="shrink-0 rounded-full bg-tile-absent px-3 py-1 text-xs font-bold text-tile-absent-fg">{t("absent")}</span>;
  return <span className="shrink-0 rounded-full bg-tile-unmarked px-3 py-1 text-xs font-bold text-tile-unmarked-fg">{t("notMarkedShort")}</span>;
}
