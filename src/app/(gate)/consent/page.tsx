import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { loadContext } from "@/lib/auth/context";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage() {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") redirect("/");
  if (r.ctx.membership.consent_at) redirect("/");
  const t = await getTranslations("auth");
  const tc = await getTranslations("consent");
  const text = r.ctx.settings.consent_text?.trim() || tc("defaultText", { kindergarten: r.ctx.kg.name });
  return (
    <Card className="p-6 md:p-8">
      <h1 className="text-2xl font-extrabold">{t("consentTitle")}</h1>
      <div className="mt-4 max-h-[45dvh] overflow-y-auto rounded-2xl bg-surface-muted p-4 text-sm leading-relaxed whitespace-pre-line text-muted">
        {text}
      </div>
      <ConsentForm />
    </Card>
  );
}
