"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { ABSENCE_KINDS, type AbsenceKind } from "@/lib/worktime";
import {
  addAbsenceAction,
  addSessionAction,
  editSessionAction,
  removeAbsenceAction,
  removeOverrideAction,
  saveScheduleAction,
  setOverrideAction,
} from "../../actions";
import { DateField } from "@/components/ui/date-field";

type Day = { weekday: number; start: string; end: string };
const WEEK = [1, 2, 3, 4, 5, 6, 7];

export function ScheduleEditor({ userId, days, canEdit }: { userId: string; days: Day[]; canEdit: boolean }) {
  const t = useTranslations("worktime");
  const tc = useTranslations("common");
  const initial = React.useMemo(() => {
    const m = new Map(days.map((d) => [d.weekday, d]));
    return WEEK.map((w) => ({ weekday: w, on: m.has(w), start: m.get(w)?.start ?? "08:00", end: m.get(w)?.end ?? "17:00" }));
  }, [days]);
  const [rows, setRows] = React.useState(initial);
  const save = useAction(saveScheduleAction, { success: tc("saved") });
  const set = (w: number, patch: Partial<(typeof rows)[number]>) => setRows((s) => s.map((r) => (r.weekday === w ? { ...r, ...patch } : r)));

  if (!canEdit) {
    return (
      <ul className="space-y-1 text-sm">
        {initial.map((r) => (
          <li key={r.weekday} className="flex min-h-9 items-center justify-between border-b border-border last:border-0">
            <span className="font-semibold">{t(`weekdaysLong.${r.weekday}`)}</span>
            <span className={r.on ? "tabular-nums" : "text-muted"}>{r.on ? `${r.start}–${r.end}` : t("dayOff")}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" data-testid="schedule-editor">
        {rows.map((r) => (
          <li key={r.weekday} className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
              <Switch checked={r.on} onCheckedChange={(v) => set(r.weekday, { on: v })} aria-label={t(`weekdaysLong.${r.weekday}`)} data-testid={`sched-on-${r.weekday}`} />
            </label>
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-7 shrink-0 text-sm font-bold">{t(`weekdays.${r.weekday}`)}</span>
              {r.on ? (
                <>
                  <Input type="time" value={r.start} onChange={(e) => set(r.weekday, { start: e.target.value })} aria-label={t("start")} className="min-w-0 flex-1 px-2 text-sm" />
                  <span className="text-faint">–</span>
                  <Input type="time" value={r.end} onChange={(e) => set(r.weekday, { end: e.target.value })} aria-label={t("end")} className="min-w-0 flex-1 px-2 text-sm" />
                </>
              ) : (
                <span className="text-sm text-muted">{t("dayOff")}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        className="w-full"
        disabled={save.pending}
        data-testid="schedule-save"
        onClick={() => save.run({ userId, days: rows.filter((r) => r.on).map(({ weekday, start, end }) => ({ weekday, start, end })) })}
      >
        {t("saveSchedule")}
      </Button>
    </div>
  );
}

export function OverrideForm({ userId, defaultDate }: { userId: string; defaultDate: string }) {
  const t = useTranslations("worktime");
  const tc = useTranslations("common");
  const [kind, setKind] = React.useState<"shift" | "day_off">("shift");
  const { run, pending, fieldError } = useAction(setOverrideAction, { success: tc("saved") });
  return (
    <form
      className="grid grid-cols-2 gap-2"
      data-testid="override-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({
          userId,
          date: String(f.get("date")),
          kind,
          start: String(f.get("start") ?? ""),
          end: String(f.get("end") ?? ""),
          note: String(f.get("note") ?? ""),
        });
      }}
    >
      <DateField name="date" defaultValue={defaultDate} required aria-label={t("date")} />
      <Select value={kind} onChange={(e) => setKind(e.target.value as "shift" | "day_off")} aria-label={t("overrideKind")} data-testid="override-kind">
        <option value="shift">{t("overrideShift")}</option>
        <option value="day_off">{t("dayOff")}</option>
      </Select>
      {kind === "shift" ? (
        <>
          <Field error={fieldError("start")}>
            <Input type="time" name="start" defaultValue="08:00" aria-label={t("start")} data-testid="override-start" />
          </Field>
          <Field error={fieldError("end")}>
            <Input type="time" name="end" defaultValue="13:00" aria-label={t("end")} data-testid="override-end" />
          </Field>
        </>
      ) : null}
      <Input name="note" placeholder={t("notePlaceholder")} aria-label={t("note")} className="col-span-2" />
      <Button type="submit" variant="outline" className="col-span-2" disabled={pending} data-testid="override-save">
        <Plus /> {t("addOverride")}
      </Button>
    </form>
  );
}

export function AbsenceForm({ userId, defaultDate }: { userId: string; defaultDate: string }) {
  const t = useTranslations("worktime");
  const tc = useTranslations("common");
  const formRef = React.useRef<HTMLFormElement>(null);
  const { run, pending, fieldError } = useAction(addAbsenceAction, { success: tc("saved"), onSuccess: () => formRef.current?.reset() });
  return (
    <form
      ref={formRef}
      className="grid grid-cols-2 gap-2"
      data-testid="absence-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({ userId, kind: String(f.get("kind")) as AbsenceKind, from: String(f.get("from")), to: String(f.get("to")), note: String(f.get("note") ?? "") });
      }}
    >
      <Select name="kind" defaultValue="sick" aria-label={t("absenceKind")} className="col-span-2" data-testid="absence-kind">
        {ABSENCE_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`absence.${k}`)}
          </option>
        ))}
      </Select>
      <Field label={tc("from")}>
        <DateField name="from" defaultValue={defaultDate} required data-testid="absence-from" />
      </Field>
      <Field label={tc("to")} error={fieldError("to")}>
        <DateField name="to" defaultValue={defaultDate} required data-testid="absence-to" />
      </Field>
      <Input name="note" placeholder={t("notePlaceholder")} aria-label={t("note")} className="col-span-2" />
      <Button type="submit" variant="outline" className="col-span-2" disabled={pending} data-testid="absence-save">
        <Plus /> {t("addAbsence")}
      </Button>
    </form>
  );
}

function RemoveButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-faint hover:bg-surface-muted" aria-label={label} onClick={onClick} data-testid={testId}>
      <X className="size-4" />
    </button>
  );
}

export function RemoveOverride({ id }: { id: string }) {
  const t = useTranslations("worktime");
  const a = useAction(removeOverrideAction);
  return <RemoveButton label={t("remove")} onClick={() => a.run(id)} />;
}

export function RemoveAbsence({ id }: { id: string }) {
  const t = useTranslations("worktime");
  const a = useAction(removeAbsenceAction);
  return <RemoveButton label={t("remove")} onClick={() => a.run(id)} />;
}

function SessionFields({
  date,
  start,
  end,
  endOptional,
  fieldError,
}: {
  date: string;
  start: string;
  end: string;
  endOptional?: boolean;
  fieldError: (n: string) => string | undefined;
}) {
  const t = useTranslations("worktime");
  return (
    <>
      <Field label={t("date")} htmlFor="ws-date" error={fieldError("date")}>
        <DateField id="ws-date" name="date" defaultValue={date} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("start")} htmlFor="ws-start" error={fieldError("start")}>
          <Input id="ws-start" type="time" name="start" defaultValue={start} required data-testid="session-start" />
        </Field>
        <Field label={t("end")} htmlFor="ws-end" error={fieldError("end")} hint={endOptional ? t("endOptional") : undefined}>
          <Input id="ws-end" type="time" name="end" defaultValue={end} required={!endOptional} data-testid="session-end" />
        </Field>
      </div>
      <Field label={t("editComment")} htmlFor="ws-comment" error={fieldError("comment")} hint={t("editCommentHint")}>
        <Textarea id="ws-comment" name="comment" data-testid="session-comment" />
      </Field>
    </>
  );
}

export function EditSessionButton({ id, date, start, end }: { id: string; date: string; start: string; end: string }) {
  const t = useTranslations("worktime");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const { run, pending, fieldError } = useAction(editSessionAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("editSession")} data-testid="edit-session" className="size-9 pointer-coarse:size-11">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("editSession")} description={t("editSessionHint")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run({ id, date: String(f.get("date")), start: String(f.get("start")), end: String(f.get("end") ?? ""), comment: String(f.get("comment") ?? "") });
          }}
        >
          <SessionFields date={date} start={start} end={end} endOptional fieldError={fieldError} />
          <Button type="submit" className="w-full" disabled={pending} data-testid="session-save">
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddSessionButton({ userId, defaultDate }: { userId: string; defaultDate: string }) {
  const t = useTranslations("worktime");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const { run, pending, fieldError } = useAction(addSessionAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="add-session">
          <Plus /> {t("addSession")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("addSession")} description={t("editSessionHint")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run({ userId, date: String(f.get("date")), start: String(f.get("start")), end: String(f.get("end")), comment: String(f.get("comment") ?? "") });
          }}
        >
          <SessionFields date={defaultDate} start="08:00" end="17:00" fieldError={fieldError} />
          <Button type="submit" className="w-full" disabled={pending} data-testid="session-save">
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
