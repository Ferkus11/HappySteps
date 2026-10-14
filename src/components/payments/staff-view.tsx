import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download, Inbox, PartyPopper, Search } from "lucide-react";
import type { KgContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { listGroups } from "@/lib/queries/people";
import { firstPeriod, loadDebtors, loadMonth, loadPending } from "@/lib/payments-data";
import { DISPLAY_STATUSES, canAccrueMonth, daysBetween, displayStatus, parseMonth, periodOf, shiftMonth, toPay, totals, type DisplayStatus } from "@/lib/payments";
import { formatDate, formatDateTime, formatMoney, todayIn } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { InvoiceStatusBadge } from "./status-badge";
import { ReviewDialog } from "./review-dialog";
import { AccrueButton, FilterSelect, MonthInput } from "./staff-controls";
import { monthLabel, monthPhrase } from "./month";

export const STAFF_TABS = ["review", "month", "debtors"] as const;
export type StaffTab = (typeof STAFF_TABS)[number];

export interface StaffParams {
  tab?: string;
  month?: string;
  status?: string;
  group?: string;
}

/** Owner/accountant (full) and head (view only): queue, month list, debtors (SPEC §5.9). */
export async function StaffPayments({ ctx, sp }: { ctx: KgContext; sp: StaffParams }) {
  const t = await getTranslations("payments");
  const tab: StaffTab = (STAFF_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as StaffTab) : "review";
  const canManage = ctx.role === "owner" || ctx.role === "accountant";
  const supabase = await createClient();
  const pending = await loadPending(supabase, ctx.kg.id);
  const tabHref = (k: StaffTab) => (k === "review" ? "/payments" : `/payments?tab=${k}${sp.month && k === "month" ? `&month=${sp.month}` : ""}`);
  return (
    <>
      <nav className="scrollbar-none scroll-shadow-x mb-4 flex w-full gap-1 overflow-x-auto rounded-2xl p-1 [--fade-bg:var(--surface-muted)] sm:inline-flex sm:w-auto sm:max-w-full" aria-label={t("title")}>
        {STAFF_TABS.map((k) => (
          <Link
            key={k}
            href={tabHref(k)}
            aria-current={tab === k ? "page" : undefined}
            data-testid={`tab-${k}`}
            className={cn(
              "inline-flex h-11 shrink-0 grow items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold whitespace-nowrap text-muted sm:h-10 sm:grow-0 sm:px-4 sm:text-sm",
              tab === k && "bg-surface text-text shadow-sm",
            )}
          >
            <span className="sm:hidden">{t(`tabsShort.${k}`)}</span>
            <span className="hidden sm:inline">{t(`tabs.${k}`)}</span>
            {k === "review" && pending.length ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-fg" data-testid="pending-count">
                {pending.length}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      {tab === "review" ? (
        <ReviewQueue ctx={ctx} pending={pending} canManage={canManage} />
      ) : tab === "month" ? (
        <MonthList ctx={ctx} sp={sp} canManage={canManage} />
      ) : (
        <Debtors ctx={ctx} />
      )}
    </>
  );
}

async function ReviewQueue({ ctx, pending, canManage }: { ctx: KgContext; pending: Awaited<ReturnType<typeof loadPending>>; canManage: boolean }) {
  const t = await getTranslations("payments");
  const tz = ctx.settings.timezone;
  if (!pending.length) {
    return (
      <Card>
        <EmptyState icon={Inbox} title={t("queueEmpty")} hint={t("queueEmptyHint")} />
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border" data-testid="receipt-queue">
        {pending.map((r) => {
          const month = monthLabel(t, r.invoice.period);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:px-5" data-testid="receipt-item" data-child={r.child.full_name}>
              <Avatar name={r.child.full_name} />
              <div className="min-w-0 flex-1 basis-[calc(100%-52px)] sm:basis-0">
                <Link href={`/payments/${r.invoice_id}`} className="block truncate font-bold hover:text-brand pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                  <span data-user-content>{r.child.full_name}</span>
                </Link>
                <div className="text-sm text-muted">
                  {month} · {t("uploadedAt", { date: formatDateTime(r.created_at, tz) })}
                </div>
              </div>
              <div className="flex w-full items-center justify-between gap-3 pl-[52px] sm:w-auto sm:shrink-0 sm:pl-0">
                <div className="sm:text-right">
                  <div className="text-xs text-faint">{t("toPay")}</div>
                  <div className="font-bold tabular-nums">{formatMoney(toPay(r.invoice))}</div>
                </div>
                <ReviewDialog
                  receipt={{
                    id: r.id,
                    childName: r.child.full_name,
                    subtitle: `${month} · ${t("uploadedAt", { date: formatDateTime(r.created_at, tz) })}`,
                    pending: true,
                    toPay: toPay(r.invoice),
                  }}
                  canReview={canManage}
                  label={canManage ? t("check") : t("view")}
                  variant={canManage ? "primary" : "outline"}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

async function MonthList({ ctx, sp, canManage }: { ctx: KgContext; sp: StaffParams; canManage: boolean }) {
  const t = await getTranslations("payments");
  const today = todayIn(ctx.settings.timezone);
  const month = parseMonth(sp.month, today);
  const supabase = await createClient();
  const [rows, groups, first] = await Promise.all([
    loadMonth(supabase, ctx.kg.id, periodOf(month)),
    listGroups(supabase, ctx.kg.id),
    canManage ? firstPeriod(supabase, ctx.kg.id) : Promise.resolve(null),
  ]);
  const canAccrue = canManage && canAccrueMonth(month, today, first);
  const accrueProps = { month, monthText: monthPhrase(t, month) };
  const status = (DISPLAY_STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as DisplayStatus) : "";
  const group = groups.some((g) => g.id === sp.group) || sp.group === "none" ? (sp.group as string) : "";
  const withStatus = rows.map((r) => ({ ...r, shown: displayStatus(r, today) }));
  const filtered = withStatus.filter(
    (r) => (!status || r.shown === status) && (!group || (group === "none" ? !r.child.group_id : r.child.group_id === group)),
  );
  const sum = totals(filtered);
  const params: Record<string, string> = Object.fromEntries(
    Object.entries({ tab: "month", month, status, group }).filter(([, v]) => v),
  );
  const q = (m: string) => `/payments?${new URLSearchParams({ ...params, month: m }).toString()}`;
  const gName = new Map(groups.map((g) => [g.id, g.name]));
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={t("prevMonth")}>
            <Link href={q(shiftMonth(month, -1))} data-testid="prev-month">
              <ChevronLeft />
            </Link>
          </Button>
          <MonthInput params={params} value={month} label={monthLabel(t, month)} />
          <Button asChild variant="outline" size="icon" aria-label={t("nextMonth")}>
            <Link href={q(shiftMonth(month, 1))} data-testid="next-month">
              <ChevronRight />
            </Link>
          </Button>
          <span className="hidden text-sm font-semibold text-muted sm:inline" data-testid="month-label" aria-hidden>
            {monthLabel(t, month)}
          </span>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            {canAccrue && rows.length > 0 ? <AccrueButton {...accrueProps} variant="outline" className="flex-1 sm:flex-none" /> : null}
            <Button asChild variant="secondary" className="flex-1 sm:flex-none">
              <a href={`/payments/export?month=${month}`} data-testid="export-xlsx" download>
                <Download /> {t("export")}
              </a>
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
          <Total label={t("accrued")} value={sum.accrued} testId="total-accrued" />
          <Total label={t("paid")} value={sum.paid} testId="total-paid" />
          <Total label={t("debtFor", { month: t(`monthsLower.${Number(month.slice(5, 7))}`) })} value={sum.debt} testId="total-debt" danger={sum.debt > 0} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <FilterSelect
            params={params}
            name="status"
            value={status}
            label={t("filterStatus")}
            options={[{ value: "", label: t("allStatuses") }, ...DISPLAY_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
          />
          <FilterSelect
            params={params}
            name="group"
            value={group}
            label={t("filterGroup")}
            options={[{ value: "", label: t("allGroups") }, ...groups.map((g) => ({ value: g.id, label: g.name, user: true })), { value: "none", label: t("noGroup") }]}
          />
        </div>
      </Card>
      <Card className="p-0">
        {filtered.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t("emptyMonth")}
              hint={canAccrue ? t("emptyMonthHint") : undefined}
              action={canAccrue ? <AccrueButton {...accrueProps} /> : undefined}
            />
          ) : (
            <EmptyState icon={Search} title={t("emptyFiltered")} />
          )
        ) : (
          <ul className="divide-y divide-border" data-testid="month-list">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/payments/${r.id}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5"
                  data-testid="month-row"
                  data-child={r.child.full_name}
                  data-status={r.shown}
                >
                  <Avatar name={r.child.full_name} />
                  <div className="min-w-0 flex-1">
                    {/* the name wraps to two lines on phones instead of being cut next to the status badge */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span data-user-content className="line-clamp-2 min-w-0 font-bold break-words" data-testid="month-row-name">{r.child.full_name}</span>
                      {r.child.status === "archived" ? <Badge className="shrink-0">{t("archived")}</Badge> : null}
                      {r.starts_on && !r.adjusted_at ? (
                        <Badge tone="warning" className="shrink-0" title={t("startsOn", { date: formatDate(r.starts_on) })} data-testid="starts-on">
                          {t("startsShort", { date: formatDate(r.starts_on).slice(0, 5) })}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {r.child.group_id ? <span data-user-content>{gName.get(r.child.group_id)}</span> : t("noGroup")}
                      {/* the amount only when it differs from the balance on the right (no «65 000 ₸» twice in a row) */}
                      {r.paid_amount > 0 || r.advance > 0 || r.balance !== r.amount ? ` · ${formatMoney(r.amount)}` : ""}
                      {r.paid_amount > 0 ? ` · ${t("paid").toLowerCase()} ${formatMoney(r.paid_amount)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <InvoiceStatusBadge status={r.shown} />
                    <span className={cn("text-sm font-bold tabular-nums", r.balance > 0 && r.shown === "overdue" && "text-danger")}>
                      {r.advance > 0 ? `${t("advance")} ${formatMoney(r.advance)}` : formatMoney(r.balance)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Total({ label, value, testId, danger }: { label: string; value: number; testId: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-row-reverse items-baseline justify-between gap-3 rounded-2xl bg-surface-muted px-4 py-3 sm:flex-col sm:items-start sm:justify-start sm:gap-0 sm:p-4">
      <div className={cn("text-[19px] leading-tight font-extrabold whitespace-nowrap tabular-nums sm:text-[24px]", danger && "text-danger")} data-testid={testId} data-value={value}>
        {formatMoney(value)}
      </div>
      <div className="text-[13px] font-medium text-muted sm:mt-1">{label}</div>
    </div>
  );
}

async function Debtors({ ctx }: { ctx: KgContext }) {
  const t = await getTranslations("payments");
  const today = todayIn(ctx.settings.timezone);
  const supabase = await createClient();
  const [list, groups] = await Promise.all([loadDebtors(supabase, ctx.kg.id), listGroups(supabase, ctx.kg.id)]);
  const gName = new Map(groups.map((g) => [g.id, g.name]));
  if (!list.length) {
    return (
      <Card>
        <EmptyState icon={PartyPopper} title={t("debtorsEmpty")} hint={t("debtorsEmptyHint")} />
      </Card>
    );
  }
  const total = list.reduce((s, d) => s + d.debt, 0);
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 md:px-5">
        <h2 className="text-[15px] font-bold">{t("tabs.debtors")}</h2>
        <span className="text-sm font-bold text-danger tabular-nums" data-testid="debtors-total">
          {t("debtorsTotal", { amount: formatMoney(total) })}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-border" data-testid="debtors-list">
        {list.map((d) => {
          const days = daysBetween(d.since, today);
          return (
            <li key={d.child_id}>
              <Link href={`/payments/${d.invoice_id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted md:px-5" data-testid="debtor-row" data-child={d.full_name}>
                <Avatar name={d.full_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span data-user-content className="line-clamp-2 min-w-0 font-bold break-words">{d.full_name}</span>
                    {d.child_status === "archived" ? <Badge className="shrink-0">{t("archived")}</Badge> : null}
                  </div>
                  <div className="truncate text-sm text-muted">{d.group_id ? <span data-user-content>{gName.get(d.group_id)}</span> : t("noGroup")}</div>
                  <div className={cn("text-xs", days > 0 ? "font-semibold text-danger" : "text-faint")} data-testid="debtor-age">
                    {days > 0 ? `${t("debtSince", { date: formatDate(d.since) })} · ${t("overdueDays", { count: days })}` : t("notDueYet", { date: formatDate(d.since) })}
                  </div>
                </div>
                <span className={cn("shrink-0 font-extrabold tabular-nums", days > 0 ? "text-danger" : "text-text")} data-testid="debtor-amount">
                  {formatMoney(d.debt)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
