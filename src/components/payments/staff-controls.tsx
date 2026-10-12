"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { accrueMonthAction } from "@/app/(app)/payments/actions";

/** «Начислить за месяц» — same idempotent SQL as the daily cron. */
export function AccrueButton({ month }: { month: string }) {
  const t = useTranslations("payments");
  const a = useAction(accrueMonthAction, { onSuccess: (d) => toast.success(t("accrueDone", { count: d.count })) });
  return (
    <Button onClick={() => a.run(month)} disabled={a.pending} className="w-full sm:w-auto" data-testid="accrue-month">
      <CalendarPlus /> {t("accrue")}
    </Button>
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

export function MonthInput({ params, value }: { params: Record<string, string>; value: string }) {
  const t = useTranslations("payments");
  const push = usePushParam();
  return (
    <Input
      type="month"
      value={value}
      aria-label={t("month")}
      className="w-auto min-w-0 flex-1 sm:w-48 sm:flex-none"
      data-testid="pick-month"
      onChange={(e) => e.target.value && push(params, "month", e.target.value)}
    />
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
  options: { value: string; label: string }[];
}) {
  const push = usePushParam();
  return (
    <Select aria-label={label} value={value} onChange={(e) => push(params, name, e.target.value)} className="w-auto min-w-0 flex-1 sm:w-48 sm:flex-none" data-testid={`filter-${name}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
