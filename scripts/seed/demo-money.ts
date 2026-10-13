/**
 * Demo: monthly invoices (accrued by the same SQL as the daily cron) and payment receipts in every state.
 * Derived invoice columns (FIFO allocation, statuses, paid_at) are computed by the database (invoices_recalc, D-025):
 * receipts are inserted in the order they were reviewed, so `paid_at` is the moment the money really arrived.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tinyPdf } from "./e2e-documents";
import { addDays, at, check, hm, insertMany, monthStart, pool, upload, uuid, weekday } from "./demo-lib";
import type { Child, Household, World } from "./demo-world";

type Row = Record<string, unknown>;

interface Invoice {
  id: string;
  child_id: string;
  period: string;
  amount: number;
  due_date: string;
  starts_on: string | null;
}

export interface ReceiptInfo {
  id: string;
  child: Child;
  period: string;
  status: "pending" | "accepted" | "rejected";
  amount: number | null;
  /** «to pay» on the invoice when the receipt was uploaded (for the accountant's notification) */
  due: number;
  reason: string | null;
  created: string;
  reviewed: string | null;
  uploadedBy: string;
}

const REJECT_REASONS = [
  "Сумма на чеке не совпадает с суммой к оплате",
  "На фото не видно даты и суммы — загрузите, пожалуйста, чёткий скриншот",
  "Это чек за другой месяц",
  "Получатель платежа — не наш сад, проверьте реквизиты",
];

const RECEIPT_PNG = () => readFileSync(path.join(process.cwd(), "scripts/seed/assets/receipt-sample.png"));

export async function seedMoney(db: SupabaseClient, w: World, archive: (c: Child) => Promise<void>): Promise<ReceiptInfo[]> {
  const rng = w.rng;
  const kg = w.kgId;
  const today = w.today;
  const current = monthStart(today);
  const months: string[] = [];
  for (let m = monthStart(w.start); m <= current; m = monthStart(m, 1)) months.push(m);

  // Accrual month by month; children who left before a month are archived before it is billed.
  const archived = new Set<string>();
  for (const m of months) {
    for (const c of w.children) {
      if (c.leave && c.leave.date < m && !archived.has(c.id)) {
        await archive(c);
        archived.add(c.id);
      }
    }
    check(await db.rpc("invoices_accrue", { p_kg: kg, p_period: m }), `accrue ${m}`);
  }
  for (const c of w.children) {
    if (c.leave && !archived.has(c.id)) {
      await archive(c);
      archived.add(c.id);
    }
  }

  // An invoice is created on the 1st (or on the first day of a late starter), not «now».
  for (const m of months) {
    check(await db.from("invoices").update({ created_at: at(m, "00:05") }).eq("kindergarten_id", kg).eq("period", m).is("starts_on", null), "invoice dates");
  }
  const invoices = check(
    await db.from("invoices").select("id, child_id, period, amount, due_date, starts_on").eq("kindergarten_id", kg).order("period"),
    "invoices",
  ) as unknown as Invoice[];
  for (const inv of invoices.filter((i) => i.starts_on)) {
    check(await db.from("invoices").update({ created_at: at(inv.starts_on!, "00:10") }).eq("id", inv.id), "invoice date");
  }
  const byChild = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    inv.amount = Number(inv.amount);
    byChild.set(inv.child_id, [...(byChild.get(inv.child_id) ?? []), inv]);
  }

  // Adjustments by the accountant (comment required, audited): leavers, late starters, a long illness.
  const audit: Row[] = [];
  const accountants = [w.s.accountant.id, w.s.accountant.id, w.s.accountant.id, w.s.admin2.id];
  const adjust = async (inv: Invoice, amount: number, comment: string, when: string) => {
    const by = w.s.accountant.id;
    check(
      await db.from("invoices").update({ amount, adjustment_comment: comment, adjusted_by: by, adjusted_at: when }).eq("id", inv.id),
      "adjust",
    );
    audit.push({ kindergarten_id: kg, actor_id: by, action: "invoice.adjust", entity: "invoice", entity_id: inv.id, details: { child_id: inv.child_id, period: inv.period, from: inv.amount, to: amount, comment }, created_at: when });
    inv.amount = amount;
  };
  for (const c of w.children) {
    const list = byChild.get(c.id) ?? [];
    if (c.leave && c.leave.reason !== "school") {
      const last = list.find((i) => i.period === monthStart(c.leave!.date));
      if (last && c.leave.date.slice(8) <= "12") await adjust(last, 15000, `Выбыл ${c.leave.date.split("-").reverse().join(".")}, перерасчёт за посещённые дни`, at(addDays(c.leave.date, 1), "11:20"));
    }
  }
  const lateStarters = invoices.filter((i) => i.starts_on && i.starts_on.slice(8) >= "05").slice(0, 2);
  for (const inv of lateStarters) {
    const share = Math.max(0.3, 1 - (Number(inv.starts_on!.slice(8)) - 1) / 30);
    await adjust(inv, Math.round((inv.amount * share) / 500) * 500, `Пропорционально с ${inv.starts_on!.split("-").reverse().join(".")}`, at(addDays(inv.starts_on!, 1), "10:15"));
  }
  {
    const sickKid = rng.pick(w.children.filter((c) => !c.leave && c.family.payer === "punctual" && (byChild.get(c.id) ?? []).length >= 3));
    const inv = (byChild.get(sickKid.id) ?? [])[1];
    if (inv) await adjust(inv, inv.amount - 20000, "Перерасчёт: болел больше 10 дней, справка в папке ребёнка", at(addDays(inv.period, 3), "12:40"));
  }

  // Two punctual families paid two months at once in the previous month (advance → this month is settled).
  const advance = new Set(
    rng.shuffle(w.households.filter((h) => h.payer === "punctual" && h.children.length === 1 && !h.children[0].leave && h !== w.demoParent && !h.parents.some((p) => p.staffKey))).slice(0, 2),
  );

  const receipts: ReceiptInfo[] = [];
  const nowCap = (d: string, minutes: number) => (d === today ? Math.min(minutes, Math.max(0, w.nowMin - 3)) : minutes);
  const stamp = (d: string, minutes: number) => at(d, hm(nowCap(d, minutes)));
  const evening = () => rng.int(18 * 60, 22 * 60 + 30);
  const morning = () => rng.int(9 * 60 + 15, 12 * 60 + 30);
  const reviewDay = (d: string) => {
    let x = addDays(d, 1);
    while (weekday(x) > 5) x = addDays(x, 1);
    return x;
  };
  const day = (period: string, k: number) => addDays(period, k - 1);
  // Receipts still waiting: uploaded in the last two days (the accountant checks the queue every working day).
  const recent = (inv: Invoice) => {
    const d = addDays(today, -rng.int(0, 2));
    const first = inv.starts_on ?? inv.period;
    return d < first ? (first > today ? today : first) : d;
  };
  const uploader = (h: Household) => h.parents[rng.chance(0.8) ? 0 : h.parents.length - 1].id;

  const add = (c: Child, inv: Invoice, r: { status: ReceiptInfo["status"]; createdDay: string; amount?: number; reason?: string; reviewDay?: string }) => {
    if (r.createdDay > today) return;
    const created = stamp(r.createdDay, r.createdDay === today ? rng.int(7 * 60, 9 * 60) : evening());
    let reviewed: string | null = null;
    if (r.status !== "pending") {
      const rd = r.reviewDay ?? reviewDay(r.createdDay);
      if (rd > today || (rd === today && w.nowMin < 9 * 60 + 30)) {
        // not reviewed yet → still waiting in the queue
        r = { ...r, status: "pending" };
      } else reviewed = stamp(rd, morning());
    }
    receipts.push({
      id: uuid(), child: c, period: inv.period, status: r.status,
      amount: r.status === "accepted" ? (r.amount ?? inv.amount) : null,
      due: inv.amount,
      reason: r.status === "rejected" ? (r.reason ?? rng.pick(REJECT_REASONS)) : null,
      created, reviewed, uploadedBy: uploader(c.family),
    });
  };

  for (const c of w.children) {
    const list = byChild.get(c.id) ?? [];
    const h = c.family;
    const demo = h === w.demoParent;
    list.forEach((inv, idx) => {
      const isCurrent = inv.period === current;
      const isLast = idx === list.length - 1;
      const first = inv.starts_on ?? inv.period;
      const firstDay = Number(first.slice(8));
      const kDay = (from: number, to: number) => day(inv.period, Math.max(firstDay, rng.int(from, to)));
      if (inv.amount <= 0) return;

      if (demo) {
        // The demo parent: September rejected → re-uploaded and accepted; this month one paid, one in review.
        const prevMonth = monthStart(today, -1);
        if (inv.period === prevMonth) {
          add(c, inv, { status: "rejected", createdDay: day(inv.period, 3), reason: REJECT_REASONS[1] });
          add(c, inv, { status: "accepted", createdDay: day(inv.period, 5) });
        } else if (isCurrent) {
          if (c.group === "botakan") add(c, inv, { status: "pending", createdDay: today });
          else add(c, inv, { status: "accepted", createdDay: day(inv.period, 4) });
        } else add(c, inv, { status: "accepted", createdDay: kDay(2, 7) });
        return;
      }
      if (c.leave) {
        // Left the garden: paid everything except the family who moved away in the middle of a month.
        if (c.leave.reason === "moved" && isLast) return;
        add(c, inv, { status: "accepted", createdDay: kDay(2, 9) });
        return;
      }
      if (advance.has(h)) {
        if (inv.period === monthStart(today, -1)) add(c, inv, { status: "accepted", createdDay: kDay(2, 6), amount: inv.amount * 2 });
        else if (!isCurrent) add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
        return;
      }
      if (inv.starts_on && isCurrent) {
        add(c, inv, { status: "pending", createdDay: recent(inv) });
        return;
      }
      switch (h.payer) {
        case "punctual":
        case "advance": {
          if (!isCurrent) return add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
          const r = rng.next();
          if (r < 0.88) return add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
          if (r < 0.96) return add(c, inv, { status: "pending", createdDay: recent(inv) });
          return; // forgot to pay yet
        }
        case "late": {
          if (!isCurrent) return add(c, inv, { status: "accepted", createdDay: kDay(12, 24) });
          const r = rng.next();
          if (r < 0.25) return add(c, inv, { status: "accepted", createdDay: kDay(8, 10) });
          if (r < 0.55) return add(c, inv, { status: "pending", createdDay: recent(inv) });
          return;
        }
        case "reject": {
          if (!isCurrent) {
            if (idx === list.length - 3 || (list.length < 3 && idx === 0)) {
              add(c, inv, { status: "rejected", createdDay: kDay(2, 4) });
              return add(c, inv, { status: "accepted", createdDay: kDay(6, 9) });
            }
            return add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
          }
          const r = rng.next();
          if (r < 0.35) return add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
          add(c, inv, { status: "rejected", createdDay: kDay(3, 6) });
          if (r < 0.7) add(c, inv, { status: "pending", createdDay: recent(inv) });
          return;
        }
        case "partial": {
          if (isCurrent) return;
          if (idx === list.length - 2) return add(c, inv, { status: "accepted", createdDay: kDay(4, 9), amount: Math.round((inv.amount * 0.6) / 1000) * 1000 });
          if (idx === list.length - 3) {
            add(c, inv, { status: "accepted", createdDay: kDay(3, 6), amount: Math.round(inv.amount / 2000) * 1000 });
            return add(c, inv, { status: "accepted", createdDay: kDay(18, 24), amount: inv.amount - Math.round(inv.amount / 2000) * 1000 });
          }
          return add(c, inv, { status: "accepted", createdDay: kDay(1, 8) });
        }
        case "debtor": {
          if (idx >= list.length - 2) return;
          return add(c, inv, { status: "accepted", createdDay: kDay(5, 20) });
        }
      }
    });
  }

  // Files: a phone screenshot (PNG) or a Kaspi PDF.
  const png = RECEIPT_PNG();
  const pdf = tinyPdf("Kaspi.kz - payment receipt");
  const files = receipts.map((r) => {
    const isPdf = rng.chance(0.25);
    return { r, path: `${kg}/${r.child.id}/${uuid()}.${isPdf ? "pdf" : "png"}`, body: isPdf ? pdf : png, mime: isPdf ? "application/pdf" : "image/png" };
  });
  await pool(files, 8, (f) => upload(db, "receipts", f.path, f.body, f.mime));

  const invOf = (r: ReceiptInfo) => byChild.get(r.child.id)!.find((i) => i.period === r.period)!;
  const ordered = [...files].sort((a, b) => {
    const ka = a.r.reviewed ?? `9${a.r.created}`;
    const kb = b.r.reviewed ?? `9${b.r.created}`;
    return ka.localeCompare(kb);
  });
  const rows = ordered.map(({ r, path: p, body, mime }) => {
    const reviewer = r.reviewed ? rng.pick(accountants) : null;
    if (r.reviewed) {
      audit.push({
        kindergarten_id: kg, actor_id: reviewer, action: r.status === "accepted" ? "receipt.confirm" : "receipt.reject", entity: "payment_receipt", entity_id: r.id,
        details: { invoice_id: invOf(r).id, child_id: r.child.id, period: r.period, amount: r.amount, reason: r.reason }, created_at: r.reviewed,
      });
    }
    return {
      id: r.id, kindergarten_id: kg, invoice_id: invOf(r).id, child_id: r.child.id, uploaded_by: r.uploadedBy, file_path: p, mime, size: body.length,
      status: r.status, confirmed_amount: r.amount, reject_reason: r.reason, reviewed_by: reviewer, reviewed_at: r.reviewed, created_at: r.created,
    };
  });
  // One by one in review order inside each chunk (the recalc trigger runs per row, in insertion order).
  await insertMany(db, "payment_receipts", rows, 200);
  await insertMany(db, "audit_log", audit);
  return receipts;
}
