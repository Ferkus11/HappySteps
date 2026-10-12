"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { saveProfileAction } from "./actions";

export function ProfileForm({ locale, birthDate }: { locale: "ru" | "kk"; birthDate: string | null }) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { run, pending } = useAction(saveProfileAction, { success: t("saved") });
  return (
    <form
      className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({ locale: String(f.get("locale")) as "ru", birthDate: String(f.get("birthDate") ?? "") });
      }}
    >
      <Field label={t("language")} htmlFor="p-loc">
        <Select id="p-loc" name="locale" defaultValue={locale}>
          <option value="ru">{tc("languages.ru")}</option>
          <option value="kk">{tc("languages.kk")}</option>
        </Select>
      </Field>
      <Field label={t("birthDate")} htmlFor="p-bd" hint={t("birthDateHint")}>
        <Input id="p-bd" name="birthDate" type="date" defaultValue={birthDate ?? ""} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
