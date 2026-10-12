"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, LogOut, MessageCircle, Trash2, UserMinus, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import {
  confirmClubAction,
  deleteClubAction,
  excludeClubAction,
  leaveClubAction,
  rejectClubAction,
  requestClubAction,
} from "@/app/(app)/clubs/actions";
import { startDirectChatAction } from "@/app/(app)/chats/actions";

/** Parent: the screen's main action — «Записаться». */
export function EnrollButton({ clubId, childId, label, full }: { clubId: string; childId: string; label: string; full: boolean }) {
  const t = useTranslations("clubs");
  const a = useAction(requestClubAction, {
    onSuccess: (d) => (d.status === "queued" ? toast.success(t("queuedToast", { position: d.position ?? 1 })) : toast.success(t("requestSent"))),
  });
  return (
    <div>
      <Button size="lg" className="w-full sm:w-auto" onClick={() => a.run(clubId, childId)} disabled={a.pending} data-testid="enroll">
        {label}
      </Button>
      <p className="mt-2 text-[13px] text-muted">{full ? t("enrollFullHint") : t("enrollHint")}</p>
    </div>
  );
}

/** Parent: withdraw a request, leave the queue or unenrol. */
export function LeaveButton({ enrollmentId, label, child, club }: { enrollmentId: string; label: string; child: string; club: string }) {
  const t = useTranslations("clubs");
  const a = useAction(leaveClubAction, { success: t("leftToast") });
  return (
    <Confirm
      trigger={
        <Button variant="outline" data-testid="leave-club">
          <LogOut /> {label}
        </Button>
      }
      title={label}
      description={t("leaveConfirm", { child, club })}
      confirmLabel={label}
      onConfirm={() => a.run(enrollmentId)}
    />
  );
}

export function ConfirmEnrollmentButton({ enrollmentId, disabled, size = "sm" }: { enrollmentId: string; disabled?: boolean; size?: ButtonProps["size"] }) {
  const t = useTranslations("clubs");
  const a = useAction(confirmClubAction, {
    onSuccess: (d) => toast.success(d.status === "queued" ? t("movedToQueue") : t("confirmedToast")),
  });
  return (
    <Button variant="secondary" size={size} onClick={() => a.run(enrollmentId)} disabled={disabled || a.pending} data-testid="confirm-enrollment">
      <Check /> {t("confirm")}
    </Button>
  );
}

/** Reject (request / queue) or exclude (attending child) with an optional reason. */
export function ReasonButton({ enrollmentId, kind, child, club }: { enrollmentId: string; kind: "reject" | "exclude"; child: string; club: string }) {
  const t = useTranslations("clubs");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const reject = useAction(rejectClubAction, { success: t("rejectedToast"), onSuccess: () => setOpen(false) });
  const exclude = useAction(excludeClubAction, { success: t("excludedToast"), onSuccess: () => setOpen(false) });
  const a = kind === "reject" ? reject : exclude;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-testid={kind === "reject" ? "reject-enrollment" : "exclude-enrollment"}>
          {kind === "reject" ? <X /> : <UserMinus />} {kind === "reject" ? t("reject") : t("exclude")}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={kind === "reject" ? t("rejectTitle") : t("excludeTitle")}
        description={kind === "exclude" ? t("excludeConfirm", { child, club }) : `${child} → ${club}`}
      >
        <Field label={t("reason")} htmlFor="club-reason" hint={t("reasonHint")}>
          <Textarea id="club-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button variant={kind === "exclude" ? "danger" : "primary"} disabled={a.pending} onClick={() => a.run(enrollmentId, reason)} data-testid="reason-ok">
            {kind === "reject" ? t("reject") : t("exclude")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens (or creates) the direct chat with a parent. */
export function WriteButton({ userId }: { userId: string }) {
  const t = useTranslations("clubs");
  const te = useTranslations("errors");
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      data-testid="write-parent"
      onClick={async () => {
        if (!navigator.onLine) return toast.error(te("offline"));
        setBusy(true);
        try {
          const r = await startDirectChatAction(userId);
          if (!r.ok) return toast.error(te.has(r.error) ? te(r.error) : te("generic"));
          router.push(`/chats/${r.data.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <MessageCircle /> {t("write")}
    </Button>
  );
}

export function DeleteClubButton({ clubId, name }: { clubId: string; name: string }) {
  const t = useTranslations("clubs");
  const router = useRouter();
  const a = useAction(deleteClubAction, {
    refresh: false,
    onSuccess: () => {
      toast.success(t("deleted"));
      router.push("/clubs");
      router.refresh();
    },
  });
  return (
    <Confirm
      trigger={
        <Button variant="ghost" className="text-danger" data-testid="delete-club">
          <Trash2 /> {t("delete")}
        </Button>
      }
      title={t("delete")}
      description={t("deleteConfirm", { name })}
      confirmLabel={t("delete")}
      danger
      onConfirm={() => a.run(clubId)}
    />
  );
}
