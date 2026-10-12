import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";
import { loadMessages } from "@/messages";

export default getRequestConfig(async () => {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: "Asia/Almaty",
    formats: {
      dateTime: {
        short: { day: "2-digit", month: "2-digit", year: "numeric" },
        time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      },
    },
  };
});
