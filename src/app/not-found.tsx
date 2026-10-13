import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

/** App-wide 404 in the reader's language (instead of the English framework page). */
export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sky-soft px-4">
      <Card className="w-full max-w-[420px]" data-testid="not-found">
        <p className="pt-6 text-center text-4xl font-extrabold text-faint">404</p>
        <EmptyState
          icon={SearchX}
          title={<span role="heading" aria-level={1}>{t("notFoundTitle")}</span>}
          hint={t("notFoundText")}
          action={
            <Button asChild>
              <Link href="/">{t("toHome")}</Link>
            </Button>
          }
        />
      </Card>
    </main>
  );
}
