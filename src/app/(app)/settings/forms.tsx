"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { saveDailySettingsAction, saveOwnerSettingsAction, uploadLogoAction } from "./actions";

const ACCENTS = ["#C02A62", "#D6336C", "#1F6FAE", "#2E9E7A", "#7C6CD6", "#C2571A"];

export function DailySettings({
  value,
}: {
  value: {
    defaultLocale: "ru" | "kk";
    address: string;
    phone: string;
    lateThresholdMinutes: number;
    attendanceReminderTime: string;
    attendanceEscalationTime: string;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { run, pending, fieldError } = useAction(saveDailySettingsAction, { success: t("saved") });
  return (
    <Card>
      <CardHeader title={t("daily")} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run({
            defaultLocale: String(f.get("defaultLocale")) as "ru",
            address: String(f.get("address") ?? ""),
            phone: String(f.get("phone") ?? ""),
            lateThresholdMinutes: String(f.get("late")),
            attendanceReminderTime: String(f.get("rem")),
            attendanceEscalationTime: String(f.get("esc")),
            quietHoursStart: String(f.get("qs")),
            quietHoursEnd: String(f.get("qe")),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("defaultLocale")} htmlFor="s-loc">
            <Select id="s-loc" name="defaultLocale" defaultValue={value.defaultLocale}>
              <option value="ru">{tc("languages.ru")}</option>
              <option value="kk">{tc("languages.kk")}</option>
            </Select>
          </Field>
          <Field label={t("phone")} htmlFor="s-phone">
            <Input id="s-phone" name="phone" defaultValue={value.phone} />
          </Field>
        </div>
        <Field label={t("address")} htmlFor="s-addr">
          <Input id="s-addr" name="address" defaultValue={value.address} />
        </Field>
        <Field label={t("lateThreshold")} htmlFor="s-late" error={fieldError("lateThresholdMinutes")}>
          <Input id="s-late" name="late" type="number" min={0} max={180} defaultValue={value.lateThresholdMinutes} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("attendanceReminder")} htmlFor="s-rem">
            <Input id="s-rem" name="rem" type="time" defaultValue={value.attendanceReminderTime} />
          </Field>
          <Field label={t("attendanceEscalation")} htmlFor="s-esc">
            <Input id="s-esc" name="esc" type="time" defaultValue={value.attendanceEscalationTime} />
          </Field>
        </div>
        <Field label={t("quietHours")} hint={t("quietHint")}>
          <div className="grid grid-cols-2 gap-3">
            <Input name="qs" type="time" defaultValue={value.quietHoursStart} aria-label={`${t("quietHours")} 1`} />
            <Input name="qe" type="time" defaultValue={value.quietHoursEnd} aria-label={`${t("quietHours")} 2`} />
          </div>
        </Field>
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
      </form>
    </Card>
  );
}

export function OwnerSettings({
  value,
  logoUrl,
}: {
  logoUrl: string | null;
  value: {
    name: string;
    accentColor: string;
    timezone: string;
    paymentDueDay: number;
    requisites: { kaspi: string; iban: string; bank: string; recipient: string; purpose: string };
    consentText: string;
  };
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [accent, setAccent] = React.useState(value.accentColor);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { run, pending, fieldError } = useAction(saveOwnerSettingsAction, { success: t("saved") });
  const logo = useAction(uploadLogoAction, { success: t("saved") });
  return (
    <Card>
      <CardHeader title={t("general")} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run({
            name: String(f.get("name")),
            accentColor: accent,
            timezone: String(f.get("timezone")),
            paymentDueDay: String(f.get("dueDay")),
            requisites: {
              kaspi: String(f.get("kaspi") ?? ""),
              iban: String(f.get("iban") ?? ""),
              bank: String(f.get("bank") ?? ""),
              recipient: String(f.get("recipient") ?? ""),
              purpose: String(f.get("purpose") ?? ""),
            },
            consentText: String(f.get("consent") ?? ""),
          });
        }}
      >
        <Field label={t("name")} htmlFor="o-name" error={fieldError("name")}>
          <Input id="o-name" name="name" defaultValue={value.name} required />
        </Field>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-14 rounded-2xl object-cover" />
          ) : (
            <span className="grid size-14 place-items-center rounded-2xl text-xl font-extrabold text-white" style={{ background: accent }}>
              {value.name.slice(0, 1)}
            </span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={logo.pending}>
            <Upload /> {t("uploadLogo")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.set("file", file);
              logo.run(fd);
              e.target.value = "";
            }}
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-muted">{t("accent")}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={accent === c}
                onClick={() => setAccent(c)}
                className={`size-11 cursor-pointer rounded-full border-4 ${accent === c ? "border-text/70" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label={t("accent")} className="size-11 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0" />
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("timezone")} htmlFor="o-tz" error={fieldError("timezone")}>
            <Select id="o-tz" name="timezone" defaultValue={value.timezone}>
              {["Asia/Almaty", "Asia/Aqtobe", "Asia/Aqtau", "Asia/Atyrau", "Asia/Oral", "Asia/Qyzylorda", "Asia/Qostanay"].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("dueDay")} htmlFor="o-due" error={fieldError("paymentDueDay")}>
            <Input id="o-due" name="dueDay" type="number" min={1} max={28} defaultValue={value.paymentDueDay} />
          </Field>
        </div>
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-bold">{t("requisites")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("kaspi")} htmlFor="o-kaspi">
              <Input id="o-kaspi" name="kaspi" defaultValue={value.requisites.kaspi} />
            </Field>
            <Field label={t("iban")} htmlFor="o-iban">
              <Input id="o-iban" name="iban" defaultValue={value.requisites.iban} />
            </Field>
            <Field label={t("bank")} htmlFor="o-bank">
              <Input id="o-bank" name="bank" defaultValue={value.requisites.bank} />
            </Field>
            <Field label={t("recipient")} htmlFor="o-rec">
              <Input id="o-rec" name="recipient" defaultValue={value.requisites.recipient} />
            </Field>
          </div>
          <Field label={t("purpose")} htmlFor="o-purp">
            <Input id="o-purp" name="purpose" defaultValue={value.requisites.purpose} />
          </Field>
        </div>
        <Field label={t("consent")} htmlFor="o-consent" hint={t("consentHint")}>
          <Textarea id="o-consent" name="consent" rows={4} defaultValue={value.consentText} />
        </Field>
        <Button type="submit" disabled={pending}>
          {tc("save")}
        </Button>
      </form>
    </Card>
  );
}
