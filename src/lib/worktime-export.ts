import "server-only";
import ExcelJS from "exceljs";
import { createPdf, fitText, pdfToBuffer, PDF_FONT, PDF_FONT_BOLD } from "@/lib/pdf";
import { cellKind, cellText, formatHours, type DayRow, type TimesheetPerson } from "@/lib/worktime";
import { isoWeekday } from "@/lib/format";
import type { CellCodes } from "@/lib/worktime";

export interface TimesheetLabels {
  title: string;
  subtitle: string; // kindergarten · month
  employee: string;
  hours: string;
  lates: string;
  absences: string;
  missed: string;
  archived: string;
  weekdays: Record<number, string>;
  codes: CellCodes;
  legend: string[];
}

const FILL = {
  late: "FFFFF3DA",
  absent: "FFFDE9EF",
  unmarked: "FFEEEBFB",
  off: "FFF3F4F7",
  head: "FFEAF5FD",
};

function fillOf(r: DayRow | undefined): string | null {
  const k = cellKind(r);
  if (k === "hours") return r!.status === "late" ? FILL.late : null;
  if (k === "absence") return FILL.absent;
  if (k === "unmarked") return FILL.unmarked;
  if (k === "holiday" || k === "off") return FILL.off;
  return null;
}

export async function timesheetXlsx(people: TimesheetPerson[], days: string[], L: TimesheetLabels): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Happy Steps";
  const ws = wb.addWorksheet(L.title.slice(0, 31), { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.getCell(1, 1).value = L.title;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = L.subtitle;
  const head1 = [L.employee, ...days.map((d) => Number(d.slice(8))), L.hours, L.lates, L.absences, L.missed];
  const head2 = ["", ...days.map((d) => L.weekdays[isoWeekday(d)]), "", "", "", ""];
  ws.getRow(3).values = head1;
  ws.getRow(4).values = head2;
  for (const r of [3, 4]) {
    ws.getRow(r).font = { bold: r === 3, size: r === 3 ? 10 : 8 };
    ws.getRow(r).alignment = { horizontal: "center" };
    ws.getRow(r).eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL.head } }));
  }
  ws.getCell(3, 1).alignment = { horizontal: "left" };
  ws.getColumn(1).width = 34;
  days.forEach((_, i) => (ws.getColumn(i + 2).width = 5.5));
  for (let i = 0; i < 4; i++) ws.getColumn(days.length + 2 + i).width = 9;

  people.forEach((p, idx) => {
    const rowNo = 5 + idx;
    const row = ws.getRow(rowNo);
    row.getCell(1).value = p.archived ? `${p.fullName} (${L.archived})` : p.fullName;
    days.forEach((d, i) => {
      const r = p.days[d];
      const c = row.getCell(i + 2);
      c.value = cellText(r, L.codes);
      c.alignment = { horizontal: "center" };
      c.font = { size: 9 };
      const f = fillOf(r);
      if (f) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f } };
    });
    const base = days.length + 2;
    row.getCell(base).value = Math.round((p.totals.minutes / 60) * 10) / 10;
    row.getCell(base).numFmt = "0.0";
    row.getCell(base).font = { bold: true };
    row.getCell(base + 1).value = p.totals.lates;
    row.getCell(base + 2).value = p.totals.absences;
    row.getCell(base + 3).value = p.totals.missed;
  });
  const legendStart = 6 + people.length;
  L.legend.forEach((line, i) => {
    ws.getCell(legendStart + i, 1).value = line;
    ws.getCell(legendStart + i, 1).font = { size: 9, color: { argb: "FF5F6878" } };
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export async function timesheetPdf(people: TimesheetPerson[], days: string[], L: TimesheetLabels): Promise<Buffer> {
  const M = 24;
  const doc = createPdf({ layout: "landscape", margin: M, title: L.title });
  const W = doc.page.width - M * 2;
  const nameW = 128;
  const totW = 30;
  const dayW = (W - nameW - totW * 4) / days.length;
  const rowH = 15;
  const bottom = doc.page.height - M;

  const header = () => {
    doc.font(PDF_FONT_BOLD).fontSize(13).fillColor("#1d2330").text(L.title, M, M);
    doc.font(PDF_FONT).fontSize(9).fillColor("#5f6878").text(L.subtitle, M, M + 17);
    let y = M + 36;
    doc.rect(M, y, W, rowH * 2).fill("#eaf5fd");
    doc.fillColor("#1d2330").font(PDF_FONT_BOLD).fontSize(7);
    doc.text(L.employee, M + 3, y + 4, { width: nameW - 6, lineBreak: false });
    days.forEach((d, i) => {
      const x = M + nameW + i * dayW;
      const wd = isoWeekday(d);
      doc.font(PDF_FONT_BOLD).fontSize(7).fillColor(wd > 5 ? "#c02a62" : "#1d2330").text(String(Number(d.slice(8))), x, y + 3, { width: dayW, align: "center", lineBreak: false });
      doc.font(PDF_FONT).fontSize(5.5).fillColor("#8a93a3").text(L.weekdays[wd], x, y + 3 + rowH, { width: dayW, align: "center", lineBreak: false });
    });
    [L.hours, L.lates, L.absences, L.missed].forEach((h, i) => {
      const x = M + nameW + days.length * dayW + i * totW;
      doc.font(PDF_FONT_BOLD).fontSize(5.5).fillColor("#1d2330").text(h, x, y + 4, { width: totW, align: "center", height: rowH * 2 - 4 });
    });
    y += rowH * 2;
    return y;
  };

  let y = header();
  for (const p of people) {
    if (y + rowH > bottom - 40) {
      doc.addPage();
      y = header();
    }
    doc.moveTo(M, y + rowH).lineTo(M + W, y + rowH).lineWidth(0.4).strokeColor("#e6e9ef").stroke();
    doc.font(PDF_FONT).fontSize(7).fillColor("#1d2330");
    const label = fitText(doc, p.archived ? `${p.fullName} (${L.archived})` : p.fullName, nameW - 8);
    doc.text(label, M + 3, y + 4, { width: nameW - 4, lineBreak: false });
    days.forEach((d, i) => {
      const r = p.days[d];
      const x = M + nameW + i * dayW;
      const f = fillOf(r);
      if (f) doc.rect(x + 0.3, y + 0.3, dayW - 0.6, rowH - 0.6).fill(`#${f.slice(2)}`);
      const txt = cellText(r, L.codes);
      if (txt) doc.font(PDF_FONT).fontSize(5.6).fillColor("#1d2330").text(txt, x, y + 5, { width: dayW, align: "center", lineBreak: false });
    });
    const tx = M + nameW + days.length * dayW;
    const totals = [formatHours(p.totals.minutes), String(p.totals.lates), String(p.totals.absences), String(p.totals.missed)];
    totals.forEach((v, i) => doc.font(i === 0 ? PDF_FONT_BOLD : PDF_FONT).fontSize(7).fillColor("#1d2330").text(v, tx + i * totW, y + 4, { width: totW, align: "center", lineBreak: false }));
    y += rowH;
  }
  y += 10;
  doc.font(PDF_FONT).fontSize(7).fillColor("#5f6878");
  for (const line of L.legend) {
    if (y > bottom - 10) {
      doc.addPage();
      y = M;
    }
    doc.text(line, M, y, { width: W, lineBreak: false });
    y += 10;
  }
  return pdfToBuffer(doc);
}
