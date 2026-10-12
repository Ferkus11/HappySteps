"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { saveGroupAction } from "./actions";
import { cn } from "@/lib/utils";

export const GROUP_COLORS = ["#4FA3E0", "#C02A62", "#2E9E7A", "#E8A33D", "#7C6CD6", "#E07A5F", "#3D9BB0", "#9C6B4E"];

export interface GroupFormValue {
  id: string;
  name: string;
  age_category: string | null;
  capacity: number;
  color: string;
  teacherIds: string[];
}

export function GroupDialog({ teachers, group }: { teachers: { id: string; name: string }[]; group?: GroupFormValue }) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [color, setColor] = React.useState(group?.color ?? GROUP_COLORS[0]);
  const [teacherIds, setTeacherIds] = React.useState<string[]>(group?.teacherIds ?? []);
  const { run, pending, fieldError } = useAction(saveGroupAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {group ? (
          <Button variant="outline">
            <Pencil /> {t("edit")}
          </Button>
        ) : (
          <Button data-testid="add-group">
            <Plus /> {t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={group ? t("edit") : t("add")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(group?.id ?? null, {
              name: String(f.get("name")),
              ageCategory: String(f.get("ageCategory") ?? ""),
              capacity: String(f.get("capacity")),
              color,
              teacherIds,
            });
          }}
        >
          <Field label={t("name")} htmlFor="g-name" error={fieldError("name")}>
            <Input id="g-name" name="name" defaultValue={group?.name} required />
          </Field>
          <Field label={t("ageCategory")} htmlFor="g-age" hint={t("ageCategoryHint")}>
            <Input id="g-age" name="ageCategory" defaultValue={group?.age_category ?? ""} />
          </Field>
          <Field label={t("capacity")} htmlFor="g-cap" error={fieldError("capacity")}>
            <Input id="g-cap" name="capacity" type="number" min={1} max={200} defaultValue={group?.capacity ?? 20} required />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-muted">{t("color")}</legend>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className={cn("size-11 cursor-pointer rounded-full border-4", c === color ? "border-text/70" : "border-transparent")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>
          {teachers.length ? (
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-muted">{t("teachers")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {teachers.map((x) => (
                  <label key={x.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 text-sm">
                    <Checkbox
                      checked={teacherIds.includes(x.id)}
                      onCheckedChange={(v) => setTeacherIds((s) => (v ? [...s, x.id] : s.filter((y) => y !== x.id)))}
                    />
                    {x.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="save-group">
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
