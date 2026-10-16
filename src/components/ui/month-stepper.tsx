import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/**
 * «‹ Октябрь 2026 ›» — the app's month picker (analytics, attendance report, payments, timesheet). The label comes
 * from the translation files, so a kk page never shows the browser's Russian month name.
 */
export function MonthStepper({
  label,
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
  testId = "month",
  className,
}: {
  label: string;
  prevHref: string;
  nextHref: string;
  prevLabel: string;
  nextLabel: string;
  /** Prefix of the test ids: `<id>-prev`, `<id>-label`, `<id>-next`. */
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Button asChild variant="outline" size="icon" aria-label={prevLabel}>
        <Link href={prevHref} data-testid={`${testId}-prev`}>
          <ChevronLeft />
        </Link>
      </Button>
      <div className="min-w-0 flex-1 truncate text-center text-[15px] font-bold sm:min-w-40 sm:flex-none" aria-live="polite" data-testid={`${testId}-label`}>
        {label}
      </div>
      <Button asChild variant="outline" size="icon" aria-label={nextLabel}>
        <Link href={nextHref} data-testid={`${testId}-next`}>
          <ChevronRight />
        </Link>
      </Button>
    </div>
  );
}
