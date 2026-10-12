/**
 * Fees fixtures (stage 3C). Re-runnable: garden A's invoices/receipts are rebuilt from scratch on every run.
 * Monthly fees come from the children fixtures (60 000–65 000 ₸). Invoices for the previous and the current month:
 * - Миша: previous month paid (accepted receipt), current month unpaid;
 * - Айлин: previous month partially paid (40 000 of 60 000) → 20 000 carried into the current month;
 * - Алихан: previous month paid, current month has a pending receipt (a real small PNG in storage);
 * - Сабина: nothing paid → in the debtors list.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string };
}

const BUCKET = "receipts";
const tz = "Asia/Almaty";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthStart = (iso: string, delta = 0) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
};

export const RECEIPT_SAMPLE = () => readFileSync(path.join(process.cwd(), "scripts/seed/assets/receipt-sample.png"));

/** Removes every invoice/receipt (and receipt file) of a kindergarten. */
export async function clearPayments(db: SupabaseClient, kg: string) {
  const { data: files } = await db.from("payment_receipts").select("file_path").eq("kindergarten_id", kg);
  const paths = (files ?? []).map((f) => f.file_path as string);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  must(await db.from("payment_receipts").delete().eq("kindergarten_id", kg).select("id"), "clear receipts");
  must(await db.from("invoices").delete().eq("kindergarten_id", kg).select("id"), "clear invoices");
}

export async function seedPayments(db: SupabaseClient, ids: Ids) {
  const A = ids.kindergartens.A;
  const u = ids.users;
  await clearPayments(db, A);
  const t0 = today();
  const prev = monthStart(t0, -1);
  const cur = monthStart(t0);
  for (const p of [prev, cur]) must(await db.rpc("invoices_accrue", { p_kg: A, p_period: p }), "accrue");

  const { data: kids } = await db.from("children").select("id, full_name").eq("kindergarten_id", A);
  const child = (first: string) => (kids ?? []).find((k) => (k.full_name as string).split(" ")[1] === first)?.id as string;
  const { data: invs } = await db.from("invoices").select("id, child_id, period").eq("kindergarten_id", A);
  const invoice = (childId: string, period: string) => (invs ?? []).find((i) => i.child_id === childId && i.period === period)?.id as string;

  const png = RECEIPT_SAMPLE();
  const receipt = async (first: string, period: string, row: Record<string, unknown>, uploadedBy: string | null) => {
    const c = child(first);
    const inv = invoice(c, period);
    if (!c || !inv) return;
    const file = `${A}/${c}/seed-${period.slice(0, 7)}-${String(row.status)}.png`;
    await db.storage.from(BUCKET).upload(file, png, { contentType: "image/png", upsert: true });
    must(
      await db
        .from("payment_receipts")
        .insert({ kindergarten_id: A, invoice_id: inv, child_id: c, uploaded_by: uploadedBy, file_path: file, mime: "image/png", size: png.length, ...row })
        .select("id")
        .single(),
      "receipt",
    );
  };
  const reviewedAt = `${prev.slice(0, 8)}09T11:30:00+05:00`;
  const accepted = (amount: number) => ({ status: "accepted", confirmed_amount: amount, reviewed_by: u.accountant, reviewed_at: reviewedAt, created_at: `${prev.slice(0, 8)}08T19:10:00+05:00` });
  await receipt("Миша", prev, accepted(65000), u.teacherParent);
  await receipt("Алихан", prev, accepted(65000), u.parent);
  await receipt("Айлин", prev, accepted(40000), null);
  await receipt("Алихан", cur, { status: "pending" }, u.parent);
}
