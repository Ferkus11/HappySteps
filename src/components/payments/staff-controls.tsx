"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Confirm } from "@/components/common/confirm";
import { cn } from "@/lib/utils";
import { Input, Select } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { accrueMonthAction } from "@/app/(app)/payments/actions";

/**
 * «Начислить за месяц» — same idempotent SQL as the daily cron, allowed for the current month (and the previous one
 * at most). Always asks first: it creates invoices that parents see right away.
 */
export function AccrueButton({
  month,
  monthText,
  variant = "primary",
  className,
}: {
  month: string;
  monthText: string;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const t = useTranslations("payments");
  const a = useAction(accrueMonthAction, { onSuccess: (d) => toast.success(t("accrueDone", { count: d.count })) });
  return (
    <Confirm
      trigger={
        <Button variant={variant} disabled={a.pending} className={cn("min-w-0", className)} data-testid="accrue-month">
          <CalendarPlus /> <span className="truncate sm:hidden">{t("accrueOk")}</span>
          <span className="hidden truncate sm:inline">{t("accrue")}</span>
        </Button>
      }
      title={t("accrueTitle", { month: monthText })}
      description={t("accrueText")}
      confirmLabel={t("accrueOk")}
      onConfirm={() => a.run(month)}
    />
  );
}

/** Updates one query parameter of the current /payments URL (month picker, filters). */
function usePushParam() {
  const router = useRouter();
  return (params: Record<string, string>, key: string, value: string) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value);
    else q.delete(key);
    router.push(`/payments?${q.toString()}`);
  };
}

/**
 * Month picker. On phones the native input is laid invisibly over the localized label ("Октябрь 2026"), so a tap
 * still opens the system picker but nobody sees a raw "2026-10"; from sm up the input itself is shown.
 */
export function MonthInput({ params, value, label }: { params: Record<string, string>; value: string; label: string }) {
  const t = useTranslations("payments");
  const push = usePushParam();
  return (
    <div className="relative min-w-0 flex-1 sm:flex-none">
      <div
        className="flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-3 text-[15px] font-bold sm:hidden"
        aria-hidden
        data-testid="month-label-phone"
      >
        <span className="truncate">{label}</span>
      </div>
      <Input
        type="month"
        value={value}
        aria-label={t("month")}
        className="absolute inset-0 h-full w-full opacity-0 sm:static sm:w-48 sm:opacity-100"
        data-testid="pick-month"
        onChange={(e) => e.target.value && push(params, "month", e.target.value)}
      />
    </div>
  );
}

export function FilterSelect({
  params,
  name,
  value,
  label,
  options,
}: {
  params: Record<string, string>;
  name: string;
  value: string;
  label: string;
  /** `user`: the label is user content (a group name). */
  options: { value: string; label: string; user?: boolean }[];
}) {
  const push = usePushParam();
  return (
    <Select aria-label={label} value={value} onChange={(e) => push(params, name, e.target.value)} className="w-auto min-w-0 flex-1 sm:w-48 sm:flex-none" data-testid={`filter-${name}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} data-user-content={o.user ? "" : undefined}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
