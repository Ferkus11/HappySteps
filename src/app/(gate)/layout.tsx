import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/shell/language-switcher";

export default async function GateLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="relative flex min-h-dvh flex-col bg-sky-soft">
      <div className="absolute top-3 right-3">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[520px]">
          <div className="mb-6 flex items-center justify-center gap-2.5">
            <span className="grid size-11 place-items-center rounded-2xl bg-brand text-lg font-extrabold text-brand-fg">H</span>
            <span className="text-2xl font-extrabold tracking-tight">{t("appName")}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
