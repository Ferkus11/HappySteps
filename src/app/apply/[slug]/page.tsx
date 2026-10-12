import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { loadMessages } from "@/messages";
import { formatPhone } from "@/lib/phone";
import { todayIn } from "@/lib/format";
import { publicGarden } from "@/lib/waitlist-data";
import { ApplyForm } from "./apply-form";

type Props = { params: Promise<{ slug: string }> };

/** Visitor's choice (cookie), otherwise the kindergarten's default language. */
async function localeFor(gardenDefault: Locale): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(fromCookie) ? fromCookie : gardenDefault;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const kg = await publicGarden((await params).slug);
  if (!kg) return { robots: { index: false } };
  const t = await getTranslations({ locale: await localeFor(kg.defaultLocale), namespace: "waitlist.public" });
  return { title: `${t("title")} · ${kg.name}`, robots: { index: false } };
}

/** Public application form of a kindergarten (SPEC §5.11) — no login, link or QR code. */
export default async function ApplyPage({ params }: Props) {
  const kg = await publicGarden((await params).slug);
  if (!kg) notFound();
  const locale = await localeFor(kg.defaultLocale);
  const messages = await loadMessages(locale);
  const t = await getTranslations({ locale, namespace: "waitlist.public" });
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="relative flex min-h-dvh flex-col bg-sky-soft" style={kg.accent ? ({ "--brand": kg.accent } as React.CSSProperties) : undefined} lang={locale}>
        <div className="absolute top-3 right-3">
          <LanguageSwitcher />
        </div>
        <main className="mx-auto w-full max-w-[520px] flex-1 px-4 pt-16 pb-10">
          <header className="mb-6 flex flex-col items-center text-center">
            {kg.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kg.logoUrl} alt="" className="mb-3 size-16 rounded-2xl bg-surface object-cover shadow-card" />
            ) : (
              <span className="mb-3 grid size-16 place-items-center rounded-2xl bg-brand text-2xl font-extrabold text-brand-fg shadow-card" aria-hidden>
                {kg.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <p className="text-sm font-semibold text-muted" data-testid="apply-garden">
              {kg.name}
            </p>
            <h1 className="mt-1 text-[26px] leading-tight font-extrabold tracking-tight">{t("title")}</h1>
            <p className="mt-2 max-w-sm text-sm text-muted">{t("subtitle")}</p>
          </header>
          <Card className="p-5 md:p-7">
            <ApplyForm slug={kg.slug} today={todayIn("Asia/Almaty")} />
          </Card>
          <footer className="mt-6 space-y-2 text-center text-xs text-faint">
            {kg.phone ? (
              <a href={`tel:${kg.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted">
                <Phone className="size-4" aria-hidden />
                {t("gardenPhone", { phone: formatPhone(kg.phone) })}
              </a>
            ) : null}
            <p>{t("poweredBy")}</p>
          </footer>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
