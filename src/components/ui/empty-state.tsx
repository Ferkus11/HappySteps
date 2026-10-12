import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-4 grid size-16 place-items-center rounded-full bg-sky-soft text-sky-strong">
        <Icon className="size-7" aria-hidden />
      </div>
      <p className="text-[15px] font-bold text-text">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
