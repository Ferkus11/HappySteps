import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx, type Who } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const n = async (c: PoolClient, sql: string, params: unknown[] = []) => Number((await c.query(`select count(*)::int as n from (${sql}) q`, params)).rows[0].n);

/** Fresh payments state inside the transaction: Sep + Oct 2026 invoices for every fee-paying child of A. */
async function fresh(c: PoolClient) {
  await c.query("reset role");
  await c.query("delete from payment_receipts where kindergarten_id = $1", [F.A]);
  await c.query("delete from invoices where kindergarten_id = $1", [F.A]);
  await c.query("select invoices_accrue($1, '2026-09-01'), invoices_accrue($1, '2026-10-01')", [F.A]);
}

/** Runs a statement that must fail with the given message, keeping the transaction usable. */
async function failsWith(c: PoolClient, sql: string, params: unknown[], re: RegExp) {
  await c.query("savepoint e");
  try {
    await c.query(sql, params);
    throw new Error(`expected failure: ${sql}`);
  } catch (e) {
    expect(String((e as Error).message)).toMatch(re);
  } finally {
    await c.query("rollback to savepoint e");
  }
}

const invoiceOf = async (c: PoolClient, child: string, period: string) =>
  (await c.query("select * from invoices where child_id = $1 and period = $2", [F.children[child], period])).rows[0];

/** A receipt row as the server writes it (service role / superuser). */
async function serverReceipt(c: PoolClient, child: string, period: string) {
  await c.query("reset role");
  const inv = await invoiceOf(c, child, period);
  const r = await c.query(
    "insert into payment_receipts (kindergarten_id, invoice_id, child_id, file_path, mime, size) values ($1, $2, $3, $4, 'image/png', 100) returning id",
    [F.A, inv.id, inv.child_id, `${F.A}/${inv.child_id}/${crypto.randomUUID()}.png`],
  );
  return r.rows[0].id as string;
}

describe("payments · visibility (SPEC §3.4)", () => {
  it("owner/head/accountant see all invoices of A; teacher, cook, club teacher nothing; parents only own children", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const all = await n(c, "select 1 from invoices where kindergarten_id = $1", [F.A]);
      expect(all).toBeGreaterThanOrEqual(8);
      await serverReceipt(c, "Алихан", "2026-10-01");
      await serverReceipt(c, "Миша", "2026-10-01");
      const expected: Partial<Record<Who, number>> = { owner: all, head: all, accountant: all, teacher: 0, cook: 0, clubTeacher: 0, ownerB: 0, parentB: 0 };
      for (const [who, count] of Object.entries(expected) as [Who, number][]) {
        await become(F.users[who]);
        expect(await n(c, "select 1 from invoices where kindergarten_id = $1", [F.A]), who).toBe(count);
        expect(await n(c, "select 1 from payment_receipts where kindergarten_id = $1", [F.A]), who).toBe(count ? 2 : 0);
      }
      await become(F.users.parent);
      const mine = await c.query("select distinct child_id from invoices");
      expect(mine.rows.map((r) => r.child_id)).toEqual([F.children["Алихан"]]);
      expect(await n(c, "select 1 from payment_receipts")).toBe(1);
      expect((await c.query("select child_id from payment_debtors($1)", [F.A])).rows.map((r) => r.child_id)).toEqual([F.children["Алихан"]]);
      await become(F.users.teacherParent); // teacher of Звёздочки and parent of Миша
      expect((await c.query("select distinct child_id from invoices")).rows.map((r) => r.child_id)).toEqual([F.children["Миша"]]);
      await become(F.users.teacher);
      expect(await n(c, "select 1 from payment_debtors($1)", [F.A])).toBe(0);
      await become(null);
      expect(await n(c, "select 1 from invoices")).toBe(0);
      expect(await n(c, "select 1 from payment_receipts")).toBe(0);
    });
  });

  it("an archived child's debt stays visible to finance staff", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      await c.query("update children set status = 'archived', archived_at = now() where id = $1", [F.children["Айлин"]]);
      await become(F.users.accountant);
      const r = await c.query("select debt, child_status from payment_debtors($1) where child_id = $2", [F.A, F.children["Айлин"]]);
      expect(r.rows[0]).toMatchObject({ child_status: "archived" });
      expect(Number(r.rows[0].debt)).toBe(120000);
      // archived children are not billed again
      await c.query("reset role");
      await c.query("delete from invoices where period = '2026-10-01' and child_id = any($1)", [[F.children["Айлин"], F.children["Миша"]]]);
      await c.query("select invoices_accrue($1, '2026-10-01')", [F.A]);
      expect(await n(c, "select 1 from invoices where child_id = $1 and period = '2026-10-01'", [F.children["Айлин"]])).toBe(0);
      expect(await n(c, "select 1 from invoices where child_id = $1 and period = '2026-10-01'", [F.children["Миша"]])).toBe(1);
    });
  });
});

describe("payments · no direct writes", () => {
  it("nobody (not even owner/accountant) inserts, updates or deletes invoices directly", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const inv = await invoiceOf(c, "Алихан", "2026-10-01");
      for (const who of ["owner", "accountant", "head", "parent", "teacher"] as Who[]) {
        await become(F.users[who]);
        expect(await rejects(c, "update invoices set status = 'paid' where id = $1", [inv.id]), `${who} status`).toBe(true);
        expect(await rejects(c, "update invoices set amount = 1 where id = $1", [inv.id]), `${who} amount`).toBe(true);
        expect(await rejects(c, "update invoices set paid_amount = 65000 where id = $1", [inv.id]), `${who} paid`).toBe(true);
        expect(await rejects(c, "delete from invoices where id = $1", [inv.id]), `${who} delete`).toBe(true);
        expect(
          await rejects(c, "insert into invoices (kindergarten_id, child_id, period, amount_original, amount, due_date) values ($1, $2, '2027-01-01', 1, 1, '2027-01-10')", [F.A, inv.child_id]),
          `${who} insert`,
        ).toBe(true);
      }
    });
  });

  it("receipt rows can't be inserted or reviewed by clients — only the server writes them", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const inv = await invoiceOf(c, "Алихан", "2026-10-01");
      const rid = await serverReceipt(c, "Алихан", "2026-10-01");
      for (const who of ["parent", "accountant", "owner"] as Who[]) {
        await become(F.users[who]);
        expect(
          await rejects(c, "insert into payment_receipts (kindergarten_id, invoice_id, child_id, file_path, mime, size) values ($1, $2, $3, $4, 'image/png', 10)", [
            F.A,
            inv.id,
            inv.child_id,
            `${F.A}/${inv.child_id}/x.png`,
          ]),
          who,
        ).toBe(true);
        expect(await rejects(c, "update payment_receipts set status = 'accepted', confirmed_amount = 65000, reviewed_at = now() where id = $1", [rid]), who).toBe(true);
        expect(await rejects(c, "delete from payment_receipts where id = $1", [rid]), who).toBe(true);
      }
      await c.query("reset role");
      expect((await c.query("select status from payment_receipts where id = $1", [rid])).rows[0].status).toBe("pending");
    });
  });

  it("file path must live under <kindergarten>/<child>/ and the receipt must match its invoice", async () => {
    await inTx(async (c) => {
      await fresh(c);
      const inv = await invoiceOf(c, "Алихан", "2026-10-01");
      const ins = "insert into payment_receipts (kindergarten_id, invoice_id, child_id, file_path, mime, size) values ($1, $2, $3, $4, $5, 10)";
      expect(await rejects(c, ins, [F.A, inv.id, inv.child_id, `${F.B}/${inv.child_id}/x.png`, "image/png"])).toBe(true);
      expect(await rejects(c, ins, [F.A, inv.id, inv.child_id, `${F.A}/${F.children["Миша"]}/x.png`, "image/png"])).toBe(true);
      expect(await rejects(c, ins, [F.A, inv.id, F.children["Миша"], `${F.A}/${F.children["Миша"]}/x.png`, "image/png"])).toBe(true);
      expect(await rejects(c, ins, [F.A, inv.id, inv.child_id, `${F.A}/${inv.child_id}/x.exe`, "application/x-msdownload"])).toBe(true);
      expect(await rejects(c, ins, [F.A, inv.id, inv.child_id, `${F.A}/${inv.child_id}/ok.png`, "image/png"])).toBe(false);
    });
  });
});

/** Current and previous month (YYYY-MM-01) in A's time zone. */
async function months(c: PoolClient) {
  const r = await c.query(
    "select date_trunc('month', kg_today($1))::date::text as cur, (date_trunc('month', kg_today($1)) - interval '1 month')::date::text as prev, (date_trunc('month', kg_today($1)) - interval '2 month')::date::text as older, (date_trunc('month', kg_today($1)) + interval '1 month')::date::text as next, kg_today($1)::text as today",
    [F.A],
  );
  return r.rows[0] as { cur: string; prev: string; older: string; next: string; today: string };
}

describe("payments · accrual", () => {
  it("manual: owner/accountant only, idempotent, current month (+ previous one if already billed), never older or future", async () => {
    await inTx(async (c, become) => {
      const m = await months(c);
      await c.query("delete from payment_receipts where kindergarten_id = $1", [F.A]);
      await c.query("delete from invoices where kindergarten_id = $1", [F.A]);
      for (const who of ["head", "teacher", "parent", "cook", "ownerB"] as Who[]) {
        await become(F.users[who]);
        expect(await rejects(c, "select accrue_invoices($1, $2)", [F.A, m.cur]), who).toBe(true);
      }
      await become(F.users.accountant);
      expect(await rejects(c, "select invoices_accrue($1, $2)", [F.A, m.cur])).toBe(true); // internal (cron)
      // nothing billed yet: the previous month can't be back-filled
      await failsWith(c, "select accrue_invoices($1, $2)", [F.A, m.prev], /hs:accrueTooOld/);
      const first = Number((await c.query("select accrue_invoices($1, $2) as n", [F.A, m.cur])).rows[0].n);
      expect(first).toBeGreaterThanOrEqual(4); // the fee-paying children of A (e2e runs may add more)
      expect(Number((await c.query("select accrue_invoices($1, $2::date + 14) as n", [F.A, m.cur])).rows[0].n)).toBe(0);
      await failsWith(c, "select accrue_invoices($1, $2)", [F.A, m.prev], /hs:accrueTooOld/); // before the first billed month
      await become(F.users.owner);
      expect(Number((await c.query("select accrue_invoices($1, $2) as n", [F.A, m.cur])).rows[0].n)).toBe(0);
      await failsWith(c, "select accrue_invoices($1, $2)", [F.A, m.next], /hs:accrueFuture/);
      // once the previous month exists (cron), it can be topped up by hand; two months back never
      await c.query("reset role");
      await c.query("select invoices_accrue($1, $2)", [F.A, m.prev]);
      await c.query("select invoices_accrue($1, $2)", [F.A, m.older]); // the cron could have billed it
      await become(F.users.accountant);
      expect(Number((await c.query("select accrue_invoices($1, $2) as n", [F.A, m.prev])).rows[0].n)).toBe(0);
      await failsWith(c, "select accrue_invoices($1, $2)", [F.A, m.older], /hs:accrueTooOld/);
      await c.query("reset role");
      const row = (await c.query("select amount, amount_original, due_date::text, status, starts_on from invoices where child_id = $1 and period = $2", [F.children["Алихан"], m.cur])).rows[0];
      expect(row).toMatchObject({ amount: "65000.00", amount_original: "65000.00", due_date: m.cur.slice(0, 8) + "10", status: "unpaid", starts_on: null });
      expect(await n(c, "select 1 from audit_log where kindergarten_id = $1 and action = 'invoice.accrue'", [F.A])).toBeGreaterThanOrEqual(1);
    });
  });

  it("skips children without a fee and children who have not started yet; a mid-month start is billed on the first day, flagged", async () => {
    await inTx(async (c) => {
      const m = await months(c);
      await c.query("delete from payment_receipts where kindergarten_id = $1", [F.A]);
      await c.query("delete from invoices where kindergarten_id = $1", [F.A]);
      await c.query("update children set monthly_fee = 0 where id = $1", [F.children["Сабина"]]);
      await c.query("update children set enrolled_on = $2::date + 1 where id = $1", [F.children["Айлин"], m.today]);
      await c.query("select invoices_accrue($1, $2)", [F.A, m.cur]);
      const kids = (await c.query("select child_id from invoices where kindergarten_id = $1 and period = $2", [F.A, m.cur])).rows.map((r) => r.child_id);
      expect(kids).not.toContain(F.children["Сабина"]);
      expect(kids).not.toContain(F.children["Айлин"]); // starts tomorrow: no invoice yet
      expect(kids).toContain(F.children["Алихан"]);
      // the child starts today: the next (daily) run bills the full month, due date counted from the first day
      await c.query("update children set enrolled_on = $2 where id = $1", [F.children["Айлин"], m.today]);
      expect(Number((await c.query("select invoices_accrue($1, $2) as n", [F.A, m.cur])).rows[0].n)).toBe(1);
      const r = (await c.query("select amount, due_date::text, starts_on::text from invoices where child_id = $1 and period = $2", [F.children["Айлин"], m.cur])).rows[0];
      expect(r.amount).toBe("60000.00");
      if (m.today > m.cur) {
        expect(r.starts_on).toBe(m.today);
        expect(r.due_date).toBe((await c.query("select ($1::date + 9)::text as d", [m.today])).rows[0].d);
      } else {
        expect(r.starts_on).toBeNull(); // started on the 1st — a regular invoice
      }
      // a future month is never billed, not even by the internal function
      expect(Number((await c.query("select invoices_accrue($1, $2) as n", [F.A, m.next])).rows[0].n)).toBe(0);
    });
  });
});

describe("payments · FIFO balance model", () => {
  it("a payment on the newest invoice settles the oldest debt first; every debt is counted once", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      // Сабина: September 60 000 unpaid, October 60 000 → the October statement shows 120 000
      let oct = await invoiceOf(c, "Сабина", "2026-10-01");
      expect(oct).toMatchObject({ carried: "60000.00", balance: "60000.00" });
      expect((await c.query("select debt_since::text as d from invoices where id = $1", [oct.id])).rows[0].d).toBe("2026-09-10");
      const deb = await c.query("select debt, since::text from payment_debtors($1) where child_id = $2", [F.A, F.children["Сабина"]]);
      expect(deb.rows[0]).toMatchObject({ debt: "120000.00", since: "2026-09-10" }); // not 180 000
      // month totals: October's own debt only
      const sumOct = (await c.query("select sum(balance)::text as d from invoices where kindergarten_id = $1 and period = '2026-10-01' and child_id = $2", [F.A, F.children["Сабина"]])).rows[0].d;
      expect(sumOct).toBe("60000.00");

      const rid = await serverReceipt(c, "Сабина", "2026-10-01");
      // while the receipt is pending, the older open month is "in review" too
      expect((await invoiceOf(c, "Сабина", "2026-09-01")).status).toBe("review");
      await become(F.users.accountant);
      await c.query("select review_receipt($1, true, 120000, null)", [rid]);
      await c.query("reset role");
      const sep = await invoiceOf(c, "Сабина", "2026-09-01");
      oct = await invoiceOf(c, "Сабина", "2026-10-01");
      expect(sep).toMatchObject({ status: "paid", paid_amount: "60000.00", balance: "0.00", debt_since: null });
      expect(sep.paid_at).not.toBeNull();
      expect(oct).toMatchObject({ status: "paid", paid_amount: "60000.00", balance: "0.00", carried: "0.00", advance: "0.00" });
      expect(await n(c, "select 1 from payment_debtors($1) where child_id = $2", [F.A, F.children["Сабина"]])).toBe(0);
    });
  });

  it("a partial payment settles the oldest month; an overpayment is an advance taken by the next month's invoice", async () => {
    await inTx(async (c, become) => {
      await c.query("delete from payment_receipts where kindergarten_id = $1", [F.A]);
      await c.query("delete from invoices where kindergarten_id = $1", [F.A]);
      await c.query("select invoices_accrue($1, '2026-09-01')", [F.A]);
      const over = await serverReceipt(c, "Айлин", "2026-09-01");
      await become(F.users.accountant);
      await c.query("select review_receipt($1, true, 70000, null)", [over]);
      await c.query("reset role");
      expect(await invoiceOf(c, "Айлин", "2026-09-01")).toMatchObject({ status: "paid", balance: "0.00", advance: "10000.00" });
      // October is accrued later: the advance pays part of it automatically and leaves the older invoice
      await c.query("select invoices_accrue($1, '2026-10-01')", [F.A]);
      expect(await invoiceOf(c, "Айлин", "2026-09-01")).toMatchObject({ status: "paid", advance: "0.00" });
      expect(await invoiceOf(c, "Айлин", "2026-10-01")).toMatchObject({ status: "partial", paid_amount: "10000.00", balance: "50000.00", carried: "0.00", advance: "0.00" });

      // 30 000 uploaded to October while September is open (Сабина) settles September only
      const part = await serverReceipt(c, "Сабина", "2026-10-01");
      await become(F.users.owner);
      await c.query("select review_receipt($1, true, 30000, null)", [part]);
      await c.query("reset role");
      expect(await invoiceOf(c, "Сабина", "2026-09-01")).toMatchObject({ status: "partial", paid_amount: "30000.00", balance: "30000.00" });
      expect(await invoiceOf(c, "Сабина", "2026-10-01")).toMatchObject({ status: "unpaid", paid_amount: "0.00", balance: "60000.00", carried: "30000.00" });
    });
  });

  it("revert: owner/accountant put a reviewed receipt back to pending with a reason; balances follow; audited", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const rid = await serverReceipt(c, "Алихан", "2026-10-01");
      await become(F.users.accountant);
      await c.query("select review_receipt($1, true, 130000, null)", [rid]);
      await failsWith(c, "select revert_receipt_review($1, 'x')", [rid], /hs:revertReasonRequired/);
      for (const who of ["head", "parent", "teacher", "ownerB"] as Who[]) {
        await become(F.users[who]);
        expect(await rejects(c, "select revert_receipt_review($1, 'Ошибка суммы')", [rid]), who).toBe(true);
      }
      await c.query("reset role");
      expect((await invoiceOf(c, "Алихан", "2026-10-01")).status).toBe("paid");
      await become(F.users.owner);
      await c.query("select revert_receipt_review($1, 'Подтвердили не ту сумму')", [rid]);
      await failsWith(c, "select revert_receipt_review($1, 'ещё раз')", [rid], /hs:receiptNotReviewed/);
      await c.query("reset role");
      expect((await c.query("select status, confirmed_amount, reviewed_at from payment_receipts where id = $1", [rid])).rows[0]).toMatchObject({
        status: "pending",
        confirmed_amount: null,
        reviewed_at: null,
      });
      expect(await invoiceOf(c, "Алихан", "2026-09-01")).toMatchObject({ status: "review", paid_amount: "0.00", paid_at: null });
      expect(await invoiceOf(c, "Алихан", "2026-10-01")).toMatchObject({ status: "review", balance: "65000.00" });
      const a = await c.query("select details, actor_id from audit_log where action = 'receipt.revert' and entity_id = $1", [rid]);
      expect(a.rows[0].actor_id).toBe(F.users.owner);
      expect(a.rows[0].details).toMatchObject({ from: "accepted", amount: 130000, reason: "Подтвердили не ту сумму" });
      // a rejected receipt can be reverted too, and then confirmed
      await become(F.users.accountant);
      await c.query("select review_receipt($1, false, null, 'Не видна сумма')", [rid]);
      await c.query("select revert_receipt_review($1, 'Сумма видна, ошиблась')", [rid]);
      await c.query("select review_receipt($1, true, 65000, null)", [rid]);
      await c.query("reset role");
      expect((await invoiceOf(c, "Алихан", "2026-09-01")).status).toBe("paid");
      expect((await invoiceOf(c, "Алихан", "2026-10-01")).status).toBe("unpaid");
    });
  });
});

describe("payments · adjustment and review", () => {
  it("adjust: owner/accountant with a comment, audited; head/parent forbidden; other garden forbidden", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const inv = await invoiceOf(c, "Миша", "2026-09-01");
      for (const who of ["head", "parent", "teacherParent", "teacher", "ownerB"] as Who[]) {
        await become(F.users[who]);
        expect(await rejects(c, "select adjust_invoice($1, 50000, 'скидка')", [inv.id]), who).toBe(true);
      }
      await become(F.users.accountant);
      await failsWith(c, "select adjust_invoice($1, 50000, ' ')", [inv.id], /hs:adjustCommentRequired/);
      await c.query("select adjust_invoice($1, 50000, 'Скидка: второй ребёнок')", [inv.id]);
      const after = await invoiceOf(c, "Миша", "2026-09-01");
      expect(after).toMatchObject({ amount: "50000.00", amount_original: "65000.00", adjustment_comment: "Скидка: второй ребёнок", adjusted_by: F.users.accountant });
      // the change flows into the next month's carried balance
      expect((await invoiceOf(c, "Миша", "2026-10-01")).carried).toBe("50000.00");
      await c.query("reset role"); // the accountant can't read the audit log itself
      const a = await c.query("select details from audit_log where action = 'invoice.adjust' and entity_id = $1", [inv.id]);
      expect(a.rows[0].details).toMatchObject({ comment: "Скидка: второй ребёнок" });
      // B's invoice is out of reach
      await c.query("select invoices_accrue($1, '2026-09-01')", [F.B]);
      const b = (await c.query("select id from invoices where kindergarten_id = $1 limit 1", [F.B])).rows[0].id;
      await become(F.users.accountant);
      expect(await rejects(c, "select adjust_invoice($1, 1, 'взлом чужого сада')", [b])).toBe(true);
    });
  });

  it("review: partial carries the rest, overpayment becomes an advance, reject needs a reason; head and parents can't review", async () => {
    await inTx(async (c, become) => {
      await fresh(c);
      const partial = await serverReceipt(c, "Сабина", "2026-09-01");
      const over = await serverReceipt(c, "Айлин", "2026-09-01");
      const bad = await serverReceipt(c, "Алихан", "2026-10-01");
      expect((await invoiceOf(c, "Алихан", "2026-10-01")).status).toBe("review");
      for (const who of ["head", "parent", "teacher", "ownerB"] as Who[]) {
        await become(F.users[who]);
        expect(await rejects(c, "select review_receipt($1, true, 60000, null)", [partial]), who).toBe(true);
      }
      await become(F.users.accountant);
      await c.query("select review_receipt($1, true, 40000, null)", [partial]);
      expect(await invoiceOf(c, "Сабина", "2026-09-01")).toMatchObject({ status: "partial", paid_amount: "40000.00", balance: "20000.00" });
      expect(await invoiceOf(c, "Сабина", "2026-10-01")).toMatchObject({ carried: "20000.00", balance: "60000.00" });

      await become(F.users.owner);
      await c.query("select review_receipt($1, true, 70000, null)", [over]);
      expect(await invoiceOf(c, "Айлин", "2026-09-01")).toMatchObject({ status: "paid", balance: "0.00" });
      expect(await invoiceOf(c, "Айлин", "2026-10-01")).toMatchObject({ carried: "0.00", paid_amount: "10000.00", balance: "50000.00", status: "partial" });

      await failsWith(c, "select review_receipt($1, false, null, '')", [bad], /hs:rejectReasonRequired/);
      await c.query("select review_receipt($1, false, null, 'Не видна сумма')", [bad]);
      expect((await invoiceOf(c, "Алихан", "2026-10-01")).status).toBe("rejected");
      await failsWith(c, "select review_receipt($1, true, 65000, null)", [bad], /hs:receiptReviewed/);

      await c.query("reset role");
      const actions = (await c.query("select action from audit_log where entity = 'payment_receipt' and entity_id = any($1) order by id", [[partial, over, bad]])).rows.map((r) => r.action);
      expect(actions).toEqual(["receipt.confirm", "receipt.confirm", "receipt.reject"]);

      // a new receipt after the rejection puts the invoice back into review; confirming the full amount pays it
      const again = await serverReceipt(c, "Алихан", "2026-10-01");
      expect((await invoiceOf(c, "Алихан", "2026-10-01")).status).toBe("review");
      await become(F.users.accountant);
      await c.query("select review_receipt($1, true, 65000 + (select balance from invoices where child_id = $2 and period = '2026-09-01'), null)", [again, F.children["Алихан"]]);
      const paid = await invoiceOf(c, "Алихан", "2026-10-01");
      expect(paid.status).toBe("paid");
      expect(paid.paid_at).not.toBeNull();
      expect(await n(c, "select 1 from payment_debtors($1) where child_id = $2", [F.A, F.children["Алихан"]])).toBe(0);
    });
  });
});

describe("payments · helper functions are not open to anon", () => {
  it("anon can't call the payment functions", async () => {
    await asUser(null, async (c) => {
      for (const sql of [
        "select accrue_invoices($1, '2026-09-01')",
        "select invoices_accrue($1, '2026-09-01')",
        "select * from payment_debtors($1)",
        "select invoices_recalc($1)",
        "select revert_receipt_review($1, 'причина')",
      ]) {
        expect(await rejects(c, sql, [F.A]), sql).toBe(true);
      }
    });
  });
});
