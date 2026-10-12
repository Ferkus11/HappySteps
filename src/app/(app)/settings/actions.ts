"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { zColor, zOptionalText, zTime } from "@/lib/validation";

const dailySchema = z.object({
  defaultLocale: z.enum(["ru", "kk"]),
  address: zOptionalText(200),
  phone: zOptionalText(40),
  lateThresholdMinutes: z.coerce.number().int().min(0, "numberInvalid").max(180, "numberInvalid"),
  attendanceReminderTime: zTime,
  attendanceEscalationTime: zTime,
  quietHoursStart: zTime,
  quietHoursEnd: zTime,
});

export async function saveDailySettingsAction(input: z.input<typeof dailySchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(dailySchema, input);
    check(
      await supabase
        .from("kindergarten_settings")
        .update({
          default_locale: v.defaultLocale,
          address: v.address,
          phone: v.phone,
          late_threshold_minutes: v.lateThresholdMinutes,
          attendance_reminder_time: v.attendanceReminderTime,
          attendance_escalation_time: v.attendanceEscalationTime,
          quiet_hours_start: v.quietHoursStart,
          quiet_hours_end: v.quietHoursEnd,
        })
        .eq("kindergarten_id", ctx.kg.id),
    );
    await audit(supabase, ctx.kg.id, "kindergarten.settings", "kindergarten", ctx.kg.id, { section: "daily" });
  });
}

const ownerSchema = z.object({
  name: z.string().trim().min(2, "tooShort").max(120, "tooLong"),
  accentColor: zColor,
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "invalid"),
  paymentDueDay: z.coerce.number().int().min(1, "numberInvalid").max(28, "numberInvalid"),
  requisites: z.object({
    kaspi: z.string().max(120).default(""),
    iban: z.string().max(40).default(""),
    bank: z.string().max(120).default(""),
    recipient: z.string().max(200).default(""),
    purpose: z.string().max(300).default(""),
  }),
  consentText: z.string().max(10000, "tooLong").default(""),
});

export async function saveOwnerSettingsAction(input: z.input<typeof ownerSchema>) {
  return kgAction(["owner"], async (ctx, supabase) => {
    const v = parse(ownerSchema, input);
    check(await supabase.from("kindergartens").update({ name: v.name, accent_color: v.accentColor }).eq("id", ctx.kg.id));
    check(
      await supabase
        .from("kindergarten_settings")
        .update({ timezone: v.timezone, payment_due_day: v.paymentDueDay, requisites: v.requisites, consent_text: v.consentText.trim() })
        .eq("kindergarten_id", ctx.kg.id),
    );
    await audit(supabase, ctx.kg.id, "kindergarten.settings", "kindergarten", ctx.kg.id, { section: "owner" });
  });
}

export async function uploadLogoAction(form: FormData) {
  return kgAction(["owner"], async (ctx, supabase) => {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ActionError("invalid");
    if (file.size > 2 * 1024 * 1024) throw new ActionError("fileTooLarge");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new ActionError("fileType");
    const path = `${ctx.kg.id}/logo-${Date.now()}.${file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;
    const service = createServiceClient();
    const up = await service.storage.from("kindergarten-assets").upload(path, file, { contentType: file.type });
    if (up.error) throw new ActionError("generic");
    const res = await supabase.from("kindergartens").update({ logo_path: path }).eq("id", ctx.kg.id).select("id");
    if (res.error || !res.data?.length) {
      await service.storage.from("kindergarten-assets").remove([path]);
      throw new ActionError("forbidden");
    }
    if (ctx.kg.logo_path) await service.storage.from("kindergarten-assets").remove([ctx.kg.logo_path]);
  });
}
