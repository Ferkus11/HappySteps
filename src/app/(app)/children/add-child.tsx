"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { InviteLink } from "@/components/common/invite-link";
import { useAction } from "@/hooks/use-action";
import { createChildAction, type ParentInviteResult } from "./actions";
import { DateField } from "@/components/ui/date-field";

interface ParentDraft {
  key: number;
  fullName: string;
  phone: string;
  relation: string;
}

export function ParentInvites({ invites }: { invites: ParentInviteResult[] }) {
  const t = useTranslations("children");
  const ti = useTranslations("invites");
  if (!invites.length) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold">{t("invitesTitle")}</p>
      {invites.map((i, idx) => (
        <div key={idx} className="space-y-2">
          <p data-user-content className="text-sm font-semibold">{i.name}</p>
          {i.existed ? <p className="text-sm text-success">{ti("alreadyRegistered")}</p> : null}
          {i.invite ? <InviteLink invite={i.invite} /> : null}
        </div>
      ))}
    </div>
  );
}

export function AddChildButton({ groups, today }: { groups: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [parents, setParents] = React.useState<ParentDraft[]>([{ key: 1, fullName: "", phone: "", relation: "" }]);
  const [confirm, setConfirm] = React.useState<{ group: string; count: number; capacity: number } | null>(null);
  const [done, setDone] = React.useState<ParentInviteResult[] | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const { run, pending, fieldError } = useAction(createChildAction, {
    onSuccess: (d) => {
      if ("needsConfirm" in d && d.needsConfirm) setConfirm(d.needsConfirm);
      else if ("invites" in d) setDone(d.invites);
    },
  });

  const submit = (confirmOverCapacity: boolean) => {
    const f = new FormData(formRef.current!);
    run({
      fullName: String(f.get("fullName")),
      birthDate: String(f.get("birthDate")),
      groupId: String(f.get("groupId") ?? ""),
      enrolledOn: String(f.get("enrolledOn")),
      monthlyFee: String(f.get("monthlyFee") || "0"),
      allergies: String(f.get("allergies") ?? ""),
      medicalNotes: String(f.get("medicalNotes") ?? ""),
      parents: parents.filter((p) => p.fullName.trim() || p.phone.replace(/\D/g, "").length > 1).map(({ fullName, phone, relation }) => ({ fullName, phone, relation })),
      confirmOverCapacity,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setDone(null);
          setConfirm(null);
          setParents([{ key: Date.now(), fullName: "", phone: "", relation: "" }]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="add-child">
          <Plus /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("add")} side="right">
        {done ? (
          <div className="space-y-4">
            <p className="font-semibold text-success">{t("created")}</p>
            <ParentInvites invites={done} />
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <form
            ref={formRef}
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
          >
            <Field label={t("fullName")} htmlFor="ch-name" error={fieldError("fullName")}>
              <Input id="ch-name" name="fullName" required autoComplete="off" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("birthDate")} htmlFor="ch-bd" error={fieldError("birthDate")}>
                <DateField id="ch-bd" name="birthDate" required max={today} />
              </Field>
              <Field label={t("enrolledOn")} htmlFor="ch-en">
                <DateField id="ch-en" name="enrolledOn" defaultValue={today} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("group")} htmlFor="ch-group">
                <Select id="ch-group" name="groupId" defaultValue={groups[0]?.id ?? ""}>
                  <option value="">{t("noGroup")}</option>
                  {groups.map((g) => (
                    <option data-user-content key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("monthlyFee")} htmlFor="ch-fee" error={fieldError("monthlyFee")}>
                <Input id="ch-fee" name="monthlyFee" type="number" min={0} step={500} inputMode="numeric" defaultValue={0} />
              </Field>
            </div>
            <Field label={t("allergies")} htmlFor="ch-all" hint={t("allergiesHint")}>
              <Input id="ch-all" name="allergies" />
            </Field>
            <Field label={t("medicalNotes")} htmlFor="ch-med">
              <Textarea id="ch-med" name="medicalNotes" rows={2} />
            </Field>

            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-bold">{t("parents")}</p>
              {parents.map((p, idx) => (
                <div key={p.key} className="relative space-y-3 rounded-2xl bg-surface-muted p-3">
                  {idx > 0 ? (
                    <button
                      type="button"
                      className="absolute top-2 right-2 grid size-9 pointer-coarse:size-11 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface"
                      aria-label={tc("delete")}
                      onClick={() => setParents((s) => s.filter((x) => x.key !== p.key))}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                  <Field label={t("parentName")} htmlFor={`pn-${p.key}`} error={fieldError(`parents.${idx}.fullName`)}>
                    <Input id={`pn-${p.key}`} value={p.fullName} onChange={(e) => setParents((s) => s.map((x) => (x.key === p.key ? { ...x, fullName: e.target.value } : x)))} />
                  </Field>
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <Field label={t("parentPhone")} htmlFor={`pp-${p.key}`} error={fieldError(`parents.${idx}.phone`)}>
                      <PhoneInput id={`pp-${p.key}`} onChange={(v) => setParents((s) => s.map((x) => (x.key === p.key ? { ...x, phone: v } : x)))} />
                    </Field>
                    <Field label={t("relation")} htmlFor={`pr-${p.key}`}>
                      <Input id={`pr-${p.key}`} placeholder={t("relationHint")} value={p.relation} onChange={(e) => setParents((s) => s.map((x) => (x.key === p.key ? { ...x, relation: e.target.value } : x)))} />
                    </Field>
                  </div>
                </div>
              ))}
              {parents.length < 3 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setParents((s) => [...s, { key: Date.now(), fullName: "", phone: "", relation: "" }])}>
                  <UserPlus /> {t("secondParent")}
                </Button>
              ) : null}
            </div>

            {confirm ? (
              <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning" role="alert">
                <p className="font-bold">{t("overCapacityTitle")}</p>
                <p className="mt-1">{t("overCapacityText", confirm)}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" disabled={pending} onClick={() => submit(true)} data-testid="confirm-over-capacity">
                  {t("overCapacityConfirm")}
                </Button>
              </div>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="add-child-submit">
              {tc("add")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
