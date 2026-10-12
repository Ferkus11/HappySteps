import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Unknown or blocked kindergarten — a friendly page instead of a bare 404. */
export default async function ApplyNotFound() {
  const t = await getTranslations("waitlist.public");
  const tc = await getTranslations("common");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sky-soft px-4">
      <Card className="w-full max-w-[420px]" data-testid="apply-not-found">
        <EmptyState icon={SearchX} title={t("notFoundTitle")} hint={t("notFoundText")} />
        <p className="pb-2 text-center text-xs text-faint">
          <Link href="/login" className="inline-flex min-h-11 items-center">
            {tc("appName")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
