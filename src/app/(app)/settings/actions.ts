"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { commitUpload, prepareUpload, removeObject, type PreparedUpload } from "@/lib/uploads";
import { UPLOAD_SPECS, type DeclaredFile } from "@/lib/uploads-core";
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

const LOGO_BUCKET = UPLOAD_SPECS.logo.bucket;

/** Step A of a logo upload (owner only, D-035): limits and a signed upload URL for a server-chosen path. */
export async function prepareLogoAction(file: DeclaredFile) {
  return kgAction(["owner"], async (ctx): Promise<PreparedUpload> => {
    const prefix = `${ctx.kg.id}/logo-`;
    return prepareUpload("logo", ctx, { target: ctx.kg.id, prefix, file, path: (ext, id) => `${prefix}${id}.${ext}` });
  });
}

/** Step C: verifies the uploaded logo (size, real type) and sets it; the old one is removed. */
export async function commitLogoAction(ticket: string) {
  return kgAction(["owner"], async (ctx, supabase) => {
    const file = await commitUpload("logo", ctx, ticket, { target: ctx.kg.id, prefix: `${ctx.kg.id}/logo-` });
    if (ctx.kg.logo_path === file.path) return;
    const res = await supabase.from("kindergartens").update({ logo_path: file.path }).eq("id", ctx.kg.id).select("id");
    if (res.error || !res.data?.length) {
      await removeObject(LOGO_BUCKET, file.path);
      throw new ActionError("forbidden");
    }
    if (ctx.kg.logo_path) await removeObject(LOGO_BUCKET, ctx.kg.logo_path);
  });
}
