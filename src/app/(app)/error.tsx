"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

/** A page that failed to render: a translated message with a retry instead of the framework's English screen. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <Card data-testid="page-error">
      <EmptyState
        icon={TriangleAlert}
        title={t("errorTitle")}
        hint={t("errorGeneric")}
        action={
          <Button variant="secondary" onClick={() => reset()}>
            {t("retry")}
          </Button>
        }
      />
    </Card>
  );
}
