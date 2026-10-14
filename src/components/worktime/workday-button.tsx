"use client";

import { useTranslations } from "next-intl";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { finishDayAction, startDayAction } from "@/app/(app)/worktime/actions";

/** The one big action of a staff member's day (SPEC §5.2). `resume`: an interval is already closed today. */
export function WorkdayButton({ open, resume = false }: { open: boolean; resume?: boolean }) {
  const t = useTranslations("worktime");
  const start = useAction(startDayAction, { success: t("startedOk") });
  const finish = useAction(finishDayAction, { success: t("finishedOk") });
  return open ? (
    <Button size="lg" variant="outline" className="w-full sm:w-auto" disabled={finish.pending} onClick={() => finish.run()} data-testid="worktime-finish">
      <LogOut /> {t("finishDay")}
    </Button>
  ) : (
    <Button size="lg" className="w-full sm:w-auto" disabled={start.pending} onClick={() => start.run()} data-testid="worktime-start">
      <LogIn /> {resume ? t("continueDay") : t("startDay")}
    </Button>
  );
}
