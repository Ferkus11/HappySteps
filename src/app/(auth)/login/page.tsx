import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-path";
import { LoginForm } from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("loginTitle") };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(next ?? "/");
  const t = await getTranslations("auth");
  return (
    <Card className="p-6 md:p-8">
      <h1 className="text-2xl font-extrabold">{t("loginTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("loginSubtitle")}</p>
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">{t("forgot")}</p>
    </Card>
  );
}
