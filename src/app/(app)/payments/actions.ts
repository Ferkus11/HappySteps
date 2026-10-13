"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { commitUpload, prepareUpload, type PreparedUpload } from "@/lib/uploads";
import type { DeclaredFile } from "@/lib/uploads-core";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { memberIds, notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/service";
import { signedUrl } from "@/lib/kg-assets";
import { formatMoney } from "@/lib/format";
import { periodOf, toPay } from "@/lib/payments";
import { zMoney, zUuid } from "@/lib/validation";

const BUCKET = "receipts";
const MANAGERS = ["owner", "accountant"] as const;

/**
 * Notification param `month` is a language-neutral `YYYY-MM`: whoever renders the notification (in-app centre /
 * push, stage 6) turns it into the month name in the reader's language.
 */
const monthParam = (period: string) => period.slice(0, 7);

/** «Начислить за месяц»: idempotent, creates missing invoices of the month (same SQL as the daily cron). */
export async function accrueMonthAction(month: string) {
  return kgAction([...MANAGERS], async (ctx, supabase) => {
    const m = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "invalid").parse(month);
    const n = check(await supabase.rpc("accrue_invoices", { p_kg: ctx.kg.id, p_period: periodOf(m) }));
    return { count: Number(n) };
  });
}

const adjustSchema = z.object({
  amount: zMoney,
  comment: z.string().trim().min(3, "adjustCommentRequired").max(500, "tooLong"),
});

/** Change one invoice's amount with a mandatory comment (audited inside SQL as invoice.adjust). */
export async function adjustInvoiceAction(id: string, input: z.input<typeof adjustSchema>) {
  return kgAction([...MANAGERS], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(adjustSchema, input);
    const { data: inv } = await supabase.from("invoices").select("id").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!inv) throw new ActionError("notFound");
    check(await supabase.rpc("adjust_invoice", { p_id: id, p_amount: v.amount, p_comment: v.comment }));
  });
}

/** The invoice, visible to this parent (RLS: own children only) with an active guardian link (is_guardian). */
async function parentInvoice(ctx: KgContext, supabase: SupabaseClient, invoiceId: string) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("id, child_id, period, carried, balance, children(full_name)")
    .eq("id", invoiceId)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  if (!inv) throw new ActionError("notFound");
  const { data: guardian } = await supabase.rpc("is_guardian", { c: inv.child_id });
  if (guardian !== true) throw new ActionError("forbidden");
  return inv;
}

/**
 * Step A of a receipt upload (photo/screenshot/PDF; HEIC is converted to JPEG in the browser), D-035:
 * permission, limits, signed upload URL for a server-chosen path in the child's folder.
 */
export async function prepareReceiptAction(invoiceId: string, file: DeclaredFile) {
  return kgAction(["parent"], async (ctx, supabase): Promise<PreparedUpload> => {
    zUuid.parse(invoiceId);
    const inv = await parentInvoice(ctx, supabase, invoiceId);
    const prefix = `${ctx.kg.id}/${inv.child_id}/`;
    return prepareUpload("receipt", ctx, { target: invoiceId, prefix, file, path: (ext, id) => `${prefix}${id}.${ext}` });
  });
}

/** Step C: re-checks the parent, verifies the stored file — the type is taken from its first bytes, never from
 * the browser — writes the receipt row and tells the accountant (or the owner). */
export async function commitReceiptAction(invoiceId: string, ticket: string) {
  return kgAction(["parent"], async (ctx, supabase) => {
    zUuid.parse(invoiceId);
    const inv = await parentInvoice(ctx, supabase, invoiceId);
    const file = await commitUpload("receipt", ctx, ticket, { target: invoiceId, prefix: `${ctx.kg.id}/${inv.child_id}/` });
    const service = createServiceClient();
    // Permission checked above; receipt rows are written by the server only.
    const ins = await service.from("payment_receipts").insert({
      kindergarten_id: ctx.kg.id,
      invoice_id: inv.id,
      child_id: inv.child_id,
      uploaded_by: ctx.userId,
      file_path: file.path,
      mime: file.mime,
      size: file.size,
    });
    if (ins.error) {
      if (ins.error.code !== "23505") await service.storage.from(BUCKET).remove([file.path]);
      check(ins);
    }
    let staff = await memberIds(ctx.kg.id, ["accountant"]);
    if (!staff.length) staff = await memberIds(ctx.kg.id, ["owner"]);
    const child = (inv.children as unknown as { full_name: string } | null)?.full_name ?? "";
    await notify({
      kindergartenId: ctx.kg.id,
      userIds: staff.filter((u) => u !== ctx.userId),
      type: "receipt.new",
      params: { child, amount: formatMoney(toPay({ carried: Number(inv.carried), balance: Number(inv.balance) })), month: monthParam(String(inv.period)) },
      url: "/payments?tab=review",
    });
  });
}

const reviewSchema = z.discriminatedUnion("accept", [
  z.object({ accept: z.literal(true), amount: z.coerce.number({ message: "numberInvalid" }).positive("numberInvalid").max(100_000_000, "numberInvalid") }),
  z.object({ accept: z.literal(false), reason: z.string().trim().min(3, "rejectReasonRequired").max(500, "tooLong") }),
]);

/** Accountant/owner confirms (with the confirmed amount) or rejects (with a reason) a pending receipt. */
export async function reviewReceiptAction(id: string, input: z.input<typeof reviewSchema>) {
  return kgAction([...MANAGERS], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(reviewSchema, input);
    const { data: rec } = await supabase.from("payment_receipts").select("id, child_id").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!rec) throw new ActionError("notFound");
    const r = check(
      await supabase.rpc("review_receipt", {
        p_id: id,
        p_accept: v.accept,
        p_amount: v.accept ? v.amount : null,
        p_reason: v.accept ? null : v.reason,
      }),
    ) as { invoice_id: string; child_id: string; confirmed_amount: string | null; reject_reason: string | null };
    const { data: inv } = await supabase.from("invoices").select("period").eq("id", r.invoice_id).single();
    // Every active parent of the child (the uploader and co-guardians) learns the result.
    const { data: links } = await createServiceClient().from("child_guardians").select("user_id").eq("child_id", r.child_id);
    const parents = new Set(await memberIds(ctx.kg.id, ["parent"]));
    const ids = (links ?? []).map((l) => l.user_id as string).filter((u) => parents.has(u));
    const month = inv ? monthParam(String(inv.period)) : "";
    await notify({
      kindergartenId: ctx.kg.id,
      userIds: ids,
      type: v.accept ? "receipt.accepted" : "receipt.rejected",
      params: v.accept ? { month, amount: formatMoney(r.confirmed_amount) } : { month, reason: r.reject_reason },
      url: "/payments",
    });
  });
}

const revertSchema = z.object({ reason: z.string().trim().min(3, "revertReasonRequired").max(500, "tooLong") });

/** Owner/accountant undo a wrong decision: the receipt goes back to «На проверке» (audited inside SQL as receipt.revert). */
export async function revertReceiptAction(id: string, input: z.input<typeof revertSchema>) {
  return kgAction([...MANAGERS], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(revertSchema, input);
    const { data: rec } = await supabase.from("payment_receipts").select("id").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!rec) throw new ActionError("notFound");
    check(await supabase.rpc("revert_receipt_review", { p_id: id, p_reason: v.reason }));
  });
}

/** Short-lived link to a receipt file; RLS decides who may read the row (staff with access, the child's parents). */
export async function receiptUrlAction(id: string) {
  return kgAction(["owner", "head", "accountant", "parent"], async (ctx, supabase) => {
    zUuid.parse(id);
    const { data } = await supabase.from("payment_receipts").select("file_path, mime").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!data) throw new ActionError("notFound");
    const url = await signedUrl(BUCKET, data.file_path as string, 120);
    if (!url) throw new ActionError("generic");
    return { url, mime: data.mime as string };
  });
}
