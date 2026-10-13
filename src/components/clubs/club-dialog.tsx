"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import type { ScheduleItem } from "@/lib/clubs";
import { commitClubPhotoAction, prepareClubPhotoAction, removeClubPhotoAction, saveClubAction } from "@/app/(app)/clubs/actions";
import { directUpload } from "@/lib/upload-client";

export interface ClubFormValue {
  id: string;
  name: string;
  description: string | null;
  teacher_id: string | null;
  age_from: number;
  age_to: number;
  schedule: ScheduleItem[];
  place: string | null;
  capacity: number;
  hasPhoto: boolean;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function ClubDialog({ teachers, club }: { teachers: { id: string; name: string }[]; club?: ClubFormValue }) {
  const t = useTranslations("clubs");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [schedule, setSchedule] = React.useState<ScheduleItem[]>(club?.schedule ?? [{ day: 1, start: "16:00", end: "16:45" }]);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const save = useAction(saveClubAction, { refresh: false });
  const removePhoto = useAction(removeClubPhotoAction, { success: tc("saved") });

  function reset() {
    setSchedule(club?.schedule ?? [{ day: 1, start: "16:00", end: "16:45" }]);
    setFile(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await save.run(club?.id ?? null, {
        name: String(f.get("name") ?? ""),
        description: String(f.get("description") ?? ""),
        teacherId: String(f.get("teacherId") ?? ""),
        ageFrom: String(f.get("ageFrom") ?? ""),
        ageTo: String(f.get("ageTo") ?? ""),
        schedule,
        place: String(f.get("place") ?? ""),
        capacity: String(f.get("capacity") ?? ""),
      });
      if (!r?.ok) return;
      const id = r.data.id;
      if (file) {
        // The photo goes straight to storage (D-035).
        const up = await directUpload(
          file,
          (f) => prepareClubPhotoAction(id, f),
          (ticket) => commitClubPhotoAction(id, ticket),
          { tooLarge: "photoTooLarge" },
        ).catch((e) => {
          console.error(e);
          return { ok: false as const, error: "generic" };
        });
        if (!up.ok) toast.error(te.has(up.error) ? te(up.error) : te("generic"));
      }
      toast.success(t("saved"));
      setOpen(false);
      if (club) router.refresh();
      else router.push(`/clubs/${id}`);
    } finally {
      setBusy(false);
    }
  }

  const setItem = (i: number, patch: Partial<ScheduleItem>) => setSchedule((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger asChild>
        {club ? (
          <Button variant="outline" data-testid="edit-club">
            <Pencil /> {t("edit")}
          </Button>
        ) : (
          <Button data-testid="add-club">
            <Plus /> {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={club ? t("edit") : t("add")} side="right">
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t("form.name")} htmlFor="club-name" error={save.fieldError("name")}>
            <Input id="club-name" name="name" defaultValue={club?.name} required maxLength={80} data-testid="club-name" />
          </Field>
          <Field label={t("form.description")} htmlFor="club-desc" error={save.fieldError("description")}>
            <Textarea id="club-desc" name="description" defaultValue={club?.description ?? ""} maxLength={2000} rows={3} />
          </Field>
          <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3">
            <Field label={t("form.ageFrom")} htmlFor="club-age-from" error={save.fieldError("ageFrom")}>
              <Input id="club-age-from" name="ageFrom" type="number" inputMode="numeric" min={0} max={17} defaultValue={club?.age_from ?? 3} required data-testid="club-age-from" />
            </Field>
            <Field label={t("form.ageTo")} htmlFor="club-age-to" error={save.fieldError("ageTo")}>
              <Input id="club-age-to" name="ageTo" type="number" inputMode="numeric" min={0} max={17} defaultValue={club?.age_to ?? 6} required data-testid="club-age-to" />
            </Field>
            <Field label={t("form.capacity")} htmlFor="club-capacity" error={save.fieldError("capacity")}>
              <Input id="club-capacity" name="capacity" type="number" inputMode="numeric" min={1} max={200} defaultValue={club?.capacity ?? 10} required data-testid="club-capacity" />
            </Field>
          </div>
          <p className="-mt-2 text-[13px] text-faint">{t("form.capacityHint")}</p>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-muted">{t("form.schedule")}</legend>
            <div className="space-y-2">
              {schedule.map((s, i) => (
                <div key={i} className="grid grid-cols-[5rem_1fr_1fr_auto] items-center gap-2" data-testid="schedule-row">
                  <Select aria-label={t("form.day")} className="pr-8 pl-3" value={s.day} onChange={(e) => setItem(i, { day: Number(e.target.value) })}>
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`days.${d}` as "days.1")}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label={t("form.start")} type="time" value={s.start} onChange={(e) => setItem(i, { start: e.target.value })} required className="px-2" />
                  <Input aria-label={t("form.end")} type="time" value={s.end} onChange={(e) => setItem(i, { end: e.target.value })} required className="px-2" />
                  <Button type="button" variant="ghost" size="icon" aria-label={t("form.removeTime")} onClick={() => setSchedule((x) => x.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            {save.fieldError("schedule") ? <p className="mt-1.5 text-[13px] text-danger">{save.fieldError("schedule")}</p> : null}
            {schedule.length < 14 ? (
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => setSchedule((x) => [...x, { day: Math.min(7, (x.at(-1)?.day ?? 0) + 1), start: x.at(-1)?.start ?? "16:00", end: x.at(-1)?.end ?? "16:45" }])}
                data-testid="add-time"
              >
                <Plus /> {t("form.addTime")}
              </Button>
            ) : null}
          </fieldset>
          <Field label={t("form.place")} htmlFor="club-place" hint={t("form.placeHint")}>
            <Input id="club-place" name="place" defaultValue={club?.place ?? ""} maxLength={120} />
          </Field>
          <Field label={t("form.teacher")} htmlFor="club-teacher" hint={teachers.length ? undefined : t("form.noTeachers")} error={save.fieldError("teacherId")}>
            <Select id="club-teacher" name="teacherId" defaultValue={club?.teacher_id ?? ""} data-testid="club-teacher">
              <option value="">{t("form.noTeacher")}</option>
              {teachers.map((x) => (
                <option data-user-content key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-muted">{t("form.photo")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold hover:bg-surface-muted">
                <ImagePlus className="size-4" aria-hidden />
                <span className="max-w-48 truncate">{file ? file.name : t("form.photoChoose")}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  data-testid="club-photo"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {club?.hasPhoto && !file ? (
                <Button type="button" variant="ghost" onClick={() => removePhoto.run(club.id)} disabled={removePhoto.pending}>
                  <Trash2 /> {t("form.photoRemove")}
                </Button>
              ) : null}
            </div>
            <p className="mt-1.5 text-[13px] text-faint">{t("form.photoHint")}</p>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="save-club">
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
