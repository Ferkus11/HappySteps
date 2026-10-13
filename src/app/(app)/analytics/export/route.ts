import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { comparison, isSection, parsePeriod, sectionsFor } from "@/lib/analytics";
import { AnalyticsForbidden, loadSection } from "@/lib/analytics-data";
import { TABLE_IDS, buildTables, rangeLabel, type ColKind, type T } from "@/lib/analytics-view";
import { formatDate, todayIn } from "@/lib/format";
import { attachment } from "@/lib/pdf";

export const dynamic = "force-dynamic";

const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });

const NUM_FMT: Partial<Record<ColKind, string>> = {
  money: '#,##0 "₸"',
  pct: '0.0"%"',
  hours: "0.0",
};

/**
 * One analytics table as .xlsx: `?section=attendance|staff|finance|funnel&table=<id>&p=…&d=…` (or `from`/`to` for a
 * custom period). Same rules as the page (SPEC §3.4): owner — all, head — no finances, accountant — finances only;
 * 403 otherwise. The SQL functions check the caller again.
 */
export async function GET(req: Request) {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten" || !r.ctx.membership.consent_at) return forbidden();
  const ctx = r.ctx;
  const q = new URL(req.url).searchParams;
  const section = q.get("section");
  if (!isSection(section) || !sectionsFor(ctx.role).includes(section)) return forbidden();
  const tableId = q.get("table") ?? TABLE_IDS[section][0];
  if (!TABLE_IDS[section].includes(tableId)) return Response.json({ error: "invalid" }, { status: 400 });

  const today = todayIn(ctx.settings.timezone);
  const period = parsePeriod({ p: q.get("p") ?? undefined, d: q.get("d") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }, today);
  const { cur } = comparison(period, today);
  const t = (await getTranslations("analytics")) as unknown as T;
  const supabase = await createClient();
  let data;
  try {
    data = await loadSection(supabase, section, ctx.kg.id, cur);
  } catch (e) {
    if (e instanceof AnalyticsForbidden) return forbidden();
    throw e;
  }
  const table = buildTables(section, data, { t, range: cur }).find((x) => x.id === tableId)!;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Happy Steps";
  const ws = wb.addWorksheet(table.title.slice(0, 31));
  ws.addRow([`${t("title")} · ${table.title}`]).font = { bold: true, size: 13 };
  ws.addRow([ctx.kg.name]);
  ws.addRow([t("xlsx.period", { range: rangeLabel(cur) })]);
  ws.addRow([]);
  const head = ws.addRow(table.columns.map((c) => c.label));
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: "middle" };
  const cell = (v: unknown, kind: ColKind) => {
    if (v == null || v === "") return null;
    if (kind === "date") return formatDate(String(v));
    return v;
  };
  for (const row of table.rows) {
    const xr = ws.addRow(table.columns.map((c) => cell(row[c.key], c.kind)));
    table.columns.forEach((c, i) => {
      if (c.danger && Number(row[c.key] ?? 0) > 0) xr.getCell(i + 1).font = { color: { argb: "FFC0262D" }, bold: true };
    });
  }
  if (table.total) {
    const tr = ws.addRow(table.columns.map((c) => cell(table.total?.[c.key], c.kind)));
    tr.font = { bold: true };
  }
  table.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    const fmt = NUM_FMT[c.kind];
    if (fmt) col.numFmt = fmt;
    col.width = i === 0 ? 34 : Math.max(12, Math.min(22, c.label.length + 2));
  });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];

  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(`analytics-${section}-${tableId}-${cur.from}-${cur.to}.xlsx`),
      "Cache-Control": "no-store",
    },
  });
}
