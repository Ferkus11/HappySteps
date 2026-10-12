import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups } from "@/lib/queries/people";
import { loadMonth } from "@/lib/payments-data";
import { displayStatus, parseMonth, periodOf, totals } from "@/lib/payments";
import { formatDate, todayIn } from "@/lib/format";
import { attachment } from "@/lib/pdf";
import { monthLabel } from "@/components/payments/month";

export const dynamic = "force-dynamic";

/** Month list of invoices as .xlsx: `?month=YYYY-MM`. Owner/head/accountant only (SPEC §3.4). */
export async function GET(req: Request) {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return Response.json({ error: "forbidden" }, { status: 403 });
  const ctx = r.ctx;
  if (!["owner", "head", "accountant"].includes(ctx.role) || !ctx.membership.consent_at) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const today = todayIn(ctx.settings.timezone);
  const month = parseMonth(new URL(req.url).searchParams.get("month"), today);
  const supabase = await createClient();
  const [rows, groups] = await Promise.all([loadMonth(supabase, ctx.kg.id, periodOf(month)), listGroups(supabase, ctx.kg.id)]);
  const gName = new Map(groups.map((g) => [g.id, g.name]));
  const t = await getTranslations("payments");
  const label = monthLabel(t, month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Happy Steps";
  const ws = wb.addWorksheet(t("xlsx.sheet"));
  ws.addRow([t("xlsx.title", { month: label })]).font = { bold: true, size: 13 };
  ws.addRow([ctx.kg.name]);
  ws.addRow([]);
  const head = ws.addRow([
    t("child"),
    t("group"),
    t("xlsx.original"),
    t("accrued"),
    t("xlsx.adjustment"),
    t("xlsx.carried"),
    t("paid"),
    t("balance"),
    t("filterStatus"),
    t("dueDate"),
    t("xlsx.paidAt"),
  ]);
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: "middle" };
  const money = '#,##0 "₸"';
  for (const i of rows) {
    const st = displayStatus(i, today, i.isLatest);
    const xr = ws.addRow([
      i.child.full_name + (i.child.status === "archived" ? ` (${t("archived").toLowerCase()})` : ""),
      i.child.group_id ? (gName.get(i.child.group_id) ?? "") : "",
      i.amount_original,
      i.amount,
      i.adjustment_comment ?? "",
      i.carried,
      i.paid_amount,
      i.balance,
      t(`status.${st}`),
      formatDate(i.due_date),
      i.paid_at ? formatDate(i.paid_at, ctx.settings.timezone) : "",
    ]);
    if (st === "overdue") xr.getCell(9).font = { color: { argb: "FFC0262D" }, bold: true };
  }
  const sum = totals(rows);
  const tr = ws.addRow([t("xlsx.total"), "", "", sum.accrued, "", "", sum.paid, sum.debt]);
  tr.font = { bold: true };
  for (const c of [3, 4, 6, 7, 8]) ws.getColumn(c).numFmt = money;
  [34, 16, 14, 14, 30, 18, 14, 14, 14, 12, 14].forEach((w, idx) => (ws.getColumn(idx + 1).width = w));
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(`payments-${month}.xlsx`),
      "Cache-Control": "no-store",
    },
  });
}
