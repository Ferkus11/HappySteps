import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/format";

export async function Greeting({ name, timezone }: { name: string; timezone: string }) {
  const t = await getTranslations("dashboard");
  const first = name.split(" ")[1] ?? name.split(" ")[0];
  return (
    <div className="mb-5">
      <h1 className="text-[22px] font-extrabold tracking-tight md:text-[26px]">{t("hello", { name: first })}</h1>
      <p className="mt-1 text-sm text-muted">{formatDate(new Date(), timezone)}</p>
    </div>
  );
}
