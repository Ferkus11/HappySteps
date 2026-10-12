import { getTranslations } from "next-intl/server";
import { LinkIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { lookupInvite } from "./lookup";
import { InviteForm } from "./invite-form";

export const metadata = { robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const invite = await lookupInvite(token);
  if (!invite) {
    return (
      <Card>
        <EmptyState icon={LinkIcon} title={t("inviteInvalid")} />
      </Card>
    );
  }
  return (
    <Card className="p-6 md:p-8">
      <h1 className="text-2xl font-extrabold">
        {invite.kind === "reset" ? t("newPassword") : t("inviteTitle")} {invite.kind === "reset" ? "" : invite.firstName}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {invite.kind === "reset" ? t("inviteResetSubtitle") : t("inviteSubtitle", { kindergarten: invite.kindergartenName })}
      </p>
      <InviteForm token={token} phone={invite.phone} />
    </Card>
  );
}
