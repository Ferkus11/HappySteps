"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useLogout } from "./use-logout";

/** «Выйти» on the gate screens (no access, blocked garden) — same clean-up as the account menu. */
export function LogoutButton({ testId }: { testId?: string }) {
  const t = useTranslations("common");
  const { logout, pending } = useLogout();
  return (
    <Button variant="outline" onClick={logout} disabled={pending} data-testid={testId}>
      {t("logout")}
    </Button>
  );
}
