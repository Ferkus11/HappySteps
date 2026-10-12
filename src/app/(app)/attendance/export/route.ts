import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { attendanceGroups, loadMonthGrid } from "@/lib/attendance";
import { isMonth, type Cell } from "@/lib/attendance-logic";
import { todayIn } from "@/lib/format";

/** Monthly attendance of a group as .xlsx (owner/head/accountant: any group; teacher: own groups). */
export async function GET(req: Request) {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return new Response("forbidden", { status: 403 });
  const ctx = r.ctx;
  if (!ctx.membership.consent_at || !["owner", "head", "accountant", "teacher"].includes(ctx.role)) return new Response("forbidden", { status: 403 });
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const groupId = url.searchParams.get("group");
  if (!isMonth(month) || !groupId) return new Response("bad request", { status: 400 });
  const supabase = await createClient();
  const group = (await attendanceGroups(supabase, ctx)).find((g) => g.id === groupId);
  if (!group) return new Response("forbidden", { status: 403 });

  const t = await getTranslations("attendance");
  const today = todayIn(ctx.settings.timezone);
  const grid = await loadMonthGrid(supabase, ctx.kg.id, group.id, month, today);
  const letter = (c: Cell): string => {
    switch (c.kind) {
      case "present":
        return "+";
      case "absent":
        return t(`letters.${c.reason ?? "none"}`);
      case "off":
        return t("letters.off");
      default:
        return "";
    }
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Happy Steps";
  const ws = wb.addWorksheet(`${group.name} ${month}`.slice(0, 31));
  const [y, m] = month.split("-");
  ws.addRow([`${t("reportTitle")} · ${group.name} · ${t(`months.${Number(m)}` as "months.1")} ${y}`]).font = { bold: true, size: 13 };
  ws.addRow([ctx.kg.name]);
  ws.addRow([]);
  const head = ws.addRow([t("child"), ...grid.days.map((d) => Number(d.date.slice(8))), t("presentShort"), t("absentShort")]);
  head.font = { bold: true };
  head.alignment = { horizontal: "center" };
  const firstDayCol = 2;
  grid.days.forEach((d, i) => {
    if (!d.working) head.getCell(firstDayCol + i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } };
  });
  for (const row of grid.rows) {
    const xr = ws.addRow([row.name, ...row.cells.map(letter), row.present, row.absent]);
    row.cells.forEach((c, i) => {
      const cell = xr.getCell(firstDayCol + i);
      cell.alignment = { horizontal: "center" };
      if (c.kind === "present") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F5EE" } };
      if (c.kind === "absent") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE9EF" } };
      if (c.kind === "off") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } };
    });
  }
  const totals = ws.addRow([
    t("presentPerDay"),
    ...grid.presentPerDay.map((n, i) => (grid.days[i].working && grid.days[i].date <= today ? n : "")),
    grid.totalPresent,
    grid.totalAbsent,
  ]);
  totals.font = { bold: true };
  ws.addRow([]);
  ws.addRow([`${t("legend")}: + ${t("present")}; ${(["sick", "vacation", "family", "other", "none"] as const).map((k) => `${t(`letters.${k}`)} ${k === "none" ? t("absentNoReason") : t(`reasons.${k}`)}`).join("; ")}; ${t("letters.off")} ${t("dayOffShort")}`]);
  ws.getColumn(1).width = 34;
  for (let i = 0; i < grid.days.length; i++) ws.getColumn(firstDayCol + i).width = 4.2;
  ws.getColumn(firstDayCol + grid.days.length).width = 9;
  ws.getColumn(firstDayCol + grid.days.length + 1).width = 9;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  const name = `attendance-${month}.xlsx`;
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`${group.name}-${month}.xlsx`)}`,
      "Cache-Control": "no-store",
    },
  });
}
