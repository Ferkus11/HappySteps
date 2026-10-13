import { getTranslations } from "next-intl/server";
import { requireAnyContext } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { formatPhone } from "@/lib/phone";
import { ProfileForm } from "./profile-form";
import { profileSections } from "./sections";

export async function generateMetadata() {
  return { title: (await getTranslations("profile"))("title") };
}

export default async function ProfilePage() {
  const ctx = await requireAnyContext();
  const t = await getTranslations("profile");
  return (
    <>
      <PageHeader title={t("title")} />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <div className="flex items-center gap-4">
            <Avatar name={ctx.profile.full_name} size={64} />
            <div>
              <div data-user-content className="text-lg font-extrabold">{ctx.profile.full_name}</div>
              <div className="text-muted">{formatPhone(ctx.profile.phone)}</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-faint">{t("nameHint")}</p>
          <ProfileForm locale={ctx.profile.locale} birthDate={ctx.profile.birth_date} />
        </Card>
        {profileSections.map((S, i) => (
          <S key={i} />
        ))}
      </div>
    </>
  );
}
