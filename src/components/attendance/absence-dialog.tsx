"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarX2, FileHeart, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { useAction } from "@/hooks/use-action";
import { ABSENCE_REASONS, type AbsenceReason } from "@/lib/attendance-logic";
import { addDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { reportAbsenceAction } from "@/app/(app)/attendance/actions";
import { REASON_ICONS } from "./reason";

/** "Ребёнок не придёт" — single day or period, reason, comment (SPEC §5.3). */
export function ReportAbsenceButton({
  kids,
  childId,
  today,
  className,
  variant = "outline",
}: {
  kids: { id: string; name: string }[];
  childId?: string;
  today: string;
  className?: string;
  variant?: "outline" | "secondary" | "primary";
}) {
  const t = useTranslations("attendance");
  const td = useTranslations("documents");
  const [sentFor, setSentFor] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [done, setDone] = React.useState<AbsenceReason | null>(null);
  const [mode, setMode] = React.useState<"day" | "period">("day");
  const [reason, setReason] = React.useState<AbsenceReason>("sick");
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(addDays(today, 2));
  const { run, pending, fieldError } = useAction(reportAbsenceAction, { onSuccess: (d) => setDone(d.reason) });
  const reset = () => {
    setDone(null);
    setMode("day");
    setReason("sick");
    setFrom(today);
    setTo(addDays(today, 2));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} className={className} data-testid="report-absence">
          <CalendarX2 /> {t("reportAbsence")}
        </Button>
      </DialogTrigger>
      <DialogContent title={done ? t("reportedTitle") : t("reportAbsence")} description={done ? undefined : t("reportHint")}>
        {done ? (
          <div className="space-y-4" data-testid="absence-done">
            <div className="flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-success">
              <PartyPopper className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="text-sm font-semibold">{t("reportedText")}</p>
            </div>
            {done === "sick" ? (
              <div className="flex items-start gap-3 rounded-2xl bg-sky-soft p-4 text-sky-strong" data-testid="absence-sick-hint">
                <FileHeart className="mt-0.5 size-5 shrink-0" aria-hidden />
                <p className="text-sm">
                  {t("sickHint")}{" "}
                  {sentFor ? (
                    <Link href={`/documents/child/${sentFor}?category=medical`} className="font-semibold underline" data-testid="absence-upload-certificate">
                      {td("uploadCertificate")}
                    </Link>
                  ) : null}
                </p>
              </div>
            ) : null}
            <Button className="w-full" onClick={() => setOpen(false)}>
              {t("ok")}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setSentFor(String(f.get("child") ?? childId ?? kids[0]?.id ?? ""));
              run({
                childId: String(f.get("child") ?? childId ?? kids[0]?.id),
                from,
                to: mode === "day" ? from : to,
                reason,
                comment: String(f.get("comment") ?? ""),
              });
            }}
          >
            {kids.length > 1 ? (
              <Field label={t("child")} htmlFor="ab-child">
                <Select id="ab-child" name="child" defaultValue={childId ?? kids[0]?.id}>
                  {kids.map((k) => (
                    <option data-user-content key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="child" value={childId ?? kids[0]?.id ?? ""} />
            )}
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-muted p-1" role="radiogroup" aria-label={t("when")}>
              {(["day", "period"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  data-testid={`absence-mode-${m}`}
                  className={cn("h-11 cursor-pointer rounded-xl text-sm font-semibold text-muted", mode === m && "bg-surface text-text shadow-sm")}
                >
                  {t(m === "day" ? "oneDay" : "period")}
                </button>
              ))}
            </div>
            <div className={cn("grid gap-3", mode === "period" && "grid-cols-2")}>
              <Field label={mode === "day" ? t("date") : t("from")} htmlFor="ab-from" error={fieldError("from")}>
                <DateField
                  id="ab-from"
                  min={today}
                  value={from}
                  onChange={(v) => {
                    setFrom(v);
                    if (v && to < v) setTo(v);
                  }}
                  required
                  data-testid="absence-from"
                />
              </Field>
              {mode === "period" ? (
                <Field label={t("to")} htmlFor="ab-to" error={fieldError("to")}>
                  <DateField id="ab-to" min={from || today} value={to} onChange={setTo} required data-testid="absence-to" />
                </Field>
              ) : null}
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-[13px] font-semibold text-muted">{t("reason")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {ABSENCE_REASONS.map((r) => {
                  const Icon = REASON_ICONS[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={reason === r}
                      onClick={() => setReason(r)}
                      data-testid={`absence-reason-${r}`}
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-left text-sm font-semibold text-text",
                        reason === r && "border-brand bg-brand-soft text-brand",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {t(`reasons.${r}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field label={t("comment")} htmlFor="ab-comment" error={fieldError("comment")}>
              <Textarea id="ab-comment" name="comment" rows={2} maxLength={500} placeholder={t("commentPlaceholder")} />
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="absence-submit">
              {t("send")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
