import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { signedUrl } from "@/lib/kg-assets";
import { DailySettings, OwnerSettings } from "./forms";
import { settingsSections } from "./sections";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

export default async function SettingsPage() {
  const ctx = await requireKg(["owner", "head"]);
  const t = await getTranslations("settings");
  const s = ctx.settings;
  const isOwner = ctx.role === "owner";
  const logo = await signedUrl("kindergarten-assets", ctx.kg.logo_path, 600);
  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid gap-4 xl:grid-cols-2">
        {isOwner ? (
          <OwnerSettings
            logoUrl={logo}
            value={{
              name: ctx.kg.name,
              accentColor: ctx.kg.accent_color ?? "#C02A62",
              timezone: s.timezone,
              paymentDueDay: s.payment_due_day,
              requisites: {
                kaspi: s.requisites?.kaspi ?? "",
                iban: s.requisites?.iban ?? "",
                bank: s.requisites?.bank ?? "",
                recipient: s.requisites?.recipient ?? "",
                purpose: s.requisites?.purpose ?? "",
              },
              consentText: s.consent_text ?? "",
            }}
          />
        ) : null}
        <DailySettings
          value={{
            defaultLocale: s.default_locale,
            address: s.address ?? "",
            phone: s.phone ?? "",
            lateThresholdMinutes: s.late_threshold_minutes,
            attendanceReminderTime: s.attendance_reminder_time.slice(0, 5),
            attendanceEscalationTime: s.attendance_escalation_time.slice(0, 5),
            quietHoursStart: s.quiet_hours_start.slice(0, 5),
            quietHoursEnd: s.quiet_hours_end.slice(0, 5),
            meals: s.meals,
          }}
        />
        {settingsSections.map((Section, i) => (
          <Section key={i} />
        ))}
      </div>
    </>
  );
}
