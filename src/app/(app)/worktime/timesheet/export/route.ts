import { getTranslations } from "next-intl/server";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadDays } from "@/lib/queries/worktime";
import { buildTimesheet, monthDays, parseMonth } from "@/lib/worktime";
import { monthRange, todayIn, formatDateTime } from "@/lib/format";
import { attachment } from "@/lib/pdf";
import { timesheetPdf, timesheetXlsx, type TimesheetLabels } from "@/lib/worktime-export";

export const dynamic = "force-dynamic";

/** Monthly timesheet export: `?month=YYYY-MM&format=xlsx|pdf`. Owner/head/accountant only (SPEC §3.4). */
export async function GET(req: Request) {
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return Response.json({ error: "forbidden" }, { status: 403 });
  const ctx = r.ctx;
  if (!["owner", "head", "accountant"].includes(ctx.role) || !ctx.membership.consent_at) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const tz = ctx.settings.timezone;
  const month = parseMonth(url.searchParams.get("month"), todayIn(tz));
  const { from, to } = monthRange(month);
  const supabase = await createClient();
  const people = buildTimesheet(await loadDays(supabase, ctx.kg.id, from, to));
  const days = monthDays(month);

  const t = await getTranslations("worktime");
  const [y, m] = month.split("-");
  const L: TimesheetLabels = {
    title: t("timesheet"),
    subtitle: `${ctx.kg.name} · ${t("timesheetFor", { month: t(`months.${Number(m)}`), year: y })} · ${t("generated", { at: formatDateTime(new Date(), tz) })}`,
    employee: t("employee"),
    hours: t("totals.hoursShort"),
    lates: t("totals.latesShort"),
    absences: t("totals.absencesShort"),
    missed: t("totals.missedShort"),
    archived: t("archived"),
    weekdays: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, t(`weekdays.${d}`)])),
    codes: {
      sick: t("codes.sick"),
      vacation: t("codes.vacation"),
      day_off: t("codes.day_off"),
      unexcused: t("codes.unexcused"),
      unmarked: t("codes.unmarked"),
      holiday: t("codes.holiday"),
    },
    legend: [
      `${t("legend")}:`,
      `8,5 — ${t("legendHours")}; ${t("legendLate")} — ${t("legendLateExport")}`,
      `${t("codes.sick")} — ${t("absence.sick")}; ${t("codes.vacation")} — ${t("absence.vacation")}; ${t("codes.day_off")} — ${t("absence.day_off")}; ${t("codes.unexcused")} — ${t("absence.unexcused")}`,
      `${t("codes.unmarked")} — ${t("status.unmarked")}; ${t("codes.holiday")} — ${t("legendOff")}`,
      `* — ${t("legendEdited")}; ° — ${t("legendAuto")}`,
    ],
  };
  const name = `timesheet-${month}`;
  if (format === "pdf") {
    const body = await timesheetPdf(people, days, L);
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(`${name}.pdf`), "Cache-Control": "no-store" },
    });
  }
  const body = await timesheetXlsx(people, days, L);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(`${name}.xlsx`),
      "Cache-Control": "no-store",
    },
  });
}
