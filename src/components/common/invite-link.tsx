"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface InviteLinkData {
  url: string;
  whatsapp: string;
  text: string;
  expiresAt: string;
}

/** One-time invite/reset link with "Copy" and "Send to WhatsApp" (SPEC §4). */
export function InviteLink({ invite }: { invite: InviteLinkData }) {
  const t = useTranslations("invites");
  const tc = useTranslations("common");
  return (
    <div className="rounded-2xl border border-sky/30 bg-sky-soft p-4" data-testid="invite-link">
      <p className="text-sm font-bold text-sky-strong">{t("linkTitle")}</p>
      <p className="mt-2 rounded-xl bg-surface px-3 py-2 font-mono text-[12px] break-all text-text" data-testid="invite-url">
        {invite.url}
      </p>
      <p className="mt-2 text-xs text-muted">{t("linkHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(invite.text).catch(() => {});
            toast.success(tc("copied"));
          }}
        >
          <Copy /> {tc("copy")}
        </Button>
        <Button asChild size="sm" className="bg-[#1fa855] hover:bg-[#178a45]">
          <a href={invite.whatsapp} target="_blank" rel="noreferrer">
            <MessageCircle /> {t("sendWhatsapp")}
          </a>
        </Button>
      </div>
    </div>
  );
}
