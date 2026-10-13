import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { RECEIPT_SAMPLE } from "../../scripts/seed/e2e-payments";

config({ path: ".env.local", quiet: true });

/**
 * Deterministic «Требует внимания» state for the dashboard tests (stage 5A), re-runnable on the same DB:
 * today is a working day, the attendance reminder time has passed (00:00), nobody in group «Солнышко»
 * is marked today and one receipt of the current month waits for review. `restore()` undoes all of it.
 */
export const db: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const CUR = `${today.slice(0, 7)}-01`;

export interface DashState {
  A: string;
  sunny: string;
  receiptId: string;
  restore: () => Promise<void>;
}

export async function prepareDashboards(): Promise<DashState> {
  const A = (await db.from("kindergartens").select("id").eq("slug", "e2e-a").single()).data!.id as string;
  const sunny = (await db.from("groups").select("id").eq("kindergarten_id", A).eq("name", "Солнышко").single()).data!.id as string;

  const { data: settings } = await db.from("kindergarten_settings").select("attendance_reminder_time").eq("kindergarten_id", A).single();
  const reminder = settings!.attendance_reminder_time as string;
  await db.from("kindergarten_settings").update({ attendance_reminder_time: "00:00" }).eq("kindergarten_id", A);

  let restoreHoliday: { date: string; name: string; kind: string } | null | undefined;
  const { data: working } = await db.rpc("kg_is_working_day", { kg: A, d: today });
  if (!working) {
    const { data: existing } = await db.from("holidays").select("date, name, kind").eq("kindergarten_id", A).eq("date", today).maybeSingle();
    restoreHoliday = existing ?? null;
    await db.from("holidays").upsert({ kindergarten_id: A, date: today, name: "E2E рабочий день", kind: "working_day" }, { onConflict: "kindergarten_id,date" });
  }

  // Group «Солнышко» not marked today (reports would count as marks — clear today's ones as well).
  await db.from("child_attendance").delete().eq("kindergarten_id", A).eq("group_id", sunny).eq("date", today);
  const { data: kids } = await db.from("children").select("id").eq("kindergarten_id", A).eq("group_id", sunny);
  const kidIds = (kids ?? []).map((k) => k.id as string);
  if (kidIds.length) await db.from("absence_reports").delete().in("child_id", kidIds).lte("date_from", today).gte("date_to", today);

  // One receipt waiting for review (as the upload action stores it).
  await db.rpc("invoices_accrue", { p_kg: A, p_period: CUR });
  const alikhan = (await db.from("children").select("id").eq("kindergarten_id", A).ilike("full_name", "%Алихан%").single()).data!.id as string;
  const inv = (await db.from("invoices").select("id").eq("child_id", alikhan).eq("period", CUR).single()).data!.id as string;
  const path = `${A}/${alikhan}/${crypto.randomUUID()}.png`;
  const file = RECEIPT_SAMPLE();
  await db.storage.from("receipts").upload(path, file, { contentType: "image/png" });
  const { data: rec, error } = await db
    .from("payment_receipts")
    .insert({ kindergarten_id: A, invoice_id: inv, child_id: alikhan, uploaded_by: null, file_path: path, mime: "image/png", size: file.length })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const receiptId = rec.id as string;

  return {
    A,
    sunny,
    receiptId,
    restore: async () => {
      await db.from("payment_receipts").delete().eq("id", receiptId);
      await db.storage.from("receipts").remove([path]);
      await db.from("kindergarten_settings").update({ attendance_reminder_time: reminder }).eq("kindergarten_id", A);
      if (restoreHoliday === null) await db.from("holidays").delete().eq("kindergarten_id", A).eq("date", today);
      else if (restoreHoliday) await db.from("holidays").upsert({ kindergarten_id: A, ...restoreHoliday }, { onConflict: "kindergarten_id,date" });
    },
  };
}
