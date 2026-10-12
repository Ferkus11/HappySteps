"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Archive, ArrowRightLeft, Camera, Link2Off, Pencil, RotateCcw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Avatar } from "@/components/ui/avatar";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import {
  addGuardianAction,
  archiveChildAction,
  restoreChildAction,
  transferChildAction,
  unlinkGuardianAction,
  updateChildAction,
  uploadChildPhotoAction,
  type ParentInviteResult,
} from "../actions";
import { ParentInvites } from "../add-child";

export function EditChild({
  child,
}: {
  child: { id: string; fullName: string; birthDate: string; enrolledOn: string; monthlyFee: number; allergies: string; medicalNotes: string };
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const { run, pending, fieldError } = useAction(updateChildAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("edit")}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title={t("edit")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(child.id, {
              fullName: String(f.get("fullName")),
              birthDate: String(f.get("birthDate")),
              groupId: null,
              enrolledOn: String(f.get("enrolledOn")),
              monthlyFee: String(f.get("monthlyFee") || "0"),
              allergies: String(f.get("allergies") ?? ""),
              medicalNotes: String(f.get("medicalNotes") ?? ""),
            });
          }}
        >
          <Field label={t("fullName")} htmlFor="ec-name" error={fieldError("fullName")}>
            <Input id="ec-name" name="fullName" defaultValue={child.fullName} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("birthDate")} htmlFor="ec-bd">
              <Input id="ec-bd" name="birthDate" type="date" defaultValue={child.birthDate} required />
            </Field>
            <Field label={t("enrolledOn")} htmlFor="ec-en">
              <Input id="ec-en" name="enrolledOn" type="date" defaultValue={child.enrolledOn} required />
            </Field>
          </div>
          <Field label={t("monthlyFee")} htmlFor="ec-fee" error={fieldError("monthlyFee")}>
            <Input id="ec-fee" name="monthlyFee" type="number" min={0} step={500} defaultValue={child.monthlyFee} />
          </Field>
          <Field label={t("allergies")} htmlFor="ec-all">
            <Input id="ec-all" name="allergies" defaultValue={child.allergies} />
          </Field>
          <Field label={t("medicalNotes")} htmlFor="ec-med">
            <Textarea id="ec-med" name="medicalNotes" defaultValue={child.medicalNotes} rows={3} />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {tc("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ChildAdminActions({
  childId,
  status,
  groups,
  today,
}: {
  childId: string;
  status: "active" | "archived";
  groups: { id: string; name: string }[];
  today: string;
}) {
  const t = useTranslations("children");
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const transfer = useAction(transferChildAction, { success: t("transferred"), onSuccess: () => setTransferOpen(false) });
  const archive = useAction(archiveChildAction, { onSuccess: () => setArchiveOpen(false) });
  const restore = useAction(restoreChildAction);
  if (status === "archived") {
    return (
      <Button variant="outline" onClick={() => restore.run(childId)} disabled={restore.pending}>
        <RotateCcw /> {t("restore")}
      </Button>
    );
  }
  const reasons = ["moved", "school", "other_kindergarten", "family", "health", "other"] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {groups.length ? (
        <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" data-testid="transfer-child">
              <ArrowRightLeft /> {t("transfer")}
            </Button>
          </DialogTrigger>
          <DialogContent title={t("transfer")}>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                transfer.run(childId, String(f.get("group")), String(f.get("date")));
              }}
            >
              <Field label={t("group")} htmlFor="tc-g">
                <Select id="tc-g" name="group">
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("transferDate")} htmlFor="tc-d">
                <Input id="tc-d" name="date" type="date" defaultValue={today} required />
              </Field>
              <Button type="submit" className="w-full" disabled={transfer.pending}>
                {t("transfer")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" data-testid="archive-child">
            <Archive /> {t("archive")}
          </Button>
        </DialogTrigger>
        <DialogContent title={t("archive")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              archive.run(childId, String(f.get("reason")) as (typeof reasons)[number]);
            }}
          >
            <Field label={t("archiveReason")} htmlFor="ac-r">
              <Select id="ac-r" name="reason">
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {t(`archiveReasons.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="danger" className="w-full" disabled={archive.pending} data-testid="archive-child-submit">
              {t("archive")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GuardianRow({
  childId,
  userId,
  name,
  phone,
  relation,
  canUnlink,
}: {
  childId: string;
  userId: string;
  name: string;
  phone: string;
  relation: string | null;
  canUnlink: boolean;
}) {
  const t = useTranslations("children");
  const unlink = useAction(unlinkGuardianAction, { success: t("unlinked") });
  return (
    <li className="flex items-center gap-3">
      <Avatar name={name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{name}</div>
        <div className="truncate text-sm text-muted">
          {phone}
          {relation ? ` · ${relation}` : ""}
        </div>
      </div>
      {canUnlink ? (
        <Confirm
          trigger={
            <Button variant="ghost" size="icon" aria-label={t("unlink")} className="text-muted">
              <Link2Off />
            </Button>
          }
          title={t("unlink")}
          description={t("unlinkConfirm", { name })}
          confirmLabel={t("unlink")}
          danger
          onConfirm={() => unlink.run(childId, userId)}
        />
      ) : null}
    </li>
  );
}

export function AddGuardian({ childId }: { childId: string }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [result, setResult] = React.useState<ParentInviteResult | null>(null);
  const { run, pending, fieldError } = useAction(addGuardianAction, { onSuccess: (d) => setResult(d) });
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="add-guardian">
          <UserPlus /> {t("addParent")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("addParent")}>
        {result ? (
          <div className="space-y-4">
            <ParentInvites invites={[result]} />
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(childId, { fullName: String(f.get("fullName")), phone, relation: String(f.get("relation") ?? "") });
            }}
          >
            <Field label={t("parentName")} htmlFor="ag-n" error={fieldError("fullName")}>
              <Input id="ag-n" name="fullName" required />
            </Field>
            <Field label={t("parentPhone")} htmlFor="ag-p" error={fieldError("phone")}>
              <PhoneInput id="ag-p" onChange={setPhone} required />
            </Field>
            <Field label={t("relation")} htmlFor="ag-r">
              <Input id="ag-r" name="relation" placeholder={t("relationHint")} />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {tc("add")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PhotoUpload({ childId }: { childId: string }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { run, pending } = useAction(uploadChildPhotoAction, { success: tc("saved") });
  return (
    <>
      <button
        type="button"
        className="absolute -right-1 -bottom-1 grid size-8 cursor-pointer place-items-center rounded-full border-2 border-surface bg-brand text-brand-fg"
        aria-label={t("uploadPhoto")}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="size-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast.error(t("photo"));
            return;
          }
          const fd = new FormData();
          fd.set("file", file);
          run(childId, fd);
          e.target.value = "";
        }}
      />
    </>
  );
}
