"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Archive, KeyRound, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Confirm } from "@/components/common/confirm";
import { InviteLink, type InviteLinkData } from "@/components/common/invite-link";
import { useAction } from "@/hooks/use-action";
import { archivePersonAction, deletePersonAction, resetPasswordAction, restorePersonAction } from "@/lib/actions/people-actions";

export function PersonActions({
  userId,
  name,
  active,
  activated,
  canManage,
  canDelete,
  kindergartenName,
  afterDelete,
}: {
  userId: string;
  name: string;
  active: boolean;
  activated: boolean;
  canManage: boolean;
  canDelete: boolean;
  kindergartenName: string;
  afterDelete: string;
}) {
  const t = useTranslations("staff");
  const router = useRouter();
  const [invite, setInvite] = React.useState<InviteLinkData | null>(null);
  const reset = useAction(resetPasswordAction, { refresh: false, onSuccess: (d) => setInvite(d) });
  const archive = useAction(archivePersonAction, { success: t("archivedOk") });
  const restore = useAction(restorePersonAction, { success: t("restoredOk") });
  const del = useAction(deletePersonAction, {
    refresh: false,
    onSuccess: () => {
      toast.success(t("deleted"));
      router.push(afterDelete);
      router.refresh();
    },
  });
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {active ? (
        <Button variant="outline" onClick={() => reset.run(userId)} disabled={reset.pending} data-testid="reset-password">
          <KeyRound /> {activated ? t("resetPassword") : t("newInvite")}
        </Button>
      ) : null}
      {active ? (
        <Confirm
          trigger={
            <Button variant="outline" data-testid="archive-person">
              <Archive /> {t("archivePerson")}
            </Button>
          }
          title={t("archivePerson")}
          description={t("archiveConfirm", { name })}
          confirmLabel={t("archivePerson")}
          onConfirm={() => archive.run(userId)}
        />
      ) : (
        <Button variant="outline" onClick={() => restore.run(userId)} disabled={restore.pending} data-testid="restore-person">
          <RotateCcw /> {t("restorePerson")}
        </Button>
      )}
      {canDelete ? (
        <Confirm
          trigger={
            <Button variant="ghost" className="text-danger" data-testid="delete-person">
              <Trash2 /> {t("deleteForever")}
            </Button>
          }
          title={t("deleteForever")}
          description={t("deleteConfirm", { kindergarten: kindergartenName })}
          confirmLabel={t("deleteForever")}
          danger
          requireText={kindergartenName}
          onConfirm={() => del.run(userId, kindergartenName)}
        />
      ) : null}
      <Dialog open={!!invite} onOpenChange={(v) => !v && setInvite(null)}>
        {invite ? (
          <DialogContent title={activated ? t("resetPassword") : t("newInvite")} description={t("resetPasswordHint")}>
            <InviteLink invite={invite} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
