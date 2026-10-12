import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Big number + small caption, the main dashboard pattern. */
export function Stat({
  value,
  label,
  sub,
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[30px] leading-none font-extrabold tracking-tight text-text">{value}</div>
      <div className="mt-1.5 text-[13px] font-medium text-muted">{label}</div>
      {sub ? <div className="mt-1 text-xs text-faint">{sub}</div> : null}
    </div>
  );
}

const tileTones = {
  work: "bg-tile-work text-tile-work-fg",
  late: "bg-tile-late text-tile-late-fg",
  absent: "bg-tile-absent text-tile-absent-fg",
  unmarked: "bg-tile-unmarked text-tile-unmarked-fg",
} as const;

export function StatusTile({
  tone,
  value,
  label,
  href,
  testId,
}: {
  tone: keyof typeof tileTones;
  value: number | string;
  label: string;
  href?: string;
  testId?: string;
}) {
  const body = (
    <>
      <div className="text-[28px] leading-none font-extrabold" data-testid={testId}>
        {value}
      </div>
      <div className="mt-2 text-[13px] font-semibold opacity-90">{label}</div>
    </>
  );
  const cls = cn("block rounded-2xl p-4 transition-transform", tileTones[tone], href && "hover:-translate-y-0.5");
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
