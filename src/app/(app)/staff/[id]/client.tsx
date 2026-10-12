"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { setTeacherGroupsAction, updatePersonAction } from "@/lib/actions/people-actions";

export function EditPerson({ userId, fullName, birthDate, position, showPosition = true }: { userId: string; fullName: string; birthDate: string | null; position: string; showPosition?: boolean }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const { run, pending, fieldError } = useAction(updatePersonAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title={tc("edit")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(userId, { fullName: String(f.get("fullName")), birthDate: String(f.get("birthDate") ?? ""), position: String(f.get("position") ?? "") });
          }}
        >
          <Field label={tc("fullName")} htmlFor="ep-name" error={fieldError("fullName")}>
            <Input id="ep-name" name="fullName" defaultValue={fullName} required />
          </Field>
          <Field label={t("birthDate")} htmlFor="ep-bd">
            <Input id="ep-bd" name="birthDate" type="date" defaultValue={birthDate ?? ""} />
          </Field>
          {showPosition ? (
            <Field label={t("position")} htmlFor="ep-pos">
              <Input id="ep-pos" name="position" defaultValue={position} />
            </Field>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeacherGroups({ userId, groups, selected }: { userId: string; groups: { id: string; name: string }[]; selected: string[] }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [ids, setIds] = React.useState(selected);
  const { run, pending } = useAction(setTeacherGroupsAction, { success: tc("saved") });
  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        {groups.map((g) => (
          <label key={g.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 text-sm">
            <Checkbox checked={ids.includes(g.id)} onCheckedChange={(v) => setIds((s) => (v ? [...s, g.id] : s.filter((x) => x !== g.id)))} />
            {g.name}
          </label>
        ))}
      </div>
      <Button className="w-full" variant="secondary" disabled={pending} onClick={() => run(userId, ids)}>
        {t("saveGroups")}
      </Button>
    </div>
  );
}
