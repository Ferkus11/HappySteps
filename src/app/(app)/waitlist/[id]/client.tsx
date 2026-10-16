"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Confirm } from "@/components/common/confirm";
import { ParentInvites } from "@/app/(app)/children/add-child";
import type { ParentInviteResult } from "@/lib/children";
import { useAction } from "@/hooks/use-action";
import { MANUAL_STATUSES, type WaitlistStatus } from "@/lib/waitlist";
import { acceptApplicationAction, addApplicationCommentAction, deleteApplicationAction, setApplicationStatusAction } from "../actions";
import { DateField } from "@/components/ui/date-field";

export function StatusButtons({ id, status }: { id: string; status: WaitlistStatus }) {
  const t = useTranslations("waitlist");
  const { run, pending } = useAction(setApplicationStatusAction, { success: t("statusSaved") });
  const label: Record<(typeof MANUAL_STATUSES)[number], string> = {
    new: t("markNew"),
    contacted: t("markContacted"),
    declined: t("markDeclined"),
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {MANUAL_STATUSES.filter((s) => s !== status).map((s) => (
        <Button key={s} variant="outline" disabled={pending} onClick={() => run(id, s)} data-testid={`wl-set-${s}`}>
          {label[s]}
        </Button>
      ))}
    </div>
  );
}

interface GroupOption {
  id: string;
  name: string;
  capacity: number;
  activeCount: number;
}

export function AcceptDialog({
  id,
  app,
  groups,
  defaultFee,
  today,
}: {
  id: string;
  app: { childName: string; childBirthDate: string; parentName: string; parentPhone: string; desiredDate: string | null };
  groups: GroupOption[];
  defaultFee: number;
  today: string;
}) {
  const t = useTranslations("waitlist");
  const tch = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<{ group: string; count: number; capacity: number } | null>(null);
  const [done, setDone] = React.useState<{ childId: string | null; invites: ParentInviteResult[]; already: boolean } | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const { run, pending, fieldError } = useAction(acceptApplicationAction, {
    refresh: false,
    onSuccess: (d) => {
      if ("needsConfirm" in d) setConfirm(d.needsConfirm);
      else setDone(d);
    },
  });
  const enrolledDefault = app.desiredDate && app.desiredDate > today ? app.desiredDate : today;

  const submit = (confirmOverCapacity: boolean) => {
    const f = new FormData(formRef.current!);
    run(id, {
      childName: String(f.get("childName") ?? ""),
      childBirthDate: String(f.get("childBirthDate") ?? ""),
      parentName: String(f.get("parentName") ?? ""),
      parentPhone: String(f.get("parentPhone") ?? ""),
      groupId: String(f.get("groupId") ?? ""),
      enrolledOn: String(f.get("enrolledOn") ?? ""),
      monthlyFee: String(f.get("monthlyFee") || "0"),
      confirmOverCapacity,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setConfirm(null);
          if (done) router.refresh();
          setDone(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="w-full" data-testid="wl-accept">
          <UserCheck /> {t("accept")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("acceptTitle")} description={done ? undefined : t("acceptHint")} side="right">
        {done ? (
          <div className="space-y-4" data-testid="wl-accepted">
            <div className="flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-success">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-bold">{done.already ? t("alreadyAccepted") : t("acceptedTitle")}</p>
                {!done.already ? <p className="text-sm">{t("acceptedText")}</p> : null}
              </div>
            </div>
            <ParentInvites invites={done.invites} />
            {done.childId ? (
              <Button asChild size="lg" className="w-full">
                <Link href={`/children/${done.childId}`} data-testid="wl-open-child">
                  {t("openChild")}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <form
            ref={formRef}
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
          >
            <Field label={tch("group")} htmlFor="acc-group" error={fieldError("groupId") ? t("chooseGroup") : undefined}>
              <Select id="acc-group" name="groupId" defaultValue="" required data-testid="wl-accept-group">
                <option value="" disabled>
                  {t("chooseGroup")}
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    <span data-user-content>{g.name}</span> · {g.activeCount}/{g.capacity}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tch("enrolledOn")} htmlFor="acc-enrolled" error={fieldError("enrolledOn")}>
                <DateField id="acc-enrolled" name="enrolledOn" defaultValue={enrolledDefault} required data-testid="wl-accept-enrolled" />
              </Field>
              <Field label={tch("monthlyFee")} htmlFor="acc-fee" error={fieldError("monthlyFee")}>
                <Input id="acc-fee" name="monthlyFee" type="number" min={0} step={500} inputMode="numeric" defaultValue={defaultFee} />
              </Field>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-bold">{t("child")}</p>
              <Field label={t("childName")} htmlFor="acc-child" error={fieldError("childName")}>
                <Input id="acc-child" name="childName" defaultValue={app.childName} required />
              </Field>
              <Field label={tch("birthDate")} htmlFor="acc-birth" error={fieldError("childBirthDate")}>
                <DateField id="acc-birth" name="childBirthDate" defaultValue={app.childBirthDate} max={today} required />
              </Field>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-bold">{t("parent")}</p>
              <Field label={t("parentName")} htmlFor="acc-parent" error={fieldError("parentName")}>
                <Input id="acc-parent" name="parentName" defaultValue={app.parentName} required />
              </Field>
              <Field label={t("parentPhone")} htmlFor="acc-phone" error={fieldError("parentPhone")}>
                <PhoneInput id="acc-phone" name="parentPhone" defaultValue={app.parentPhone} required />
              </Field>
            </div>
            {confirm ? (
              <div className="rounded-2xl bg-warning-soft p-4 text-sm text-warning" role="alert">
                <p className="font-bold">{tch("overCapacityTitle")}</p>
                <p className="mt-1">{tch("overCapacityText", confirm)}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" disabled={pending} onClick={() => submit(true)} data-testid="confirm-over-capacity">
                  {tch("overCapacityConfirm")}
                </Button>
              </div>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="wl-accept-submit">
              {t("acceptSubmit")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CommentForm({ id }: { id: string }) {
  const t = useTranslations("waitlist");
  const [text, setText] = React.useState("");
  const { run, pending } = useAction(addApplicationCommentAction, { success: t("commentAdded"), onSuccess: () => setText("") });
  return (
    <form
      className="mt-4 space-y-2 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) run(id, text);
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("commentPlaceholder")}
        aria-label={t("commentPlaceholder")}
        rows={2}
        maxLength={1000}
        className="min-h-20"
        data-testid="wl-comment-input"
      />
      <Button type="submit" variant="secondary" disabled={pending || !text.trim()} data-testid="wl-comment-submit">
        {t("addComment")}
      </Button>
    </form>
  );
}

export function DeleteApplication({ id, name }: { id: string; name: string }) {
  const t = useTranslations("waitlist");
  const router = useRouter();
  const { run } = useAction(deleteApplicationAction, {
    success: t("deleted"),
    refresh: false,
    onSuccess: () => router.push("/waitlist"),
  });
  return (
    <Confirm
      trigger={
        <Button variant="ghost" className="text-muted" data-testid="wl-delete">
          <Trash2 /> {t("delete")}
        </Button>
      }
      title={t("deleteTitle")}
      description={t("deleteText", { name })}
      confirmLabel={t("delete")}
      danger
      onConfirm={() => run(id)}
    />
  );
}
